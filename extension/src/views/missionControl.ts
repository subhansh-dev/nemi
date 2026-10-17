import * as vscode from 'vscode';
import type { ServerMessage } from '@nemi/shared';
import type { BrainClient } from '../brainClient';
import { diffStat, type DiffStat } from '../git';
import { htmlShell } from './html';

const BODY = `
<div class="head">
  <h1>Mission Control</h1>
  <span id="whoami" style="color:var(--muted);font-size:11px"></span>
  <span id="conn" class="dot" title="Brain connection"></span>
</div>
<div id="roster" class="roster"></div>
<div id="cards"></div>
<div style="padding:12px"><button class="primary" id="new" style="width:100%">+ New Session</button></div>
`;

const CSS = `
.card { margin: 10px 12px; padding: 12px 13px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); cursor: pointer; transition: border-color .14s ease, background .14s ease; }
.card:hover { border-color: var(--line-strong); background: var(--raised); }
.card .title { font-weight: 600; font-size: 13px; }
.card .kill { opacity: 0; color: var(--muted); font-size: 12px; line-height: 1; padding: 2px 6px; border-radius: 6px; cursor: pointer; transition: opacity .12s ease, color .12s ease; }
.card:hover .kill { opacity: .55; }
.card .kill:hover { opacity: 1; color: var(--alert); background: var(--alert-weak); }
.card .task { color: var(--muted); font-size: 12px; margin: 5px 0 9px; line-height: 1.5; }
.card .failed { color: var(--alert); font-size: 11px; margin-top: 7px; line-height: 1.45; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.progress { height: 3px; border-radius: 999px; background: rgba(255,255,255,.06); margin-top: 9px; overflow: hidden; }
.progress > div { height: 100%; background: var(--accent); }
.users { display: flex; gap: 4px; margin-left: auto; }
.udot { width: 8px; height: 8px; border-radius: 50%; }
.udot.off { opacity: .28; }
.roster { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 12px 0; }
.member { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font-size: 11px; color: var(--text); background: rgba(255,255,255,.02); }
.member.off { opacity: .45; }
.member.invite { color: var(--muted); border-style: dashed; cursor: pointer; }
.member.invite:hover { color: var(--accent); border-color: var(--accent-line); }
`;

export class MissionControlView implements vscode.WebviewViewProvider {
  static readonly id = 'nemi.missionControl';
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  /** Change volume per worktree, refreshed at most every few seconds. */
  private readonly diffCache = new Map<string, { at: number; stat: DiffStat | null }>();

  constructor(
    private readonly client: BrainClient,
    private readonly extensionUri: vscode.Uri,
  ) {}

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = htmlShell(view.webview, this.extensionUri, 'board.js', BODY, CSS);
    this.disposables.push(
      view.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      this.client.sub('message', (msg: ServerMessage) => {
        void view.webview.postMessage({ type: 'server', msg });
      }),
      this.client.sub('state', () => void this.push()),
      this.client.sub('connected', () => void this.push()),
    );
  }

  refresh(): void {
    void this.push();
  }

  private async diffFor(dir: string): Promise<DiffStat | null> {
    const hit = this.diffCache.get(dir);
    const now = Date.now();
    if (hit && now - hit.at < 3000) {
      return hit.stat;
    }
    const stat = await diffStat(dir);
    this.diffCache.set(dir, { at: now, stat });
    return stat;
  }

  private async push(): Promise<void> {
    const state = this.client.state;
    const diffs: Record<string, DiffStat> = {};
    for (const session of Object.values(state.sessions)) {
      // Only an isolated session has a tree of its own to measure. Sessions
      // sharing the open folder would all report the same numbers, which would
      // say nothing, so they show no gutter.
      if (!session.worktreePath) {
        continue;
      }
      const stat = await this.diffFor(session.worktreePath);
      if (stat) {
        diffs[session.id] = stat;
      }
    }
    void this.view?.webview.postMessage({
      type: 'snapshot',
      state,
      you: this.client.you,
      connected: this.client.connected,
      diffs,
    });
  }

  private onMessage(m: { type?: string; id?: string }): void {
    switch (m.type) {
      case 'ready':
        void this.push();
        break;
      case 'newSession':
        void vscode.commands.executeCommand('nemi.newSession');
        break;
      case 'openSession':
        if (m.id) {
          void vscode.commands.executeCommand('nemi.openSession', m.id);
        }
        break;
      case 'removeSession':
        if (m.id) {
          void vscode.commands.executeCommand('nemi.removeSession', m.id);
        }
        break;
      case 'invite':
        void vscode.commands.executeCommand('nemi.copyInvite');
        break;
    }
  }
}
