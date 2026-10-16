/**
 * Smoke test for the three agent adapters.
 *
 * The adapters are the part of Nemi that talks to somebody else's CLI, and they
 * are the part most likely to rot: a provider renames an event field and every
 * lane quietly stops working. So this bundles the real adapters with esbuild and
 * runs them against stand-in CLIs — wrappers named `claude`, `codex` and
 * `opencode` that sit first on PATH, record the argv and stdin they were handed,
 * and replay recorded provider output.
 *
 * That checks two things at once: that the parser reads what the provider
 * actually emits, and that the prompt travels over stdin and never touches a
 * command line.
 *
 *   npm run smoke
 */
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'nemi-agents-'));
const binDir = path.join(scratch, 'bin');
const probeFile = path.join(scratch, 'probe.json');
const transcriptsFile = path.join(scratch, 'transcripts.json');
const agentCwd = path.join(scratch, 'work');

let passed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

/**
 * The prompt is deliberately hostile: shell metacharacters, quotes and unicode.
 * If any of it ever reached a command line, these scenarios would misbehave — 
 * which is exactly the point of sending prompts over stdin.
 */
const PROMPT = 'fix the "quoted" thing & echo $(whoami) | del /f /q * — 日本語 ✓';

/** What each stand-in CLI replays on stdout, shaped like the real thing. */
const TRANSCRIPTS = {
  claude: {
    code: 0,
    lines: [
      { type: 'system', subtype: 'init', session_id: 'claude-session-1', tools: ['Edit'] },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Hello from Claude' },
            { type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: 'src/app.ts' } },
          ],
        },
      },
      { type: 'result', subtype: 'success', is_error: false, result: 'Hello from Claude' },
    ],
  },
  codex: {
    code: 0,
    lines: [
      { type: 'thread.started', thread_id: 'codex-thread-1' },
      { type: 'item.completed', item: { type: 'agent_message', id: 'item_1', text: 'Hello from Codex' } },
      {
        type: 'item.completed',
        item: { type: 'command_execution', id: 'item_2', status: 'completed', command: 'ls -la' },
      },
      { type: 'item.completed', item: { type: 'file_change', id: 'item_3', changes: [{ path: 'src/lib.ts' }] } },
    ],
  },
  opencode: {
    code: 0,
    lines: [
      { type: 'step_start', timestamp: 1, sessionID: 'ses_opencode_1', part: { type: 'step-start' } },
      {
        type: 'text',
        timestamp: 2,
        sessionID: 'ses_opencode_1',
        part: { id: 'prt_1', type: 'text', text: 'Hello from OpenCode' },
      },
      {
        type: 'tool_use',
        timestamp: 3,
        sessionID: 'ses_opencode_1',
        part: {
          id: 'prt_2',
          type: 'tool',
          tool: 'edit',
          state: { status: 'completed', input: { filePath: 'src/ok.ts' } },
        },
      },
      { type: 'step_finish', timestamp: 4, sessionID: 'ses_opencode_1', part: { type: 'step-finish' } },
    ],
  },
  // A failed run: the reason is in the JSON payload, not on stderr.
  'opencode-error': {
    code: 1,
    lines: [
      { type: 'error', timestamp: 9, sessionID: 'ses_opencode_2', error: { type: 'unknown', message: 'model refused' } },
    ],
  },
};

/** The stand-in CLI: records what it was handed, then replays its transcript. */
const FAKE_CLI = `#!/usr/bin/env node
const fs = require('node:fs');
// The wrapper sets NEMI_FAKE to the provider name; the test can override the
// scenario with NEMI_SCENARIO to replay a different revision's output.
const scenario = process.env.NEMI_SCENARIO || process.env.NEMI_FAKE;
const transcripts = JSON.parse(fs.readFileSync(process.env.NEMI_TRANSCRIPTS, 'utf8'));
const transcript = transcripts[scenario];
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (stdin += chunk));
process.stdin.on('end', () => {
  fs.writeFileSync(
    process.env.NEMI_PROBE,
    JSON.stringify({ scenario, argv: process.argv.slice(2), stdin, cwd: process.cwd() }),
  );
  for (const line of transcript.lines) {
    process.stdout.write(JSON.stringify(line) + '\\n');
  }
  process.exit(transcript.code);
});
`;

/* --------------------------------- setup -------------------------------- */

/** Writes the wrappers that a shell resolves `claude`, `codex`, `opencode` to. */
function installFakeClis() {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(agentCwd, { recursive: true });
  writeFileSync(transcriptsFile, JSON.stringify(TRANSCRIPTS, null, 2));
  writeFileSync(path.join(binDir, 'fake-cli.js'), FAKE_CLI);
  for (const name of ['claude', 'codex', 'opencode']) {
    // Windows: a .cmd shim, which is what npm installs for these CLIs too.
    // %* matters: it forwards the adapter's flags, so the test can see them.
    writeFileSync(
      path.join(binDir, `${name}.cmd`),
      `@echo off\r\nset NEMI_FAKE=${name}\r\nnode "%~dp0fake-cli.js" %*\r\n`,
    );
    // POSIX: an executable shell script with the same behaviour.
    const shim = path.join(binDir, name);
    writeFileSync(
      shim,
      `#!/bin/sh\nNEMI_FAKE=${name} exec node "$(dirname "$0")/fake-cli.js" "$@"\n`,
    );
    try {
      chmodSync(shim, 0o755);
    } catch {
      /* Windows ignores the mode */
    }
  }
  // The suite runs on Windows, where the .cmd shims are what the shell finds.
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.NEMI_TRANSCRIPTS = transcriptsFile;
  process.env.NEMI_PROBE = probeFile;
}

