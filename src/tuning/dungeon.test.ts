import { describe, expect, it } from 'vitest';
import { loadTuningData, parseDungeon, tuningDataHash, type TuningData } from './index';

const tuning = loadTuningData();
const raw = () => JSON.parse(JSON.stringify(tuning.dungeon)) as Record<string, unknown> & { inventory: Record<string, unknown> };
const parse = (d: unknown) => parseDungeon(d);

describe('Dungeon Tuning Data (data/dungeon.json)', () => {
  it('refuses a leftOutWeapons key: every Weapon is loot, with a pointer to the plan', () => {
    expect(() => parse({ ...raw(), leftOutWeapons: ['Flail'] })).toThrow(/^dungeon\.leftOutWeapons is retired: every Weapon is loot \(docs\/plans\/loot-rarity\.md\)/);
    expect('leftOutWeapons' in tuning.dungeon).toBe(false);
  });

  it('parses rarity.multipliers, and refuses a missing Rarity, a multiplier below 1 or multipliers that fall', () => {
    expect(tuning.dungeon.loot.rarity.multipliers).toEqual({ Common: 1, Rare: 1.5, Legendary: 2 });
    expect(tuning.dungeon.loot.rarity.weaponDamage).toEqual({ Common: 1, Rare: 1.15, Legendary: 1.3 });
    const rarity = (multipliers: unknown) => {
      const d = raw() as unknown as { loot: Record<string, unknown> };
      return parse({ ...d, loot: { ...d.loot, rarity: multipliers === undefined ? undefined : { ...tuning.dungeon.loot.rarity, multipliers } } });
    };
    expect(rarity({ Common: 1, Rare: 1, Legendary: 3 }).loot.rarity.multipliers).toEqual({ Common: 1, Rare: 1, Legendary: 3 });
    expect(() => rarity(undefined)).toThrow(/dungeon\.loot\.rarity/);
    expect(() => rarity({ Common: 1, Rare: 1.5 })).toThrow(/multipliers\.Legendary/);
    expect(() => rarity({ Rare: 1.5, Legendary: 2 })).toThrow(/multipliers\.Common/);
    expect(() => rarity({ Common: 0.9, Rare: 1.5, Legendary: 2 })).toThrow(/multipliers\.Common must be at least 1/);
    expect(() => rarity({ Common: 1, Rare: 1.5, Legendary: 1.2 })).toThrow(/multipliers must not fall as the Rarity rises/);
    expect(() => rarity({ Common: 1, Rare: Infinity, Legendary: 2 })).toThrow(/multipliers\.Rare/);
  });

  it('parses rarity.weaponDamage, and refuses a missing Rarity, a bonus below 1 or one that falls', () => {
    const bonus = (weaponDamage: unknown) => {
      const d = raw() as unknown as { loot: Record<string, unknown> };
      return parse({ ...d, loot: { ...d.loot, rarity: { ...tuning.dungeon.loot.rarity, weaponDamage } } });
    };
    expect(bonus({ Common: 1, Rare: 1.2, Legendary: 1.2 }).loot.rarity.weaponDamage).toEqual({ Common: 1, Rare: 1.2, Legendary: 1.2 });
    expect(() => bonus(undefined)).toThrow(/weaponDamage/);
    expect(() => bonus({ Common: 1, Rare: 1.15 })).toThrow(/weaponDamage\.Legendary/);
    expect(() => bonus({ Common: 0.9, Rare: 1.15, Legendary: 1.3 })).toThrow(/weaponDamage\.Common must be at least 1/);
    expect(() => bonus({ Common: 1, Rare: 1.3, Legendary: 1.15 })).toThrow(/weaponDamage must not fall as the Rarity rises/);
  });

  it('parses rarity.odds, the steps, the minimums and carried, and refuses each bad one', () => {
    const r = tuning.dungeon.loot.rarity;
    expect([r.odds, r.eliteTierStep, r.bossMin, r.pedestalMin, r.carried, r.bossCarriedStep]).toEqual([[[80, 18, 2], [60, 32, 8], [40, 45, 15]], 1, 'Rare', 'Rare', ['Common', 'Rare', 'Legendary'], 1]);
    const with_ = (patch: object) => {
      const d = raw() as unknown as { loot: Record<string, unknown> };
      return parse({ ...d, loot: { ...d.loot, rarity: { ...r, ...patch } } }).loot.rarity;
    };
    expect(with_({ odds: [[0, 0, 1]], eliteTierStep: 0, bossMin: 'Legendary', carried: ['Legendary'], bossCarriedStep: 0 })).toMatchObject({ odds: [[0, 0, 1]], eliteTierStep: 0, bossMin: 'Legendary' });
    expect(() => with_({ odds: [[80, -1, 2]] })).toThrow(/odds\[0\]\[1\] must be a whole number, 0 or more/);
    expect(() => with_({ odds: [[0, 0, 0]] })).toThrow(/odds\[0\] must have a weight above 0/);
    expect(() => with_({ odds: [[80, 1.5, 2]] })).toThrow(/odds\[0\]\[1\] must be a whole number/);
    expect(() => with_({ odds: [[80, 20]] })).toThrow(/odds\[0\] must be 3 weights/);
    expect(() => with_({ odds: undefined })).toThrow(/rarity\.odds must be an array/);
    expect(() => with_({ bossMin: 'Epic' })).toThrow(/bossMin must be one of Common, Rare, Legendary/);
    expect(() => with_({ pedestalMin: undefined })).toThrow(/pedestalMin/);
    expect(() => with_({ carried: ['Common', 'Mythic'] })).toThrow(/carried\[1\]/);
    expect(() => with_({ eliteTierStep: 1.5 })).toThrow(/eliteTierStep must be a whole number/);
    expect(() => with_({ eliteTierStep: -1 })).toThrow(/eliteTierStep must be a whole number/);
    expect(() => with_({ bossCarriedStep: 0.5 })).toThrow(/bossCarriedStep must be a whole number/);
    expect(() => with_({ bossCarriedStep: -1 })).toThrow(/bossCarriedStep/);
  });

  it('loads the repo file: the Run numbers, the inventory sizes and the loot', () => {
    const d = tuning.dungeon;
    expect([d.stairsSeconds, d.fadeSeconds, d.revive, d.restRevive, d.restHeal]).toEqual([1.5, 1, 0.25, 0.75, 1]);
    // Tuning Data from before restRevive: a fire revives at `revive`.
    const { restRevive: _, ...old } = raw() as Record<string, unknown>;
    expect(parse(old).restRevive).toBe(0.25);
    expect(d.inventory).toEqual({ weapons: 3, relics: 6, equippedRelics: 3 });
    expect(d.loot).toEqual({ weights: { Relic: 4, Weapon: 1, Consumable: 2 }, drops: { Fight: 1, Elite: 1, Boss: 2 }, pedestals: 3, rarity: { multipliers: { Common: 1, Rare: 1.5, Legendary: 2 }, weaponDamage: { Common: 1, Rare: 1.15, Legendary: 1.3 }, odds: [[80, 18, 2], [60, 32, 8], [40, 45, 15]], eliteTierStep: 1, bossMin: 'Rare', pedestalMin: 'Rare', carried: ['Common', 'Rare', 'Legendary'], bossCarriedStep: 1 } });
    // Parsing its own output gives it back (the Editor reparses loaded Tuning Data).
    expect(parse(d)).toEqual(d);
    // The retired Hall graph's keys are gone.
    for (const key of ['floors', 'perPlayerHp', 'depthHp', 'doorSeconds', 'hallFadeSeconds']) expect(key in d, key).toBe(false);
  });

  it('refuses bad Run numbers', () => {
    expect(() => parse({ ...raw(), stairsSeconds: 0 })).toThrow(/stairsSeconds/);
    expect(() => parse({ ...raw(), fadeSeconds: -1 })).toThrow(/fadeSeconds/);
    expect(() => parse({ ...raw(), revive: 0 })).toThrow(/revive/);
    expect(() => parse({ ...raw(), revive: 1.5 })).toThrow(/revive/);
    expect(() => parse({ ...raw(), restHeal: 1.5 })).toThrow(/restHeal/);
    expect(() => parse({ ...raw(), restRevive: 0 })).toThrow(/restRevive/);
    expect(() => parse({ ...raw(), restRevive: 1.5 })).toThrow(/restRevive/);
    expect(() => parse({ ...raw(), inventory: { weapons: 0, relics: 6, equippedRelics: 3 } })).toThrow(/inventory\.weapons/);
    expect(() => parse({ ...raw(), inventory: { weapons: 3, relics: 2, equippedRelics: 3 } })).toThrow(/equippedRelics/);
    expect(() => parse({ ...raw(), inventory: { weapons: 3, relics: 6.5, equippedRelics: 3 } })).toThrow(/inventory\.relics/);
  });

  it('refuses a missing or bad loot: weights, drops per rank and pedestals', () => {
    const loot = (patch: object) => ({ ...raw(), loot: { weights: { Relic: 4, Weapon: 1 }, drops: { Fight: 1, Elite: 0, Boss: 2 }, pedestals: 3, rarity: tuning.dungeon.loot.rarity, ...patch } });
    expect(() => parse({ ...raw(), loot: undefined })).toThrow(/dungeon\.loot/);
    expect(() => parse(loot({ weights: { Relic: 0, Weapon: 0 } }))).toThrow(/weights/);
    expect(() => parse(loot({ weights: { Relic: -1, Weapon: 1 } }))).toThrow(/weights\.Relic/);
    expect(() => parse(loot({ weights: { Relic: 1 } }))).toThrow(/weights\.Weapon/);
    // A Consumable weight left out is 0 (Tuning Data from before Consumables); one alone is enough.
    expect(parse(loot({ weights: { Relic: 0, Weapon: 2 } })).loot.weights).toEqual({ Relic: 0, Weapon: 2, Consumable: 0 });
    expect(parse(loot({ weights: { Relic: 0, Weapon: 0, Consumable: 1 } })).loot.weights).toEqual({ Relic: 0, Weapon: 0, Consumable: 1 });
    expect(() => parse(loot({ weights: { Relic: 1, Weapon: 1, Consumable: -1 } }))).toThrow(/weights\.Consumable/);
    expect(() => parse(loot({ drops: { Fight: 5, Elite: 0, Boss: 2 } }))).toThrow(/drops\.Fight/);
    expect(() => parse(loot({ drops: { Fight: 1, Elite: 0.5, Boss: 2 } }))).toThrow(/drops\.Elite/);
    expect(() => parse(loot({ drops: { Fight: 1, Elite: 0 } }))).toThrow(/drops\.Boss/);
    expect(() => parse(loot({ pedestals: 0 }))).toThrow(/pedestals/);
    expect(() => parse(loot({ pedestals: 5 }))).toThrow(/pedestals/);
  });

  it('is in the Tuning Data hash: any change to it changes the hash', () => {
    const base = tuningDataHash(tuning);
    const d = tuning.dungeon;
    const changed = (dungeon: TuningData['dungeon']) => tuningDataHash({ ...tuning, dungeon });
    expect(changed({ ...d, stairsSeconds: d.stairsSeconds + 0.5 })).not.toBe(base);
    expect(changed({ ...d, restHeal: d.restHeal / 2 })).not.toBe(base);
    expect(changed({ ...d, loot: { ...d.loot, drops: { ...d.loot.drops, Boss: 1 } } })).not.toBe(base);
  });
});
