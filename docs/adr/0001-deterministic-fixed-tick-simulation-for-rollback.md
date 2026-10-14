# 0001 — Deterministic fixed-tick simulation, built for rollback

## Status

Accepted

## Context

Hits are decided physically by the Blade Sweep, and the Blade Sweep comes out of procedurally solved Motions. So Motion is simulation, not decoration. Player vs Player runs peer-to-peer over PeerJS with no server, and melee duels are very sensitive to latency.

Alternatives considered:

- **Host-authoritative**: simple, but the guest feels lag on every Attack and Block.
- **Lockstep with input delay**: fair, but adds 50–100 ms to every input.
- **Rollback (GGPO-style)**: best feel, but needs a deterministic simulation that is cheap to snapshot.

## Decision

The combat simulation runs at a fixed Tick rate, separate from rendering. It is a pure function of (previous state, both Fighters' Intents, Tuning Data), and its state can be snapshotted and restored. Motion is solved with Pose Keys plus IK inside the Tick, never with a physics engine or with render-time animation. Rollback itself is implemented in the Player vs Player phase, but every system is written to these constraints from day one.

## Consequences

- No `Math.random()`, wall-clock time or render state inside the simulation; randomness comes from a seeded generator held in the state.
- AI vs AI and the Editor get frame-stepping, scrubbing and replays (just Intents) for free.
- JavaScript floating point is not guaranteed identical across browsers. We use ordinary float math rather than fixed-point (which would make IK and trig painful), and peers exchange a periodic state checksum; on divergence the host's state wins and the guest resyncs. Revisit only if divergence shows up in practice.
- Both peers must hold identical Tuning Data, checked by hash when they connect.
