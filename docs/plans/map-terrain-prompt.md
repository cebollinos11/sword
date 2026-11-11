# Map Terrain: implementation prompt

Paste this into a new session once per Stage of `docs/plans/map-terrain.md`. It does the next unfinished Stage, then stops for a playtest.

```
Implement the next Stage of docs/plans/map-terrain.md. Read the whole plan, CONTEXT.md, and ADRs 0006,
0022, 0023 and 0026 first, and docs/plans/map-editor.md for how the Map Editor was built. Then read
src/mapEditor/source.ts, src/mapEditor/compile.ts, src/mapEditor/checks.ts, src/mapEditor/mirror.ts,
src/mapEditor/session.ts, src/sim/battlefield.ts (heightfield, build, battlefieldHeight: the open field's
triangles), src/sim/arena.ts (Walk Surface planes), src/sim/levels.ts (the walk rule, walkCheck) and
src/sim/destinations.ts (layeredFields). For Stage 2 also read src/mapEditor/ui/; for Stage 3,
src/render/mapModel.ts and src/render/battlefieldView.ts.

1. Find the next Stage: the first unticked box under Progress in the plan. Do only that Stage. Read the
   previous Stage's "### Result" before you start.
2. Keep the pure part (src/mapEditor/: source, compiler, checks, the editor session) free of three.js and
   the DOM, deterministic (no Math.random, no trig on coordinates, ties broken by Brush order then
   row-major cell order), and unit-tested. The compiler must run its output through the game's own
   parseBattleMap and walkCheck.
3. Do not change the Simulation's rules, the four shipped maps or the Fort port; a source with no
   `terrain` must compile to the same bytes, and every existing test must pass unchanged. Reuse what
   exists before writing new code. Match the repo's comment style.
4. Write the Stage's tests. Run `npm run typecheck` and `npm test` until both are clean, and
   `npm run test:slow` if the Stage runs Battles.
5. Run /code-review at high effort on the diff against the plan. Fix what it finds.
6. Update docs/plans/map-terrain.md: tick the Stage under Progress, update the Status line, and add the
   Stage's "### Result" (what was built, what changed from the plan, test counts, measured timings, and
   what to try in `npm run dev` at #/mapeditor?dev=1). Add new terms (Terrain, Cliff) to CONTEXT.md
   once the code makes them true, and update the Map Source, Brush and Map Compiler entries.
7. Commit ("Map Terrain Stage N: ...") and push to the working branch. Then stop and tell me what to
   playtest. Do not start the next Stage.
```
