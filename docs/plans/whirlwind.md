# Whirlwind (spinning AOE move): staged implementation plan

> Every stage first reads: this file, `CONTEXT.md` (**Whirlwind**, **Kick**, **Knockdown**, **Block**, **Stagger**), `docs/adr/` (0001, 0002, 0007, 0012, 0026, 0027, **0029**), and the files that stage names.
> A stage ends only when `npm test` passes and the work is committed. Before finishing, tick the stage's box in **Progress** and add notes for later stages.
> **Status:** Stages 1-4 done: the Whirlwind is playable (hold, spin, contacts) and reads (trail, armed flash, sounds, shake). Stage 5 (AI) next.
> The **Agreed design** below came from the design interview. Do not re-litigate it; raise a conflict with the user instead.

## Why
Players want a move that hits many enemies at once. The goal is **spectacle**: feeling powerful, not fixing a balance problem. It is a **core move**, available to every Fighter in every mode (Duel/Match, Run, Battle), with **no cooldown or cost**. Balance comes from the move itself: a long, readable telegraph and low damage per Hit.

## Agreed design (from the design interview — do not re-litigate)

### Input and Action
- **G key, own Action** (`Whirlwind`, built like the Kick), not an Attack Direction.
- **Weapons in v1:** every Weapon **except the Flail**, sharing one default Motion (per-Weapon Motion overrides as needed). The Flail comes in a later stage.
- **Wind-up (charge):** hold the key. The spin is armed once **1.0 s** has passed (Tuning Data). **Letting go after that spins; letting go earlier cancels** with no spin. Holding longer keeps it armed.
- **During the hold:** the Fighter can **walk slowly** and turn. It **can begin the hold in a Jump or crouched**. **Letting go early is the only cancel**: Q (Feint) and Block don't cancel it.
- **Direction:** **Left or Right only**, taken from the most recent horizontal mouse movement, the same way an Attack Direction is read. The opponent reads it from the pose.

