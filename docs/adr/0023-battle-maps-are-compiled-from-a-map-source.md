# 0023 — Battle maps are compiled from a Map Source

## Status

Accepted (2026-11-09, `docs/plans/map-editor.md`). Stages 0 to 5 built the Map Source, the Map Compiler, the Map Editor, its checks, Play-test and look; Stage 6 added half-turn mirror mode and ported the Fort into a Map Source, which compiles to the shipped Fort's ground, Blocks, Walls, Objectives and settings and plays the same Battles seed for seed. The four shipped maps are still built by their Python generators; nothing here changes them.

## Context

ADR 0022 made a Battle map `ArenaGeometry` exported by a Blender generator (`art/build_battle_<map>.py`): every map is a Python program that lays out cells, platforms, ramps and rails and writes `data/battlemaps/<map>.json` (what the Simulation reads, in the Tuning Data hash) and `battle_<map>.glb` (the look). Each new map has meant an agent writing a generator from a description, and a Blender run for every change. We want the user to build maps themselves, play-test them in seconds and iterate. The ways to do it:

- **Edit the compiled map** (Walk Surfaces and Walls by hand): no new format, but nobody can keep convex surfaces sharing edges exactly, skirts under every raised edge and the half turn by hand.
- **A generator per map, kept**: the generators stay the source of truth and the editor only previews. Every edit is still code.
- **A higher-level source compiled by the game's own rules**: the user places shapes on a grid, and a pure compiler turns them into an ordinary map the way the generators do, checked by the game's own validation.

## Decision

- **A Battle map can be compiled from a Map Source** (`data/battlemaps/<map>.source.json`, `src/mapEditor/source.ts`): Brushes in paint order on a fine grid (Floor, Deck, Platform, Ramp, Hole, Hazard, Rail, Wall, Block), the levels they stand at, the Objectives, Bases, `front`, army size, Tickets and Lobby card, and the render-only look (each Brush's material, the props, the sky). The source is **not** Tuning Data: it is never loaded by `loadTuningData` nor hashed. What ships and what the Simulation reads is the compiled `<map>.json`, an ordinary map file; no rule of the Simulation knows a map came from a source.
- **The Map Compiler is pure and deterministic** (`compileMap`, `src/mapEditor/compile.ts`): no trig, no randomness, ties by Brush order then cell order, every id made from a Brush id, so the same source always gives the same bytes and a small edit a small diff. It applies the generators' rules on its own (a face under every raised edge, owned by the higher Brush; rails or a stepped skirt on each Ramp; the field's edges) and hands every map to the game's own `parseBattleMap` and `walkCheck`, so it can never give a map the game refuses; its errors name the Brushes concerned.
- **The look is generated from the same source** (`mapModel`) and exported as `battle_<map>.glb`, so a map needs no Blender step; it stays render-only.
- **A mirrored source** (`mirror: true`) keeps ADR 0022's "the map is its own half turn" by construction: each part's twin is linked in the source and edited with it, the compiler lists Objectives and Blocks so that k mirrors n - 1 - k and merges Walk Surfaces in a way the half turn keeps (each row's runs, then runs alike stacked, as the Fort's generator does), and the editor's checks name every part that is not its own half turn. A source with no mirror data compiles exactly as before.
- **The editor is a dev route** (`#/mapeditor?dev=1`), not part of the shipped game.

## Consequences

- A new map is a Map Source the user draws, checks, play-tests and saves; the Lobby offers it with no code change (ADR 0022's "the Lobby needs a name for it" no longer holds: the file carries its card). A map from a source has a `<map>.source.json` beside it, and its model is listed from the sources (`EDITOR_BATTLE_MAPS`).
- The format held through porting a real map: the Fort as a Map Source (`docs/plans/map-editor/fortport.source.json`, 34 Brushes) compiles to the generator's 49 ground rectangles in its order, its 22 Blocks in its order, its keep's faces, tunnel, parapet and ramp rails exactly, and its Objectives, Bases, front, army size and Tickets, and whole AI Battles on it are the shipped Fort's, seed for seed. It differs where the source is simpler than the generator: the keep's deck is three Walk Surfaces (two Platforms and a Deck), where the generator cuts it into nine along the ramps' sides, and the field's edge Walls stand 4 m over the highest floor (8 m, not 4). Neither changes a Battle.
- Two descriptions can exist for a shipped map (a generator and a source); until the user chooses, the generators stay the source of truth for the four shipped maps, and Save refuses their names.
- What a Brush can say bounds what a map can be: axis-aligned rectangles and segments on a grid. Free polygons, arcs and stairs, and Duel and Run Arenas, are Later.
- Ids follow Brush ids (`WALK_<brush>_<n>`, `BLOCK_<brush>`), not the generators' (`WALK_000`, `BLOCK_00_<id>`), so a ported map's file and its Tuning Data hash differ from the generator's even where its geometry is the same.
