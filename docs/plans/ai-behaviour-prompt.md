# AI behaviour: implementation prompt

Paste this into a new session once per Stage of `docs/plans/ai-behaviour.md`. It does the next unfinished Stage, then stops for a playtest.

```
Implement the next Stage of docs/plans/ai-behaviour.md. Read the whole plan, CONTEXT.md and the
ADRs it cites (0001, 0005, 0007) first, then src/controllers/ai.ts and src/controllers/ai.test.ts.

1. Find the next Stage: the first unticked box under Progress in the plan. Do only that Stage.
2. Before touching ai.ts in Stage 1, add the golden test: record AI vs AI Matches with Easy/Normal/Hard
   (1 v 1 library, 2 v 2 generated arena, 1 v 3 chamber) on the unchanged code and assert the hashValue
   at every Tick. It must pass unchanged at the end of every Stage. Easy, Normal and Hard must never change.
3. Every new behaviour is an optional AiDifficulty knob, off by default in skillOf, and draws randomness
   only through chance(). New memory goes into AiMemory/save()/load() as small plain data. The AI uses only
   what a human could see, after its Reaction Time.
4. Reuse the existing helpers (safeMove, attackTimings, reach, aimedAt, goesFor, startAttack,
   chooseDirection; the vsAi/scriptedController/runControllers test helpers). Match the file's comment style.
5. Write the Stage's tests listed in the plan. Run `npm run typecheck` and `npm test` until both are clean.
6. Update docs/plans/ai-behaviour.md: tick the Stage under Progress, update the Status line, and add a "Stage N, Result" section saying what
   was built, any deviation from the plan, and what to playtest in `npm run dev`. Update CONTEXT.md terms
   (Style, the new tiers) if they changed.
7. Commit with a descriptive message ("AI Stage N: ...") and push to the working branch. Then stop and
   report what to playtest. Do not start the next Stage.
```
