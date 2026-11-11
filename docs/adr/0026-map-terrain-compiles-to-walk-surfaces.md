# 0026 — Map Terrain compiles to Walk Surfaces

## Status

Proposed (2026-11-11, `docs/plans/map-terrain.md`). Nothing built yet.

## Context

A Map Source (ADR 0023) can only say flat rectangles at fixed levels, plus Ramps, so every map made in the Map Editor stands on a plane. We want hills: a sculpted ground under the Brushes. The ways to give a Battle map rolling ground:

- **Terrain as Walk Surfaces, compiled**: the Map Source carries a heightmap, and the Map Compiler turns each 5 m cell into two triangles, cut where Brushes stand, with Walls round anything too steep. The Simulation already walks such ground: the open field is exactly this (ADR 0006's planar convex Walk Surfaces, `build` in `src/sim/battlefield.ts`).
- **A heightfield ground the Simulation reads**: `BattleMapTuning` carries heights, and `battlefieldHeight`, the walk rule and the destination fields read them wherever no Walk Surface is. It is cheaper at fine resolution, but it is a new Simulation rule touching Soldiers, Fighters, the navmesh and the checksum.
- **Render-only hills**: drawn but not stood on. This is refused for the reasons ADR 0006 gives: the Tick could not see the ground's height.

## Decision

- **The Terrain is an optional heightmap in the Map Source** (`terrain`: heights on the coarse 5 m cell, a `cliff` slope), sculpted in the Map Editor. Like the rest of the source, it is not Tuning Data.
- **The Map Compiler turns it into ordinary Walk Surfaces and Walls**: two triangles a cell along the open field's diagonal, clipped into convex pieces where a Brush (any but a Deck, Hole, Rail or Wall) stands. Faces stand where a Brush floor and the Terrain differ by more than a step, and Walls round every Cliff (a triangle steeper than `cliff`), which has no Walk Surface. Everything passes through `parseBattleMap` and `walkCheck` as before.
- **No rule of the Simulation changes.** The compiled map is just another `data/battlemaps/<map>.json`, and a source with no Terrain compiles to the same bytes as before.
- **The look is generated from the same heights** and blended by slope (grass, dirt, stone), render-only.

## Consequences

- Map authors get hills, valleys and cliffs with forts, ramps and bridges standing on them, with no Simulation work and no change to any shipped map.
- A Terrain map is `layered` and has up to about 3 200 Walk Surfaces at 5 m cells, about five times the City's. Its Battle cost must be measured against the Rollback budget (plan Stage 1). Flat runs can be merged, and finer Terrain needs the heightfield ground above, under an ADR of its own.
- Cliffs are walled, not climbable or droppable. Water filling hollows, Holes through the Terrain and Brushes that follow the ground are Later.
