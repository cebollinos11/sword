# 0014 — Generated Arenas are assembled from a Kit on a grid, and judged by the real navmesh

## Status

Accepted

## Context

Every Arena is hand-modelled (ADR 0006). We want Arenas generated from a seed (`docs/plans/generated-arenas.md`), so a Match can be fought somewhere new, and every peer must build exactly the same one from the same seed (ADR 0001, ADR 0005). The AI already copes with any valid `ArenaGeometry`: the navmesh, jump Links and shortcut Links all come from the geometry (ADR 0006, 0011, 0013). The ways to get one:

- **Free-form geometry** (noise heightfields, random polygons): endless variety, but sloped and odd-shaped Walk Surfaces break the rules the navmesh relies on (convex, planar, neighbours sharing edges exactly), coordinates come from trig and divisions that need not agree bit for bit, and there would be nothing for an artist to model.
- **Whole hand-made Arenas, picked by seed**: safe, but not new.
- **A Kit of Pieces on a grid**: each Piece carries its own Walk Surfaces and Walls; a seed picks which Piece goes in which cell and how it is turned.

## Decision

A Generated Arena is assembled from a Kit on a grid, in a pure module (`src/sim/arenaGen/`), in three steps:

- **`generateLayout(kit, seed, params)`** fills the grid freely (no symmetry, nothing checks fairness): raised plateaus, a ramp onto each (or the plateau is flattened), more ramps until walking joins every floor (what none can join becomes void), voids that keep the floor joined, bridges across some, then cover (crates, pillars) and rails on raised edges. It is seeded only through `src/sim/rng.ts`, makes every choice in cell order, and breaks ties by index.
- **`assembleArena(kit, layout, name)`** places each Piece's Walk Surfaces and Walls by whole cells and quarter turns (no trig, so every coordinate is exact and neighbours share edges exactly). It merges whole flat cells at one height into rectangles (fewer Walk Surfaces, a faster navmesh), stands a Wall under every cell side whose ground is higher than its neighbour's (each Piece's skirts; otherwise a Fighter could walk under a raised floor into the Abyss), lays one Abyss under the whole footprint, and puts each Team's three spawns in one cell. The two cells are the furthest apart that walking joins, safe cells first.
- **`judgeArena(arena, tuning)`** checks the result with the real navmesh:
  - every spawn reaches every enemy spawn by walk and drop Links alone, so the AI without jump Links can reach the fight;
  - enemy spawns stand at least 6 m apart;
  - no deadly ground lies within 3 m of a spawn that it could walk straight onto;
  - enough open floor at the lowest level;
  - the navmesh is cheap to build.

**`generateArena(kit, seed, params, tuning)`** tries attempt seeds derived from the seed until one passes (at most `MAX_ATTEMPTS`), and names the Arena `gen:<kit>:<seed>`.

The build-time rule is judged by a deterministic stand-in: at most `maxJumpLinks` (40) jump Links. Simulating Jumps is nearly all of a build, about 3.5 ms per jump Link found. The judge times the build against 250 ms only when the caller hands it a clock: the Simulation never reads one, and a verdict that hung on the machine's speed would make peers build different Arenas.

## Consequences

- A Generated Arena is an ordinary `ArenaGeometry`: `parseArena` accepts it, and the Simulation, the AI and the camera need no change. Every seed from 1 to 200 gives one that passes, in about 1.5 attempts on average; their navmeshes build in about 110 ms (median), under 200 ms at most.
- The greybox Kit is TypeScript for now. A Blender Kit (Stage 4) supplies Pieces with the same fields (Walk Surfaces, Walls, connectors, skirts), and the generator does not change.
- Keeping the navmesh cheap shapes the Layouts: on a 7 × 7 footprint, crates (whose lids draw many jump Links) are only part of the cover, and raised edges over lower ground are often railed (a railed edge is never searched for shortcut Jumps, ADR 0013).
- The edge of the footprint is open to the Abyss, so cells on it are never safe for spawns. Spawns need a cell whose eight neighbours are all solid ground; a Layout with fewer than two such cells falls back to others, and the judge usually rerolls it.
- Any change to the generator, the Kit or the judge can change the Arena a seed gives. Online play (Stage 5) will need a generator version in the Tuning Data hash.
