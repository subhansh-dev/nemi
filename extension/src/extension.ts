import fs from 'node:fs';
import os from 'node:os';
import * as vscode from 'vscode';
import { portFromEnv, type ProviderID, type ServerMessage } from '@nemi/shared';
import { PROVIDERS, PROVIDER_ORDER } from './agents';
import { BrainClient } from './brainClient';
import { createWorktree, ensureNemiExcluded, isGitRepo, slugify } from './git';
import { BrainView } from './views/brainView';
import { MissionControlView } from './views/missionControl';
import { SessionViews } from './views/sessionView';

export function activate(ctx: vscode.ExtensionContext): void {
  const workspaceDir =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const cfg = vscode.workspace.getConfiguration('nemi');
  const client = new BrainClient({
    port: cfg.get<number>('port') || portFromEnv(process.env),
    token: cfg.get<string>('token') || process.env.NEMI_TOKEN || '',
    brainUrl: cfg.get<string>('brainUrl') || '',
    userName: cfg.get<string>('userName') || '',
    workspaceDir,
  });
  const mission = new MissionControlView(client, ctx.extensionUri);
  const sessions = new SessionViews(client, ctx.extensionUri);
  const brain = new BrainView(client, workspaceDir);

  /** Lanes this window is currently executing. */
  const running = new Map<string, AbortController>();
  /** Open the session panel for the next session I create. */
  let openNextCreated = false;

  // The Brain keeps its state and any isolated worktrees under `.nemi/`. Keep
  // that out of the user's `git status` and diffs — repository-locally, so
  // their tracked .gitignore is never touched.
  void (async () => {
    if (await isGitRepo(workspaceDir)) {
      await ensureNemiExcluded(workspaceDir);
    }
  })();

  /* --------------------------- lane execution --------------------------- */

  async function executeTurn(
    sessionId: string,
    laneId: string,
    content: string,
  ): Promise<void> {
    const lane = client.state.lanes[laneId];
    if (!lane || lane.ownerId !== client.you?.id) {
      return; // not ours to run
    }
    if (running.has(laneId)) {
      return; // one turn at a time per lane
    }
    let providerId: ProviderID | null = lane.provider;
    if (!providerId) {
      const pick = await vscode.window.showQuickPick(
        PROVIDER_ORDER.map((id) => ({ label: PROVIDERS[id].label, id })),
        { placeHolder: 'Pick an agent for this lane' },
      );
      if (!pick) {
        client.send({ type: 'lane.status', laneId, status: 'idle' });
        return;
      }
      providerId = pick.id;
      client.send({ type: 'lane.setProvider', laneId, provider: providerId });
    }

    const ac = new AbortController();
    running.set(laneId, ac);
    let buffer = '';
    let lastFlush = 0;
    let error: string | undefined;
    /** Files this turn's agent reported changing, reported to the Brain at the end. */
    const touched = new Set<string>();

    // An isolated session runs inside its own worktree when that worktree
    // exists on this machine; otherwise fall back to the open folder.
    const session = client.state.sessions[sessionId];
    const cwd =
      session?.worktreePath && fs.existsSync(session.worktreePath)
        ? session.worktreePath
        : workspaceDir;

    const flush = (force = false): void => {
      const now = Date.now();
      if (buffer && (force || now - lastFlush > 120)) {
        client.send({ type: 'lane.delta', sessionId, laneId, text: buffer });
        buffer = '';
        lastFlush = now;
      }
    };

    try {
      await PROVIDERS[providerId].run({
        cwd,
        prompt: content,
        resumeId: lane.providerSessionId,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'text') {
            buffer += ev.text;
            flush();
          } else if (ev.type === 'session') {
            client.send({ type: 'lane.sessionId', laneId, providerSessionId: ev.id });
          } else if (ev.type === 'file') {
            touched.add(ev.path);
          } else if (ev.type === 'error') {
            error = ev.message;
          }
        },
      });
      flush(true);
    } catch (err) {
      error = String(err);
    } finally {
      running.delete(laneId);
      if (touched.size > 0) {
        client.send({ type: 'lane.files', laneId, files: [...touched] });
      }
      // A cancel already settled the lane on the Brain; don't overwrite it.
      if (!ac.signal.aborted) {
        client.send({ type: 'lane.status', laneId, status: error ? 'error' : 'idle', error });
      }
    }
  }

  /* ------------------------------ commands ------------------------------ */

  async function newSession(): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: 'Session title',
      placeHolder: 'e.g. Auth refactor',
    });
    if (!title?.trim()) {
      return;
    }
    const task = await vscode.window.showInputBox({
      prompt: 'The task — what should the team and its agents accomplish?',
      value: title,
    });
    if (!task?.trim()) {
      return;
    }

    // Sessions can work in the tree you already have open, or in a fresh
    // worktree on their own branch so parallel sessions cannot collide.
    let branch: string | null = null;
    let worktreePath: string | null = null;
    if (await isGitRepo(workspaceDir)) {
      const choices: (vscode.QuickPickItem & { isolated: boolean })[] = [
        {
          label: '$(files) This working tree',
          detail: 'Run the session where your folder already points.',
          isolated: false,
        },
        {
          label: '$(git-branch) New worktree on its own branch',
          detail: 'Isolate the session so two of them never edit the same files.',
          isolated: true,
        },
      ];
      const pick = await vscode.window.showQuickPick(choices, {
        placeHolder: 'Where should this session work?',
      });
      if (!pick) {
        return;
      }
      if (pick.isolated) {
        try {
          const worktree = await createWorktree(workspaceDir, slugify(title));
          branch = worktree.branch;
          worktreePath = worktree.path;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const anyway = await vscode.window.showWarningMessage(
            `Could not create a worktree: ${message}`,
            'Run in this tree anyway',
          );
          if (!anyway) {
            return;
          }
        }
      }
    }

    openNextCreated = true;
    client.send({
      type: 'session.create',
      title: title.trim(),
      task: task.trim(),
      branch,
      worktreePath,
    });
  }

  async function openSession(idArg?: string): Promise<void> {
    if (typeof idArg === 'string') {
      sessions.open(idArg);
      return;
    }
    const live = Object.values(client.state.sessions);
    const pick = await vscode.window.showQuickPick(
      live.map((s) => ({ label: s.title, description: s.status, id: s.id })),
      { placeHolder: 'Open a session' },
    );
    if (pick) {
      sessions.open(pick.id);
    }
  }

  async function addLane(sessionArg?: string): Promise<void> {
    let sessionId = typeof sessionArg === 'string' ? sessionArg : undefined;
    if (!sessionId) {
      const live = Object.values(client.state.sessions);
      const s = await vscode.window.showQuickPick(
        live.map((x) => ({ label: x.title, id: x.id })),
        { placeHolder: 'Which session needs another lane?' },
      );
      if (!s) {
        return;
      }
      sessionId = s.id;
    }
    const p = await vscode.window.showQuickPick(
      PROVIDER_ORDER.map((id) => ({ label: PROVIDERS[id].label, id })),
      { placeHolder: 'Agent for the new lane' },
    );
    if (!p) {
      return;
    }
    client.send({ type: 'lane.create', sessionId, provider: p.id as ProviderID });
    sessions.open(sessionId);
  }

  /** First non-internal IPv4 address, used to write a joinable invite. */
  function lanAddress(): string {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async function inviteMember(): Promise<void> {
    const handle = await vscode.window.showInputBox({
      prompt: 'Teammate handle',
      placeHolder: 'e.g. priya — the name they set as nemi.userName',
    });
    if (!handle?.trim()) {
      return;
    }
    client.send({ type: 'member.add', handle: handle.trim() });
    void vscode.window.showInformationMessage(
      `Nemi: ${handle.trim()} is on the roster and will light up when they join.`,
    );
  }

  async function copyInvite(): Promise<void> {
    const token = cfg.get<string>('token') || '';
    const port = cfg.get<number>('port') || portFromEnv(process.env);
    const url = client.isRemote ? client.wsUrl : `ws://${lanAddress()}:${port}`;
    const lines = [
      'Join my Nemi Brain.',
      '',
      `  nemi.brainUrl = ${url}`,
      `  nemi.token    = ${token || '<none — only reachable on the same machine>'}`,
      '  nemi.userName = <the handle you were added under>',
      '',
      'If nothing is listening yet, one of us starts it first:',
      `  npm run brain -- --host 0.0.0.0 --token ${token || '<pick-a-secret>'}`,
    ];
    await vscode.env.clipboard.writeText(lines.join('\n'));
    void vscode.window.showInformationMessage('Nemi: invite copied to the clipboard.');
  }

  /* ------------------------------ wiring -------------------------------- */

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MissionControlView.id, mission),
    vscode.window.registerTreeDataProvider('nemi.brain', brain),
    mission,
    brain,
    sessions,
    { dispose: () => client.stop() },
    client.sub('fatal', (err: Error) => {
      void vscode.window.showWarningMessage(`Nemi: ${err.message}`);
    }),
    client.sub('replayed', (count: number) => {
      void vscode.window.showInformationMessage(
        `Nemi: reconnected to the Brain and delivered ${count} action${
          count === 1 ? '' : 's'
        } held while it was away.`,
      );
    }),
    client.sub('message', (msg: ServerMessage) => {
      if (msg.type === 'lane.execute') {
        void executeTurn(msg.sessionId, msg.laneId, msg.content);
      } else if (msg.type === 'lane.cancel') {
        running.get(msg.laneId)?.abort();
      } else if (
        msg.type === 'session.upsert' &&
        openNextCreated &&
        msg.session.createdBy === client.you?.id
      ) {
        openNextCreated = false;
        sessions.open(msg.session.id);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Port, remote URL and token are read at startup, so they need a fresh
      // join. The display name is only read when the socket opens, so a plain
      // reconnect is enough — no reason to disturb a running Brain.
      const needsBrain =
        e.affectsConfiguration('nemi.port') ||
        e.affectsConfiguration('nemi.brainUrl') ||
        e.affectsConfiguration('nemi.token');
      if (needsBrain) {
        void client.restart();
      } else if (e.affectsConfiguration('nemi.userName')) {
        client.reconnect();
      }
    }),
    vscode.commands.registerCommand('nemi.newSession', newSession),
    vscode.commands.registerCommand('nemi.openSession', openSession),
    vscode.commands.registerCommand('nemi.addLane', addLane),
    vscode.commands.registerCommand('nemi.inviteMember', inviteMember),
    vscode.commands.registerCommand('nemi.copyInvite', copyInvite),
    vscode.commands.registerCommand('nemi.addMemory', () => brain.addMemory()),
    vscode.commands.registerCommand('nemi.removeMemory', (item) => brain.removeMemory(item)),
    vscode.commands.registerCommand('nemi.restartBrain', async () => {
      await client.restart();
      void vscode.window.showInformationMessage('Nemi: Brain restarted.');
    }),
  );

  void client.start().catch((err: Error) => {
    void vscode.window.showWarningMessage(`Nemi: Brain failed to start — ${err.message}`);
  });
}

export function deactivate(): void {
  /* client stop is wired through ctx.subscriptions */
}
