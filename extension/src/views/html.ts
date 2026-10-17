import * as vscode from 'vscode';

/**
 * The one palette every webview shares.
 *
 * A near-black, warm-neutral theme: layered surfaces sink away from the
 * reader, one muted brass accent carries identity, and state colours (ok,
 * alert) stay desaturated so nothing glows at you. Text tokens are held to
 * WCAG AA against the surfaces they sit on — `scripts/check-ui.mjs` re-derives
 * that arithmetic from this block on every `npm run smoke`, so a "small"
 * colour tweak cannot quietly make a label unreadable.
 */
const BASE_CSS = `
:root {
  color-scheme: dark;
  --page: #08080A; --surface: #101014; --raised: #17171C; --raised-2: #1E1E24;
  --line: rgba(255,255,255,.075); --line-strong: rgba(255,255,255,.13);
  --text: #EDEAE4; --muted: #8E8B84;
  --accent: #C6A87C; --accent-weak: rgba(198,168,124,.12);
  --accent-edge: rgba(198,168,124,.22); --accent-line: rgba(198,168,124,.38);
  --ok: #8FA98F; --ok-weak: rgba(143,169,143,.14);
  --alert: #D4887A; --alert-weak: rgba(212,136,122,.15);
  --alert-line: rgba(212,136,122,.45);
  --radius: 10px;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  background: var(--page); color: var(--text);
  font-family: var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: 13px; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
::selection { background: var(--accent-weak); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.09); border: 3px solid transparent;
  background-clip: padding-box; border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.16); background-clip: padding-box; }
.head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.head h1 { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; margin: 0; color: var(--accent); font-weight: 600; flex: 1; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); display: inline-block; }
.dot.live { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-weak); }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.pill.live { background: var(--ok-weak); color: var(--ok); }
.pill.done { background: rgba(255,255,255,.05); color: var(--muted); }
.pill.awaiting-takeover { background: var(--alert-weak); color: var(--alert); }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); background: rgba(255,255,255,.02); }
button {
  background: var(--raised); color: var(--text); border: 1px solid var(--line);
  border-radius: 8px; padding: 6px 13px; cursor: pointer; font-size: 12px;
  font-family: inherit;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}
button:hover { background: var(--raised-2); border-color: var(--line-strong); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.primary { background: var(--accent-weak); color: var(--accent); border-color: var(--accent-line); font-weight: 600; }
button.primary:hover { background: rgba(198,168,124,.2); }
.empty { color: var(--muted); padding: 32px 18px; text-align: center; line-height: 1.7; }
`;

/** Shared HTML shell for every Nemi webview. */
export function htmlShell(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  script: string,
  body: string,
  extraCss = '',
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', script),
  );
  const nonce = Array.from({ length: 16 }, () =>
    Math.random().toString(36)[2]).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
${body}
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
