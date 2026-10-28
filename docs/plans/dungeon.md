# Dungeon: the Gauntlet's next version, a seeded map of rooms

> Status: design in progress (grilling). Nothing built. Builds on the Gauntlet v1 (`docs/plans/gauntlet.md`, Stages 1, 2 and 4 done) and the Generated Arenas (`docs/plans/generated-arenas.md`).

## Context
The Gauntlet v1 Run is a straight line of Floors: one Duel each, on its own Generated Arena, against the enemies `data/gauntlet.json` lists. We want a dungeon crawler, solo or co-op: a randomly generated dungeon with rooms, enemies and loot, instead of separate duels.

## Decisions
- **Rooms are separate Arenas joined by doors, not one continuous Arena.** Each room is its own small Generated Arena; the dungeon is a seeded map of rooms (a graph), not one big mesh. A fight in a room stays one Duel: at most four enemies (MAX_TEAM_SIZE), a navmesh within ADR 0014's budget, ending when a Team is wiped out. One continuous Arena with many rooms (enemies waking as you near, many asleep Fighters outside the Simulation, a navmesh per room) was weighed and left for Later: it breaks the four-slot Team 1, the 7 × 7 footprint and the 40 jump Link budget at once, and the room map can grow into it.
- **It is the Gauntlet's next version, not a new Format.** The Gauntlet Format stays; its Run becomes a walk through a dungeon. A v1 Run is the special case of a dungeon with one straight path.

## Open questions
- Names: the dungeon, one room of it, and whether Floor survives (Room is the online connection; Chamber is a combat term).
