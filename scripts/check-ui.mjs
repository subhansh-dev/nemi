/**
 * Guards the webview theme without opening a browser.
 *
 * The webviews are styled by hand-written CSS strings, and a CSS custom
 * property is the worst kind of typo: rename one and nothing crashes — the
 * declaration is silently dropped and the text falls back to whatever it
 * inherited. Contrast fails the same way, quietly. So this suite reads the
 * real sources and holds three lines:
 *
 *   1. every `var(--token)` used anywhere resolves in the shared theme;
 *   2. every colour a person has to *read* clears WCAG AA (4.5:1) against the
 *      surface it sits on, compositing translucent fills over their backdrop;
 *   3. the member palette stays legible on the near-black page.
 *
 *   node scripts/check-ui.mjs
 *   node scripts/check-ui.mjs --preview .nemi/ui-preview.html
 *
 * With `--preview` it also writes a static page assembled from the same
 * extracted CSS, so the theme can be judged in a browser when no editor is
 * running (and on a 4 GB machine, launching one just to look is wasteful).
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'extension', 'src');
const THEME_FILE = path.join(SRC, 'views', 'html.ts');
const BOARD_FILE = path.join(SRC, 'views', 'missionControl.ts');
const SESSION_FILE = path.join(SRC, 'views', 'sessionView.ts');
const CONSTANTS_FILE = path.join(root, 'shared', 'src', 'constants.ts');
/** Backdrops a translucent colour can end up sitting on. */
const BACKDROPS = ['--page', '--surface', '--raised'];
/** Minimum contrast for body-sized text, per WCAG 2.1 AA. */
const AA = 4.5;

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

/* ------------------------------- sources -------------------------------- */