/** Runs one adapter for a turn and returns the events it reported. */
async function turn(providerId, providers, { scenario, resumeId } = {}) {
  process.env.NEMI_SCENARIO = scenario ?? providerId;
  rmSync(probeFile, { force: true });
  const events = [];
  await providers[providerId].run({
    cwd: agentCwd,
    prompt: PROMPT,
    resumeId,
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });
  const probe = JSON.parse(readFileSync(probeFile, 'utf8'));
  return { events, probe };
}

function texts(events) {
  return events
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('');
}

function first(events, type) {
  return events.find((e) => e.type === type);
}

/* ---------------------------------- run ---------------------------------- */

try {
  section('the real adapters load');
  installFakeClis();
  const bundle = path.join(scratch, 'agents.cjs');
  await build({
    entryPoints: [path.join(root, 'extension', 'src', 'agents', 'index.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
  });
  const { PROVIDERS } = require(bundle);
  check('the adapter module bundles and imports', typeof PROVIDERS?.claude?.run === 'function');

  section('claude');
  const claude = await turn('claude', PROVIDERS);
  check('the session id is picked up', first(claude.events, 'session')?.id === 'claude-session-1');
  check('assistant text is streamed', texts(claude.events).includes('Hello from Claude'));
  check('tool use is announced', texts(claude.events).includes('› Edit'));
  check('the edited file is reported', first(claude.events, 'file')?.path === 'src/app.ts');
  check('no bogus errors were raised', claude.events.every((e) => e.type !== 'error'));

  section('codex');
  const codex = await turn('codex', PROVIDERS);
  check('the thread id is picked up', first(codex.events, 'session')?.id === 'codex-thread-1');
  check('agent messages are streamed', texts(codex.events).includes('Hello from Codex'));
  check('commands are announced', texts(codex.events).includes('› ls -la'));
  check('changed files are reported', first(codex.events, 'file')?.path === 'src/lib.ts');

  section('opencode');
  const opencode = await turn('opencode', PROVIDERS);
  check('the session id is picked up', first(opencode.events, 'session')?.id === 'ses_opencode_1');
  check('streamed text is picked up', texts(opencode.events).includes('Hello from OpenCode'));
  check('tool use is announced', texts(opencode.events).includes('› edit'));
  check('the touched file is reported', first(opencode.events, 'file')?.path === 'src/ok.ts');
  check('a clean run raises no error', opencode.events.every((e) => e.type !== 'error'));

  section('opencode without a session id is still readable');
  // Older snake_case builds must keep working.
  TRANSCRIPTS['opencode-legacy'] = {
    code: 0,
    lines: [
      { type: 'text', session_id: 'ses_legacy', part: { id: 'prt_9', type: 'text', text: 'legacy shape' } },
    ],
  };
  writeFileSync(transcriptsFile, JSON.stringify(TRANSCRIPTS, null, 2));
  const legacy = await turn('opencode', PROVIDERS, { scenario: 'opencode-legacy' });
  check('a snake_case session id still resumes', first(legacy.events, 'session')?.id === 'ses_legacy');
  check('its text still arrives', texts(legacy.events).includes('legacy shape'));

  section('a failed turn reports why');
  const failed = await turn('opencode', PROVIDERS, { scenario: 'opencode-error' });
  check('the provider message is surfaced', first(failed.events, 'error')?.message === 'model refused');
  check(
    'the error is reported once',
    failed.events.filter((e) => e.type === 'error').length === 1,
    `${failed.events.filter((e) => e.type === 'error').length} errors`,
  );

  section('resuming passes the id through');
  for (const [id, flag] of [
    ['claude', '--resume'],
    ['codex', 'resume'],
    ['opencode', '--session'],
  ]) {
    const resumed = await turn(id, PROVIDERS, { resumeId: 'session-xyz' });
    check(`${id} resumes its session`, resumed.probe.argv.includes('session-xyz'), resumed.probe.argv.join(' '));
    check(`${id} passes it behind ${flag}`, resumed.probe.argv.includes(flag), resumed.probe.argv.join(' '));
  }

  section('the prompt never touches a command line');
  for (const id of ['claude', 'codex', 'opencode']) {
    const { probe } = await turn(id, PROVIDERS);
    check(`${id} receives the prompt over stdin`, probe.stdin === PROMPT, JSON.stringify(probe.stdin));
    check(
      `${id} keeps it out of argv`,
      !probe.argv.some((arg) => arg.includes('quoted') || arg.includes('日本語')),
      probe.argv.join(' '),
    );
    check(`${id} runs in the lane's directory`, probe.cwd.toLowerCase() === agentCwd.toLowerCase(), probe.cwd);
  }
} catch (err) {
  failures.push(`unhandled: ${err.message}`);
  console.log(`\nunhandled error: ${err.stack}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}
process.exit(failures.length ? 1 : 0);
