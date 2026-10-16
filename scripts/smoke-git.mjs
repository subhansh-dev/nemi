/**
 * Smoke test for the extension's git helpers.
 *
 * These helpers run inside the user's repository, where a mistake is
 * expensive: an isolated lane pointed at an empty directory, or Nemi's own
 * bookkeeping turning up in `git status`. So this bundles the real
 * `extension/src/git.ts` with esbuild — not a copy of it — and drives it
 * against throwaway repositories in the temp directory.
 *
 *   npm run smoke
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'nemi-git-smoke-'));

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

/** Runs git in `cwd`, returning stdout. Throws on a non-zero exit. */
async function git(cwd, ...args) {
  const { stdout } = await run('git', args, { cwd });
  return stdout;
}

try {
  section('the real helpers load');
  const bundle = path.join(scratch, 'git.mjs');
  await build({
    entryPoints: [path.join(root, 'extension', 'src', 'git.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: bundle,
    logLevel: 'silent',
  });
  const gitHelpers = await import(pathToFileURL(bundle).href);
  check('extension/src/git.ts bundles and imports', typeof gitHelpers.createWorktree === 'function');

  section('titles become safe slugs');
  check(
    'punctuation and case fold away',
    gitHelpers.slugify('Auth Refactor!! (v2)') === 'auth-refactor-v2',
    gitHelpers.slugify('Auth Refactor!! (v2)'),
  );
  check('an empty title still yields a name', gitHelpers.slugify('   ') === 'session');
  check('long titles are capped', gitHelpers.slugify('x'.repeat(80)).length === 40);

  section('outside a repository');
  const outside = path.join(scratch, 'not-a-repo');
  mkdirSync(outside, { recursive: true });
  check('isGitRepo says no', (await gitHelpers.isGitRepo(outside)) === false);
  check('headCommit says nothing', (await gitHelpers.headCommit(outside)) === null);
  check('diffStat says nothing', (await gitHelpers.diffStat(outside)) === null);
  check(
    'a memory pin is never called stale',
    (await gitHelpers.fileChangedSince(outside, 'abc1234', 'a.txt')) === false,
  );
  check('and there is nothing to exclude', (await gitHelpers.ensureNemiExcluded(outside)) === false);

  section('a repository with no commits yet');
  const repo = path.join(scratch, 'repo');
  mkdirSync(repo, { recursive: true });
  await git(repo, 'init', '-q');
  await git(repo, 'config', 'user.email', 'smoke@example.com');
  await git(repo, 'config', 'user.name', 'Smoke');
  writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
  mkdirSync(path.join(repo, 'src'));
  writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const app = 1;\n');
  await git(repo, 'add', '-A');
  check('isGitRepo says yes', (await gitHelpers.isGitRepo(repo)) === true);
  check('headCommit is empty before the first commit', (await gitHelpers.headCommit(repo)) === null);
  let refusal = null;
  try {
    await gitHelpers.createWorktree(repo, 'early');
  } catch (err) {
    refusal = err.message;
  }
  check('isolation is refused rather than silently empty', refusal !== null, refusal ?? 'it was created');
  check('the refusal explains itself', /no commits yet/.test(refusal ?? ''), refusal ?? '');
  check(
    'and no orphan directory is left behind',
    !existsSync(path.join(repo, '.nemi', 'worktrees', 'early')),
  );

  section('after the first commit');
  await git(repo, 'commit', '-qm', 'first');
  const head = await gitHelpers.headCommit(repo);
  check('headCommit resolves', typeof head === 'string' && head.length === 40);
  const worktree = await gitHelpers.createWorktree(repo, 'auth-refactor');
  const wtPath = worktree.path;
  check('the isolated worktree holds the project', existsSync(path.join(wtPath, 'src', 'app.ts')));
  check('it starts on a nemi branch', worktree.branch === 'nemi/auth-refactor', worktree.branch);
  const branches = await git(repo, 'branch', '--format=%(refname:short)');
  check('the branch exists in the repository', branches.includes('nemi/auth-refactor'));
  const listed = await git(repo, 'worktree', 'list');
  check('git knows about the worktree', listed.includes('nemi/auth-refactor'));
  check(
    'it starts from the same commit as the main tree',
    (await git(wtPath, 'rev-parse', 'HEAD')).trim() === head.trim(),
  );
  let duplicate = null;
  try {
    await gitHelpers.createWorktree(repo, 'auth-refactor');
  } catch (err) {
    duplicate = err.message;
  }
  check('a second worktree on the same slug is refused', duplicate !== null, duplicate ?? 'it was created');
  const afterWorktree = await git(repo, 'status', '--porcelain');
  check(
    'the worktree does not turn up as untracked',
    afterWorktree.trim() === '',
    afterWorktree.trim(),
  );

  section("keeping .nemi/ out of the user's way");
  const fresh = path.join(scratch, 'fresh-repo');
  mkdirSync(fresh, { recursive: true });
  await git(fresh, 'init', '-q');
  await git(fresh, 'config', 'user.email', 'smoke@example.com');
  await git(fresh, 'config', 'user.name', 'Smoke');
  writeFileSync(path.join(fresh, 'readme.md'), 'hello\n');
  await git(fresh, 'add', '-A');
  await git(fresh, 'commit', '-qm', 'first');
  mkdirSync(path.join(fresh, '.nemi'), { recursive: true });
  writeFileSync(path.join(fresh, '.nemi', 'state.json'), '{}\n');
  const dirtyStatus = await git(fresh, 'status', '--porcelain');
  check('.nemi/ would otherwise show as untracked', dirtyStatus.includes('.nemi'), dirtyStatus.trim());
  check('the exclusion is added', (await gitHelpers.ensureNemiExcluded(fresh)) === true);
  const cleanStatus = await git(fresh, 'status', '--porcelain');
  check('.nemi/ disappears from status', !cleanStatus.includes('.nemi'), cleanStatus.trim());
  check(
    'the entry lives in .git/info/exclude',
    readFileSync(path.join(fresh, '.git', 'info', 'exclude'), 'utf8').includes('.nemi/'),
  );
  check('the tracked .gitignore is left alone', !existsSync(path.join(fresh, '.gitignore')));
  check('adding it twice changes nothing', (await gitHelpers.ensureNemiExcluded(fresh)) === false);

  section('uncommitted change volume');
  check('a clean worktree reports nothing', (await gitHelpers.diffStat(wtPath)) === null);
  writeFileSync(path.join(wtPath, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  const stat = await gitHelpers.diffStat(wtPath);
  check('edits are counted', stat?.files === 1 && stat?.insertions === 2 && stat?.deletions === 0, JSON.stringify(stat));
  writeFileSync(path.join(wtPath, 'brand-new.ts'), 'export const fresh = 1;\n');
  const untrackedStat = await gitHelpers.diffStat(wtPath);
  check(
    'a brand-new untracked file is not yet counted',
    untrackedStat?.files === 1,
    JSON.stringify(untrackedStat),
  );
  await git(wtPath, 'add', 'brand-new.ts');
  const stagedStat = await gitHelpers.diffStat(wtPath);
  check('once added, it is counted', stagedStat?.files === 2, JSON.stringify(stagedStat));

  section('memory pins and staleness');
  const pin = await gitHelpers.headCommit(wtPath);
  await git(wtPath, 'add', '-A');
  await git(wtPath, 'commit', '-qm', 'touch a');
  check('a file a later commit touched reads as changed', await gitHelpers.fileChangedSince(wtPath, pin, 'a.txt'));
  check(
    'a file nobody touched does not read as stale',
    (await gitHelpers.fileChangedSince(wtPath, pin, 'src/app.ts')) === false,
  );
  check(
    'an unknown commit is never called stale',
    (await gitHelpers.fileChangedSince(wtPath, `${pin.slice(0, 7)}0000`, 'a.txt')) === false,
  );
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
