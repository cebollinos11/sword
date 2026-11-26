# Delver Troops: Prefabs and Variants

> Status: done (2026-11-17). Agreed with the user the same day. The Delver gets its own roster, so Battles keep their four Troops. Each Floor fields a few of the roster's kinds, so the impostor bake stays small. Builds on the Delver (`docs/plans/delver.md`, Stages 3 and 4: Warbands, elites, Bosses) and the Big Battle's impostors (`docs/plans/big-battle.md`, Stage 2).

## Context
A Delver Floor used the Battles' Troops (Levy, Halberdier, Swordsman, Brute). Each tier's Boss and its elites were added on top. That is fine for a Battle, but a dungeon should be more varied, both in how the enemies fight and in how they look.

Looks cost. Every Body and Weapon pair is baked into an impostor atlas when the Crowd is first drawn:
- **Renders:** 36 frames from 5 directions, so 180 renders into two textures of 1792 × 1664 with mipmaps.
- **Memory:** about 30 MB of GPU memory per atlas.
- **Time:** about 0.8 s per look under software GL.

A Run baked 10 atlases at its start. Four of them were Team 0 looks (templar and wraith) that no Delver Soldier wears, because every Delver Soldier is on Team 1. Adding kinds the same way would make the load grow with the roster.

## Decisions (the user's answers, 2026-11-17)
- **Only what exists now**: the Weapons, Bodies, AI difficulties, Styles, Size and Relics. No new behaviours and no new art.
- **A Prefab is one Body and one Weapon**, so one atlas. A Prefab has **Variants**, which change everything that is not drawn: HP, AI difficulty, Style, Relics, Mods and the Crowd stats.
- **Size follows HP.** It is the Soldier's final HP, after its tier, its template and its Relics' `maxHp`. 20 HP or less is the smallest body, 150 or more the biggest, in a line between: height runs 0.6 to 1.3, thickness 0.9 to 1.4 (`delver.sizeHp`).
- **Tint follows skill** (the AI difficulty): grey for Beginner, red for Skilled, black for Expert (`delver.skillTints`). It is worn on the team-coloured part, by the impostor and by the promoted full model alike.
- **Mixed pool, a few per Floor.** Each Floor fields `delver.prefabsPerFloor` (4) Prefabs, all different, picked from the Run seed and the Floor. A Prefab may come back on the next Floor. A Boss Floor's Boss's Prefab comes on top.
- **Low Floors are weaker** (2026-11-17, after review): `delver.tierHp` is `[0.6, 1, 1.5]`, so tier 1's Soldiers have 60% of their Variant's HP. A Prefab may name a `minTier` (default 1): it is fielded in template rows only from that tier on. Bruiser and Uruk, the heaviest, have `minTier` 2. A Prefab's Boss Variant is its tier's Boss whatever its `minTier` (the Warden is an Uruk on tier 1).
- **Templates name skills.** A Warband template row is `{ skill, count }`, not a Troop. Each Soldier is a Variant of that skill of one of the Floor's Prefabs.
- **Chromebooks matter, phones do not.**
- **`delver.troops` is the Delver's own list.** The Bosses and the elites are in it too: a Boss is a Variant flagged `boss` that its tier names, and an elite is an ordinary Variant wearing the elite template's Relics too.
- **The starting roster is written by Claude**, with every Body and every Weapon used at least once.

## The roster (data/delver.json)
Eleven Prefabs, one per Body. Each has a Beginner, a Skilled and an Expert Variant.

| Prefab | Body | Weapon | Style | HP (B/S/E) | Notes |
|---|---|---|---|---|---|
| Sellsword | female | Arming Sword | Balanced | 40/50/60 | |
| Bruiser | brawler | Sledge Hammer | Reckless | 60/75/90 | damage ×0.6; Beginner is Dumb |
| Cutthroat | snake | Dagger | Skirmisher | 30/36/42 | damage ×0.45; Expert has Honed Daggers |
| Acolyte | monk | Quarterstaff | Defensive | 45/55/65 | Expert has Buckler Rim |
| Fencer | duelist | Longsword | Counter | 40/50/60 | **Duelist** (Boss, 250 HP, Expert) |
| Halberdier | asturian | Halberd | Balanced | 50/60/70 | engage reach 2.2 |
| Flagellant | templar | Flail | Aggressive | 50/60/70 | Expert has Berserker Mask |
| Lorekeeper | librarian | Quarterstaff | Chambermaster | 35/45/55 | |
| Squire | prince | Arming Sword | Defensive | 45/55/65 | Skilled and Expert are Hoppers; Expert has Iron Plate |
| Revenant | wraith | Longsword | Pack Hunter | 45/55/70 | **Wraith Lord** (Boss, 300 HP, Expert Aggressive, Heavy Gauntlet) |
| Uruk | uruk | Sledge Hammer | Reckless | 80/95/110 | damage ×0.6; Slow; **Warden** (Boss, 250 HP, Skilled Aggressive, not Slow) |

