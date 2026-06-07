# m3 2026 Roadmap — Deferred Tier C Items

This file tracks features surveyed during the 2026/06 project
review that did not ship in the same pass. Each item below is
a *deliberate deferral*, not a forgotten feature — the cost
/ risk / scope is documented so the next session can pick
them up without re-doing the discovery.

## Status as of 2026-06-07

- **Tier A (security fortress)** — shipped, 8 commits
- **Tier B (UX polish that compounds)** — shipped, 12 commits
- **Tier C (m3-only breakthroughs)** — Top 3 shipped, 4 deferred

## Shipped in this round

| Item | What it is | Commit |
|------|-----------|--------|
| C1   | Privacy-mode channel (account-scoped provider + localOnly guard) | 1064ecb |
| C2   | Cascade provider (local→cloud escalation)                  | 8d3bc7f |
| C3   | Cross-session memory store (~/.m3/memory/<project>.md)    | f986785 |

## Deferred

### C4 — Mobile Companion (PWA + WebSocket)

**Why deferred**: PWA shell is a separate webapp project (new
`apps/webchat-pwa/` or similar) with its own build / service
worker / manifest stack. The WS protocol side is mostly there
(`GatewayServer.wss` already accepts bearer-token auth; the
agent.stream envelope is defined in
`gateway-protocol/src/schema.ts`).

**Effort**: 2 weeks. Includes:
- PWA shell with manifest, service worker, install banner
- Reuse `m3 channels scan` QR flow for pairing
- A real mobile message-style card renderer (the current
  dashboard HTML is desktop-oriented)

**m3's edge over CC**: CC has no daemon, no WS protocol
surface; the user can't reach their session from a phone.

---

### C5 — Channel-routed sub-agents

**Why deferred**: The plumbing exists in the harness
(`phase2-harness.ts` exposes `spawnSubAgent`) but the
implementation is currently a prompt prefix rather than a
real isolated turn. Plus the dispatcher injection in
`MessagePipeline` would need to route sub-agent output to a
different `(channel, account, peer)` than the parent — which
is the whole point.

**Effort**: 2 weeks. Includes:
- Real `SubAgent` class with its own engine + session + tools
- `SubAgentSpawnOptions` extends with `channelId? / accountId? / peerId?`
- Dashboard card showing the sub-agent tree (parent → children
  → grandchildren) with live tool counts per node

**m3's edge over CC**: CC's `Task` tool is a CLI subprocess
with no cross-channel story; a sub-agent there is invisible
to anyone but the parent session.

---

### C6 — Background tasks with channel push

**Why deferred**: The `Bash` tool definition would need a
`run_in_background: true` arg. The gateway would need a
`runId` → in-flight task registry. The bridge would need to
subscribe to `run.complete` events and post to the source
channel via the channel's existing `outbound.send`. The
"push notification" half isn't hard once the registry exists;
the hard part is the LLM-side signature change.

**Effort**: 1 week.

**m3's edge over CC**: CC blocks the terminal during a long
Bash; the user can `Ctrl+B` to background but the only way
to see the result is to remember to come back. A phone push
is a 10x improvement for "I started a 20-minute pnpm test
and went for coffee."

---

### C7 — Project Memory Loader (CLAUDE.md / AGENTS.md auto-inject)

**Why deferred**: One-day feature, deferred because the value
is small until C3 (cross-session memory) ships — and C3
is in this round. Should be trivial to do next.

**Effort**: 1 day. Reads `./CLAUDE.md`, `./AGENTS.md`,
`./.claude/CLAUDE.md` on REPL startup, concatenates, injects
into `extraSystem` of `QueryLoopOptions`.

**m3's edge over CC**: CC reads `CLAUDE.md` but only at the
cwd; m3 can also read from `~/.m3/CLAUDE.md` (user-level) and
merge with project-level. (Not in CC.)

---

### C8 — Hook Executor (PreToolUse / PostToolUse shell hooks)

**Why deferred**: The hook config already lives in
`M3ConfigSchema.hooks` (typed `z.record(z.unknown()).optional()`)
but the executor is a no-op. Needs:
- A JSON loader for `~/.m3/hooks.json` shape
- A shell-spawn loop with exit-code interpretation (0=allow,
  2=block, anything else=warn) — borrowed from CC verbatim
- Hook firing points in `query-loop.ts` (before/after each
  `tool.execute`, on `user_prompt_submit`, on `stop`)

**Effort**: 1 week. The plumbing for the existing
`PermissionBridge` can be reused.

**m3's edge over CC**: Same hook surface, but m3 hooks can
also fire on `channel.inbound` (IM messages) and
`subagent.spawn` (when C5 lands).

---

## Why these were deferred vs. shipped

The Tier C items shipped (C1, C2, C3) all had one property in
common: the **whole implementation fit in one focused diff**
on infrastructure that was already in the codebase (the LLM
router for C2, the channel account schema for C1, the
session store for C3).

The deferred items each touch multiple subsystems (new
package or new protocol surface), need design decisions the
user should weigh in on (PWA distribution model for C4,
isolation model for C5, push-notification rate-limiting for
C6), and benefit from one or more of the deferred items
landing first (C5 enables C6; C3 enables C7; C5 enables C8's
sub-agent hook).

## Tracking

This file is the single source of truth for "what's left." The
plan file at `.claude/plans/delegated-orbiting-porcupine.md` is
the historical record of what was surveyed; the plan is not
updated as items ship — this ROADMAP is.
