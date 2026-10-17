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

**Roster** — add teammates by handle before they ever open the editor. They sit dimmed
in Mission Control and light up when they connect. One button copies the join details.

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

## Look and feel

Nemi draws its own chrome instead of borrowing a VS Code theme, so Mission Control,
session panels and the Brain tree look the same on every machine and in light or dark
editors alike. The palette is near-black and warm-neutral: layered surfaces (`#08080A`
page, `#101014` panel, `#17171C` raised), warm off-white text, and one muted brass
accent for the few things that should catch your eye. State colours are desaturated on
purpose — a running lane, a diff, a teammate's colour are meant to be read, not to
glow. Neon was never the point; the point is that after four hours in it your eyes
still work.

Member colours are muted too, and they follow a rule: all eight clear WCAG AA on the
black page, and no two members share one. Text tokens are held to the same bar, and
`scripts/check-ui.mjs` re-derives that arithmetic from the palette on every
`npm run smoke` — the theme is the one part of a UI a test can honestly cover. To look
at it without opening an editor:

```
npm run ui:preview     # writes .nemi/ui-preview.html from the real stylesheets
```

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

### Package it as a .vsix

```
npm run package:vsix
```

That builds every workspace, bundles the Brain into the extension, and writes
`nemi-0.0.1.vsix` at the repo root — about 50 KB. The package is self-contained: the
Brain travels inside it, so a fresh install starts a local one on port 4877 with no
extra setup. Install it with `code --install-extension nemi-0.0.1.vsix`, or through
**Extensions → ⋯ → Install from VSIX…**.

## Verifying it

```
npm run smoke
```

This is the honest answer to "does it actually work". It builds nothing you have to
trust: it starts a real Brain on port 4878 against a throwaway directory, drives it
with real websocket clients that apply the same reducer the extension uses, runs the
real git helpers against throwaway repositories, runs the real agent adapters against
stand-in CLIs, and re-derives the theme's contrast. 160 assertions across four suites.

`scripts/smoke.mjs` covers the Brain and the client: two clients seeing each other,
a session arriving with its creator's lane, prompting someone else's lane routing to
its owner, streamed deltas assembling into one agent message, files-touched landing
on the session, the roster, memory pins, state surviving a restart, token auth
refusing a wrong token with close code 4003, refusing to bind `0.0.0.0` without a
token, actions held while the Brain is away and delivered on rejoin, a session taken
down for everyone (lanes and transcript included), and the exact
minified bundle the `.vsix` ships starting up and speaking the protocol.

`scripts/smoke-git.mjs` bundles `extension/src/git.ts` with esbuild — the real module,
not a copy — and runs it against throwaway repositories: slug folding, refusing to
isolate a repository that has no commits yet (git would happily hand you an *empty*
worktree there), creating a worktree that holds your files and starts from your HEAD,
keeping `.nemi/` out of `git status` via `.git/info/exclude`, counting uncommitted
change volume, and never calling a memory pin stale on a guess.

`scripts/smoke-agents.mjs` is the one that guards against the CLIs moving under us. It
puts stand-in `claude`, `codex` and `opencode` wrappers first on `PATH`, records the
argv and stdin each adapter hands them, and replays recorded output shaped like each
provider's real stream. So it checks what the parsers read *and* the rule the whole
design rests on: the prompt travels over stdin, never on a command line. The test
prompt is deliberately hostile — quotes, `&`, `$(whoami)`, `del /f /q *`, CJK — and
the assertions confirm it arrives byte for byte over stdin with none of it in argv.
Provider flags were also checked against the installed CLIs' own `--help`.

That suite has already paid for itself. It caught a parser that read `session_id`
while current OpenCode builds stamp every event with `sessionID`, which meant OpenCode
lanes never learned their session and could never resume. Along with that fix came two
smaller ones there: failed runs now report the reason from the event payload instead
of just an exit code, and tool use is announced in the transcript like the other two
providers. The other bugs this exercise found are listed in `docs/ROADMAP.md`.

