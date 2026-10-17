# Kick mechanic: staged implementation plan

> Every stage first reads: this file, `CONTEXT.md`, `docs/adr/` (0001, 0002, 0003, 0006), and the files that stage names.
> A stage ends only when `npm test` passes and the work is committed. Before finishing, tick the stage's box in **Progress** and add notes for later stages.

## Context
Fighters can only hurt each other with the blade today. A Kick gives you a way to punish an opponent who is moving: walking in or backing off gets you knocked down. It is risky to throw, because the kicker is committed and exposed while kicking. The sim has no pushback and no knockdown yet, and Motions can't lift a foot or tilt the whole body. All of this has to live inside the deterministic Tick (ADR 0001/0003) so Rollback keeps working.

## Agreed design (from the design interview — do not re-litigate)
- **Input:** the **F** key sets a new Intent field, `kick`.
- **Starting a Kick:** from Idle, on the ground, or mid-Jump (only a jumper; the same rule as `startAction`). You can't start a Kick while crouched (`crouch > 0.5`).
- **While kicking:** you can't move, Block, Attack or Feint, and you can't cancel the Kick. You **can turn**.
- **Hit check:** physical. The kicking leg (right knee→toe segment) is swept from last Tick to this Tick against the defender's Hit Zones during Release, in the same style as the Blade Sweep (ADR 0002). A Kick lands at most once. Kicks ignore Blocks and Weapon capsules.
- **Outcome:** decided by the defender's Intent `move` on the contact Tick.
  - **Any movement input** (`|move| > 0`, strafing included) → **Knockdown**: 5 damage, a **Slide** of about 2.5 m away from the kicker, down for 60 Ticks, then the Get-up. This interrupts whatever the defender was doing.
  - **No movement input** (Idle, Attacking and Blocking all count) → **Shove**: 1 damage and a slide of about 0.3 m. It **does not interrupt** their Action, so their swing can still hit you.
  - A fighter who is already in Knockdown is never knocked down again; a kick that hits them counts as a Shove.
  - Teammates take 0 damage, as with blades, but the push still applies.
- **Whiff:** a missed Kick gets a long extra Recovery (`whiffRecovery`).
- **Slides:** solved in the sim and decelerating. They are subject to body collision and arena edges, so **a Kick can push someone off a ledge** (ADR 0006).
- **Knockdown:**
  - The defender **falls flat onto their back**, stays down, then gets up.
  - Throughout (Falling, Down, Rising) they **can turn and can Block** (a `guard` Direction that Blocks by the normal rule), but can't move, Attack, Kick or Jump.
  - They **can be hit normally**: their Hit Zones lie where the body lies, and there is no invulnerability.
- **AI:**
  - It kicks an opponent who is within kick range and moving.
  - It reacts to a Kick Wind-up by standing still (and Blocking if a blade threat is also present).
- **Tuning Data `data/kick.json`:** `knockdownDamage 5`, `shoveDamage 1`, `knockdownSlide 2.5`, `shoveSlide 0.3`, `knockdownSlideTicks ≈12`, `shoveSlideTicks ≈6`, `knockdownTicks 60`, `whiffRecovery ≈24`, `legRadius` (sweep padding).

## Codebase map (from exploration)
- **Pure deterministic sim** in `src/sim`; `purity.test.ts` bans Math.random, Date, the DOM and three.js.
  - Tick order is in `step.ts` `step()`: `stepFighter` (Action, then walk / turn / tilt / duck / jump), then `settleBodies` (collision, ground, Gait, Skeleton solve), then `resolveChambers` → `findContacts` → `resolveContacts`, then deaths and the duel.
- **Actions** live in `src/sim/actions/`.
  - The union is in `state.ts`. Handlers and `STARTERS` are in `actions/index.ts`; its header explains how to add an Action.
  - `attack.ts` (phases come from Motion markers `windUpEnd` / `releaseEnd`) is the template for the Kick.
  - `stagger.ts` and `fall.ts` are templates for the Knockdown.
  - `block.ts` `blocksAttack` / `roughlyFaces` hold the block rule.
- **Contacts:** `combat.ts` (`findContacts` ~62, `resolveContact` ~116, `staggerFighter` ~102); `sweep.ts` (`bladeSamples`, `sweepContact`); `hitZones.ts`.
- **Pose:**
  - `motion.ts` has the Pose Key channels (rightHand, leftHand, torso, hip, leftFoot/rightFoot `{x,z}`).
  - `pose.ts` `fighterPose` replaces the feet with the Gait's.
  - `skeleton.ts` `solveSkeleton` builds the joints in the Fighter-local frame, then places them (around lines 161-256).
  - `gait.ts` `updateGait` / `footPose`.
