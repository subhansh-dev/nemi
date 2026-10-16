import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  LANE_COLORS,
  MAX_LANE_MESSAGES,
  isClientMessage,
  type BrainMemory,
  type ClientMessage,
  type Lane,
  type LaneMessage,
  type NemiUser,
  type PlanItem,
  type ProviderID,
  type ServerMessage,
  type Session,
} from '@nemi/shared';
import { timingSafeEqual } from './auth';
import type { Store } from './store';

interface Conn {
  socket: WebSocket;
  user: NemiUser;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/** Stable identity from a display name, so reconnects keep the same color/id. */
function userForName(name: string, users: NemiStateUsers): NemiUser {
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'guest';
  const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, 6);
  const uid = `u_${slug}_${hash}`;
  const existing = users[uid];
  if (existing) {
    return { id: existing.id, name: existing.name, color: existing.color };
  }
  const colorIndex =
    Object.keys(users).length % LANE_COLORS.length;
  return { id: uid, name, color: LANE_COLORS[colorIndex] };
}

type NemiStateUsers = Record<string, NemiUser & { connected: boolean }>;

/**
 * The WebSocket hub: relays coordination state between connected clients and
 * owns the authoritative in-memory model. Execution stays on the machines
 * that own the lanes; the Brain only routes.
 */
export class Hub {
  private conns = new Map<string, Conn[]>();

  constructor(
    private readonly store: Store,
    /** When set, every client must present this secret in `identify`. */
    private readonly token = '',
  ) {}

  /* ------------------------------ helpers ------------------------------ */

  private broadcast(msg: ServerMessage, except?: string): void {
    const payload = JSON.stringify(msg);
    for (const list of this.conns.values()) {
      for (const conn of list) {
        if (conn.user.id !== except && conn.socket.readyState === conn.socket.OPEN) {
          conn.socket.send(payload);
        }
      }
    }
  }

  private to(user: NemiUser, msg: ServerMessage): void {
    const list = this.conns.get(user.id);
    if (!list) {
      return;
    }
    const payload = JSON.stringify(msg);
    for (const conn of list) {
      if (conn.socket.readyState === conn.socket.OPEN) {
        conn.socket.send(payload);
      }
    }
  }

  private persist(): void {
    this.store.schedulePersist();
  }

  private broadcastPresence(): void {
    this.broadcast({ type: 'presence', users: this.store.get().users });
  }

  /* --------------------------- connection ------------------------------ */