`scripts/check-ui.mjs` covers the part of a UI that can be checked without rendering
it, which is more than it sounds. The webviews are styled by hand-written CSS, where a
mistyped custom property is completely silent — the declaration is dropped and a label
inherits whatever colour was behind it. So this suite reads the real sources and
asserts that every `var(--token)` a view reaches for is defined, that each stylesheet
is brace-balanced, and that every colour meant to be read clears WCAG AA against the
surface it lands on, compositing the translucent fills over their backdrop first. The
member palette is held to the same bar. It caught `--alert` sitting at 4.61:1 on its
own pill — legal, but one nudge away from not being.

What it still does not cover: how the webviews actually paint (the theme's arithmetic
is checked, but nobody has watched it render), and a live turn against the installed
CLIs with a real model behind them. Those need a machine with room for an editor and a
node agent at once, so they stay manual.

## Commands

| Command | What it does |
| --- | --- |
| `Nemi: New Session` | title + task; creates the session and your lane |
| `Nemi: Open Session` | quick-pick a live session |
| `Nemi: Remove Session` | take a session down for everyone (asks first; a worktree on disk stays put) |
| `Nemi: Add Lane to Session` | another person/agent column |
| `Nemi: Add Brain Memory` | decision / gotcha / convention, optionally pinned to a file |
| `Nemi: Remove Memory` | drop a memory (also on the tree item) |
| `Nemi: Add Teammate to Roster` | add someone by handle before they ever connect |
| `Nemi: Copy Invite to Clipboard` | the settings a teammate needs to join |
| `Nemi: Restart Local Brain` | kill and restart the server |

## Repo layout

```
shared/      protocol types + state reducer, imported by both sides
server/      the Brain — node:http + ws, persists to .nemi/state.json
extension/   the VS Code side: webviews, provider adapters, lane execution
scripts/     the .vsix packer, the smoke suites and the theme checker
docs/        architecture, features, roadmap, branding
```

The entire wire protocol is `shared/src/protocol.ts`. Two discriminated unions cover
every message that crosses the socket, and `hello` always ships the full state so a
client can render before any event arrives. The Brain does not know or care that a VS
Code extension is on the other end; anything that can open a websocket can be a client.

## What works today, honestly

Works: multiple windows sharing sessions, live lane streaming, per-lane provider
switching, memories, a roster you can build before a teammate joins, auto-start of the
Brain, state surviving restarts, optional worktree isolation per session, token auth for
a Brain that lives on the network, and a self-contained `.vsix` that installs with the
Brain already inside it. Nemi keeps its own `.nemi/` directory out of your `git status`
without touching your tracked `.gitignore`, and anything you do while the socket is
briefly down is held and delivered when it comes back rather than dropped.

Rough edges: no per-user accounts (the token is a single shared secret, identity is
still just a name, and a roster entry only links to a person once they connect under
the handle you added), no mid-turn steering, transcripts cap at 400 messages per lane,
and the adapter parsers carry fallback branches because provider event schemas shift
between releases. The webviews also ignore your editor's colour theme on purpose, so
Nemi looks the same on every machine — which means a very light editor gets a very
dark sidebar. The editor-side path — how the webviews actually paint, and turns
against the real agent CLIs — is the part that has not been run yet.

Not built yet: viewer role, approval cards for gated actions, file-overlap warnings,
usage-limit handoffs. The order is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Configuration

Settings (VS Code):

| Setting | Default | Meaning |
| --- | --- | --- |
| `nemi.port` | 4877 | Port for the local Brain |
| `nemi.brainUrl` | *(empty)* | Join a Brain someone else runs, e.g. `ws://10.0.0.5:4877` |
| `nemi.token` | *(empty)* | Shared secret when the Brain requires one |
| `nemi.userName` | *(OS username)* | The name teammates see, and the handle an invite matches on |

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
