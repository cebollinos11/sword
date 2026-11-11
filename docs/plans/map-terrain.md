# Map Terrain: sculpted hills under a Battle map's Brushes

> Status: planned (2026-11-11), nothing built. Four Stages (0 to 3), each one chat (see "How to run each Stage"). Each Stage ends with a `### Result` written by whoever builds it (what was built, what changed from the plan, test counts, timings), as in `docs/plans/map-editor.md`.

## Progress
- [ ] Stage 0: Terrain in the Map Source and the compiler (pure, no UI)
- [ ] Stage 1: Battles on Terrain (measured, made to fit the budget)
- [ ] Stage 2: sculpting in the Map Editor
- [ ] Stage 3: the look (slope-blended ground)

## Context
A Map Source (ADR 0023) is axis-aligned Brushes at fixed `levels`: every floor is flat, and the only slope is a Ramp. A map made in the Map Editor therefore stands on a plane. We want rolling ground: hills, ridges, hollows and cliffs, with the existing Brushes (a fort, a keep, a bridge) standing on it.

Most of what that needs already exists:
- **The Simulation already walks on any slope.** A Walk Surface is a convex polygon on any non-vertical plane (`src/sim/arena.ts`: `y = a·x + c·z + d`). The open-field Battle (`build`, `src/sim/battlefield.ts`) is a 5 m heightfield whose cells are each split into two triangles along the diagonal from (c, r) to (c + 1, r + 1), and every one is a Walk Surface. Soldiers walk from one Walk Surface onto another across an edge within `levels.stepUp` (`src/sim/levels.ts`). Neighbouring triangles share their edge's heights exactly, so they join at no step at all, however steep.
- **The renderer already draws such ground** (`src/render/battlefieldView.ts`): a mesh split along the same diagonal, so it is exactly the ground the Crowd stands on, with vertex-coloured grass.
- **What is missing is authoring**: there is no way to say "the ground here is 3 m higher" in a Map Source, sculpt it in the editor, compile it with the Brushes, or draw it in the map model.

## Decisions (from the interview, 2026-11-11)
- **One sculpted heightmap per map: the Terrain.** It is an optional `terrain` block in the Map Source, a grid of heights (m) on the coarse cell (`grid.cell`, 5 m): (size / cell + 1)² samples, 41 × 41 on a 200 m field, row by row along z from (-size/2, -size/2), the open field's layout. It is painted in the top view with Raise, Lower, Smooth and Flatten tools. It is not a Brush: it has no id, no paint order and no level, and it is not selected, moved or resized.
- **5 m cells**: 1 600 cells, so at most 3 200 triangles. Gentle hills and ridges, the same resolution as the open field's. Finer is Later, and would be a Simulation change (see "Later").
- **The Terrain is the ground.** It takes the place of the flat Floor a map lays at its ground level today. Brushes keep their absolute heights (their `levels`) and stand on the Terrain or are cut into it:
  - Every Brush that lays a floor or is solid (Floor, Platform, Ramp, Hazard, Block, Enclosure) **cuts the Terrain out under its rectangle**, at any height. A Floor above the Terrain there is a raised floor with faces down to the Terrain, as a Platform is. A Floor below it is a sunken floor, faced by the Terrain round it.
  - A **Deck keeps the Terrain under it**: a bridge over a valley.
  - Where a Brush's floor and the Terrain beside it differ by more than a step (`levels.stepUp`), a Wall stands along that stretch of the edge (the compiler's existing face rule). Within a step, it is walked straight across, so a flat plaza blends into the hills it is cut into.
  - Rails and Walls stand where they are drawn. A Rail's `y` and a Wall's `bottom` stay absolute, so a Rail drawn on a hill is the author's to place at the right height. Stage 2's checks warn when one floats over the Terrain or is buried in it.
