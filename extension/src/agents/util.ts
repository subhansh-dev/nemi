import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

/**
 * Spawns a provider CLI. The prompt always travels over stdin — never argv —
 * so quoting, spaces and unicode can never break the shell, and no user text
 * touches a command line.
 */
export function spawnCli(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): ChildProcessWithoutNullStreams {
  const child = spawn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // npm global shims on Windows are .cmd files; they need a shell, but argv
    // only ever contains our fixed flags.
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  signal.addEventListener('abort', () => {
    child.kill();
  }, { once: true });
  return child;
}

export function feedPrompt(child: ChildProcessWithoutNullStreams, prompt: string): void {
  child.stdin.write(prompt, 'utf8');
  child.stdin.end();
}

/** Invokes onLine for every complete stdout line (partial tail flushed at end). */
export function lineStream(
  child: ChildProcessWithoutNullStreams,
  onLine: (line: string) => void,
): void {
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', onLine);
}

export function collectStderr(child: ChildProcessWithoutNullStreams): string[] {
  const lines: string[] = [];
  const rl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.trim()) {
      lines.push(line);
      if (lines.length > 40) {
        lines.shift();
      }
    }
  });
  return lines;
}

/** Best-effort JSON parse of one line; null when it is plain text. */
export function tryJson(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function exitPromise(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });
}
