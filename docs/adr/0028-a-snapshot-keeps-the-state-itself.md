# 0028 — A snapshot keeps the state itself, not a copy

## Status

Accepted.

## Context

The Rollback session snapshots the Match after every Tick it simulates, including every Tick a Rollback re-simulates, and `snapshot()` used to deep-copy the whole state, and `restore()` copy it again. A Duel's state is small, but a Battle's holds the Crowd (every Soldier's place, speed, HP, Squad and the rest) and the Fighter Pool, so the copy, and the garbage it left, became about 30% of an online Battle's CPU in the melee (a CPU profile of a three-Player Battle at 200 a side). In a playtest, three Players' Battle became unplayable once Soldiers were promoted. Promoted Fighters make each Tick cost more, and almost every frame Rolls back, since a human's aim changes every Tick.

The state was already treated as immutable: its types are `readonly` throughout, and each step builds the next state rather than changing the one it was given. Frozen deep, a Battle state stepped through its march and melee, with its AIs deciding from it, without a single write.

## Decision

- **`snapshot(state)` keeps `state` and `restore(snap)` returns it.** Nothing is copied. A step never changes the state it is given, so a kept state stays as it was, and a Rollback re-simulates from it as before.
- **States are immutable once snapshotted.** That is a rule for every reader: the sim, the AIs, the session, the renderer, the HUD, the audio. Code that steps its own state in place (the editor bench's Crowd prototype) takes a real copy with `deepCopy`.
- **Development and the tests enforce it.** Under `import.meta.env.DEV` (the dev server and Vitest) `snapshot()` deep-freezes the state, walking only what is not frozen yet (what a step carried over unchanged already is), so a write to a kept state throws where it happens. The production build never freezes; `VITE_SNAPSHOT_FREEZE=0` turns it off in development too, to time what production costs.

## Consequences

- In a headless three-Player Battle at full size (`src/net/cpuProbe.slow.test.ts`, freezing off as in production) a guest's frame fell from 4.1 ms to 2.7 to 3.2 ms on average over runs (p95 10.3 to 7.2 to 8.3), with the same Rollbacks, the same states and the same hashes.
- Freezing walks about as much of each new state as the copy did, so the dev server and the tests run about as fast as before; only the production build is faster.
- A code change that writes to a state it was handed now fails every test that snapshots it, where before it would have rewritten a Rollback's snapshot and shown up only as a desync between peers. In production it would still be a desync, so the tests and the dev build are the guard.
- `restore()` hands back the very object the snapshot holds. A caller that wants a state to change in place must `deepCopy` it first.
