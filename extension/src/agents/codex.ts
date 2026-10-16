import type { AgentProvider } from './types';
import {
  collectStderr,
  exitPromise,
  feedPrompt,
  lineStream,
  spawnCli,
  tryJson,
} from './util';

/**
 * Codex adapter. `codex exec` is non-interactive and reads the prompt from
 * stdin when no argument is given; `--json` emits JSONL events. Event shapes
 * have shifted between Codex releases, so the parser is deliberately
 * defensive: it recognizes known shapes and falls back to raw text.
 */
export const codexProvider: AgentProvider = {
  id: 'codex',
  label: 'Codex',

  async run(opts) {
    const args = opts.resumeId
      ? ['exec', 'resume', opts.resumeId, '--json']
      : ['exec', '--json'];
    const child = spawnCli('codex', args, opts.cwd, opts.signal);
    const stderr = collectStderr(child);
    const seenItems = new Set<string>();
    let sawText = false;

    const emitText = (text: string, key?: string) => {
      if (key) {
        if (seenItems.has(key)) {
          return;
        }
        seenItems.add(key);
      }
      sawText = true;
      opts.onEvent({ type: 'text', text });
    };

    lineStream(child, (line) => {
      const ev = tryJson(line);
      if (!ev || typeof ev !== 'object') {
        if (line.trim()) {
          emitText(line + '\n');
        }
        return;
      }
      const obj = ev as Record<string, any>;

      // Session/thread identity across Codex event revisions.
      const sid =
        obj.session_id ??
        obj.thread_id ??
        obj.msg?.session_id ??
        obj.msg?.thread_id;
      if (typeof sid === 'string') {
        opts.onEvent({ type: 'session', id: sid });
      }

      // Flat event form: {type:'item.completed', item:{type:'agent_message',...}}
      const flatItem = obj.item as Record<string, any> | undefined;
      // Wrapped form: {msg:{type:'agent_message'|'agent_reasoning',...}}
      const wrapped = obj.msg as Record<string, any> | undefined;
      const item = flatItem ?? wrapped;
      if (item && typeof item === 'object') {
        const kind = item.type ?? item.item_type;
        if (kind === 'agent_message' && typeof item.text === 'string') {
          emitText(item.text, String(item.id ?? item.item_id ?? ''));
        } else if (kind === 'command_execution' && item.status === 'completed' && typeof item.command === 'string') {
          opts.onEvent({ type: 'text', text: `\n› ${item.command}\n` });
        } else if (kind === 'file_change' || kind === 'patch') {
          const changes = (item.changes ?? item.files ?? []) as unknown[];
          for (const change of changes) {
            const record = change as Record<string, unknown> | null;
            const candidate =
              typeof change === 'string'
                ? change
                : record?.path ?? record?.file ?? record?.file_path;
            if (typeof candidate === 'string') {
              opts.onEvent({ type: 'file', path: candidate });
            }
          }
        }
      }
    });

    feedPrompt(child, opts.prompt);
    const code = await exitPromise(child);
    if (code !== 0 && code !== null && !sawText) {
      opts.onEvent({
        type: 'error',
        message: stderr.slice(-5).join('\n') || `codex exited with code ${code}`,
      });
    }
  },
};
