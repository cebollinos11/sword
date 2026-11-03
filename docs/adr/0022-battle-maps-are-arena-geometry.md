# 0022 — Battle maps are `ArenaGeometry`; Soldiers live on Walk Surfaces and never jump

## Status

Proposed (2026-11-03, `docs/plans/battle-objectives.md`). Stage 3a built the first part: a Battle's map is either the open field or a hand-built `ArenaGeometry` with Battle helpers, the Fort on one level, Soldiers pushed out of its walls. Stage 3b made Squads move well among the walls (Soldiers walk round them, Formations narrow through gates); Stage 4a puts Soldiers on several levels (the Walk Surface rule below) and finishes this ADR.

## Context

A Battle is fought on the Battlefield (ADR 0020): an open heightfield built from its seed, whose triangles are its Walk Surfaces, with no Walls and no Jump Links, and whose height the Crowd reads in constant time. We want maps with walls, gates, breaches, and later raised platforms, ramps, towers and tunnels, fought over by the Squads, Objectives and Commanders of ADR 0021. Every peer must still reach the same state and roll back up to 15 Ticks, and the Crowd must stay about 1 ms a Tick. The ways to give a Battle walls:

- **Walls on the heightfield**: segments stood on the open field. Cheap, but one level only, nothing for an artist to model, and the Fighters' navmesh would be the field's thousands of triangles.
- **A grid of the Crowd's own**: blocked cells the Crowd steers round. Cheap for the Crowd, but the full Fighters stand on Walk Surfaces and stop at Walls (ADR 0006), so there would be two descriptions of one map.
- **`ArenaGeometry` from a Blender generator** (ADR 0006): the map's floor as Walk Surfaces and its walls as Walls, read by the Fighters, the AI's navmesh and the camera as any Arena is, with the Battle's helpers beside them.

## Decision

- **A Battle's map is one of two kinds**: the open field, `battle:<seed>` (the heightfield, unchanged), or a hand-built Battle map, `battle:<map>`, Tuning Data in `data/battlemaps/<map>.json` (`battle.maps`, in the Tuning Data hash), exported by `art/build_battle_<map>.py` from its Collision helpers: the floor (`WALK_*`, convex Walk Surfaces cut along every block's sides), the solid blocks of its walls and towers (`BLOCK_*`, boxes from the ground to a top: the Simulation stands a Wall on each side), other Walls (`WALL_*`, the field's edge), the Objectives (`OBJ_*`, with weight, Owner and spawn), the Bases (`BASE_T*`), the deployment (`DEPLOY`, the front rank's distance from the centre) and the map's army size (a standard and a most). The Battlefield of a map is an ordinary `ArenaGeometry`, cached per Battle Tuning Data like the open field.
- **Full Fighters get the real navmesh, without Jump Links** (`ArenaGeometry.jumpLinks: false`): a 200 m map builds in milliseconds, and promoted AI never leaps off a wall. The AI routes over it as in any Arena; it walks straight only on the open field.
- **The ground is the highest Walk Surface under a point** (`battlefieldHeight` reads the map's Walk Surfaces through its `Heightfield.walk`), so everything that stands on the Battlefield (Soldiers drawn, Promotion, Objective markers) stands on the floor the Fighters do. One level only in Stage 3a.
- **The destination fields go round the walls**: a cell whose centre a block covers is blocked; a blocked cell holds one step more than its lowest open neighbour, so a Squad pushed against a wall still has a way out. A Squad's anchor walks straight at its place only when the line keeps clear of every block (by a Formation's spacing), and is in contact with an enemy only when no block stands between them.
- **Soldiers are pushed out of the blocks** (`pushOutOfBlocks`): a step that walked in from outside slides out by the side it came in through (Stage 3b), else out by the shallowest side that does not land in a touching block. Anchors and respawned Soldiers are too.
- **Soldiers walk round the walls to their places** (Stage 3b): a place inside a wall, or past one from the anchor, moves in toward the anchor (`formationSpot`); a Soldier that cannot walk straight to its place (a block across the line, or within its body of it) walks to the furthest point it can of the line from its anchor out to its place, and when it can reach none of it, down the destination field that leads past its anchor (`toward`), never at a cell centre on a wall's face.
- **Formations narrow to the clearance ahead** (Stage 3b): each field cell stores its clearance (static, beside the fields); a Squad's Formation narrows to as many files as the least clearance from its anchor to `squad.narrow.ahead` past it holds, `squad.narrow.room` from the walls each side, so a line becomes a column through a gate. The narrowing is a function of the anchor's state, worked out each Tick, never stored. A Squad's place at an Objective is one with room for a column, from its own share of a spiral over the circle (mirrored for Team 1).
- **The map is its own half turn**, as the armies are: Objective k mirrors Objective n - 1 - k and block k mirrors block n - 1 - k, and every tie a Team breaks on the map (the way down a field, the way out of a block) Team 1 breaks the half-turned way, so neither army is favoured by the order of a list.
- **`armySize` per map**: the Lobby's map picker folds the map into the Battle's Tuning Data (`applyBattleKnobs`), the army size its standard unless the Lobby picks another, held to its most. A Battle refuses an army too big for its map.
- **(Stage 4a, to come) Soldiers live on Walk Surfaces and never jump**: each Soldier stores the Walk Surface it stands on, crosses by walk and drop Links only, and a build-time check proves every area of a map is joined by walking.

## Consequences

- Nothing new enters `SimState` for a map: its floor, blocks, fields and navmesh are static caches, built once per map and Tuning Data. Peers on different maps or map files refuse each other through the Tuning Data hash, as with any Arena.
- A Duel's, a Run's and the open field's Battles are unchanged: the open field has no blocks, so its push, its fields and its lines of sight do nothing new, and its AI still never builds a navmesh.
- What the Simulation sees is simpler than what is drawn: rubble in the breaches and the gate arches are render only, and a ruined tower's stump is as solid as a standing one.
- Stage 3a's crude push kept Soldiers out of the walls but not in good order (Soldiers pressed against a wall for minutes); Stage 3b's Result measures how long Soldiers stay out of place with the walking round, the narrowing and the roomy places. Gates stay chokepoints: Squads queue through them, narrowed to one to three files.
- A new map needs its generator to emit the helpers, and the Lobby a name for it (`BATTLE_MAPS`).
