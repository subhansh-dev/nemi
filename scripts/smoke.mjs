/**
 * End-to-end smoke test for the Brain.
 *
 * Starts a real Brain on a spare port against a throwaway directory, drives it
 * with real WebSocket clients, and applies the same reducer the extension uses —
 * so this exercises the wire protocol, the hub's routing, and the client-side
 * mirror together. Nothing here is mocked.
 *
 *   npm run smoke
 *
 * Port 4878 by default (override with NEMI_SMOKE_PORT) and the working directory
 * is created and removed by the test, so it never touches your own .nemi state.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const { applyServerMessage, emptyState } = require('../shared/dist/index.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAIN = path.join(root, 'server', 'dist', 'index.js');
const PORT = Number(process.env.NEMI_SMOKE_PORT || 4878);
const dir = mkdtempSync(path.join(tmpdir(), 'nemi-smoke-'));
const stateFile = path.join(dir, '.nemi', 'state.json');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'nemi-smoke-bundle-'));
/** Child processes beyond the main Brain, killed on the way out. */
const extraProcs = [];
/** Native extras `ws` looks for and runs fine without. */
const bufferExternals = ['bufferutil', 'utf-8-validate'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bundles a workspace entry point so the test can drive the shipped code. */
async function bundleForTest(entry, name, format = 'cjs') {
  const outfile = path.join(bundleDir, name);
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    minify: true,
    platform: 'node',
    format,
    target: 'node20',
    logLevel: 'silent',
    // ws reaches for these two native extras and works without them.
    external: bufferExternals,
  });
  return outfile;
}

/** Polls `predicate` until it holds or the deadline passes. */
async function until(predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  return predicate();
}

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

/* ------------------------------- brain ---------------------------------- */

let brain = null;
let brainLog = { out: '', err: '' };

function startBrain({ token, extraArgs = [] } = {}) {
  const args = [BRAIN, '--port', String(PORT), '--dir', dir, ...extraArgs];
  if (token) {
    args.push('--token', token);
  }
  brainLog = { out: '', err: '' };
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => (brainLog.out += d.toString()));
  child.stderr.on('data', (d) => (brainLog.err += d.toString()));
  brain = child;
  return child;
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    const health = await fetchJson(`http://127.0.0.1:${PORT}/health`);
    if (health?.ok) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function stopBrain() {
  const child = brain;
  brain = null;
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
}

async function fetchJson(url, token) {
  try {
    const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
    let body;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (!body || typeof body !== 'object') {
      body = { value: body };
    }
    body.__status = res.status;
    return body;
  } catch {
    return null;
  }
}

/* ------------------------------- clients -------------------------------- */

/** A WebSocket client that mirrors the extension: raw socket + shared reducer. */
class Client {
  #waiters = new Set();

  constructor(name, port = PORT) {
    this.name = name;
    this.port = port;
    this.state = emptyState();
    this.you = null;
    this.msgs = [];
    this.closed = null;
  }

  async connect({ token, expectHello = true } = {}) {
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws = ws;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      this.msgs.push(msg);
      if (msg.type === 'hello') {
        this.you = msg.you;
      }
      // Deliberately ignore the return value, exactly like the extension does.
      applyServerMessage(this.state, msg);
      for (const waiter of [...this.#waiters]) {
        const hit = waiter.scan();
        if (hit) {
          waiter.settle(hit);
        }
      }
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    this.ws.send(JSON.stringify({ type: 'identify', name: this.name, token }));
    if (expectHello) {
      await this.waitFor((m) => m.type === 'hello', 'hello');
    }
    return this;
  }

  /** Resolves with the first message from `from` onward, or rejects on timeout. */
  waitFor(match, label, from = this.msgs.length, timeout = 5000) {
    const scan = () => this.msgs.slice(from).find(match);
    const hit = scan();
    if (hit) {
      return Promise.resolve(hit);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error(`timed out waiting for ${label}`));
      }, timeout);
      const waiter = {
        scan,
        settle: (msg) => {
          clearTimeout(timer);
          this.#waiters.delete(waiter);
          resolve(msg);
        },
      };
      this.#waiters.add(waiter);
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws?.close();
  }
}

/** Runs `action`, then waits for `match` to arrive at `target` — race-free. */
async function roundTrip(target, match, label, action) {
  const from = target.msgs.length;
  action();
  try {
    return await target.waitFor(match, label, from);
  } catch {
    return null;
  }
}

/* -------------------------------- the run -------------------------------- */

let alice = null;
let bob = null;