- **Steep means Cliff.** A Terrain triangle steeper than the Terrain's `cliff` slope (rise per metre run, default 1, which is 45°; a number in the `terrain` block) is a **Cliff**. The compiler gives it no Walk Surface and stands Walls round each connected Cliff: along every edge where a Cliff triangle meets a walkable one, from a metre under that edge's lower end to `levels.height` over the Cliff's highest point. Nobody walks up, down or into a Cliff, and a Jump from its top cannot clear the Wall to land in the gap. A map whose Cliffs cut its ground into parts that do not join is refused by `walkCheck`, with an error naming the Terrain. Stage 2's checks list Cliffs that wall off a floor.
- **Hazards and Holes do not act on the Terrain** (for now). A Hole takes away only Brush floors. A Hazard cuts the Terrain under its rectangle like any floor, but it never floods the Terrain below its height (a lake in a hollow is Later). The Terrain is always solid, walkable ground, except where it is a Cliff.
- **Mirror mode sculpts symmetrically.** On a mirrored source, every stroke also applies at its half turn, so sample (c, r) and (side - 1 - c, side - 1 - r) are always equal. The cell diagonal from (c, r) to (c + 1, r + 1) is its own half turn, so the compiled triangles are too. The mirror check (`mirrorIssues`) names any sample that is not its own half turn's (a hand-edited file).
- **The look blends by slope**: grass on gentle ground, then dirt, then the Cliff in stone, chosen per point from its slope and blended smoothly, with no painting. Render-only, from the Terrain's heights: never in the compiled map, nor the Tuning Data hash.
- **Nothing the Simulation reads is new** (ADR 0023): the Terrain compiles to ordinary Walk Surfaces and Walls in an ordinary `data/battlemaps/<map>.json`, through the game's own `parseBattleMap` and `walkCheck`. A source with no `terrain` compiles to the same bytes as before, so the Fort port and every shipped map stay as they are. See `docs/adr/0026-map-terrain-compiles-to-walk-surfaces.md`.

## Format
```jsonc
"terrain": {
  "cliff": 1,            // optional: rise per metre run above which a triangle is a Cliff (default 1)
  "heights": [0, 0, 0.25, ...] // (size / grid.cell + 1)² numbers, row by row along z from the south-west corner
}
```
- Heights are whole multiples of 0.05 m (the sculpt tools round to it), from -50 to 100 m. That keeps the file exact and diffable and every compiled corner a short number. The writer (`sourceFileText`) puts one row of samples on a line.
- Compiled ids: a Terrain triangle is `WALK_terrain_<c>_<r><a|b>` (a: the triangle (c, r), (c + 1, r), (c + 1, r + 1); b: (c, r), (c + 1, r + 1), (c, r + 1), as the open field's). A piece of one cut by a Brush is `WALK_terrain_<c>_<r><a|b><n>`. A Cliff's Walls are `WALL_cliff_<k>_<n>` (k: the Cliff, numbered from its lowest triangle in row-major order). A Brush's faces against the Terrain keep their existing ids (`WALL_<brush>_<side><n>`, owned by the higher side's Brush, or `WALL_terrain_<side><n>` where the Terrain is higher).

