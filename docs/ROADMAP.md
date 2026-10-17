# Nemi roadmap

## v0 — "one machine, one session, live"

The server side is exercised end to end now: `npm run smoke` starts a real Brain
against a throwaway directory and drives it with real websocket clients. It covers the
protocol, routing, the client reducer, persistence across a restart, token auth, the
network-bind guard, the git helpers, the outbox, the agent adapters against stand-in
CLIs, and the exact minified bundle the `.vsix` ships, plus the theme's contrast
arithmetic (168 assertions, all green). Still unproven: how the webviews actually
paint, and a live turn against the installed CLIs with a real model behind them — both
need a machine with room for an editor and a node agent at the same time.

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

## House style (complete)

- [x] One shared palette for all three webviews, replacing the original teal-on-navy
      look with a near-black, warm-neutral surface stack and a single muted brass
      accent: no neon, no glow, status colours desaturated, tighter type and spacing
- [x] Muted member palette (eight hues, no saturates). The old set was chosen against
      a bright background and reads as neon on black
- [x] `scripts/check-ui.mjs` — undefined `var(--token)`s, unbalanced stylesheets, and
      WCAG AA contrast for every readable colour and every member hue, compositing
      translucent fills over their backdrop. It found `--alert` at 4.61:1 on its own
      pill: legal, but one nudge from failing, so the hue was lightened
- [x] `npm run ui:preview` writes a static page assembled from the real stylesheets, so
      the theme can be reviewed without launching an editor (which matters on a 4 GB
      machine)
- [x] Fixed a latent bug the rewrite walked past: `border-color: var(--border)55` was
      appending an alpha suffix to a custom property. That is not valid CSS, so the
      declaration was dropped and lane chips quietly drew their border in the inherited
      text colour instead of the owner's

## Portability

- [x] The three adapters only ever reported an error for a non-zero exit code, but a
      command that cannot be found never exits: node delivers it as a spawn `error` with
      no code at all. So where the agent was not on the PATH — the usual macOS case,
      since an app launched from the Dock never reads your shell profile — the lane went
      from running to idle and said nothing about why. `exitPromise` now returns the
      spawn failure too, and the message names the command and the likely cause
- [x] A lane's failure is drawn, not merely stored. The reason was already in the state,
      on the wire, and in the reducer; nothing had ever rendered it. The session panel
      shows it where the agent stopped, and Mission Control flags it on the card
- [x] Feed-prompt hardening: writing into a CLI whose stdin a failed spawn had already
      torn down would have surfaced as an unhandled stream error
- [x] Audited the rest instead of assuming, since "should work on your Mac" is not an
      answer to give someone: `spawnCli` already used a shell only on Windows, the agent
      suite already wrote both a `.cmd` shim and an executable POSIX one, the git helpers
      never assumed a path separator, and the hooks already carried the executable bit in
      the index. All four were checked, none needed changing
- [ ] A per-provider CLI path override in settings, for when PATH games are not enough

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