- **Movement locks** are in `step.ts`: `locked`, `walk`, `turn`, `tilt`, `duck`, `jumps`, `fly`. Ledge handling is in `settleGround` (~251).
- **Tuning:** `src/tuning/index.ts` (`parseTuningData` ~309, the motions glob ~429). `tuning.test.ts` pins the shape and hash.
- **Input:** `src/controllers/local.ts` (MOVE_KEYS, `sample()` ~180); `src/play/touch.ts`.
- **Net:** `src/net/messages.ts` has the Intent validator (~153), the FighterState validator (~217-228) and `PROTOCOL_VERSION = 6`. Commit `16b0e9d` (crouch) is the template for adding an Intent field.
- **AI:** `src/controllers/ai.ts` (`isThreat` ~120, decision logic ~214-337); `data/ai.json`; `testOpponents.ts`.
- **Editor:** `src/editor/actionLabels.ts`, `motionEdit.ts`, `timeline.ts`, `gizmo.ts`.
- **Tests** are vitest files next to the code (`npm test`). The scripted-input helpers are in `src/sim/script.ts`.

---

## Stage 1: Vocabulary and the pose channels
Goal: Motions can own a foot (`kickFoot`) and tilt the whole body (`body`). Nothing uses them in gameplay yet.
- `CONTEXT.md`: add **Kick**, **Shove**, **Knockdown**, **Get-up** and **Slide**. Keep "Knockback" reserved, as the glossary already says.
- New `docs/adr/0007-kick-outcome-by-defender-movement.md`: the contact is physical (a leg sweep), and the outcome is ruled by the defender's movement Intent.
- **`motion.ts`:** add optional Pose Key channels.
  - `kickFoot?: Vec3`: a right-ankle target, Fighter-local.
  - `body?: { tilt: number /*deg, back +*/; drop: number }`.
  - Sample them, ease them, and include them in Motion Blend. When the channel is absent, the value is "not owned" or tilt 0.
- **`skeleton.ts` `solveSkeleton`:**
  - When `kickFoot` is set, use it as the right ankle target, with the toe following the shin.
  - After building `local`, rotate every joint (and the blade) about the ground point under the pelvis by `body.tilt`, then lower everything by `drop`. Keep it analytic.
- **`pose.ts`:** while the Motion sets `kickFoot`, pass it through instead of the Gait's right foot.
- **`gait.ts`:** don't step a foot the Motion owns. When it is released, re-plant it where it is. Also add a way for both feet to follow the Motion (needed for Knockdown in Stage 4): for example, a `body.tilt ≠ 0` or a flag from `fighterPose`.
- **Tuning:** parse the new channels in `src/tuning/index.ts` and update `tuning.test.ts`.
- **Editor:** `motionEdit.ts` / `timeline.ts` can key `kickFoot` and `body`, and the `gizmo.ts` hand gizmo is reused for `kickFoot`.
- **Done when:** the tests below pass, and the existing determinism, Gait and simulation tests are unchanged.
  - A `skeleton`/`pose` test: a key with `kickFoot` puts the right ankle there.
  - `body.tilt 90` lays the joints near the ground.
  - Without the channels, the pose is bit-identical.

## Stage 2: The Kick Action (no contact yet)
Goal: pressing F performs a full Kick that commits the kicker, synced over the network.
- `data/kick.json` holds all the Tuning Data above. Parse it and update `tuning.test.ts`.
- `data/motions/kick.json`: Wind-up / Release / Recovery with markers `windUpEnd` / `releaseEnd`. The right leg is driven by `kickFoot` and snaps forward at Release. It also needs a label in `actionLabels.ts`.
- `Intent.kick?: boolean`; `IDLE_INTENT` gets `kick: false`.
- `state.ts` `KickAction { kind: 'Kick'; phase: AttackPhase; landed: boolean; whiff?: number }`.
- **`actions/kick.ts`:**
  - `startKick`: refused while crouched; it can start in the air only during a jump.
  - `updateKick`: phases from the markers, as in `attackTimings`. When Recovery is reached with `landed` still false, set `whiff` and hold the pose while it counts down.
  - `kickSweepLive`.
