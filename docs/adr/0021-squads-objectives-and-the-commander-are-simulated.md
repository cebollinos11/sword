# 0021 — Squads, Objectives and the Commander are simulated; destination fields are static and cached outside state

## Status

Accepted (2026-11-03, `docs/plans/battle-objectives.md`). Stage 1 built the Squads, and Stage 2a the Objectives, Tickets, the Commander and the static destination fields, as decided here.

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
- **Objectives and Tickets are state too** (`CrowdState.objectives`: a progress from -1 to +1 and an Owner each; `CrowdState.tickets`: one number a Team). The map places the Objectives (static, `Battlefield.objectives`); capture counts the Soldiers and full Fighters inside each circle on a fixed step (a Player counting 3), a death costs a Team 1 Ticket, a Team out-holding the other drains it every second, and a Battle that reaches its time limit routs the Team behind. The Rout needs a Team's Tickets gone as well as its Soldiers fallen below the threshold, so a Team with Tickets left keeps respawning.
- **A Squad's Order is state** (`SquadState.order`, `target`, `since`, `respawnAt`): attack or defend an Objective, or respawn at a spawn. Each Commander re-plans every `battle.commander.planSeconds`, reading the Soldiers and Squads as they stood at the start of the Tick and writing only its own Team's Orders, so the order the two plan in cannot matter. A Squad that is empty respawns whole into the dead slots of its Team (not a promoted or taken-over Soldier's), so the Crowd's capacity and the state's shape never change.
- **Squads march by the destination fields** (`src/sim/destinations.ts`): a distance field to each Objective and each Base, 8-connected over a coarse grid, built once and cached on the built Battlefield (never state). The anchor walks straight at its place in the circle when nothing blocks the line, and down the field when something does (Stage 3b). A Squad that breaks (`moraleThreshold`) still falls back toward its Team's Base and merges there (`mergeRange`, `mergeMax`).
- **Stage 1** had no Objectives, so every Squad's Order was to attack the enemy army: its anchor headed for the nearest living enemy Squad's anchor. Stage 2a replaced that with the Commander's Orders.

## Consequences

- A Rollback re-simulates the Squads and the Commander with the Crowd. They are cheap by construction: at 200 v 200, 32 brains at 2 Hz stagger to about one brain a Tick, the anchors are 32 points, and Stage 1 measured the Squad step at about 0.03 ms a Tick (the Soldiers' steering to places cost less than the flow field they replaced). The static fields cost nothing in a Rollback.
- A Squad merges only into Squads thought through already this Tick, or into ones that have not been due (whose count is a step old and can only be too high), so room is never over-promised. The order a Team's Squads think in (by place in the army) is the same on every peer.
- The state's shape never changes: respawning Squads (Stage 2a) reuses dead Crowd slots, an emptied Squad's arrays stay.
- `deploy` in `data/battle.json` is the footprint of the Squads' ranks, no longer of Soldiers' ranks, and an army's size is held by that layout (`maxArmySize`).
- Peers on different Tuning Data or maps refuse each other, as before; the Lobby's army-size knob is held to what the layout fits.
- A Rollback re-simulates the Commanders, the capture step and the respawns with the Crowd; they cost a few arrays and one plan every 2.5 s (Stage 2a's Result has the numbers).
- The Battlefield stays the open heightfield until Stage 3a (Battle maps as `ArenaGeometry`, ADR 0022, which will also carry the Walk Surface rule for Soldiers).
