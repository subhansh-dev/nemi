# Nemi

Multiplayer coding sessions for VS Code.

You and your teammates each run an AI coding agent under your own login. One shared
session per task. Everyone can watch every lane type, live.

Nemi is a VS Code extension plus a small local server called the Brain. The Brain holds
the shared state — sessions, lanes, plans, memory — and every connected editor subscribes
to it over a websocket. None of your code passes through the server. It stores metadata,
not diffs. When a lane runs an agent, that process spawns on the owner's machine, on the
owner's subscription, and the output streams out to everyone watching.

## Why does this exist

One person pairing with one agent is a solved problem. The messy part is a team where
five people each have their own chat window open and nobody knows what anyone else's
agent is doing, which files it is touching, or whose credit card is paying for the
tokens. Nemi makes the work legible: one task, one branch, one plan, visible lanes, and
a name attached to every turn before it runs.

## What you actually get

**Mission Control** — a sidebar with every live session. Task, status, who is in it,
plan progress, which lanes are currently running.

**Lanes** — one column per person inside a session. Your lane runs your agent under your
account. Teammates can watch it type, send it a prompt, or hit stop. Lane color follows
the owner, so you learn who is who without reading names.

**Plans** — a checklist per session, shared. Checkboxes move for everyone at once.

**Isolation** — a session can run in its own git worktree on a `nemi/<name>` branch,
so two sessions can never quietly edit the same files. Untick the box and it runs in
the folder you already have open.

**Files** — each lane reports the files its agent changed, folded into one list per
session. It is the fastest way to notice that two lanes are drifting into the same file.

**Brain** — shared memory in three flavors: decisions, gotchas, conventions. Add one from
the command palette (`Nemi: Add Brain Memory`), see them grouped in the sidebar. Pin one
to the file you have open and it gets flagged once that code moves on. Deliberately small.
This is not a notes app.

**Three agents** — Claude Code, Codex, OpenCode. Pick one per lane, switch whenever.
They sit side by side; nothing forces the team onto a single vendor.

## How a turn works

You type a prompt in your lane and hit Enter.

1. The extension spawns your provider's CLI. The prompt travels over stdin, never argv.
   Quoting bugs are undefeated and there is no reason to pick that fight.
2. stdout is parsed into text deltas. Each provider speaks a different event dialect, so
   the parsers are defensive on purpose.
3. Deltas are throttled to roughly 120ms and broadcast, so every connected window shows
   the reply as it is generated.
4. The provider's session id is stored on the lane, so the next prompt resumes the
   conversation instead of starting over.
5. Stop kills the process. The lane settles back to idle.

If a teammate prompts your lane, their message lands and your machine executes it. The
turn is attributed to them, and the lane header still shows which account is burning.

## Requirements

- VS Code 1.85 or newer
- Node 20 or newer
- At least one of `claude`, `codex`, or `opencode` on your PATH

## Install from source

```
git clone https://github.com/subhansh-dev/nemi.git
cd nemi
npm install
npm run build
```

Open the folder in VS Code and press F5. That launches an Extension Development Host
and the Nemi icon appears in the activity bar. The Brain starts itself on first use;
you never run it by hand. If you do want it standalone: `npm run brain`, port 4877.

## Commands

| Command | What it does |
| --- | --- |
| `Nemi: New Session` | title + task; creates the session and your lane |
| `Nemi: Open Session` | quick-pick a live session |
| `Nemi: Add Lane to Session` | another person/agent column |
| `Nemi: Add Brain Memory` | decision / gotcha / convention |
| `Nemi: Restart Local Brain` | kill and restart the server |

## Repo layout

```
shared/      protocol types + state reducer, imported by both sides
server/      the Brain — node:http + ws, persists to .nemi/state.json
extension/   the VS Code side: webviews, provider adapters, lane execution
docs/        architecture, features, roadmap, branding
```

The entire wire protocol is `shared/src/protocol.ts`. Two discriminated unions cover
every message that crosses the socket, and `hello` always ships the full state so a
client can render before any event arrives. The Brain does not know or care that a VS
Code extension is on the other end; anything that can open a websocket can be a client.

## What works today, honestly

Works: multiple windows sharing sessions, live lane streaming, per-lane provider
switching, memories, auto-start of the Brain, state surviving restarts, optional
worktree isolation per session, and token auth for a Brain that lives on the network.

Rough edges: no per-user accounts (the token is a single shared secret, and identity is
still just a username), no mid-turn steering, transcripts cap at 400 messages per lane,
and the adapter parsers carry fallback branches because provider event schemas shift
between releases.

Not built yet: viewer role, approval cards for gated actions, file-overlap warnings,
usage-limit handoffs. The order is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Configuration

Settings (VS Code):

| Setting | Default | Meaning |
| --- | --- | --- |
| `nemi.port` | 4877 | Port for the local Brain |
| `nemi.brainUrl` | *(empty)* | Join a Brain someone else runs, e.g. `ws://10.0.0.5:4877` |
| `nemi.token` | *(empty)* | Shared secret when the Brain requires one |

Environment variables (standalone `npm run brain`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEMI_PORT` | 4877 | Port to listen on |
| `NEMI_HOST` | 127.0.0.1 | Address to bind; anything non-loopback **requires** a token |
| `NEMI_TOKEN` | *(empty)* | Shared secret clients must present |

`GET /health` answers liveness and stays open. `GET /api/state` needs the bearer token
when one is set, which is handy for debugging with curl.

## License

MIT. See [LICENSE](LICENSE).
