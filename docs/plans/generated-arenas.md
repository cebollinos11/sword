# Generated Arenas: assembled from a Blender kit, tested in a dev Arena Lab

> Status: plan. Stages 1–3 can start now. Settle the open questions (end of this file) before Stage 4.

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

## Open questions (settle before Stage 4)
- **Grid size:** 3 m (matches the library's bands and ramps) or 4 m (more room to fight per cell)?
- **Heights:** are 0, 3 and 6 m (+0.8 m cover) right? At 3 m, raised floors can be reached by Jump from below (reach is about 4.3 m up). 6 m from the ground is a ramp only, unless climbed by a step via 3 m.
- **Theme of the first Kit:** reuse the library's look (ruins or stone) or something new?
- **Open edges:** how much of the edge drops into the Abyss, versus railed or walled? This decides how deadly Kicks and Heavy Blows are near edges.
