import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { portFromEnv, type NemiState } from '@nemi/shared';
import { Store } from './store';
import { Hub } from './hub';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const port = Number(argValue('--port')) || portFromEnv(process.env);
const dir = path.resolve(argValue('--dir') ?? process.cwd());
const stateFile = path.join(dir, '.nemi', 'state.json');

const store = new Store(stateFile);
const hub = new Hub(store);

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: 'nemi-brain', version: '0.0.1' }));
    return;
  }
  if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.get() satisfies NemiState));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({ server });
wss.on('connection', (socket) => hub.handleConnection(socket));

server.listen(port, '127.0.0.1', () => {
  console.log(`[brain] Nemi Brain listening on http://127.0.0.1:${port}`);
  console.log(`[brain] state file: ${stateFile}`);
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
