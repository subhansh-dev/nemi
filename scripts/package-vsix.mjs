/**
 * Packages the extension as a .vsix.
 *
 * Two things must be true before vsce runs:
 *
 *   1. every workspace is built (shared → server → extension), and
 *   2. the Brain ships inside the package, bundled into a single dependency-free
 *      file at extension/server/dist/index.js — which is where the extension
 *      looks for it when it starts a local Brain on a fresh install.
 *
 * All of this is local. Nothing here publishes, uploads, or touches the network.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const brainOut = path.join(extensionDir, 'server', 'dist');

/** npm and npx are .cmd shims on Windows, so those need a shell. */
function run(command, args, cwd = root) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

// 1. Build every workspace.
run('npm', ['run', 'build']);

// 2. Bundle the Brain into the extension so a fresh install can start one.
const esbuild = await import('esbuild');
rmSync(brainOut, { recursive: true, force: true });
mkdirSync(brainOut, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'server', 'src', 'index.ts')],
  outfile: path.join(brainOut, 'index.js'),
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'info',
  // ws reaches for these two native extras and works without them.
  external: ['bufferutil', 'utf-8-validate'],
});

// 3. Package, naming the artifact after the manifest version.
const pkg = JSON.parse(readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
const out = path.join(root, `nemi-${pkg.version}.vsix`);
rmSync(out, { force: true });
run(
  'npx',
  ['vsce', 'package', '--no-dependencies', '--out', out],
  extensionDir,
);

if (!existsSync(out)) {
  throw new Error('vsce finished without writing a package');
}
console.log(`\npackaged ${path.relative(root, out)}`);
