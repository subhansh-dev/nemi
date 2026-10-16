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
<div id="lanes" class="lanes"></div>
`;

const CSS = `
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
#plan { padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
.planbar { display: flex; align-items: center; gap: 8px; color: var(--fog); }
.planitem { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.planitem input { accent-color: var(--teal); }
.planitem.done span { color: var(--fog); text-decoration: line-through; }
.lanes { flex: 1; display: flex; gap: 10px; padding: 10px; overflow-x: auto; align-items: stretch; }
.lane { flex: 1 1 340px; min-width: 320px; max-width: 560px; display: flex; flex-direction: column; background: var(--deep); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.lane.me { border-color: rgba(45,212,191,.35); }
.lanehead { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.lanehead .who { font-weight: 600; font-size: 12px; }
.provider { background: var(--card); color: var(--mist); border: 1px solid var(--border); border-radius: 6px; font-size: 11px; padding: 2px 4px; }
.iconbtn { background: none; border: none; color: var(--fog); cursor: pointer; padding: 2px 4px; font-size: 13px; }
.iconbtn:hover { color: var(--coral); }
.msgs { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.bubble { padding: 7px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; }
.bubble .body { white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: rgba(45,212,191,.10); border: 1px solid rgba(45,212,191,.22); }
.bubble.agent { background: var(--card); border: 1px solid var(--border); }
.bubble .meta { font-size: 10px; color: var(--fog); margin-bottom: 3px; letter-spacing: .05em; text-transform: uppercase; }
.bubble.error { border-color: rgba(255,126,103,.5); color: var(--coral); }
.composer { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border); }
.composer textarea { flex: 1; resize: none; background: var(--card); color: var(--mist); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-family: inherit; font-size: 12.5px; min-height: 38px; max-height: 120px; }
.composer textarea:disabled { opacity: .5; }
.spin { width: 10px; height: 10px; border: 2px solid rgba(45,212,191,.25); border-top-color: var(--teal); border-radius: 50%; animation: nemi-spin .9s linear infinite; }
@keyframes nemi-spin { to { transform: rotate(360deg); } }
.udot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.udot.off { opacity: .3; }
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
