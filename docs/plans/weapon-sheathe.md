# Sheathe and Draw: put the Weapon away to move faster

## Context

Players want a way to cover ground faster without changing combat. Like the first Prince of Persia, a Fighter can
**Sheathe** its Weapon (R key, or a new touch button), move faster while **Sheathed**, and **Draw** it again to fight.
Sheathing and Drawing are committed Actions that take time, so you can't use them to dodge mid-fight. While Sheathed the
Fighter can still Jump, Crouch, Kick and Throw, but cannot Attack or Block. The Weapon is drawn on the hip or the back,
depending on the Weapon.

### Decisions (agreed with the user)
| # | Decision |
|---|---|
| Key | **R** toggles (Sheathe when drawn, Draw when Sheathed). Mobile: a tap button by Jump/Throw whose icon flips between the two states. |
| Speed | Sheathed walk = `fighter.walkSpeed × fighter.sheathedWalkFactor` (1.6, so 4 m/s). It multiplies with Crouch, Slow and `dagger.throwWalkFactor`. Turning is unchanged. |
| Jumps | A Jump takes off, and steers in the air, at the **drawn** walk speed. Jump reach, `jumpArc`, jump Links and `docs/jump-reach.md` stay valid. |
| Actions | `Sheathe` and `Draw` are new Actions. They can start from Idle **on the run and in the air** (in a Jump, the same rule as Throw: `startAction`). While one plays, the Fighter walks at drawn speed, turns and crouches, but cannot Jump, Kick, Throw, Attack or Block. A Sheathe/Draw already started carries on through a ledge Fall and through a soft Landing. |
| Timing | Hip slot 0.7 s and back slot 1.0 s, set by the Motion's duration. Each Motion has a `swap` marker: the Weapon changes between hand and slot there, which is when `sheathed` flips. |
| Interrupt | A Hit, Kick or hard Landing interrupts it the usual way (Stagger or Knockdown). If that happens before `swap`, nothing changed; after `swap`, the toggle has already happened. |
| Attack/Block while Sheathed | Pressing either starts a **Draw**, at full cost. No quick-draw attack. |
| Sheathed and Hit | No Block, so a Knockdown's guard is none. No extra damage. No Blade Sweep, Block or Chamber is possible. |
| Weapon collision | A sheathed Weapon is **render-only**. Nothing in the Simulation touches it (ADR). |
| Duel start | Always drawn. |
| Death | A sheathed Weapon stays on the body in the Death Ragdoll. |
| Slot | Explicit per Weapon: `"sheathe": { "slot": "hip" \| "back", … }`. Arming Sword on the left hip; Longsword, Halberd and Sledge Hammer on the back. No scabbard mesh in v1. |
| Motions | New default Motions `SheatheHip`, `DrawHip`, `SheatheBack`, `DrawBack` and `SheathedIdle`, which Weapons can override as usual. A longer Gait stride when Sheathed. Arm swing is out of scope. |
| Sound | Steel-on-scabbard cues at `swap`. |
| AI | Never Sheathes. Pressing Attack while Sheathed already Draws, so an AI Takeover of a Sheathed Fighter works. It presses a Sheathed enemy (one who can't Block). |

### Constraints
- **Deterministic and rollback-safe** (ADR 0001/0005). `sheathed` is plain state in `FighterState`, so it is hashed and
  snapshotted. The new Intent field `sheathe` is validated in `src/net/messages.ts`.
- **Combat unchanged** for drawn Fighters. Every existing test passes untouched, except tests that list Motion names or
  Actions, which gain the new entries.
- Use `CONTEXT.md` vocabulary: **Sheathe**, **Draw**, **Sheathed** (_Avoid_: holster, unsheathe, stow). Update
  `CONTEXT.md` (the Action list, Jump, Crouch, Knockdown, Weapon, Death Ragdoll) as each behaviour lands.
- Each stage is its own commit (or a few). `npm test` and `npx tsc --noEmit` must pass. Write the tests first.

---

## Stage 1: Domain docs and ADR
- `CONTEXT.md`: add **Sheathe**, **Draw** and **Sheathed** under Combat, and Sheathe/Draw to the **Action** list.
  Mention Sheathed in **Weapon** (slot), **Jump** (drawn speed), **Knockdown** (no guard when Sheathed) and **Death Ragdoll**.
- `docs/adr/0017-sheathed-weapon-is-render-only-and-jumps-at-drawn-speed.md`: why a sheathed Weapon has no
  collision, and why the speed bonus is ground-only (it keeps jump Links and jump reach valid).

## Stage 2: Simulation core (the state, the Actions and the swap)
**Where:** `src/sim/state.ts`, `src/sim/intent.ts`, new `src/sim/actions/sheathe.ts`, `src/sim/actions/index.ts`,
`src/sim/step.ts`, `src/tuning/index.ts`, `data/fighter.json`, `data/weapons/*.json`, `data/motions/`.
- `FighterState.sheathed: boolean`. It is `false` in `createInitialState` (`step.ts:75`). Check that `src/sim/match.ts`
  builds each new Duel's Fighters this way, so every Duel starts drawn.
- `Intent.sheathe?: boolean` (pressed this Tick; holding it does not repeat), with a doc comment written like `kick`/`throw`.
- Action union: `SheatheAction { kind: 'Sheathe' }` and `DrawAction { kind: 'Draw' }`. Copy the Throw pattern
  (`src/sim/actions/throw.ts`): a timings helper reads the `swap` marker and the duration through `weaponMotion`, and the
  Motion is chosen by `weapon.sheathe.slot`.
  - Starter `startSheathe`, placed **first** in `STARTERS`: `sheathe` pressed and drawn → Sheathe; `sheathe` pressed and
    Sheathed → Draw; Sheathed and `attack`/`block` pressed → Draw. Every other starter (`startAttack`, `startBlock`)
    must refuse while Sheathed. Kick and Throw are still allowed.
  - Handler: advance the Motion. On the Tick the playhead crosses `swap`, flip `sheathed` and emit a `Sheathed` or
    `Drawn` event. At the end of the Motion, go Idle.
  - `sheathed` lives on the Fighter, not in the Action, so an interrupt keeps whatever has already happened.
    The handler returns an `ActionUpdate`, so add an optional `sheathed?: boolean` to `ActionUpdate`
    (`actions/types.ts`) and apply it in `stepFighter`.
- **Sheathed Idle:** Action handlers and `land()` return `IDLE_MOTION` ('Idle'). Add one helper,
  `idleMotionFor(f)`, that gives `SheathedIdle` when Sheathed. Apply it in `stepFighter` before `followMotion` and in
  `land()` (`step.ts:238`). Also fix `updateIdle` (`actions/index.ts`): it compares against `IDLE_MOTION.name` and would
  otherwise restart `SheathedIdle` every Tick. A Sheathe ends on `SheathedIdle`, and a Draw ends on the Guard (it links `"idle"`).
- `step.ts`:
  - `jumps()` stays Idle/Block/Attack only, so there is no Jump during a Sheathe/Draw.
  - The ledge-fall rule (`step.ts:195`) must not replace a Sheathe/Draw with a Fall.
  - Knockdown: no guard while Sheathed (`src/sim/actions/knockdown.ts`, where it takes `guard` from the Intent).
- **Off hand:** generalise `throwOffHandFree` (`actions/throw.ts`) into an `offHandFree(f, tuning)`. It returns 1 while
  Sheathed, blends over the Motion Blend at the start and end of a Sheathe/Draw, and keeps the Throw case. Use it at
  `src/sim/pose.ts:71`, so a two-handed Weapon's off hand lets go (ADR 0004 stays satisfied).
- Tuning: `fighter.sheathedWalkFactor` (positive number). Weapon `sheathe: { slot: 'hip'|'back', offset: [x,y,z], rotation: [x,y,z] }`
  (required, validated). Placeholder Motions for the five new names, with `swap` markers, so the sim runs before the art
  pass in Stage 5.
- Tests (new `src/sim/sheathe.test.ts`):
  - toggle from Idle, while walking, and in a Jump;
  - `swap` timing for hip and back;
  - Attack or Block pressed while Sheathed starts a Draw;
  - a Hit before `swap` leaves the Fighter drawn, and a Hit after `swap` leaves it Sheathed;
  - a Knockdown while Sheathed can't Block;
  - a ledge Fall doesn't cancel it;
  - a new Duel starts drawn;
  - two runs give the same hash (`purity.test.ts` style).

## Stage 3: Movement
**Where:** `src/sim/step.ts` (`walk`, `fly`, takeoff), `src/sim/gait.ts:325`.
- `walk()`: multiply by `sheathedWalkFactor` when `f.sheathed` and the Action is not Sheathe or Draw. Split out a
  drawn-speed walk for `takeOff` (`step.ts:191`). `fly()` already uses `fighter.walkSpeed`, so leave it.
- Gait: stride scales with the Fighter's actual speed, so a Sheathed walk takes longer steps and the feet don't slide.
- Tests:
  - the Sheathed speed, and that it stacks with Crouch and Slow;
  - a Sheathed Jump has the same arc as a drawn one (compare against `jumpArc`);
  - `jumpReach.measure` is unchanged;
  - no foot slides at Sheathed speed (`gait.test.ts` style).

## Stage 4: Input (keyboard, touch, network)
**Where:** `src/controllers/local.ts`, `src/play/touch.ts`, `src/play/styles.ts`, `src/net/messages.ts`, `src/play/hud.ts` (if hints live there).
- `SHEATHE_KEY = 'KeyR'`, with `LocalButton` gaining `'sheathe'` (pressed only, like kick). Grep for an existing R binding (in the editor or menu) first.
- Touch: a `tap('sheathe', …)` pad next to Jump/Throw. Its icon/label flips with the local Fighter's `sheathed`, which the play
  driver passes in. Update the touch help text (`touch.ts:115`).
- `messages.ts:180`: add `(v.sheathe === undefined || isBool(v.sheathe))`, and a test that rejects a non-boolean.
- Tests: `local.test.ts` (R gives a single pressed Tick), `touch.test.ts` (tapping the pad), `messages.test.ts`.
- _As built:_ no R binding existed anywhere (editor, menu). The touch help text is `TOUCH_HELP` in `src/play/menu.ts`, not
  `touch.ts:115`; the keyboard list there (`KEYS`) gained R too. The pad's face is the pure `sheathePadFace(sheathed)`, and
  `game.ts` sets `touchInput.sheathed` from the local Fighter every frame. The resync state check had already landed in Stage 2.

## Stage 5: Motions and rendering
**Where:** `data/motions/*.json` (authored in the Editor), `src/render/fighterView.ts`, `src/render/ragdoll.ts`, `src/editor/actionLabels.ts`.
- Author `SheatheHip`/`DrawHip` (the hand reaches to the left hip), `SheatheBack`/`DrawBack` (the hand reaches over the right
  shoulder), and `SheathedIdle` (relaxed, empty hands). Do this in the Editor, with Guard links where they start or end on guard.
- `fighterView.update(pose, weapon, sheathed)`: when Sheathed, build a `BladeTransform` from the pose's pelvis (hip) or chest
  (back) joint plus `weapon.sheathe.offset/rotation`, then reuse `placeSword` / `placePolearm` / `placeHammer` as they are.
  Thread `sheathed` through from wherever `update` is called (`renderer.ts`/`stage.ts`).
- Ragdoll: when Sheathed at Death, the Weapon rides the torso instead of leaving the hand (`ragdoll.ts:145` `start`).
- Editor: `actionLabels.ts` gains Sheathe and Draw. Update `session.test.ts` with the new Motion names.
- Check visually with the `run` skill: walk Sheathed with each Weapon, and Draw/Sheathe while standing, walking and jumping.
- _As built:_ the slot transform is `sheathedBlade(pose, weapon)` in `src/render/sheathed.ts` (frame: the hips' or shoulders' axis,
  up the spine). Rather than a `sheathed` argument to `fighterView.update`, `drawnPose` puts the Weapon in its slot when the Fighter is
  Sheathed, so the game, the sandbox and the thumbnails all get it, and `FighterView` is unchanged. The ragdoll (`ragdollPose(..., sheathed)`)
  starts the Weapon's particles in the slot and rods them to the torso. The back Motions are a sword's (blade hanging down);
  the Halberd and Sledge Hammer override `SheatheBack`/`DrawBack` (`data/motions/<weapon>/`) to stand their heads up over the shoulder.
  The swap keys' hands were snapped to the slots numerically, and `sheathed.test.ts` checks that the hand meets the slot (within 6 cm and
  20°) at every swap for every Weapon. The Editor previews the Weapon in its slot past/before `swap` (`sheathePreview.ts`), with the
  off hand let go, through `motionPose`'s new `offHandFree` argument. `actionLabels.ts` already had the Actions. Two existing tests had
  assumed things this stage changes: `session.test.ts` assumed the repo had no Motion overrides, and `weapons.test.ts` assumed every
  Motion keeps the off hand on its grip (now except the Sheathe family, which lets go in play). The 1 m Sheathed stride looked like a
  lunge, so the Gait's max lead now grows with √speed (a 0.87 m stride, the cadence a little quicker).

