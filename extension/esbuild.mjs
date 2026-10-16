import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
});

for (const view of ['board', 'session']) {
  await build({
    ...common,
    entryPoints: [`src/webview/${view}.ts`],
    outfile: `dist/webview/${view}.js`,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  });
}
