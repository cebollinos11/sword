# 0008 — The Throwing Dagger is a simulated projectile; a Block stops it by rule

## Status

Accepted

## Context

A Fighter who turns and runs gets away: everyone walks at the same speed, so a chaser never closes the gap. A Throwing Dagger gives the chaser an answer: a Hit Staggers and Slows the runner. The Simulation has no projectiles yet, and the dagger has to live inside the deterministic Tick (ADR 0001) so that Rollback and AI-on-both-peers (ADR 0005) keep working. The questions are how it flies and connects, and how a Block stops it.

## Decision

A thrown dagger is part of the Simulation state (`SimState.daggers`). It is launched on the first Tick of the Throw's Release from the thrower's solved left hand, aimed along the thrower's `facing` and `pitch` plus a small loft, and flies under gravity with fixed-order, semi-implicit Euler steps. Each Tick, before gravity, it homes: its velocity turns toward the nearest living enemy inside a cone ahead of it (`dagger.homingCone`, `dagger.homingRange`) by at most `dagger.homingTurn` degrees a second, at the same speed. Homing reads only the Fighters' state, so it adds nothing to the dagger's own state. Each Tick the segment from its last position to its new one is swept against Hit Zones, in the style of the Blade Sweep (ADR 0002). It stops at a Wall or Walk Surface, at the first Fighter it reaches, or after a fixed number of Ticks. It passes through its thrower and the thrower's teammates, and ignores Weapon capsules.

A dagger that reaches a Fighter is Blocked by rule, not by geometry, as in ADR 0002: the Fighter must be in a Block in any Direction, roughly face the thrower, and have raised that Block on or after the Tick the throw's Wind-up started. A Block already held before the thrower pressed the key does not count, so the defender has to react to the throw. A Knockdown guard does not Block daggers. Otherwise the dagger Hits: damage by Hit Zone, a Stagger (except on a Fighter in Knockdown) and a Slow.

## Consequences

- Flight and contact are physical and deterministic, so both peers (and a Rollback re-simulation) see the same dagger. The Slow and the dagger count are plain state, hashed and sent with the rest.
- Blocking a dagger is readable and fair: it cannot fail because of an IK quirk or a gap in a sweep. Tuning a Block Motion never changes whether a dagger is stopped.
- The "raised after the Wind-up started" clause is what keeps a permanent Block from making daggers useless; it asks the defender to see the Wind-up and answer it.
- A Blocked dagger simply disappears: no ricochet to simulate.
- A future dagger that can be parried by blade-on-blade geometry would be a separate concept, not a change to Block.
