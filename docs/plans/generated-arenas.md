# Generated Arenas: assembled from a Blender kit, tested in a dev Arena Lab

> Status: Stages 1–3 done (the Arena Lab: `#/editor/sandbox?dev=1`, "Generated Arena" folder; the soak: Stage 3, Result). Stage 4 done as a greybox pipeline (Stage 4, Result); a themed Kit is art only. Next: Stage 5.

## Context

Every Arena today is hand-modelled: a Blender generator (`art/build_<name>.py`) writes the look (`.glb`) and the sim geometry (`data/arenas/<name>.json`) from the same layout numbers (ADR 0006). We want Arenas generated from a seed, so every Match (later every Duel, or every Gauntlet Floor, `docs/plans/gauntlet.md`) can be fought somewhere new.

The AI already handles any valid `ArenaGeometry` without per-Arena data:
- The navmesh is built from the Walk Surfaces themselves (ADR 0006).
- Jump Links come from simulated arcs with an error check (ADR 0011).
- Shortcut Jump Links are found the same way (ADR 0013).

Most of the work is in generating good layouts, the look, and keeping online peers in sync.

### Design in one paragraph
A pure **layout generator** turns `(kit, seed, params)` into a **Layout**: a grid of **Pieces** (piece id, cell, height, quarter turn). A pure **assembler** turns the Layout into an ordinary `ArenaGeometry` by placing each Piece's own Walk Surfaces and Walls, then adds an Abyss under everything and the spawns. A **judge** checks the result with the real navmesh and rerolls if it fails. To the Simulation, the AI and the camera, a generated Arena is just another Arena. The **Kit** begins as grey placeholder Pieces written in TypeScript and is later replaced by Pieces modelled in Blender, each with its collision helpers. The generator never changes when that happens.

### Constraints
- **Deterministic** (ADR 0001, ADR 0005): every peer must build exactly the same Arena from the same seed.
  - Seed the generator with `createRng` / `nextFloat` from `src/sim/rng.ts`, never `Math.random`.
  - Break ties by index, and never iterate over unordered maps.
  - Use no trig: positions are whole grid cells times the cell size, and turns are quarter turns (swap and negate x and z), so every coordinate is exact.
- **Geometry rules the Simulation and navmesh already rely on** (`src/tuning/arena.ts`, ADR 0011):
  - Walk Surfaces are planar and convex.
  - Neighbours share edges exactly, or no walk Link joins them.
  - Every gap has ground below it (an Abyss), because a Fighter in the air with nothing below it is held where ground last was.
  - `parseArena` must accept every generated Arena: run it on the output in tests.
- **Don't change any existing Arena or test outcome.** The generated Arena is added beside them, never in place of one.
- **Vocabulary:** use `CONTEXT.md` terms (Arena, Walk Surface, Wall, Abyss, Link, Jump). Add the new terms below to `CONTEXT.md` once Stage 1 lands, and write ADR 0014 then too.
- **Each stage is its own commit (or a few),** with `npm test` and `npx tsc --noEmit` green. Build test-first (`tdd` skill).

### New terms (for `CONTEXT.md`)
- **Generated Arena:** an Arena built at run time from a Kit, a seed and generator settings, rather than read from `data/arenas/`. Its name records how it was made (for example `gen:greybox:1234`), so the same name always builds the same Arena.
- **Kit:** a set of Pieces sharing one grid size and set of heights, with one look (a theme).
- **Piece:** one placeable part of a Kit (a floor tile, a ramp, a pillar, a railing, a bridge): its look plus its own Walk Surfaces and Walls, all relative to its grid cell.
- **Layout:** the Pieces a seed places, before they are assembled into an Arena.

---

## Stage 1: layout generator, assembler and judge (greybox, no UI)

**Where:** new `src/sim/arenaGen/` (pure: no DOM, no three.js), exported from `src/sim/index.ts`.

- **`Kit` type and `GREYBOX_KIT`, written in TypeScript.**
  - Grid cell: 3 m (an open question). Floor heights: 0, 3 and 6 m, plus 0.8 m for tables and crates.
  - Pieces: `floor`, `ramp` (rises 3 m over two cells), `crate` (a 0.8 m lid on a floor), `pillar` (a Wall), `rail` (a low Wall along an edge), `bridge` (a narrow floor between two raised cells), `void` (no floor, just Abyss).
  - Each Piece lists Walk Surfaces and Walls in cell-local coordinates, plus which of its four sides are open at which height (its connectors).
