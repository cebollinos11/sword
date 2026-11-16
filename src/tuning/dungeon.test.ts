import { describe, expect, it } from 'vitest';
import { loadTuningData, parseDungeon, tuningDataHash, type TuningData } from './index';

const tuning = loadTuningData();
const WEAPONS = Object.keys(tuning.weapons);
const raw = () => JSON.parse(JSON.stringify(tuning.dungeon)) as Record<string, unknown> & { inventory: Record<string, unknown> };
const parse = (d: unknown) => parseDungeon(d, WEAPONS);

describe('Dungeon Tuning Data (data/dungeon.json)', () => {
  it('leftOutWeapons: Weapons of the roster a Run never drops (absent: none); refuses an unknown name, or leaving out every Weapon', () => {
    expect(tuning.dungeon.leftOutWeapons).toEqual(['Flail', 'Quarterstaff', 'Dagger']);
    const { leftOutWeapons: _left, ...without } = raw();
    expect(parse(without).leftOutWeapons).toEqual([]);
    expect(() => parse({ ...raw(), leftOutWeapons: ['Spoon'] })).toThrow(/^dungeon\.leftOutWeapons\[0\]: unknown Weapon "Spoon"/);
    expect(() => parse({ ...raw(), leftOutWeapons: WEAPONS })).toThrow(/^dungeon\.leftOutWeapons must leave at least one Weapon/);
  });

  it('loads the repo file: the Run numbers, the inventory sizes and the loot', () => {
    const d = tuning.dungeon;
    expect([d.stairsSeconds, d.fadeSeconds, d.revive, d.restHeal]).toEqual([1.5, 1, 0.25, 0.5]);
    expect(d.inventory).toEqual({ weapons: 3, relics: 6, equippedRelics: 3 });
    expect(d.loot).toEqual({ weights: { Relic: 4, Weapon: 1 }, drops: { Fight: 1, Elite: 1, Boss: 2 }, pedestals: 3 });
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
    expect(() => parse({ ...raw(), inventory: { weapons: 0, relics: 6, equippedRelics: 3 } })).toThrow(/inventory\.weapons/);
    expect(() => parse({ ...raw(), inventory: { weapons: 3, relics: 2, equippedRelics: 3 } })).toThrow(/equippedRelics/);
    expect(() => parse({ ...raw(), inventory: { weapons: 3, relics: 6.5, equippedRelics: 3 } })).toThrow(/inventory\.relics/);
  });

  it('refuses a missing or bad loot: weights, drops per rank and pedestals', () => {
    const loot = (patch: object) => ({ ...raw(), loot: { weights: { Relic: 4, Weapon: 1 }, drops: { Fight: 1, Elite: 0, Boss: 2 }, pedestals: 3, ...patch } });
    expect(() => parse({ ...raw(), loot: undefined })).toThrow(/dungeon\.loot/);
    expect(() => parse(loot({ weights: { Relic: 0, Weapon: 0 } }))).toThrow(/weights/);
    expect(() => parse(loot({ weights: { Relic: -1, Weapon: 1 } }))).toThrow(/weights\.Relic/);
    expect(() => parse(loot({ weights: { Relic: 1 } }))).toThrow(/weights\.Weapon/);
    expect(parse(loot({ weights: { Relic: 0, Weapon: 2 } })).loot.weights).toEqual({ Relic: 0, Weapon: 2 });
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