## Stage 6: Audio
**Where:** `src/sim/events.ts`, `src/audio/cues.ts`, `src/audio/stock.ts`/`synth.ts`.
- Events `Sheathed { fighter }` and `Drawn { fighter }` (emitted in Stage 2) map to `Sheathe` / `Draw` cues: a short metallic
  slide, with Draw brighter. Add tests in `cues.test.ts`.

## Stage 7: AI
**Where:** `src/controllers/ai.ts`, `src/controllers/ai.test.ts`.
- The AI never presses `sheathe`.
- If its own Fighter is Sheathed (after an AI Takeover), its first Attack/Block press Draws. Add a test that it doesn't
  stall or spam presses during the Draw, and then fights normally.
- A Sheathed enemy is visible (its Weapon is on its body), so the AI can fairly treat it as unable to Block. While
  Sheathed or mid-Sheathe, it skips feints and defensive spacing and presses the Attack. Add a test that it closes and
  attacks within N Ticks.
- Update the **Reaction Time** repertoire in `CONTEXT.md` ("punishing a Sheathed enemy").

## Stage 8: Wrap-up
- `README.md` controls list (R key). Check the Tuning Data hash (`src/tuning/hash.ts`) picks up the new files and fields.
- Final full `npm test`, `npx tsc --noEmit`, and a lint run if the repo has a lint script.