- **`generateLayout(kit, seed, params) → Layout`.**
  - Params: footprint (cells), level count, void density, cover density.
  - Layouts need not be symmetric or fair: the generator fills the whole grid freely, and nothing checks that one Team has no advantage.
  - Each raised level must have a ramp onto it, so walking reaches it. Jumps are a bonus, not the only way up.
  - Neighbouring Pieces must match at their connectors (heights equal, or a ramp between them).
- **`assembleArena(kit, layout, name) → ArenaGeometry`.**
  - Place each Piece's surfaces with its quarter turn and offset.
  - Merge neighbouring coplanar floor tiles into larger convex rectangles where possible: fewer Walk Surfaces means a faster navmesh build. If merging breaks edge sharing, skip it and measure the cost instead.
  - Add one Abyss Walk Surface under the whole footprint, plus a margin.
  - Add a perimeter Wall only where the generator asks for one. Open edges dropping into the Abyss are part of the game.
  - Spawns: three per Team, on solid ground, facing the other Team. The two Teams' spawn areas are picked far apart (for example the two cells furthest apart by walking path).
- **`judgeArena(arena, tuning) → { ok, reasons[], stats }`,** using the real `navMesh` and `findPath`:
  - Every spawn reaches every enemy spawn by walk and drop Links alone, so Easy AI (no `jumpNav`) can always reach the fight.
  - No spawn has deadly ground within 3 m.
  - There's enough open floor at the lowest fighting level, a minimum share of the footprint (a param).
  - The navmesh builds in under 250 ms (the train takes about 160 ms).
  - `stats`: Walk Surface count, Link counts by kind (walk, drop, jump, shortcut), build time, longest spawn-to-spawn path.
- **`generateArena(kit, seed, params, tuning) → { arena, layout, attempts, report }`.**
  - Tries attempt seeds derived from `seed` (`seed`, then `seed + 1·K`, and so on) until one passes the judge or `MAX_ATTEMPTS` is reached, then returns the best one with its report.
  - It's still deterministic from `seed` alone.
- **Tests:** `arenaGen.test.ts`
  - The same seed always gives the same Arena (deep-equal and the same `hashValue`).
  - Every Arena passes `parseArena` after a round trip through JSON.
  - The same seed with different params gives a different Layout (the params are used).
  - Over seeds 1–200, every seed ends with an Arena that passes the judge within `MAX_ATTEMPTS`.
  - The navmesh has at least one jump Link on most seeds (a sanity check that the levels are within Jump reach).

**Done when:** `generateArena(GREYBOX_KIT, seed, defaults, tuning)` returns a judged Arena for any seed, all tests pass, and no existing test changes.

## Stage 2: GATE, the Arena Lab in the Editor (dev only)

As soon as Stage 1 produces something, build a dev-only screen to generate, reroll, view and play on generated Arenas before going further. **Stop at this stage and play it before starting Stage 4.**

### Can it go into the existing Editor? Yes, in the Duel sandbox
I checked what the sandbox (`src/editor/sandbox.ts`, route `#/editor/sandbox`) already has:
- **AI vs AI Match:** a difficulty per Fighter, a seed, best of N, precomputed and scrubbable.
- **Player vs AI:** live, with you on the Local Controller in the third-person camera. The opponent can be any difficulty, so Hard is one dropdown pick.
- **Debugging tools:** scrubbing, step one Tick, slow motion, a determinism check after scrubbing, Hit Zone and Blade Sweep overlays, an event log, and golden replay recording.
- **Arena choice:** both Matches are fought in `tuning.arena.editor`, which `arenaOf` resolves by name from `tuning.arenas` (`src/editor/sandboxSession.ts:87`, `src/editor/sandbox.ts:171`).
- **Collider view:** `Stage.setArena(name)` swaps the Arena drawn, and `Stage.setColliders(true)` draws the Walk Surfaces, Walls and **every jump Link's arc** (`src/render/stage.ts:204`, `:223`). That's exactly the "view" we need for the AI's navigation.

So the lab is a new folder in the sandbox's Tweakpane, not a new route. A generated Arena gets in by making a copy of the Tuning Data:

