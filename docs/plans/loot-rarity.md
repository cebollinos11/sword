# Loot Rarity: Rarities, Weapon Effects and the Full Roster as Loot

> Status: in progress. Scope agreed (2026-11-17), the open questions answered by the user. Stages 1 and 2 done. Tracked in #152 (Stages: #153, #154, #155, #156). Builds on the Delver's loot (`docs/plans/delver.md`, Stage 4: Warband drops, Treasure pedestals, elites' carried Relics), the Inventory and Relics (`docs/plans/dungeon.md`), the Consumables (`docs/plans/delver.md`, Stage 10) and the Delver Troops (`docs/plans/delver-troops.md`). Each Stage ends with a `### Result`, as in the other plans.

## Context
Delver loot is flat today. Every copy of an item is the same item:
- **Items are names.** An item is a name (`Dropped { kind, item }`), and an Inventory holds name lists (`Inventory.weapons`, `Inventory.relics`).
- **Relics** fold their fixed effects into the Fighter's `mods` (`foldMods`).
- **Weapons** have no effects. A Weapon is only its combat numbers.
- **Weapon loot is the roster minus `dungeon.leftOutWeapons`.** That leaves out the Flail, the Quarterstaff and the Dagger, so only 4 of the 7 Weapons ever drop. `runWeapons` is used for loot and nothing else, because the Delver's enemies now take their Weapons from their Prefabs (`docs/plans/delver-troops.md`).

We want loot worth looking at: rarer finds that are visibly and mechanically better, and every Weapon worth finding.

## Decisions (the user's answers, 2026-11-17)
- **Every Weapon is loot.** `dungeon.leftOutWeapons` is retired, so the loot pool is the whole roster. Enemies are unaffected, since their Weapons come from the Prefabs.
- **Three Rarities**, each a multiplier:

  | Rarity | Multiplier | Colour |
  |---|---|---|
  | Common | ×1 | as today |
  | Rare | ×1.5 | blue |
  | Legendary | ×2 | orange |

- **Only the bonus scales, never the downside.** A Rarity's multiplier `m` scales how far an effect moves from no change, and only when that move is good for its holder:
  - **A factor that is good above 1** (`damage`, `heavyDamage`, `daggerDamage`, `kickDamage`) becomes `1 + (f − 1) × m` when `f > 1`. Whetstone 1.1 is 1.15 Rare and 1.2 Legendary.
  - **A factor that is good below 1** (`damageTaken`, `blockImpactTaken`) becomes `1 − (1 − f) × m` when `f < 1`. Iron Plate 0.9 is 0.85 Rare and 0.8 Legendary.
  - **A share or count** (`maxHp`, `healOnClear`, `daggers`, `healOnKill`) becomes `a × m` when `a > 0`. Counts (`daggers`, `healOnKill`) round to the nearest whole number, halves up, so a Dagger Bandolier gives 2 daggers at Rare and at Legendary.
  - **A downside** (a factor on the bad side of 1, such as Glass Cannon's `damageTaken` 1.25) stays at its base value at every Rarity. A higher Rarity is always strictly better.
- **Weapons have effects** from the Relic vocabulary, scaled by Rarity the same way. They count only while that Weapon is wielded. The starting values, to be tuned later:

  | Weapon | Effects (Common) |
  |---|---|
  | Arming Sword | `blockImpactTaken` 0.85 |
  | Dagger | `daggerDamage` 1.25, `daggers` +1 |
  | Longsword | `damage` 1.1 |
  | Halberd | `heavyDamage` 1.15 |
  | Flail | `heavyDamage` 1.2 |
  | Quarterstaff | `kickDamage` 1.3 |
  | Sledge Hammer | `heavyDamage` 1.25 |

- **A Weapon's Rarity also raises its own damage**: Rare +15%, Legendary +30%. It applies to the Weapon's own Hit only. Throwing Daggers and Kicks are not affected, because they read their own Mods (`daggerDamage`, `kickDamage`), not `damage`.
- **Consumables have no Rarity.** They are always Common and keep their basic effect.
- **Rarity odds follow depth and source.** Every Rarity is a seeded pick, so every peer gets the same one:
  - **By tier** (Common / Rare / Legendary): tier 1 80/18/2, tier 2 60/32/8, tier 3 40/45/15.
  - **An elite Warband** rolls on the next tier's odds (tier 3's at most).
  - **A Boss's drops and Treasure pedestals** are at least Rare: a Common roll becomes Rare.
- **Fixed items.**
  - The starting Weapon from the Lineup, and the dev `relics`, are Common.
  - An elite's carried Relic drops at its tier's Rarity: tier 1 Common, tier 2 Rare, tier 3 Legendary. A Boss's drops one step higher, Legendary at most.
- **Copies stack.** Two copies of a Relic, at any Rarities, may be equipped together, as today.
- **Players only.** Weapon effects and the Rarity damage bonus belong to items in a Player's Inventory. Enemies fight exactly as now: their `mods` come from `troopMods`, which reads no Weapon effects.
- **Shown everywhere:**
  - names and slots coloured by Rarity, in the inventory screen, the HUD slots and the results Build;
  - effect text with the final, scaled numbers (e.g. "+20% damage");
  - a pickup glow in its Rarity's colour on the Floor;
  - the wielded Weapon of Rare or Legendary Rarity tinted (emissive) in 3D, so every peer sees it. A Common Weapon looks as it does now. Render-only.
- **Claude's call, flagged for the user:**
  - An elite *wears* its Relics at Common, so Warband strength is unchanged. Only its *drop* takes the tier's Rarity.
  - There is no loot announcement banner, because it was not picked.

## How it works