### The spin
- **5 full turns**, each a real **360° Blade Sweep** (ADR 0002: still physical, no hit by radius). Defaults: **0.3 s a turn** (1.5 s in all), all Tuning Data.
- **Moves forward on its own** at **3 m/s** (faster than a 2.5 m/s walk, so it often catches a knocked-down victim again: about 4.5 m covered). The Player **steers** with the mouse left/right, at most **~90°/s**, in wide arcs (no U-turns). All Tuning Data.
- **Height:** the spinner **chooses the height during the spin** by crouching or standing, and the blade rises and falls as it turns. A low Whirlwind sweeps the legs and can be Jumped; a high one can be ducked under (the existing Crouching-under-swings rule).
- **In the air:** released in a Jump, it **spins on after landing**. The Jump's own flight carries it until touchdown and the forward drive takes over on the ground. A Hit on a Fighter in the air knocks it down, as for any Hit (ADR 0012).
- **Spinning Jump:** Space during the spin **Jumps while still spinning** (over gaps, ledges or a low blow); the turns go on in the air and after landing.
- **Hits:** every turn can hit every Fighter in reach, **including one it already hit** (normal Hit rules).
- **Damage:** **half** a normal blade Hit (Hit Zone multipliers still apply).
- **A Hit knocks down** (the full Knockdown: push away, down, Get-up). A Fighter already down can be hit by later turns and pushed again, as with any Hit on a Knockdown.
- **Walls:** the spinning blade **passes through Walls**, is not stopped, and **hits Fighters on the far side**: purely physical. This differs from today's rule, where a Wall Staggers the attacker; it needs a short ADR.
- **Teammates:** the blade Staggers an ally and deals no damage, as today, and also **pushes it aside** out of the path (a short Slide, like a Block's push) so the forward drive isn't held up. The spin goes on.

### Defending
- **Clashes:** normal contact rules. Whichever blade reaches a body first Hits; an enemy Hit on the spinner cancels the spin (below). The Whirlwind has no special parry.
- **Block:** a **normal directional Block** of the spin's side, mirrored as for any Left/Right swing. A Blocked turn deals no damage, **pushes the defender back**, and **does not Stagger the spinner**: the spin carries on to other targets and to later turns.
- **Interrupting:** any **damaging Hit or Kick** landing on the spinner (a Thrust inside the arc, a Throwing Dagger, a Kick) Staggers it and **cancels the remaining turns**.
- **Punish windows:** the 1.0 s hold, interrupting the spin as above, and the short Recovery.

### Ledges
- The forward drive **can carry the spinner off an Abyss edge**. That is the Player's risk; the AI must still check its own path (its usual "never Jump somewhere deadly" care applies to its Whirlwind path too).

### After
- **Short Recovery** (normal length) after the 5th turn, with no extra dizziness.

### Feedback (v1)
- **A hold pose you can read:** the Weapon drawn back to the chosen side and the body coiled, so the Direction shows on the pose (never only on the HUD).
- **An armed cue:** a sound and flash at 1.0 s, when the hold becomes armed, seen and heard by everyone.
- **A whirl trail and whoosh** on every turn, drawn and heard (not simulated), a closed form of the Tick, so a Rollback or replay looks and sounds the same (as the Flail's whirl, ADR 0026).
- **Camera Shake** on every Whirlwind Hit, for the spinner and the victim.

### Crowds (Run and Battle)
- The spin hits **full Fighters only**. Crowd Soldiers are untouched unless promoted.
- **Known limit:** in a crowd it reaches only the Bubble's Attack Slots: `battle.slots.enemies` 4 in a Battle, `delver.attackSlots` 4/3/3/3 in a Run. Waiting enemies hold outside sword reach, so it hits about 4 enemies at most.

### AI
- AI Controllers **use** the spin and **answer** it (Block its side, interrupt it, keep out of reach of the hold). This is gated by difficulty and Style: Aggressive spins more, Defensive less.
- **Not in v1:** the AI always spins standing, never Jumps mid-spin, and answers only by Blocking, interrupting or stepping away, never by Jumping a low Whirlwind or ducking a high one.
- **Beginner neither uses nor answers it**, so it is a "free" move against Beginners. The legacy Easy/Normal/Hard tiers stay frozen: they neither use nor answer it.

## Balance notes (to check in playtests)
- The most a single victim can take is **5 × 0.5 = 2.5× a normal Hit**, plus repeated Knockdowns, if the spinner steers after a Fighter being knocked away. The forward speed against the Knockdown Slide (`heavyBlow.knockdownSlide`-like) decides whether this clears space or kills. Tune the forward speed below the Knockdown Slide speed if it should mostly clear space.
- With no cooldown, the move's strength in a Duel depends entirely on the 1.0 s hold being readable and the spin being interruptible.

## Codebase map (from exploration)
- **Pure deterministic sim** in `src/sim`; `purity.test.ts` bans Math.random, Date, the DOM and three.js. Everything below that decides an outcome lives here (ADR 0001).
- **Actions:** `src/sim/actions/`. The header of `actions/index.ts` says how to add one: the `Action` union in `state.ts`, a handler in its own file, `HANDLERS`, and a starter in `STARTERS` (order matters: Sheathe, Kick, Throw, Attack, Block). `kick.ts` is the template (phases from Motion markers `windUpEnd`/`releaseEnd`, `kickSweepLive`); `attack.ts` shows a held Wind-up (`attackSweepLive`, `landed`).
- **Movement:** `step.ts`: `locked()` (~124) says who cannot walk; the walk itself (~148) scales `fighter.walkSpeed`; air flight goes through `flyBody` (~201). Jumps start in the jump rule there (Idle, Blocking or Attacking).
- **Contacts:** `combat.ts`: `findContacts` (~154) builds blade contacts per attacker against every defender, then `wallContact` (~140, ~190) cuts the sweep at the first Wall; `resolveContacts` (~326) → `resolveContact` / `resolveWall`; `staggerFighter` (~346); `hitDamage` (~103); `resolveChainKnockdowns` (~537, ADR 0027). `block.ts` `blocksAttack` holds the Block rule (Direction mirrored, roughly facing).
- **Intent:** `src/sim/intent.ts`; checked over the wire by `isIntent` in `src/net/messages.ts` (~246). Keys: `src/controllers/local.ts` (`KICK_KEY = 'KeyF'` etc.).
- **AI:** `src/controllers/ai.ts` (its header lists the repertoire; the Kick is the model to follow), difficulties and Styles in `data/ai.json` (`kickRate`-style per-tier rates). `aiGolden.test.ts` / `aiGolden.testdata.json` must be re-recorded when AI behaviour changes on purpose.
- **Render / audio:** `src/render/cameraShake.ts`; `src/render/flailChain.ts` and `whirlTurns` (`src/tuning/weapon.ts`) show a drawn whirl as a closed form of the Tick (ADR 0026); audio cues in `src/audio/cues.ts`.
- **Tuning Data:** a new `data/whirlwind.json`, loaded and type-checked in `src/tuning/`.

## Tuning Data `data/whirlwind.json` (starting values)
`armSeconds 1.0`, `holdWalkFactor ≈0.4` (share of `walkSpeed` during the hold), `turns 5`, `turnSeconds 0.3`, `driveSpeed 3.0` (m/s), `steerSpeed 90` (°/s), `damageFactor 0.5`, `knockdownSlide`/`knockdownSlideTicks` (start from `kick.json`'s 1.5 / 24), `blockSlide`/`blockSlideTicks` (start near a Heavy Blow's `blockSlide`, ≈0.4), `allySlide`/`allySlideTicks` (short, ≈0.5 m), `recoverySeconds` (short, about an Attack's Recovery).

## Stages

### Stage 1: Vocabulary, Intent and the hold
- `Intent.whirlwind?: boolean` (G held). Add it to `isIntent`, the Local Controller (`WHIRLWIND_KEY = 'KeyG'`), and any Intent prediction/serialisation.
- `WhirlwindAction` in `state.ts`: `phase: 'Wind-up' | 'Spin' | 'Recovery'`, `direction: 'Left' | 'Right'`, `armed`, `turn`, and per-turn hit bookkeeping (stage 3). Starter in `STARTERS` (after Kick): from Idle, on the ground, in a Jump (`startAction`'s rule) or crouched; not Sheathed. Direction from `intent.direction` when it is Left or Right; for Overhead or Thrust, the Fighter's last horizontal one (decide and test it).
- The hold: armed after `armSeconds`; letting go armed → Spin; letting go earlier → Idle (no Feint, no Block cancel: Q and block do nothing). Walk at `holdWalkFactor`; turning as normal.
- Default Motions `WhirlwindHold` (coiled to the chosen side, mirrored for Left/Right) with every non-Flail Weapon using it. A Weapon with no Motion (the Flail) cannot start a Whirlwind until Stage 6.
- Events: `WhirlwindPhase { fighter, phase }` and `WhirlwindArmed { fighter }`.
- `CONTEXT.md`: add Whirlwind to the **Action** list, and update **Whirlwind**'s entry from "planned".
- Tests: arms at exactly `armSeconds`; early release cancels; hold walk speed; cannot start Sheathed; starts in a Jump and crouched; hash/snapshot/rollback round-trip.

#### Design (Stage 1)
Settled here; a subagent makes no judgement call on these.

**Tuning Data `data/whirlwind.json`** → `TuningData.whirlwind: WhirlwindTuning` (`src/tuning/index.ts`, parsed like `parseKick`; every key required). All keys of the whole move are parsed now, even those used only from Stage 2 or 3, so the file and its type never change shape again:
`armSeconds 1.0` (positive), `holdWalkFactor 0.4` (fraction), `turns 5` (whole, ≥1), `turnSeconds 0.3` (positive), `driveSpeed 3.0` (non-negative), `steerSpeed 90` (°/s, non-negative), `damageFactor 0.5` (non-negative), `knockdownSlide 1.5` (m), `knockdownSlideTicks 24` (whole), `blockSlide 0.4` (m), `blockSlideTicks 8` (whole), `allySlide 0.5` (m), `allySlideTicks 12` (whole), `recoverySeconds 0.5` (positive; an Attack's Recovery is 0.5 s), `unavailableWeapons ["Flail"]` (Weapon names that cannot Whirlwind yet; each must be a Weapon of the roster).
- **Why `unavailableWeapons`:** every Motion falls back to the default (`weaponMotion`), so "a Weapon with no Whirlwind Motion" cannot be expressed by leaving a file out without touching the Flail's Weapon file. Stage 6 empties the list. `canWhirlwind(tuning, weapon): boolean` (exported from `src/tuning`) is the one test: not listed, and `weaponMotion` finds both hold Motions.
- Ticks: `whirlwindTimings(tuning): { armTicks, turnTicks, spinTicks, recoveryTicks }` in `src/sim/actions/whirlwind.ts`, each `secondsToTicks` (`spinTicks = turns × turnTicks`): 60, 18, 90, 30 by default.

**Intent** `whirlwind?: boolean`: G held this Tick (absent = not held). Like `attack`, a held value, not a press: pressing starts the hold, holding holds it, letting go releases. Not added to `IDLE_INTENT` (absent means not held, so no recorded Intent changes).

**Action** (`state.ts`):
```ts
export const WHIRLWIND_PHASES = ['Wind-up', 'Spin', 'Recovery'] as const;
export type WhirlwindPhase = (typeof WHIRLWIND_PHASES)[number];
export type WhirlwindDirection = 'Left' | 'Right';
export interface WhirlwindAction {
  readonly kind: 'Whirlwind';
  readonly phase: WhirlwindPhase;
  readonly direction: WhirlwindDirection; // fixed when the hold starts
  readonly ticks: number;   // Ticks since the phase began (the starting Tick of each phase is 0)
  readonly armed: boolean;  // Wind-up: held armTicks; stays true through Spin and Recovery
  readonly turn: number;    // Spin: floor(ticks / turnTicks), 0..turns-1; 0 in Wind-up, turns-1 kept in Recovery
}
```
Later Stages add optional fields (Stage 2 the drive heading, Stage 3 the per-turn hit set), each absent outside the Spin so the Stage 1 shape stays valid.

**Starter** `startWhirlwind` (`src/sim/actions/whirlwind.ts`), in `STARTERS` after `startKick`: `[startSheathe, startKick, startWhirlwind, startThrow, startAttack, startBlock]`. Starts when `intent.whirlwind === true`, the Fighter is not `sheathed` (G does nothing while Sheathed: it does not Draw), and `canWhirlwind(tuning, f.weapon)`. Crouched is fine; in the air only in a Jump (`startAction`'s rule already). Emits `WhirlwindPhase {phase: 'Wind-up'}`. Returns `{kind:'Whirlwind', phase:'Wind-up', direction, ticks:0, armed:false, turn:0}` playing the hold Motion at tick 0.
- **Direction (settled):** `whirlwindDirection(d: Direction): WhirlwindDirection`: Left → Left, Right → Right, Overhead or Thrust → **Right**. The Simulation keeps no memory of past Directions; the *Local Controller* remembers the last horizontal gesture and latches it into `intent.direction` when G is pressed, so a human always sends Left or Right. The fallback Right only applies to Controllers that send something else (the AI, touch).

**Update** `updateWhirlwind` (`HANDLERS.Whirlwind`; ignores `attack`, `block`, `kick`, `throw`, `sheathe` and Q's Feint entirely, so none of them cancels it):
- *Wind-up:* G held → `ticks + 1`; when it reaches `armTicks`, `armed = true` and emit `WhirlwindArmed {fighter}` (once, on that Tick). G not held → armed: enter Spin (`ticks 0`, `turn 0`, emit `WhirlwindPhase Spin`); not armed: Idle (`IDLE_ACTION`, `IDLE_MOTION`) and emit `WhirlwindPhase {phase:'Cancelled'}`. So holding from the starting Tick S, the Fighter is armed by the held Intent of Tick S + armTicks (the arming Tick must itself be held), and letting go on any later Tick spins; letting go on Tick S + armTicks or earlier cancels. G is held for armTicks + 1 Intents (1.017 s at the defaults) before a release spins.
- A human whose G overlaps a held attack (or a Wheel Attack) may start a Whirlwind with an Overhead or Thrust Direction; it coils Right. Accepted: the overlap is rare and the result is still a readable Whirlwind.
- *Spin:* `ticks + 1`, `turn = floor((ticks+1) / turnTicks)`; when `ticks + 1 >= spinTicks` enter Recovery (`ticks 0`, turn kept at turns-1, emit `WhirlwindPhase Recovery`). In Stage 1 nothing else happens (no turning, drive or contact: Stage 2 and 3).
- *Recovery:* `ticks + 1`; when `ticks + 1 >= recoveryTicks` → Idle (no event).
- A Stagger, Knockdown or Fall ends it as it ends any Action (`staggerFighter`, ledge Fall after `fall.fallDelay`): nothing new.

**Motions:** two default Motions, `WhirlwindHoldLeft` and `WhirlwindHoldRight` (`data/motions/whirlwindholdleft.json`, `whirlwindholdright.json`; `motionFileName` lower-cases), `loop: false`, no markers, about 0.5 s from the guard (first Pose Key links every channel to `"idle"` as `kick.json` does) into the coiled pose. `WhirlwindHoldRight` is the Right Attack's held Wind-up (`right.json` at `windUpEnd`) coiled further: torso twisted further toward the Weapon side, Weapon drawn back nearly level behind the hip, hips a little lower; `WhirlwindHoldLeft` is the same from `left.json`. The direction shows on the pose. Playback: Wind-up plays the hold Motion of its Direction, the playhead advancing to the Motion's last Tick and then held there; Spin (Stage 1 only) holds that last pose; Recovery plays `Idle` (the Motion Blend takes it back to guard). Stage 2 replaces the Spin's and Recovery's Motions.
- `motionNames()` in the Editor lists both, so `src/editor/session.test.ts`'s Motion list gains them (an expected change), and the files must be written exactly as the Editor saves them (that test re-saves every Motion and compares).

**Movement** (`step.ts`): during a Whirlwind Wind-up, `walk` multiplies the speed by `whirlwind.holdWalkFactor` (with crouch, Slow and backward as usual); turning, pitch and crouch as normal; `jumps()` unchanged (no Jump during the hold). Spin (Stage 1): `locked` (no walk), turning as normal. Recovery: walks normally. A hold carries on through a Jump it started in (as an Attack does); walking off a ledge Falls after `fall.fallDelay` (the hold is lost).

**Events** (`events.ts`): `WhirlwindPhaseEvent {type:'WhirlwindPhase', fighter, phase: WhirlwindPhase | 'Cancelled'}` on entering each phase and on an early release; `WhirlwindArmedEvent {type:'WhirlwindArmed', fighter}`. Both in the `SimEvent` union and `src/sim/index.ts`'s exports. The Editor sandbox's event log may print them.

**Net** (`messages.ts`): `isIntent` accepts `whirlwind` absent or boolean; `isAction` validates `Whirlwind` (phase in `WHIRLWIND_PHASES`, direction Left or Right, `isTick(ticks)`, `isBool(armed)`, `isTick(turn)`). `PROTOCOL_VERSION` 36 → 37.

**Local Controller:** `WHIRLWIND_KEY = 'KeyG'`, `LocalButton` gains `'whirlwind'` (held and pressed like the others; sent as `whirlwind: true` while held or pressed since the last sample, absent otherwise). It keeps `horizontal: 'Left' | 'Right'` (default Right), updated whenever a gesture comes out Left or Right (mouse or `aim`); pressing G latches `latched = horizontal` unless attack or block is held. `releaseAll` lets G go.

**Editor label:** `describeAction`: `Whirlwind · <phase> · <direction>` (+ ` · armed` in an armed Wind-up).

**Hash and snapshot:** a Whirlwind lives only in `FighterState.action`: plain data, hashed and snapshotted with everything else. A Fighter that never presses G has exactly the state it had before; no recorded SimState hash or AI golden moves in Stage 1. The Tuning Data hash changes (new file, new Motions): expected; `src/tuning/hash.test.ts`'s key-order test and `tuning.test.ts`'s fixture gain `whirlwind`.

**Tests** (`src/sim/whirlwind.test.ts`): arms on exactly Tick S + armTicks (event and flag); letting go one Tick earlier cancels (Idle, `Cancelled`); an armed release spins for spinTicks with `turn` counting 0..4, then Recovery for recoveryTicks, then Idle; walk speed during the hold is `holdWalkFactor` of the plain walk; attack, block, kick, throw and a changed Direction during the hold change nothing; Direction Left/Right kept, Overhead/Thrust give Right; cannot start Sheathed, nor with the Flail; starts in a Jump and crouched; a Hit Staggers a holder out of it; snapshot mid-hold → restore → identical hashes forward (Rollback round-trip); a Duel where nobody presses G hashes the same as with `whirlwind: false` sent. Plus `local.test.ts` (G held/pressed, the horizontal latch), `messages.test.ts` (Intent field, Action through a resync), `tuning.test.ts` (parse, defaults, rejections).

#### Tasks (Stage 1)
1. Simulation and Tuning Data: everything above but the Net and the Local Controller.
2. Net and Local Controller: `messages.ts`, `local.ts` and their tests.

### Stage 1 result
- **Built:** `Intent.whirlwind` (G held; `isIntent`, the Editor replay's `parseIntent`), `WhirlwindAction {phase, direction, ticks, armed, turn}` and `startWhirlwind`/`updateWhirlwind` (`src/sim/actions/whirlwind.ts`, after the Kick in `STARTERS`), `data/whirlwind.json` → `tuning.whirlwind` (every key of the move; `unavailableWeapons ["Flail"]`, `canWhirlwind`), the hold Motions `WhirlwindHoldLeft`/`WhirlwindHoldRight`, the hold walk at 0.4×, events `WhirlwindPhase` (Wind-up, Spin, Recovery, Cancelled) and `WhirlwindArmed`, the net validator (`PROTOCOL_VERSION` 37) and the G key with the horizontal-side latch (`local.ts`).
- **Changed from the Design:** arming needs the arming Tick itself held, so G is held for armTicks + 1 Intents (1.017 s) before a release spins; the Design's wording is corrected above. The Local Controller also re-latches the horizontal side on every Tick G is held alone (so a hold that starts as a Block is let go still coils Left/Right). Seconds that round to no Tick and slide Ticks of 0 are refused at load. In Stage 1 the Spin only counts its turns on the held coil pose (no turning or drive yet); Recovery plays Idle.
- **Tests:** `src/sim/whirlwind.test.ts` (24), plus cases in `tuning.test.ts`, `local.test.ts` (7), `messages.test.ts` (3), `replay.test.ts` (1); protocol pins in `messages.test.ts` and `delverMessages.test.ts` moved to 37; the Editor's Motion list gained the two hold Motions. Full suite 3173 passed; `test:slow` 52 passed. No SimState hash or AI golden moved.
- **For Stage 2:** the hold poses were authored without being looked at (Right: twist 55, sword hand (0.5, 1.05, -0.4), rotation (-10, 130, -90), hips 0.86; Left mirrored); check them in the Editor's sandbox before going on. A Whirlwind started in a Jump works both by pressing G with Space and by pressing it mid-air (the Fall starts Actions for a jumper). A hold cannot Jump.
- **To try in a playtest:** whether 1.0 s reads as a fair telegraph, and whether 0.4× walk is too slow to line up a spin.

### Stage 2: The spin's motion
- Spin phase: `turns × turnSeconds`. The body (not only the Weapon) turns a full 360° per turn the chosen way, so the Blade Sweep is real (ADR 0002). Hands and Weapon held out by a `WhirlwindSpin` Motion.
- **Drive:** each ground Tick the Fighter moves `driveSpeed` along its heading; `intent.face` turns the heading by at most `steerSpeed`. Its spinning facing and its heading are separate state (the blade turns, the path arcs). Body collision and Walls still stop the body. **No ledge guard**: it can drive off an Abyss.
- **Height:** blend `WhirlwindSpin` between a high and a low pose by the Fighter's `crouch` amount, so crouching during the spin lowers the blade toward the legs.
- **Air:** released in a Jump, the turns go on through the flight (`flyBody` with the Jump's own speed) and on after landing, when the drive takes over. `jump` during the Spin starts a Jump (a spinning Jump); add the Whirlwind's Spin to the jump rule.
- Recovery: `recoverySeconds` back to guard; no extra whiff penalty.
- Tests: duration; distance covered on flat ground (≈ `driveSpeed × turns × turnSeconds`); steer rate cap; crouch moves the blade's height; air release lands still spinning; drives off a ledge into a Fall.

#### Design (Stage 2)
Settled here; a subagent makes no judgement call on these.

**State.** `WhirlwindAction` gains `heading?: number`: the yaw (radians, `facing`'s convention, wrapped into (-π, π]) the spin drives along. Set on the Tick that enters Spin to the Fighter's `facing` then, present through Spin and Recovery, absent in the Wind-up (so the Stage 1 shape still validates and hashes the same). `isAction` accepts it absent or finite, and requires it in Spin and Recovery.

**Turning: the body spins, the heading is steered apart from it.**
- `spinSign(direction)`: Right → +1, Left → -1. A Right Whirlwind's blade comes from the Fighter's right across its front to its left (as a Right Attack does), so the body turns to its left: yaw increases (the Local Controller turns right by decreasing yaw).
- `steerHeading(heading, face, tuning)`: toward `intent.face` the shorter way by at most `whirlwind.steerSpeed`·π/180·TICK_SECONDS (1.5° a Tick at 90°/s), landing on it exactly when closer; `face` null keeps it. `updateWhirlwind` steers it every Spin Tick (ground and air alike); the Spin's entering Tick sets it, unsteered.
- `spinFacing(action, tuning)` = wrapYaw(heading + spinSign·2π·(ticks mod turnTicks)/turnTicks): a closed form of the Spin's own Tick, so no float error builds over the turns. On the Tick that enters Recovery the facing is exactly `heading` (the fifth turn closes); through the rest of Recovery `turn()` works as usual from there. `step.ts` `turn()` returns `spinFacing(update.action)` whenever the updated Action is a Whirlwind Spin or the Recovery's entering Tick (`ticks === 0`); so `turn` must read the updated Action (pass `update.action` in).
- Facing per Tick in a Spin moves 20° (360/18) plus the steer: Hit Zones, blade and Skeleton all follow `facing`, so the Blade Sweep of Stage 3 is the body's real turn (ADR 0002).

**Drive** (`step.ts`): on the ground during a Spin, the position before collision is `f.position + driveSpeed·TICK_SECONDS·(sin h, cos h)` with `h` the *updated* heading, plus any Slide; `intent.move` is ignored (still `locked`), and neither crouch, Slow nor backward walking scale it. Body collision (`resolveBodies`) and Walls stop the body as for any Fighter. No ledge guard: driving over an edge goes airborne in `settleGround` at the drive's speed. In the air the drive is off, and the flight carries what it had: `fly` keeps a Spin's horizontal velocity as it is (no steering, no air braking), as the Jump's own flight carries a jumper. (Decided in review: a locked Fighter's zero move would bleed it away at `fall.airControl`.) Recovery walks as normal.

**Air.**
- `keepsOnFalling` keeps a Whirlwind **Spin** (not the Wind-up or Recovery): a Spin that drives off a ledge spins on through the air; a hard Landing (beyond `fall.safeHeight`, not a Jump) Staggers it out as for anyone; an Abyss kills it.
- `jumps()` also allows a Whirlwind Spin on the ground (a spinning Jump). Its take-off carries the drive: `takeOff(f.position, <the drive position>, …)`. The Spin goes on in the air (`air.jumped`, so no Fall swap) and after the Landing (`land()` leaves a non-Fall Action alone), when the drive takes over again.
- Released in a Jump (armed in the air: a full Jump lasts 1.7 s), the Spin starts airborne and goes on after landing.

**Motions and height.** Four default Motions, `WhirlwindSpinLeft`/`WhirlwindSpinRight` (high) and `WhirlwindLowLeft`/`WhirlwindLowRight` (low), each a single held pose (`loop: false`, duration about 0.1 s, two Pose Keys with the same pose, no markers; the feet may link to `"idle"`, so the spinner stands on its Weapon's own guard stance), arms out to the leading side so the blade lies roughly level, about 90° from the facing toward the side it comes from (the Right Whirlwind's blade on the Fighter's right), its tip as far out as the Weapon reaches.
- High: sword hand about shoulder height (hand y ≈ 1.4), so a standing spinner's blade passes over a fully crouched Fighter's head.
- Low: sword hand about y ≈ 0.75, torso leaning forward, so with the crouch's own drop (`fighter.crouchDepth` 0.4) a fully crouched spinner's blade sweeps at about 0.3-0.45 m, under the feet of a Fighter at a Jump's apex and through a standing one's shins.
- Playback in Spin: the high Motion of its Direction (a held pose; the Motion Blend from the coil carries it in over `fighter.motionBlend`). In `pose.ts` `solveFighter`, for a Fighter in a Whirlwind Spin, the Motion's targets are blended toward the low Motion's by `f.crouch` (`lerpTargets`) *before* `applyCrouch`, so the blade rises and falls continuously as C is held or let go. `motionNames()` gains the four (the Editor's `session.test.ts` Motion list changes, expected).
- Recovery plays `Idle` (Motion Blend back to guard), as in Stage 1.

**Gait.** During a Spin on the ground both feet are owned by the spin: each Tick they are planted at their Motion home (`footHome`) under the turned body, no steps and no `Step` events (the spinner pivots on the spot as it drives). Implemented in `updateGait`: a Fighter in a Whirlwind Spin returns both feet planted at `footHome(after)`; everything else is unchanged. When the Spin ends the usual glide/step logic takes over from there.

**Hash.** Only a Whirlwind changes; a Fighter that never presses G hashes as before. No recorded hash or golden moves.

**Tests** (`src/sim/whirlwindSpin.test.ts`): the Spin lasts spinTicks and Recovery recoveryTicks; facing moves +20° a Tick for Right and -20° for Left (no steer), is back on the heading at each turn's end and exactly on it as Recovery begins; over one turn the blade tip's bearing from the pelvis covers all eight 45° sectors; on flat ground with `move` held sideways the Spin covers driveSpeed × spinTicks × TICK_SECONDS (4.5 m) along the heading within 1%; with `face` held 180° away the heading changes by at most 1.5° a Tick (135° over the Spin) and the path arcs; standing, the lowest blade point over a turn is above 1.3 m; fully crouched, the highest is below 0.5 m; armed and released in a held Jump, it spins in the air and on after landing, driving again on the ground; Space during a Spin Jumps (still a Whirlwind in the air, take-off speed ≈ driveSpeed) and lands spinning; driving off a ledge goes airborne still spinning and falls (and onto an Abyss is a Death); a Wall stops the body (its position never passes it); snapshot → restore mid-Spin and mid-spinning-Jump hashes identically forward. Plus a `messages.test.ts` case for `heading`.

#### Tasks (Stage 2)
1. Motions and height: the four Spin/Low Motion files, Spin playback in `whirlwind.ts`, the crouch blend in `pose.ts`, the Editor Motion list; tests of blade height and the sweep's sectors (with facing still frozen, a sector test waits for Task 2 — Task 1 tests heights only).
2. Turning, drive, air and Gait: `heading`, `steerHeading`, `spinFacing`, `step.ts` (turn, drive, jumps, keepsOnFalling, take-off), `gait.ts` pivot, `messages.ts`; the remaining tests.

### Stage 2 result
- **Built:** `WhirlwindAction.heading` (Spin and Recovery); `spinSign`, `steerHeading`, `spinFacing` (`whirlwind.ts`): the body turns 20° a Tick about the heading (a closed form of the Spin's Tick, back on the heading at each turn's end and exactly on it as Recovery begins), the heading steered toward `face` at 90°/s. A grounded Spin drives at 3 m/s along the heading (`step.ts` `drive`), can Jump (taking the drive into the flight), keeps spinning off a ledge and through any flight, its flight keeping its speed (no air braking: a review decision, written into the Design). Feet pivot under the body (`gait.ts`). Motions `WhirlwindSpinLeft/Right` (blade level at 1.40 m) and `WhirlwindLowLeft/Right`; a Spin's pose is blended toward the low one by `crouch`, faded in and out over one Motion Blend so the hands never jump (crouched blade 0.30-0.44 m by Weapon and side). `canWhirlwind` needs all six Whirlwind Motions. Sandbox script **Whirlwind** (Editor → Duel sandbox): a Right spin, a crouched Left spin, a spinning Jump, a steered spin.
- **Changed from the Design:** the spin poses' feet link to the guard; Space on the Spin's very last Tick does not Jump; a Spin ending in the air still closes its turn (`keepsOnFalling` keeps Recovery's first Tick).
- **Tests:** `whirlwindSpin.test.ts` (40), `whirlwind.test.ts` (32), a `messages.test.ts` case. Full suite 3218 passed; `test:slow` 52 passed. No recorded hash or golden moved.
- **Looked at in the app** (sandbox, orbit camera; Player vs AI with the G key, no errors): the standing sweep is a level disc at about shoulder height, the crouched one sweeps the shins. The coiled hold reads only from the front: from the side the Weapon is hidden behind the hips. Reshape `WhirlwindHoldLeft/Right` in the Editor if it does not read in play.
- **For Stage 3:** the Blade Sweep is the recorded `blade` from last Tick to this one; at 20° a Tick the chord cuts about 2 cm inside the arc at a 1.5 m tip, so no sub-stepping is needed. A spinner's own facing is not where it looks: `roughlyFaces` checks against the attacker's position, not its facing, so a Block of a spin needs no change there (check). The low pose sweeps under a Jumping Fighter's feet only at the apex.
- **To try in a playtest:** whether 20°/Tick reads as a blur or a spin; whether 3 m/s with a 90°/s steer is controllable; the low spin's height against a standing Fighter's shins.

### Stage 3: Contacts (needs ADR 0029)
- `whirlwindSweepLive`: in Spin, every Tick. In `findContacts`, a Whirlwind's blade meets defenders like an Attack's, with a **per-turn hit set**: a Fighter met once in a turn is not met again until the next turn.
- **Hit (enemy):** `hitDamage × damageFactor` (Hit Zones, `mods.damage` apply), and a Knockdown with `knockdownSlide` away from the spinner, standing or already down (a Hit on a Knockdown pushes it again without restarting it). A Fighter in the air is knocked down as for any Hit (ADR 0012). Chain Knockdowns follow (ADR 0027).
- **Block:** `blocksAttack` with the Whirlwind's Direction (Left/Right mirrored). Blocked: no damage, Block Impact on the defender, a push of `blockSlide` away, and **no Stagger for the spinner**; the spin goes on. A Block Break (Dagger) applies as usual.
- **Ally:** Stagger (no damage) and a push aside (`allySlide`) away from the spin's path. The spin goes on.
- **Walls:** skip `wallContact` for a Whirlwind; defenders past a Wall are met as if it were not there (ADR 0029).
- **Interrupting the spinner:** any damaging Hit (blade or Throwing Dagger) or any Kick on the spinner (a Shove as well as a Knockdown) ends the Whirlwind at once: a Stagger, or the Knockdown. A Trade on the same Tick counts: both land, and the spin ends.
- **Clashes:** normal contact rules; no special parry, no Chamber of a Whirlwind (`chamberedBy` never set for it).
- Crowd Soldiers are untouched (ADR 0020): only full Fighters are met.
- Events: `Hit`/`Block` carry `whirlwind: true` (render, audio and stats can tell them apart).
- Tests: one Hit per turn per defender, 5 at most; half damage; Knockdown and re-hit while down; Block pushes and the spin continues; ally Staggered and pushed with no damage; hit through a Wall; Thrust, dagger and Kick each end the spin; teammates/enemies in a 4-a-side Duel.

#### Design (Stage 3)
Settled here; a subagent makes no judgement call on these.

**When the sweep is live.** `whirlwindSweepLive(prev: Action, next: Action): next is WhirlwindAction` (`whirlwind.ts`): `prev` is a Whirlwind **Spin** and `next` is a Whirlwind (a Spin, or Recovery's entering Tick, which closes the last turn). The Spin's first Tick (coil → Spin) is not live: the blade is only moving out of the coil. The segment's **turn** is `prev.turn` (the segment from Spin Tick k-1 to k finishes the turn Tick k-1 was in; at k = 18 it closes turn 0, though `next.turn` is already 1).

**The hit set.** `WhirlwindAction.met?: { readonly turn: number; readonly fighters: readonly number[] }`: who this Whirlwind has met (Hit, Blocked or pushed as an ally) in turn `turn`, in the order met. Absent until the first contact, so a Whirlwind that meets nobody hashes as in Stage 2. A defender is skipped by `findContacts` when `met.turn === <segment turn>` and `met.fighters` includes it; on resolving a contact the spinner's `met` becomes `{turn, fighters: [...(same turn ? old : []), defender]}` (only while it is still in that Whirlwind in `out`: a Trade may have Staggered it first). `isAction` validates it (turn a Tick count, fighters Fighter indices, no duplicates).

**Finding contacts** (`findContacts`, a branch beside the Attack's): for a live Whirlwind, each other Fighter in the Duel (`inDuel`; Crowd Soldiers are not Fighters and are never met, ADR 0020) not already met this turn is swept as an Attack's defender is: `blocksAttack(defender, spinner, direction)` with the Whirlwind's Direction (Left/Right, mirrored by the rule as for any swing; `roughlyFaces` judges the defender's facing toward the spinner's position), its Weapon capsule added when it Blocks, else its Hit Zones only. **No Chamber** (a Whirlwind is never an `AttackAction`, so `chamberedBy` never exists for it and no contact is `chambered`). **No Wall:** `wallContact` is not called for a Whirlwind (ADR 0029): every defender found is a contact, whatever Walls lie between. Each contact carries `whirlwind: true` (`BladeContact` gains `whirlwind?: true`) and its `bladeSpeed` is the **Weapon's reference speed** (`weapon.speed`), not the swept speed: a spin's tip moves about three times as fast as a swing's, and the move is meant to deal half a normal Hit (decided here), so the speed term is fixed; it also keeps Block Impact and Block Break at a normal blow's strength. A Whirlwind is never a Heavy Blow.

**Resolving** (`resolveContact` hands a `whirlwind` contact to `resolveWhirlwindContact(before, out, c, tuning, emit)`; it returns at once if the spinner was not in a live Whirlwind in `before`):
- *Blocked* (the rule says so): no damage; the defender's Block Impact as for any Block (`startBlockImpact` with the reference speed); a Block Break (`breakAt`) knocks the defender down with its `breakSlide` as usual; otherwise the defender is pushed `whirlwind.blockSlide` over `blockSlideTicks` away from the spinner (`awayFrom`, `push`). **The spinner is not Staggered**: its Whirlwind carries on. Event `Block {…, heavy: false, whirlwind: true}`.
- *Ally* (same Team): no damage, a Stagger (`staggerFighter(…, 'Hit', …, mirrorDirection(direction))`; a Fighter in Knockdown is not Staggered, as now), and a push of `whirlwind.allySlide` over `allySlideTicks` **aside**: along the heading's perpendicular, on the side of the heading the ally stands (cross product of heading and spinner→ally; exactly on the line: the spinner's left, +90° of yaw). Event `Hit {damage: 0, heavy: false, whirlwind: true}`.
- *Enemy Hit:* damage = `hitDamage(tuning, weapon, zone, weapon.speed, onHead) × whirlwind.damageFactor × mods.damage × defender's mods.damageTaken` (no `heavyDamage`). Then `pushDown(wounded, away, whirlwind.knockdownSlide, whirlwind.knockdownSlideTicks, spinner)`: a Knockdown (or, already down, pushed again without restarting it; in the air, as much speed added to its flight, ADR 0012), carrying a chain (`knockedBy`, ADR 0027). `rewardKill` as usual. Event `Hit {…, heavy: false, whirlwind: true}` with `blade` and `travel` as for any Hit. The spinner is not lodged and carries on.
- Every outcome adds the defender to the spinner's `met`.

**Interrupting the spinner.** A blade Hit, a dagger Hit, a Kick's Knockdown and a Heavy Blow already end any Action (Stagger or Knockdown). New: a Kick's **Shove** on a Fighter in a Whirlwind **Spin** Staggers it (cause `Hit`), ending the Spin, with the Shove's own damage and Slide (`resolveKick`). A Shove on a Wind-up or Recovery still leaves the Action untouched. Trades need nothing new: contacts are judged against the pre-resolution state, so a spinner Staggered by a Thrust on the same Tick still lands its own contact that Tick (both land), and its spin ends.

**Events** (`events.ts`): `HitEvent.whirlwind?: true`, `BlockEvent.whirlwind?: true` (present only for a Whirlwind's). A felling Whirlwind Hit is a `DeathBlow` from the Hit as any (`fellingBlow` in `step.ts` reads the Hit event; its `bladeSpeed` is the reference speed, so the ragdoll is not flung).

**Hash.** Nothing changes until a Whirlwind's blade meets someone; no recorded hash or AI golden moves.

**Tests** (`src/sim/whirlwindContact.test.ts`): a standing enemy within reach is Hit once per turn at most, 5 at most over the Spin (when it stays in reach), and never twice in one turn; a Hit deals `hitDamage` at the reference speed × 0.5 (× Hit Zone; a head and a torso case); it knocks down and pushes `knockdownSlide` away; a Fighter already down is Hit again by a later turn, pushed again, its Knockdown not restarted; a Block of the mirrored side (Right spin, Left Block, facing the spinner) deals no damage, pushes the defender ≈ `blockSlide`, gives it a Block Impact, and the spinner is still spinning (and meets it again next turn); a Dagger Block breaks as usual; an ally is Staggered, takes no damage and is pushed sideways off the heading; a defender behind a Wall within reach is Hit, and no `WallStrike` is emitted; a Thrust landing on the spinner, a thrown dagger, a Kick's Knockdown and a Kick's Shove each end the Spin; a Trade (spinner and a Thrust hitting on the same Tick) lands both; a crouched Fighter ducks a standing spin and a crouched spin is Jumped (a Fighter at a Jump's apex over it is not Hit); in a 4-a-side Duel a spin among enemies and allies hits only enemies, Staggers allies, and every result is the same on a re-run (determinism); the spinner never meets itself; a Chain Knockdown follows a Whirlwind Knockdown into another Fighter. Plus a `messages.test.ts` case for `met`.

#### Tasks (Stage 3)
1. Contacts: `whirlwindSweepLive`, `met`, the `findContacts` branch, `resolveWhirlwindContact` (Hit, Block, ally), events, net; tests of Hits, Blocks, allies, Walls, Crowd, height play.
2. Interrupting: the Shove rule in `resolveKick`; tests of every interrupt, the Trade, the 4-a-side Duel and the Chain Knockdown.

### Stage 3 result
- **Built:** `whirlwindSweepLive`; `WhirlwindAction.met` (the per-turn hit set, keyed by the turn of the segment's start); the Whirlwind branch of `findContacts` (no Wall, no Chamber, the reference Blade Speed) and `resolveWhirlwindContact` (`combat.ts`): an enemy takes `hitDamage` at the reference speed × 0.5 and is knocked down 1.5 m away (pushed again if already down, chains follow); a mirrored Block takes no damage, a Block Impact and a 0.4 m push, and the spinner spins on; an ally is Staggered and pushed 0.5 m aside off the heading. A Kick's Shove on a Spin Staggers it (`resolveKick`). `Hit`/`Block` events carry `whirlwind: true`. ADR 0029 Accepted.
- **Changed from the Design / found in review:** contacts carry their segment's `turn`. A Whirlwind push (Block or ally) drops a lying Fighter's old chain (`knockedBy`), as a Shove does. The felling blow (`fellingBlow`, `step.ts`) now skips zero-damage Hits, so a teammate's touch on the same Tick never takes the kill's ragdoll (a small fix for teammate swings too). `met` is refused in the Wind-up on the wire. Accepted as is: a defender exactly at a turn's boundary can be met on two Ticks in a row (the hit set is by Tick, not by blade angle); no Crowd test (Soldiers are not in the Fighter list, so they cannot be met); the head-damage case was replaced by legs (a level standing blade passes at the shoulders).
- **Tests:** `whirlwindContact.test.ts` (16), `whirlwindInterrupt.test.ts` (9), cases in `messages.test.ts` and `death.test.ts`. Full suite 3246 passed; `test:slow` 52 passed. No recorded hash or AI golden moved.
- **Looked at in the app** (sandbox, Whirlwind script): the first spin catches blue, knocks it down for 15 of 100 HP (half a normal Arming Sword Hit) and spins on over it.
- **Numbers worth tuning:** at the reference speed no Weapon's Whirlwind breaks a Dagger's Block (the Sledge Hammer reaches 2.34 against `breakAt` 2.4). `knockdownSlide` 1.5 m against the 3 m/s drive: a victim knocked straight ahead is caught again by the next turn or two (the 2.5× case of the Balance notes).
- **For Stage 4:** feedback reads the `WhirlwindPhase`/`WhirlwindArmed` events and the Action; a Whirlwind Hit is a `Hit` with `whirlwind: true` (Camera Shake for spinner and victim). **For Stage 5:** the AI's Block of a spin is the ordinary rule (mirrored side, facing the spinner); a spinner is interrupted by any damaging Hit, a dagger, or any Kick.

### Stage 4: Feedback
- Render: the hold pose already reads (Stage 1); a whirl trail on every turn and the armed flash, both closed forms of the Tick and the action state (so scrubbing, Rollback and replay draw the same, ADR 0026).
- Audio: an armed cue at `WhirlwindArmed`, a whoosh per turn (rising like the Flail's), the existing Hit/Block sounds.
- Camera Shake on every Whirlwind Hit, for the spinner and the victim.
- Controls help / key hints list G.

#### Design (Stage 4)
Settled here; a subagent makes no judgement call on these. Nothing in `src/sim` changes: no SimState, hash, snapshot, Intent or golden moves. Every effect below is a pure function of Simulation state, the drawn Tick (`prev.tick + alpha`) and the drawn pose, so a scrub, a Rollback or a replay draws and sounds the same (ADR 0026). Nothing here keeps history from frame to frame (unlike the swing trail's `Ribbon`).

**The whirl trail** (`src/render/whirlwindView.ts`, new). A fan behind the drawn blade, swept back round the spinner's vertical axis, instead of a frame-sampled ribbon (at 20° a Tick a ribbon would be a polygon of chords, and its look would depend on the frame rate).
- `whirlTrail(prev: SimState, curr: SimState, i: number, alpha: number): { arc: number; opacity: number; sign: 1 | -1 } | null` (pure). `a = curr.fighters[i].action`; null unless `a.kind === 'Whirlwind'` and the Fighter is not dead.
  - *Spin:* `spun = max(0, a.ticks - 1 + alpha)` Ticks of turning drawn so far (the Spin's entering Tick only moves out of the coil); `arc = min(TRAIL_ARC, spun · 2π / turnTicks)`; `opacity = 1`. `arc` 0 → null.
  - *Recovery*, `a.ticks < TRAIL_FADE_TICKS`: `arc = TRAIL_ARC`, `opacity = 1 - (a.ticks + alpha) / TRAIL_FADE_TICKS` (the fifth turn's trail fades out as the body stops). Later Recovery Ticks: null.
  - `sign = spinSign(a.direction)`. `turnTicks` comes from `whirlwindTimings`, so the function also takes `tuning: TuningData` as a fifth argument.
  - Constants: `TRAIL_ARC = 200°` (in radians; 10 Ticks of turning), `TRAIL_FADE_TICKS = 6`, `TRAIL_SEGMENTS = 24`, `TRAIL_INNER = 0.35` (share of the blade, hilt to tip, where the inner edge runs: as the swing trail's `INNER`), tip opacity 0.75, inner 0.15, colour `0xf4f8ff` (the swing trail's).
- `trailFan(blade: BladeTransform, pivot: {x, z}, trail): { inner: Vec3[]; tip: Vec3[]; alpha: number[] }` (pure): for k = 0..TRAIL_SEGMENTS, θ = arc·k/SEGMENTS; the inner point (hilt + INNER·(tip − hilt)) and the tip, each rotated about the vertical line through `pivot` by δ = −sign·θ (back the way it came). Rotation in `facing`'s yaw convention (forward = (sin h, cos h)), offsets `(dx, dz)` from the pivot: `x' = dx·cos δ + dz·sin δ`, `z' = −dx·sin δ + dz·cos δ`; heights unchanged. `alpha[k] = opacity · (1 − k/SEGMENTS)²` (the mesh multiplies by the tip/inner opacity). k = 0 is the blade where it is drawn.
- The pivot is the Fighter's drawn position (`prev`/`curr` `position` lerped by `alpha`), not the pelvis: the body turns about its position.
- `WhirlwindEffects` (class, same file): `constructor(scene: THREE.Scene)`; `update(prev, curr, alpha, blades: readonly (BladeTransform | undefined)[], tuning)`: one fan mesh per Fighter (made on first need, vertex-coloured, see-through, `DoubleSide`, `depthWrite: false`, `frustumCulled = false`, as `ribbonMaterial`), hidden when `whirlTrail` is null or the Fighter is not drawn; plus the armed flash below. `dispose()` frees geometry and materials.
- The swing trail (`swingTrail.ts` `trailing`) is unchanged: it trails Attacks only, so a Whirlwind leaves only the fan.

**The armed flash** (same file).
- `armedFlash(prev, curr, i, alpha, tuning): { flash: number; glow: number } | null` (pure): non-null only while `curr`'s Action is a Whirlwind **Wind-up** with `armed` (and not dead). `since = a.ticks − armTicks + alpha` (Ticks since the arming Tick; `ticks === armTicks` on it). `flash = since < FLASH_TICKS ? 1 − since / FLASH_TICKS : 0` (`FLASH_TICKS = 12`, 0.2 s); `glow = ARMED_GLOW` (0.3): a steady glint while it stays armed, so the opponent can tell an armed hold from one still charging.
- Drawn as (a) a glint at the blade tip: an additive billboard `THREE.Sprite`, its texture a small radial-gradient `DataTexture` built in code (no DOM), size `0.25 + 0.6·flash` m, opacity `max(flash, glow)`, colour `0xfff1c0`; (b) a ring on the floor at the Fighter's feet (`THREE.RingGeometry`, flat, at the drawn position and `y + 0.02`), radius growing `0.3 → 1.6` m as `flash` goes 1 → 0, opacity `0.8·flash` (gone once `flash` is 0). Both seen by everyone (no "is this my Fighter" test).

**Wiring.** `Renderer.render` (`renderer.ts`) owns one `WhirlwindEffects` and calls `update(prev, curr, alpha, poses.map((p) => p?.blade), world.tuning)` beside the swing trails (a Benched Fighter: undefined, so nothing drawn). The Editor's Duel sandbox (`src/editor/sandbox.ts`) owns one too and calls it in its frame with its own `poses`, so the Whirlwind script shows it.

**Audio** (`src/audio/cues.ts`, `synth.ts`).
- `WhirlwindArmedCue { sound: 'WhirlwindArmed'; fighter; at }` for each `WhirlwindArmed` event (`at` the Fighter's chest, `body(i)`): synth `armed()`: a bright steel shimmer, a short rising ring (~0.4 s, two `ring`/`tone` partials gliding up about a fifth over a quick `hiss` of a blade drawn back). No stock clip (`stockFor` returns null for it).
- `WhirlwindTurnCue { sound: 'WhirlwindTurn'; fighter; turn; of; weight; at }`: one whoosh per turn, from state as the flail's `whirled` is: after the event cues, for each Fighter of `now` not dead whose Action is a Whirlwind **Spin** with `ticks % turnTicks === 0` (the Spin's entering Tick and each turn's start: 5 whooshes at the defaults), `turn = a.turn`, `of = tuning.whirlwind.turns`, `weight = weaponWeight(f)`. Needs `tuning` (like `Whirl`; without it, none). Synth `whirlwindTurn(cue)`: a broad whoosh lasting about a turn (`turnSeconds`, 0.3 s; use 0.3), its pitch and level rising with `turn / max(1, of − 1)` (0.8× → 1.3× pitch), lower for a heavier Weapon (as `swing`). No stock clip.
- Hits and Blocks of a Whirlwind sound as any (their events already sound); a Whirlwind makes no `Swing` cue (it has no `AttackPhase`).

**Camera Shake** (`cameraShake.ts` `shakeFor`): a Whirlwind `Hit` (`e.whirlwind`) is handled before the plain Hit branch:
- on me as the victim: `WHIRL_TAKEN = 0.6` when `damage > 0` (it knocks down), `WHIRL_NUDGED = 0.25` when 0 (an ally pushed aside);
- by me as the spinner: `WHIRL_DEALT = 0.25` when `damage > 0`, and **at most once per Tick** however many it hits (a spin through four enemies on one Tick would otherwise max the shake); nothing for an ally touched.
- Every other event shakes exactly as before (`cameraShake.test.ts`'s existing cases unchanged).

**Controls help** (`src/play/menu.ts`): `KEYS` gains, after `['F', 'Kick']`, `['G (hold)', 'Whirlwind: hold 1 s to coil it to the side you last moved (left or right), let go to spin five turns that hit everyone in reach; the mouse steers, crouch lowers the blade, Space jumps']`; the How to Play tips gain `'A Whirlwind can be Blocked on its mirrored side, ducked when high, jumped when low, and is stopped by any Hit, dagger or Kick.'` Touch play has no Whirlwind button in v1 (unchanged `TOUCH_HELP`).

**Tests.**
- `src/render/whirlwindView.test.ts` (headless, pure functions only): no trail outside a Whirlwind, in the Wind-up, or on the Spin's entering Tick at alpha 0; the arc grows 20° a Tick to `TRAIL_ARC` and stays there; Recovery fades it over `TRAIL_FADE_TICKS` then null; `sign` +1 Right, −1 Left; `trailFan` k = 0 is the blade's inner point and tip exactly, every point keeps its height and its distance from the pivot, and for a real Right Spin (run with `stepDuel`, the Whirlwind sandbox-like setup from `whirlwindSpin.test.ts`) the fan's k-th tip lies on the side the tip of one Tick earlier was (it trails behind); the same `(prev, curr, alpha)` always gives the same fan (no hidden state); `armedFlash` null before arming, flash 1 on the arming Tick at alpha 0, falling to 0 over FLASH_TICKS, glow while still held armed, null in the Spin.
- `src/audio/cues.test.ts`: a `WhirlwindArmed` cue on the arming Tick only; a held-and-released Whirlwind gives exactly `turns` `WhirlwindTurn` cues, on the Spin's Ticks 0, 18, 36, 54, 72, with `turn` 0..4; none without `tuning`; re-running the states (as a replay) gives the same cues.
- `src/render/cameraShake.test.ts`: Whirlwind Hit taken 0.6, ally nudge 0.25, dealt 0.25 once per Tick for two Hits on one Tick, ally touched by me 0 impulses.
- `menu` text: none needed beyond typecheck (no test reads `KEYS`; check `grep KEYS src/play/*.test.ts`).

#### Tasks (Stage 4)
1. Render: `whirlwindView.ts` (trail and flash), its wiring in `renderer.ts` and `sandbox.ts`, `whirlwindView.test.ts`.
2. Audio, shake and help: `cues.ts`, `synth.ts`, `cameraShake.ts`, `menu.ts`, their tests. Disjoint from Task 1; the two may run at once.

### Stage 4 result
- **Built:** `src/render/whirlwindView.ts`: `whirlTrail`/`trailFan` (a 200° fan swept back behind the drawn blade about the Fighter's position, growing 20° a Tick, fading over Recovery's first 6 Ticks) and `armedFlash` (a glint at the blade tip and a floor ring expanding over 12 Ticks on arming, then a steady glint while held armed), drawn by `WhirlwindEffects` in the game's `Renderer` and the Editor sandbox. All closed forms of state, drawn Tick and drawn pose; nothing kept between frames. Audio cues `WhirlwindArmed` (a rising steel shimmer) and `WhirlwindTurn` (a whoosh on each turn's start, rising 0.8× to 1.3× in pitch over the five turns, lower for a heavier Weapon), read from state like the flail's whirl. Camera Shake: a Whirlwind Hit shakes its victim 0.6 (an ally pushed 0.25) and the spinner 0.25 once a Tick however many it hits. The controls help lists G and a Whirlwind tip.
- **Changed from the Design / found in review:** a Fighter faded out (a Battle slot drawn as its impostor) shows no whirl effects; the glint texture is filtered linearly; `Renderer.dispose` frees the effects; a loop paused on one state (`prev = curr`) draws the trail for that state, not one Tick behind. Accepted: an enemy Whirlwind Hit dealing 0 damage (by mods) would shake as an ally push.
- **Tests:** `whirlwindView.test.ts` (16), `cues.test.ts` (+5), `cameraShake.test.ts` (+2). Full suite 3269 passed. Nothing in `src/sim`, `src/net` or `src/controllers` changed, so no hash or golden moved (`test:slow` not needed for this Stage).
- **Looked at in the app** (Editor sandbox, Whirlwind script, no console errors): the armed glint and ring read clearly at the arming Tick; the fan is a pale disc at shoulder height behind the blade in a standing Spin and at shin height in a low one. Not heard by ear (headless).
- **To try in a playtest:** whether the fan's 200° and its opacity read as a spin or a disc (lower `TRAIL_ARC` or tip opacity if it hides the body); the armed cue's loudness against a Hit; whether the spinner's 0.25 shake helps or blurs steering.

### Stage 5: AI
- `data/ai.json`: `whirlwindRate` (and a Style multiplier: Aggressive more, Defensive less). **0 for Beginner and for Easy/Normal/Hard**; set for Skilled and Expert, more up the ladder.
- **Using it:** begin the hold when two or more enemies are within a few metres, or one is down or Staggered. Release when armed; steer toward the densest group of enemies, away from allies. Always standing (no height play, no mid-spin Jump in v1). Its usual check that a Jump is safe applies to its drive path: never drive toward a drop, Lava or Water.
- **Answering it (Skilled, Expert only):** seeing a hold (Reaction Time ago, from state), step out of reach or close in to hit before it arms; seeing a spin, Block its mirrored side, or Thrust or throw a dagger to interrupt when its own blow lands first. Never by Jumping a low one or ducking a high one (v1).
- Update the AI header in `ai.ts` and **Reaction Time** in `CONTEXT.md`. Re-record the AI golden.

#### Design (Stage 5)
Settled here; a subagent makes no judgement call on these. Only `src/controllers/ai.ts`, `src/tuning/index.ts`, `data/ai.json`, `src/net/messages.ts` (the memory validator) and their tests change. Nothing in `src/sim` changes.

**Tuning Data** (`data/ai.json`, `AiDifficulty`, both optional, both in `AI_DIFFICULTY_EXTRAS` so a Style may scale them; `Skill` defaults both to 0 in `skillOf`):
- `whirlwindRate` (fraction): the chance, each Tick the moment is right (below), that it begins a Whirlwind hold. **Skilled 0.03, Expert 0.05.** Absent (0) for Beginner, Easy, Normal and Hard.
- `whirlwindRead` (fraction): the chance, rolled once per enemy Whirlwind phase it sees (one hold, one Spin), that it answers it. **Skilled 0.7, Expert 0.9.** Absent (0) for Beginner, Easy, Normal and Hard.
- Styles: Aggressive `whirlwindRate: 1.6`, Defensive `whirlwindRate: 0.4`. (Off stays off: a Style multiplies.)
- So the legacy tiers and Beginner draw no new random number (`chance(0)` never draws), and `aiGolden.test.ts` does not move: **the AI golden is not re-recorded** (it pins Easy, Normal and Hard only, which are frozen).

**Constants** (`ai.ts`): `WHIRL_NEAR = 1.5` (m beyond its own reach within which an enemy counts for a spin), `WHIRL_ALLY = 1.0` (m beyond its reach: an ally this near forbids a spin), `SPIN_LOOK = 5` (m: who it steers by), `SPIN_AHEAD = 2` (m: how far ahead a steer must be safe ground), `WHIRL_CLEAR = 1.5` (m beyond the spinner's reach it backs out to from a hold), `WHIRL_BLOCK = 1.0` (m beyond the spinner's reach within which it Blocks a Spin), `WHIRL_WATCH = 2.5` (m beyond the spinner's reach within which it answers a Spin at all).

**Safe ground along a path.** `pathIsSafe(arena, tuning, at: Vec2, y: number, dir: Vec2, length: number): boolean` (exported beside `stepIsSafe`): from `at`, `stepIsSafe` once per SAFETY_PROBE along `dir` until `length` is covered, each probe from the ground found under the last (`groundBelow(arena, x, z, y + fall.stepUp)`; none: false). A Wall in the way counts as unsafe (as for a step), so it never starts a spin into a Wall.

**Using it** (`spinMoment`, in `decide` right after the Kick and the throw, before the Sheathed Draw and the openings). It begins a hold, `{ ...base, whirlwind: true, direction }`, when all of these hold, tested in this order (no random number is drawn before the last two):
1. `skill.whirlwindRate > 0`, its Action is Idle, it is on the ground (`!self.air`), not Sheathed, `level` with its focus, and `canWhirlwind(tuning, self.weapon)` (so a Flail never does);
2. either two or more enemies seen on its level within `myReach + WHIRL_NEAR` (flat), or its focus within that distance seen in a Knockdown or a Stagger;
3. no ally seen (the `allies` list) within `myReach + WHIRL_ALLY` of any point of the straight drive path (the segment from its position along `toward` for the drive's length, below): a teammate in the way would be Staggered (found in review: start-only distance let teams of AIs spin into each other);
4. `pathIsSafe` along `toward` its focus for the whole drive (`driveSpeed × spinTicks × TICK_SECONDS`, 4.5 m);
5. `chance(whirlwindRate)`;
6. the side: `direction = this.random() < 0.5 ? 'Left' : 'Right'` (drawn only here).
It always spins standing: no crouch and no Jump in its own Whirlwind (v1).

**Its own Whirlwind** (`ownWhirlwind`, in `decide` once `focused` and `aimAt` are known, **before** the defence branches: a hold it began is committed, as a Player's is, and a Block or Attack Intent would not cancel it anyway):
- *Wind-up:* `{ ...aimAt(focus), whirlwind: !armed, move }` with `move = safeMove(toward)` when the focus is beyond its reach, else ZERO. So it holds until armed and lets go on the next Tick (a Spin). No `attack`, `block`, `kick`, `throw`, `crouch` or `jump`.
- *Spin:* `{ ...IDLE_INTENT, face }` with `face = spinSteer(...)`: the sum over enemies seen on its level within SPIN_LOOK of `unit(toward them) / max(1, d)`, minus 1.5 × the same sum over allies seen within SPIN_LOOK; a zero sum keeps the heading (`face` = the Action's `heading`). The chosen face is kept only if `pathIsSafe` along it for SPIN_AHEAD; otherwise the first safe of `heading`, `heading + 90°`, `heading − 90°`, `heading + 180°` (the steer is capped at 90°/s by the Simulation, so this is a best effort; the start check keeps the straight path safe).
- *Recovery:* nothing special (the usual `default: return base`).

**Answering it** (`answerWhirlwind`, in `decide` after the Attack-threat branch and `dodgeThrow`, before the Kick-threat check; only when `skill.whirlwindRead > 0`, and only while its own Action is Idle or Block). The spinner is the nearest enemy seen (as seen Reaction Time ago: `seen`) on a near level (`near`) whose Action is a Whirlwind Wind-up within `R + WHIRL_CLEAR + 1` or a Whirlwind Spin within `R + WHIRL_WATCH` (`R` = the spinner's reach, `this.reach(o)`). None: null (behaves as before).
- **The roll:** memory `whirlRead: { fighter, phase: 'Wind-up' | 'Spin', since, read }` with `since = seen.tick − action.ticks` (identifies one phase of one Whirlwind). A new (fighter, phase, since) rolls `read = chance(whirlwindRead)`; not read: null (it does not answer that phase). The field is **omitted** from `save()` while null, so an AI that never meets a Whirlwind saves exactly what it did; `load` restores it absent or present; `isAiMemory` accepts it absent or valid (`fighter` a Fighter index, `phase` one of the two, `since` an int, `read` a bool).
- **A hold read:** `left = armTicks − action.ticks − reactionTicks` (Ticks from now before it can arm). Its Attack `direction = chooseDirection(...)` lands in time when `max(windUpEnd, walk) + ceil((releaseEnd − windUpEnd) / 2) < left` (`walk` as `landsInTime`'s): then `startAttack(..., { swingIn: dist > myReach })` (with a step in when beyond reach). Otherwise, within `R + WHIRL_CLEAR`: `{ ...aimAt(spinner), move: retreat(away from spinner) }`; beyond it: `aimAt(spinner)` (it waits, facing it).
- **A Spin read**, `closing = max(0.3, cos)` of the spinner's heading against spinner→it, `reachIn = (dist − R) / (driveSpeed·TICK_SECONDS·closing)` Ticks before the blade can reach it (0 inside `R`):
  1. *Thrust* (its Weapon has one): `dist ≤ myReach + THRUST_REACH`, `dist > R`, and its Thrust's `windUpEnd + ceil(release/2) + reactionTicks < reachIn` (the spinner is seen Reaction Time late; found in review): `startAttack` with direction Thrust (it lands first and ends the spin).
  2. *Dagger*: daggers left, `dist > R + 1`, `dist ≤ ai.throwRange`, `clearLine`, and `throwTimings(...).windUpEnd + reactionTicks < reachIn`: `{ ...aimAt(spinner), ...throwAim(self, spinner, dist), throw: true }` (aimError 0).
  3. *Block*: `dist ≤ R + WHIRL_BLOCK`: `{ ...aimAt(spinner), block: true, direction: mirrorDirection(spin.direction) }` (it faces the spinner, so `roughlyFaces` holds; the mirrored side meets it).
  4. Otherwise: `{ ...aimAt(spinner), move: retreat(away from spinner) }`.
- Never a Jump or a Crouch against a Whirlwind (v1). The legacy tiers and Beginner (`whirlwindRead` 0) never get here.

**Header and docs.** The `ai.ts` header gains a "Whirlwind" bullet (using and answering, the knobs, what it never does), and its fairness rules hold: it reads the Action and pose as seen Reaction Time ago, never Intents. `CONTEXT.md`'s **Reaction Time** notes that an AI answers a Whirlwind's hold and Spin as seen Reaction Time ago.

**Tests** (`src/controllers/aiWhirlwind.test.ts`, new, modelled on `ai.test.ts`'s Duels): the knobs per tier (Skilled 0.03/0.7, Expert 0.05/0.9; Beginner, Easy, Normal, Hard 0/0; Aggressive ×1.6, Defensive ×0.4 of the rate); with `whirlwindRate 1` against two still enemies in reach it holds G for armTicks + 1 Ticks, lets go armed and Spins (a `WhirlwindPhase Spin` event), sending no crouch or jump through the Spin; against one standing enemy it does not start, against one in a Knockdown in reach it does; an ally within reach + 1 stops it; a drive path over an Abyss edge stops it (an Arena with a ledge, as `ai.test.ts`'s ledge tests); in a Spin with enemies to one side it steers toward them, and away from an ally ahead; a Flail AI with `whirlwindRate 1` never sends `whirlwind`; with `whirlwindRead 1`, seeing a Spin come it Blocks the mirrored side facing the spinner (the turn is Blocked: a `Block` event with `whirlwind`); seeing a hold in reach it attacks before arming when it lands in time, else backs out beyond `R + WHIRL_CLEAR` before the spin; with a Thrust reaching past the spinner's blade it Thrusts and the Spin ends (a Stagger of the spinner); with `whirlwindRead 0` it answers nothing; memory round-trips through `save`/`load` mid-answer (a restored AI decides the same), and a `whirlRead`-free memory saves exactly as before; `aiGolden.test.ts` passes untouched. Rewritten (expected): `ai.test.ts`'s "Beginner, Skilled and Expert play Easy, Normal and Hard with every new knob on" (destructures the two new knobs too). Isolated (expected): `ai.test.ts`'s team-coordination tests "flank slots", "turns" and "target spread" set `whirlwindRate: 0` in their fixtures (they measure coordination; a spin moves the Fighters they measure). "no friendly fire" is not isolated: it must pass with the spin on (the path rule above). Plus `messages.test.ts`: `isAiMemory` with and without `whirlRead`, and a bad one refused.

#### Tasks (Stage 5)
1. Using it: Tuning Data and `skillOf`, `pathIsSafe`, `spinMoment`, `ownWhirlwind`/`spinSteer`, the knob and using tests.
2. Answering it: `answerWhirlwind`, `whirlRead` memory, `isAiMemory`, the answering and memory tests, the header.

### Stage 6: The Flail
- A Flail Whirlwind: decide how the ball on its chain spins (rigid in the sim, ADR 0026) and whether its Spin-up adds anything. Own Motion override. Needs a short design interview first.

## Progress
- [x] Stage 1: Vocabulary, Intent and the hold
- [x] Stage 2: The spin's motion
- [x] Stage 3: Contacts
- [x] Stage 4: Feedback
- [ ] Stage 5: AI
- [ ] Stage 6: The Flail
