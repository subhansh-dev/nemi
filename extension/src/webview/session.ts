import type { PlanItem, ProviderID, ServerMessage } from '@nemi/shared';

const BODY = `
<div class="head">
  <h1 id="title">Session</h1>
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
.planitem span { color: var(--mist); }
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
.bubble { padding: 7px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: rgba(45,212,191,.10); border: 1px solid rgba(45,212,191,.22); }
.bubble.agent { background: var(--card); border: 1px solid var(--border); }
.bubble .meta { font-size: 10px; color: var(--fog); margin-bottom: 3px; letter-spacing: .05em; text-transform: uppercase; }
.bubble.error { border-color: rgba(255,126,103,.5); color: var(--coral); }
.composer { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border); }
.composer textarea { flex: 1; resize: none; background: var(--card); color: var(--mist); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-family: inherit; font-size: 12.5px; min-height: 38px; max-height: 120px; }
.composer textarea:disabled { opacity: .5; }
.spin { width: 10px; height: 10px; border: 2px solid rgba(45,212,191,.25); border-top-color: var(--teal); border-radius: 50%; animation: nemi-spin 0.9s linear infinite; }
@keyframes nemi-spin { to { transform: rotate(360deg); } }
`;

interface Snap {
  type: 'snapshot';
  sessionId: string;
  state: import('@nemi/shared').NemiState;
  you: import('@nemi/shared').NemiUser | null;
}
interface ServerWrap { type: 'server'; msg: ServerMessage }

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();
let state = { users: {}, sessions: {}, lanes: {}, memories: [] } as import('@nemi/shared').NemiState;
let you: import('@nemi/shared').NemiUser | null = null;
let sessionId: string | null = (vscodeApi.getState() as { sessionId?: string } | undefined)?.sessionId ?? null;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function providerName(id: string | null): string {
  return id ? id[0].toUpperCase() + id.slice(1) : 'No agent';
}

function render(): void {
  const titleEl = document.getElementById('title')!;
  const statusEl = document.getElementById('status')!;
  const presenceEl = document.getElementById('presence')!;
  const planEl = document.getElementById('plan')!;
  const lanesEl = document.getElementById('lanes')!;

  const session = sessionId ? state.sessions[sessionId] : null;
  if (!session) {
    titleEl.textContent = 'Session';
    statusEl.style.display = 'none';
    planEl.innerHTML = '';
    lanesEl.innerHTML = '<div class="empty" style="margin:auto">This session has ended.</div>';
    return;
  }
  titleEl.textContent = session.title;
  statusEl.textContent = session.status.replace('-', ' ');
  statusEl.className = `pill ${session.status}`;
  statusEl.style.display = '';

  presenceEl.innerHTML = Object.values(state.users)
    .map((u) => `<span class="udot${u.connected ? '' : ' off'}" style="background:${u.color}" title="${esc(u.name)}"></span>`)
    .join('');

  const done = session.plan.filter((p) => p.done).length;
  planEl.innerHTML = `
    <div class="planbar">
      <strong style="color:var(--mist);font-size:12px">Plan</strong>
      <span>${done}/${session.plan.length}</span>
      <span style="flex:1"></span>
      <input id="planadd" placeholder="Add step…" style="background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--mist);padding:3px 8px;font-size:11.5px;width:180px">
    </div>
    ${session.plan.map((p) => `
      <label class="planitem${p.done ? ' done' : ''}">
        <input type="checkbox" data-plan="${p.id}"${p.done ? ' checked' : ''}>
        <span>${esc(p.text)}</span>
      </label>`).join('')}
  `;

  const lanes = session.laneIds
    .map((id) => state.lanes[id])
    .filter(Boolean);
  lanesEl.innerHTML = lanes.map((lane) => {
    const owner = state.users[lane.ownerId];
    const mine = lane.ownerId === you?.id;
    const running = lane.status === 'running';
    const msgs = lane.messages.map((m) => `
      <div class="bubble ${m.role === 'user' ? 'user' : 'agent'}${m.role === 'system' ? ' error' : ''}" data-msg="${m.id}">
        <div class="meta">${m.role === 'user' ? 'prompt' : (m.provider ?? 'agent')}${m.sponsorId && owner ? ` · ${esc(state.users[m.sponsorId]?.name ?? '')}` : ''}</div><span class="body">${esc(m.content)}</span>
      </div>`).join('');
    const placeholder = mine
      ? running
        ? 'Agent is working…'
        : 'Ask your agent. Enter to send, Shift+Enter for newline.'
      : `Read-only — this is ${owner?.name ?? 'a teammate'}’s lane.`;
    return `
      <div class="lane${mine ? ' me' : ''}" data-lane="${lane.id}">
        <div class="lanehead">
          <span class="udot" style="width:9px;height:9px;border-radius:50%;background:${owner?.color ?? '#8FACB3'}"></span>
          <span class="who">${esc(owner?.name ?? 'unknown')}${mine ? ' (you)' : ''}</span>
          <span style="flex:1"></span>
          ${running ? '<span class="spin"></span>' : ''}
          <select class="provider" data-provider="${lane.id}">
            ${['claude', 'codex', 'opencode'].map((p) =>
              `<option value="${p}"${lane.provider === p ? ' selected' : ''}>${providerName(p)}</option>`).join('')}
          </select>
          ${running ? `<button class="iconbtn" data-cancel="${lane.id}" title="Stop">✕</button>` : ''}
          ${!running && !mine ? `<button class="iconbtn" data-removelane="${lane.id}" title="Remove lane">🗑</button>` : ''}
        </div>
        <div class="msgs" data-msgs="${lane.id}">${msgs || `<div class="empty">${mine ? 'Send the first prompt.' : 'Waiting for ' + esc(owner?.name ?? 'teammate')}…</div>`}</div>
        <div class="composer">
          <textarea data-composer="${lane.id}" ${mine && !running ? '' : 'disabled'} placeholder="${esc(placeholder)}"></textarea>
          ${mine && !running ? `<button class="primary" data-send="${lane.id}">Send</button>` : ''}
        </div>
      </div>`;
  }).join('') + `
    <div class="lane" style="min-width:150px;max-width:150px;align-items:center;justify-content:center;border-style:dashed">
      <button class="iconbtn" id="addlane" style="font-size:20px" title="Add a lane">＋</button>
      <div style="color:var(--fog);font-size:11px">add lane</div>
    </div>`;

  // Keep newest messages visible.
  for (const el of document.querySelectorAll<HTMLElement>('[data-msgs]')) {
    el.scrollTop = el.scrollHeight;
  }
}

