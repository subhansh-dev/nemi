import * as vscode from 'vscode';
import type { ServerMessage } from '@nemi/shared';
import type { BrainClient } from '../brainClient';
import { htmlShell } from './html';

const BODY = `
<div class="head">
  <h1>Mission Control</h1>
  <span id="whoami" style="color:var(--fog);font-size:11px"></span>
  <span id="conn" class="dot" title="Brain connection"></span>
</div>
<div id="roster" class="roster"></div>
<div id="cards"></div>
<div style="padding:12px"><button class="primary" id="new" style="width:100%">＋ New Session</button></div>
`;

const CSS = `
.card { margin: 10px 12px; padding: 10px 12px; background: var(--deep); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
.card:hover { border-color: rgba(45,212,191,.45); }
.card .title { font-weight: 600; margin-bottom: 2px; }
.card .task { color: var(--fog); font-size: 12px; margin: 4px 0 8px; line-height: 1.45; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.chip { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--fog); }
.progress { height: 3px; border-radius: 2px; background: rgba(143,172,179,.18); margin-top: 8px; overflow: hidden; }
.progress > div { height: 100%; background: var(--teal); }
.users { display: flex; gap: 4px; margin-left: auto; }
.udot { width: 8px; height: 8px; border-radius: 50%; }
.udot.off { opacity: .3; }
.roster { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 12px 0; }
.member { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; font-size: 11px; color: var(--mist); }
.member.off { opacity: .45; }
.member.invite { color: var(--teal); border-color: rgba(45,212,191,.35); cursor: pointer; }
.member.invite:hover { background: rgba(45,212,191,.08); }
`;

export class MissionControlView implements vscode.WebviewViewProvider {
  static readonly id = 'nemi.missionControl';
  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];

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
      this.client.sub('state', () => this.push()),
      this.client.sub('connected', () => this.push()),
    );
  }

  refresh(): void {
    this.push();
  }

  private push(): void {
    void this.view?.webview.postMessage({
      type: 'snapshot',
      state: this.client.state,
      you: this.client.you,
      connected: this.client.connected,
    });
  }

  private onMessage(m: { type?: string; id?: string }): void {
    switch (m.type) {
      case 'ready':
        this.push();
        break;
      case 'newSession':
        void vscode.commands.executeCommand('nemi.newSession');
        break;
      case 'openSession':
        if (m.id) {
          void vscode.commands.executeCommand('nemi.openSession', m.id);
        }
        break;
      case 'invite':
        void vscode.commands.executeCommand('nemi.copyInvite');
        break;
    }
  }
}
