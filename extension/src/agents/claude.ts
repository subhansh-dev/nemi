import type { AgentProvider } from './types';
import {
  collectStderr,
  exitPromise,
  feedPrompt,
  lineStream,
  spawnCli,
  tryJson,
} from './util';

/** Tools that change files on disk, feeding the shared files-touched map. */
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Update']);

/**
 * Claude Code adapter.
 * `claude -p` is non-interactive; `--output-format stream-json --verbose`
 * emits newline-delimited events we translate into live lane text.
 */
export const claudeProvider: AgentProvider = {
  id: 'claude',
  label: 'Claude Code',

  async run(opts) {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
    ];
    if (opts.resumeId) {
      args.push('--resume', opts.resumeId);
    }
    const child = spawnCli('claude', args, opts.cwd, opts.signal);
    const stderr = collectStderr(child);
    let sawText = false;

    lineStream(child, (line) => {
      const ev = tryJson(line);
      if (!ev || typeof ev !== 'object') {
        return;
      }
      const msg = ev as Record<string, unknown>;
      if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
        opts.onEvent({ type: 'session', id: msg.session_id });
        return;
      }
      if (msg.type === 'assistant') {
        const message = msg.message as { content?: unknown[] } | undefined;
        for (const block of message?.content ?? []) {
          const b = block as { type?: string; text?: string; name?: string };
          if (b.type === 'text' && b.text) {
            sawText = true;
            opts.onEvent({ type: 'text', text: b.text });
          } else if (b.type === 'tool_use' && b.name) {
            opts.onEvent({ type: 'text', text: `\n› ${b.name}\n` });
            const input = (block as { input?: Record<string, unknown> }).input;
            const filePath = input?.file_path ?? input?.notebook_path ?? input?.path;
            if (typeof filePath === 'string' && MUTATING_TOOLS.has(b.name)) {
              opts.onEvent({ type: 'file', path: filePath });
            }
          }
        }
        return;
      }
      if (msg.type === 'result' && !sawText && typeof msg.result === 'string') {
        opts.onEvent({ type: 'text', text: msg.result });
      }
    });

    feedPrompt(child, opts.prompt);
    const code = await exitPromise(child);
    if (code !== 0 && code !== null) {
      opts.onEvent({
        type: 'error',
        message: stderr.slice(-5).join('\n') || `claude exited with code ${code}`,
      });
    }
  },
};