  handleConnection(socket: WebSocket): void {
    let user: NemiUser | null = null;

    const identifyTimer = setTimeout(() => {
      if (!user) {
        socket.close(4001, 'identify timeout');
      }
    }, 10_000);
    identifyTimer.unref();

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (!isClientMessage(parsed)) {
        return;
      }
      if (parsed.type === 'identify') {
        if (user) {
          return;
        }
        if (this.token && !timingSafeEqual(parsed.token ?? '', this.token)) {
          socket.close(4003, 'unauthorized');
          return;
        }
        clearTimeout(identifyTimer);
        user = userForName(parsed.name || 'guest', this.store.get().users);
        const state = this.store.get();
        state.users[user.id] = { ...user, connected: true };
        if (!this.conns.has(user.id)) {
          this.conns.set(user.id, []);
        }
        this.conns.get(user.id)!.push({ socket, user });
        socket.send(
          JSON.stringify({ type: 'hello', you: user, state } satisfies ServerMessage),
        );
        this.broadcastPresence();
        this.persist();
        return;
      }
      if (!user) {
        return;
      }
      this.dispatch(user, parsed);
    });

    socket.on('close', () => {
      clearTimeout(identifyTimer);
      if (!user) {
        return;
      }
      const list = this.conns.get(user.id) ?? [];
      const remaining = list.filter((c) => c.socket !== socket);
      if (remaining.length === 0) {
        this.conns.delete(user.id);
        const state = this.store.get();
        if (state.users[user.id]) {
          state.users[user.id].connected = false;
        }
        this.broadcastPresence();
        this.persist();
      } else {
        this.conns.set(user.id, remaining);
      }
    });
  }

  /* ----------------------------- dispatch ------------------------------ */

  private dispatch(user: NemiUser, msg: ClientMessage): void {
    const state = this.store.get();
    switch (msg.type) {
      case 'session.create': {
        const now = Date.now();
        const session: Session = {
          id: id('s'),
          title: msg.title.trim() || 'Untitled session',
          task: msg.task,
          branch: msg.branch ?? null,
          worktreePath: msg.worktreePath ?? null,
          status: 'live',
          plan: [],
          laneIds: [],
          filesTouched: [],
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        };
        state.sessions[session.id] = session;
        this.addLane(state, session, user.id, undefined);
        this.persist();
        this.broadcast({ type: 'session.upsert', session });
        break;
      }
      case 'session.update': {
        const session = state.sessions[msg.id];
        if (!session) {
          return;
        }
        Object.assign(session, msg.patch, { updatedAt: Date.now() });
        this.persist();
        this.broadcast({ type: 'session.upsert', session });
        break;
      }
      case 'session.plan.set': {
        const session = state.sessions[msg.id];
        if (!session) {
          return;
        }
        session.plan = msg.plan.map((p: PlanItem) => ({ ...p }));
        session.updatedAt = Date.now();
        this.persist();
        this.broadcast({ type: 'session.upsert', session });
        break;
      }
      case 'session.remove': {
        const session = state.sessions[msg.id];
        if (!session) {
          return;
        }
        for (const laneId of session.laneIds) {
          delete state.lanes[laneId];
          this.broadcast({ type: 'lane.remove', id: laneId });
        }
        delete state.sessions[msg.id];
        this.persist();
        this.broadcast({ type: 'session.remove', id: msg.id });
        break;
      }
      case 'lane.create': {
        const session = state.sessions[msg.sessionId];
        if (!session) {
          return;
        }
        this.addLane(state, session, user.id, msg.provider);
        this.persist();
        break;
      }
      case 'lane.setProvider': {
        const lane = state.lanes[msg.laneId];
        if (!lane) {
          return;
        }
        lane.provider = msg.provider;
        lane.updatedAt = Date.now();
        this.persist();
        this.broadcast({ type: 'lane.upsert', lane });
        break;
      }
      case 'lane.remove': {
        const lane = state.lanes[msg.laneId];
        if (!lane) {
          return;
        }
        const session = state.sessions[lane.sessionId];
        if (session) {
          session.laneIds = session.laneIds.filter((l) => l !== msg.laneId);
          session.updatedAt = Date.now();
          this.broadcast({ type: 'session.upsert', session });
        }
        delete state.lanes[msg.laneId];
        this.persist();
        this.broadcast({ type: 'lane.remove', id: msg.laneId });
        break;
      }
      case 'lane.message': {
        const lane = state.lanes[msg.laneId];
        if (!lane || lane.sessionId !== msg.sessionId) {
          return;
        }
        const message: LaneMessage = {
          id: id('m'),
          role: 'user',
          content: msg.content,
          ts: Date.now(),
          sponsorId: user.id,
        };
        this.pushMessage(lane, message);
        lane.status = 'running';
        lane.lastError = undefined;
        lane.updatedAt = Date.now();
        this.persist();
        this.broadcast({
          type: 'lane.message',
          sessionId: lane.sessionId,
          laneId: lane.id,
          message,
        });
        this.broadcast({ type: 'lane.status', laneId: lane.id, status: 'running' });
        // Route execution to whoever owns this lane (they may be another
        // client — or us; the client filters by ownership).
        this.broadcast({
          type: 'lane.execute',
          sessionId: lane.sessionId,
          laneId: lane.id,
          content: msg.content,
        });
        break;
      }
      case 'lane.delta': {
        const lane = state.lanes[msg.laneId];
        if (!lane) {
          return;
        }
        const pending = this.pendingAgentMessage(lane);
        pending.content += msg.text;
        lane.updatedAt = Date.now();
        this.persist();
        this.broadcast({
          type: 'lane.delta',
          sessionId: lane.sessionId,
          laneId: lane.id,
          text: msg.text,
        });
        break;
      }
      case 'lane.sessionId': {
        const lane = state.lanes[msg.laneId];
        if (!lane) {
          return;
        }
        lane.providerSessionId = msg.providerSessionId;
        this.persist();
        break;
      }
      case 'lane.status': {
        const lane = state.lanes[msg.laneId];
        if (!lane) {
          return;
        }
        lane.status = msg.status;
        lane.lastError = msg.error;
        lane.updatedAt = Date.now();
        this.pending.delete(lane.id); // finalize streaming transcript
        this.persist();
        this.broadcast({
          type: 'lane.status',
          laneId: lane.id,
          status: msg.status,
          error: msg.error,
        });
        this.broadcast({ type: 'lane.upsert', lane });
        break;
      }
      case 'lane.cancel': {
        const lane = state.lanes[msg.laneId];
        if (!lane) {
          return;
        }
        // The owning client kills its local process on this broadcast.
        this.broadcast({ type: 'lane.cancel', laneId: lane.id });
        lane.status = 'idle';
        lane.updatedAt = Date.now();
        this.pending.delete(lane.id);
        this.persist();
        this.broadcast({ type: 'lane.status', laneId: lane.id, status: 'idle' });
        this.broadcast({ type: 'lane.upsert', lane });
        break;
      }
      case 'brain.add': {
        const memory: BrainMemory = {
          id: id('mem'),
          kind: msg.kind,
          text: msg.text,
          file: msg.file,
          authorId: user.id,
          createdAt: Date.now(),
        };
        state.memories.unshift(memory);
        this.persist();
        this.broadcast({ type: 'brain.upsert', memory });
        break;
      }
      case 'brain.remove': {
        state.memories = state.memories.filter((m) => m.id !== msg.id);
        this.persist();
        this.broadcast({ type: 'brain.remove', id: msg.id });
        break;
      }
    }
  }

  /* ------------------------------ internals ----------------------------- */

  private pending = new Map<string, LaneMessage>();

  /**
   * First agent delta of a turn creates the transcript entry every
   * subsequent delta appends to.
   */
  private pendingAgentMessage(lane: Lane): LaneMessage {
    const existing = this.pending.get(lane.id);
    if (existing) {
      return existing;
    }
    const message: LaneMessage = {
      id: id('m'),
      role: 'agent',
      content: '',
      ts: Date.now(),
      sponsorId: lane.ownerId,
      provider: lane.provider ?? undefined,
    };
    this.pending.set(lane.id, message);
    this.pushMessage(lane, message);
    this.broadcast({
      type: 'lane.message',
      sessionId: lane.sessionId,
      laneId: lane.id,
      message,
    });
    return message;
  }

  private pushMessage(lane: Lane, message: LaneMessage): void {
    lane.messages.push(message);
    if (lane.messages.length > MAX_LANE_MESSAGES) {
      lane.messages.splice(0, lane.messages.length - MAX_LANE_MESSAGES);
    }
  }

  private addLane(
    state: { lanes: Record<string, Lane> },
    session: Session,
    ownerId: string,
    provider?: ProviderID | null,
  ): Lane {
    const now = Date.now();
    const lane: Lane = {
      id: id('l'),
      sessionId: session.id,
      ownerId,
      provider: provider ?? null,
      status: 'idle',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    state.lanes[lane.id] = lane;
    session.laneIds.push(lane.id);
    session.updatedAt = now;
    this.broadcast({ type: 'lane.upsert', lane });
    this.broadcast({ type: 'session.upsert', session });
    return lane;
  }
}