```ts
const withArena = { ...tuning, arenas: { ...tuning.arenas, [arena.name]: arena }, arena: { ...tuning.arena, editor: arena.name } };
```

Every script, the AI and the navmesh then use it unchanged. The navmesh cache is keyed on the Arena and Tuning Data objects, so a new copy builds a fresh navmesh.

### Changes needed
- **`Stage` resolves Arenas from the Tuning Data it was built with** (`private readonly tuning`), so it can't draw an Arena added later. Add `Stage.setTuning(tuning)`, or a `setArena(name, geometry?)` overload, so the lab can hand it the copy above.
- **A greybox look for Arenas without a model.** Today they are drawn as `outdoors()`: sand-coloured Walk Surfaces on grass, with no Walls drawn. Add a `greybox(arena)` setting:
  - Walk Surfaces tinted by height (so levels read at a glance), with a dark Abyss.
  - Walls as thin boxes from `bottom` to `top`.
  - A grid texture for judging distances.
  - Use it for any Arena whose name starts with `gen:`.
- **The sandbox rebuilds a run on every Tuning Data edit** (`rerun`). Make sure it re-applies the generated Arena to the new `session.tuning`, so a tuning edit doesn't drop you back into the circle.

### The "Generated Arena" folder
Shown only when `import.meta.env.DEV` or `?dev=1` (move `devMode()` out of `src/play/menu.ts` into a shared helper).
- **seed** (number), **params** (footprint, levels, void density, cover density).
- **Generate:** builds the Arena from the current seed and params, switches the sandbox to it, frames the orbit camera over its whole footprint, and turns the collider view on.
- **Reroll:** seed + 1, then Generate. **Random seed:** any seed, then Generate. This is the only place outside the Simulation where `Math.random` is allowed, and only to pick a seed.
- **Use generated Arena** (toggle): fight in the generated Arena or the circle.
- **Show colliders and jump Links** (toggle, on by default).
- **Report** (read-only): the judge's verdict and reasons, the attempts it took, Walk Surface and Link counts, and navmesh build time.
- **Play vs Hard:** switches the script to Player vs AI with the opponent set to Hard and starts a new Match on the generated Arena.
- **Watch Hard vs Hard:** switches the script to AI vs AI Match with both set to Hard.
- **Save Arena JSON:** writes `gen-<seed>.json` with `saveJsonFile`, to keep a bad seed as a test fixture.

**Tests:** extend `src/editor/playerVsAi.test.ts` or `sandboxSession.test.ts` so a Player vs AI session on a generated Arena runs 600 Ticks with no divergence.

**Done when:** in `npm run dev`, `#/editor/sandbox?dev=1` lets you generate, reroll, look over the Arena with its jump arcs, watch Hard vs Hard, and play against Hard on it.

## Stage 3: tune the generator using the lab, plus a soak test

- Play and watch across many seeds. Turn what feels bad into judge rules or generator params, each with a test (for example "no 1-cell-wide dead-end ledges" or "no spawn under a floor").
- **`arenaGen.soak.test.ts`**, opt-in like `jumpReach.measure.test.ts`:
  - For seeds 1–50, run Hard vs Hard headless (`createMatch` and `stepMatch` with two AI Controllers) for one Duel, up to a Tick cap.
  - Record: did the Duel end, how long it took, how much time both AIs spent more than 8 m apart (stuck or circling), and deaths by Abyss.
  - Print a table and flag outliers. This is the generator's balance report.
- Fix AI navigation bugs it finds in `nav.ts` and `ai.ts`, not in the generator. Every Arena benefits.

**Done when:** most seeds give Duels that end in normal time, with no AI stuck, and the soak table looks sensible.

### Result (done)
`SOAK_ARENAS=1 npx vitest run src/sim/arenaGen/arenaGen.soak.test.ts --silent=false` (add `SOAK_DUELS=3` for three Duels per seed, from Match seeds `seed`, `seed + 1000`, `seed + 2000`). The table splits the walk to the fight ("to contact": the first Tick within 8 m) from time apart after it, and marks a Death a Kick Knockdown led to (`Kick>`). One Duel per seed runs in about 40 s, three in about 75 s.

