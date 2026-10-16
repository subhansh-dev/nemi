# Nemi

This folder is the editor half of Nemi. The [project README](../README.md) explains
what Nemi is and why it exists; this file covers installing the thing.

## Install from a build

```sh
npm install
npm run package:vsix        # writes nemi-<version>.vsix at the repo root
```

Then pick **Extensions → ⋯ → Install from VSIX…** in VS Code, or:

```sh
code --install-extension nemi-0.0.1.vsix
```

The package carries the Brain inside it, so the first run starts a local one on port
4877 with no further setup. To join a Brain someone else runs, set `nemi.brainUrl` and
`nemi.token` in your settings.

## First run

1. Click the Nemi icon in the activity bar. Mission Control appears.
2. Run **Nemi: New Session** — a title, then the task.
3. Your lane starts with the agent you pick. Claude Code, Codex and OpenCode must
   already be installed and on your `PATH`; Nemi drives them, it does not bundle them.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `nemi.port` | 4877 | Port for the local Brain |
| `nemi.brainUrl` | *(empty)* | Join a Brain someone else runs, e.g. `ws://10.0.0.5:4877` |
| `nemi.token` | *(empty)* | Shared secret when the Brain requires one |
| `nemi.userName` | *(OS username)* | The name teammates see, and the handle an invite matches on |
