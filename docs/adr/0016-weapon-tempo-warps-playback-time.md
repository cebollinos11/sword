# 0016 — A Weapon's Tempo warps playback time, not Pose Keys

## Status

Accepted.

## Context

Each Weapon should swing at its own pace: a Sledge Hammer slower than an Arming Sword. Retiming every Attack Motion through a Motion override per Weapon multiplies the Motions to maintain, and a heavy Weapon doesn't feel heavy if the whole swing is simply slowed down. It wants a long Wind-up, a Release that still lands hard and a long Recovery, so each phase needs its own pace.

Pose Keys and markers are independent: nothing ties a Pose Key to the phase it falls in. Moving Pose Keys by phase would let an interpolation that crosses a marker drift, so the pose at `windUpEnd` (the held Wind-up pose) or at `releaseEnd` would no longer be the authored one.

## Decision

- Every Weapon has a Tempo (`tempo: { windUp, release, recovery }` in its Weapon file, each a multiplier, default 1): how much longer than authored each phase of its Attacks lasts.
- The Motion is never changed. Playback time is warped, piece by piece between the `windUpEnd` and `releaseEnd` markers (`src/sim/tempo.ts`). Phase lengths in Ticks come from the stretched markers (`attackTimings`), and a pose is sampled at the authored time the played time maps back to (`motionTargets`). So the pose at each marker is the authored one at any Tempo.
- The Tempo applies to the four Attack Motions only. Kick, Throw, Blocks and reactions play as authored.
- Both warps are written so that a multiplier of 1 contributes exactly 0: the unit Tempo reproduces the authored timing bit for bit.

## Consequences

- Timing is gameplay: a Tempo changes punish windows, Chains, how the AI reads openings (it reads `attackTimings`) and Blade Speed (a slower Release hits softer and is less likely to be a Heavy Blow).
- The speed changes suddenly at each marker. A Motion override is still the way to give a Weapon a different swing shape. The Tempo then stretches that override's phases.
- The Motion Editor keeps its timeline in authored seconds; its preview and blade trail show the picked Weapon at its Tempo.
