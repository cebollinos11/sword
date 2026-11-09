# Map Editor: author, check and play-test Battle maps in the browser

> Status: Stage 2 built (2026-11-09): live checks and overlays in the Map Editor (`checkMap`, the game's own walk check, walk rule and destination fields on the compiled draft), a list that selects and frames each check's Brushes, and a 3D view; Stage 3 (Battle markers, map settings and the Lobby reading map files) next. Seven Stages (0 to 6), each one chat (see "How to run each Stage"). Each Stage ends with a `### Result` written by whoever builds it (what was built, what changed from the plan, test counts), as in `docs/plans/battle-objectives.md`.

## Progress
- [x] Stage 0: the Map Source and its compiler (pure, no UI)
- [x] Stage 1: the editor shell (top view, Brushes, levels, save and load)
- [x] Stage 2: live checks and overlays
- [ ] Stage 3: Battle markers, map settings and the Lobby reading map files
- [ ] Stage 4: play-test from the editor
- [ ] Stage 5: the look (a generated model, materials, props)
- [ ] Stage 6: half-turn mirror mode and porting a real map

## Context
Every Battle map today (Fort, Ziggurat, City, Cavern) is written as a Python generator (`art/build_battle_<map>.py`) that lays out cells, platforms, ramps and rails, and exports two files:
- `data/battlemaps/<map>.json`: what the Simulation reads (ADR 0006, ADR 0022). Walk Surfaces (convex, planar within 1 cm, non-vertical; `lava` / `water` / `abyss`), Walls (segment, bottom, top), Blocks (box, top), Objectives (id, x, z, weight, owner, spawn, optional `y`), Bases, `front`, `armySize`, `ticketsPerSoldier`. Tuning Data, in the hash.
- `public/models/arenas/battle_<map>.glb`: the look only, loaded by `src/render/stage.ts` (`battle()`), textured by `texturedModel` (world-space triplanar).

New maps are made by the user describing them and an agent writing the generator. We want the user to build maps themselves in a web editor, like Valve's Hammer, play-test them in seconds, and iterate.

## Decisions
- **Brushes on a grid, compiled.** The user never draws Walk Surfaces. They place **Brushes** (high-level shapes) on a snapping grid, and a pure **compiler** turns the **Map Source** into an ordinary `BattleMapTuning`, exactly as the Python generators do from their rasters. What the Simulation reads is unchanged: no new Simulation rule, and a compiled map is just another `data/battlemaps/<map>.json`.
- **The Map Source is saved beside the compiled map**: `data/battlemaps/<map>.source.json`. The source is what the user edits; the compiled file is what ships. The source is **not** Tuning Data (it is not loaded by `loadTuningData`, nor hashed); the glob in `src/tuning/battle.ts` must skip `*.source.json`.
- **The compiler reuses the game's own validation**: `checkSurface`, `parseBattleMap` (export it if needed) and `walkCheck` (`src/sim/levels.ts`). The editor can never save a map the game refuses.
- **The grid**: coordinates snap to a whole fine step (default 0.5 m) so every coordinate is exact and neighbours share edges exactly (the navmesh needs it). A coarse grid shows the destination-field cell (`battle.squad`'s field cell, 4 or 5 m) so the user can keep Walls off cell centres.
- **Brush kinds** (Stage 0 compiles all of them):
  - **Floor**: an axis-aligned rectangle at a height. Several Floors at one height are cut and merged into convex rectangles.
  - **Platform**: a box from the ground to a top height. Its top is a Walk Surface; Walls stand on its faces; the ground under it is cut out (ADR 0022: "solid parts of a raised level stand over no ground").
  - **Ramp**: a rectangle sloped along one axis from one height to another (one of four directions). Optional rails on its open sides.
  - **Deck**: a raised floor over open space below (a bridge, the Fort's keep over its tunnel). Ground under it stays.
  - **Hole**: removes floor in its rectangle at one level (doorways, pits, corridors cut into a Platform).
  - **Hazard**: a rectangle of `lava`, `water` or `abyss` at a height.
  - **Rail** / **Wall**: a segment with a bottom and a top (rails default 1 m over the floor they stand on).
  - **Block**: the one-level solid box (`blocks`), only on a map with no raised levels (the compiler refuses a Block under a Deck).
  - The field's **edge Walls** are made from the map's size, always.
- **Rules the compiler applies on its own** (taken from the generators and ADR 0014): a Wall under every edge where the ground is higher than its neighbour (so nobody walks under a raised floor); Walls on every Platform face; ids are stable and readable (`WALK_<brush>_<n>`, `WALL_<brush>_<side>`), derived from Brush ids, so a small edit gives a small diff.
- **Battle maps first.** Duel and Run Arenas (`data/arenas/`, with spawns and jump Links) share Walk Surfaces and Walls; the Map Source keeps room for spawns, but authoring Arenas is Later.
- **The editor is a dev route**: `#/mapeditor?dev=1` (loaded on demand like `#/editor`), never in the shipped game's menus.
- **No Blender needed for a playable map.** Until Stage 5 a map with no `.glb` is drawn from its Walk Surfaces and Walls (greybox), as non-model Arenas already are.

## Glossary (proposed, for `CONTEXT.md` with the code that makes it true)
- **Map Source**: the editable description of a Battle map (Brushes, markers, settings), saved as `data/battlemaps/<map>.source.json`. Not Tuning Data. _Avoid_: level file, project.
- **Brush**: one shape of a Map Source (Floor, Platform, Ramp, Deck, Hole, Hazard, Rail, Wall, Block). _Avoid_: piece (that is a Kit's), prefab.
- **Map Compiler**: the pure function from a Map Source to a `BattleMapTuning`. _Avoid_: exporter, baker.
- **Map Editor**: the dev route that edits a Map Source. Not the Editor (which is the Motion Editor). _Avoid_: level editor.

## How it fits the existing code
- Pure modules live in `src/mapEditor/` (`source.ts` types and parse, `compile.ts`, `checks.ts`), unit-tested; the UI in `src/mapEditor/ui/`. No three.js or DOM in the pure part.
- Save goes through `saveJsonFile` (`src/editor/save.ts`): File System Access API, download fallback.
- Play-test injects the compiled map into a copy of the Tuning Data in memory, as `withArena` (`src/editor/arenaLab.ts`) does for Generated Arenas: `{ ...tuning, battle: { ...tuning.battle, maps: { ...maps, [name]: compiled } } }`, then starts the existing Battle routes (`startBattleSpectator`, `startBattlePlay`) on it.
- Caches keyed by Battle Tuning Data (the Battlefield, the destination fields, the navmesh) must rebuild for a changed draft: check how they are keyed before Stage 4 and key by the map object if needed.

## Working rules for every Stage
- Deterministic and pure where it feeds the Simulation: the compiler uses no trig on coordinates, no `Math.random`, and breaks every tie by Brush order, so the same source always compiles to the same bytes.
- The four shipped maps and every existing test stay unchanged until Stage 6, which only adds a ported map.
- `npm run typecheck` and `npm test` clean at the end of every Stage; slow tests (`npm run test:slow`) where a Stage touches Battles.
- Match the repo's comment style (the code explains rules in domain terms from `CONTEXT.md`).

## How to run each Stage
- **One chat per Stage**, started fresh with `docs/plans/map-editor-prompt.md`. The Stage's own list and its "Done" are the brief.
- **The model each Stage names.** Sonnet where the work is well specified and tests catch mistakes; Opus where it is geometry or judgement.
- **A review before the commit**: `/code-review` at `high` on the Stage's diff, against this plan. Fix what it finds, then commit.
- **Stop at the Stage's "Done"**, write its `### Result`, tick it under Progress, push, and stop for a playtest.

## Stage 0: the Map Source and its compiler
**Model**: Opus (cutting convex surfaces, ground cut out under levels, skirt Walls).

- `src/mapEditor/source.ts`: the Map Source types (name, size, grid, levels, Brushes with ids, Objectives, Bases, `front`, `armySize`, `ticketsPerSoldier`, a `lobby` block for Stage 3) and a validating parser in the style of `src/tuning/validate.ts`. A `version` field.
- `src/mapEditor/compile.ts`: `compileMap(source, tuning) → { map: BattleMapTuning, warnings }` or a thrown error naming the Brush. Per level: rasterise Brushes on the fine grid, apply Holes, cut out the ground under Platforms and Ramps, merge cells into maximal rectangles (row-major, ties by index), emit Ramps as their own sloped quads, emit Walls (Platform faces, skirts under raised edges, Rails, Walls, field edges), carry Hazards and Blocks through.
- Every compiled map is run through `parseBattleMap` and `walkCheck`; the error is reported against the Brushes it concerns where it can be.
- Tests (`compile.test.ts`): a flat field; a Platform with a Ramp (Soldiers and Fighters reach the top: `walkCheck` passes, the navmesh joins it); a Deck over a tunnel (two levels at one x, z); a Hole making a doorway; lava 8 m down beside a bank; a Block under a Deck refused; a disjoint Platform with no Ramp refused by `walkCheck`; the same source compiles to identical JSON twice; ids are stable when an unrelated Brush is added.
- A small script or test that compiles a sample source to `data/battlemaps/` is **not** committed as a shipped map yet.
- **Done**: the tests pass, and a hand-written sample source (a platform, two ramps, a deck, a lava pit, five Objectives) compiles to a map that a whole AI Battle runs on in a slow test (`createMatch` + `stepMatch` to the end, no throw).

### Result
Built:
- `src/mapEditor/source.ts`: the Map Source types and `parseMapSource` (in the style of `validate.ts`; it accepts its own output). `version` 1, `name`, `size`, `grid` (`step`, a whole number of quarter metres, default 0.5; `cell`, the coarse grid, 5), `levels` (ascending heights: every Brush height must be one), `brushes` in paint order, `objectives`, `bases`, `front`, `armySize`, `ticketsPerSoldier`, `lobby` (`label`, `where`, `blurb`, `art`, carried for Stage 3). Rectangles are `{ x0, z0, x1, z1 }`, points `{ x, z }`, sides the compass `n e s w` (north is +z). A Ramp has `lo`, `hi`, `up` (the side its high end lies along) and `rails` (its long sides that carry one).
- `src/mapEditor/compile.ts`: `compileMap(source, battle) → { map, warnings }`, or a `MapCompileError` with `brushes` (the ids it concerns); `mapFileText(map)` writes the file in the generators' layout, one entry a line, which `parseBattleMap` reads back as the same map. The compiler runs every map through `parseBattleMap` (now exported) and `walkCheck` over the map's Walls and its Blocks' Walls (`blockWalls`, now exported from `battlefield.ts`), and names the Brush of the Walk Surface `walkCheck` cannot reach, or of the `walk[i]`, `walls[i]`, `blocks[i]` `parseBattleMap` refuses.
- The `battle.maps` glob in `src/tuning/index.ts` skips `data/battlemaps/*.source.json`.
- Tests: `src/mapEditor/compile.test.ts` (20 fast: every case in the list above, plus the skirt, Blocks, the game's refusals, a Ramp's way, warnings, the source parser, and a purity scan of `src/mapEditor/*.ts` for randomness, clocks, trig, DOM and three.js) and `src/mapEditor/sample.slow.test.ts` (the whole Battle). The sample is `src/mapEditor/sample.testdata.ts` (a keep with B on it, a railed ramp up its south and north faces, a bridge east off the keep over an 8 m lava pit to C at its dead end); it is not in `data/battlemaps/`.

How the rules came out (beyond the plan's list):
- **Paint order with two exceptions.** Floors, Decks, Hazards and Platforms paint in Brush order (a Platform cuts out everything under its top, so a Floor after it puts a corridor's floor back under its roof). A Hole takes away, at its level, what the Brushes *before* it laid there; a Hole at a Platform's top removes the Platform there wholly, so its ground comes back: that is a doorway or a corridor open to the sky, with jambs from the face rule. Ramps and Blocks cut out the floor under them after all painting, whatever their order, so a Platform a Ramp stands on may come after it.
- **Floor and Deck compile the same** (neither cuts anything); the name says what the author means, and Stage 2's checks can use it. A raised Floor over nothing gets faces like a Platform.
- **The face rule** is the Cavern generator's: from a floor at `y`, across a cell side, where the cell beside has no floor within `battle.levels.stepUp` of `y` but one higher, a Wall from `y - 1` to the lowest such floor, owned by that higher Brush and named from its side (`WALL_keep_s0`). Nothing faces from deadly ground (a lava pit's sides are open banks, as the Cavern's are). A bank beside lava *under a Deck* gets a face from the ground up to the Deck (nobody walks under a raised floor), as in the Cavern.
- **Ramps**: a Ramp's ends join floor at their heights and are faced where the floor beyond is higher. Its long sides get a face where the floor beside is higher than the slope there plus a step, and a rail (from 1 m under the lowest floor beside to 1 m over its top, as the generators' rails) or else a **stepped skirt**: `ceil((hi - lo) / stepUp)` Walls, each topped at the slope's height at its high end, left out where the floor beside is within a step of that top, so nobody on the ramp is stopped sideways and nobody beside it walks in under it. Nothing may lay floor in a Ramp's rectangle from its foot to `battle.levels.height` over its top; Ramps may not overlap, nor a Block or a Platform reaching above a Ramp's foot.
- **Blocks**: a Block cuts out the floor under it; it is refused when anything stands above its floor in its rectangle (a Deck), and when the Simulation's Walls round it (from -1, `blockWalls`) would not stand across a body on its floor.
- **Ids**: Walk Surfaces `WALK_<brush>_<n>` (a Ramp's `WALK_<ramp>`), Walls `WALL_edge_<side>`, `WALL_<brush>_<side><n>`, `WALL_<ramp>_<side>` (a rail), `WALL_<rail or wall>`, Blocks `BLOCK_<brush>`. Brush ids are letters, digits and `-` (no `_`), so no two can collide. **Changed from the plan**: rectangles are merged per Brush, not across all Floors at one height, so a Brush's ids change only when something overlaps it; adding a Brush elsewhere renumbers only the ground's rectangles it cuts (tested). The ground of the sample is 11 rectangles.
- **Warnings** (the map still compiles): a Brush painted over or taken away wholly, a Hole that takes nothing away, and a floor with an open edge over nothing (no floor at any height beyond it). Stage 2 adds the rest.
- The map's `size` must be the Battle's `field.size` (200), as `parseBattleMap` requires a floor reaching every side of the field; every source so far is 200 m.

Measured: the sample compiles in about 23 ms (median of 15 in Vitest; most of it `walkCheck`'s edge probes) to 16 Walk Surfaces and 18 Walls. Its whole AI Battle (144 v 144, 2.4 Tickets a Soldier) ends by Tickets after 421 s of Battle time, in 4 to 5 s of running. `npm test`: 1984 passed (20 new); `npm run test:slow`: 23 passed (1 new); `npm run typecheck` clean. No shipped map and no existing test changed.

To try: nothing in `npm run dev` yet (`#/mapeditor?dev=1` is Stage 1). In a test or a Node script, `compileMap(sampleSource(), loadTuningData().battle)` and `mapFileText` give the sample's map file.

## Stage 1: the editor shell
**Model**: Sonnet.

- Route `#/mapeditor?dev=1` in `src/main.ts`, loaded on demand.
- A **top view** (orthographic three.js or 2D canvas): the fine and coarse grids, pan and zoom, Brushes drawn by kind and height (colour by level), the current level solid and the others faded.
- A Brush palette; place by drag on the grid; select, move, resize by handles; delete; duplicate; a property panel (Tweakpane, as the Editor uses) for the selected Brush's numbers.
- Levels: a list of heights; pick the level to edit; "show all / this one".
- Undo and redo over the whole Map Source (a stack of snapshots is fine at this size).
- New, Open (pick a `.source.json`, or one of `data/battlemaps/*.source.json` bundled in dev), Save (writes both `<map>.source.json` and the compiled `<map>.json` through `saveJsonFile`). Save refuses with the compiler's error shown.
- The editor state and its operations live in a pure, unit-tested `MapEditorSession` (as `EditorSession` does for Motions); the UI only calls it.
- **Done**: the user can rebuild Stage 0's sample by hand in the browser, save it, and the saved files match what Stage 0's compiler gives.

### Result
Built:
- `src/mapEditor/session.ts`: `MapEditorSession`, the Map Editor's one source of truth (pure, no DOM or three.js; the purity scan of `src/mapEditor/*.ts` covers it). Every edit makes a new source and passes it through `parseMapSource` first, so the session never holds a source the parser refuses: a refused edit throws the parser's error and changes nothing. Operations: `addBrush(kind, from, to)` (snapped; a click makes one coarse cell, a segment one cell long), `replaceBrush` (the property panel; renames keep the selection), `moveBrush`, `resizeBrush` (by `Handle`: a rectangle's corners and sides' middles, never thinner than a step; a segment's ends), `deleteBrush`, `duplicateBrush` (a coarse cell east, painted right after), `reorder` (paint order), `addLevel`, `removeLevel` (refused while a Brush stands at it), `setSettings`, `open`, `undo` and `redo` (a stack of 200 source snapshots), `beginDrag`/`endDrag` (a drag is one undo step, each move measured from where it began), `dirty`, and `files(battle)`, which gives Save's two files or throws the compiler's `MapCompileError`. An edit that changes nothing is no step. Picking helpers for the top view: `brushAt`, `handleAt`, `handlesOf`, `brushLevels`. `sourceFileText` writes a source one Brush, Objective and Base a line (sharing `compile.ts`'s `list`), and `parseMapSource` reads it back as the same source.
- How a new Brush stands, at the level being edited: a Floor, Deck, Hole, Hazard (lava) or Rail (1 m) at it; a Platform or a Ramp rising from it to the level above (on the top level, to it from the one below), a Ramp up its long side (north or east), railed on both long sides; a Wall from 1 m under it to 3 m over; a Block 3 m over it (refused, saying why, where that is not over 0).
- `src/mapEditor/ui/` (only calls the session): `topView.ts`, a 2D canvas top view (north up). It draws the fine grid where it is 6 px or wider, the coarse 5 m cell, the axes and the field, each Brush by kind (Floor filled, Deck hatched, Platform thick-edged, Ramp with chevrons up its slope and its rails, Hole see-through with a cross, Hazard in its colour, Rail and Wall as lines, Block grey) in its level's colour, the level being edited solid and the others faded or hidden, the Objectives and Bases (drawn only; Stage 3 drags them), and the selected Brush's handles. Pointer: draw with a Brush tool; with the select tool, click to pick (the level being edited first, then any shown), drag to move, drag a handle to resize; pan with a right or middle drag or a drag on empty ground; zoom with the wheel about the pointer. `index.ts`: the Tweakpane panel (File: New, Open example, Open `.source.json`, Save; the tool; Edit; Levels; the selected Brush's numbers; Map: name and each Objective's numbers; status and the pointer's snapped coordinates) and the keys (V F D P R H Z L W B pick tools, Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, Ctrl+D, Ctrl+S, Del, Esc, `[` `]` paint order, arrows nudge by a step, with Shift by a cell). Save writes `<map>.source.json` then `<map>.json` through `saveJsonFile`; a source that does not compile is not saved, its error is shown, and its Brushes are outlined in red and the first selected. The dev server puts the session in the console as `mapEditor`.
- The route `#/mapeditor?dev=1` in `src/main.ts`, loaded on demand (`devMode()`, as the Battle routes).

Changed from the plan:
- **A 2D canvas, not three.js**, for the top view: what Stage 1 draws is flat, and Stage 2 adds the 3D view.
- **Open example** offers Stage 0's sample (imported from `sample.testdata.ts`) besides any `data/battlemaps/*.source.json` (none yet), so there is a whole map to look at and compare with.
- **The Map folder** edits the name and the Objectives' numbers already (the sample's C is at x 40, not the blank map's 50, so the Done needs it); dragging markers, the Bases, `front`, the army and the Lobby card stay Stage 3's.
- **Saving two files from one click**: a browser may allow only one save dialog a click; if it refuses the second, the status says to click Save again (the first file is remembered and not asked again).
- **Tweakpane's `refresh()` reports the values it shows as changes**: the panel ignores them while it syncs, and the session takes an edit that changes nothing as no step (else an undo was written straight back as a new edit, found in the browser check).

Tests: `src/mapEditor/session.test.ts`, 23 fast, among them the Done: the sample rebuilt by the session's operations (drawn off and resized by a handle, a Ramp drawn in the wrong place and dragged, renamed and turned in the panel, levels added, C moved) saves exactly `sourceFileText(sampleSource())` and `mapFileText(compileMap(sampleSource()))`. `npm test`: 2007 passed (23 new); `npm run typecheck` clean. No Battle runs in this Stage, so no slow test changed. Checked in headless Chromium: drawing, moving, the panel's fields, undo, a refused Save, and a Save after undoing every edit giving the sample's exact files, with no console errors.

Measured: the session's `files` (compile and both texts) for the sample takes 23 ms, a move 0.05 ms (median of 15 in Vitest).

To try in `npm run dev` at `#/mapeditor?dev=1`:
- File, Open example: Stage 0's sample. Switch Levels, editing between -8, 0 and 4 m and toggle "show all levels"; zoom in until the 0.5 m grid shows.
- Rebuild the sample on New map: add levels 4 and -8; on 0 draw a Platform (it rises to 4) over x -12 to 12, z -8 to 8, two Ramps (set the north one to rise toward south), a Hole x 20 to 36, z -12 to 12; on -8 a Hazard there; on 4 a Deck x 12 to 44, z -3 to 3 and two Rails along its sides; rename each in the Brush panel (keep, rampS, rampN, pit, lava, bridge, bridgeRailS, bridgeRailN, in that paint order); Map: name `sample`, Objective C x 40. Save, and compare the files with the sample's (Open example, Save under another folder).
- Draw a Platform with no Ramp and Save: refused, the Platform outlined in red. Undo and redo across drags; Ctrl+D; `[` and `]`; arrows.

## Stage 2: live checks and overlays
**Model**: Opus (the checks must say what the Simulation will do).

- Compile on every edit (debounced; it must stay well under 100 ms on a City-sized source, measure it) and show errors and warnings in a list, each clickable to select its Brush and frame it.
- Overlays, each toggleable:
  - **Reachability**: Walk Surfaces coloured by whether `walkCheck` reaches them from the first; unreachable ones flash.
  - **Edges**: each Walk Surface edge coloured walk (step up at most `battle.levels.stepUp`), drop only (at most `battle.levels.drop`), blocked (Wall at body height) or open ledge.
  - **Clearance**: the destination fields' clearance as a heat map, from the real field build (`battleMapOf`), so the user sees where Formations narrow to one file.
  - **Field cell centres**: dots at the coarse grid's centres, red where a Wall or Block edge lies on one (the Fort and Cavern both hit this).
- Warnings: lava (or any deadly ground) within `battle.levels.drop` under a walkable ledge; a Block under a Deck; an Objective with no Walk Surface under it, or stacked over another level without `y`; a Base off the floor; a Ramp steeper than Fighters walk.
- A **3D view** (orbit camera) of the compiled greybox, with the same overlays, beside or switchable with the top view.
- A cost line: Walk Surface and Wall counts, navmesh build time (measured here, as the Arena Lab does with a clock), compile time.
- **Done**: on deliberately broken sources (a floating Platform, lava 2 m under a bank, a rail on a cell centre) each check fires and points at the right Brush; on Stage 0's sample none does.

### Result
Built:
- `src/mapEditor/checks.ts` (pure, in the purity scan): `checkMap(source, tuning) → MapChecks`, every check the game's own code on the compiled draft. `compile.ts` now splits `compileMap` into `compileDraft` (the map `parseBattleMap` accepts, the Brush of each Walk Surface, Wall and Block, and the Arena a Battlefield stands Soldiers on) and `walkChecked`; `compileMap` is the two together, unchanged. `levels.ts`'s `walkCheck` is now `walkReach` (the one probe pass and the reach both ways, its probes passed out to a caller) plus the same verdict; nothing in the Simulation changed, and the editor reads the checks from the very pass `walkCheck` decides by. The checks:
  - **Reachability** (error): per Brush, its Walk Surfaces Soldiers cannot walk to from the first, or back. Save refuses for the same reason (`walkChecked`), naming the same Brush.
  - **Edges** (only while the edges overlay is on, `checkMap(…, { edges: true })`: classifying every probe costs a third more on a big map): every probe of that pass, merged into runs per edge: walk, drop (one way), Wall (`walled` at the step) or ledge.
  - **Deadly ground within a drop** (warning): a walk or drop onto lava, water or abyss, naming the hazard, then the bank.
  - **Walls through the destination fields' cell centres** (warning, on a map of several levels): every Wall (a Brush's, a face, a rail, a Block's sides; not the field's edge) through a `battle.crowd.flowCell` centre, standing across a body on a floor there, as `walled` counts heights. Such a node is cut off from all its neighbours (each join starts or ends on the Wall, and `walled` counts a touch). A one-level map's fields read no Wall, so it has none.
  - **Objectives and Bases** (warning, where the Battlefield stands them, `groundNear`): no floor under it, on deadly ground, an Objective's `y` naming no floor there; an Objective over several levels without `y` is a **note** (it takes the highest, as the Fort's B does by design; capture is level-aware, so only Soldiers on that level take it).
  - **Ramps steeper than a Fighter walks** (warning): one Tick at its fastest walk (Sheathed) climbing more than `fall.stepUp` or falling more than `fall.snapDown` (`settleGround`'s rule); `steepestRamp` is about 5.2 m a metre today, so only a very short Ramp fires.
  - The compiler's warnings, and its refusal (one error, its Brushes; nothing else is checked).
  - `fieldClearance(checks, battle)`: the real fields (`battleMapOf` on the draft): each node's clearance and the files a Formation fits there (`filesFit`, now exported from `squad.ts` and used by `formationNarrow`). `issueBounds` frames an issue (its Brushes, or its point where its Brush is the whole ground).
- UI (`src/mapEditor/ui/`): the source is checked 120 ms after each edit (timed in the UI), and the list of checks sits under the view, errors, warnings, notes; clicking one selects its first Brush (switching to its level), outlines all of them in red and frames them in both views. The Checks folder: top view or 3D view, the overlays (reachability, flashing where unreached; edges, each kind on its own; clearance; field cell centres, red where a Wall cuts one off), a legend, the cost line (Walk Surfaces, Walls, Blocks, compile + checks ms, the fields' build ms once clearance is on) and a **Measure navmesh build** button (the Fighters' navmesh of the draft, timed as the Arena Lab times it). `view3d.ts`: the draft as `greybox` draws it (Walls triplanar stone), lava and water coloured, the same overlays, the Objectives and Bases as posts, axes at the centre, an orbit camera framed once per map.
- `src/mapEditor/sample.testdata.ts`: `citySizedSource()`, 63 buildings with ramps, notches and railed bridges: 626 Walk Surfaces and 809 Walls compiled (`city.json`: 634 and 280).

Changed from the plan:
- **The sample fires the cell-centre check.** The plan's Done says Stage 0's sample fires none, but the destination fields' cell is 4 m (`crowd.flowCell`), not the source's 5 m coarse grid, and the sample's keep faces (x ±12, z ±8), its ramps' rails (x ±4) and the pit's bank under the bridge (x 20, 36) lie on 36 of its centres, whose nodes are cut off: that is what the Simulation does with it (the Fort and Cavern have it too). The checks say so rather than hide it; the sample is left as it is (Stage 1's tests rebuild it exactly). Its other checks are clean; C's over-two-levels is a note. The test pins this list exactly.
- **Block under a Deck** stays the compiler's error (it was already refused), shown in the list.
- **The navmesh is measured on demand**, not after every edit: on a City-sized map it takes about 150 ms on the main thread. The fields' clearance is built only while its overlay is on, once the edits pause (700 ms).
- **The top view is a mirror of the world.** Stage 1 draws east (+x) right with north (+z) up, which is the field seen from below: seen from above (the 3D view, and the game), east lies left of north. The 3D view shows axes (x red, z blue) so the two can be matched. Not changed here (it is Stage 1's view and every gesture in it); worth deciding before Stage 4's play-test.

Tests: `src/mapEditor/checks.test.ts`, 11 fast, among them the Done: a floating Platform (an error naming it; its top unreached; Save refuses naming it too), lava 2 m under a bank (a warning naming the lava, then the ground; 8 m down fires nothing), a Rail on a 4 m centre (a warning naming it, its three centres; one at x 21 fires nothing; on a one-level map nothing), and the sample's exact list. Also the edges (drops off a 3 m keep, Walls at its faces and the ramp's rails, ledges off a 4 m one, runs covering each edge end to end), the markers and a steep Ramp, a refused source, framing, clearance (one file on the 6 m railed ramp, a full line in the open), determinism, and the City-sized source checking clean. `src/mapEditor/checks.slow.test.ts` times it (asserting the fastest run under 100 ms: the median carries the other slow files running beside it). `npm test`: 2019 passed (12 new, with the purity scan of `checks.ts`); `npm run test:slow`: 24 passed (1 new); `npm run typecheck` clean. No shipped map and no existing test changed.

Measured (Vitest, fastest / median, on this 4-core VM, which is noisy): the City-sized source's live checks (compile, walk check and every check but the edges and clearance) 48 / 56 to 76 ms, of which about 40 ms is the game's walk check on a fresh map (the same pass Save's compile runs) and 19 ms the compile; with the edges 62 / 70 to 95 ms; with the fields' clearance about 360 ms. Run against another full test suite at once, the median reached 105 ms. The sample: 20 to 26 ms, clearance 47 to 63 ms. In headless Chromium the sample's checks took 38 to 55 ms, its navmesh 11 to 19 ms, its fields 49 to 74 ms; `city.json`'s navmesh builds in about 150 ms. Checked in headless Chromium: Open example, draw a Platform with no Ramp (the error, its floor flashing, a click selecting and framing it), add a level -2 with a Hole and lava under it and a Rail at x 60 (both warnings; clicks select `hazard1` and `rail1`), edges and clearance on, the 3D view (focused on the lava from the list), Measure navmesh, back to the top view; no console errors.

To try in `npm run dev` at `#/mapeditor?dev=1`:
- File, Open example: the list shows the sample's four cell-centre warnings and C's note; zoom in on the keep to see the red dots on its faces. Click a warning to select and frame its Brush.
- Draw a Platform (P) on open ground: an error, its floor flashing red; Save refuses. Add a Ramp (R) up to it and watch the error go.
- Add a level -2, a Hole at 0 and a Hazard at -2 under it: the lava warning; set the Hazard's level to -8 (add it): gone.
- Draw a Rail (L) along x = 60: a cell-centre warning; nudge it with the arrows half a metre: gone.
- Checks: turn on edges (walk off, drop, Wall, ledge on), clearance (red where a Formation goes in one file), and switch the view to 3D; Measure navmesh build.

## Stage 3: Battle markers, map settings and the Lobby reading map files
**Model**: Sonnet.

- Place and drag Objectives (id, weight, starting owner, spawn, optional `y` set from the level they are placed on), the two Bases, and the `front` line (drawn for both Teams).
- A map settings panel: name (lower-case letters and digits, as `battle.maps` requires), size, `armySize.standard` and `max`, `ticketsPerSoldier`, and the Lobby card: `label`, `where`, `blurb`, `art` (the gradient).
- The Lobby card moves into the map: `BATTLE_MAPS` in `src/play/lobbyView.ts` reads `label`, `where`, `blurb`, `art` from `battle.maps[<map>].lobby` when the file has it, falling back to today's hard-coded entries. Add `lobby` (optional) to `parseBattleMap`. It is render-only text but lives in a hashed file; that is fine (peers must have the same map anyway). The four shipped maps keep their entries until Stage 6.
- **Done**: a map saved from the editor into `data/battlemaps/` appears in the Lobby's map picker with its card, and a Battle starts on it, with no code change.

## Stage 4: play-test from the editor
**Model**: Opus (caches, the Battle routes, and what "stuck" means).

- A **Play-test** button with three modes, all on the in-memory draft (no save, no reload):
  - **Spectate**: an AI-v-AI Battle on the draft, at a chosen speed (the debug view `src/editor/battleView.ts` or `startBattleSpectator`).
  - **Play**: the Player's Fighter among the armies (`startBattlePlay`).
  - **Walk**: the Player alone on the map with no armies, to check heights, ramps and sightlines quickly.
- Back to the editor with the camera where it was, and edits kept (the session survives the play-test: run it in the same page, not a reload).
- A map with no `.glb` is drawn from its Walk Surfaces and Walls in the Battle renderer (`src/render/stage.ts` `battle()`), as non-model Arenas are; the triplanar textures apply to it.
- **While spectating**, overlays: Objective owners and progress, and a **stuck heat map** (where Soldiers stood out of their place longer than a few seconds, the measure Stage 3b of `battle-objectives.md` used).
- **Quick check**: a headless button (or `npm` script over a source file) that runs N fast AI-v-AI Battles on the draft and reports Battle length, captures per Objective, Ticket curve and stall time. Seeds fixed so a rerun is comparable.
- Make sure the Battlefield, destination fields and navmesh caches rebuild for a changed draft (key them by the map object, or clear them on play-test).
- **Done**: edit, play-test, return, edit again, play-test again, in under ten seconds a cycle on the sample map, with the second play-test showing the edit.

## Stage 5: the look
**Model**: Sonnet (Opus if the mesh generation needs it).

- Each Brush gets a **material** from a small palette (stone, basalt, brick, wood, grass, sand, metal, lava glow…) and the compiled model is generated from the Brushes: tops, faces, rails, hazard surfaces, using the triplanar textures already in `src/render/triplanar.ts`.
- **Export** it as `public/models/arenas/battle_<map>.glb` with three.js `GLTFExporter` on Save, so the game's loading path is unchanged.
- **Props**: render-only objects placed on the map (trees, rubble, banners, crates, torches with lights), from a small set of models (`public/models/props/` or the Kit's pieces). They never reach the compiled map.
- Sky and light: pick one of the Stage's existing looks for the map (store the choice in the map's `lobby`/look block, render-only).
- **Done**: a map made only in the editor looks finished enough to ship, with no Blender step.

## Stage 6: mirror mode and porting a real map
**Model**: Opus.

- **Half-turn mirror mode**: Brushes, Objectives and Bases placed in it get a linked half-turn twin (x, z → -x, -z), edited together; the compiler orders mirrored output so Objective k mirrors n-1-k and Block k mirrors n-1-k (ADR 0022). Turn a twin pair back into two free Brushes on request. A check reports where a mirrored map is not its own half turn.
- **Port the Fort** into a Map Source (by hand in the editor, or by a one-off script from `art/build_battle_fort.py`'s numbers), compile it, and compare with the shipped `fort.json`: same Objectives, Bases and levels, `walkCheck` passes, and a whole AI Battle lands within the Fort's measured length. The shipped file is replaced only if the user wants it after playing both.
- Write ADR 0023 ("Battle maps are compiled from a Map Source") once the format has held through a real map.
- **Done**: the Fort, or a new mirrored map, is authored entirely in the editor and plays as well as the Python-built one.

## Later
- Duel and Run Arenas from the editor (spawns, jump Links, `data/arenas/`).
- Free polygon Brushes (non-rectangular floors), arcs and stairs.
- Kits from the editor (ADR 0014 Pieces).
- Sharing drafts with a friend online for a play-test (needs the draft sent through the Lobby and both peers' Tuning Data to agree).
