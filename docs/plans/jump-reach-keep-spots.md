# Make the held-Jump spots proper places to stand, add ceilings, add a collider view

Worktree: `C:\Repos\sword\.claude\worktrees\jump-reach-audit-94c2c3`, branch `claude/jump-reach-audit-94c2c3`
(already fast-forwarded to 3ecd93a, which adds `docs/jump-reach.md` and `src/sim/jumpReach.measure.test.ts`).

## Context

The held Jump (`fall.jumpBoost`) reaches about 4.3 m up and 4.2 m out (`docs/jump-reach.md`). An audit with the real
Simulation found the spots it newly reaches. The user decided **keep all of them**: every one must be something you
can jump onto *and walk on top of*. Also, in the library you can jump up *through* a floor from underneath; that
must be blocked by a ceiling collider. Finally, instead of manual checks, add a `?dev=1` toggle that draws the collision
geometry over a see-through arena model, so the user can eyeball the result.

Constraints: don't touch `data/fall.json`. The AI (`src/controllers/ai.ts`) only taps Jump and never jumps to navigate.
Note per spot whether it could follow (none of these can, today; a later task teaches long jumps).

### How the geometry works (what the fixes rely on)
- `data/arenas/<name>.json` is **generated** by `art/build_<name>.py` (Blender) from `WALK_*` / `WALL_*` helpers, together
  with `public/models/arenas/<name>.glb`. Change the build script, then re-export. Never hand-edit the JSON alone.
  Headless: `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python-expr "exec(open(r'C:/Repos/sword/.claude/worktrees/jump-reach-audit-94c2c3/art/build_<name>.py').read(), {'__file__': r'<same path>', 'SAVE': True})"`
  (see each script's docstring; the Blender MCP `execute_blender_code` is a fallback).
- A prop "box" today is four Walls (`rect(...)`) and **no** Walk Surface on top, so clearing its top drops you *inside* it
  (stuck on the floor within the model). The fix pattern is a **lid**: a Walk Surface with the same footprint as the
  prop's Walls, at the Walls' `top`. That way, clearing the Walls means landing on the lid (`src/sim/arena.ts`:
  `groundBelow` picks the highest surface ≤ feet + `stepUp`; `pushOutOfWalls` ignores Walls whose top ≤ feet + `stepUp`).
  Set the Wall top to the prop's *visible* top, so lid height = Wall top = drawn top.
- `src/sim/nav.ts` builds the AI navmesh from Walk Surfaces. A lid gets drop links down to the floor and no links up.
  The AI can leave a lid, but never climb onto one.

## Stage 0 — Clean up
- Delete the throwaway audit probes `src/sim/_reach.probe.test.ts` and `src/sim/_reach.spots.test.ts` (never committed).
- `npm ci` if `node_modules` is missing; `npm test` should be green before starting.

## Stage 1 — `?dev=1` collider view (do first; later stages are checked with it)
Follow the PS1 Resolution option's wiring exactly:
`src/play/menu.ts` (`ps1Item`, `PS1_STORAGE_KEY`, title screen ~L333 where `?dev=1` already gates the Editor link, in-game
menu ~L571) → `MenuHandlers.onPs1` → `src/game.ts` ~L188 → `src/render/renderer.ts` `setPs1` → `src/render/stage.ts` `setPs1`.
- Menu: `colliderItem()` "Show Colliders: On/Off", shown only when `new URLSearchParams(location.search).get('dev') === '1'`,
  on the title and in-game menus, stored under `sword.colliders`, handler `onColliders(on)`.
- `Renderer.setColliders(on)` → `Stage.setColliders(on)`. In Stage, keep the overlay in its own group rebuilt in `build()`
  (so `setArena` swaps it) and toggle `visible`. Build it from `ArenaGeometry` (a new `src/render/colliderView.ts`, pure
  three.js, no sim imports beyond types):
  - Walk Surfaces as triangle fans (reuse the fan logic of `walkSurfaces()` in stage.ts; extract it if handy), coloured by
    kind: plain green, `lava` red, `water` blue. Draw them double-sided at opacity ~0.5, plus edge lines (`EdgesGeometry`/`LineSegments`)
    so the outlines read.
  - Walls as vertical quads from `bottom` to `top` (same quads as `cameraCollider.ts` builds), orange at ~0.35 opacity, with outlines.
  - Overlay materials: `depthTest` on, `depthWrite` off, drawn after the model (`renderOrder`), fog off.
- Model see-through: when on, set each arena-model mesh material (the `MeshLambertMaterial`s made in `arenaModel()`) to
  dithered transparency: `alphaHash = true`, `opacity ≈ 0.3` (three r186 supports `alphaHash`; no sorting needed). Restore
  on off. Remember the setting across `setArena` (models load async: apply it when `loaded` resolves too). For the plain
  `outdoors()` arena (circle) only the overlay applies.
- Test: a small unit test for `colliderView.ts`, e.g. it makes one mesh per kind and the right triangle and Wall-quad
  counts for a hand-made `ArenaGeometry` (see `src/render/cameraCollider.test.ts` for a fixture).

## Stage 2 — Ceilings: a Walk Surface is solid from below (fixes library L1)
Today a rising Fighter passes up through any Walk Surface overhead and snaps onto it (`settleGround` in
`src/sim/step.ts` ~L283 only stops *horizontal* moves via `blockedAt`). Verified: a full jump from the floor under the
library bridge, the east/west mezzanines, or (from the alcove) the south mezzanine lands on top, 3 m up.
- Rule: while airborne and rising, if a Walk Surface at the Fighter's (x, z) lies between last Tick's head
  (`prev.y + fighter.height`) and this Tick's head, and above the feet by more than `stepUp`, the head bumps it.
  Clamp `y = h - fighter.height` and set `air.vy = 0` (keep vx/vz, and drop any remaining `air.boost` so holding Jump
  can't push again). Put it as a small pure helper beside `blockedAt` in `src/sim/arena.ts` (e.g. `ceilingAbove(arena, x, z, fromY, toY, tuning)`
  using `surfacesAt` / `surfaceHeight`) and apply it where the airborne position is settled (in `settleGround`'s airborne
  branch, or right after `fly`). It must be deterministic and touch only `SimState` fields that already exist.
- Generic rule, so any level with stacked floors gets it (today only the library has overhangs; train, ship, summit, chamber don't).
- Update `CONTEXT.md` **Walk Surface** ("… and solid from below: a Jump under one bumps its head on it") and add a line to
  `docs/jump-reach.md` (a floor overhead caps the jump at its height minus `fighter.height`).
- Tests in `src/sim/fall.test.ts` (or a new `ceiling.test.ts`): in the library, a full Jump straight up from the floor under the
  bridge never gets its feet above `3 - fighter.height` and lands back on the floor (y 0); the same from the alcove under the
  south mezzanine. Plus a sanity check that jumping *onto* the mezzanine through a rail gap still works (from `(7, 0, -4.25)`
  along +x, full hold → ends at y 3).

## Stage 3 — Lids and new floors, level by level
For each level: edit `art/build_<name>.py`, re-export (`.blend`, `.glb`, `.json`), run `npm test`, then add the tests
(Stage 4). Add a `lid(id, corners, y)` helper next to `rect(...)` in each script (it appends a `WALK_<id>_top` with the
same corners as the `rect` Walls, at `top`). Spot ids are from the audit.

**Summit** (`art/build_summit.py`, `rect(...)` ~L270–279)
- S1 hull: Wall top 3.7 is above the drawn spine (about `HIGH + 0.45 + 1.0` = 3.45, plus roll/pitch). Measure the drawn top
  in Blender, set the Wall top to it, and lid the full Wall footprint. Optionally use a flat centre strip plus two gently
  sloping side strips (convex, within the footprint) so the lid hugs the rounded hull. It is reached by a held Jump from the
  plateau (it's 1.5–1.7 m up).
- S2 nacelle: lid at its drawn top (about 1.27 to 1.4). Set the Wall top to match.
- S3 containers: lid at 2.5 (top of the stacked pair). Reached by a tap from the plateau (0.5 up) or a held Jump from the nook.
- S4 dish: the drawn dish is a bowl tilted ~57°, so a flat lid would float. Re-pose it in `dish()` to lie nearly face-up
  (rim ~1.0–1.2 m, still reading as fallen), then lid it at the rim height. Set the Wall top to match.
- S5 the two crates: lids at `2*h` (0.8, 0.9).
- AI: can follow onto none of them, but can drop off all of them.

**Train** (`art/build_train.py`, `rect(...)` ~L331–338, `locomotive()` ~L578)
- T1 locomotive roof: add `roof('loco', LOCO[0], n0, LOCO_Y)` (flat top + bevels like the wagons, `n0 = LOCO[1] - 6`).
  Add Walls for its fin (centre, 0.12 wide, top `LOCO_Y + 0.5`) and its four heat sinks (like `VENTS`). The nose beyond
  `n0` stays open (walking off it is a Death by Fall, like every other end). Reached by a full Jump from the flatcar deck
  over the bulkhead. Coming back takes a jump too. Fix the docstring/comments that say the bulkhead is "too high to jump"
  and the locomotive is "out of reach".
- T2 crate stack: lid at `FLAT_Y + 1.8` over the 1.1 × 1.1 footprint (the small container's top; the lower container's 0.2 m rim
  is included in the same lid).
- T3 power cell: lid at `FLAT_Y + 1.45` (square footprint as its Walls, or an octagon matching the cap).
- T4 waste drums: lid at `FLAT_Y + 0.9`.
- AI: none (no gangway to the locomotive; lids have only drop links).

**Ship** (`art/build_ship.py`, `square(...)`)
- H1 big crate (`CRATES[0]`, 1.0 m): lid at 1.0. Also lid the small crate (`CRATES[1]`, 0.7) so the pair is one walkable
  stack (they overlap; the higher lid wins where both cover).

**Library** (`art/build_library.py`, the `table` Walls)
- L2 the two tables: lids at 1.0 over their 3.2 × 1.7 footprint (they become platforms; reached by a tap).
- L1 is Stage 2 (no data change).

**Chamber** (`art/build_chamber.py`, `CATWALKS`, `CATWALK_END`, `build_shaft()` ~L306)
- C1 the two catwalks: a Walk Surface each from r `CATWALK_END` (11) to `SHAFT` (15), half width 0.9, y 0, along each
  bearing. Side-rail Walls at ±0.95 (bottom −0.5, top 1.0, matching the drawn rail pipes), none across the open end
  (you jump on and off there, or fall into the lava). The shaft Wall already closes the door end. Reached by a full Jump
  across the 3.5 m gap from the ring's outer edge, and back the same way. AI: cannot follow (the gap needs a held
  Jump, and nav has no jump links).

Existing level tests (`src/sim/summit.test.ts`, `train.test.ts`, the ship's `water.test.ts`, the library's `arena.test.ts` / `nav.test.ts`)
may assert surface counts or AI paths; update them only where a lid legitimately changes the answer.

## Stage 4 — One Simulation test per fix
Build on the pattern in `src/sim/jumpReach.measure.test.ts`: `createInitialState(tuning, 1, [{ position, facing, y }], [], [], '<arena>')`,
then a Track `[{ticks:1, intent:{move, jump:true, jumpHeld:true}}, {ticks:hold-1, intent:{move, jumpHeld:true}}, {ticks:n, intent:{move}}]`
through `runScript`. Each test: from a spot players already stand on, the jump ends standing (not airborne, no `death`)
at the lid's height inside its footprint. Then a few Ticks of walking along the top keep `y` at that height, and walking
off the edge comes down to the floor. Put them in each level's test file (`summit.test.ts`, `train.test.ts`, ship/library/chamber
equivalents; create `chamberArena.test.ts` if no chamber-arena file exists. `chamber.test.ts` is the Chamber *mechanic*).
Takeoff spots that worked in the audit (before lids, they landed *inside*):
- summit hull: from `(-1.8, 2, -7.0)` along −z, hold 15 Ticks. Nacelle: from `(-3.5, 0, 3.7)` along −x, hold 15.
  Containers: from the plateau `(3.0, 2, -5.6)` along +z, tap. Dish: from `(3.8, 0, 4.0)` along +z, hold 15. Crates: taps from
  `(-2.6, 0, 5.2)` +z and `(-3.4, 0, -3.2)` −z.
- train crate stack: from `(0.75, -1.2, 13.6)` +z, hold 15. Cell: from `(0.7, -1.2, 17.3)` +z, hold 15. Drums: from `(-0.8, -1.2, 15.9)` +z, tap.
  Locomotive: from `(0, -1.2, 19.0)` +z, hold 30 → ends on the loco roof at y 0.5.
- ship crate: from `(-1.95, 0, 4.9)` +z, tap. Library table: from `(-5, 0, 8.6)` +z, tap.
- chamber catwalk: from `(0, 0, 7.2)` +z, hold 30 → ends at y 0 on the catwalk (z ≈ 12), alive. Mirror for `(0, 0, -7.2)` −z.
Adjust a takeoff if a lid's final height changes the arc. The point is that the jump lands on top.

## Stage 5 — Finish
- `npm test` and `npm run typecheck` green.
- Update `docs/jump-reach.md` with a short "Places a held Jump reaches, by Arena" list (each lid / new floor, its height,
  where it is reached from, and "AI can't follow").
- Commit per stage (the debug view, ceilings, then one commit per level), with the attribution trailer.

## Verification
- Automated: the Stage 2 and Stage 4 Simulation tests, plus the full `npm test` and `npm run typecheck`.
- Visual (by the user, not the agent): run the dev server with `?dev=1`, turn on "Show Colliders" in the menu, and
  look at each Arena. Every lid should sit on its prop's top, the catwalks and the locomotive roof should be green, and the
  model should be dithered see-through.
