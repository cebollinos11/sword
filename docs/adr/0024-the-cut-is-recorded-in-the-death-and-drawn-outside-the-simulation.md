# 0024 — The cut is recorded in the Death and drawn outside the Simulation

## Status

Accepted.

## Context

A killing blow with a cutting Weapon should take the body apart where the blade really struck: an arm off at the forearm, a head off at the neck, a body in two at the waist (Dismemberment). Which parts come off, the split mesh and the falling pieces could all live in the Simulation, beside the Death. But the pieces never change an outcome: a fallen Fighter is no longer simulated, hits and is hit by nothing and blocks no one (Death). Simulating them would mean more state to hash, snapshot and send in a resync, Verlet physics inside the Tick, and a mesh split no peer could run in a Tick's budget.

The Death Ragdoll already answers the same question for the whole body (ADR 0001 and CONTEXT.md, Death Ragdoll): the Simulation records how a Fighter fell, and the fall is drawn from that record, a pure function of the Death and the pose it fell in, so Rollback, scrubbing and the Final Blow Shot all agree.

What the renderer cannot know by itself is the blade at the moment it struck. The Blade Sweep finds the contact between last Tick's blade and this Tick's, and only the Simulation holds both. Nor can it tell whether the blow cut: that depends on the attacker's Weapon on the felling Tick, and in a Run the Weapon a Fighter holds may change later (its Inventory).

## Decision

- The Simulation records the cut in the Death, nothing more. A blade Hit carries the blade at contact (last Tick's blade moved to this Tick's as far as the contact's moment in the Tick) and the unit direction the contact point was moving. When it is the felling blow, and it is an Overhead, Left or Right that landed with the Head of a Weapon that `cuts` (Tuning Data; false for the Sledge Hammer), its `DeathBlow` keeps them as `cut: { hilt, tip, travel }`.
- No cut for a Thrust, a Hit with the shaft behind the Head, a Throwing Dagger, a Kick, a Fall, Lava or Water. A blow without a cut has no `cut` key at all, so such a Death hashes and falls exactly as before.
- Everything else is render-only: which bones the cut severs, the Death Ragdoll in pieces, the split and capped mesh, the blood from the stumps. Each is a pure function of the Death and the pose it fell in, with no randomness, no wall-clock time and no state kept between frames.
- The cut is decided on the felling Tick, from the Weapon held then, never by the renderer later.

## Consequences

- The record is a few numbers in a Death that is already hashed, snapshotted and validated (`isDeath`), so both peers compute the same cut and checksums cover it with no new machinery.
- Every Hit event now carries the blade at contact; recorded per-Tick hashes that include the events (the AI golden test) change on every Hit Tick, though no outcome does.
- How a cut looks can be retuned (which bones it severs, how far it reaches, how pieces fly) without touching the Simulation, as long as it stays a pure function of the Death.
- Crowd Soldiers have no Death of this kind and keep their impostor death clip.
