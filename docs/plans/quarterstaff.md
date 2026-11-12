# Quarterstaff

## Context
You want a new two-handed Weapon: a plain wooden staff with no blade. Its job is crowd control, knocking enemies down often. It plays at the Halberd's Tempo with the Halberd's Motions. Your answers:
- **Knockdown rule:** reuse the existing Heavy Blow with a much lower speed bar, so most clean hits knock down and slow or glancing ones don't. There is no random roll and no new Simulation mechanic.
- **Striking part:** the whole staff strikes (Head = full length).
- **Damage:** about 35 (Halberd 50), and it does not cut.
- **Availability:** the Weapon picker, plus any `"weapon": "random"` pick (these draw from the roster automatically). It is not added to any Battle troop or dungeon list.

The Weapon roster is built from `data/weapons/*.json` (`src/tuning/index.ts:914`), and Motion overrides from `data/motions/<file stem>/` (`weaponFileName`, `src/tuning/weapon.ts:190`). That makes this mostly a Tuning Data change. The code changes are a new render look and an icon.

## Changes

### 1. Weapon file: `data/weapons/quarterstaff.json` (new)
Start from `data/weapons/halberd.json` and change:
- `"name": "Quarterstaff"`, `"grip": "twoHanded"`, `"look": "staff"` (new look, step 3), `"cuts": false`.
- `length: 1.5`, `gripLength: 0.8`, `offHandGrip` the same as the Halberd's (same hands, so its Motions fit).
- `head: 1.5` (= length, so every contact forward of the main hand is a Head contact and can be a Heavy Blow). `shaftDamage: 1` (the butt behind the main hand hits as hard; it is still never a Heavy Blow, per `isHeavyBlow`).
- `damage: 35`, `speed: 20`.
- `tempo` 1/1/1 (the same as the Halberd's).
- `heavyBlow`: a low `speed` multiplier so a committed swing's contact clears it but a near-hand or slow contact doesn't. Starting guess `~0.7`. The final number comes from measuring real contact Blade Speeds (Verification).
  - `knockdownSlide`/`knockdownSlideTicks`: the Halberd's (0.9 / 24). A staff sweeps people over; it doesn't launch them.
  - `blockSlide`/`blockSlideTicks`: the Halberd's (0.3 / 6).
- `blockImpact`: about `{ dealt: 1.3, taken: 0.7 }`, a little lighter than the Halberd's.
- `sheathe`: the Halberd's back slot, offset and rotation.

### 2. Motion overrides: `data/motions/quarterstaff/` (new)
Copy the Halberd's six overrides verbatim: `blockoverhead`, `drawback`, `left`, `overhead`, `sheatheback`, `thrust`. That gives the same motions and the same stood-up-head sheathe. (Overrides are keyed by folder name, so a copy is the only way to share them today.)

### 3. Render look `staff`
- `src/tuning/weapon.ts:20`: add `'staff'` to `WEAPON_LOOKS`.
- `src/render/fighterView.ts`:
  - Build the mesh: one wooden shaft from butt to tip (`-gripLength` to `len`), slightly thicker than the polearm's (about 0.022), with small iron caps at both ends. Copy the `PolearmMeshes` construction and its materials.
  - Add `placeStaff` next to `placePolearm` (line 632).
  - Add `visible` toggling at line 270–276.
  - Add a blood/scuff mark branch in the marks loop (around line 389): a box smear round the shaft at `at`, like the flail's shaft branch.
- Check the rest of the look switches for missing cases: `src/editor/tuningPanel.ts`, `src/audio/cues.ts` (it only tests `=== 'flail'`, so nothing is needed), thumbnails and ragdoll (grep `look` in `src/render`).

### 4. Icon: `src/play/icons.ts` `WEAPONS`
Add `Quarterstaff`: a long diagonal brown pole with grey caps at both ends, in the same `svg(path…)` style as the others.

### 5. Tests and docs
- `src/tuning/weapons.test.ts:35`: add `'Quarterstaff'` to the roster list. Add a `toMatchObject` line for the Quarterstaff (look `staff`, head = length, heavyBlow speed). At line 106, the non-cutting list becomes `['Quarterstaff', 'Sledge Hammer']`.
- `src/sim/weapons.test.ts:40`: add it to `TWO_HANDED`.
- `src/sim/heavyBlow.test.ts`: add cases where a Quarterstaff Overhead, Left or Right landing at normal swing speed on the torso knocks down, and a contact below the bar (e.g. a slow or near-hand one) just Staggers.
- Run the AI golden or hash tests. If they pin the roster or its hash (`src/tuning/hash.test.ts`, `src/controllers/aiGolden.test.ts`, `src/net/*`), update the expected values only where the change comes from adding a roster entry.
- `CONTEXT.md`:
  - Heavy Blow entry (line 242): list the Quarterstaff's Heavy Blow.
  - Sheathe entry: it overrides SheatheBack like the Halberd.
  - Add a short **Quarterstaff** line if weapons are described individually.

## Verification
1. **Pick the bar.** Write a throwaway script or test in the scratchpad that runs Quarterstaff Attacks (each Direction, varied ranges) into an idle dummy and logs `bladeSpeed / speed` at each Hit. Set `heavyBlow.speed` so most full swings at normal range land above it and near-hand or late contacts land below. Thrusts might sit lower; report what they do.
2. Run `npm test` (vitest) and `npx tsc --noEmit`, all green.
3. Use the `run` skill: start the dev server, pick the Quarterstaff against an AI, and screenshot it held, swinging, sheathed on the back, and an enemy knocked down. Check the icon in the picker.
