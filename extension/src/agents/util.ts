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
  // A CLI that failed to start tears its stdin down, and a write into that
  // wreckage would surface as an unhandled stream error. The spawn failure is
  // the real story, and exitPromise tells it.
  child.stdin.on('error', () => {});
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

export interface CliResult {
  /** Exit code, or null when the process never started, or was killed. */
  code: number | null;
  /** Why it never started — a missing command, usually. Null when it ran. */
  spawnError: string | null;
}

/** Turns a spawn failure into something the person in front of it can act on. */
function describeSpawnError(err: NodeJS.ErrnoException): string {
  const command = err.path || 'the agent command';
  if (err.code === 'ENOENT') {
    return `could not find \`${command}\`. Install it, and make sure the shell that started the editor can see it — on macOS an app launched from the Dock never reads your shell profile, so starting VS Code from a terminal usually fixes this.`;
  }
  if (err.code === 'EACCES') {
    return `\`${command}\` is there but not executable (permission denied).`;
  }
  return `could not start \`${command}\`: ${err.message}`;
}

/**
 * Waits for a spawned CLI to finish.
 *
 * A command that does not exist does not exit — node reports it through an
 * `error` event with no exit code at all. So an adapter that only watched exit
 * codes turned a missing CLI into a turn that ended silently: the lane went
 * from running to idle and said nothing about why.
 */
export function exitPromise(child: ChildProcessWithoutNullStreams): Promise<CliResult> {
  return new Promise((resolve) => {
    child.on('error', (err: NodeJS.ErrnoException) =>
      resolve({ code: null, spawnError: describeSpawnError(err) }));
    child.on('close', (code) => resolve({ code, spawnError: null }));
  });
}
