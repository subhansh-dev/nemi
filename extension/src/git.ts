import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** True when `dir` is inside a git working tree. */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Turns a session title into a filesystem- and branch-safe slug. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'session';
}

export interface Worktree {
  path: string;
  branch: string;
}

/**
 * Creates an isolated worktree at `.nemi/worktrees/<slug>` on a fresh
 * `nemi/<slug>` branch, starting from the current HEAD. Throws when the
 * directory or branch already exists; callers decide how to recover.
 */
export async function createWorktree(repoDir: string, slug: string): Promise<Worktree> {
  const branch = `nemi/${slug}`;
  const worktreePath = path.join(repoDir, '.nemi', 'worktrees', slug);
  if (fs.existsSync(worktreePath)) {
    throw new Error(`a worktree already exists at .nemi/worktrees/${slug}`);
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await run('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoDir });
  return { path: worktreePath, branch };
}
