# Dagger: implementation prompt

Paste this into a new session. It implements all of `docs/plans/dagger.md` in one go.

```
Implement docs/plans/dagger.md. Read the whole plan first, then CONTEXT.md (Weapon, Weapon
roster, Tempo, Block, Block Impact, Knockdown, Slide, Heavy Blow, Throwing Dagger, Sheathe,
Dismemberment) and ADRs 0002, 0016 and 0017. Also read docs/plans/quarterstaff.md and its
Results: the last Weapon added, and the pattern to follow.

Then read the code the plan builds on: src/tuning/weapon.ts (WEAPON_LOOKS, WeaponBlockImpact,
parseWeapon and its serializer), src/tuning/index.ts (roster loading), data/weapons/arming-sword.json,
data/dungeon.json (leftOutWeapons), src/sim/actions/block.ts (startBlockImpact), src/sim/combat.ts
(resolveContact, push, pushDown, the Throwing Dagger Block), src/sim/heavyBlow.test.ts,
src/render/fighterView.ts (the sword look, placeSword, the blood marks), src/audio/cues.ts,
src/play/icons.ts, src/editor/tuningPanel.ts, src/tuning/weapons.test.ts, src/sim/weapons.test.ts,
src/sim/runWeapons.test.ts and src/tuning/dungeon.test.ts.

1. The decisions under Context are fixed. The Weapon is named "Dagger" (a different thing from the
   Throwing Dagger, so never confuse tuning.dagger with it). It is one-handed, about 0.45 m long,
   with damage 30, Tempo 0.75 on all three phases, a curved-blade 'dagger' look and the default
   Motions. It is left out of Runs and in no Battle Troop. Its trade-off is the Block Break: a
   Blocked blow whose Block Impact strength on it reaches blockImpact.breakAt knocks its wielder
   down (no damage, and the attacker still recoils).
2. Nothing may change for the other Weapons: their files, Motions and behaviour stay as they are,
   and every existing test passes. The new blockImpact fields default to "never breaks" and are not
   written for Weapons without them. Update an expected value only where adding a roster entry or
   the leftOutWeapons entry changes it. If the AI golden test or another test changes for any
   other reason, stop and tell me why.
3. Pick speed and breakAt by measurement, as in Verification steps 1 and 2. Report the Blade
   Speeds and Block Impact strengths you saw, and the values you chose. If the Longsword is
   borderline for breakAt, ask me.
4. Run npx tsc --noEmit and npm test until both are green, then use the run skill to play it
   against an AI (including a Sledge Hammer AI). Screenshot it held, mid-swing, sheathed at the
   hip, a broken Block, and its icon in the Weapon picker. Generate
   public/thumbs/weapons/dagger.webp.
5. Update CONTEXT.md as the plan says. Add a Results section to the plan noting anything that
   turned out differently from it.
6. Commit and push to the session's branch. Do not open a PR unless I ask.
```