**1. Rarity and the Item** (`src/tuning/rarity.ts`, `src/sim/inventory.ts`):
- `type Rarity = 'Common' | 'Rare' | 'Legendary'`, with `RARITIES` in that order.
- Tuning Data `dungeon.loot.rarity`:
  ```json
  { "multipliers": { "Common": 1, "Rare": 1.5, "Legendary": 2 },
    "weaponDamage": { "Common": 1, "Rare": 1.15, "Legendary": 1.3 },
    "odds": [[80, 18, 2], [60, 32, 8], [40, 45, 15]],
    "eliteTierStep": 1, "bossMin": "Rare", "pedestalMin": "Rare",
    "carried": ["Common", "Rare", "Legendary"], "bossCarriedStep": 1 }
  ```
  The parser refuses the following:
  - an `odds` row count other than `delver.tiers`;
  - a row of negative weights, or one that sums to 0;
  - a multiplier below 1, or multipliers that fall as the Rarity rises;
  - a `carried` length other than `delver.tiers`.
- **`Item { name: string; rarity: Rarity }`** replaces the bare name:
  - in `Inventory.weapons` and `Inventory.relics`;
  - in `Dropped` (`{ kind, item: Item }`);
  - and so in `DroppedItem`, pickups and the `ItemDropped`, `ItemTaken` and `ItemUsed` events.
- A Consumable's Item is always `Common`. `addItem` and the parse refuse any other Rarity on one.
- `startingInventory(weapon)` holds `{ name: weapon, rarity: 'Common' }`. `withStartingRelics` gives Common.

**2. Scaled effects** (`src/sim/mods.ts`):
- `scaleEffects(effects, m): RelicEffects` applies the rules under Decisions.
  - Each effect needs its good direction: `RELIC_GOOD_LOW = ['damageTaken', 'blockImpactTaken']`, and every other multiplier is good above 1.
  - Counts round with `Math.round`. It is pure, so every peer gets the same bits.
- `inventoryMods(tuning, inv)` folds, in this fixed order:
  1. the equipped Relics, each scaled by its Rarity;
  2. the wielded Weapon's `loot.effects`, scaled by its Rarity;
  3. the wielded Weapon's Rarity damage, as `{ damage: weaponDamage[rarity] }`.
- Swapping Weapons recomputes Mods through `holdInventory`, the existing seam. So HP is capped and daggers are moved, as for a Relic equip.
- `troopMods` is untouched. Enemies never read Weapon effects.

**3. Weapon effects in Tuning Data** (`data/weapons/*.json`, `src/tuning/weapons.ts`):
- Each Weapon file gains `"loot": { "effects": { … } }` from the Relic vocabulary, parsed by the Relic effect parser (whole counts and all).
- It is absent or `{}` for no effects.

**4. Rolling a Rarity** (`src/sim/pickups.ts`, `src/sim/delverLoot.ts`):
- `pickItemAt` gains a `source: { tier, rank: 'Fight' | 'Elite' | 'Boss' | 'Pedestal' }`.
- After the kind and the name, it draws the Rarity from `runPick(seed, floor, slot, SALT.rarity, total)`:
  - It reads the `odds` row for the tier, or tier + `eliteTierStep` for an elite, capped at the last row.
  - `bossMin` and `pedestalMin` then raise the result.
- A Consumable skips the draw. Its Rarity is Common, but the draw's slot is still consumed, so the kinds never shift each other's picks.
- The carried Relic of an elite or Boss (`carriedRelics`) takes `carried[tier − 1]`, raised `bossCarriedStep` for a Boss and capped at Legendary.
- The `avoid` list (no repeats within one drop) still compares names only. Two Whetstones of different Rarities in one drop count as a repeat.
- The weapon pool is `Object.keys(tuning.weapons)`. `runWeapons` and `dungeon.leftOutWeapons` go, and the parser refuses the old key with a pointer to this plan.

**5. Versions**:
- `PROTOCOL_VERSION` +1: the state checksum now hashes Rarities, and the events carry Items.
- `DELVER_VERSION` +1: the loot picks change.

