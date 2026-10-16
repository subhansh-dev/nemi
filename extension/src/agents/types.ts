import type { ProviderID } from '@nemi/shared';

export type AgentEvent =
  | { type: 'text'; text: string }
  /** Provider-side conversation id, for resuming the lane later. */
  | { type: 'session'; id: string }
  | { type: 'error'; message: string };

export interface AgentRunOptions {
  cwd: string;
  prompt: string;
  resumeId?: string;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

export interface AgentProvider {
  id: ProviderID;
  label: string;
  /** Runs one turn. Resolves when the process exits (any exit code). */
  run(opts: AgentRunOptions): Promise<void>;
}
