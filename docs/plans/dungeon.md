# Dungeon: the Gauntlet's next version, a seeded map of rooms

> Status: design in progress (grilling). Nothing built. Builds on the Gauntlet v1 (`docs/plans/gauntlet.md`, Stages 1, 2 and 4 done) and the Generated Arenas (`docs/plans/generated-arenas.md`).

## Context
The Gauntlet v1 Run is a straight line of Floors: one Duel each, on its own Generated Arena, against the enemies `data/gauntlet.json` lists. We want a dungeon crawler, solo or co-op: a randomly generated dungeon with rooms, enemies and loot, instead of separate duels.

## Decisions
- **Rooms are separate Arenas joined by doors, not one continuous Arena.** Each room is its own small Generated Arena; the dungeon is a seeded map of rooms (a graph), not one big mesh. A fight in a room stays one Duel: at most four enemies (MAX_TEAM_SIZE), a navmesh within ADR 0014's budget, ending when a Team is wiped out. One continuous Arena with many rooms (enemies waking as you near, many asleep Fighters outside the Simulation, a navmesh per room) was weighed and left for Later: it breaks the four-slot Team 1, the 7 × 7 footprint and the 40 jump Link budget at once, and the room map can grow into it.
- **It is the Gauntlet's next version, not a new Format.** The Gauntlet Format stays; its Run becomes a walk through a dungeon. A v1 Run is the special case of a dungeon with one straight path.
- **Two levels: Dungeon → Floor → Hall.** A Run walks a **Dungeon**: a few Floors (3 to start, Tuning Data), each harder than the last. A **Floor** is a small branching graph of Halls (about 6 to 10), from an entrance to a Boss Hall; clearing the boss takes the Run down to the next Floor. A **Hall** is one node: one Generated Arena, with a kind (Fight, Elite, Treasure, Rest, Boss; Shop is Later, with Gold). Clearing a Hall opens its doors to the next ones, with a choice of route at most of them. A v1 Run is one Floor of seven Fight Halls in a line.
  - Names: **Dungeon** comes off the Run's _Avoid_ list. **Floor** changes meaning, from one Duel to one depth of Halls. **Hall**, because Room is the online connection, Chamber a combat term, Cell the generator's grid. As with the Gauntlet, `CONTEXT.md` changes with the code that makes it true (Stage 1), not before; until then it describes the v1 Run.
- **Every choice is made by walking, never by menu.** Doors, loot, Shop wares and Rest spots are places in a Hall that the Simulation checks, not prompts. A cleared Hall opens its doors, each marked with the kind of Hall behind it; the party leaves through one when every living Player has stood in its zone for a moment (about 1.5 s, Tuning Data), and the AI allies follow. Choices follow from positions, which follow from Intents (ADR 0001), so they roll back and resync like everything else, and a Run still puts nothing new on the wire during play. A menu vote was weighed and turned down: each pick would be a new reliable message with its own Rollback handling, plus tie and no-vote rules. Cost: the Hall generator must place doors on an Arena's edge (a Generated Arena is open to the Abyss all round today) and the Arena data needs door zones.
- **Each Player gets their own loot.** A pickup is per Player: each Player sees and takes their own copy, so co-op never races for it. What a copy holds is a pure hash of (Run seed, Hall, Player), so every peer agrees.
- **Loot is Weapons and Relics; no Gold (so no Shop Halls in v1).** A Weapon found is a Weapon of the roster exactly as tuned: no variants, no affixes, nothing that changes its Motion or Tempo. A **Relic** is a passive modifier from a list in Tuning Data, applied in the Simulation. Gold, Shops, consumables and armour are Later. This changes the Weapon rule (today chosen before the Match and kept across Duels): in a Run, the Weapon a Fighter holds can change between Halls.
- **Players have an inventory: they can equip and drop items.** (Details: Open questions.)

## Glossary (proposed, for `CONTEXT.md` in Stage 1)
- **Dungeon**: the seeded map a Run walks: its Floors, each a graph of Halls. A pure function of the Run seed and Tuning Data, so every peer builds the same one.
- **Floor**: one depth of a Dungeon: a branching graph of Halls from an entrance to a Boss Hall. _Avoid_: level, act, stage.
- **Hall**: one node of a Floor, fought or visited on its own Generated Arena, with a kind (Fight, Elite, Treasure, Rest, Shop, Boss). A Hall with enemies is one Duel. _Avoid_: room (the online connection), chamber (a combat term), cell (the generator's grid), node.

## Open questions
- Inventory: what it holds, when it can be used, how its actions travel, and whether a dropped item is a gift to teammates.
