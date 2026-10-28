# 0019 — A Dungeon's choices are simulated from walking, and its Halls are separate Arenas with alcove Doors

## Status

Accepted (`docs/plans/dungeon.md`). Stage 1 built the Doors, the Hall Arenas and the Rest fire as decided here (Stage 1, Result); Stage 2 built loot, equip and drop the same way (Stage 2, Result).

## Context

The Gauntlet's next version is a dungeon crawler, solo or online co-op: a Run walks a seeded Dungeon of Floors, each a graph of Halls, picking its route, its loot and its build as it goes. Every peer must still reach the same state from the same Intents (ADR 0001), through Rollback and resync, with Players relayed through the host (ADR 0010). The v1 Run put nothing new on the wire during play because it had no choices; its plan called choices between Floors "real protocol work".

How the party chooses a Door, a pedestal, a Weapon to equip:

- **Menus and votes**: clear to read, but each pick is a new reliable message outside the Intents, with its own Rollback handling and rules for ties and silent Players.
- **Walking**: Doors, loot and Rest fires are places in the Hall the Simulation checks; a choice follows from where the Fighters stand, which already follows from the Intents. The few actions that are not walking (equip, drop) become Intent fields.

How a Hall joins the next:

- **One continuous Arena** for a Floor: a real dungeon to walk, but many more enemies than Team 1's four slots, a footprint and jump Links far beyond ADR 0014's budget, and enemies stepped and rolled back far from the fight.
- **Separate Arenas joined by real passages**: geometry that opens during play, or navmesh edges off the footprint.
- **Separate Arenas with alcove Doors**: a Door is a doorway in an edge Wall with a zone before it; nobody walks through it.

## Decision

Every choice in a Dungeon is simulated: a Door is taken when every living Player has stood in its zone for a moment once the Hall is cleared (when no Player lives, the living AI allies count instead, so a party of AI allies can still leave); an item is taken by walking onto it (each Player's own copy, a pure hash of Run seed, Floor, Hall and Player; an item a Player dropped is shared, and the AI allies take nothing); equip and drop are Intent fields (`equip`, `drop`), acted on only once the Hall is Cleared (or has no Encounter) and only while that Fighter is alive, Idle and on the ground, so a Weapon is never swapped mid-Action. The map and inventory screens are render only.

Each Hall is its own Generated Arena on the usual footprint, whose name carries its Door count (`gen:<kit>:<seed>:d<n>`, a `GENERATOR_VERSION` bump), with Doors as Kit Pieces on its edge. Walls never change during play; a closed Door is only drawn closed.

## Consequences

- A Run still puts nothing new on the wire during play but the Intent's two new fields (Stage 2's `equip` and `drop`, `PROTOCOL_VERSION` 21); choices roll back, resync and checksum like positions do. Stage 1 sends no new message, but the resync's Match state took a new shape (the Run's `RunState`, `SimState.hall`, the Hall AIs' memory, `config.players`), so `PROTOCOL_VERSION` went up then too (19 → 20), as well as the Tuning Data hash peers compare at connect.
- A choice takes a moment of walking, not a click: the party is seen gathering at a Door. A Player who wanders keeps the others waiting; the HUD shows how many of them stand at each Door ("2 / 3").
- Every Hall fight stays one Duel of at most four enemies on a navmesh within budget, so the Simulation, the AI and Benched slots work unchanged. One continuous Arena is Later, and would start from this graph.
- The judge (ADR 0014) gains a rule: a Hall Arena has the Doors its name asks for, every Door's zone and spawns reach every enemy spawn by walking and dropping alone, and no Door zone stands over deadly ground.
