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
 * Makes sure `.nemi/` is ignored by this repository, without touching a single
 * tracked file. The entry goes into `.git/info/exclude` — the repository-local
 * ignore file — so the user's own `.gitignore` stays theirs and nothing Nemi
 * does ever shows up in a diff or an accidental commit. Returns true when the
 * file was changed, false when the exclusion was already there.
 */
export async function ensureNemiExcluded(repoDir: string): Promise<boolean> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: repoDir,
    });
    const reported = stdout.trim();
    if (!reported) {
      return false;
    }
    const excludePath = path.isAbsolute(reported) ? reported : path.join(repoDir, reported);
    let existing = '';
    try {
      existing = fs.readFileSync(excludePath, 'utf8');
    } catch {
      // No exclude file yet; one will be written below.
    }
    const already = existing
      .split(/\r?\n/)
      .some((line) => line.trim() === '.nemi/' || line.trim() === '.nemi');
    if (already) {
      return false;
    }
    const prefix = existing.length && !existing.endsWith('\n') ? '\n' : '';
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.appendFileSync(
      excludePath,
      `${prefix}\n# Nemi keeps its worktrees and metadata here.\n.nemi/\n`,
    );
    return true;
  } catch {
    // Not a repository, or git is unavailable. Lanes still run; the directory
    // simply shows up as untracked, which is where we started.
    return false;
  }
}

/**
 * Creates an isolated worktree at `.nemi/worktrees/<slug>` on a fresh
 * `nemi/<slug>` branch, starting from the current HEAD. Throws when the
 * directory or branch already exists, when there is no commit to branch from,
 * or when git refuses; callers decide how to recover.
 */
export async function createWorktree(repoDir: string, slug: string): Promise<Worktree> {
  const branch = `nemi/${slug}`;
  const worktreePath = path.join(repoDir, '.nemi', 'worktrees', slug);
  if (fs.existsSync(worktreePath)) {
    throw new Error(`a worktree already exists at .nemi/worktrees/${slug}`);
  }
  // On a repository with no commits, `git worktree add` does not fail — it
  // quietly produces an *orphan* worktree, an empty directory holding none of
  // the project. An agent dropped in there would be working on nothing at all,
  // so stop here and let the caller offer the working tree instead.
  if (!(await headCommit(repoDir))) {
    throw new Error(
      'this repository has no commits yet, so an isolated copy would start empty',
    );
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await ensureNemiExcluded(repoDir);
  await run('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoDir });
  return { path: worktreePath, branch };
}

/** Current HEAD, or null outside a repository (or before the first commit). */
export async function headCommit(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * True when `file` was touched by a commit after `commit`. Returns false when
 * the answer is unknown — a rebased-away commit, a missing file, no git at all.
 * A note is never marked stale on a guess.
 */
export async function fileChangedSince(
  dir: string,
  commit: string,
  file: string,
): Promise<boolean> {
  try {
    const { stdout } = await run('git', ['log', '--oneline', `${commit}..HEAD`, '--', file], {
      cwd: dir,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export interface DiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

/**
 * Uncommitted change volume in `dir`, or null when the tree is clean (or not a
 * repo). Tracked files only — `git diff` never counts untracked ones, so a
 * brand-new file appears only once it is added.
 */
export async function diffStat(dir: string): Promise<DiffStat | null> {
  try {
    const { stdout } = await run('git', ['diff', '--shortstat', 'HEAD'], { cwd: dir });
    const text = stdout.trim();
    if (!text) {
      return null;
    }
    const files = /(\d+) files? changed/.exec(text);
    const insertions = /(\d+) insertions?/.exec(text);
    const deletions = /(\d+) deletions?/.exec(text);
    return {
      files: files ? Number(files[1]) : 0,
      insertions: insertions ? Number(insertions[1]) : 0,
      deletions: deletions ? Number(deletions[1]) : 0,
    };
  } catch {
    return null;
  }
}
