# Throwing Dagger: staged implementation plan

> Each stage is built in its own fresh session, one stage per session, in order. Its only inputs are this file and the repo.
>
> **Every stage, in this order:**
> 1. Find the first unticked stage in **Progress**. Do only that stage.
> 2. Read this whole file, including the **Notes for later stages** left by earlier stages. They override anything older in this file. Then read `CONTEXT.md`, `docs/adr/` (0001, 0002, 0005, 0006, 0007), the stage's **Reads** list, and the Kick plan's notes (`docs/plans/kick-mechanic.md`, "Notes for later stages"), which name most of the seams this work reuses.
> 3. Build it test-first (the `tdd` skill), keeping to the stage's **Done when**. Leave anything belonging to later stages alone, even if it is tempting.
> 4. Run `npm test` (and `npx tsc --noEmit` if the stage touched types) until it is green.
> 5. Tick the stage in **Progress**. Under **Notes for later stages**, add a `**Stage N**` block that records the names you chose, any deviations from this plan and why, the gotchas you hit, and anything a later stage must do.
> 6. Commit on `main` as `Stage N of the dagger plan: <summary>`, like the Kick commits (`git log --grep "kick plan"`). Then stop and report.
>
> **The Agreed design is fixed.** If a stage can't be built as written, take the smallest deviation that keeps that design, and note it. If the deviation would change the design itself, stop and ask the user.

## Context
Today a Fighter who turns and runs gets away: everyone walks at `fighter.walkSpeed`, so a chaser never closes the gap. A Throwing Dagger gives the chaser an answer. A hit Staggers the runner and slows them, so the chaser can catch up. It costs something to use: you get a few daggers per Duel, the throw ties up your hands, and anyone who turns to face it in time can Block it. The sim has no projectiles yet. Like everything else, the dagger has to live inside the deterministic Tick (ADR 0001) so that Rollback and AI-on-both-peers (ADR 0005) keep working.

