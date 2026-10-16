import type { NemiState, NemiUser, ServerMessage } from '@nemi/shared';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscodeApi = acquireVsCodeApi();

let state: NemiState = { users: {}, sessions: {}, lanes: {}, memories: [] };
let you: NemiUser | null = null;
let connected = false;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(): void {
  document.getElementById('conn')?.classList.toggle('live', connected);
  const who = document.getElementById('whoami');
  if (who) {
    who.textContent = you ? you.name : '…';
    who.setAttribute('style', `color:${you?.color ?? 'var(--fog)'}`);
  }

  const cards = document.getElementById('cards');
  if (!cards) {
    return;
  }
  const sessions = Object.values(state.sessions).sort((a, b) => b.createdAt - a.createdAt);
  if (sessions.length === 0) {
    cards.innerHTML = `<div class="empty">No live sessions yet.<br>Start one and invite your team — every lane runs its own agent, live.</div>`;
    return;
  }
  cards.innerHTML = sessions.map((s) => {
    const lanes = s.laneIds.map((id) => state.lanes[id]).filter(Boolean);
    const done = s.plan.filter((p) => p.done).length;
    const pct = s.plan.length ? Math.round((done / s.plan.length) * 100) : 0;
    const active = lanes.filter((l) => l.status === 'running').length;
    const participants = new Set(lanes.map((l) => l.ownerId));
    if (s.createdBy) {
      participants.add(s.createdBy);
    }
    return `
      <div class="card" data-open="${s.id}">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="title">${esc(s.title)}</span>
          <span style="flex:1"></span>
          <span class="pill ${s.status}">${s.status.replace('-', ' ')}</span>
        </div>
        <div class="task">${esc(s.task.slice(0, 160))}${s.task.length > 160 ? '…' : ''}</div>
        <div class="chips">
          ${lanes.map((l) => {
            const u = state.users[l.ownerId];
            return `<span class="chip" style="border-color:${u?.color ?? 'var(--border)'}55">
              <span style="color:${u?.color ?? 'var(--fog)'}">●</span>
              ${esc(u?.name ?? '?')} · ${esc(l.provider ?? 'no agent')}${l.status === 'running' ? ' ▸' : ''}
            </span>`;
          }).join('')}
          ${s.branch ? `<span class="chip">⎇ ${esc(s.branch)}</span>` : ''}
          ${s.filesTouched.length ? `<span class="chip">${s.filesTouched.length} file${s.filesTouched.length > 1 ? 's' : ''}</span>` : ''}
          <span class="users">
            ${[...participants].map((uid) => {
              const u = state.users[uid];
              return u ? `<span class="udot${u.connected ? '' : ' off'}" style="background:${u.color}" title="${esc(u.name)}"></span>` : '';
            }).join('')}
          </span>
        </div>
        ${s.plan.length ? `<div class="progress"><div style="width:${pct}%"></div></div>
          <div style="color:var(--fog);font-size:10.5px;margin-top:4px">plan ${done}/${s.plan.length}${active ? ` · ${active} lane${active > 1 ? 's' : ''} running` : ''}</div>` : ''}
      </div>`;
  }).join('');
}

window.addEventListener('message', (event) => {
  const data = event.data as
    | { type: 'snapshot'; state: NemiState; you: NemiUser | null; connected: boolean }
    | { type: 'server'; msg: ServerMessage };
  if (data.type === 'snapshot') {
    state = data.state;
    you = data.you;
    connected = data.connected;
    render();
  } else if (data.type === 'server') {
    const msg = data.msg;
    switch (msg.type) {
      case 'hello':
        state = msg.state;
        you = msg.you;
        connected = true;
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
      case 'lane.status': {
        const lane = state.lanes[msg.laneId];
        if (lane) {
          lane.status = msg.status;
        }
        break;
      }
      case 'lane.delta':
        break;
    }
    render();
  }
});

document.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
  if (card) {
    vscodeApi.postMessage({ type: 'openSession', id: card.dataset.open });
    return;
  }
  if ((e.target as HTMLElement).id === 'new') {
    vscodeApi.postMessage({ type: 'newSession' });
  }
});

vscodeApi.postMessage({ type: 'ready' });
render();
