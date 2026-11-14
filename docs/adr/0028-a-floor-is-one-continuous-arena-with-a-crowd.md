# 0028 — A Floor is one continuous Arena with a Crowd

## Status

Accepted (2026-11-12, `docs/plans/delver.md`, Stage 0). Supersedes `docs/plans/dungeon.md`'s first Decision ("Rooms are separate Arenas joined by doors, not one continuous Arena") and the part of ADR 0019 that makes each Hall its own Generated Arena with alcove Doors. ADR 0019's rule that every choice is simulated from walking stands: the Stairs, the fires and the pickups are places in the Floor, and equip and drop stay Intent fields. Until the Delver's Stage 8 retires it, the Hall graph still ships.

## Context

A Run walks a Floor graph of Halls. Each Hall is a 7 × 7-cell Generated Arena holding one Duel against at most four enemies, and Doors lead from it to the next (ADR 0019). `dungeon.md` weighed one continuous Arena for a Floor and turned it down for four reasons:
- Team 1 has only four slots.
- ADR 0014 limits a Generated Arena's footprint to 7 × 7 cells.
- It also limits an Arena to 40 Jump Links.
- Enemies far from the fight would be stepped and rolled back for nothing.

We want a dungeon crawler instead: each Floor one generated dungeon of 20 or more rooms and passages, with squads of enemies living in it.

Since then three things have been built:
- **The Crowd and the Bubble** (ADRs 0020, 0021). They hold hundreds of cheap Soldiers and promote the ones near a Player into a fixed 16-slot Fighter Pool.
- **Battle maps** (ADR 0022). These are `ArenaGeometry` of several levels with a navmesh that has no Jump Links, and destination fields for Squads.
- **The Map Compiler and its Enclosure Brush** (ADR 0023). A room is one Brush, compiled by a pure function into a map the game's own checks accept.

The Delver's Stage 0 measured what that costs, on a hand-written Floor of 20 Enclosure rooms (6 to 10 m half-sizes in a 5 × 4 grid 30 m apart) and 23 passages 3 m wide (a spanning tree and four loops) over a field-wide abyss, compiled as a Battle map (`src/mapEditor/delverSpike.*`):
- **Building it** takes about 0.15 s in the test container (median of 5 runs): `compileMap` (parse and walk check included), the Battlefield, the destination fields, a field per room and the navmesh.
- **A Tick with 100 Soldiers and 12 promoted** costs as much as on the open field: 0.9 ms against 0.9 ms. With 4 promoted it is 0.6 ms.
- **The container is faster than the laptop the Battle budgets were set on.** The Battle soak takes 0.79 ms a Tick here against 1.78 ms there. Scaled by that and by the 1.3× margin to a mid-range laptop (×3 in all), the Floor builds in about 0.5 s and a full-Pool Tick costs about 2.8 ms. That is within the 1 s fade and the 8 ms Tick.

## Decision

- **A Floor is one Arena.** It is one Duel with one Crowd, generated from the Run seed and the Floor number. It is written as a Map Source of Enclosures and compiled by `compileMap` into ordinary `ArenaGeometry`, then checked by `parseBattleMap` and `walkCheck`. Every peer builds the same Floor from the seed, so nothing about it crosses the wire. Between rooms is deadly ground (an abyss), which the walk check skips. So the floor reaches the field's edges, as a Battle map's must, and nobody walks outside the rooms.
- **The enemies are Soldiers in the Crowd**, in Squads with a dungeon brain (Warbands), promoted by an enemy-only Bubble. The party is always full Fighters (Pool slots 0 to 3). This answers the four-slot Team 1.
- **The navmesh is a Battle map's**, with no Jump Links (ADR 0022). That answers the footprint and the Jump Link budget, so generated Floors must never need a jump.
- **Destination fields** are a Battle map's, one node per level (the roofs are a level). On top of the static ones, `distanceTo` builds a field to any point on demand. It is a cache derived from static data, never stored in the state. Stage 3 uses it for Warband posts (static, built with the Floor) and toward a chased Player (rebuilt when that Player changes cell; 0.06 ms a field here, 0.3 ms at a 2 m cell).
- **A field's cell must see every passage.** At the Battle's 4 m `crowd.flowCell`, a 3 m passage whose centre line falls between cell centres holds no node, so the field goes round it. In the spike, two of 23 passages were cut this way and their loops were lost: one detour was 87 m, the other 209 m. A 2 m cell sees all 23, and the whole Floor then builds in about 0.24 s here (about 0.7 s on the laptop). So Floors build their fields at a 2 m cell of their own (`delver.flowCell`), leaving the Battles' 4 m. The generator's layout then needs no alignment.
- **Floors build during the fade.** The next Floor may be built during play (as `warmArena` warms Arenas), and its rerolls must stay within budget.

## Consequences

- The Delver plan goes ahead with large Floors: Stage 0 is a go on build time and Tick cost.
- **Online Runs should take an Input Delay.** A Floor Tick with a full Bubble costs what a Battle Tick does, and online Battles needed Input Delay to stop the Rollback cliff (ADR 0025). Stage 7 starts from `BATTLE_INPUT_DELAY` (3 Ticks) for Runs and measures it with four Players. A Duel stays at 0.
- The Battle autopilot got stuck on a room's wall next to a doorway, so in the first spike run no Soldier was ever promoted. The navmesh AI (AI allies, promoted enemies) must be watched on Enclosure Floors from Stage 2 on, at doorways especially.
- A Floor is `layered`, because the roofs are Walk Surfaces at the level above, even when every room is on one level. Its fields have a node per level and its Soldiers use the multi-level walk rule from the start, which Stage 6 needs anyway.
- `dungeon.md`'s first Decision and the Hall-graph part of ADR 0019 are superseded once Stage 8 lands. Until then both kinds of Run are in the code.

## Amended (2026-11-14, the Delver's Stage 6)

Floors have levels: Halls at whole 2 m levels, sloped Passages, and Galleries (a Deck along one wall of its own Hall, reached by a Ramp inside it). The Deck's open front edge is a Jump shortcut, so a Floor's navmesh is no longer jump-free. A Floor's map asks for **shortcut jump Links only** (`shortcuts: true`, `ArenaGeometry.jumpLinks: 'shortcuts'`): Links onto a Walk Surface walking already reaches, checked by the Simulation's arc as ADR 0013's are, never onto a roof. "Generated Floors must never need a jump" still holds: Soldiers never Jump, and `walkCheck` still proves every Walk Surface but the roofs is walked to and from without one. Battle maps keep `jumpLinks: false`. The navmesh's build grew from about 17 ms to about 100 ms here; it is warmed a Floor ahead.
