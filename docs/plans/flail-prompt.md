# Flail: implementation prompt

Paste this into a new session once per Stage of `docs/plans/flail.md`. It does the next unfinished Stage, then stops for a playtest.

```
Implement the next Stage of docs/plans/flail.md. Read the whole plan first, including the Results of
earlier Stages (they override anything older in the plan), then CONTEXT.md (Weapon, Weapon roster,
Direction, Attack, Wind-up, Release, Feint, Chain, Whiff Chain, Chamber, Blade Sweep, Blade Speed,
Heavy Blow, Block Impact, Motion override, Tempo, Reaction Time) and ADRs 0001, 0002, 0004, 0016,
0017 and 0018.

Then read the code the plan builds on: src/tuning/weapon.ts and src/tuning/index.ts (the roster,
weaponMotion, checkIdleLinks, checkMotionOverride), data/weapons/halberd.json and sledge-hammer.json,
data/motions/halberd/, tools/two-handed-motions/ (gen.mjs, choreo.mjs), src/sim/actions/attack.ts
and feint.ts, src/sim/chamber.ts, src/sim/combat.ts (findContacts, resolveContact, hitDamage),
src/sim/state.ts (AttackAction), src/net/messages.ts, src/render/fighterView.ts (the hammer look),
src/render/sheathed.ts, src/render/swingTrail.ts, src/audio/cues.ts, src/play/icons.ts,
src/editor/tuningPanel.ts, and for the AI Stage src/controllers/ai.ts, ai.test.ts and
aiGolden.test.ts. Read the files earlier Stages added (src/sim/flail.test.ts,
src/render/flailChain.ts) if they exist.

1. Find the next Stage: the first unticked box under Progress in the plan. Do only that Stage.
2. The decisions under Context are fixed. The Flail is a rigid Weapon in the Simulation; the chain
   and the whirl are render-only and a pure function of the Simulation's state (no Math.random, no
   wall-clock time, nothing kept between frames that a Rollback or scrubbing would leave wrong). The
   Spin-up is a Tick count on the Attack that scales Blade Speed at contact, present only for a
   Weapon with spinUp. No Battle Troop and no Run Encounter or loot gets the Flail.
3. Nothing may change for the other Weapons: their states carry no new field, their Weapon files do
   not change, the AI draws no new random number unless a Flail is in play, and every existing test
   passes unchanged, the AI golden test above all. Before Stage 1, find how "weapon": "random" is
   drawn; if a recorded hash moves only because the roster grew, re-record just that and say so in
   the Result.
4. Build the pure parts test-first (the plan lists each Stage's tests; start Stage 1 with the Feint
   loop test from section 2). Generate the Motion overrides with `npm run motions:two-handed` from
   choreo.mjs; never hand-edit generated files. Reuse what exists before writing new code, and match
   the repo's comment style and domain words (CONTEXT.md).
5. Run `npm run typecheck` and `npm test` until both are clean, and `npm run test:slow` if the Stage
   touched src/sim, src/net or src/controllers.
6. For a Stage that draws or sounds something: run `npm run dev` and, with Playwright, open the
   Editor's sandbox with a Flail. Swing each Direction at no, half and full charge; press Thrust;
   Feint; Chain; Block; Sheathe. Screenshot on `?body=skeleton` and at least two Body models, at
   Size 0.6 and 1.4, and look at them: the ball on the contact point at a Hit, the chain never
   through the floor, the three Wind-ups told apart at a glance, the same picture at the same Tick
   when scrubbed. Fix what looks wrong before going on.
7. Run /code-review at high effort on the diff against the plan. Fix what it finds.
8. Update docs/plans/flail.md: tick the Stage under Progress, update the Status line, and add the
   Stage's "### Stage N result" (what was built, deviations and why, the numbers worth tuning, what
   to playtest). Add or amend the CONTEXT.md terms the code made true; write ADR 0026 in Stage 2.
9. Commit ("Flail Stage N: ...") and push to the working branch. Do not open a pull request. Then
   stop and tell me what to playtest. Do not start the next Stage.
```