## Risks and what to measure
- **Cost in a Battle.** A hilly map is `layered` (`isLayered`: not every Walk Surface lies at the floor's height), so it gets a node per level per destination-field cell, and every Soldier move is a `trace` over Walk Surfaces. Up to 3 200 triangles is about five times the City's 634 Walk Surfaces. Stage 1 measures the field build, a 15-Tick Rollback on the march and an AI Battle against the budget in `docs/plans/battle-objectives.md` (22 to 25 ms a Rollback on the reference laptop). It also measures the compile, the editor's live checks and `walkCheck` at full size.
- **Cutting triangles by rectangles.** A Brush's rectangle (on the 0.5 m grid) cuts across a 5 m triangle at any place. The leftover of a triangle is clipped into convex pieces by the rectangle's four lines in a fixed order (no trig, exact on the grid's coordinates). Its corners' heights come from the triangle's plane, so they can be long decimals. They must pass `checkSurface`'s planarity (1 cm) and stay exact where two pieces share an edge.
- **T-junctions.** Brush rectangles already meet Terrain triangles part-way along an edge (and merged Brush rectangles already meet each other so). Stage 0 checks that the navmesh, `probeEdges` and `walkCheck` join a Terrain triangle to a Brush floor and to its own cut pieces wherever they touch. It is not enough that shared corners join.
- **Gait and the Fighter on a slope.** Fighters already walk the open field's hills and the Kit ramps (3 m over 6 m), but nothing steeper. A slope just under the Cliff (45°) is steeper than any walked today. Stage 1 checks Gait, Slides, Knockdowns and Jumps on it, and lowers the default `cliff` if 45° looks wrong.

## Working rules for every Stage
- The four shipped maps, the Fort port and every existing test stay unchanged: a source with no `terrain` compiles to the same bytes.
- No rule of the Simulation changes (Stage 1 may only tune Tuning Data numbers or caches if it must, and says so in its Result).
- The pure part (`src/mapEditor/`: source, compiler, checks, session) stays free of three.js and the DOM, deterministic (no `Math.random`, no trig on coordinates, ties by Brush order then row-major cell order) and unit-tested.
- `npm run typecheck` and `npm test` clean at the end of every Stage; `npm run test:slow` where a Stage runs Battles.

## How to run each Stage
- **One chat per Stage**, started fresh with `docs/plans/map-terrain-prompt.md`. The Stage's own list and its "Done" are the brief.
- **The model each Stage names.** Sonnet where the work is well specified and tests catch mistakes; Opus where it is geometry or judgement.
- **A review before the commit**: `/code-review` at `high` on the Stage's diff, against this plan. Fix what it finds, then commit.
- **Stop at the Stage's "Done"**, write its `### Result`, tick it under Progress, push, and stop for a playtest.

## Stage 0: Terrain in the Map Source and the compiler
**Model**: Opus (geometry).

- `src/mapEditor/source.ts`: the optional `terrain` block (`MapTerrain`: `cliff`, `heights`) on `MapSource`. `parseMapSource` checks the sample count against `size` and `grid.cell`, every height finite, a multiple of 0.05 and in range, and `cliff` positive. `sourceFileText` writes it one row a line, and the parser reads its own output back. Helpers `terrainSide(source)`, `terrainAt(source, c, r)` and `terrainHeight(source, x, z)` (the triangle under (x, z), as `battlefieldHeight` does).
- `src/mapEditor/compile.ts`:
  - **Triangles**: two per cell along the open field's diagonal, each a Walk Surface `WALK_terrain_<c>_<r><a|b>`, unless it is a Cliff.
  - **Cutting**: every Brush but a Deck, Hole, Rail or Wall cuts its rectangle out of the Terrain. Each Terrain triangle a rectangle overlaps is clipped against the rectangle's four lines in a fixed order (west, east, south, north), and each piece outside is kept as a convex Walk Surface. A Ramp cuts its whole rectangle (its wedge and skirts stand on what is under it).
  - **Faces**: the existing rule "a face under every edge of a floor where the ground beside it is higher than a step" learns ground that slopes along the edge. Along each Brush floor edge that borders Terrain, the edge is split at the Terrain triangles' sides and where the height difference crosses `stepUp` (a division, no trig). A Wall stands on each stretch that differs by more than a step, from the lower ground's lowest point to the higher's highest, owned by the higher side (`WALL_<brush>_<side><n>` or `WALL_terrain_<side><n>`).
  - **Cliffs**: the triangles steeper than `cliff` (rise over run from the plane's gradient: `sqrt(a² + c²) > cliff`), grouped into connected Cliffs. The Walls round each are stood as in "Decisions", merged along straight runs.
  - **The field's edge Walls** stand `levels.height` over the highest of the Terrain and the floors along each edge, not only over the highest floor.
  - **Mirror**: a mirrored source's Terrain triangles and pieces are listed so the half turn keeps them, and a check that its heights are their own half turn joins `mirrorIssues`.
- Warnings (the map still compiles): a Brush standing over the Terrain so that no face can be reached (fully walled in by Cliffs), a Rail or Wall buried in the Terrain or floating more than a step over it, and Terrain wholly covered by Brushes (it does nothing).
- `src/mapEditor/terrain.testdata.ts`: a hilly sample. It has a hill with an Objective on top, a valley crossed by a Deck, a fort of Platforms and a Ramp cut into a slope, a sunken Floor, and a Cliff on one side, mirrored.
- Tests (`src/mapEditor/terrain.test.ts`): the parse round trip; a flat Terrain at the ground level compiles to the same ground as a Floor would (same reach, no stray Walls); triangles on the open field's diagonal; a Brush's cut leaves convex pieces that tile the leftover exactly (area sums) and join it by walking; faces stand only where the difference exceeds a step; a Cliff is walled round and cannot be walked into, out of or Jumped into; a Deck keeps its Terrain; a mirrored Terrain compiles to Walk Surfaces and Walls that are their own half turn; determinism (two compiles, same bytes); the existing compile, Fort-port and sample tests unchanged.
- **Done**: `compileMap(terrainSample())` gives a map that `parseBattleMap` and `walkCheck` accept, and `walkReach` joins every Terrain triangle that is not walled off to the Bases. Measured: compile time of the sample and of a full 41 × 41 hilly Terrain with a City's worth of Brushes.

## Stage 1: Battles on Terrain
**Model**: Opus (performance and judgement).

- A slow test that plays AI Battles on the compiled Terrain sample (`src/mapEditor/terrain.slow.test.ts`, in the style of `playtest.slow.test.ts`): they end, both armies reach the Objectives on the hill, no Soldier stands off its Walk Surface (the level check, `levelChecks.testdata.ts`), and the same seed gives the same result twice.
- Measure on a full-size hilly map: the destination-field build (`destinationFields`), the navmesh build, the Crowd's cost a Tick, and a 15-Tick Rollback on the march, against the budget in `docs/plans/battle-objectives.md`. If it does not fit, make it fit without a rule change, in this order: merge each run of flat cells at one height into rectangles before cutting (fewer Walk Surfaces; check the T-junctions join), then cache what is per-map and static. If it still does not fit, stop and report: what is left is the "Later" heightfield ground, which needs an ADR.
- A Fighter on Terrain (a test in `src/sim` style, on the compiled sample): walking up and down the steepest walkable slope, a Slide down it, a Knockdown on it, a Jump onto a hill and at a Cliff's Wall. Gait keeps its feet on the ground (no foot under the surface by more than the existing tolerance). If 45° fails, lower the default `cliff` and say so.
- **Done**: the slow tests pass, the timings are in the Result, and the user can play-test the Terrain sample from the Map Editor (Open example, then Play-test) with its hills under their feet, drawn as greybox until Stage 3.

## Stage 2: sculpting in the Map Editor
**Model**: Sonnet for the tools and panel, Opus for the checks.

- `src/mapEditor/session.ts`: `addTerrain(height)` (a flat Terrain at a level, by default the lowest; an undo step), `removeTerrain`, and `sculpt(tool, at, radius, strength, target?)` for Raise, Lower, Smooth and Flatten. Each dab moves the samples within `radius` by `strength` times a smooth falloff ((1 - d²/r²)², no trig), rounded to 0.05 m. Smooth moves toward the mean of each sample's neighbours, and Flatten toward `target` (picked with Alt+click, or the level being edited). In mirror mode each dab also applies at its half turn. A stroke is one undo step (`beginDrag`/`endDrag`), and dabs are spaced at a quarter of the radius along the pointer's path, so a stroke does not depend on the frame rate.
- `src/mapEditor/ui/`: a **Terrain tool** on the toolbar (key T) with its four modes (1 to 4), radius ([ and ] while it is picked, or the wheel with Shift) and strength in the panel, and a circle under the pointer showing the radius. The **top view** draws the Terrain as a shaded relief under the Brushes, with contour lines every metre (every 5 m darker) and Cliffs hatched. The **3D view** shows the Terrain mesh, rebuilt on each stroke's end (and live while sculpting if it stays under a frame). The status line shows the Terrain's height under the pointer.
- `src/mapEditor/checks.ts`: Cliffs that wall off a floor, a Brush cut into the Terrain with no way onto it, a Rail or Wall buried in or floating over the Terrain, an Objective or Base on a Cliff, and a steep spot just under the Cliff slope where Soldiers bunch (if Stage 1 found one). Each is listed, clickable, and drawn by the overlays.
- **Done**: on a New map, the user adds Terrain, sculpts a hill, a valley and a Cliff, draws a fort of Platforms on the slope, places an Objective on the hill, play-tests it, and Saves. The saved files reopen to the same Terrain, and a mirrored map stays its own half turn through every stroke.

## Stage 3: the look
**Model**: Sonnet.

- `src/render/mapModel.ts`: the Terrain mesh from the compiled draft's Terrain Walk Surfaces and the source's heights. The Cliffs are drawn too, as their triangles (no Walk Surface, but a face), and the cut pieces exactly as compiled, so what is drawn is what is stood on. It is blended by slope: grass to dirt to stone, with the thresholds as constants beside `MATERIAL_LOOKS`. Choose between per-vertex blend weights in the triplanar material and one mesh a material with a soft vertex-colour tint, whichever the existing `surfaceOf` path takes with less change, and name it in the Result. Brushes' faces against the Terrain are drawn in their own material, as faces are today.
- The ground beyond the field carries on at the Terrain's edge heights (as `battlefieldView.ts` does), not at the first Floor's.
- Props stand on the Terrain under them where there is no Brush floor nearer under their level.
- Save exports the model with the Terrain (`battle_<map>.glb`), and the Lobby's thumbnail shows it.
- **Done**: the Terrain sample and the user's own map look like hills in the play-test and in a Battle from the Lobby, with no seam between the drawn ground and where Fighters' feet stand (checked against the collider view).

## Later
- **Water and lava that flood the Terrain**: a Hazard at a height that floods every Terrain triangle below it (clipped at the waterline), for lakes and rivers in hollows.
- **Holes that cut the Terrain**: pits to an Abyss.
- **Brushes that follow the Terrain**: a Floor or Platform whose height is relative to the ground under it.
- **Finer Terrain (1 to 2.5 m)**: needs a heightfield ground the Simulation reads directly (`BattleMapTuning` carrying heights, `battlefieldHeight` and the Crowd reading them where no Walk Surface is), not thousands of Walk Surfaces. A Simulation change, so an ADR of its own.
- **Painted Terrain materials** (paths, sand, snow) over the slope blend.
- Terrain for Duel and Run Arenas.
