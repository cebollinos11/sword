# Animation & feel polish: hit reactions, follow-through, impact feel, soft landing

> Status: planned, not started. Stages 1–4 below are independent; do them in order, one commit (or more) per Stage. Mark each Stage done here (with a short Result) when it lands.

## Context
The Knockdown rework landed on `main` (53fdf98). Looking through the other Motions (`data/motions/*.json`) and the effects code turned up four places that feel stiff or flat. The user picked all four:
1. Every blade Hit plays the same `Stagger` (arm up, lean back), wherever the blow came from.
2. Swings ease linearly from the end of Release back to guard, with no follow-through.
3. A Hit gives only a burst and a sound: no camera reaction.
4. A soft Landing snaps from the Fall pose to Idle, with nothing taking the weight.

Goal: more readable, weightier fights. **Gameplay stays the same**: no timing, damage or Release-window changes. Each Stage is its own commit, in this order, so it can be reviewed bit by bit.

## Stage 1: Directional hit reactions
- New Motions `StaggerLeft`, `StaggerRight`, `StaggerOverhead`, `StaggerThrust` in `data/motions/`, each **0.5 s**, the same length as `Stagger` (the Stagger tests pin this). The body moves away from the blow:
  - Left: the blow comes from the Fighter's left, so the torso twists and leans right and the head snaps away.
  - Overhead: the knees dip and the torso folds forward.
  - Thrust: the torso doubles over at the gut and the hips go back.
  - Right mirrors Left.
- `src/sim/state.ts`: `StaggerAction` gets an optional `from?: Direction` (only for cause `Hit`).
- `src/sim/actions/stagger.ts`: `stagger(cause, hold, from)`. `staggerMotionName(cause, from)` picks `Stagger<from>` when the weapon has that Motion (`weaponMotion`) and falls back to `Stagger` otherwise. `updateStagger` times the Stagger by that same name.
- `src/sim/combat.ts`: `staggerFighter(..., from?)`. The blade-Hit call (around line 362) passes the Hit's `direction`. Dagger Hits (around line 233) stay generic.
- `src/net/messages.ts`: the `Stagger` case also accepts and validates an optional `from` (reuse `isDirection`).
- Check that new Motion files are picked up by the Motion loader (`src/tuning/index.ts`), that the Tuning Data hash covers them, and whether `weaponMotion` lets the Halberd and Sledge Hammer inherit them.

## Stage 2: Attack follow-through
- In `left.json`, `right.json`, `overhead.json` and `thrust.json`, plus the overrides under `data/motions/halberd/` and `data/motions/sledge-hammer/`: **leave every key at or before `releaseEnd` exactly as it is.** Add one follow-through key about 0.1–0.15 s after `releaseEnd`:
  - The blade carries past the line of the swing, the torso over-rotates a little, and the hips settle lower.
  - The final ease back to `"idle"` then starts from that overshoot.
  - `duration` and the markers stay unchanged.
- First confirm in `src/sim/actions/attack.ts` and `src/sim/combat.ts` that Blade Sweeps only hit during Release. If Recovery sweeps can also hit, keep the follow-through hand path out of reach of a target in front (or leave that weapon out).
- Step-in (Thrust only): move the lead foot's home forward during Release with the foot keys. The Gait then steps it in. Hands come only from the Motion, so the blade path is unchanged.

## Stage 3: Impact feel (render only, outside the Simulation; ADR 0001)
- New `src/render/cameraShake.ts`:
  - A pure `shakeFor(events, me, tuning)` turns this Tick's events into impulses:
    - `Hit` with `defender === me`: strong.
    - `Hit` with `attacker === me`: light.
    - A `heavy` Hit: stronger still.
    - A `KickLanded` Knockdown on `me`: strong.
    - A `Land` on `me` with damage: strong.
  - A small `CameraShake` class decays a sum of offsets/rolls each frame (deterministic noise, no `Math.random`, so tests stay stable).
- `src/game.ts` (around line 634, where `placeThirdPersonCamera` is called): feed it the Tick's events the same way `ImpactEffects` gets them, and add the offset after the camera is placed. Don't shake during the final-blow shot camera.
- `src/render/impacts.ts`: a `heavy` Hit gets a bigger, brighter burst.
- Add a camera-shake strength to `data/camera.json`, with 0 meaning off, plus a tuning-panel binding (`src/editor/tuningPanel.ts`) if camera tuning is exposed there.

## Stage 4: Soft landing
- New Motion `LandSoft` (about 0.25 s): the hips dip about 6 cm and the torso leans forward a little, then it returns to `"idle"`.
- `src/sim/step.ts` `land()`: a soft Landing ends the Fall in Idle as now, but plays `LandSoft` instead of `Idle`, unless the Fighter is Sheathed (`SheathedIdle`). In that case use Idle as now, or add a `SheathedLandSoft` if it reads badly.
- `src/sim/actions/index.ts` `updateIdle`: today any Motion that isn't Idle is replaced at once. Let `LandSoft` play out to its end before switching to Idle. Idle still starts any Action over it as normal, so it costs nothing in gameplay.
- Take-off crouch is **not** included: it would delay every Jump, which is a gameplay change. I'll raise it separately if wanted.

## Tests (each Stage ships its own)
- Stagger: a Left blade Hit plays `StaggerLeft` and the Stagger still lasts exactly as long as before. A Dagger Hit plays `Stagger`. A resync message with `from` round-trips, and a bad `from` is refused (`src/net/messages.test.ts`).
- Attacks: the existing `bladeTrack` hash tests (`src/sim/motion.test.ts`) and the hit/feint/chain suites must pass unchanged. That proves Release didn't move.
- Camera shake: unit tests for `shakeFor` (which events shake, and how hard) and for the decay reaching 0.
- Soft landing: a jump on level ground lands, plays `LandSoft`, then Idle. An Attack pressed on the landing Tick starts at once. The air and fall tests still pass.

## Verification
- `npx tsc --noEmit` and `npx vitest run` (the whole suite, currently 1104 passing).
- Stick-figure contact sheets (as for the Knockdown) of each new or changed Motion, from a temporary dump test that is deleted afterwards, rendered to PNG with PIL in the scratchpad and sent to the user.
- Use the `run` skill to launch the game with Playwright and take a few screenshots of a hit reaction and a landing, to check how the skinned body deforms in the new poses.
- Commit each Stage separately on the working branch and push. Only push to `main` when the user asks.
