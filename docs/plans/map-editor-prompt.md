# Map Editor: implementation prompt

Paste this into a new session once per Stage of `docs/plans/map-editor.md`. It does the next unfinished Stage, then stops for a playtest.

```
Implement the next Stage of docs/plans/map-editor.md. Read the whole plan, CONTEXT.md, and ADRs 0006,
0014 and 0022 first. Then read src/tuning/arena.ts, src/tuning/battle.ts (parseBattleMap, BattleMapTuning,
the battlemaps glob), src/sim/levels.ts (walkCheck), src/sim/destinations.ts (battleMapOf), one generator
(art/build_battle_cavern.py) and one shipped map (data/battlemaps/fort.json) to see what a compiled map
must look like.

Then read the code earlier Stages built: every file in src/mapEditor/ (from Stage 0: source.ts for the
MapSource, the Brush kinds and parseMapSource; compile.ts for compileMap, MapCompileError and its
.brushes, and mapFileText; sample.testdata.ts for the sample source; compile.test.ts). For a Stage with UI,
also read how the Motion Editor is built and loaded: src/main.ts (the #/editor route, loaded on demand),
src/editor/session.ts (EditorSession, the model for MapEditorSession), src/editor/save.ts (saveJsonFile)
and the Editor's Tweakpane panels.

1. Find the next Stage: the first unticked box under Progress in the plan. Do only that Stage. Read the
   previous Stage's "### Result" before you start.
2. Keep the pure part (src/mapEditor/: source, compiler, checks, the editor session) free of three.js and
   the DOM, deterministic (no Math.random, no trig on coordinates, ties broken by Brush order), and
   unit-tested. The compiler must run its output through the game's own parseBattleMap and walkCheck.
3. Do not change the Simulation's rules or the four shipped maps (fort, ziggurat, city, cavern); every
   existing test must pass unchanged. Reuse what exists (saveJsonFile, withArena's pattern, Tweakpane,
   the Battle routes, triplanar textures) before writing new code. Match the repo's comment style.
4. Write the Stage's tests. Run `npm run typecheck` and `npm test` until both are clean, and
   `npm run test:slow` if the Stage runs Battles.
5. Run /code-review at high effort on the diff against the plan. Fix what it finds.
6. Update docs/plans/map-editor.md: tick the Stage under Progress, update the Status line, and add the
   Stage's "### Result" (what was built, what changed from the plan, test counts, measured timings, and
   what to try in `npm run dev` at #/mapeditor?dev=1). Add new terms to CONTEXT.md if the code made them true.
7. Commit ("Map Editor Stage N: ...") and push to the working branch. Then stop and tell me what to
   playtest. Do not start the next Stage.
```