- **`actions/index.ts`:** register it, with `startKick` first in `STARTERS`.
- **`step.ts`:** during a Kick, `walk` returns the current position, `jumps` is false, and `turn` still works.
- **Input:** `local.ts` binds F; `touch.ts` gets a kick button if one fits.
- **Net:** in `messages.ts`, validate `kick` and the Kick Action, and bump `PROTOCOL_VERSION` to 7 (follow `16b0e9d`).
- **Each Tick, record the right leg (knee and toe) from the solved Skeleton** as `FighterState.kickLeg`, next to `blade`. Add it to the net validator.
- **Done when:** a new `kick.test.ts` passes.
  - The phases run in order, and a whiff adds `whiffRecovery`.
  - The kicker can't walk, Block or Attack, but can turn.
  - It can't kick while crouched; a jump-kick starts.
  - `local.test.ts` and `messages.test.ts` are updated.

## Stage 3: Contact, Shove and Slide
Goal: the Kick hits; standing victims get Shoved, and moving victims are Slid (the full Knockdown Action comes in Stage 4).
- **`FighterState.slide?: { vx; vz; ticks }`:**
  - In `step.ts`, a Slide moves the Fighter every Tick, decelerating linearly: with initial speed `v0 = 2·d / (T·TICK_SECONDS)`, it covers exactly `d` over `T` Ticks.
  - It still collides with bodies.
  - In `settleGround`, leaving a ledge seeds `air.vx/vz` from the Slide's velocity.
  - Add it to the net validator.
- **`combat.ts` `findContacts`:** for each live Kick that hasn't landed, sweep the previous `kickLeg` to the current one against other living Fighters' Hit Zones. Reuse `sweep.ts` with a padding of `legRadius`. Don't add Weapon capsules.
- **Pass the Tick's intents** from `step()` into contact resolution.
- **New `resolveKick(attacker, defender, defenderIntent)`:**
  - Mark the Kick `landed`.
  - Teammates take 0 damage.
  - Moving and not in Knockdown → `knockdownDamage` plus the knockdown Slide. Until Stage 4, leave a `// Stage 4: knockdown` stub and apply no Action change.
  - Otherwise → `shoveDamage` plus the shove Slide, and the defender's Action is untouched.
  - The direction is kicker→defender on the ground plane.
  - HP that reaches 0 goes through the existing Death path.
- **Events** (`events.ts`): `KickLanded` (with outcome Shove/Knockdown). Hook up audio/FX if events already feed them.
- **Done when:** tests pass.
  - Idle, Blocking and Attacking victims are each Shoved: −1 hp, about 0.3 m, and an Attack continues and can still hit the kicker.
  - A walking victim takes −5 hp and slides about 2.5 m.
  - A teammate takes 0 damage.
  - A Slide near a ledge goes airborne.
  - The Kick lands only once.
  - The determinism tests pass.

## Stage 4: Knockdown and Get-up
Goal: moving victims fall flat, lie for 60 Ticks while able to turn and guard, then get up.
- **`state.ts`:** `KnockdownAction { kind: 'Knockdown'; phase: 'Falling' | 'Down' | 'Rising'; ticks: number; guard: Direction | null }`.
- **Motions:**
  - `knockdown.json`: falls onto the back using `body.tilt`/`drop`, then holds lying.
  - `getUp.json`.
  - Guard pose: layer the Block hand targets onto the lying pose (in the same way as `applyBlockImpact`).
  - Add labels for all of them.
- **`actions/knockdown.ts`:**
  - `knockdown()` constructor.
  - `updateKnockdown`: Falling until the Motion ends → Down for `knockdownTicks` → Rising until the Get-up ends → Idle.
  - Each Tick, `guard = intent.block ? intent.direction : null`.
  - Register it in `HANDLERS`.
- **`block.ts` `blocksAttack`:** also accept a Knockdown with a non-null `guard`, using the same rule.
- **`step.ts`:** during a Knockdown, no walking, jumping, tilting or ducking; turning is allowed.
- **Gait:** both feet follow the Motion during a Knockdown (using the hook from Stage 1).
- **`combat.ts`:** replace the Stage-3 stub. The defender enters `knockdown()` and its `blockImpact` is cleared. A Kick on a Fighter already in Knockdown is a Shove.
- **Net:** validate the Knockdown Action.
- **Done when:** tests pass.
  - A walking victim enters Knockdown and returns to Idle after Falling + 60 Ticks + the Get-up.
  - A blade hits the lying Hit Zones.
  - A downed guard Blocks a matching Attack.
  - A downed Fighter turns but doesn't walk.
  - A re-kick while down is a Shove.