---

## Verification
- Unit: the stage tests above, plus the full `npm test` and `npx tsc --noEmit`.
- Determinism: a scripted Duel where one Fighter Sheathes, runs, Jumps and Draws gives identical hashes across reruns and across a Rollback (`simulation.test.ts`/`purity.test.ts` patterns).
- Manual (`run` skill, Playwright screenshots):
  - press R: the Weapon goes to the hip or back, and the Fighter runs visibly faster;
  - jumping while Sheathed covers the same gap as when drawn;
  - left click Draws;
  - getting hit mid-Draw;
  - the touch button at phone width;
  - an online two-tab Room shows the same states on both peers.

---

## Prompt to start a new context

```
Implement the weapon Sheathe/Draw feature in this repo (cebollinos11/sword), following the plan in
docs/plans/weapon-sheathe.md. Read CONTEXT.md, docs/adr/, and the plan first; every decision in the
plan's "Decisions" table is final, so don't re-ask them.

Work on branch claude/weapon-sheathe-toggle-3cmj7i. Do the stages in order, one stage per commit (or a few),
test-first, with `npm test` and `npx tsc --noEmit` passing before each commit. Copy the Throw Action
(src/sim/actions/throw.ts) as the pattern for the new Actions, and use CONTEXT.md vocabulary (Sheathe, Draw,
Sheathed; never "holster"). Update CONTEXT.md as behaviour lands. Push after each stage with
`git push -u origin claude/weapon-sheathe-toggle-3cmj7i`. Don't open a PR unless I ask.

Start with Stage 1 (docs and ADR) and Stage 2 (simulation core). Stop after Stage 2 and summarise what
changed and anything in the plan that turned out wrong, before going on to Stage 3.
```
