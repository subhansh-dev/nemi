import * as vscode from 'vscode';

const BASE_CSS = `
:root {
  --abyss: #0B1F2A; --deep: #12303F; --card: #16394B;
  --teal: #2DD4BF; --coral: #FF7E67; --mist: #E6F2F3; --fog: #8FACB3;
  --border: rgba(45, 212, 191, 0.14);
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  background: var(--abyss); color: var(--mist);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: 13px;
}
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.head h1 { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0; color: var(--teal); font-weight: 600; flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fog); display: inline-block; }
.dot.live { background: var(--teal); box-shadow: 0 0 6px var(--teal); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; }
.pill.live { background: rgba(45,212,191,.16); color: var(--teal); }
.pill.done { background: rgba(143,172,179,.16); color: var(--fog); }
.pill.awaiting-takeover { background: rgba(255,126,103,.18); color: var(--coral); }
button {
  background: var(--card); color: var(--mist); border: 1px solid var(--border);
  border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px;
}
button:hover { border-color: var(--teal); color: var(--teal); }
button.primary { background: rgba(45,212,191,.14); color: var(--teal); border-color: rgba(45,212,191,.4); }
.empty { color: var(--fog); padding: 28px 16px; text-align: center; line-height: 1.6; }
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
