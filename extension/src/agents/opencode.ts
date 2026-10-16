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
 * OpenCode adapter. `opencode run` is non-interactive; `--session` resumes
 * (or creates) a named session, `--auto` approves permissions that are not
 * explicitly denied, and `--format json` emits structured output. The parser
 * accepts both JSONL part streaming and a single final JSON document.
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
    const seenParts = new Set<string>();

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

    const handleObject = (obj: Record<string, any>) => {
      if (typeof obj.session_id === 'string') {
        opts.onEvent({ type: 'session', id: obj.session_id });
      }
      const parts = Array.isArray(obj.parts) ? obj.parts : obj.part ? [obj.part] : [];
      for (const part of parts) {
        const p = part as Record<string, any>;
        if (p?.type === 'text' && typeof p.text === 'string') {
          emit(p.text, p.id ? String(p.id) : undefined);
        } else if (p?.type === 'tool') {
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
    const code = await exitPromise(child);

    // Some versions print one final JSON blob instead of streaming parts;
    // if nothing streamed, the collected output was already consumed line by
    // line, so only surface an error here.
    if (code !== 0 && code !== null && !sawText) {
      opts.onEvent({
        type: 'error',
        message: stderr.slice(-5).join('\n') || `opencode exited with code ${code}`,
      });
    }
  },
};