| Seeds 1–50 × 3 Duels | Before | After |
|---|---|---|
| Duels that ended (2 min cap) | 150/150 | 150/150 |
| Median Duel (the circle: 27.0 s) | 25.1 s | 26.0 s |
| Longest Duel | 117.8 s (seed 12) | 67 s |
| Median time to contact | 1.6 s | 1.6 s |
| Time apart > 8 m after contact | 0% | 0% |
| Duels with an Abyss death | 9 | 6 |
| ...not after a Kick Knockdown (the AI walked in) | 1 (seed 31) | 0 |

What it found, both AI bugs, fixed in `src/controllers/ai.ts` with a focused test each:
- **Seed 31: a Hard AI walked into the Abyss.** It stood on a ramp's top edge beside a void cell and stepped past the cell's open corner: both points `safeMove` looks at (0.4 and 0.8 m ahead) were floor, but the straight line between them clipped the corner by 3 cm. `stepIsSafe` now looks at the ground 0.1 m to either side of each point too.
- **Seed 12: two Hard AIs swapped levels for two minutes.** Each chased the other's level by the same pair of jump Links, so they crossed in the air and landed swapped, every 4.5 s. An AI now starts no jump Link while it sees its enemy in the air; it waits to see where it lands.

In the lab (Watch Hard vs Hard, colliders on), seed 12 now meets within 5 s and fights on the plateau edge.

