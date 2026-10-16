import type { NemiState, ServerMessage } from './protocol';

export function emptyState(): NemiState {
  return { users: {}, sessions: {}, lanes: {}, memories: [] };
}

/**
 * Applies a Brain message to a mirror state, in place. Shared by the
 * extension host and every webview so all renders agree on the world.
 */
export function applyServerMessage(state: NemiState, msg: ServerMessage): NemiState {
  switch (msg.type) {
    case 'hello':
      // Adopt the Brain's world *in place*. Callers hold a long-lived reference
      // to `state` (the extension's mirror, and every view that reads from it),
      // so returning a fresh object here would leave them all staring at the
      // empty state they started with. The message arrived over a socket, so
      // its contents are already a private, freshly parsed object graph.
      state.users = msg.state.users;
      state.sessions = msg.state.sessions;
      state.lanes = msg.state.lanes;
      state.memories = msg.state.memories;
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
    case 'brain.upsert': {
      const i = state.memories.findIndex((m) => m.id === msg.memory.id);
      if (i >= 0) {
        state.memories[i] = msg.memory;
      } else {
        state.memories.unshift(msg.memory);
      }
      break;
    }
    case 'brain.remove':
      state.memories = state.memories.filter((m) => m.id !== msg.id);
      break;
    case 'lane.execute':
      break;
  }
  return state;
}