## Agreed design (from the design interview — do not re-litigate)
- **Input:** the **E** key sets a new Intent field, `throw` (one press = one Tick, like `kick`). E is unbound today.
- **Ammo:** each Fighter carries **3 daggers per Duel** (`dagger.count`). The count resets when a new Duel starts. There are no pickups, and a thrown dagger is gone.
- **The Throw Action:** a new Action, `Throw`, with Wind-up / Release / Recovery driven by Motion markers, like an Attack. It lasts about 0.5 s in total.
  - It starts from Idle, with at least one dagger left, on the ground or during a Jump (the same rule as the Kick's `startAction`). Crouching is allowed.
  - While throwing, the Fighter **can walk and turn** (at `dagger.throwWalkFactor` of its speed, default 1). It **can't Attack, Block, Kick, Feint or cancel** the throw.
  - It is thrown with the **off (left) hand**, for every Weapon. With a two-handed Weapon, the off hand lets go of the Off-hand Grip during the throw and goes back to it in Recovery. The Weapon stays in the sword hand.
  - On the first Tick of Release, the dagger leaves the left hand and the count drops by one.
- **Flight:** a simulated projectile with a launch speed and gravity (`dagger.speed`, `dagger.gravity`).
  - It is aimed by the thrower's `facing` and `pitch`, plus a small upward loft (`dagger.loft`).
  - Each Tick it moves along its arc. The segment from its last position to this one is swept against Hit Zones, in the style of the Blade Sweep (ADR 0002).
  - It stops when it hits a Wall or a Walk Surface, when it hits a Fighter, or after `dagger.maxTicks`.
  - It **passes through its thrower and the thrower's teammates**, and it ignores Weapon capsules.
- **Block rule (decided by rule, not geometry, as in ADR 0002):** a dagger that reaches a Fighter is Blocked when **all** of these hold:
  - the Fighter is in a **Block in any Direction**;
  - the Fighter **roughly faces the thrower** (`roughlyFaces`, with the thrower's position as it is on the contact Tick);
  - that **Block was raised on or after the Tick the throw's Wind-up started** (`dagger.thrownAt`). A Block already held before the thrower pressed E does not count. You have to *react* to the throw. A Feint into a Block, or a Block let go and raised again, counts from the moment it was raised.
  - A Blocked dagger stops there and does nothing else: no damage, no Stagger, no slow, and a light Block Impact (`dagger.blockImpact`).
  - A Knockdown guard does not Block daggers.
- **Hit:** when a dagger reaches a Fighter and is not Blocked, it **Hits**. It deals `dagger.damage` (5) × the Hit Zone multiplier. It Staggers the victim (cause `Hit`, which interrupts their Action, as a blade Hit does). It also applies the **Slow**.
  - A dagger Hit on a Fighter in Knockdown wounds it and slows it, but does not Stagger it, the same as a blade.
  - HP that reaches zero goes through the existing Death path (cause `Hit`, with the dagger as the felling blow).
- **Slow:** walking (and air steering) runs at `dagger.slowFactor` (0.6) of the normal speed for `dagger.slowTicks` (3 s = 180 Ticks). A new dagger Hit **restarts the timer** at the same strength. The Slow does not stack. It multiplies with crouch and recoil. It does not slow turning, Jumps, Slides or Motions.
- **AI** (the interviewee had no preference; this is the default): the AI throws at an enemy who is out of `attackRange`, inside `throwRange`, has line of sight, and is moving away. The rate scales with difficulty. When the AI sees a throw Wind-up aimed at it (within its Reaction Time), it turns toward the thrower and raises a Block. Easy often fails to.
- **Tuning Data `data/dagger.json`:** `count 3`, `speed ≈18` (m/s), `gravity 9.8`, `loft ≈4` (deg), `radius ≈0.04` (sweep padding), `maxTicks ≈90`, `damage 5`, `slowFactor 0.6`, `slowTicks 180`, `throwWalkFactor 1`, `blockImpact ≈0.3`.

### Calls made while writing this plan (cheap to change; flag in review)
- Daggers pass through teammates. Friendly fire from a ranged weapon in a 3v3 brawl felt more frustrating than interesting.
- The throw direction comes from `facing` + `pitch`, not from the camera ray. The left hand sits off the camera's line, so near targets may need a little lead. If that feels bad, Stage 2 can aim at the point the camera ray hits instead. That point would come in through the Intent, and the AI would supply it the same way.
- A Blocked dagger simply disappears, so there is no ricochet to render or simulate.

## Codebase map (from exploration)
- **Pure deterministic sim** in `src/sim` (`purity.test.ts` bans `Math.random`, Date, the DOM and three.js). `TICK_RATE = 60` (`constants.ts`).
  - Tick order is in `step.ts` `step()` (~345): `stepFighter` (Action, then walk / turn / tilt / duck / jump), then `settleBodies` (collision, ground, Gait, Skeleton solve, `blade` + `kickLeg` via `bladeAndLeg`), then `resolveChambers` → `findContacts` → `resolveContacts`, then deaths and the duel.
  - `SimState` (`state.ts`) holds only `fighters`; daggers in flight become a new top-level field.
- **Actions:** the union is in `state.ts`, and the handlers and `STARTERS` are in `actions/index.ts`. `actions/kick.ts` (`startKick`, `kickTimings`, markers) is the template for the Throw.
- **Movement:** `walk()` in `step.ts` ~104 already scales speed for recoil and crouch, so the Slow goes in there. `fly()` ~164 is air steering. `locked(f)` lists the Actions that can't walk; the Throw must *not* be in it.
- **Block rule:** `actions/block.ts`. `BlockAction.age` is the number of Ticks since the Block was raised, so the Block was raised on Tick `state.tick - age`. Use `roughlyFaces` and `startBlockImpact`.
- **Contacts:** `combat.ts` (`findContacts` ~78, `resolveContacts` ~128, `staggerFighter` ~144, `hitDamage` ~74, `resolveKick` ~188 as a non-blade template); `sweep.ts` (`closestSegmentSegment`, `sweepContact`); `hitZones.ts` `hitZoneCapsules`.
- **Arena:** `arena.ts` has `blockedAt` (wall at a point and height) and `groundBelow`. It has no segment raycast, so the dagger sub-samples its segment (as `bladeSamples` does).
- **Deaths:** `step.ts` `felled` / `fellingBlow` (~319-345) find the felling Hit event; `DeathBlow` is in `state.ts`.
- **Duel reset:** `match.ts` ~121 calls `createInitialState` for every Duel, so a `daggers` count set there refills each Duel.
- **Tuning:** `src/tuning/index.ts` (`parseTuningData`, the motions glob); `tuning.test.ts` pins the shape and hash.
- **Input:** `src/controllers/local.ts` (`KICK_KEY` ~10, the key handlers ~155); `src/play/touch.ts`.
- **Net:** `src/net/messages.ts` (Intent, FighterState and SimState validators); `PROTOCOL_VERSION = 8`.
- **Render:** `src/render/` (`renderer.ts`, `fighterView.ts`, `impacts.ts`), `src/play/hud.ts`; audio cues in `src/audio/cues.ts`.
- **AI:** `src/controllers/ai.ts` (`isThreat`, `Sighting`, the Kick rule from Kick Stage 5), `data/ai.json`, `testOpponents.ts`.
- **Editor:** `src/editor/actionLabels.ts`, the Motion list, `sandbox.ts`.

---

## Stage 1: Vocabulary, tuning and the Throw Action (no dagger yet)
Goal: pressing E plays a full Throw that spends a dagger, synced over the network. Nothing flies yet.
- **Reads:** the Kick's Stage 2 commit (`git show b482ccd --stat`, then the parts you need), which added an Intent field, an Action, a Motion, Tuning Data and a protocol bump; `state.ts`, `intent.ts`, `actions/index.ts`, `actions/kick.ts`, `step.ts`, `pose.ts`, `skeleton.ts` (look for how the Off-hand Grip is applied), `tuning/index.ts`, `controllers/local.ts`, `net/messages.ts`, `match.ts`.
- **`CONTEXT.md`:** add **Throwing Dagger** (_Avoid_: knife, projectile, shuriken), **Throw** (the Action) and **Slow** (_Avoid_: debuff, snare, root). Update **Action** to list Throw, and **Death** to say a Hit can come from a dagger.
- **New `docs/adr/0008-throwing-dagger-is-a-simulated-projectile.md`:** the flight and the contact are physical and simulated in the Tick. A Block stops a dagger by rule (any Direction, roughly facing, raised after the throw began), not by blade geometry.
- **`data/dagger.json`:** all the Tuning Data above. Parse it into `tuning.dagger: DaggerTuning`, with whole-number ticks, and update `tuning.test.ts`.
- **`data/motions/throw.json`:** the `Throw` Motion (about 0.5 s, `windUpEnd ≈0.2`, `releaseEnd ≈0.3`). The left hand draws back past the hip or shoulder and snaps forward, releasing at its furthest point forward. The sword hand stays in guard. Two-handed Weapons may need Motion overrides so the sword hand alone holds a sensible guard. Give it a label in `actionLabels.ts`.
- **Off-hand Grip:** while the Action is `Throw`, the left hand follows the Motion instead of the Off-hand Grip (ADR 0004). Find the place where two-handed Grips pin the left hand (pose/skeleton). Hand the hand back with the normal Motion Blend when Recovery ends.
- **Intent:** add `Intent.throw?: boolean`, and set `IDLE_INTENT.throw = false`.
- **State:**
  - `FighterState.daggers: number`, set to `dagger.count` in `createInitialState`.
  - `ThrowAction { kind: 'Throw'; phase: AttackPhase; startTick: number }`. `startTick` is the sim Tick the Wind-up started, which the Block rule needs in Stage 3.
- **`actions/throw.ts`:** `startThrow` (from Idle, `daggers > 0`, grounded or in a Jump's Fall), `updateThrow` (phases from the markers, Idle at the end of Recovery), `throwTimings`, and `THROW_MOTION`. Register it in `actions/index.ts` after `startKick` in `STARTERS`. The Kick wins if both are pressed on the same Tick.
- **`step.ts`:** a Throw is *not* `locked`. `walk` multiplies by `throwWalkFactor` while it lasts. `jumps` is false during a Throw.
- **Spend:** on the Tick the Throw enters Release, `daggers -= 1` and a `DaggerThrown` event is emitted (Stage 2 hangs the spawn off this same transition).
- **Input:** `local.ts` binds `KeyE` as `THROW_KEY`, through `buttonDown('throw')` / `buttonUp`. Add a touch button if one fits; otherwise note that there isn't one.
- **Net:** validate `throw`, `daggers` and the Throw Action, and bump `PROTOCOL_VERSION` to 9.
- **Done when:** a new `throw.test.ts` passes.
  - The phases run in order.
  - The thrower walks and turns, but can't Attack or Block.
  - The count drops once per throw, and a Fighter with 0 daggers can't throw.
  - A throw starts in a Jump.
  - The count refills on the next Duel (`match.test.ts`).
  - `local.test.ts`, `messages.test.ts`, `tuning.test.ts` and `hash.test.ts` are updated.

## Stage 2: Flight
Goal: the dagger leaves the hand, flies an arc, and sticks in Walls and floors. You can see it in the game. It doesn't hit Fighters yet.
- **Reads:** Stage 1's notes and commit; `state.ts`, `step.ts` (`step()` and `settleBodies`), `arena.ts`, `hash.ts`, `snapshot.ts`, `events.ts`, `net/messages.ts`, `render/renderer.ts`, `render/fighterView.ts` (how meshes are interpolated between Ticks).
- **`SimState.daggers: readonly DaggerState[]`** (`state.ts`): `{ owner: number; team: number; thrownAt: number; position: Vec3; velocity: Vec3; ticks: number }`. Put it in `createInitialState` (empty), the hash, the snapshot, and the net validator. It is ordered by spawn, so it is deterministic.
- **New `src/sim/dagger.ts`:**
  - `launchDagger(f, index, tuning)` puts the dagger at the solved left hand, aimed along `facing` + `pitch` + `loft`. Don't add the thrower's velocity. That keeps it readable, and the plan can revisit it.
  - `advanceDaggers(daggers, arena, tuning)` applies gravity and integrates (semi-implicit Euler, fixed order). It sub-samples the segment against `blockedAt` and `groundBelow`. It removes the dagger when it hits something or reaches `maxTicks`, and emits `DaggerStuck { point }`.
  - It returns each surviving dagger's segment (from → to) for Stage 3.
- **`step.ts`:** after `settleBodies` (so that the left hand is solved), spawn a dagger for each Fighter whose Throw entered Release this Tick, then advance all the earlier daggers. A dagger spawned on Tick N first moves on Tick N+1.
- **Render:** `renderer.ts` draws each dagger as a small blade mesh (primitives are fine) along its velocity, interpolated between Ticks like the Fighters. A dagger that stuck stays drawn for about 2 s at the `DaggerStuck` point (render-only). Hide the dagger mesh in the left hand after the release, if one is drawn.
- **Done when:** a new `daggerFlight.test.ts` passes.
  - A level throw lands at the expected distance (check it analytically from speed, loft and gravity).
  - A dagger stops at a Wall in the library Arena.
  - It expires after `maxTicks`.
  - Two runs from the same inputs hash the same, and a Rollback re-simulation matches (`simulation.test.ts` / `session.test.ts`).

## Stage 3: Contact: Hit, Slow and Block
Goal: the dagger hits Fighters; a Hit Staggers, wounds and Slows; a timely facing Block stops it.
- **Reads:** the notes and commits from Stages 1 and 2; the Kick's Stage 3 commit (`git show 3fc68d4`), which added a non-blade contact and a timed FighterState field (`slide`); `combat.ts`, `sweep.ts`, `hitZones.ts`, `actions/block.ts`, `step.ts` (`walk`, `fly`, `felled`, `fellingBlow`), `slide.ts`, `render/ragdoll.ts` (how it uses `DeathBlow`).
- **`FighterState.slow?: { ticks: number }`:** `walk` and `fly` multiply by `slowFactor` while it is present. It counts down in `stepFighter` and is stripped at 0 (it is never stored as zero, just like `slide`). Add it to the net validator.
- **Dagger contacts:** for each dagger's segment from Stage 2, find the first living Fighter that is not on its team and not its owner whose `hitZoneCapsules` the segment passes within `radius` of (reuse `closestSegmentSegment`). Take the earliest along the segment, so that a dagger never passes through one Fighter into another. Run this after blade and Kick contacts in the same Tick, against the post-contact Fighters.
- **`resolveDagger(thrower, defender, dagger)`:**
  - **Blocked** when the defender is in `Block`, `roughlyFaces(defender, thrower)`, and `state.tick - block.age >= dagger.thrownAt`. Remove the dagger. The defender gets `startBlockImpact` scaled by `dagger.blockImpact`. Emit `DaggerBlocked`.
  - **Otherwise a Hit:** `damage × zone multiplier`. `staggerFighter(..., 'Hit')`, unless the defender is in Knockdown. Set `slow = { ticks: slowTicks }`, whether it is new or refreshed. Remove the dagger. Emit `DaggerHit { thrower, defender, zone, point, damage }`.
  - HP that reaches 0 → Death. Teach `fellingBlow` to read `DaggerHit`. Then `DeathBlow` has the point, a nominal speed and `from` = the thrower's position, so the ragdoll is knocked away from the throw.
- **Done when:** a new `daggerContact.test.ts` passes.
  - A Fighter walking away is hit in the back. It takes −5 × the torso multiplier, Staggers, and then walks at 0.6× for exactly 180 Ticks.
  - A second Hit restarts the timer and does not slow further.
  - A Block raised after the throw started, facing the thrower, stops it (no damage, no slow).
  - A Block held from *before* the throw does not stop it.
  - A Block with the Fighter's back to the thrower does not stop it.
  - A teammate standing in the path is passed through, and the enemy behind is hit.
  - A dagger Hit on a Knockdown wounds without Staggering.
  - A dagger can fell a Fighter (Death with the blow).
  - The determinism tests pass.

## Stage 4: Feedback and feel
Goal: Players can read the mechanic without the HUD having to explain it.
- **Reads:** the notes from Stages 1-3; `play/hud.ts`, `audio/cues.ts`, `audio/synth.ts`, `render/impacts.ts`, `render/renderer.ts`, `editor/actionLabels.ts`, `editor/sandbox.ts`, `editor/index.ts`. Use the `run` skill to look at the result in the app.
- **HUD (`hud.ts`):** the Player's daggers left (3 small icons), and a short Slow indicator on the Player while they are slowed.
- **Audio (`cues.ts`):** whoosh on `DaggerThrown`, hit on `DaggerHit` (reuse the Hit cue by zone), clink on `DaggerBlocked`, thunk on `DaggerStuck`.
- **Render:** a slowed Fighter shows it in its body, for example a dagger left stuck in the hit Zone for the length of the Slow (render-only, from the `DaggerHit` event and `slow`). Impacts in `impacts.ts` for Hit/Block.
- **Editor:** the Throw Motion can be shaped (and overridden per Weapon) like the others. `describeAction` shows `Throw · <phase>`. Give the sandbox a scenario with a fleeing dummy.
- **Done when:**
  - `cues.test.ts` maps each of the four dagger events to its cue.
  - `impacts.test.ts` covers the Hit/Block impacts.
  - The sandbox scenario loads.
  - In the running app (`run` skill), screenshots show a dagger in flight, the HUD count dropping 3 → 2, and the Slow indicator after a Hit.
  - The Stage 4 note records how the throw feels: the arc, the speed, the lead needed, and any Tuning Data you changed because of it.

## Stage 5: AI
Goal: the AI uses daggers against runners and defends against them.
- **Reads:** the notes from Stages 1-4; the Kick's Stage 5 commit (`git show 2ef8f3b`) and the most recent AI rework (`git show 8a06c9a --stat`), since the AI changed after the Kick plan; `controllers/ai.ts`, `controllers/ai.test.ts`, `controllers/testOpponents.ts`, `data/ai.json`, `tuning/index.ts` (`parseAi`).
- **`data/ai.json`:** add `throwRange` (about 12 m) and `throwRate` (per Tick), and a per-difficulty factor if difficulties already carry rates. Parse them.
- **`ai.ts`:**
  - **Throw rule:** if the AI is Idle and has daggers, and its target is between `attackRange` and `throwRange`, on line of sight (a sampled `blockedAt` check), and `Sighting` shows it moving *away* (the distance growing), then throw at `throwRate`, gated by the mistake rate. Use the sim rng only. Aim with the target's lead: the AI sets `face`/`pitch` from the target's position plus its velocity × flight time, with a mistake-rate error.
  - **Defend rule:** an enemy Throw in Wind-up or Release aimed roughly at the AI (its facing points within a cone of the AI) is a threat. Once Reaction Time allows, the AI turns to face the thrower and raises a Block. If it raised the Block too early, the throw ignores it, which is the design: the AI must raise it after seeing the Wind-up. Check this rule against the Kick threat: a Kick threat wants the AI standing still, and a throw threat wants a Block, and the two compose.
- **Done when:** `ai.test.ts` passes.
  - The AI throws at a dummy that walks away out of range (`testOpponents.ts`), and never at one that is in melee range.
  - It Blocks a throw it sees in time, and Easy misses some.
  - It stays deterministic.
- **Manual pass in the app:** run from the AI and get slowed; throw at a fleeing AI; Block a throw by turning; watch AI vs AI for dagger spam (3 per Duel should cap it).

---

## Progress
- [x] Stage 1: Vocabulary, tuning and the Throw Action
- [ ] Stage 2: Flight
- [ ] Stage 3: Contact: Hit, Slow and Block
- [ ] Stage 4: Feedback and feel
- [ ] Stage 5: AI

### Notes for later stages
(Each stage appends what the next stages need to know: names chosen, deviations, gotchas.)

**Stage 1**
- `data/dagger.json` -> `tuning.dagger: DaggerTuning` (all eleven values from the plan; `count`, `maxTicks`, `slowTicks` are whole numbers). `data/motions/throw.json` is the `Throw` Motion (0.5 s, `windUpEnd` 0.2, `releaseEnd` 0.3; the left hand draws back over the shoulder by 0.1 s and is at its furthest forward, ~0.5 m ahead, at 0.2 s = the first Tick of Release). Label `Throw · <phase>`; the editor lists `Throw` between `Stagger` and `Thrust`.
- `Intent.throw?: boolean` (E key, `THROW_KEY`; one press = one Tick; `IDLE_INTENT.throw = false`). **No touch button** (nothing fit). `PROTOCOL_VERSION` is 9; `isFighter` validates `daggers` (non-negative integer) and `isAction` the Throw (`phase`, `startTick`).
- `FighterState.daggers: number` (set to `dagger.count` in `createInitialState`, so every Duel refills it). `ThrowAction { kind: 'Throw'; phase; startTick }` in `state.ts`. **`startTick` is the `SimState.tick` the Wind-up's step produced**, the same Tick number `state.tick` has afterwards; `BlockAction.age` is 0 on the Tick the Block is raised, so a Block raised on Tick T has `state.tick - age === T`. Stage 3's rule `state.tick - block.age >= dagger.thrownAt` compares like with like. Carry `thrownAt = startTick` into the launched dagger.
- `ActionContext` gained `tick` (the Tick being produced) so a starter can record it.
- `actions/throw.ts` exports `startThrow`, `updateThrow`, `throwTimings(tuning, weapon)` -> `{windUpEnd, releaseEnd, end}`, `THROW_MOTION`, `throwOffHandFree(f, tuning)`; `startThrow` is registered after `startKick` in `STARTERS` (Kick wins a same-Tick press; a Block/Attack Idle-start is not possible since they need Idle). The Wind-up never holds; nothing can cancel a Throw, but a Stagger interrupts it like any Action (it then spends nothing: the dagger is spent only on entering Release).
- **The spend/launch hook is in `step.ts` `stepFighter`:** `released` is true on the Tick the new Action is `Throw`/`Release` and the previous one was not; it emits `DaggerThrown { thrower }` and does `daggers - 1`. Stage 2 should spawn the dagger from the same transition, but it needs the solved left hand, so do it after `settleBodies` by looking for fighters whose `action` is `Throw`/`Release` and whose *previous* Tick's action was not (or collect the `DaggerThrown` events of this Tick: `thrower` is the Fighter index). `DaggerThrown` is the only event so far.
- `walk()` multiplies by `dagger.throwWalkFactor` while `f.action.kind === 'Throw'` (so the first Tick of the Throw, whose current Action is still Idle, walks at full speed). The Throw is not `locked`, `turn`/`tilt`/`duck` already allow it, and `jumps()` never lists Throw. `fly()` (air steering) is not scaled by `throwWalkFactor`. **Stage 3's Slow must go in both `walk` and `fly`.**
- **Off-hand Grip:** `GaitOffsets.offHandFree?: number` (0..1) in `skeleton.ts`. `solveSkeleton` scales the Weapon pull by `1 - free` and blends the left hand from the Grip spot to the Pose Key's `leftHand` by `free`. `fighterPose` passes `throwOffHandFree(f, tuning)`: it ramps 0 -> 1 over `motionBlendTicks` at the start of the Throw and 1 -> 0 over the same span at its end (0 when not throwing). So the hand lets go during the Throw and is back on the grip when Idle takes over; the sword hand is not forced anywhere (it follows the Throw Motion's `rightHand`, which is the Idle guard). No Weapon override Motions exist (the override folders are empty); the Longsword and Halberd both pass `throw.test.ts` (hilt stays within 0.5 m of its guard, left hand returns to within 2 cm).
- The left hand's solved position is `fighterPose(f, tuning).joints.leftHand` (Stage 2 launch point); it is not stored on `FighterState`, so Stage 2 needs it from `settleBodies`'s pose (call `fighterPose(settled, tuning)` again or capture it there).
- Tests: `src/sim/throw.test.ts` (new), plus cases in `local.test.ts`, `messages.test.ts`, `tuning.test.ts`, `hash.test.ts`, `editor/session.test.ts`. `sandbox.ts` logs `DaggerThrown`. `CONTEXT.md` and ADR 0008 are written.
