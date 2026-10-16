# Nemi roadmap

## v0 — "one machine, one session, live" (current)

- [x] Repo scaffold, protocol, docs
- [ ] Brain server: sessions, lanes, presence, memories, persistence
- [ ] Mission Control sidebar (live session cards)
- [ ] Session view: lane columns, shared plan, streaming responses
- [ ] Agent adapters: Claude Code, Codex, OpenCode (stdin dispatch, streaming)
- [ ] Brain view: shared memories
- [ ] Auto-start Brain from the extension

## v1 — "shared for real"

- [x] Auth token (`--token` / `NEMI_TOKEN`) and network binding (`--host` / `NEMI_HOST`),
      with non-loopback binds refused unless a token is set
- [x] Branch/worktree isolation per session (`nemi/<slug>` under `.nemi/worktrees/`)
- [x] Invite by handle / member roster (entries created ahead of a teammate joining)
- [x] Copy-invite command that writes the join settings and the Brain start command
- [x] Memories pinned to files and commits, with advisory stale flagging via git
- [x] Files-touched tracking per lane, aggregated per session and shown in the panel
- [x] Diff gutter in Mission Control (change volume per isolated session worktree)
- [ ] .vsix packaging + marketplace-style install

## v2 — "steering and safety"

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
