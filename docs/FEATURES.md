# Features

What Nemi does today, and what it does not. Updated as things land.

## Sessions

A session is one task. It owns:

- a title and a task description
- a plan (shared checklist)
- a set of lanes
- a status: `live`, `awaiting-takeover`, or `done`

Created from Mission Control (`Nemi: New Session`). The creator automatically gets a
lane of their own.

## Lanes

A lane is one person's column inside a session.

- Owned by exactly one member. The agent runs on their machine, under their account.
- Each lane carries a provider: `claude`, `codex`, or `opencode`. Switchable at any
  time, including mid-session.
- One turn at a time per lane. The next prompt resumes the provider conversation via
  its stored session id.
- Output streams as deltas, so every connected client renders the reply live.
- Stop kills the local process; the lane returns to idle.
- Transcripts are capped at 400 messages per lane, oldest dropped first.

Prompting someone else's lane is allowed. The turn is attributed to you and their
machine executes it under their account; every agent message shows its sponsor.

## Providers

| Provider | Invocation | Streaming | Resume |
| --- | --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json --verbose --permission-mode acceptEdits` | stream-json events | `--resume <id>` |
| Codex | `codex exec --json` | JSONL items (defensive parser) | `codex exec resume <id> --json` |
| OpenCode | `opencode run --format json --auto` | JSON parts | `--session <id>` |

All three receive the prompt over stdin.

Permission posture for v0: agents launch in modes that let them actually edit files
without a human approving every tool call. Approval cards (per-action consent,
enforced on the executing machine) are on the roadmap; until they exist, treat a lane
like you would treat any agent with write access to your working tree.

## Presence

Members appear in Mission Control: a roster of everyone added, plus a colored dot
wherever they act inside a session. Identity comes from the name sent in `identify` —
the `nemi.userName` setting, falling back to the operating-system username — so
reconnects keep the same id and color, and a person's color follows them everywhere.

`Nemi: Add Teammate to Roster` creates an entry before they ever connect, so they show
up dimmed and light up on arrival. `Nemi: Copy Invite to Clipboard` writes the
`nemi.brainUrl`, `nemi.token` and handle they need, plus the command to start a Brain if
nothing is listening yet. A roster entry links to a person only when they connect under
the handle you added: there are no accounts here, only names. That is cosmetic identity,
not authentication — see Security below.

## Brain memories

Three kinds: `decision`, `gotcha`, `convention`. Stored in the Brain's state file,
listed in the sidebar tree, removable from the context menu.

A memory can be **pinned** to a workspace-relative file. Creating one while a file is
open offers the pin and records the current HEAD with it. Clients that have the repo
then check, once per memory, whether that file was touched by any commit since — if it
was, the entry is marked `changed` in the sidebar and its tooltip says so. Clients
without the repo just show the note. The check is advisory: a rebased-away commit or a
missing file reads as "unknown", never as "stale".

## Persistence and fail-open

State lives in `.nemi/state.json` next to the workspace, written atomically with a
250ms debounce. If the Brain is unreachable, lanes keep working solo and the
extension reconnects on its own. Coordination enhances the work; it never blocks it.

## Isolation

A session can run in its own git worktree instead of the folder you have open:

- worktree lives at `.nemi/worktrees/<slug>` (git-ignored, like the rest of `.nemi/`)
- branch is `nemi/<slug>`, cut from the current HEAD
- every lane in that session runs with the worktree as its working directory

Machines that never created the worktree simply fall back to the folder they have
open, so a teammate joining an isolated session is never blocked. Deleting a session
does not touch git — merging or discarding the branch stays your call.

## Files touched

Each adapter recognises the file mutations its provider reports — write, edit, and
similar tool calls — and sends the paths to the Brain when the turn ends. The Brain
merges them into the lane and into the session, deduplicated and capped (200 per lane,
400 per session, oldest dropped first). Session panels list the most recent twelve as
chips with the full path on hover; Mission Control shows the count per session.

Paths are *reported*, not *watched*: a file changed by a shell command an agent ran, or
by you, does not appear. It is a coordination hint, not an audit log.

Isolated sessions also get a **diff gutter** on their Mission Control card: the
uncommitted change volume of that session's worktree (`+insertions −deletions`, files
changed), measured locally by the client that has the worktree and refreshed at most
every few seconds. Sessions sharing the open folder show nothing, because every card
would report the same numbers and mean nothing by it. The count covers tracked files
only — `git diff` does not see untracked ones.

## Security

The Brain binds to `127.0.0.1` by default and needs no secret there. Bind it to a
network address and it refuses to start unless you supply a token:

```sh
npm run brain -- --host 0.0.0.0 --token "$(openssl rand -hex 24)"
```

Clients present the token in `identify`; `/api/state` accepts it as a bearer token.
`/health` stays open so probes keep working. There are no per-user accounts yet — the
token is one shared secret and identity is still just a username, so treat a shared
Brain as roughly trusted-network software until per-user auth lands.