function appendDelta(laneId: string, text: string): void {
  const lane = state.lanes[laneId];
  const last = lane?.messages[lane.messages.length - 1];
  if (!last) {
    render();
    return;
  }
  const el = document.querySelector(`[data-msg="${last.id}"] .body`);
  if (!el) {
    render();
    return;
  }
  el.textContent = (el.textContent ?? '') + text;
  const msgs = document.querySelector(`[data-msgs="${laneId}"]`);
  if (msgs) {
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function apply(msg: ServerMessage): void {
  applyMsg(msg);
  if (msg.type === 'lane.delta') {
    appendDelta(msg.laneId, msg.text);
  } else {
    render();
  }
}

/* Minimal mirror reducer (kept local so the webview bundle is standalone). */
function applyMsg(msg: ServerMessage): void {
  switch (msg.type) {
    case 'hello':
      state = msg.state;
      break;
    case 'presence':
      state.users = msg.users;
      break;
    case 'session.upsert':
      state.sessions[msg.session.id] = msg.session;
      break;
    case 'session.remove':
      delete state.sessions[msg.id];
      break;
    case 'lane.upsert':
      state.lanes[msg.lane.id] = msg.lane;
      break;
    case 'lane.remove':
      delete state.lanes[msg.id];
      break;
    case 'lane.message': {
      const lane = state.lanes[msg.laneId];
      if (lane && !lane.messages.some((m) => m.id === msg.message.id)) {
        lane.messages.push(msg.message);
      }
      break;
    }
    case 'lane.delta': {
      const lane = state.lanes[msg.laneId];
      const last = lane?.messages[lane.messages.length - 1];
      if (last && last.role === 'agent') {
        last.content += msg.text;
      }
      break;
    }
    case 'lane.status': {
      const lane = state.lanes[msg.laneId];
      if (lane) {
        lane.status = msg.status;
        lane.lastError = msg.error;
      }
      break;
    }
  }
}

window.addEventListener('message', (event) => {
  const data = event.data as Snap | ServerWrap;
  if (data.type === 'snapshot') {
    state = data.state;
    you = data.you;
    sessionId = data.sessionId;
    vscodeApi.setState({ sessionId });
    render();
  } else if (data.type === 'server') {
    apply(data.msg);
  }
});

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const send = t.closest<HTMLElement>('[data-send]');
  if (send) {
    const laneId = send.dataset.send!;
    const ta = document.querySelector<HTMLTextAreaElement>(`[data-composer="${laneId}"]`);
    const content = ta?.value.trim();
    if (content && sessionId) {
      vscodeApi.postMessage({ type: 'send', sessionId, content });
      if (ta) {
        ta.value = '';
      }
    }
    return;
  }
  const cancel = t.closest<HTMLElement>('[data-cancel]');
  if (cancel) {
    vscodeApi.postMessage({ type: 'cancel', laneId: cancel.dataset.cancel });
    return;
  }
  if (t.id === 'addlane' || t.closest('#addlane')) {
    vscodeApi.postMessage({ type: 'addLane', sessionId });
    return;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  const planBox = t.closest<HTMLInputElement>('[data-plan]');
  if (planBox && sessionId) {
    const plan: PlanItem[] = (state.sessions[sessionId]?.plan ?? []).map((p) =>
      p.id === planBox.dataset.plan ? { ...p, done: planBox.checked } : p);
    vscodeApi.postMessage({ type: 'plan', sessionId, plan });
    return;
  }
  const prov = t.closest<HTMLSelectElement>('[data-provider]');
  if (prov) {
    vscodeApi.postMessage({
      type: 'setProvider',
      laneId: prov.dataset.provider,
      provider: prov.value as ProviderID,
    });
  }
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.matches('textarea[data-composer]') && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const ta = t as HTMLTextAreaElement;
    const laneId = ta.dataset.composer;
    const content = ta.value.trim();
    if (content && sessionId) {
      vscodeApi.postMessage({ type: 'send', sessionId, content });
      ta.value = '';
    }
  }
  const target = e.target as HTMLInputElement;
  if (target.id === 'planadd' && e.key === 'Enter' && sessionId) {
    e.preventDefault();
    const text = target.value.trim();
    if (text) {
      const plan: PlanItem[] = [
        ...(state.sessions[sessionId]?.plan ?? []),
        { id: `p${Date.now()}`, text, done: false },
      ];
      vscodeApi.postMessage({ type: 'plan', sessionId, plan });
      target.value = '';
    }
  }
});

vscodeApi.postMessage({ type: 'ready' });
render();
