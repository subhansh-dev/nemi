# Nemi roadmap

## v0 — "one machine, one session, live"

The server side is exercised end to end now: `npm run smoke` starts a real Brain
against a throwaway directory and drives it with real websocket clients. It covers the
protocol, routing, the client reducer, persistence across a restart, token auth, the
network-bind guard, the git helpers, the outbox, the agent adapters against stand-in
CLIs, and the exact minified bundle the `.vsix` ships (129 assertions, all green).
Still unproven: the VS Code window itself (webview rendering) and a live turn against
the installed CLIs with a real model behind them — both need a machine with room for
an editor and a node agent at the same time.

- [x] Repo scaffold, protocol, docs
- [x] Brain server: sessions, lanes, presence, memories, persistence
- [x] Mission Control sidebar (live session cards)
- [x] Session view: lane columns, shared plan, streaming responses
- [x] Agent adapters: Claude Code, Codex, OpenCode (stdin dispatch, streaming)
- [x] Brain view: shared memories
- [x] Auto-start Brain from the extension

## v1 — "shared for real" (complete)

- [x] Auth token (`--token` / `NEMI_TOKEN`) and network binding (`--host` / `NEMI_HOST`),
      with non-loopback binds refused unless a token is set
- [x] Branch/worktree isolation per session (`nemi/<slug>` under `.nemi/worktrees/`)
- [x] Invite by handle / member roster (entries created ahead of a teammate joining)
- [x] Copy-invite command that writes the join settings and the Brain start command
- [x] Memories pinned to files and commits, with advisory stale flagging via git
- [x] Files-touched tracking per lane, aggregated per session and shown in the panel
- [x] Diff gutter in Mission Control (change volume per isolated session worktree)
- [x] Taking a session down (command and a card affordance): the protocol, the Brain
      and the reducer all handled `session.remove`, but nothing could actually send it,
      so sessions were permanent
- [x] `npm run smoke`: end-to-end checks for the Brain, the client reducer, the git
      helpers, the agent adapters and the packaged bundle — and the four bugs it turned
      up on the way (a client never adopting the world in `hello`, an isolated lane
      being handed an empty worktree in a repository with no commits, actions dropped
      silently while the socket was down, and an OpenCode parser reading `session_id`
      where current builds emit `sessionID`, so those lanes could never resume)
- [x] .vsix packaging, self-contained (the Brain ships inside the package)
- [ ] Publishing it somewhere: needs a publisher account, a PNG icon and a version bump

## v2 — "steering and safety" (current)

- [ ] Mid-turn steering (append guidance to a running lane)
- [ ] Take over a stalled turn, resume on your account
- [ ] Approval cards for gated actions, enforced on the executing machine
- [ ] Overlap warnings when two lanes touch the same files
- [ ] Usage-limit → awaiting-takeover state machine

## v3 — "scale out"

- [ ] Parallel subagents in isolated Git worktrees, integrate-back checks
- [ ] Viewer/commenter roles, read-only watching
- [ ] Transcript retention + secret redaction
- [ ] Git shadow-ref snapshot sync to your own remote
- [ ] Non-VS Code clients on the open Brain protocol
