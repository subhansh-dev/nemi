# Nemi architecture

Nemi has three parts: a **coordination server** ("the Brain"), a **VS Code
extension**, and the **agent CLIs** that already live on each teammate's machine.

```
┌──────────────────────────┐      ┌──────────────────────────┐
│  VS Code + Nemi (you)    │      │  VS Code + Nemi (teammate)│
│  ┌────────────────────┐  │      │  ┌────────────────────┐  │
│  │ Mission Control    │  │      │  │ Mission Control    │  │
│  │ Session view/lanes │  │      │  │ Session view/lanes │  │
│  └─────────┬──────────┘  │      │  └─────────┬──────────┘  │
│  ┌─────────▼──────────┐  │      │  ┌─────────▼──────────┐  │
│  │ Agent adapters     │  │      │  │ Agent adapters     │  │
│  │ claude│codex│oc    │  │      │  │ claude│codex│oc    │  │
│  └─────────┬──────────┘  │      │  └─────────┬──────────┘  │
└────────────┼─────────────┘      └────────────┼─────────────┘
             │  WebSocket (relay, presence)    │
             └────────────► ◆ ◄────────────────┘
                      the Brain (server)
                 state in .nemi/state.json
```

## Design principles

1. **Local-first.** Code never leaves the machine that owns it. The Brain stores
   session metadata, plans, memories, lane transcripts and refs — not a repo copy.
   (Phase 2 syncs snapshots through Git shadow refs on your own remote.)
2. **Your agent, your account.** Every lane runs a CLI under the lane owner's
   login. A turn shows its payer before it dispatches. Nothing spends a
   teammate's subscription silently.
3. **Fail open.** If the Brain is unreachable, your lane keeps working solo and
   reconnects by itself. Coordination enhances; it never blocks.
4. **Ownership is human.** Work is assigned to people; agents execute it.

## The Brain (server)

- Node + TypeScript, `node:http` + `ws`. No framework.
- Holds: users/presence, sessions (task, branch, plan, status), lanes
  (transcript, provider, owner, state), brain memories, approvals (phase 2).
- Persists to `.nemi/state.json` next to the workspace (atomic write, debounced).
- Broadcasts typed events over one WebSocket per client (`shared/protocol.ts`).
- REST: `GET /health`, `GET /api/state` for cheap reads/debugging.
- Default port **4877** (`NEMI_PORT` overrides).

The extension auto-starts the Brain on activation if nothing answers `/health`,
so "it just works" with zero manual steps.

## The extension

- TypeScript, bundled with esbuild (one bundle for the extension host, one per
  webview).
- **Mission Control** — activity-bar sidebar: live session cards (task, status,
  participants, plan progress, lanes, files touched).
- **Session view** — editor panel per session: lane columns side by side, shared
  plan, composer, add-lane, cancel, take over.
- **Brain view** — sidebar tree of shared memories (decision / gotcha /
  convention), add/remove.
- **Agent adapters** — one module per provider. Turn execution model:
  - the client that owns a lane spawns its own provider CLI, non-interactively,
    prompt delivered over **stdin** (no shell-quoting hazards);
  - stdout is streamed back to the Brain as `lane.delta` events, so every
    participant watches the lane type in real time;
  - provider session/thread ids are stored per lane for conversation resume.

## Protocol (shared/protocol.ts)

All WebSocket messages are discriminated unions, versioned in one place:

- client → server: `identify`, `session.create/update/remove`, `lane.create`,
  `lane.message` (user prompt), `lane.delta` (owner streaming back),
  `lane.status`, `lane.cancel`, `brain.add/remove`
- server → client: `hello` (full state), `session.upsert`, `lane.upsert`,
  `lane.message`, `lane.delta`, `lane.status`, `brain.upsert/remove`, `presence`,
  `lane.execute` (directive to the owner client)

## Security posture (phase 2 backlog)

- Named approval cards for gated actions, enforced on the executing machine.
- Secret redaction before transcripts are persisted.
- Optional auth token for non-localhost Brain deployments.
- Transcript retention window.

## Deliberate non-goals (for now)

- No cloud sandbox: agents run where the humans do.
- No custom model: Nemi coordinates other people's CLIs.
- No repo hosting: Git stays where it is.
