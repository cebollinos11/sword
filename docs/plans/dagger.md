# Dagger

## Context
You want a new one-handed Weapon, the Dagger. It is shorter than the Arming Sword and has a quicker Tempo, and it stays out of Runs. Your answers:
- **Name:** `Dagger` (`data/weapons/dagger.json`). It is a different thing from the **Throwing Dagger** (the off-hand projectile, `data/dagger.json`, `tuning.dagger`). The glossary must say so, and the code must never mix the two up.
- **Tempo:** about 0.75 on all three phases (Wind-up, Release, Recovery), so the whole Attack plays about a third faster. The number is checked in play.
- **Damage:** 30, the same as the Arming Sword. Its reference Blade Speed is set so that a typical clean swing does deal about 30 (see Verification 1).
- **Trade-off: a weak Block that can be broken.** Its Block Impact is taken harder and dealt softer. A new rule, the **Block Break**: when a Blocked blow's Block Impact strength on a Dagger reaches a threshold, the Block still stops the blade (no damage, and the attacker recoils as from any Block), but the Dagger's wielder is knocked down with a short Slide away from the attacker. A light, slow blow never breaks it. A fast Halberd, Sledge Hammer or Longsword swing can.
- **Look:** a new `dagger` look with a curved blade. It plays the **default Motions**, like the Arming Sword, with no overrides of its own.
- **Availability:** the Weapon picker, Lobby AI Seats and `random` picks outside Runs. It is left out of Runs via `dungeon.leftOutWeapons`, and no Battle Troop uses it.

The roster is built from `data/weapons/*.json` (`src/tuning/index.ts`), so the Weapon itself is Tuning Data. The code changes are the Block Break rule (Simulation), the new look (render), an icon and a thumbnail.

## Block Impact today (what the Block Break builds on)
- `startBlockImpact` (`src/sim/actions/block.ts:103`): `strength = clamp(bladeSpeed / attacker.speed, 0.5, 1.5) × attacker.blockImpact.dealt × defender.blockImpact.taken × defender mods.blockImpactTaken`. It moves only the pose.
- `resolveContact` (`src/sim/combat.ts`, the `c.blocked` branch around line 432): the attacker Staggers (Blocked), the defender gets a `blockImpact`, and a Blocked Heavy Blow also pushes the defender by `heavyBlow.blockSlide`.
- `pushDown(f, dx, dz, distance, ticks, by, tuning)` (`combat.ts:391`) is the existing "push and knock down", used by Heavy Blows.

Rough strengths with the Dagger taking 1.3, at the clamp's top: an Arming Sword about 1.95, a Longsword about 2.3, a Halberd about 2.9, a Sledge Hammer about 3.5, a Flail about 3.1, and a Dagger on a Dagger (dealt 0.7) about 1.4. A threshold of about 2.4 (to be measured) means the heavy Weapons can break it at full speed and the swords never can.

## Changes