/** Every file under `dir`, so the scan cannot miss a view someone adds. */
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Pulls `const NAME = \`...\`;` out of a TypeScript source. */
function cssBlock(file, name) {
  const match = readFileSync(file, 'utf8').match(
    new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`),
  );
  if (!match) {
    throw new Error(`could not find ${name} in ${file}`);
  }
  return match[1];
}

const theme = cssBlock(THEME_FILE, 'BASE_CSS');
const boardCss = cssBlock(BOARD_FILE, 'CSS');
const sessionCss = cssBlock(SESSION_FILE, 'CSS');

/* -------------------------------- colour -------------------------------- */

/** `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()/rgba()` into channel numbers. */
function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length === 3
      ? hex[1].split('').map((c) => c + c).join('')
      : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = value.match(
    /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i,
  );
  if (!rgb) {
    return null;
  }
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: rgb[4] === undefined ? 1 : Number(rgb[4]),
  };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }) {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** `fg` painted at its own alpha over an opaque `bg`. */
function over(fg, bg) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/* -------------------------------- theme --------------------------------- */

const tokens = new Map();
for (const [, name, value] of theme.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  tokens.set(name, value.trim());
}

const colors = new Map();
for (const [name, value] of tokens) {
  const parsed = parseColor(value);
  if (parsed) {
    colors.set(name, parsed);
  }
}

section('theme');
check(
  'the theme defines a colour and text token set',
  colors.size >= 15,
  `${colors.size} colour tokens`,
);
check(
  'every backdrop a translucent fill can sit on is defined',
  BACKDROPS.every((token) => colors.has(token) && colors.get(token).a === 1),
);

/* ------------------------- unresolved references ------------------------ */

const sources = walk(SRC).filter((file) => file.endsWith('.ts'));
const used = new Map();
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const [, name] of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!used.has(name)) {
      used.set(name, []);
    }
    used.get(name).push(path.relative(root, file));
  }
}

check(
  'the scan actually read the webview sources',
  used.size >= 15,
  `saw ${used.size} distinct tokens in ${sources.length} files`,
);

const missing = [...used.keys()]
  .filter((name) => !tokens.has(name) && !name.startsWith('--vscode-'))
  .sort();
check(
  'every var(--token) used by a view resolves in the theme',
  missing.length === 0,
  missing.length ? `undefined: ${missing.join(', ')}` : '',
);
// VS Code injects its own `--vscode-*` set into every webview; those are the
// one namespace the theme is allowed to lean on without defining.
const editorTokens = [...used.keys()].filter((name) => name.startsWith('--vscode-'));
check(
  'the theme leans on the editor only for typography',
  editorTokens.every((name) => name === '--vscode-font-family'),
  editorTokens.filter((name) => name !== '--vscode-font-family').join(', '),
);

const stray = [...tokens.keys()]
  .filter((name) => name.startsWith('--') && !used.has(name) && !name.startsWith('--vscode'))
  .sort();
check(
  'the theme carries no unused tokens',
  stray.length === 0,
  stray.length ? `unused: ${stray.join(', ')}` : '',
);

/* ------------------------------- contrast ------------------------------- */

/**
 * Worst contrast for `fg` sitting on `bg`, where `bg` may be translucent and
 * therefore inherit whichever backdrop happens to be behind it.
 */
function contrast(fgToken, bgToken) {
  const fg = colors.get(fgToken);
  const bg = colors.get(bgToken);
  return Math.min(
    ...BACKDROPS.map((backdrop) => ratio(fg, over(bg, colors.get(backdrop)))),
  );
}

/** Text token against the surface it is actually rendered on. */
const PAIRS = [
  ['--text', '--page'],
  ['--text', '--surface'],
  ['--text', '--raised'],
  ['--muted', '--page'],
  ['--muted', '--surface'],
  ['--muted', '--raised'],
  ['--accent', '--page'],
  ['--accent', '--accent-weak'],
  ['--ok', '--page'],
  ['--ok', '--ok-weak'],
  ['--alert', '--page'],
  ['--alert', '--alert-weak'],
];

section('contrast (WCAG AA needs 4.5:1)');
for (const [fg, bg] of PAIRS) {
  const value = contrast(fg, bg);
  check(`${fg} on ${bg} clears AA (${round(value)}:1)`, value >= AA, `${round(value)}:1`);}

/* ------------------------------ stylesheets ----------------------------- */

// A missing `}` in a hand-written stylesheet does not error; it quietly
// swallows every rule after it. Cheap to catch here, invisible in a webview.
section('stylesheets');
for (const [name, css] of [
  ['theme', theme],
  ['mission control', boardCss],
  ['session', sessionCss],
]) {
  const open = (css.match(/\{/g) ?? []).length;
  const close = (css.match(/\}/g) ?? []).length;
  check(
    `${name} stylesheet is brace-balanced`,
    open > 0 && open === close,
    `${open} { vs ${close} }`,
  );
}

/* ------------------------------- failures ------------------------------- */

// A lane's failure reason is data until something renders it. It used to be
// stored, persisted, broadcast, and never shown — so a lane could stop dead
// and the UI would say nothing. The webviews are template strings, so the only
// mechanical guard available is that the field is actually read where the two
// views draw. Cheap, and it catches the deletion of exactly that line.
section('failure reporting');
const sessionSrc = readFileSync(path.join(SRC, 'webview', 'session.ts'), 'utf8');
const boardSrc = readFileSync(path.join(SRC, 'webview', 'board.ts'), 'utf8');
const countOf = (text, needle) => text.split(needle).length - 1;
check(
  'the session panel renders a failed lane\u2019s reason',
  countOf(sessionSrc, 'lastError') >= 2,
  `${countOf(sessionSrc, 'lastError')} references`,
);
check(
  'mission control flags a failed lane',
  countOf(boardSrc, 'lastError') >= 1,
  `${countOf(boardSrc, 'lastError')} references`,
);

/* --------------------------- member palette ----------------------------- */

const paletteSource = readFileSync(CONSTANTS_FILE, 'utf8');
const paletteBlock = paletteSource.match(/LANE_COLORS = \[([\s\S]*?)\]/);
const palette = paletteBlock
  ? [...paletteBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];

section('member palette');
check(
  'eight lanes get eight colours',
  palette.length === 8,
  `${palette.length} found`,
);
check(
  'no two members ever share a colour',
  new Set(palette.map((c) => c.toLowerCase())).size === palette.length,
);
for (const hex of palette) {
  const color = parseColor(hex);
  const value = color ? ratio(color, over(colors.get('--page'), colors.get('--page'))) : 0;
  check(`${hex} stays legible on the black page`, value >= AA, `${round(value)}:1`);
}

/* ------------------------------- preview -------------------------------- */

const flag = process.argv.indexOf('--preview');
if (flag !== -1) {
  const target = path.resolve(root, process.argv[flag + 1] ?? '.nemi/ui-preview.html');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, previewHtml(), 'utf8');
  console.log(`\npreview written to ${target}`);
}

/**
 * A static page standing in for the two webviews, built from the CSS the
 * extension really ships. The trailing rules undo the panel layout (fixed
 * viewport height, horizontal lane rail) so both views can be seen at once.
 */
function previewHtml() {
  const swatches = palette
    .map((hex) => `<span class="udot" style="background:${hex}"></span>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Nemi — theme preview</title>
<style>
${theme}
${boardCss}
${sessionCss}
/* preview scaffolding only — not shipped */
body { display: block; height: auto; overflow: auto; padding: 22px; }
.wrap { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.pane { width: 340px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.pane.wide { width: 720px; }
.lanes { flex: none; height: 430px; }
.lane { max-width: none; }
.label { color: var(--muted); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; margin: 0 0 8px; }
.swatches { display: flex; gap: 6px; align-items: center; margin-top: 12px; }
</style>
</head>
<body>
<div class="wrap">

  <div>
    <p class="label">Mission Control</p>
    <div class="pane">
      <div class="head">
        <h1>Mission Control</h1>
        <span style="color:var(--muted);font-size:11px">Subhansh</span>
        <span class="dot live"></span>
      </div>
      <div class="roster">
        <span class="member"><span class="udot" style="background:#C7A87A"></span>Subhansh</span>
        <span class="member"><span class="udot" style="background:#9DBC8A"></span>Priya</span>
        <span class="member off"><span class="udot" style="background:#CC93A5"></span>Dana</span>
        <span class="member invite">+ invite</span>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="title">Rate limiter on the public API</span>
          <span style="flex:1"></span>
          <span class="kill">✕</span>
          <span class="pill live">live</span>
        </div>
        <div class="task">Add a token bucket in front of /v1/* and make the limits configurable per key.</div>
        <div class="chips">
          <span class="chip" style="border-color:#C7A87A55"><span style="color:#C7A87A">●</span>Subhansh · claude ▸</span>
          <span class="chip" style="border-color:#9DBC8A55"><span style="color:#9DBC8A">●</span>Priya · codex</span>
          <span class="chip">⎇ nemi/rate-limiter</span>
          <span class="chip"><span style="color:var(--ok)">+142</span> <span style="color:var(--alert)">−18</span> · 4 files</span>
          <span class="users"><span class="udot" style="background:#C7A87A"></span><span class="udot" style="background:#9DBC8A"></span></span>
        </div>
        <div class="progress"><div style="width:60%"></div></div>
        <div style="color:var(--muted);font-size:10.5px;margin-top:5px">plan 3/5 · 1 lane running</div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="title">Flaky login tests</span>
          <span style="flex:1"></span>
          <span class="pill awaiting-takeover">awaiting takeover</span>
        </div>
        <div class="task">The session-storage spec fails about one run in five on CI.</div>
        <div class="chips">
          <span class="chip" style="border-color:#B79CC855"><span style="color:#B79CC8">●</span>Dana · opencode</span>
          <span class="chip">2 files</span>
        </div>
      </div>
      <div style="padding:12px"><button class="primary" style="width:100%">+ New Session</button></div>
      <div class="swatches">${swatches}</div>
    </div>
  </div>

  <div>
    <p class="label">Session — two lanes, one yours</p>
    <div class="pane wide" style="height:640px;display:flex;flex-direction:column">
      <div class="head">
        <h1 id="title">Rate limiter on the public API</h1>
        <span class="pill done">⎇ nemi/rate-limiter</span>
        <span class="users"><span class="udot" style="background:#C7A87A"></span><span class="udot" style="background:#9DBC8A"></span></span>
        <span class="pill live">live</span>
      </div>
      <div id="plan">
        <div class="planbar">
          <strong style="color:var(--text);font-size:12px">Plan</strong>
          <span>1/3</span>
          <span style="flex:1"></span>
          <input placeholder="Add step…" style="background:var(--raised);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:3px 8px;font-size:11.5px;width:180px">
        </div>
        <label class="planitem done"><input type="checkbox" checked><span>Read the existing middleware</span></label>
        <label class="planitem"><input type="checkbox"><span>Land the token bucket</span></label>
      </div>
      <div id="files">
        <span style="color:var(--muted)">files touched</span>
        <span class="chip">src/api/limit.ts</span>
        <span class="chip">src/api/router.ts</span>
        <span class="chip">test/limit.spec.ts</span>
      </div>
      <div class="lanes">
        <div class="lane me">
          <div class="lanehead">
            <span class="udot" style="width:9px;height:9px;background:#C7A87A"></span>
            <span class="who">Subhansh (you)</span>
            <span style="flex:1"></span>
            <span class="spin"></span>
            <select class="provider"><option selected>Claude</option></select>
            <button class="iconbtn" title="Stop">✕</button>
          </div>
          <div class="msgs">
            <div class="bubble user"><div class="meta">prompt</div><span class="body">Put the limiter behind a flag so we can roll it back.</span></div>
            <div class="bubble agent"><div class="meta">claude</div><span class="body">Reading src/api/router.ts to find the middleware chain.

› Read</span></div>
            <div class="bubble agent" style="border-color:var(--alert-line);color:var(--alert)"><div class="meta">claude</div><span class="body">The flag helper does not exist yet — I will add it beside the config loader.</span></div>
          </div>
          <div class="composer">
            <textarea placeholder="Agent is working…"></textarea>
          </div>
        </div>
        <div class="lane">
          <div class="lanehead">
            <span class="udot" style="width:9px;height:9px;background:#9DBC8A"></span>
            <span class="who">Priya</span>
            <span style="flex:1"></span>
            <select class="provider"><option selected>Codex</option></select>
          </div>
          <div class="msgs">
            <div class="bubble user"><div class="meta">prompt · Priya</div><span class="body">Write the spec first.</span></div>
            <div class="bubble agent"><div class="meta">codex</div><span class="body">Drafted test/limit.spec.ts with the three cases you listed.</span></div>
            <div class="laneerror"><div class="meta">last turn failed</div><span class="body">could not find codex. Install it, and make sure the shell that started the editor can see it — on macOS an app launched from the Dock never reads your shell profile, so starting VS Code from a terminal usually fixes this.</span></div>
          </div>
          <div class="composer">
            <textarea disabled placeholder="Read-only — this is Priya’s lane."></textarea>
            <button class="primary" disabled>Send</button>
          </div>
        </div>
        <div class="lane" style="min-width:150px;max-width:150px;align-items:center;justify-content:center;border-style:dashed">
          <button class="iconbtn" style="font-size:20px">+</button>
          <div style="color:var(--muted);font-size:11px">add lane</div>
        </div>
      </div>
      <div style="padding:10px;border-top:1px solid var(--line);display:flex;gap:8px">
        <button>Cancel lane</button>
        <button class="primary">Send</button>
      </div>
    </div>
  </div>

</div>
</body>
</html>
`;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}
process.exit(failures.length ? 1 : 0);
