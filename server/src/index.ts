import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { portFromEnv, type NemiState } from '@nemi/shared';
import { timingSafeEqual } from './auth';
import { Store } from './store';
import { Hub } from './hub';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const port = Number(argValue('--port')) || portFromEnv(process.env);
const dir = path.resolve(argValue('--dir') ?? process.cwd());
const token = (argValue('--token') ?? process.env.NEMI_TOKEN ?? '').trim();
const host = (argValue('--host') ?? process.env.NEMI_HOST ?? '127.0.0.1').trim();

function isLoopback(h: string): boolean {
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

// A Brain that anything on the network can reach must require a secret.
// Refusing to start is friendlier than silently exposing a team's sessions.
if (!isLoopback(host) && !token) {
  console.error(
    `[brain] refusing to bind ${host} without a token. ` +
      'A Brain reachable from the network must require a shared secret: ' +
      'start with --token <secret> or set NEMI_TOKEN.',
  );
  process.exit(1);
}

const stateFile = path.join(dir, '.nemi', 'state.json');
const store = new Store(stateFile);
const hub = new Hub(store, token);

function requestToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? '';
}

function authorized(req: http.IncomingMessage): boolean {
  return token === '' || timingSafeEqual(requestToken(req), token);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        name: 'nemi-brain',
        version: '0.0.1',
        auth: token !== '',
      }),
    );
    return;
  }

  if (pathname === '/api/state') {
    if (!authorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.get() satisfies NemiState));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({ server });
wss.on('connection', (socket) => hub.handleConnection(socket));

server.listen(port, host, () => {
  console.log(`[brain] Nemi Brain listening on http://${host}:${port}`);
  console.log(`[brain] state file: ${stateFile}`);
  console.log(
    token
      ? '[brain] auth: token required for clients and /api/state'
      : '[brain] auth: disabled (loopback only)',
  );
});

function shutdown(): void {
  console.log('[brain] shutting down, flushing state…');
  store.flush();
  wss.close();
  server.close(() => process.exit(0));
  // Fallback if sockets keep the server alive.
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
