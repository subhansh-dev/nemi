import fs from 'node:fs';
import path from 'node:path';
import type { NemiState } from '@nemi/shared';

const EMPTY: NemiState = { users: {}, sessions: {}, lanes: {}, memories: [] };

/**
 * In-memory state with debounced, atomic JSON persistence.
 * Local-first: the file lives next to the workspace, nothing phones home.
 */
export class Store {
  private state: NemiState = structuredClone(EMPTY);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<NemiState>;
      this.state = {
        users: parsed.users ?? {},
        sessions: parsed.sessions ?? {},
        lanes: parsed.lanes ?? {},
        memories: parsed.memories ?? [],
      };
      // Everyone was disconnected when the process died.
      for (const u of Object.values(this.state.users)) {
        u.connected = false;
      }
    } catch {
      // First run or unreadable file — start fresh, never crash the Brain.
      this.state = structuredClone(EMPTY);
    }
  }

  get(): NemiState {
    return this.state;
  }

  /** Persist at most every 250ms; writes are atomic (tmp + rename). */
  schedulePersist(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 250);
    this.timer.unref();
  }

  flush(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[brain] persist failed:', err);
    }
  }
}
