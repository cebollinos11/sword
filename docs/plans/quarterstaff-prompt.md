# Quarterstaff: implementation prompt

Paste this into a new session. It implements all of `docs/plans/quarterstaff.md` in one go.

```
Implement docs/plans/quarterstaff.md. Read the whole plan first, then CONTEXT.md (Weapon, Weapon
roster, Heavy Blow, Knockdown, Chain Knockdown, Block Impact, Motion override, Tempo, Sheathe,
Dismemberment) and ADRs 0004 and 0016.

Then read the code the plan builds on: src/tuning/weapon.ts (WEAPON_LOOKS, isHeavyBlow,
parseWeapon) and src/tuning/index.ts (roster and override loading), data/weapons/halberd.json and
sledge-hammer.json, data/motions/halberd/, src/sim/combat.ts (resolveContact),
src/sim/heavyBlow.test.ts, src/render/fighterView.ts (the polearm and hammer looks, their blood
marks), src/play/icons.ts, src/editor/tuningPanel.ts, src/tuning/weapons.test.ts and
src/sim/weapons.test.ts.

1. The decisions under Context are fixed. The knockdown is the existing Heavy Blow with a low
   heavyBlow.speed bar: no random roll and no new Simulation code. Head = length (the whole
   staff), damage about 35, cuts false, the Halberd's Tempo and Motions (copied overrides). It is
   added only to the Weapon roster: no Battle Troop and no Run Encounter or loot names it.
2. Nothing may change for the other Weapons: their files and Motions stay as they are, and every
   existing test passes. Update an expected value only where adding a roster entry changes it
   (the roster list, the non-cutting list, a roster hash). If the AI golden test or another test
   changes for any other reason, stop and tell me why.
3. Pick heavyBlow.speed by measurement, as in Verification step 1. Report the Blade Speed
   ratios you saw per Direction and the value you chose.
4. Run npx tsc --noEmit and npm test until both are green, then use the run skill to play it
   against an AI. Screenshot it held, swinging, sheathed on the back, an enemy knocked down, and
   its icon in the Weapon picker.
5. Update CONTEXT.md as the plan says. Add a Results section to the plan noting anything that
   turned out differently from it.
6. Commit and push to the session's branch. Do not open a PR unless I ask.
```