No judge rule or generator param changed: nothing in the soak pointed at the Layouts.
- **No spawn under a floor:** none in seeds 1–200. The grid cannot make one (a spawn cell's eight neighbours are solid ground, and nothing overhangs). Worth a judge rule once a Blender Kit (Stage 4) can overhang.
- **1-cell-wide dead-end ledges:** a raised cell walking reaches from one side only shows up in about half of seeds 1–200, but no stuck AI, long Duel or Death in the soak happened on one.
- **What is left is the open-edges question (below):** every Abyss death now follows a Kick Knockdown off an open edge (6 of 150 Duels, none on the circle). Railing more edges would cut that. This is a design choice, not a bug.

## Stage 4: the Blender kit

**Where:** `art/build_kit_<theme>.py` writes `public/models/kits/<theme>.glb` and `data/kits/<theme>.json`.

- **One Blender generator per Kit,** following the `build_<arena>.py` pattern:
  - Each Piece is a named root object (`PIECE_<id>`) with its look.
  - Each Piece has `WALK_*` and `WALL_*` helpers in a `Collision` collection, in cell-local coordinates.
  - The JSON is read back from those helpers, the same way ADR 0006 does it for whole Arenas.
- **Pieces are built to the grid:**
  - Floor edges sit exactly on cell boundaries at the Kit's heights.
  - Make trim and edge variants (an open edge, a railed edge, a corner) so seams between Pieces don't show.
  - Make two or three visual variants per Piece type that share one collision, to break up repetition.
- **`data/kits/<theme>.json` becomes Tuning Data:** parsed and validated like Arenas, and hashed, so peers with different Kits refuse each other. `GREYBOX_KIT` becomes a Kit file too.
- **Renderer:** a `kit` setting in `stage.ts` loads the Kit `.glb` once, clones or instances each placed Piece with its quarter turn, and uses the Kit's lighting and fog (an `ArenaLook` per Kit).
- **Check:** an overlay render of a few generated Layouts with the collider view on, to confirm the art matches the collision (as `art/render_library.py` does for the library).
- The lab gains a **Kit** dropdown.

**Done when:** a generated Arena in the first themed Kit looks close to a hand-built one in the lab, and the Stage 2–3 checks still pass.

### Result (done, as a greybox pipeline)
The first Blender Kit is `greybox`, plain grey Pieces with no theme (open questions, below). The pipeline is all there, so a themed Kit is art only: a new `art/build_kit_<theme>.py`, its two outputs, and an `ArenaLook` in `KIT_LOOKS`.
- **`art/build_kit_greybox.py`** builds, from the same numbers as the TypeScript Kit had, one `PIECE_<id>` root per Piece (floor, ramp, crate, pillar, rail, bridge, void) with its look as child meshes, plus `TRIM_support`, a column one cell wide and one level tall, which the renderer stacks under every cell of a solid Piece above level 0 (a raised floor would float otherwise). Each Piece's `WALK_<id>_<n>` and `WALL_<id>_<n>` helpers stand in the `Collision` collection; footprint, `solid`, connectors and skirts are properties of its root. It writes `public/models/kits/greybox.glb`, `data/kits/greybox.json` (read back from the helpers and roots, cell-local) and `art/kit_greybox.blend`. Trim, edge and visual variants are left for a themed Kit.
- **Kits are Tuning Data:** `parseKit` (`src/tuning/kit.ts`, where the Kit types now live) validates each `data/kits/*.json`: every Piece present under its own id, Walk Surfaces convex and planar, everything inside the Piece's footprint, connectors and skirts on its cells and sides. `TuningData.kits` is hashed. `GREYBOX_KIT` is read from the file, and `toStrictEqual` the hand-written Kit (kept as `greyboxKit.reference.ts`, tests only), so no Layout or Arena changed: seeds 1–200 still pass, and the soak (`SOAK_DUELS=3`) gives Stage 3's After column exactly (150/150 ended, median 26.0 s, longest 67 s, 1.6 s to contact, 0% apart, 6 Abyss deaths, all after a Kick Knockdown).
- **Renderer:** `Stage.setArena(name, tuning, layout)` draws a Generated Arena given its Layout from its Kit's model when the Kit is in `KIT_LOOKS` (lights and fog per Kit), and as `greybox(arena)` otherwise. The model is loaded once per Kit; each node is one `InstancedMesh` per mesh, one instance per placement. `kitPlacements` (`src/render/kitPlacement.ts`, pure) gives each placement's matrix from `turnPoint`: entries 0, ±1 and whole-cell offsets, no trig. Its test moves every Piece's own Walls and Walk Surfaces by those matrices and gets the assembled Arena's exactly.
- **Check:** `art/render_kit.py` renders Arenas dumped by `KIT_DUMP=<file> npx vitest run src/render/kitPlacement.dump.test.ts` from the same placements, with the collider view over them. Seeds 1, 12 and 31 line up: tile seams on the collider tiles' edges, crates and pillars inside their Walls, ramps on their slopes, skirt Walls down the raised edges.
- **The lab** has a Kit dropdown (`tuning.kits`, only `greybox` for now) and hands the Stage the Layout.

## Stage 5: Random Map in the game and online

- **The Lobby and Skirmish offer a "Random" Map** (with a Kit choice, if there's more than one). The host picks a seed. The Lobby's Map setting carries the Arena name `gen:<kit>:<seed>`. Lobby messages already accept a short string for `arena`.
- **Every peer builds the Arena from the name:**
  - A helper `withArena(tuning, name)` returns the Tuning Data copy, generating the Arena if the name starts with `gen:`.
  - `createMatch`, `Stage` and the navmesh then work unchanged.
- **The Tuning Data hash includes the Kit files and a `GENERATOR_VERSION` constant.** Any change to the generator that could alter a Layout bumps the version, so peers on different builds refuse each other instead of drifting apart.
- **Test:** two simulated peers (`src/net/memoryTransport.ts`) build the same Arena from the same name and checksums agree for 600 Ticks.
- **Thumbnail:** a generic "Random" picture in `public/thumbs/arenas/`.

## Later
- **A new Arena every Duel:** needs Match state to carry the Duel's Arena name and the Stage to swap Arenas between Duels. This is the Gauntlet's "different Arena each Floor" question.
- **More Kits** (themes).
- **Larger Pieces** that span several cells (a ship's deck, a train wagon).

## Open questions (settle before Stage 4): all answered
- **Grid size** (answered): 3 m cells, as `GREYBOX_KIT` has now (matches the library's bands and ramps).
- **Heights** (answered): 0, 3 and 6 m, plus 0.8 m cover, as `GREYBOX_KIT` has now. A 3 m floor can be reached by Jump from below (reach is about 4.3 m up); 6 m from the ground is by ramp, or by a step via 3 m.
- **Theme of the first Kit** (answered): none yet. The first Blender Kit is `greybox`: plain grey Pieces, flat greys and tints, no other materials. Stage 4 is about the pipeline (Blender → `.glb` + Kit JSON → Tuning Data → renderer), so a themed Kit later is art only.
- **Open edges** (answered): keep them mostly open, with rails where the generator places them today. Ring-outs by Kick are part of the game.
