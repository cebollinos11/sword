# Loot Rarity: Rarities, Weapon Effects and the Full Roster as Loot

> Status: scope agreed (2026-11-17), the open questions answered by the user. Nothing built yet. Tracked in #152 (Stages: #153, #154, #155, #156). Builds on the Delver's loot (`docs/plans/delver.md`, Stage 4: Warband drops, Treasure pedestals, elites' carried Relics), the Inventory and Relics (`docs/plans/dungeon.md`), the Consumables (`docs/plans/delver.md`, Stage 10) and the Delver Troops (`docs/plans/delver-troops.md`). Each Stage ends with a `### Result`, as in the other plans.

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
- [ ] Stage 1: Rarity in the Item, scaled Relic effects, the full roster as loot
- [ ] Stage 2: Weapon effects and the Rarity damage bonus
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

### Stage 2: Weapon effects and the Rarity damage bonus
- `loot.effects` in the Weapon files (the table above) and parsed.
- `inventoryMods` folds the wielded Weapon's scaled effects and `weaponDamage`.
- **Done**:
  - tests that swapping Weapons changes `mods` (Dagger: +1 dagger in hand, gone on a swap);
  - tests that a Rare Longsword's Hit is 1.1 scaled × 1.15;
  - tests that an enemy with the same Weapon has `mods` unchanged;
  - a rollback test of an equip mid-Floor still in step.

### Stage 3: Rarity rolls by depth and source
- The full `dungeon.loot.rarity`, and `pickItemAt` drawing a Rarity by tier and rank.
- The Rarity of the carried Relic.
- **Done**:
  - a deterministic test per Player of drops at every rank and tier;
  - a statistical test over a few thousand seeds that each tier's split lands within a few points of its odds;
  - tests that pedestals and Boss drops are never Common, that Consumables are always Common, and that carried Relics follow the tier.

### Stage 4: Rarity shown
- The colour tokens, the inventory screen and HUD slots, the results Build, the pickup glow and the wielded Weapon's tint.
- **Done**:
  - `inventoryView` tests of scaled effect text and the Rarity label;
  - a `pickupView` test of the glow per Rarity;
  - screenshots of each Rarity's Weapon in hand and on the Floor, in a Run and online (two peers see the same tint).

## Later
- A loot announcement for a Legendary.
- Rolled affixes on Weapons.
- Rarity on enemies' worn Relics (stronger elites deeper).
- A Rarity aura on the Fighter for its best Relic.
- Rebalancing the Relic and Weapon effect values after a playtest.