try {
  section('brain starts and answers');
  startBrain();
  check('the Brain comes up on the test port', await waitForHealth());
  const health = await fetchJson(`http://127.0.0.1:${PORT}/health`);
  check('health reports ok', health?.ok === true);
  check('health reports auth disabled by default', health?.auth === false);
  check('/api/state is readable without a token', (await fetchJson(`http://127.0.0.1:${PORT}/api/state`))?.__status === 200);

  section('two clients see each other');
  alice = await new Client('smoke-alice').connect();
  check('alice receives hello', alice.you?.name === 'smoke-alice');
  check('hello state reaches the client mirror', alice.state.users[alice.you.id]?.connected === true);

  const markAlicePresence = alice.msgs.length;
  bob = await new Client('smoke-bob').connect();
  const sawBob = await roundTrip(
    alice,
    (m) => m.type === 'presence' && m.users[bob.you.id],
    'bob appearing',
    () => {},
  );
  check('alice sees bob arrive in presence', !!sawBob);
  check('bob holds both identities', Object.keys(bob.state.users).length === 2);

  section('a session comes with its creator\'s lane');
  const sessionUpsert = await roundTrip(
    alice,
    (m) => m.type === 'session.upsert',
    'session.upsert',
    () => alice.send({ type: 'session.create', title: 'Smoke session', task: 'prove the wire works' }),
  );
  const sessionId = sessionUpsert?.session?.id;
  check('the creator sees the session', !!sessionId);
  check('the session carries one lane', sessionUpsert?.session?.laneIds?.length === 1);
  const laneUpsert = alice.msgs.find((m) => m.type === 'lane.upsert' && m.lane.sessionId === sessionId);
  const laneId = laneUpsert?.lane.id;
  check('the lane is broadcast', !!laneId);
  check('the lane belongs to the creator', laneUpsert?.lane.ownerId === alice.you.id);
  const bothSaw = await roundTrip(
    bob,
    (m) => m.type === 'session.upsert' && m.session.id === sessionId,
    'session on the other client',
    () => {},
  );
  check('the other client sees the session too', !!bothSaw && !!bob.state.sessions[sessionId]);

  section('the shared plan moves for everyone');
  bob.send({
    type: 'session.plan.set',
    id: sessionId,
    plan: [{ id: 'p1', text: 'ship it', done: false }],
  });
  const planSeen = await roundTrip(
    alice,
    (m) => m.type === 'session.upsert' && m.session.id === sessionId && m.session.plan.length === 1,
    'plan update',
    () => {},
  );
  check('a plan set by one client reaches the other', !!planSeen);

  section('prompting someone else\'s lane routes to its owner');
  const exec = await roundTrip(
    alice,
    (m) => m.type === 'lane.execute' && m.laneId === laneId,
    'lane.execute',
    () => bob.send({ type: 'lane.message', sessionId, laneId, content: 'say OK' }),
  );
  check('the lane owner receives lane.execute', !!exec);
  const echoed = await roundTrip(
    bob,
    (m) => m.type === 'lane.message' && m.laneId === laneId,
    'the echoed prompt',
    () => {},
  );
  check('the prompt is echoed to everyone', !!echoed);
  const prompt = bob.state.lanes[laneId].messages.find((m) => m.role === 'user');
  check('the prompt is attributed to its sender', prompt?.sponsorId === bob.you.id);
  check('the lane shows as running', alice.state.lanes[laneId].status === 'running');

  section('agent output streams and assembles');
  alice.send({ type: 'lane.delta', sessionId, laneId, text: 'hel' });
  const deltaSeen = await roundTrip(
    bob,
    (m) => m.type === 'lane.delta',
    'first delta',
    () => alice.send({ type: 'lane.delta', sessionId, laneId, text: 'lo' }),
  );
  check('deltas reach the other client', !!deltaSeen);
  await sleep(150);
  const agentMessages = bob.state.lanes[laneId].messages.filter((m) => m.role === 'agent');
  check('deltas assemble into one agent message', agentMessages.length === 1);
  check('the assembled text is complete', agentMessages[0]?.content === 'hello', `got "${agentMessages[0]?.content}"`);

  section('files touched and turn settlement');
  alice.send({ type: 'lane.files', laneId, files: ['src/a.ts', 'src/b.ts'] });
  const filesSeen = await roundTrip(
    bob,
    (m) => m.type === 'session.upsert' && m.session.filesTouched?.length === 2,
    'files touched',
    () => {},
  );
  check('files touched land on the session', !!filesSeen);
  alice.send({ type: 'lane.files', laneId, files: ['src/a.ts'] });
  await sleep(150);
  check('repeated paths are deduplicated', bob.state.sessions[sessionId].filesTouched.length === 2);
  const idle = await roundTrip(
    bob,
    (m) => m.type === 'lane.status' && m.status === 'idle',
    'idle',
    () => alice.send({ type: 'lane.status', laneId, status: 'idle' }),
  );
  check('the lane settles back to idle', !!idle);
  check(
    'the settled transcript keeps the streamed text',
    bob.state.lanes[laneId].messages.find((m) => m.role === 'agent')?.content === 'hello',
  );

  section('roster');
  alice.send({ type: 'member.add', handle: 'smoke-priya' });
  const priyaSeen = await roundTrip(
    bob,
    (m) => m.type === 'presence' && Object.values(m.users).some((u) => u.name === 'smoke-priya'),
    'roster entry',
    () => {},
  );
  check('a teammate can be added before they connect', !!priyaSeen);
  const priya = Object.values(bob.state.users).find((u) => u.name === 'smoke-priya');
  check('the roster entry is offline', priya?.connected === false);
  const priyaGone = await roundTrip(
    alice,
    (m) => m.type === 'presence' && !Object.values(m.users).some((u) => u.name === 'smoke-priya'),
    'roster removal',
    () => bob.send({ type: 'member.remove', id: priya.id }),
  );
  check('an offline teammate can be removed', !!priyaGone);
  bob.send({ type: 'member.remove', id: alice.you.id });
  await sleep(150);
  check('a connected member is not removable', !!bob.state.users[alice.you.id]);

  section('memories with pins');
  const memory = await roundTrip(
    bob,
    (m) => m.type === 'brain.upsert',
    'memory',
    () =>
      alice.send({
        type: 'brain.add',
        kind: 'gotcha',
        text: 'the wire is the contract',
        file: 'src/a.ts',
        commit: 'abc1234',
      }),
  );
  check('a memory arrives for everyone', !!memory);
  check('the pin survives the trip', memory?.memory?.file === 'src/a.ts' && memory?.memory?.commit === 'abc1234');
  const removed = await roundTrip(
    bob,
    (m) => m.type === 'brain.remove',
    'memory removal',
    () => alice.send({ type: 'brain.remove', id: memory.memory.id }),
  );
  check('a memory can be removed', !!removed && bob.state.memories.length === 0);

  section('a session can be taken down');
  const temporary = await roundTrip(
    alice,
    (m) => m.type === 'session.upsert' && m.session.title === 'temporary',
    'the temporary session',
    () => alice.send({ type: 'session.create', title: 'temporary', task: 'created only to be removed' }),
  );
  check('it arrives with a lane of its own', !!temporary && temporary.session.laneIds.length === 1);
  if (!temporary) {
    throw new Error('the temporary session never arrived');
  }
  const doomedId = temporary.session.id;
  const gone = await roundTrip(
    bob,
    (m) => m.type === 'session.remove' && m.id === doomedId,
    'the session to be removed',
    () => alice.send({ type: 'session.remove', id: doomedId }),
  );
  check('removing it from one client removes it for the others', !!gone);
  // The reducer runs just after waiters settle, and the sender's own copy only
  // updates when the broadcast comes back, so wait on state rather than arrival.
  const vanished = await until(
    () =>
      !alice.state.sessions[doomedId] &&
      !bob.state.sessions[doomedId] &&
      temporary.session.laneIds.every((id) => !alice.state.lanes[id] && !bob.state.lanes[id]),
    5000,
  );
  check('it is gone from every client', vanished && !bob.state.sessions[doomedId]);
  check(
    'its lanes went with it',
    temporary.session.laneIds.every((id) => !alice.state.lanes[id] && !bob.state.lanes[id]),
  );
  check('the session it was not asked to remove is untouched', !!bob.state.sessions[sessionId]);

  section('persistence survives a restart');
  await sleep(500); // let the debounced write land
  check('the state file is written', existsSync(stateFile));
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  check('the session is in the file', !!saved.sessions[sessionId]);
  check('the plan is in the file', saved.sessions[sessionId].plan.length === 1);
  check('files touched are in the file', saved.sessions[sessionId].filesTouched.length === 2);
  alice.close();
  bob.close();
  const allOffline = await until(() => {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      return Object.values(saved.users).every((u) => !u.connected);
    } catch {
      return false;
    }
  }, 4000);
  check('nobody is still marked connected after a clean exit', allOffline);

  await stopBrain();
  startBrain();
  check('the Brain comes back up', await waitForHealth());
  const carol = await new Client('smoke-carol').connect();
  check('a fresh client sees the surviving session', !!carol.state.sessions[sessionId]);
  check('the plan survived the restart', carol.state.sessions[sessionId]?.plan.length === 1);
  check(
    'the transcript survived the restart',
    carol.state.lanes[laneId]?.messages.some((m) => m.role === 'agent' && m.content === 'hello'),
  );
  carol.close();

  section('auth');
  await stopBrain();
  startBrain({ token: 'smoke-secret' });
  check('the Brain comes up requiring a token', await waitForHealth());
  const guardedHealth = await fetchJson(`http://127.0.0.1:${PORT}/health`);
  check('health stays open and says auth is on', guardedHealth?.auth === true);
  check('/api/state refuses without a token', (await fetchJson(`http://127.0.0.1:${PORT}/api/state`))?.__status === 401);
  check(
    '/api/state accepts the bearer token',
    (await fetchJson(`http://127.0.0.1:${PORT}/api/state`, 'smoke-secret'))?.__status === 200,
  );
  const intruder = new Client('smoke-intruder');
  try {
    await intruder.connect({ token: 'wrong', expectHello: false });
  } catch {
    /* expected to fail below */
  }
  await sleep(300);
  check('a wrong token is refused with 4003', intruder.closed?.code === 4003, `closed with ${intruder.closed?.code}`);
  check('a wrong token never gets hello', intruder.you === null);
  const authorized = await new Client('smoke-authorized').connect({ token: 'smoke-secret' });
  check('the right token gets hello', authorized.you?.name === 'smoke-authorized');
  authorized.close();

  section('actions typed while the brain is away are kept');
  const brainClientPath = await bundleForTest(
    path.join('extension', 'src', 'brainClient.ts'),
    'brainClient.cjs',
  );
  const { BrainClient } = require(brainClientPath);
  const offline = new BrainClient({ port: PORT, token: 'smoke-secret', workspaceDir: dir });
  let replayed = 0;
  offline.on('replayed', (n) => (replayed = n));
  offline.send({ type: 'lane.delta', sessionId, laneId, text: 'one ' });
  offline.send({ type: 'lane.delta', sessionId, laneId, text: 'two ' });
  offline.send({ type: 'lane.delta', sessionId, laneId, text: 'three' });
  offline.send({ type: 'session.create', title: 'queued while down', task: 'held in the outbox' });
  check('nothing leaves before a socket exists', offline.connected === false);
  await offline.start();
  const delivered = await until(() =>
    Object.values(offline.state.sessions).some((s) => s.title === 'queued while down'),
  );
  check('held actions are delivered on rejoin', delivered);
  check('streaming deltas coalesce into one message', replayed === 2, `replayed ${replayed}`);
  offline.stop();

  section('a network bind demands a token');
  const refused = spawn(process.execPath, [BRAIN, '--port', String(PORT), '--dir', dir, '--host', '0.0.0.0']);
  let refusedErr = '';
  refused.stderr.on('data', (d) => (refusedErr += d.toString()));
  const refusedCode = await new Promise((resolve) => refused.once('exit', resolve));
  check('binding 0.0.0.0 without a token exits non-zero', refusedCode !== 0, `exited with ${refusedCode}`);
  check('and says why', /refusing to bind/.test(refusedErr), refusedErr.trim() || '(no stderr)');

  section('the bundle the extension ships runs');
  const packagedDir = mkdtempSync(path.join(tmpdir(), 'nemi-packaged-'));
  const packagedEntry = await bundleForTest(path.join('server', 'src', 'index.ts'), 'brain.cjs');
  const packagedPort = PORT + 1;
  const packaged = spawn(
    process.execPath,
    [packagedEntry, '--port', String(packagedPort), '--dir', packagedDir],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  extraProcs.push(packaged);
  let packagedUp = false;
  for (let i = 0; i < 40 && packaged.exitCode === null; i++) {
    const health = await fetchJson(`http://127.0.0.1:${packagedPort}/health`);
    if (health?.ok) {
      packagedUp = true;
      break;
    }
    await sleep(250);
  }
  check('the minified Brain bundle starts up', packagedUp, `exited with ${packaged.exitCode}`);
  if (packagedUp) {
    const packagedClient = await new Client('smoke-packaged', packagedPort).connect();
    check('and speaks the same protocol', packagedClient.you?.name === 'smoke-packaged');
    packagedClient.close();
  }
  packaged.kill();
  await Promise.race([new Promise((resolve) => packaged.once('exit', resolve)), sleep(2000)]);
  rmSync(packagedDir, { recursive: true, force: true });
} catch (err) {
  failures.push(`unhandled: ${err.message}`);
  console.log(`\nunhandled error: ${err.stack}`);
} finally {
  await stopBrain();
  for (const proc of extraProcs) {
    proc.kill();
  }
  alice?.close();
  bob?.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(bundleDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}
if (brainLog.err.trim()) {
  console.log('\nbrain stderr:');
  console.log(brainLog.err.trim());
}
process.exit(failures.length ? 1 : 0);
