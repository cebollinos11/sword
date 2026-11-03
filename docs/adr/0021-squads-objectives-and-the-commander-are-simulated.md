# 0021 — Squads, Objectives and the Commander are simulated; destination fields are static and cached outside state

## Status

Proposed (2026-11-03, `docs/plans/battle-objectives.md`). Stage 1 built the Squads as decided here; the Objectives, Tickets and the Commander (Stages 2a and 2b) and the static destination fields (Stage 2a) are decided here and not built yet. Accepted when Stage 2a lands.

## Context

A Battle (ADR 0020) is two armies charging each other across an open field: one blob a side, steered by a flow field per Team that is rebuilt from the Soldiers' positions, ending in a Rout. We want squads moving in Formations, maps with Objectives the armies fight over, and a Commander per Team that sends Squads to them, so the Player does not have to be the tactician. Every peer must still reach the same state from the same Intents and roll back up to 15 Ticks (ADR 0001, 0005, 0010), and what bounds a Battle online is a Rollback's re-simulation. The ways to give the armies this:

- **A cosmetic layer**: Squads, Objectives and Orders drawn or decided on each peer. Cheap, but peers would disagree on who owns an Objective and where a Squad is, and the Objectives are what decides a Battle, so they have to count.
- **Authoritative state sent over the wire**: the host decides and broadcasts. It breaks the rule that only Players' Intents cross the wire, and a host's decision cannot be re-simulated by a Rollback.
- **Simulated state, derived from the Tick and the Intents**: every peer runs the same Squads, Objectives and Commander, so a Rollback re-simulates them like the Crowd.

For the steering, a flow field per destination can be built from positions each Tick (as today's per-Team field is), or once per map.

## Decision

- **Squads, Objectives, Tickets and the Commander's memory are plain data in `SimState`**, beside the Crowd (struct-of-arrays of numbers, no typed arrays), in `hashValue`, `snapshot` and a JSON resync. Nothing new crosses the wire during play. A Squad's brain, an Objective's capture and the Commander's re-plan are Simulation steps, staggered so no Tick pays for all of them, reading only the state and the Tuning Data (never the camera, the clock or `Math.random()`), and reading the other Team's state as it stood at the start of the Tick so neither army thinks a step ahead of the other.
- **A Squad is a fixed group of Soldiers** (`battle.squad.size`, set at deployment), with an anchor, a heading, a Formation and a morale. Each Soldier stores its Squad and its place in the Formation (`CrowdState.squad`, `place`); the Squads' own arrays are `CrowdState.squads`. The Formation is chosen by the situation, never by order: column on the march, line in contact, loose when broken up. Soldiers keep stepping at the Crowd's 10 Hz, steering to their places; the brain steps at 2 Hz, each Squad on its own Tick.
- **A Soldier a Player takes over leaves its Squad**; a promoted Soldier keeps its Squad and place, and the Squad does not wait for it.
- **The Commander is one per Team, symmetric, and sees the whole Battle.** The same rules drive both Teams on every peer. It is blind to Players as people: they count only through the Objective counts and the threat score.
- **Destination fields are static and cached outside `SimState`.** One flow field to each destination (each Objective and each Base, per Team) is built once per map and Tuning Data, like the navmesh, pure and tie-broken by index. A Rollback never rebuilds them, and they add nothing to the state or the Tick. This replaces the per-Team field rebuilt from the Soldiers' positions: a Squad's anchor follows its destination's field, and the last few metres toward an enemy are local steering.
- **Stage 1 (built)** has no Objectives, so every Squad's Order is to attack the enemy army: its anchor heads for the nearest living enemy Squad's anchor (a Squad's own local steering) and, once an enemy Soldier is within `battle.squad.engage`, turns to it and stands in line. A Squad that breaks (`moraleThreshold`) falls back toward its Team's Base and merges, at the Base, into a Squad of its Team there with room (`mergeRange`, `mergeMax`). The static fields and the Commander replace this "attack the army" Order in Stages 2a and 2b.

## Consequences

- A Rollback re-simulates the Squads and the Commander with the Crowd. They are cheap by construction: at 200 v 200, 32 brains at 2 Hz stagger to about one brain a Tick, the anchors are 32 points, and Stage 1 measured the Squad step at about 0.03 ms a Tick (the Soldiers' steering to places cost less than the flow field they replaced). The static fields cost nothing in a Rollback.
- A Squad merges only into Squads thought through already this Tick, or into ones that have not been due (whose count is a step old and can only be too high), so room is never over-promised. The order a Team's Squads think in (by place in the army) is the same on every peer.
- The state's shape never changes: respawning Squads (Stage 2a) reuses dead Crowd slots, an emptied Squad's arrays stay.
- `deploy` in `data/battle.json` is the footprint of the Squads' ranks, no longer of Soldiers' ranks, and an army's size is held by that layout (`maxArmySize`).
- Peers on different Tuning Data or maps refuse each other, as before; the Lobby's army-size knob is held to what the layout fits.
- The Battlefield stays the open heightfield until Stage 3a (Battle maps as `ArenaGeometry`, ADR 0022, which will also carry the Walk Surface rule for Soldiers).
