import * as vscode from 'vscode';
import type { ProviderID, ServerMessage } from '@nemi/shared';
import { PROVIDERS, PROVIDER_ORDER } from '../agents';
import type { BrainClient } from '../brainClient';
import { htmlShell } from './html';

const BODY = `
<div class="head">
  <h1 id="title">Session</h1>
  <span id="branch" class="pill done"></span>
  <span id="presence" class="users"></span>
  <span id="status" class="pill live">live</span>
</div>
<div id="plan"></div>
<div id="files"></div>
<div id="lanes" class="lanes"></div>
`;

const CSS = `
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.head h1#title { font-size: 13.5px; letter-spacing: 0; text-transform: none; color: var(--text); }
#plan { padding: 8px 14px; border-bottom: 1px solid var(--line); font-size: 12px; }
.planbar { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.planitem { display: flex; align-items: center; gap: 7px; padding: 2px 0; }
.planitem input { accent-color: var(--accent); }
.planitem.done span { color: var(--muted); text-decoration: line-through; }
#files { padding: 8px 14px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; }
.lanes { flex: 1; display: flex; gap: 12px; padding: 12px; overflow-x: auto; align-items: stretch; }
.lane { flex: 1 1 340px; min-width: 320px; max-width: 560px; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.lane.me { border-color: var(--accent-edge); }
.lanehead { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-bottom: 1px solid var(--line); }
.lanehead .who { font-weight: 600; font-size: 12px; }
.provider { background: var(--raised); color: var(--text); border: 1px solid var(--line); border-radius: 6px; font-size: 11px; padding: 2px 5px; font-family: inherit; }
.iconbtn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 2px 5px; font-size: 13px; border-radius: 6px; }
.iconbtn:hover { color: var(--alert); background: var(--alert-weak); }
.msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 9px; }
.bubble { padding: 8px 11px; border-radius: 10px; font-size: 12.5px; line-height: 1.55; }
.bubble .body { white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: var(--accent-weak); border: 1px solid var(--accent-edge); }
.bubble.agent { background: var(--raised); border: 1px solid var(--line); }
.bubble .meta { font-size: 9.5px; color: var(--muted); margin-bottom: 4px; letter-spacing: .09em; text-transform: uppercase; }
.bubble.error { border-color: var(--alert-line); color: var(--alert); }
.laneerror { border: 1px solid var(--alert-line); border-radius: 8px; padding: 8px 10px; background: var(--alert-weak); color: var(--alert); font-size: 12px; line-height: 1.5; }
.laneerror .body { white-space: pre-wrap; word-break: break-word; }
.laneerror .meta { font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase; margin-bottom: 4px; opacity: .85; }
.composer { display: flex; gap: 7px; padding: 10px; border-top: 1px solid var(--line); align-items: flex-end; }
.composer textarea { flex: 1; resize: none; background: var(--raised); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-family: inherit; font-size: 12.5px; line-height: 1.5; min-height: 38px; max-height: 120px; }
.composer textarea:focus { outline: none; border-color: var(--accent-line); }
.composer textarea:disabled { opacity: .5; }
.spin { width: 10px; height: 10px; border: 2px solid var(--accent-weak); border-top-color: var(--accent); border-radius: 50%; animation: nemi-spin .9s linear infinite; }
@keyframes nemi-spin { to { transform: rotate(360deg); } }
.udot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.udot.off { opacity: .28; }
`;

export class SessionViews implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>();
  private pending = new Map<string, string[]>();
  private disposables: vscode.Disposable[];

  constructor(
    private readonly client: BrainClient,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables = [
      client.sub('message', (msg: ServerMessage) => this.forward(msg)),
    ];
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Closes the panel for a session, if it is open — e.g. once it is removed. */
  close(sessionId: string): void {
    this.panels.get(sessionId)?.dispose();
  }

  open(sessionId: string): void {
    const existing = this.panels.get(sessionId);
    if (existing) {
      existing.reveal();
      return;
    }
    const session = this.client.state.sessions[sessionId];
    const panel = vscode.window.createWebviewPanel(
      'nemiSession',
      `Nemi: ${session?.title ?? 'session'}`,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = htmlShell(panel.webview, this.extensionUri, 'session.js', BODY, CSS);
    this.panels.set(sessionId, panel);
    panel.onDidDispose(() => this.panels.delete(sessionId));
    panel.webview.onDidReceiveMessage((m) => this.onMessage(sessionId, m));
    panel.webview.postMessage({
      type: 'snapshot',
      sessionId,
      state: this.client.state,
      you: this.client.you,
    });
  }

  refresh(): void {
    for (const sessionId of this.panels.keys()) {
      this.panels.get(sessionId)?.webview.postMessage({
        type: 'snapshot',
        sessionId,
        state: this.client.state,
        you: this.client.you,
      });
    }
  }

  private forward(msg: ServerMessage): void {
    for (const panel of this.panels.values()) {
      void panel.webview.postMessage({ type: 'server', msg });
    }
    // A queued send can go out as soon as my lane exists.
    if (msg.type === 'lane.upsert' && msg.lane.ownerId === this.client.you?.id) {
      const queue = this.pending.get(msg.lane.sessionId);
      if (queue?.length) {
        for (const content of queue) {
          this.client.send({
            type: 'lane.message',
            sessionId: msg.lane.sessionId,
            laneId: msg.lane.id,
            content,
          });
        }
        this.pending.delete(msg.lane.sessionId);
      }
    }
  }

  private async onMessage(sessionId: string, m: Record<string, unknown>): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.open(sessionId); // re-post the snapshot after webview reload
        break;
      case 'send': {
        const content = String(m.content ?? '').trim();
        if (!content) {
          return;
        }
        const you = this.client.you?.id;
        const session = this.client.state.sessions[sessionId];
        const myLane = session?.laneIds
          .map((id) => this.client.state.lanes[id])
          .find((l) => l && l.ownerId === you);
        if (myLane) {
          this.client.send({ type: 'lane.message', sessionId, laneId: myLane.id, content });
        } else {
          const pick = await vscode.window.showQuickPick(
            PROVIDER_ORDER.map((id) => ({ label: PROVIDERS[id].label, id })),
            { placeHolder: 'Which agent should run your lane?' },
          );
          if (!pick) {
            return;
          }
          const queue = this.pending.get(sessionId) ?? [];
          queue.push(content);
          this.pending.set(sessionId, queue);
          this.client.send({ type: 'lane.create', sessionId, provider: pick.id as ProviderID });
        }
        break;
      }
      case 'cancel':
        this.client.send({ type: 'lane.cancel', laneId: String(m.laneId) });
        break;
      case 'setProvider':
        this.client.send({
          type: 'lane.setProvider',
          laneId: String(m.laneId),
          provider: m.provider as ProviderID,
        });
        break;
      case 'addLane':
        void vscode.commands.executeCommand('nemi.addLane', sessionId);
        break;
      case 'plan':
        this.client.send({
          type: 'session.plan.set',
          id: sessionId,
          plan: (m.plan as import('@nemi/shared').PlanItem[]) ?? [],
        });
        break;
    }
  }
}