## Stage 5: AI
Goal: the AI uses and respects the Kick.
- **`ai.ts`:**
  - `isThreat` also recognises a Kick Wind-up within reach. The response is `move = 0`, plus a Block only if a blade threat also exists.
  - New rule: if the opponent is within `kickRange` and was last seen moving, kick, gated by the existing reaction-time and mistake rates and `kickRate`. Use the sim rng only.
- Add `kickRange` and `kickRate` to `data/ai.json`, and parse them.
- **Done when:** `ai.test.ts` passes.
  - The AI kicks an approaching dummy (`testOpponents.ts`).
  - It stands still against a kick Wind-up.
  - It stays deterministic.
- **Manual pass in the app:**
  - Walk at the AI and get knocked down, then guard and get up.
  - Kick an AI mid-swing: it is Shoved and its swing still lands.
  - Kick someone off a ledge.
  - Shape the poses in the Editor.

---

## Progress
- [x] Stage 1: Vocabulary and the pose channels
- [x] Stage 2: The Kick Action
- [x] Stage 3: Contact, Shove and Slide
- [ ] Stage 4: Knockdown and Get-up
- [ ] Stage 5: AI

### Notes for later stages
(Each stage appends what the next stages need to know: names chosen, deviations, gotchas.)

**Stage 1**
- `PoseTargets` (`src/sim/motion.ts`) gets optional `kickFoot?: Vec3` and `body?: BodyTarget {tilt, drop}`; both are *absent* (not `undefined`-valued) when no key sets them, so existing targets and hashes are unchanged. Pose Key / tuning types: `BodyTarget` in `src/tuning/motion.ts`; `POSE_KEY_CHANNELS` now also lists `kickFoot` and `body`.
- `lerpTargets` takes a 4th argument `ankleHeight`. A `kickFoot` owned on only one side of a blend is blended from/to the planted right ankle, and stays owned until the blend ends. `channelValue(targets, channel, skeleton)` gives the editor's default for an unset channel.
- `solveSkeleton`: `kickFoot` is the right ankle target (it ignores Gait lift/ground for that foot); the toe points along the shin (knee→ankle). `body.tilt` rotates every joint, the blade tip and the edge about the ground point under the pelvis (`rotateX(v, -tilt)`, back is +, head goes to -z), then lowers by `drop`.
- Gait: `ownedFeet(tuning, weapon, motion)` in `gait.ts` says which feet the Motion owns: right while `kickFoot` is set, **both while `body.tilt ≠ 0`** (the hook Stage 4 needs; Knockdown Motions just need a non-zero tilt). Owned feet never step and stay planted at the Motion's target (`footHome` uses the `kickFoot` x/z for the right foot); on release the normal glide/step logic takes over from there. `fighterPose` needs no foot override: `kickFoot` rides in the targets and the right foot gets no Gait lift.
- `kickFoot` and `body` are not touched by `applyCrouch`/`applyLook`/`applyBlockImpact`; the Kick starts only when not crouched, and Stage 4's guard layering should keep the lying `body`.
- Editor: `kickFoot` has a gizmo target (translate, all three axes) and a field, `body` has fields (tilt°, drop) and a channel toggle; there is no `body` gizmo.
- Tests: `src/sim/poseChannels.test.ts`, plus two cases in `tuning.test.ts`. Remember to ask for `kickFoot` y in Stage 2's Motion: an ankle at rest height is `skeleton.ankleHeight`.

