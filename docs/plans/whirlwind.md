# Whirlwind (spinning AOE move): staged implementation plan

> Every stage first reads: this file, `CONTEXT.md` (**Whirlwind**, **Kick**, **Knockdown**, **Block**, **Stagger**), `docs/adr/` (0001, 0002, 0007, 0012, 0026, 0027, **0029**), and the files that stage names.
> A stage ends only when `npm test` passes and the work is committed. Before finishing, tick the stage's box in **Progress** and add notes for later stages.
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

### Stage 2: The spin's motion
- Spin phase: `turns × turnSeconds`. The body (not only the Weapon) turns a full 360° per turn the chosen way, so the Blade Sweep is real (ADR 0002). Hands and Weapon held out by a `WhirlwindSpin` Motion.
- **Drive:** each ground Tick the Fighter moves `driveSpeed` along its heading; `intent.face` turns the heading by at most `steerSpeed`. Its spinning facing and its heading are separate state (the blade turns, the path arcs). Body collision and Walls still stop the body. **No ledge guard**: it can drive off an Abyss.
- **Height:** blend `WhirlwindSpin` between a high and a low pose by the Fighter's `crouch` amount, so crouching during the spin lowers the blade toward the legs.
- **Air:** released in a Jump, the turns go on through the flight (`flyBody` with the Jump's own speed) and on after landing, when the drive takes over. `jump` during the Spin starts a Jump (a spinning Jump); add the Whirlwind's Spin to the jump rule.
- Recovery: `recoverySeconds` back to guard; no extra whiff penalty.
- Tests: duration; distance covered on flat ground (≈ `driveSpeed × turns × turnSeconds`); steer rate cap; crouch moves the blade's height; air release lands still spinning; drives off a ledge into a Fall.

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

### Stage 4: Feedback
- Render: the hold pose already reads (Stage 1); a whirl trail on every turn and the armed flash, both closed forms of the Tick and the action state (so scrubbing, Rollback and replay draw the same, ADR 0026).
- Audio: an armed cue at `WhirlwindArmed`, a whoosh per turn (rising like the Flail's), the existing Hit/Block sounds.
- Camera Shake on every Whirlwind Hit, for the spinner and the victim.
- Controls help / key hints list G.

### Stage 5: AI
- `data/ai.json`: `whirlwindRate` (and a Style multiplier: Aggressive more, Defensive less). **0 for Beginner and for Easy/Normal/Hard**; set for Skilled and Expert, more up the ladder.
- **Using it:** begin the hold when two or more enemies are within a few metres, or one is down or Staggered. Release when armed; steer toward the densest group of enemies, away from allies. Always standing (no height play, no mid-spin Jump in v1). Its usual check that a Jump is safe applies to its drive path: never drive toward a drop, Lava or Water.
- **Answering it (Skilled, Expert only):** seeing a hold (Reaction Time ago, from state), step out of reach or close in to hit before it arms; seeing a spin, Block its mirrored side, or Thrust or throw a dagger to interrupt when its own blow lands first. Never by Jumping a low one or ducking a high one (v1).
- Update the AI header in `ai.ts` and **Reaction Time** in `CONTEXT.md`. Re-record the AI golden.

### Stage 6: The Flail
- A Flail Whirlwind: decide how the ball on its chain spins (rigid in the sim, ADR 0026) and whether its Spin-up adds anything. Own Motion override. Needs a short design interview first.

## Progress
- [ ] Stage 1: Vocabulary, Intent and the hold
- [ ] Stage 2: The spin's motion
- [ ] Stage 3: Contacts
- [ ] Stage 4: Feedback
- [ ] Stage 5: AI
- [ ] Stage 6: The Flail
