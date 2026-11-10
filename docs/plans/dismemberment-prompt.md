# Dismemberment: implementation prompt

Paste this into a new session once per Stage of `docs/plans/dismemberment.md`. It does the next unfinished Stage, then stops for a playtest.

```
Implement the next Stage of docs/plans/dismemberment.md. Read the whole plan first, including the
Results of earlier Stages (they override anything older in the plan), then CONTEXT.md (Death, Death
Ragdoll, Blade Sweep, Body, Skeleton, Weapon, Final Blow Shot) and ADRs 0001 and 0002.

Then read the code the plan builds on: src/sim/combat.ts (findContacts, resolveContact), src/sim/sweep.ts,
src/sim/step.ts (felled, fellingBlow), src/sim/state.ts (Death, DeathBlow), src/sim/events.ts,
src/sim/skeleton.ts (BONES, JOINT_NAMES, BladeTransform), src/net/messages.ts (isDeath),
src/render/ragdoll.ts and its test, src/render/fighterView.ts (FighterView, drawnPose),
src/render/bodyRig.ts, src/render/bodyModel.ts, src/render/renderer.ts (render), src/render/impacts.ts
and src/render/blood.ts. Read the files earlier Stages added (src/render/dismember.ts,
src/render/meshCut.ts) if they exist.

1. Find the next Stage: the first unticked box under Progress in the plan. Do only that Stage.
2. The Simulation only records the cut (DeathBlow.cut). Everything else is render-only and a pure
   function of the Death and the pose it fell in: no Math.random, no wall-clock time, no state kept
   between frames that scrubbing back or a Rollback would leave wrong. A Death without a cut must fall
   and draw exactly as it does today, and every existing test must pass unchanged.
3. Keep the pure parts (severing, the ragdoll, the mesh cut's geometry) free of the DOM and unit-tested;
   build them test-first. Reuse what exists (the ragdoll's particles and constraints, BodyRig and
   boneFrames, BloodEffects.spurt and drip, bladeBloodMaterial's look, hitZones radii, sizedTuning)
   before writing new code. Match the repo's comment style and domain words (CONTEXT.md).
4. Run `npm run typecheck` and `npm test` until both are clean, and `npm run test:slow` if the Stage
   touched src/sim or src/net.
5. For a Stage that draws something: run `npm run dev`, and with Playwright open the Editor's sandbox,
   make cutting kills (each swing Direction; head, arm, torso, leg; Arming Sword, Longsword, Halberd)
   and non-cutting ones (Thrust, Sledge Hammer), on `?body=skeleton` and on at least four Body models
   including one generated (monk) and one hand-made (duelist). Screenshot each and look at them: caps
   closed, no stretched triangles, pieces lying on the floor, the body whole again when scrubbed back
   before the Death. Fix what looks wrong before going on. Measure the one-off split time on the
   heaviest Body.
6. Run /code-review at high effort on the diff against the plan. Fix what it finds.
7. Update docs/plans/dismemberment.md: tick the Stage under Progress, update the Status line, and add
   the Stage's "### Stage N result". Add or amend CONTEXT.md terms the code made true.
8. Commit ("Dismemberment Stage N: ...") and push to the working branch. Then stop and tell me what to
   playtest. Do not start the next Stage.
```
