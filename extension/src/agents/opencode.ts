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
 * OpenCode adapter. `opencode run` is non-interactive; it reads the prompt from
 * stdin whenever stdin is not a TTY (see its `run` command: with no message
 * argument it falls back to piped input). `--session` resumes (or creates) a
 * session, `--auto` approves permissions that are not explicitly denied, and
 * `--format json` emits one JSON event per line. The parser accepts both the
 * current event shape (`sessionID`, `{type:'text', part:{...}}`) and the older
 * snake_case one.
 */
export const opencodeProvider: AgentProvider = {
  id: 'opencode',
  label: 'OpenCode',

  async run(opts) {
    const args = ['run', '--format', 'json', '--auto'];
    if (opts.resumeId) {
      args.push('--session', opts.resumeId);
    }
    const child = spawnCli('opencode', args, opts.cwd, opts.signal);
    const stderr = collectStderr(child);
    let sawText = false;
    let sawError = false;
    const seenParts = new Set<string>();
    const seenTools = new Set<string>();

    const emit = (text: string, key?: string) => {
      if (key) {
        if (seenParts.has(key)) {
          return;
        }
        seenParts.add(key);
      }
      sawText = true;
      opts.onEvent({ type: 'text', text });
    };

    /** Reports the first failure only; a failed turn often says it twice. */
    const fail = (message: string) => {
      if (sawError) {
        return;
      }
      sawError = true;
      opts.onEvent({ type: 'error', message });
    };

    const handleObject = (obj: Record<string, any>) => {
      // Current builds stamp every event with `sessionID`; older ones used
      // `session_id`. Without this the lane never learns which session it is
      // in, so `--session` is never passed and every turn starts over.
      const sessionId = obj.sessionID ?? obj.session_id;
      if (typeof sessionId === 'string') {
        opts.onEvent({ type: 'session', id: sessionId });
      }
      // A failed run reports itself as an ordinary event and exits non-zero, so
      // the real reason is in the payload rather than on stderr.
      if (obj.type === 'error') {
        const message = obj.error?.message;
        fail(typeof message === 'string' && message ? message : 'opencode reported an error');
        return;
      }
      const parts = Array.isArray(obj.parts) ? obj.parts : obj.part ? [obj.part] : [];
      for (const part of parts) {
        const p = part as Record<string, any>;
        if (p?.type === 'text' && typeof p.text === 'string') {
          emit(p.text, p.id ? String(p.id) : undefined);
        } else if (p?.type === 'tool') {
          const key = p.id ? String(p.id) : undefined;
          if (key) {
            if (seenTools.has(key)) {
              continue;
            }
            seenTools.add(key);
          }
          opts.onEvent({
            type: 'text',
            text: `\n› ${typeof p.tool === 'string' ? p.tool : 'tool'}\n`,
          });
          const input = (p.state?.input ?? p.input ?? {}) as Record<string, unknown>;
          const candidate = input.filePath ?? input.file_path ?? input.path;
          if (typeof candidate === 'string') {
            opts.onEvent({ type: 'file', path: candidate });
          }
        }
      }
      if (obj.type === 'text' && typeof obj.text === 'string') {
        emit(obj.text);
      }
    };

    lineStream(child, (line) => {
      const ev = tryJson(line);
      if (ev && typeof ev === 'object') {
        handleObject(ev as Record<string, any>);
      }
    });

    feedPrompt(child, opts.prompt);
    const { code, spawnError } = await exitPromise(child);

    // Some versions print one final JSON blob instead of streaming parts; if
    // nothing streamed, the collected output was already consumed line by
    // line, so only surface an error here.
    if (spawnError) {
      fail(spawnError);
    } else if (code !== 0 && code !== null && !sawText && !sawError) {
      fail(stderr.slice(-5).join('\n') || `opencode exited with code ${code}`);
    }
  },
};
