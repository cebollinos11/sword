/**
 * Rarity rolls (docs/plans/loot-rarity.md, Stage 3): every Weapon and Relic drop gets a seeded Rarity by depth (tier) and source, the same on every peer.
 */
import { describe, expect, it } from 'vitest';
import { atLeast, carriedRarity, loadTuningData, raiseRarity, RARITIES, type Rarity, type TuningData } from '../tuning';
import { flatFloors } from './delver/flat.testdata';
import { arenaOf } from './arena';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import { lootSlot, treasurePickups, warbandDrops, warbandLoot } from './delverLoot';
import { floorDuel } from './delverRun';
import { runSeed } from './dungeon';
import { createMatch } from './match';
import { pickItemAt, rollRarity, type LootSource } from './pickups';
import { createRng } from './rng';
import { BOSS, ELITE } from './warband';

const base = flatFloors(loadTuningData());
/** Three tiers of one Floor each, as delverLoot.test.ts. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 3, floorsPerTier: 1 } };
const rarity = tuning.dungeon.loot.rarity;
const RANKS = ['Fight', 'Elite', 'Boss', 'Pedestal'] as const;
const TIERS = [1, 2, 3] as const;

/** The Rarities (first letters) of slots 0 to 23 of Floor 2 under seed 7, per tier and rank: pinned, so a change to the draw shows. */
const PINNED: Record<string, string> = {
  '1 Boss': 'RRRRRRRRRRRRRRRRRRRRRRRR',
  '1 Elite': 'RCRCCLCCCCRLLRCCCLLRCCCL',
  '1 Fight': 'RCCCCRCCCCCRRRCCCRRCCCCR',
  '1 Pedestal': 'RRRRRRRRRRRRRRRRRRRRRRRR',
  '2 Boss': 'RRRRRLRRRRRLLRRRRLLRRRRL',
  '2 Elite': 'LRRCCLRCRCRLLLRRRLLRRCCL',
  '2 Fight': 'RCRCCLCCCCRLLRCCCLLRCCCL',
  '2 Pedestal': 'RRRRRLRRRRRLLRRRRLLRRRRL',
  '3 Boss': 'LRRRRLRRRRRLLLRRRLLRRRRL',
  '3 Elite': 'LRRCCLRCRCRLLLRRRLLRRCCL',
  '3 Fight': 'LRRCCLRCRCRLLLRRRLLRRCCL',
  '3 Pedestal': 'LRRRRLRRRRRLLLRRRLLRRRRL',
};

describe('raiseRarity and atLeast', () => {
  it('raises by steps, capped at Legendary, and lifts to a minimum', () => {
    expect(raiseRarity('Common', 0)).toBe('Common');
    expect(raiseRarity('Common', 1)).toBe('Rare');
    expect(raiseRarity('Common', 2)).toBe('Legendary');
    expect(raiseRarity('Rare', 1)).toBe('Legendary');
    expect(raiseRarity('Legendary', 1)).toBe('Legendary');
    expect(raiseRarity('Common', 9)).toBe('Legendary');
    expect(atLeast('Common', 'Rare')).toBe('Rare');
    expect(atLeast('Rare', 'Rare')).toBe('Rare');
    expect(atLeast('Legendary', 'Rare')).toBe('Legendary');
    expect(atLeast('Common', 'Common')).toBe('Common');
  });
});

describe('carriedRarity', () => {
  it("is the tier's Rarity, a Boss's one step higher", () => {
    expect(TIERS.map((t) => carriedRarity(rarity, t, false))).toEqual(['Common', 'Rare', 'Legendary']);
    expect(TIERS.map((t) => carriedRarity(rarity, t, true))).toEqual(['Rare', 'Legendary', 'Legendary']);
  });
});

describe('rollRarity', () => {
  it('rolls the same Rarity twice, and the pinned ones for one seed, Floor and slots', () => {
    const letter = (r: Rarity) => r[0]!;
    const table: Record<string, string> = {};
    for (const tier of TIERS)
      for (const rank of RANKS) {
        const roll = () => Array.from({ length: 24 }, (_, slot) => letter(rollRarity(rarity, 7, 2, slot, { tier, rank }))).join('');
        expect(roll()).toBe(roll());
        table[`${tier} ${rank}`] = roll();
      }
    expect(table).toEqual(PINNED);
  });

  /** Each Rarity's share over 6000 (seed, slot) pairs at `source` must be within 3 points of odds row `row` (1-based). */
  const expectSplit = (source: LootSource, row: number): void => {
    const counts: Record<Rarity, number> = { Common: 0, Rare: 0, Legendary: 0 };
    const n = 6000;
    for (let i = 0; i < n; i++) counts[rollRarity(rarity, 1 + (i % 50), 1 + (i % 7), i, source)]++;
    const weights = rarity.odds[row - 1]!;
    const total = weights.reduce((a, b) => a + b, 0);
    RARITIES.forEach((r, i) => expect(Math.abs(counts[r] / n - weights[i]! / total), `${source.rank} tier ${source.tier} ${r}`).toBeLessThanOrEqual(0.03));
  };

  it('splits each tier by its odds row at a Fight, within 3 points over 6000 draws', () => {
    for (const tier of TIERS) expectSplit({ tier, rank: 'Fight' }, tier);
  });

  it("rolls an Elite of tier t by tier t + 1's odds, tier 3's at most", () => {
    for (const tier of TIERS) expectSplit({ tier, rank: 'Elite' }, Math.min(3, tier + 1));
  });

  it('never rolls a Boss or a Pedestal Common, and rolls them to each Rarity above it', () => {
    for (const tier of TIERS)
      for (const rank of ['Boss', 'Pedestal'] as const) {
        const seen = new Set<Rarity>();
        for (let slot = 0; slot < 3000; slot++) seen.add(rollRarity(rarity, 11, 1, slot, { tier, rank }));
        expect([...seen].sort()).toEqual(['Legendary', 'Rare']);
      }
  });
});

