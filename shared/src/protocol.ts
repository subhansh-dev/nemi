/**
 * Nemi wire protocol — the single source of truth for every message that
 * crosses the Brain's WebSocket. Both the server and the extension import
 * from here; nothing is hand-rolled twice.
 */

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export interface NemiUser {
  id: string;
  name: string;
  color: string;
}

export type ProviderID = 'claude' | 'codex' | 'opencode';

export type SessionStatus = 'live' | 'awaiting-takeover' | 'done';

export type LaneStatus = 'idle' | 'running' | 'error';

export interface PlanItem {
  id: string;
  text: string;
  done: boolean;
}

export interface LaneMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  ts: number;
  /** The user whose account produced this message, for agent turns. */
  sponsorId?: string;
  provider?: ProviderID;
}

export interface Lane {
  id: string;
  sessionId: string;
  /** Human owner. The agent runs on their machine, under their account. */
  ownerId: string;
  provider: ProviderID | null;
  status: LaneStatus;
  messages: LaneMessage[];
  /** Provider-side conversation id, for resuming. */
  providerSessionId?: string;
  /** Files this lane's agent touched, as reported by the executing client. */
  filesTouched?: string[];
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  title: string;
  task: string;
  /** Branch this session works on, if isolation is enabled. */
  branch: string | null;
  /** Isolated git worktree for this session, when one was requested. */
  worktreePath?: string | null;
  status: SessionStatus;
  plan: PlanItem[];
  laneIds: string[];
  /** Files touched, reported by executing clients. */
  filesTouched: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type MemoryKind = 'decision' | 'gotcha' | 'convention';

export interface BrainMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  /** Optional path this memory is about. Pinned memory arrives in v1. */
  file?: string;
  authorId: string;
  createdAt: number;
}

export interface NemiState {
  users: Record<string, NemiUser & { connected: boolean }>;
  sessions: Record<string, Session>;
  lanes: Record<string, Lane>;
  memories: BrainMemory[];
}

/* ------------------------------------------------------------------ */
/* Client → server                                                     */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  | {
      type: 'identify';
      name: string;
      /** Shared secret, when the Brain was started with a token. */
      token?: string;
    }
  /** A user prompt for a lane they own. Server routes execution to owner. */
  | { type: 'lane.message'; sessionId: string; laneId: string; content: string }
  /** Owner streaming agent output back for broadcast. */
  | { type: 'lane.delta'; sessionId: string; laneId: string; text: string }
  /** Owner reports a fresh provider conversation id. */
  | { type: 'lane.sessionId'; laneId: string; providerSessionId: string }
  /** Owner reports which files its agent touched this turn. */
  | { type: 'lane.files'; laneId: string; files: string[] }
  | { type: 'lane.status'; laneId: string; status: LaneStatus; error?: string }
  | { type: 'lane.cancel'; laneId: string }
  | {
      type: 'session.create';
      title: string;
      task: string;
      branch?: string | null;
      worktreePath?: string | null;
    }
  | { type: 'session.update'; id: string; patch: Partial<Pick<Session, 'title' | 'task' | 'status'>> }
  | { type: 'session.plan.set'; id: string; plan: PlanItem[] }
  | { type: 'session.remove'; id: string }
  | { type: 'lane.create'; sessionId: string; provider?: ProviderID }
  | { type: 'lane.setProvider'; laneId: string; provider: ProviderID }
  | { type: 'lane.remove'; laneId: string }
  | { type: 'brain.add'; kind: MemoryKind; text: string; file?: string }
  | { type: 'brain.remove'; id: string };

/* ------------------------------------------------------------------ */
/* Server → client                                                     */
/* ------------------------------------------------------------------ */

export type ServerMessage =
  | { type: 'hello'; you: NemiUser; state: NemiState }
  | { type: 'presence'; users: NemiState['users'] }
  | { type: 'session.upsert'; session: Session }
  | { type: 'session.remove'; id: string }
  | { type: 'lane.upsert'; lane: Lane }
  | { type: 'lane.remove'; id: string }
  /** A user prompt, broadcast so everyone sees it appear. */
  | { type: 'lane.message'; sessionId: string; laneId: string; message: LaneMessage }
  | { type: 'lane.delta'; sessionId: string; laneId: string; text: string }
  | { type: 'lane.status'; laneId: string; status: LaneStatus; error?: string }
  /** Directive to owners: kill the local process for this lane. */
  | { type: 'lane.cancel'; laneId: string }
  | { type: 'brain.upsert'; memory: BrainMemory }
  | { type: 'brain.remove'; id: string }
  /** Directive: the owning client should execute this prompt on this lane. */
  | { type: 'lane.execute'; sessionId: string; laneId: string; content: string };

export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
