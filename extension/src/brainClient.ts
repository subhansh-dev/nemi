import { EventEmitter } from 'node:events';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import {
  applyServerMessage,
  emptyState,
  type ClientMessage,
  type NemiState,
  type NemiUser,
  type ServerMessage,
} from '@nemi/shared';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface BrainOptions {
  /** Local port used when no remote Brain URL is configured. */
  port: number;
  /** Shared secret, when the Brain requires one. */
  token?: string;
  /** Connect to a remote Brain instead of starting a local one. */
  brainUrl?: string;
  /** Directory the local Brain keeps its state beside. */
  workspaceDir: string;
}

/**
 * Connection to the Brain: ensures the local server is running, keeps one
 * WebSocket alive with backoff, and maintains the extension's mirror of the
 * shared state. Fails open — reconnect attempts never block lane execution
 * locally beyond the initial start.
 */
export class BrainClient extends EventEmitter {
  readonly state: NemiState = emptyState();
  you: NemiUser | null = null;
  connected = false;

  private readonly port: number;
  private readonly token: string;
  private readonly brainUrl: string;
  private readonly workspaceDir: string;
  private ws: WebSocket | null = null;
  private brainProc: ChildProcess | null = null;
  private closed = false;

  constructor(options: BrainOptions) {
    super();
    this.port = options.port;
    this.token = options.token?.trim() ?? '';
    this.brainUrl = options.brainUrl?.trim() ?? '';
    this.workspaceDir = options.workspaceDir;
  }

  get isRemote(): boolean {
    return this.brainUrl !== '';
  }

  get wsUrl(): string {
    return this.brainUrl || `ws://127.0.0.1:${this.port}`;
  }

  /* ------------------------------ lifecycle ----------------------------- */

  async start(): Promise<void> {
    if (this.isRemote) {
      // Someone else runs the Brain; just connect.
      this.connect();
      return;
    }
    if (await this.health()) {
      this.connect();
      return;
    }
    await this.spawnBrain();
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      if (await this.health()) {
        this.connect();
        return;
      }
    }
    this.emit('fatal', new Error(`Nemi Brain did not answer on port ${this.port}`));
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.brainProc?.kill();
  }

  /** Restart the local Brain (or reconnect to a remote one) and re-join. */
  async restart(): Promise<void> {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    if (this.brainProc) {
      this.brainProc.kill();
      this.brainProc = null;
    }
    await sleep(400);
    this.closed = false;
    await this.start();
  }

  private httpBase(): string {
    if (!this.brainUrl) {
      return `http://127.0.0.1:${this.port}`;
    }
    return this.brainUrl.replace(/^ws/, 'http').replace(/\/+$/, '');
  }

  private health(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`${this.httpBase()}/health`, { timeout: 900 }, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private async spawnBrain(): Promise<void> {
    const here = __dirname; // <repo>/extension/dist
    // Dev layout: <repo>/extension/dist → <repo>/server/dist/index.js
    // Packaged layout keeps the Brain inside the extension directory.
    const candidates = [
      path.join(here, '..', '..', 'server', 'dist', 'index.js'),
      path.join(here, '..', 'server', 'dist', 'index.js'),
    ];
    const serverPath = candidates.find((p) => fs.existsSync(p));
    if (!serverPath) {
      throw new Error('Nemi Brain entry not found; run `npm run build` first.');
    }
    const args = [serverPath, '--port', String(this.port), '--dir', this.workspaceDir];
    if (this.token) {
      args.push('--token', this.token);
    }
    this.brainProc = spawn('node', args, {
      stdio: 'ignore',
      detached: false,
      windowsHide: true,
    });
    this.brainProc.on('error', (err) => this.emit('fatal', err));
  }

  /* ------------------------------- socket ------------------------------- */

  private connect(): void {
    if (this.closed) {
      return;
    }
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      const name = os.userInfo().username || process.env.USERNAME || 'guest';
      ws.send(
        JSON.stringify({
          type: 'identify',
          name,
          token: this.token || undefined,
        } satisfies ClientMessage),
      );
    });

    ws.on('message', (raw: Buffer) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString('utf8')) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        this.you = msg.you;
      }
      applyServerMessage(this.state, msg);
      if (msg.type === 'presence' || msg.type === 'hello') {
        this.connected = true;
        this.emit('connected', true);
      }
      this.emit('message', msg);
      this.emit('state');
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.connected = false;
      this.emit('connected', false);
      // 4003 = the Brain refused our token. Retrying would loop forever.
      if (code === 4003) {
        this.closed = true;
        this.emit(
          'fatal',
          new Error(
            `Brain rejected the connection (${reason.toString().trim() || 'unauthorized'}). ` +
              'Set the nemi.token setting to match the Brain, then run "Nemi: Restart Local Brain".',
          ),
        );
        return;
      }
      if (!this.closed) {
        setTimeout(() => this.connect(), 2000).unref();
      }
    });

    ws.on('error', () => {
      /* close handler drives reconnect */
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Disposable-style subscription, for wiring views. Prefer this over
   * EventEmitter.on so callers can push it straight into subscriptions.
   */
  sub(event: string, listener: (...args: any[]) => void): { dispose(): void } {
    this.on(event, listener);
    return { dispose: () => this.off(event, listener) };
  }
}