The Styles and Quirks (Dumb, Slow, Hopper) are the roster pass of docs/plans/enemy-behaviours.md (Stage 6, 2026-11-26); the Bosses keep their own Style and no Quirks.

Every Weapon is used: Arming Sword, Dagger, Flail, Halberd, Longsword, Quarterstaff and Sledge Hammer. A Variant's Mods default to its Prefab's, and then to the generic soldier's half damage (`battle.soldier.mods`). The Bosses wear none, as before. The old templates were mapped to skills: Levy to Beginner, Halberdier to Skilled, Swordsman and Brute to Expert.

## How it works
- **Tuning** (`src/tuning/delver.ts`):
  - `delver.troops` holds the Prefabs and their Variants. An unnamed Variant is called "<Prefab> (<skill>)".
  - New keys: `prefabsPerFloor`, `sizeHp` and `skillTints`.
  - A template row is `{ skill, count }`, and a tier's `boss` is `{ troop: <Boss Variant name>, guard }`.
  - The parser refuses two Prefabs of one look, and a Prefab that fills rows but lacks a Variant of a skill some row names. So every row can be filled whichever Prefabs a Floor draws.
- **Floor Troops** (`src/sim/delver/troops.ts`):
  - `floorTroops(delver)` lists every Variant, Prefab by Prefab. Then, for each distinct elite Relic set, it lists every non-Boss Variant again wearing that set too.
  - The list replaces `battle.troops` in a Floor's Battle Tuning, as before. A Troop carries its `prefab` and `tint`.
  - `MAX_FLOOR_TROOPS` is now 256 (the bundled data needs 102: 36 Variants, and 33 non-Boss Variants for each of 2 elite Relic sets).
  - `floorPrefabs` and `floorLooks` say which Prefabs a Floor fields and draws, and `sizeOfHp` gives a Soldier's Size.
- **Deploying** (`src/sim/delver/warbands.ts`):
  - Each Soldier's Prefab and Variant are picked by its Warband and place (`runPick` slot `q × 256 + p`), so an elite Warband of another size never moves the next Warband's picks.
  - Each Soldier's HP is its Variant's, times its template's and tier's scales, times its Relics' `maxHp` share. A Boss's HP is its Variant's own, with its Relics.
  - Its look is always 0.
- **Drawing** (`src/play/floorCrowd.ts`, `src/render/crowdView.ts`, `src/render/impostorAtlas.ts`):
  - `FloorCrowd` bakes Prefabs, not a Battle's looks, and only Team 1's.
  - The first Floor's looks bake behind the loading bar.
  - Once a Floor is shown, the next Floor's new looks bake in the background. `bakeImpostorAtlas` takes a `pace` that hands the renderer back between frames: about 4 ms of baking per frame (`PACE_MS`).
  - On the next Floor, the view is rebuilt from the atlases already baked. If one is not ready, it bakes at full speed while the last view draws what it can.
  - Atlases that neither the shown Floor nor the next one draw are freed, so at most about two Floors' looks are held (10 at most, about 300 MB at worst; usually fewer, since Floors share Prefabs).
  - `CrowdView` takes a tint per instance (`aTint`, from `TroopTuning.tint`, else the Team's colour) and hides a Soldier whose look has no atlas.
  - `drawColours` gives a promoted or traitor-held Soldier's model its Troop's tint.
- **Net:** `PROTOCOL_VERSION` 35, since a Floor's Troop index on the wire may now reach 255.

## Result
Done 2026-11-17.
- **The bake at a Run's start fell from 10 looks to 4 or 5:** the Floor's 4 Prefabs, plus the Boss's on a Boss Floor if it is not one of them. Each later Floor's new looks (0 to 5) bake in the background while the one before is played.
- **Tests:**
  - The fast suite passes.
  - New tests cover parsing the Prefabs, Variants, `sizeHp` and `skillTints`, and the counts allowed under `MAX_FLOOR_TROOPS`.
  - They cover `floorTroops`' order and elite copies, and that `floorPrefabs` is distinct, seeded and varies between Floors.
  - They cover that `floorLooks` adds the Boss, that `sizeOfHp` follows HP, and that Warbands pick by skill from the Floor's Prefabs with a Size by HP.
  - They cover that `FloorCrowd` bakes paced for the next Floor, swaps views and frees atlases, and that `floorAtlases` indexes by Prefab.
- **Not measured yet:** the bake time on a real Chromebook GPU, and how the paced background bake feels in play. The pacing budget (`PACE_MS`) is a guess to tune at the first playtest.