### 1. Weapon file: `data/weapons/dagger.json` (new)
Start from `arming-sword.json` and change:
- `"name": "Dagger"`, `"grip": "oneHanded"`, `"look": "dagger"`.
- `length` about 0.45 (the Arming Sword's is 0.9), `head` = length, `gripLength` about 0.1, `shaftDamage` 1. It cuts (the default).
- `damage: 30`. Set `speed` by measurement (Verification 1). A shorter blade's tip moves slower, and a 0.75 Tempo makes it faster, so 25 is only a starting guess.
- `tempo`: `{ windUp: 0.75, release: 0.75, recovery: 0.75 }`.
- `blockImpact`: `{ dealt: 0.7, taken: 1.3, breakAt: <measured, ~2.4>, breakSlide: ~0.6, breakSlideTicks: ~16 }`. The last three are new fields (step 2). Note the name: `breakAt`, not `knockdownAt`. Pick whichever name reads best, but keep all three under `blockImpact`.
- `sheathe`: the left-hip slot (`"slot": "hip"`). Start from the Arming Sword's offset and rotation, then adjust it in the Editor until the shorter blade sits right.
- No `heavyBlow`, `attacks`, `spinUp` or `chain`.

### 2. Block Break (Simulation)
- `src/tuning/weapon.ts`: add optional `breakAt` (0 = never, the default for every other Weapon), `breakSlide` and `breakSlideTicks` to `WeaponBlockImpact`. Parse them, validating each as a non-negative number and the Ticks as an integer ≥ 1 when `breakAt > 0`. Serialize them only when `breakAt > 0`, so no other Weapon file changes when it is saved. The defaults must leave every other Weapon's Tuning Data and its hash the same.
- `src/sim/combat.ts`, the `c.blocked` branch of `resolveContact`: compute the Block Impact as today. If the defender's Weapon has `breakAt > 0` and `impact.strength >= breakAt`, the defender is `pushDown`'d (`breakSlide`, `breakSlideTicks`, `by` the attacker), deals and takes no damage, and keeps no `blockImpact` (it is in Knockdown now). The attacker still Staggers (Blocked). Otherwise it behaves exactly as now. A Blocked Heavy Blow that also breaks the Block knocks down (the larger push) rather than sliding as well.
- The strength compared is the one `startBlockImpact` returns, so the clamp, `dealt`, `taken` and Relic `mods.blockImpactTaken` all count. Factor out the strength if that is cleaner, but keep one formula.
- Emit something the Renderer and audio can tell apart: either a `heavy`-style flag on the existing `Block` event (e.g. `broken: true`) or a new event. A broken Block should sound and read heavier (reuse the Heavy Blow block cue if there is one). Check `src/audio/cues.ts` and every consumer of the `Block` event.
- A Throwing Dagger Block (`combat.ts:303`) never breaks a Block: its strength is scaled by `tuning.dagger.blockImpact` (0.3) and stays far below the threshold. Assert this in a test rather than special-casing it.
- The Block Break is in the Simulation: it is deterministic and rolls back like any Knockdown. No new `FighterState` field is needed.
- Editor (`src/editor/tuningPanel.ts:117`): add bindings for `breakAt` (0–5), `breakSlide` (0–3 m) and `breakSlideTicks` (1–60) under Block Impact.

### 3. Render look `dagger` (curved blade)
- `src/tuning/weapon.ts`: add `'dagger'` to `WEAPON_LOOKS`.
- `src/render/fighterView.ts`: a `DaggerMeshes` group, built in the constructor next to `this.sword` and added to `this.root`, with `visible` toggled with the others (around line 278), and `placeDagger` next to `placeSword` (line 641). The blade is curved: a few short box segments (about 4 or 5) along the blade, each bent a little further toward the edge side, tapering to a point (or one `ExtrudeGeometry` of a curved 2-D blade outline). Add a small guard, a grip and a pommel. The tip must end at the Weapon's `length` (the simulated tip): the curve bends the drawn blade sideways, never past where it hits. Keep the curve's sideways offset small (a few cm) so the drawing and the Blade Sweep stay close.
- The blood and scuff mark loop (around line 389): a branch for `dagger`, like the sword's, placed on the curved blade at `at`.
- Check the other `look` switches: grep `look ===` and `WEAPON_LOOKS` in `src/render`, `src/editor`, `src/audio`, the thumbnail page, the ragdoll and the sheathed drawing.

### 4. Icon and thumbnail
- `src/play/icons.ts` `WEAPONS`: add a `Dagger` icon, a short curved blade with a small guard, in the same `svg(path…)` style.
- `public/thumbs/weapons/dagger.webp`: generate it with the dev server's `#/thumbs/weapons/dagger` page, as the Quarterstaff's was. Without it the picker card is blank.

### 5. Keep it out of Runs
- `data/dungeon.json`: `"leftOutWeapons": ["Flail", "Quarterstaff", "Dagger"]`.

### 6. Tests and docs
- `src/tuning/weapons.test.ts`: add `Dagger` to the roster list, and a `toMatchObject` for it (look `dagger`, one-handed, tempo 0.75, `breakAt`).
- `src/sim/weapons.test.ts`: one-handed lists, if any.
- `src/tuning/dungeon.test.ts`, `src/sim/runWeapons.test.ts`: `leftOutWeapons` includes the Dagger, and its "never turns up in a Run" check covers it.
- `src/editor/tuningSections.test.ts`: the roster list.
- A new `src/sim/blockBreak.test.ts` (modelled on `heavyBlow.test.ts`):
  - A full-speed Sledge Hammer (and a Halberd) swing Blocked by a Dagger knocks it down with no damage, and the attacker recoils.
  - An Arming Sword swing Blocked by a Dagger never breaks it.
  - A slow or tapped heavy swing (strength below `breakAt`) does not break it.
  - A Throwing Dagger Blocked by a Dagger never breaks it.
  - No other Weapon's Block ever breaks (`breakAt` 0).
  - The rule is the same under Rollback: re-simulating from before the contact gives the same state (use whatever determinism helper the tests already have).
- Tuning hash, AI golden and net tests: update an expected value only where it comes from adding a roster entry or `leftOutWeapons`. If any other Weapon's behaviour changes, that is a bug.
- `CONTEXT.md`:
  - **Weapon roster**: add the Dagger (short, one-handed, Tempo 0.75, Block Break), and add it to the left-out list.
  - **Weapon**: the sheathe-slot sentence (the left hip for the Arming Sword and the Dagger).
  - **Block Impact**: it can now change the outcome for a Weapon with a Block Break, so reword "It changes the pose, never the outcome" to name the one exception.
  - A new **Block Break** entry: the rule above, `blockImpact.breakAt`/`breakSlide`/`breakSlideTicks`, the Dagger's only. Add `_Avoid_: Guard break` (Guard is the Idle pose) and `Knockback`.
  - **Knockdown**: add a broken Block to its causes.
  - **Throwing Dagger**: one line saying it is not the Dagger Weapon.
- An ADR is probably not needed, since it is a small rule that follows the existing patterns. If the implementation ends up changing how Blocks are decided (ADR 0002: Blocks are decided by rule), write a short one.

## Out of scope (note, don't do)
- The AI does not know a Dagger's Block can be broken. A Dagger AI will still Block a Hammer, and an AI facing a Dagger will not seek out heavy swings. A later pass could teach it to dodge or Chamber heavies when holding a Dagger.
- No own Motions (a reverse grip or stabbing Thrust): it uses the defaults.

## Verification
1. **Pick `speed`.** In the scratchpad, write a throwaway script that runs Dagger Attacks (each Direction, varied ranges) into an idle dummy and logs `bladeSpeed` at each Hit. Set `speed` so a typical clean torso Hit deals about 30 (like the Arming Sword's typical Hit; measure that too). Report both sets of numbers.
2. **Pick `breakAt`.** Log the Block Impact strength on a Dagger defender for each attacking Weapon's full and tapped swings. Choose `breakAt` so the full-speed Halberd, Sledge Hammer and spun Flail break it, the Arming Sword and Dagger never do, and decide whether the Longsword should (report its numbers and ask if it is borderline).
3. **Tempo check.** Confirm in play that 0.75 feels right, and that a Chain and a Whiff Chain still work.
4. `npx tsc --noEmit` and `npm test` are all green.
5. Use the `run` skill: pick the Dagger against an AI (try it against a Sledge Hammer AI) and screenshot it held, mid-swing, sheathed at the hip, a broken Block (the Dagger user down), and its icon in the picker.

## Results
Implemented as planned; what differed or was measured:

- **`speed` = 27 (the plan's 25 was a guess).** Blade Speed / damage at the first Hit into an idle Arming Sword, 0.5 to 1.6 m, Overhead / Left / Right / Thrust. The Dagger reaches only to about 1.1 m (its blade is 0.45 m).
  - Dagger at speed 25: torso Hits at 0.9 to 1.1 m were 26.1 (Overhead), 27.9 (Left), 28.3 (Right) and 20.1 (Thrust), so 31, 33, 34 and 24 damage. Close in (0.5 to 0.7 m) 15.0, 17.8, 23.3, 14.8.
  - Arming Sword at speed 25, mid range (1.0 to 1.3 m): Overhead 18.7 to 24.9 (22 to 30 damage), Left 27.7 to 33.5 (33 to 40), Right 28.1 to 33.9 (34 to 41), Thrust 10.5 to 13.4 (13 to 16).
  - At 27 the Dagger's torso Hits come to about 29 (Overhead), 31 (Left, Right) and 22 (Thrust): a typical clean Hit deals about 30.
- **`breakAt` = 2.4, `breakSlide` 0.6, `breakSlideTicks` 16 (the plan's guesses, kept).** Best Block Impact strength on a Dagger (`taken` 1.3) from each attacker's full swing, across Directions and ranges (a tapped swing has the same Blade Speed, except the Flail's Spin-up): Dagger 1.03, Arming Sword 1.74, Longsword 2.34 (its clamp ceiling, reached only 1.7 m and further out), Flail 2.47 spun (Left, at 2.1 m), Quarterstaff 2.54, Halberd 2.93, Sledge Hammer 3.51. At 2.4 the Halberd breaks it from about 1.3 to 1.5 m out, the Sledge Hammer from about 1.3 to 1.4 m, the Quarterstaff only at the far tip, a spun Flail only at its far tip on a Left, and the Longsword never. The Longsword was borderline (2.34), so I asked: you chose 2.4. A spun Flail therefore rarely breaks it; lowering `breakAt` to about 2.0 would make it reliable and let the Longsword's far tip break it too.
- **Blocked Heavy Blow that breaks:** the Block Break's `pushDown` replaces the Heavy Blow's `blockSlide`, as the plan said.
- **`Block` event:** `broken: true` is present only on a Block Break (absent otherwise), so every existing exact-match event assertion stays as it was. The audio adds a Knockdown cue for it and the impact burst is full strength.
- **Tuning hash:** adding the `breakAt`, `breakSlide` and `breakSlideTicks` fields to every parsed Weapon (0, 0, 1 for those without) changes the hash value, as the new roster entry does anyway; no test pins a value, and Weapon files still serialize without them.
- **Test values changed, all because of the new roster entry or its Tempo and reach:** `weapons.test.ts` (roster, a Dagger line, only the Dagger has a `breakAt`), `tuningSections.test.ts` (roster, its file), `dungeon.test.ts` and `runWeapons.test.ts` (`leftOutWeapons`, and the "never turns up" check now covers all three), `tempo.test.ts` (two tests assumed every Weapon but the Flail has unit Tempo: they now skip the Dagger and assert its 0.75), `followThrough.test.ts` (it stood every Weapon 1.3 m from its target, beyond the Dagger's reach: the Dagger stands at 0.9 m). The AI golden, hash and net tests needed no change.
- **Look:** the blade is five boxes (the last the tapered point) bending 3 cm toward the edge side by the tip, tapering from 3.6 cm wide; a 0.1 m guard, a grip and a pommel. Its blood mark is a smear bent and tilted along the blade. The thumbnail `public/thumbs/weapons/dagger.webp` was generated with the dev server's thumbnail page.
- **Tempo check:** by numbers, not by feel: the Attack's Wind-up to Release is 16 to 27 Ticks against the Arming Sword's 21 to 36 (a third faster). I did not judge in live play whether 0.75 feels right (the headless browser ran at about 8 fps). Chain and Whiff Chain are Motion rules independent of Tempo and their tests pass.
- **Out of scope, as planned:** the AI does not know a Dagger's Block can break.