describe('pickItemAt', () => {
  const sources = TIERS.flatMap((tier) => RANKS.map((rank): LootSource => ({ tier, rank })));

  it('gives every Player the same Item twice, for every rank and tier', () => {
    for (let player = 0; player < 4; player++)
      for (const source of sources)
        for (let k = 0; k < 6; k++) {
          const slot = lootSlot(source.rank === 'Pedestal' ? 1 : 0, 2, player, k);
          expect(pickItemAt(tuning, 5, 2, slot, [], source)).toEqual(pickItemAt(tuning, 5, 2, slot, [], source));
        }
  });

  it('keeps Consumables Common, rolls Weapons and Relics to every Rarity, and moves no kind or name', () => {
    const seen: Record<string, Set<Rarity>> = { weapon: new Set(), relic: new Set(), consumable: new Set() };
    for (let slot = 0; slot < 4000; slot++) {
      const d = pickItemAt(tuning, 3, 1, slot, [], { tier: 3, rank: 'Fight' });
      seen[d.kind]!.add(d.item.rarity);
      // The kind and name are those of the Common pick: the Rarity draw has its own salt.
      const plain = pickItemAt({ ...tuning, dungeon: { ...tuning.dungeon, loot: { ...tuning.dungeon.loot, rarity: { ...rarity, odds: [[1, 0, 0], [1, 0, 0], [1, 0, 0]] } } } }, 3, 1, slot, [], { tier: 3, rank: 'Fight' });
      expect([plain.kind, plain.item.name]).toEqual([d.kind, d.item.name]);
      expect(plain.item.rarity).toBe('Common');
    }
    expect([...seen.consumable!]).toEqual(['Common']);
    expect([...seen.weapon!].sort()).toEqual(['Common', 'Legendary', 'Rare']);
    expect([...seen.relic!].sort()).toEqual(['Common', 'Legendary', 'Rare']);
  });
});

describe('Rarity of real drops', () => {
  const SEED = runSeed('gen:greybox:4242');
  const ARENA = 'gen:greybox:4242';
  const { config } = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
  const floor = (f: number) => {
    const name = floorArenaName(SEED, f);
    return { crowd: floorDuel(tuning, config, f, null, createRng(1)).crowd!, plan: floorOf(tuning, name)!.plan, t: arenaTuning(tuning, name), arena: arenaOf(arenaTuning(tuning, name), name) };
  };

  it("gives the first Item of an elite and of a Boss its tier's Rarity", () => {
    const one = floor(1);
    const elite = one.crowd.warbands!.rank.indexOf(ELITE);
    expect(warbandLoot(one.t, one.crowd, elite, 0, SEED, 1)[0]!.item.rarity).toBe('Common');
    const two = floor(2);
    const elite2 = two.crowd.warbands!.rank.indexOf(ELITE);
    if (elite2 >= 0) expect(warbandLoot(two.t, two.crowd, elite2, 0, SEED, 2)[0]!.item.rarity).toBe('Rare');
    const three = floor(3);
    const boss = three.crowd.warbands!.rank.indexOf(BOSS);
    expect(boss).toBeGreaterThanOrEqual(0);
    expect(warbandLoot(three.t, three.crowd, boss, 0, SEED, 3)[0]!.item.rarity).toBe('Legendary');
    // Every Boss pick is at least Rare.
    for (const item of warbandLoot(three.t, three.crowd, boss, 0, SEED, 3).slice(1)) if (item.kind !== 'consumable') expect(item.item.rarity).not.toBe('Common');
  });

  it('lays the same drops and pedestals twice, and no Common Weapon or Relic on a pedestal', () => {
    for (const f of [1, 2, 3]) {
      const { crowd, plan, t, arena } = floor(f);
      const q = crowd.warbands!.rank.indexOf(BOSS) >= 0 ? crowd.warbands!.rank.indexOf(BOSS) : 0;
      const fall = { x: plan.halls[plan.entrance]!.cx, y: 0, z: plan.halls[plan.entrance]!.cz };
      expect(warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, f, 0)).toEqual(warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, f, 0));
      const stands = treasurePickups(t, config, plan, SEED, f);
      expect(stands).toEqual(treasurePickups(t, config, plan, SEED, f));
      for (const p of stands) if (p.kind !== 'consumable') expect(p.item.rarity).not.toBe('Common');
    }
  });
});