**6. Rendering and UI** (`src/play/inventoryView.ts`, `src/play/inventoryScreen.ts`, `src/play/loot.ts`, `src/render/pickupView.ts`, `src/render/pickupMarks.ts`, the Fighter's Weapon renderer):
- **A Rarity colour token** per Rarity, in `src/play/styles.ts` and the render palette: Common none, Rare blue, Legendary orange.
- **Inventory screen and HUD slots**: the name and slot border in the Rarity colour, and the Rarity named after the name ("Whetstone · Rare").
  - Effect lines show the scaled numbers (`scaleEffects` then the existing wording), and a downside line stays as it is.
  - A wielded Weapon lists its effects and its "+15% damage".
- **Results Build**: names in the Rarity colour.
- **Pickups on the Floor**: a point light and emissive ring in the Rarity colour under Rare and Legendary pickups. Common looks as now.
- **The wielded Weapon in 3D**: for a Rare or Legendary Weapon in a Fighter's inventory, the Head (and the blade of a bladed Weapon) gets an emissive tint in the Rarity colour.
  - It is drawn for every Fighter whose `inventory` says so, so all peers see it: inventories are in the simulated state.
  - The impostors never need it, because Players' Fighters are always full models.
  - A sheathed Weapon keeps its tint.

## Stages
- [x] Stage 1: Rarity in the Item, scaled Relic effects, the full roster as loot
- [x] Stage 2: Weapon effects and the Rarity damage bonus
- [ ] Stage 3: Rarity rolls by depth and source
- [ ] Stage 4: Rarity shown: inventory, HUD, results, pickups, the wielded Weapon

### Stage 1: Rarity in the Item, scaled Relic effects, the full roster as loot
- `Rarity`, `dungeon.loot.rarity` (multipliers only is fine for now), and `Item` through the Inventory, `Dropped`, pickups and events.
- `scaleEffects` and Rarity-scaled `inventoryMods` for Relics.
- `leftOutWeapons` and `runWeapons` retired.
- Every drop is still Common, so a Run plays as before except for the Weapon pool.
- The protocol and Delver version bumps.
- **Done**:
  - unit tests of `scaleEffects` for every effect kind, downsides and rounding;
  - an Inventory test that two Whetstones at different Rarities stack;
  - a loot test that all 7 Weapons can drop;
  - the existing Delver suites green.

#### Design
**Types and signatures.**
- `src/tuning/rarity.ts` (new): `export const RARITIES = ['Common', 'Rare', 'Legendary'] as const; export type Rarity = (typeof RARITIES)[number];` and `export interface RarityTuning { readonly multipliers: Readonly<Record<Rarity, number>> }` with `parseRarity(raw: unknown, where: string): RarityTuning`. It refuses a missing Rarity, a non-finite number, a multiplier below 1, or one below the Rarity before it ("multipliers must not fall as the Rarity rises"). Stage 3 adds the other keys. Re-exported from `src/tuning/index.ts`.
- `DungeonLoot.rarity: RarityTuning`, parsed from `dungeon.loot.rarity` (required). `data/dungeon.json` gains `"rarity": { "multipliers": { "Common": 1, "Rare": 1.5, "Legendary": 2 } }` inside `loot`.
- `DungeonTuning.leftOutWeapons` goes. `parseDungeon(raw)` loses its `weapons` argument (it was only for `leftOutWeapons`; Stage 3 gives it the tier count). A `leftOutWeapons` key is refused: ``dungeon.leftOutWeapons is retired: every Weapon is loot (docs/plans/loot-rarity.md)``. `runWeapons` goes from `src/tuning/index.ts`; `pickItemAt`'s Weapon pool is `Object.keys(tuning.weapons)` (file order).
- `src/tuning/relics.ts`: `RELIC_GOOD_LOW = ['damageTaken', 'blockImpactTaken'] as const` (every other multiplier is good above 1) and `RELIC_COUNTS = ['daggers', 'healOnKill'] as const` (the other additions are shares). The Relic parser now requires `healOnKill` to be a whole number, at least 1, like `daggers` (the data's is 10), so a count is whole before and after scaling.
- `src/sim/mods.ts`: `scaleEffects(effects: RelicEffects, m: number): RelicEffects`, pure, a new object with the same keys. For each key: good-above-1 factor `f > 1` → `1 + (f − 1) × m`; good-below-1 factor `f < 1` → `1 − (1 − f) × m`; share `a > 0` → `a × m`; count `a > 0` → `Math.round(a × m)`; anything else (a downside, or 1) stays. At `m = 1` every value comes back bit-for-bit (`1 + (f − 1) × 1` can differ from `f` in the last bit, so `m === 1` returns a copy of the input), so a Common item folds exactly as today and no Delver golden moves for it.
- Cross-check in `loadTuningData` (`src/tuning/index.ts`, where Relics and the Dungeon are both known): a good-below-1 factor whose top-Rarity scale `1 − (1 − f) × multipliers.Legendary` is at most 0 is refused (no item may make its holder take no damage). The data's lowest is Buckler Rim's 0.7 → 0.4.
- `src/sim/inventory.ts`:
  - `export interface Item { readonly name: string; readonly rarity: Rarity }` and `export const commonItem = (name: string): Item => ({ name, rarity: 'Common' })`.
  - `Inventory.weapons: readonly Item[]`, `Inventory.relics: readonly Item[]`.
  - `startingInventory(weapon: string)` holds `commonItem(weapon)`; `withStartingRelics(inv, relics: readonly string[], tuning)` keeps taking names (the dev `relics` option, `MatchOptions.relics`, stays `readonly string[]`) and holds them as Common Items.
  - `wieldedWeapon(inv): string` still returns the name (it feeds `FighterState.weapon`).
  - `inventoryMods(tuning: Pick<TuningData, 'relics' | 'dungeon'>, inv)` folds each equipped Relic as `{ effects: scaleEffects(relicOf(tuning, item.name).effects, tuning.dungeon.loot.rarity.multipliers[item.rarity]) }`, in `equipped` order.
  - `relicMods(tuning, names: readonly string[])` stays on names, unscaled: it is the enemies' (`delver/warbands.ts`), who wear their Relics at Common. `troopMods` is not touched.
  - `Dropped { kind; item: Item }`. `dropItem` and `spendConsumable` return `item: Item`. `equipItem`'s `consumable` callback still takes a name (called with `item.name`). `isConsumable`, `consumableOf`, `slotKind` stay on names.
  - `addItem` also returns null for a Consumable whose Item is not Common.
- `src/sim/pickups.ts`: `Pickup`, `Taken`, `DroppedItem` extend `Dropped`, so they carry `item: Item`. `pickItemAt` returns `{ kind, item: commonItem(name) }`; `avoid` compares `a.item.name` only. The Rarity draw is Stage 3's: no `runPick` is added here, so every kind and name pick stays where it was except the Weapon names, whose pool grew.
- `src/sim/delverLoot.ts`: a carried Relic is `{ kind: 'relic', item: commonItem(name) }`.
- `src/sim/match.ts` events: `ItemDroppedEvent` and `ItemTakenEvent` carry `item: Item` through `Dropped`; `ItemUsedEvent.item: Item`.
- `src/play/runBuilds.ts`: `RunBuild.weapon: Item`, `equipped` and `carried: readonly Item[]` (Stage 4 colours them); `hud.ts` reads `.name`.
- `src/play/inventoryView.ts`, `src/render/pickupView.ts`, `src/render/pickupMarks.ts`, `src/controllers/delverPilot.ts`: read `.name` where they read a name. No display change in this Stage.
- **The state hash** (`hashState`) is `hashValue` of the whole state, so Items (and their Rarities) are hashed with no change to `hash.ts`.
- **Net** (`src/net/messages.ts`): `isItem(v) = isObject(v) && isString(v.name) && RARITIES.includes(v.rarity)`. `isInventory` checks `weapons` and `relics` as arrays of `isItem`. `isPickup` checks `isItem(v.item)`, and a `consumable` pickup must be Common. `PROTOCOL_VERSION` 35 → 36. Events are not sent, so no event validator changes.
- `DELVER_VERSION` 9 → 10 (`src/sim/delver/version.ts`), its comment noting a change to the loot picks bumps it too.

**Files the task may touch**: `src/tuning/rarity.ts` (new), `src/tuning/relics.ts`, `src/tuning/dungeon.ts`, `src/tuning/index.ts`, `data/dungeon.json`, `src/sim/mods.ts`, `src/sim/inventory.ts`, `src/sim/pickups.ts`, `src/sim/delverLoot.ts`, `src/sim/delverRun.ts`, `src/sim/match.ts`, `src/sim/index.ts`, `src/sim/delver/version.ts`, `src/net/messages.ts`, `src/play/runBuilds.ts`, `src/play/hud.ts`, `src/play/inventoryView.ts`, `src/render/pickupView.ts`, `src/render/pickupMarks.ts`, `src/controllers/delverPilot.ts`, `src/editor/*` only if it lists `leftOutWeapons`, and every `*.test.ts` that builds an Inventory, a Pickup or a `Dropped` by name.

**Tests expected to change**:
- `src/sim/runWeapons.test.ts` → replaced by `src/sim/weaponLoot.test.ts`: all 7 Weapons drop (the plan reverses the left-out list).
- `src/tuning/dungeon.test.ts`: the `leftOutWeapons` case becomes "refused, with a pointer to the plan"; new `rarity.multipliers` cases.
- Every test that writes an Inventory, a Pickup, a `Dropped` or an `ItemTaken`/`ItemDropped`/`ItemUsed` with a bare name writes an Item instead (`delverRun`, `delverLoot`, `inventoryView`, `runBuilds`, `pickupView`, `pickupMarks`, `announcer`, `delverPilot`, `messages`/`delverMessages`, `consumables`, `hash`, `session`, `warbandSoak`). Only the shape changes, not what is asserted.
- A golden of loot picks or of a Run's hash moves only where a Weapon drop now names one of the three Weapons added to the pool, or where the state now holds Items; the Result names each.
- `src/tuning/relics.test.ts`: `healOnKill` must be whole.

**New tests**:
- `src/sim/mods.test.ts` `scaleEffects`: each of the 10 effects at ×1.5 and ×2 (Whetstone 1.1 → 1.15 / 1.2; Iron Plate 0.9 → 0.85 / 0.8; Vital Charm 0.2 → 0.3 / 0.4; Bandolier 1 → 2 / 2; Bloodthirst 10 → 15 / 20), Glass Cannon's `damageTaken` 1.25 kept while its `damage` scales, a factor of exactly 1 kept, `m = 1` the identity bit-for-bit, rounding of a half up (1 × 1.5 → 2, 3 × 1.5 → 5), and the input untouched.
- `src/sim/inventory.test.ts` (new): two Whetstones, one Common and one Rare, both equipped, fold to `damage` 1.1 × 1.15; `inventoryMods` of Commons equals the old `relicMods`; `addItem` refuses a Rare Consumable; `dropItem` hands back the Item with its Rarity.
- `src/sim/weaponLoot.test.ts`: over a few seeds, Floors and slots with Weapon-only weights, the drops are exactly the 7 roster Weapons, all Common.
- `src/tuning/dungeon.test.ts`: `rarity.multipliers` parsed; refused when missing a Rarity, below 1 or falling; `leftOutWeapons` refused.
- `src/tuning/tuning.test.ts` (or `relics.test.ts`): the good-low cross-check refuses a 0.5 `damageTaken` at ×2.
- `src/net/messages.test.ts` (or `delverMessages.test.ts`): a snapshot with Items round-trips; an Inventory item of an unknown Rarity, a bare-name item and a Rare Consumable pickup are refused.

**One task** (the Item type ripples through every file at once, so a split could not typecheck on its own).

### Result
- **Built**:
  - `Rarity` and `RARITIES` (`src/tuning/rarity.ts`), and `dungeon.loot.rarity.multipliers` (1 / 1.5 / 2), parsed and refused as the Design says.
  - `Item { name, rarity }` and `commonItem` (`src/sim/inventory.ts`), carried by the Inventory, `Dropped`, pickups, `Taken`, `DroppedItem`, the three item events and the results `RunBuild`.
  - `scaleEffects` (`src/sim/mods.ts`), with `RELIC_GOOD_LOW` and `RELIC_COUNTS` (`src/tuning/relics.ts`).
  - `inventoryMods` scales each equipped Relic by its Rarity. `relicMods` (enemies) stays unscaled.
  - `addItem` and the net validator refuse a Consumable that is not Common.
  - `runWeapons` and `dungeon.leftOutWeapons` are gone; the parser refuses the old key with a pointer here.
  - `PROTOCOL_VERSION` 36, `DELVER_VERSION` 10.
- **Decisions the plan did not settle**:
  - `healOnKill` must now be a whole number in the Relic parser, as `daggers` is, so both counts stay whole before and after scaling.
  - `scaleEffects` returns a copy of its input at ×1, so a Common item's bits are exactly today's (no golden moved).
  - A Legendary scale may never take a good-below-1 factor to 0 or below. `parseTuningData` refuses it, and so `loadTuningData` does too.
  - The dev `relics` option stays a list of names, held as Common Items.
  - `parseDungeon` lost its Weapon-roster argument, which only `leftOutWeapons` used.
- **Tests**:
  - `npm test`: 3053 passed, 3 skipped (3030 before).
  - Slow suites green: `delverRun`, `delverCoop`, `delverFour` and `warbandSoak`.
  - `npm run typecheck` and `npm run build` are clean.
- **New tests**:
  - `scaleEffects` in `mods.test.ts`, covering every effect at ×1.5 and ×2, Glass Cannon's downside, ×1 bit-for-bit, and rounding;
  - `src/sim/inventory.test.ts`, with Common + Rare Whetstones stacking to 1.1 × 1.15, a Rare Vital Charm's max HP, a Rare Consumable refused and `dropItem` keeping the Rarity;
  - `src/sim/weaponLoot.test.ts`: all 7 Weapons drop;
  - Rarity parsing and the retired key in `dungeon.test.ts`;
  - the cross-check in `tuning.test.ts`;
  - Item validation in `messages.test.ts` and `delverMessages.test.ts`.
- **Tests changed**:
  - `src/sim/runWeapons.test.ts` was replaced by `weaponLoot.test.ts`, because the plan reverses the left-out list.
  - `dungeon.test.ts`'s `leftOutWeapons` case now checks the refusal.
  - `relics.test.ts` refuses a fractional `healOnKill`.
  - The protocol number moved to 36 in `messages.test.ts` and `delverMessages.test.ts`.
  - Every other change is shape only (bare names → Items), in `delverPilot`, `announcer`, `inventoryView`, `runBuilds`, `pickupView`, `delverRun`, `delverLoot`, `devMode` and `warbandSoak`.
  - No golden value (loot pick or Run hash) moved.

### Stage 2: Weapon effects and the Rarity damage bonus
- `loot.effects` in the Weapon files (the table above) and parsed.
- `inventoryMods` folds the wielded Weapon's scaled effects and `weaponDamage`.
- **Done**:
  - tests that swapping Weapons changes `mods` (Dagger: +1 dagger in hand, gone on a swap);
  - tests that a Rare Longsword's Hit is 1.1 scaled × 1.15;
  - tests that an enemy with the same Weapon has `mods` unchanged;
  - a rollback test of an equip mid-Floor still in step.

#### Design
**Types and signatures.**
- `src/tuning/relics.ts`: the effect loop of `parseRelics` moves into `export function parseRelicEffects(raw: unknown, where: string): RelicEffects` (the same keys, the same rules, whole counts and all; an empty record is allowed). `parseRelics` calls it and keeps its own "at least one effect" rule.
- `src/tuning/weapon.ts`: `export interface WeaponLoot { readonly effects: RelicEffects }` and `WeaponTuning.loot?: WeaponLoot`, absent when the file has no `loot` or its `effects` is `{}` (so `parseWeapon` accepts its own output, and `serializeWeapon` writes `loot` last and only when it has an effect, so a file without one keeps its bytes). `loot.effects` is parsed with `parseRelicEffects(…, 'weapons/<name>.loot.effects')`; an unknown key in `loot` is refused.
- `data/weapons/*.json`: the plan's table, each as `"loot": { "effects": { … } }` at the end of the file (where `serializeWeapon` puts it): Arming Sword `blockImpactTaken` 0.85; Dagger `daggerDamage` 1.25, `daggers` 1; Longsword `damage` 1.1; Halberd `heavyDamage` 1.15; Flail `heavyDamage` 1.2; Quarterstaff `kickDamage` 1.3; Sledge Hammer `heavyDamage` 1.25.
- `src/tuning/rarity.ts`: `RarityTuning.weaponDamage: Readonly<Record<Rarity, number>>`, parsed by the same rule as `multipliers` (every Rarity, at least 1, never falling). `data/dungeon.json`: `"weaponDamage": { "Common": 1, "Rare": 1.15, "Legendary": 1.3 }`.
- The good-below-1 cross-check of Stage 1 (`loadTuningData`) also covers each Weapon's `loot.effects` (the Arming Sword's 0.85 → 0.7 at ×2).
- `src/sim/inventory.ts`: `inventoryMods(tuning: Pick<TuningData, 'relics' | 'dungeon' | 'weapons'>, inv)` folds, with one `foldMods` call, in this fixed order:
  1. the equipped Relics, in `equipped` order, each `scaleEffects(relic.effects, multipliers[rarity])`;
  2. the wielded Weapon's `scaleEffects(weapon.loot?.effects ?? {}, multipliers[rarity])`;
  3. `{ damage: weaponDamage[rarity] }` (×1 for a Common Weapon, so its bits are today's).
  The order is fixed so every peer multiplies in one order (floating-point products are not bit-for-bit commutative). The wielded Weapon is `inv.weapons[inv.weapon]`, looked up with `weaponByName`.
- `holdInventory` is the one seam: an equip of another Weapon (`useInventory`), a drop, a use and a Floor's start all go through it, so Mods, max HP (capped) and Throwing Daggers (moved by the change in `mods.daggers`) follow the Weapon in hand. No other code changes for it.
- **Enemies never see Weapon effects.** Only a Fighter with an `inventory` (a Player's) gets `inventoryMods`. An enemy's Mods come from `troopMods` / `relicMods` of its Troop's Relic names (`delver/warbands.ts`, `bubble.ts`), which read no Weapon. Neither is touched.
- The Weapon's Hit reads `modsOf(attacker).damage` (`combat.ts`), so the Rarity damage reaches its own Hit only; a Throwing Dagger reads `daggerDamage` and a Kick `kickDamage`, which `weaponDamage` never touches.
- No version bump: the Weapon files and `dungeon.json` are Tuning Data, which the peers' Tuning Data hash already compares.

**Files the task may touch**: `src/tuning/relics.ts`, `src/tuning/weapon.ts`, `src/tuning/rarity.ts`, `src/tuning/index.ts`, `data/weapons/*.json`, `data/dungeon.json`, `src/sim/inventory.ts`, and tests: `src/tuning/weapons.test.ts`, `src/tuning/relics.test.ts`, `src/tuning/dungeon.test.ts`, `src/tuning/tuning.test.ts`, `src/sim/inventory.test.ts`, `src/sim/modsEffects.test.ts`, `src/sim/delverRun.test.ts`, and any test whose expected numbers move because a Player's Common Weapon now has effects.

**Tests expected to change**: a test that pins a Player's Mods, max HP, dagger count or Block Impact in a Run with a Common Weapon in hand (an Arming Sword Player now takes 0.85 Block Impact; a Dagger Player holds one more Throwing Dagger), and a Run hash or golden that moves for the same reason. Each is named in the Result. Tests outside Runs (no inventory) never move.

**New tests**:
- `src/tuning/weapons.test.ts`: every roster Weapon has the table's effects; `loot` round-trips through `serializeWeapon`; a bad effect (`daggers` 1.5, an unknown key) is refused; `loot: {}` parses to no `loot`.
- `src/tuning/dungeon.test.ts`: `weaponDamage` parsed and refused like `multipliers`.
- `src/sim/inventory.test.ts`: a Player wielding a Dagger has `mods.daggers` 1, `daggerDamage` 1.25 and one more Throwing Dagger; equipping the Arming Sword (through `useInventory`) takes both away and gives `blockImpactTaken` 0.85; a Rare Longsword gives `mods.damage` ≈ (1 + 0.1 × 1.5) × 1.15 = 1.3225, a Legendary one ≈ 1.2 × 1.3; a Rare Dagger's `daggerDamage` is 1.375 with no ×1.15 in it.
- `src/sim/modsEffects.test.ts` (it has Hit helpers): a Hit by a Player holding a Rare Longsword deals the unmodded Hit × 1.3225.
- An enemy test (`src/sim/delverRun.test.ts` or a Delver Warband test): on a Floor whose Prefabs are changed to wield the Dagger, every enemy Fighter's `mods` equals what it had with its Prefab's own Weapon (no `daggers` +1).
- A Rollback test (`src/sim/delverRun.test.ts`, beside "deterministic, and Rollback across a Floor change"): a Run where a Player equips another Weapon mid-Floor, replayed from a snapshot taken before the equip, ends with the same `hashState` as the straight run.

**One task.**

### Result
- **Built**:
  - `parseRelicEffects`, which the Relic parser and the Weapon parser now share.
  - `WeaponTuning.loot` and its serializer support, with the plan's table in the seven Weapon files.
  - `dungeon.loot.rarity.weaponDamage` (1 / 1.15 / 1.3).
  - `inventoryMods` folds in the fixed order: Relics, then the wielded Weapon's scaled effects, then its `weaponDamage`.
  - The good-below-1 cross-check now covers the Weapons' effects.
  - Nothing outside `inventoryMods` changed: `holdInventory` already recomputes Mods on every swap.
- **Decisions the plan did not settle**:
  - A `loot` without `effects` is accepted as empty.
  - `multipliers` and `weaponDamage` share one parser rule (`risingTable`).
- **Tests**:
  - `npm test`: 3067 passed, 3 skipped.
  - Delver slow suites: 22/22 green.
  - `npm run typecheck` and `npm run build` are clean.
- **New tests**:
  - the roster's effects, the `loot` round trip and its refusals (`weapons.test.ts`);
  - `parseRelicEffects`;
  - `weaponDamage` parsing;
  - `inventory.test.ts`:
    - the Dagger gives +1 Throwing Dagger and ×1.25, and both go when the Player equips the Arming Sword, which brings `blockImpactTaken` 0.85;
    - a Rare Longsword gives 1.3225 and a Legendary one 1.2 × 1.3;
    - a Rare Dagger gives `daggerDamage` 1.375 and `damage` 1.15 only;
    - the fold order;
  - a Hit by a Rare Longsword holder in `modsEffects.test.ts`, at the unmodded Hit × 1.3225;
  - in `delverRun.test.ts`:
    - enemies on a Floor whose Prefabs all wield the Dagger have the same Mods as with their own Weapons, and no Throwing Dagger from it;
    - a Weapon equipped mid-Floor, replayed from snapshots at Ticks 0, 9 and 10, ends with the same hash.
- **Tests changed**:
  - `inventory.test.ts`'s "all-Common equals `relicMods`" now expects the Arming Sword's `blockImpactTaken` 0.85 on top. A Common Weapon now has effects, as the plan intends.
  - The expected `rarity` objects in `dungeon.test.ts` and `tuning.test.ts` gain `weaponDamage`.
  - No Run hash or golden needed a change.

### Stage 3: Rarity rolls by depth and source
- The full `dungeon.loot.rarity`, and `pickItemAt` drawing a Rarity by tier and rank.
- The Rarity of the carried Relic.
- **Done**:
  - a deterministic test per Player of drops at every rank and tier;
  - a statistical test over a few thousand seeds that each tier's split lands within a few points of its odds;
  - tests that pedestals and Boss drops are never Common, that Consumables are always Common, and that carried Relics follow the tier.

#### Design
**Types and signatures.**
- `src/tuning/rarity.ts`: `RarityTuning` gains the plan's other keys:
  ```ts
  readonly odds: readonly (readonly [number, number, number])[]; // per tier, weights of Common, Rare, Legendary
  readonly eliteTierStep: number;        // whole, ≥ 0
  readonly bossMin: Rarity;
  readonly pedestalMin: Rarity;
  readonly carried: readonly Rarity[];   // per tier
  readonly bossCarriedStep: number;      // whole, ≥ 0
  ```
  `parseRarity` refuses an odds row that is not three whole numbers ≥ 0, or that sums to 0 (whole, because `runPick` draws from a whole count), an unknown Rarity name, and a step that is not a whole number ≥ 0.
- **The tier-count checks** (an `odds` row count or a `carried` length other than `delver.tiers`) go in `parseTuningData`, beside the Stage 1 cross-check, because the Delver is parsed after the Dungeon there. `parseDungeon` keeps no argument (Stage 1's Design said Stage 3 would hand it the tier count; the cross-check is simpler and keeps the Dungeon parser standalone).
- Pure helpers in `src/tuning/rarity.ts`: `raiseRarity(r: Rarity, steps: number): Rarity` (capped at Legendary), `atLeast(r: Rarity, min: Rarity): Rarity`, and `carriedRarity(rarity: RarityTuning, tier: number, boss: boolean): Rarity` = `raiseRarity(carried[tier − 1], boss ? bossCarriedStep : 0)`.
- `data/dungeon.json` `loot.rarity`: the plan's block (`odds` [[80,18,2],[60,32,8],[40,45,15]], `eliteTierStep` 1, `bossMin` and `pedestalMin` "Rare", `carried` ["Common","Rare","Legendary"], `bossCarriedStep` 1).
- `src/sim/pickups.ts`:
  - `export interface LootSource { readonly tier: number; readonly rank: 'Fight' | 'Elite' | 'Boss' | 'Pedestal' }`.
  - `export function rollRarity(rarity: RarityTuning, seed: number, floor: number, slot: number, source: LootSource): Rarity`:
    1. take row `odds[min(odds.length − 1, tier − 1 + (rank === 'Elite' ? eliteTierStep : 0))]`;
    2. draw `u = runPick(seed, floor, slot, SALT.rarity, total)` and walk the row: Common while `u < w0`, Rare while `u < w0 + w1`, else Legendary;
    3. raise to `bossMin` for a Boss or `pedestalMin` for a Pedestal (`atLeast`).
  - `SALT.rarity = 73`, after every small salt the Simulation uses: the Floor plan's run to 72, the Warbands' to 29, the Prefabs' 40 and the loot's 50 to 53. The traitors' `0x7a17 + n` lie far above. Every existing pick keeps its (slot, salt), so no kind, name, Warband or Floor pick moves. Only the new Rarity is drawn.
  - `pickItemAt(tuning, seed, floor, slot, avoid, source: LootSource)`: the kind and name as today; then the Item's Rarity is `rollRarity(…)` for a Weapon or a Relic and `'Common'` for a Consumable.
    - A Consumable makes no draw at all. `runPick` is a pure hash of its arguments, not a stream, so a skipped draw cannot shift any other pick. That is what the plan's "the draw's slot is still consumed" asks for, with no dead call.
- `src/sim/delverLoot.ts`:
  - `warbandLoot` passes `{ tier: tierOf(tuning.delver, floor), rank }`, with PLAIN → `'Fight'`, ELITE → `'Elite'`, BOSS → `'Boss'`.
  - Its carried Relic is `{ name, rarity: carriedRarity(tuning.dungeon.loot.rarity, tier, rank === BOSS) }`.
  - `treasurePickups` passes `{ tier, rank: 'Pedestal' }`.
- Elites' and Bosses' *worn* Relics stay unscaled (`relicMods` of names, Stage 1), so Warband strength is unchanged.
- `DELVER_VERSION` 10 → 11: the loot picks change again (its comment says a loot change bumps it). No `PROTOCOL_VERSION` change: no message shape changes.

**Files the task may touch**: `src/tuning/rarity.ts`, `src/tuning/index.ts`, `data/dungeon.json`, `src/sim/pickups.ts`, `src/sim/delverLoot.ts`, `src/sim/delver/version.ts`, `src/sim/index.ts` (exports), and tests: `src/tuning/dungeon.test.ts`, `src/tuning/tuning.test.ts`, `src/sim/delverLoot.test.ts`, `src/sim/weaponLoot.test.ts`, a new `src/sim/rarityRolls.test.ts`, and any test that pinned a drop as Common.

**Tests expected to change**:
- `weaponLoot.test.ts`: its "each Common" check becomes "each a Rarity" (drops are now rolled), and it passes a source.
- `delverLoot.test.ts`'s carried-Relic expectations gain the tier's Rarity: tier 1 elite Common, the tier 3 Boss Legendary.
- Any golden or soak that compares whole Items.

**New tests** (`src/sim/rarityRolls.test.ts`):
- Deterministic, per Player:
  - for Players 0 to 3, every rank (Fight, Elite, Boss, Pedestal) and every tier, `pickItemAt` gives the same Item twice;
  - a pinned table of the Rarities for one seed, floor and slot set, so a change to the draw shows up;
  - `warbandDrops` and `treasurePickups` are equal across two calls.
- Statistical: over 6000 (seed, slot) pairs per tier at rank Fight, the share of each Rarity is within 3 points of its odds row. An Elite's split on tier t matches tier t + 1's odds, and tier 3's at most.
- Over a few thousand slots:
  - Pedestal and Boss rolls are never Common;
  - every Consumable drop is Common;
  - Weapon and Relic drops include all three Rarities.
- `carriedRarity`: tiers 1, 2, 3 give Common, Rare, Legendary; with `boss` they give Rare, Legendary, Legendary. On real Floors, `warbandLoot`'s first Item for an elite and for a Boss has the tier's Rarity.
- `src/tuning/dungeon.test.ts`: the new keys parsed, and each refusal (a negative weight, a zero row, a fractional weight, an unknown Rarity, a fractional step).
- `src/tuning/tuning.test.ts`: an `odds` or `carried` length other than `delver.tiers` is refused.

**One task.**

### Stage 4: Rarity shown
- The colour tokens, the inventory screen and HUD slots, the results Build, the pickup glow and the wielded Weapon's tint.
- **Done**:
  - `inventoryView` tests of scaled effect text and the Rarity label;
  - a `pickupView` test of the glow per Rarity;
  - screenshots of each Rarity's Weapon in hand and on the Floor, in a Run and online (two peers see the same tint).

#### Design
**Colour tokens** (`src/render/rarityColours.ts`, new, render-only, imported by play and render):
- `RARITY_COLOUR: Readonly<Record<Rarity, number | null>>` = Common `null`, Rare `0x4a9eff` (blue), Legendary `0xff8a1f` (orange).
- `rarityCss(r: Rarity): string | null` is the same colour as `#rrggbb`.
- `rarityClass(r: Rarity): string` is `''` for Common and `rarity-rare` / `rarity-legendary` otherwise.
- `src/play/styles.ts` builds its CSS tokens from these constants, so there is one source: `--rarity-rare`, `--rarity-legendary`, and the classes `.rarity-rare` and `.rarity-legendary` (text colour), `.inv-slot.rarity-…` (slot border), `.hud-pickup.rarity-…` (label border and text), and `.hud-build-item.rarity-…`.
- Common gets no class, so it looks as now.

**Inventory screen** (`src/play/inventoryView.ts`, `src/play/inventoryScreen.ts`, `src/play/loot.ts`):
- `ItemView` gains `rarity: Rarity` and `label: string`. The label is the name for a Common item and `"<name> · <Rarity>"` otherwise, so a Common item reads as now.
- A Relic's `words` are `relicWords(scaleEffects(effects, multipliers[rarity]))`, so the numbers are the scaled ones and a downside reads as it is.
- A Weapon's `words` (empty today) are its scaled `loot.effects` in words, then for a Rare or Legendary Weapon its Rarity damage, as `"+15% damage (Rare)"`. That keeps it apart from a Longsword's own `damage` effect, which reads "+15% damage" too at Rare. They are listed for every Weapon slot (each counts only while wielded).
- `inventoryView` needs `'weapons'` in its Tuning Data pick.
- `inventoryViewKey` adds the Rarity.
- The screen puts `rarityClass` on the slot and on the name, and shows `label`.

**HUD**:
- The HUD has no inventory slot strip. The items it shows are the pickup labels over the Floor and the results Build, so "HUD slots" means those two.
- `PickupLabel` gains `rarity`; `hud.ts` toggles `rarityClass` on the tag.
- **Results Build** (`src/play/hud.ts` `buildRows`): each item gets `rarityClass(item.rarity)`.

**Pickups** (`src/render/pickupView.ts`, `src/render/pickupMarks.ts`):
- `PickupView` gains `glow: Rarity | null`: the pickup's Rarity when it is not Common, else null. `pickupView` sets it.
- `PickupMarks` gives each slot a flat emissive ring (a `RingGeometry` lying on the ground, `MeshBasicMaterial` in the Rarity colour, additive, slightly transparent), shown only under a glowing pickup.
- It keeps a fixed pool of `GLOW_LIGHTS = 4` `PointLight`s, made in the constructor and always in the scene, so the scene's light count never changes and no shader recompiles. They go to the nearest shown glowing pickups (by `distance`), in the Rarity colour; the unused ones get intensity 0.
- A lying Weapon pickup's model also gets the Weapon tint below.

**The wielded Weapon in 3D** (`src/render/fighterView.ts`, `src/render/renderer.ts`):
- `FighterView.setRarity(rarity: Rarity)` sets the view's own `steel` material's emissive to `rarityTint(STEEL_EMISSIVE, rarity)`, and for the `staff` look (all Head, wood) the `wood` material's too.
  - `rarityTint(base, r)` is in `rarityColours.ts`: the base for Common, else a lerp 0.55 from the base to the Rarity colour.
  - Each FighterView owns its materials, so one Fighter's tint never leaks to another's.
  - The sheathed Weapon uses the same meshes, so it keeps its tint.
  - Throwing Daggers are another view and are not tinted.
- `wieldedRarity(f: Pick<FighterState, 'inventory'>): Rarity` is pure in `rarityColours.ts`: the wielded Item's Rarity, or Common without an inventory.
  - `renderer.ts` calls `slot.view.setRarity(wieldedRarity(f))` beside `update`, from the simulated Fighter, so every peer draws the same tint. Enemies have no inventory, so they draw Common.
  - It is render only: nothing in `src/sim` changes in this Stage.

**Files**: task A (screens): `src/render/rarityColours.ts` (new), `src/play/styles.ts`, `src/play/inventoryView.ts`, `src/play/inventoryScreen.ts`, `src/play/loot.ts`, `src/play/hud.ts`, `src/render/pickupView.ts` (the `glow` and the label's `rarity` only), and their tests. Task B (3D): `src/render/pickupMarks.ts`, `src/render/fighterView.ts`, `src/render/steel.ts`, `src/render/renderer.ts`, and their tests. B runs after A, because it imports A's `rarityColours.ts`.

**New tests**:
- `inventoryView.test.ts`:
  - a Rare Whetstone reads "+15% damage" and "Whetstone · Rare";
  - a Legendary Glass Cannon reads "+60% damage, +25% damage taken";
  - a Rare Longsword lists "+15% damage, +15% damage (Rare)";
  - a Common item's label is its bare name;
  - the key changes with the Rarity.
- `pickupView.test.ts`: `glow` is null, `'Rare'` or `'Legendary'` by the pickup's Rarity, and the label carries the Rarity.
- `rarityColours.test.ts`: the tokens, `rarityTint` (the base unchanged for Common, distinct for Rare and Legendary) and `wieldedRarity`.
- `pickupMarks.test.ts` (it builds `PickupMarks` headless already): the ring shows only under Rare and Legendary pickups; the light count is fixed; the nearest glowing pickups get the lit lights.
- Screenshots (`docs/plans/loot-rarity/`) by a Playwright script driving the dev build.

## Later
- A loot announcement for a Legendary.
- Rolled affixes on Weapons.
- Rarity on enemies' worn Relics (stronger elites deeper).
- A Rarity aura on the Fighter for its best Relic.
- Rebalancing the Relic and Weapon effect values after a playtest.
