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

- [ ] Multi-machine Brain (LAN/team server), auth token, invite by handle
- [ ] Memories pinned to files/commits, stale-note flagging via git
- [ ] Branch/worktree isolation per session (`nemi/session-<id>`)
- [ ] Files-touched tracking per lane; diff gutter in Mission Control
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
