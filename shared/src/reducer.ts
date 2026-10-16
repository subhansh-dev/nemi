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
      return structuredClone(msg.state);
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
