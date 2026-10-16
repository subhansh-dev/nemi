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

Connected members appear in Mission Control and in session panels with a stable
color derived from their username. That is cosmetic identity, not authentication —
see Security below.

## Brain memories

Three kinds: `decision`, `gotcha`, `convention`. Stored in the Brain's state file,
listed in the sidebar tree, removable from the context menu. Free-floating for now;
pinning memories to files and commits is next.

## Persistence and fail-open

State lives in `.nemi/state.json` next to the workspace, written atomically with a
250ms debounce. If the Brain is unreachable, lanes keep working solo and the
extension reconnects on its own. Coordination enhances the work; it never blocks it.

## Security (current state)

The Brain binds to 127.0.0.1 and has no auth. That is acceptable for one machine and
not acceptable for a team server — a shared deployment needs the token auth from the
roadmap before it should see a network.
