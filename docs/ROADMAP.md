# Nemi roadmap

## v0 — "one machine, one session, live"

Written and building cleanly; not yet exercised end to end. The runtime checks are
deliberately deferred until there is headroom on the dev machine, so treat the boxes
below as "code complete", not "proven".

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