**Stage 2**
- `data/kick.json` -> `tuning.kick: KickTuning` (all nine values; ticks are whole numbers). `data/motions/kick.json` is the `Kick` Motion (1 s, `windUpEnd` 0.3, `releaseEnd` 0.5; the leg fully extends at ~0.4-0.5 s, toe about 0.85 m ahead of the pelvis). Label: `Kick · <phase>` in `actionLabels.ts`; the editor's motion list now includes `Kick`.
- `Intent.kick?: boolean` (one press = one Tick from `LocalController`, F key; `IDLE_INTENT.kick = false`). **No touch button** was added (nothing fit); Stage 5 or later can add one. `PROTOCOL_VERSION` is 7.
- `KickAction { kind: 'Kick'; phase; landed; whiff? }` in `state.ts`. `actions/kick.ts` exports `startKick`, `updateKick`, `kickSweepLive(prev, next)`, `kickTimings(tuning, weapon)`, `KICK_MOTION`, `KICK_MAX_CROUCH`. The Wind-up never holds; it goes straight to Release at `windUpEnd`.
- **Whiff:** `whiff` is not set on the Tick Recovery is entered. It is set on the first Recovery update where `landed` is still false, then counts `whiffRecovery - 1 … 0` while the Motion playhead is frozen. So **Stage 3 only has to set `landed: true` on the contact Tick** (even on the Tick that enters Recovery) and the whiff hold is skipped. A Kick that landed must never get a `whiff`.
- `step.ts`: `locked(f)` now includes a Kick, so `walk` and `fly` give no movement (a kicker in the air keeps its velocity, `airControl` steering is off); `turn` is unaffected. `jumps()` never listed Kick, so no jump while kicking. Block/Attack/Feint are ignored simply because `updateKick` ignores the Intent.
- **`FighterState.kickLeg: { knee, toe }`** (world, `KickLeg` in `skeleton.ts`) is set by `bladeAndLeg(pose)` (in `pose.ts`) wherever `blade` is set: `createInitialState`, `settleBodies` and `staggerFighter`. Any new place that re-solves the pose and writes `blade` must use `bladeAndLeg`. Validated in `messages.ts` (`isFighter`). Stage 3's sweep: previous `kickLeg` -> current `kickLeg` (knee and toe segments), padding `kick.legRadius`.
- Stage 3 still needs: `Intent.kick` has no effect on a Fighter already Kicking; a Hit/Stagger on the kicker interrupts the Kick (normal `staggerFighter`); no events are emitted by the Kick yet (`KickLanded` is Stage 3).
- Tests: `src/sim/kick.test.ts`, plus cases in `local.test.ts`, `messages.test.ts`, `tuning.test.ts`, `hash.test.ts`, `session.test.ts`.

**Stage 3**
- `FighterState.slide?: Slide {vx, vz, ticks}` (`state.ts`; helpers `startSlide(dx, dz, distance, ticks)` / `advanceSlide` in `slide.ts`). `vx/vz` are the *current* velocity (m/s), `ticks` the Ticks left; each Tick moves by the mean of start and end speed, so a Slide covers exactly `distance`. `stepFighter` adds it on top of `walk` for a grounded Fighter and drops it once airborne. It is stripped when it ends, never stored as zero. Validated in `messages.ts` (`isSlide`). Leaving a ledge needs no special seeding: `settleGround` already derives `air.vx/vz` from the Tick's position change, which includes the Slide. A kick on an already-airborne Fighter adds the Slide's mean speed to `air.vx/vz` instead of starting a Slide.
- `combat.ts`: `Contact = BladeContact | KickContact` (`'kick' in c` discriminates; `KickContact {kick: true, attacker, defender, zone, point}`). `findContacts` also sweeps `kickLeg` (knee->toe, prev->next, capsules padded by `kick.legRadius`, `bladeSamples` of the leg length) and yields at most one `KickContact` per kicker (the one with the shortest toe travel). `resolveContacts(fighters, contacts, intents, tuning, emit)` now takes the Tick's Intents; `resolveKick` sets `landed: true` (if the kicker is still Kicking), takes the defender's `intents[defender].move` (`!== 0` on either axis => Knockdown outcome), damages (0 for teammates), pushes along kicker->defender on the ground, and emits `KickLanded {attacker, defender, outcome, zone, point, damage}`. It never touches the defender's Action or `blockImpact`.
- **Stage 4 replaces the stub at the end of `resolveKick`** (marked `// Stage 4: knockdown`): when `knockdown` is true and the defender is not already in Knockdown, put it into `knockdown()` and clear `blockImpact`; the `knockdown` boolean currently ignores "already down" (add `defender.action.kind !== 'Knockdown'`). The Slide is already applied for both outcomes. Note that the Action stub means a "Knockdown" outcome is only a Slide + 5 hp for now.
- A kick Death has `death = {cause: 'Hit', blow: null}` (no Hit event, so `fellingBlow` finds none; the ragdoll copes with a null blow). Stage 4/5 can give `DeathBlow` a Kick variant if the ragdoll should be knocked away.
- Audio: `KickLanded` plays the existing `Hit` cue (zone from the event). `sandbox.ts` logs it. No FX added.
- The Slide runs during any Action (the kicker's `locked` only stops the walk); the AI's `isThreat` doesn't see it. Stage 5 note: a Kick contact needs the victim's *Intent on the contact Tick*, so an AI that stops moving only in Release may still dodge a knockdown but not the Kick.
- Tests: `src/sim/kickContact.test.ts` (new) plus a `slide` case in `messages.test.ts`. The test helper `moveInRelease` gives the victim movement only once the Kick is in Release (otherwise it walks out of reach before the leg arrives).
