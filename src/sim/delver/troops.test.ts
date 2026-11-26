import { describe, expect, it } from 'vitest';
import { loadTuningData, MAX_SIZE, MIN_SIZE, type TuningData } from '../../tuning';
import { delverBattle } from './build';
import { DUEL_TROOP_TIER, floorLooks, floorPrefabs, floorTroops, floorTuningOf, isBossFloor, resolveTroop, sizeOfHp, soldierHp, tierOf, troopLabel, troopMods } from './troops';
import { relicMods, relicOf } from '../inventory';
import { foldMods, NO_MODS } from '../mods';
import { delverFloor } from './generate';

const tuning = loadTuningData();
const { battle, delver } = tuning;
const without = (tier: number) => ({ ...delver, warbands: delver.warbands.map((t, i) => (i === tier ? { guard: t.guard, patrol: t.patrol, elite: t.elite } : t)) });
const variants = delver.troops.reduce((n, p) => n + p.variants.length, 0);
const plainVariants = delver.troops.reduce((n, p) => n + p.variants.filter((v) => !v.boss).length, 0);

describe('floorTroops', () => {
  const ft = floorTroops(delver);

  it('lists every Variant, Prefab by Prefab, then each non-Boss Variant again per elite Relic set', () => {
    let next = 0;
    delver.troops.forEach((p, i) =>
      p.variants.forEach((v, k) => {
        expect(ft.plain[i]![k]).toBe(next);
        expect(ft.troops[next++]!.name).toBe(v.name);
      }),
    );
    expect(next).toBe(variants);
    // Two distinct sets: [Whetstone] and [Heavy Gauntlet, Glass Cannon].
    expect(ft.elite).toHaveLength(2);
    expect(ft.troops).toHaveLength(variants + 2 * plainVariants);
    expect(ft.eliteSet).toEqual([[0], [0, 1], [1]]);
    for (const set of ft.elite)
      delver.troops.forEach((p, i) =>
        p.variants.forEach((v, k) => {
          if (v.boss) expect(set[i]![k]).toBe(-1);
          else expect(ft.troops[set[i]![k]!]!.name).toBe(`${v.name} (elite)`);
        }),
      );
  });

  it('a Troop is its Prefab\'s look and its Variant\'s stats, tinted by its skill', () => {
    const p = delver.troops[2]!;
    const v = p.variants[2]!;
    expect(ft.troops[ft.plain[2]![2]!]).toEqual({
      name: v.name,
      weight: 1,
      bodies: [p.body],
      weapon: p.weapon,
      difficulty: 'Expert',
      style: v.style,
      relics: v.relics,
      hp: v.hp,
      damage: v.damage,
      hitChance: v.hitChance,
      engageReach: v.engageReach,
      mods: v.mods,
      prefab: 2,
      tint: 0x1c1c1c,
    });
    expect(ft.troops[ft.plain[0]![0]!]!.tint).toBe(0x8e8e8e);
    expect(ft.troops[ft.plain[0]![1]!]!.tint).toBe(0xb3261e);
  });

  it('an elite Troop wears its Variant\'s Relics and then its set\'s', () => {
    const e = ft.troops[ft.elite[1]![2]![2]!]!;
    expect(e.relics).toEqual(['Honed Daggers', 'Heavy Gauntlet', 'Glass Cannon']);
    expect(e.boss).toBeUndefined();
    expect(ft.troops[ft.elite[0]![0]![0]!]!.relics).toEqual(['Whetstone']);
  });

  it('each tier\'s Boss is its Boss Variant\'s Troop, flagged', () => {
    expect(ft.boss.map((b) => ft.troops[b]!.name)).toEqual(['Warden', 'Duelist', 'Wraith Lord']);
    for (const b of ft.boss) expect(ft.troops[b]!.boss).toBe(true);
    expect(ft.troops[ft.boss[2]!]!).toMatchObject({ bodies: ['wraith'], weapon: 'Longsword', relics: ['Heavy Gauntlet'], mods: {} });
  });

  it('is cached per delver object, and a changed Tuning gives its own list', () => {
    expect(floorTroops(delver)).toBe(ft);
    const other = without(0);
    expect(floorTroops(other)).not.toBe(ft);
    expect(floorTroops(other)).toBe(floorTroops(other));
    expect(floorTroops(other).boss[0]).toBe(-1);
  });

  it('delverBattle carries them as the Floor\'s troops, and leaves battle.troops alone', () => {
    const base = battle.troops.length;
    const b = delverBattle(tuning, { ...(Object.values(battle.maps)[0] ?? ({} as never)) });
    expect(b.troops).toBe(ft.troops);
    expect(battle.troops.length).toBe(base);
  });
});

describe('floorPrefabs and floorLooks', () => {
  it('picks prefabsPerFloor different Prefabs, ascending, the same for the same (seed, Floor)', () => {
    for (let seed = 1; seed < 30; seed++)
      for (let floor = 1; floor <= 9; floor++) {
        const picked = floorPrefabs(delver, seed, floor);
        expect(picked).toHaveLength(delver.prefabsPerFloor);
        expect(new Set(picked).size).toBe(picked.length);
        expect(picked).toEqual([...picked].sort((a, b) => a - b));
        expect(floorPrefabs(delver, seed, floor)).toEqual(picked);
      }
  });

  it('varies from Floor to Floor, a Prefab free to come back, and over a few Runs fields every Prefab', () => {
    const seen = new Set<number>();
    let changed = 0;
    let repeated = 0;
    for (let seed = 1; seed < 20; seed++)
      for (let floor = 1; floor < 9; floor++) {
        const a = floorPrefabs(delver, seed, floor);
        const b = floorPrefabs(delver, seed, floor + 1);
        a.forEach((p) => seen.add(p));
        if (a.join() !== b.join()) changed++;
        if (a.some((p) => b.includes(p))) repeated++;
      }
    expect(seen.size).toBe(delver.troops.length);
    expect(changed).toBeGreaterThan(100);
    expect(repeated).toBeGreaterThan(0);
  });

  it('fields every Prefab when there are no more than prefabsPerFloor', () => {
    expect(floorPrefabs({ ...delver, prefabsPerFloor: 99 }, 3, delver.tiers * delver.floorsPerTier)).toEqual(delver.troops.map((_, i) => i));
  });

  it('fields a Prefab only from its minTier on', () => {
    const late = delver.troops.flatMap((p, i) => ((p.minTier ?? 1) > 1 ? [i] : []));
    expect(late.length).toBeGreaterThan(0);
    for (let seed = 1; seed < 30; seed++)
      for (let floor = 1; floor <= 9; floor++) {
        const tier = tierOf(delver, floor);
        for (const p of floorPrefabs(delver, seed, floor)) expect(delver.troops[p]!.minTier ?? 1).toBeLessThanOrEqual(tier);
      }
    // Every Prefab may be fielded once its tier has come.
    expect(floorPrefabs({ ...delver, prefabsPerFloor: 99 }, 3, 1)).toEqual(delver.troops.flatMap((p, i) => ((p.minTier ?? 1) <= 1 ? [i] : [])));
  });

  it('adds the Boss\'s Prefab on a Boss Floor only', () => {
    for (let seed = 1; seed < 30; seed++)
      for (let floor = 1; floor <= 9; floor++) {
        const looks = floorLooks(delver, seed, floor);
        const prefabs = floorPrefabs(delver, seed, floor);
        const boss = delver.warbands[tierOf(delver, floor) - 1]!.boss!.prefab;
        const expected = isBossFloor(delver, floor) && !prefabs.includes(boss) ? [...prefabs, boss].sort((a, b) => a - b) : prefabs;
        expect(looks).toEqual(expected);
      }
  });
});

describe('sizeOfHp', () => {
  it('is the smallest body at sizeHp[0] or less, the biggest at sizeHp[1] or more, in a line between, snapped; height runs 0.7 to 1.3, thickness 0.9 to 1.4', () => {
    // Its own sizeHp, apart from the file's.
    const delver = { sizeHp: [30, 150] as const };
    expect(sizeOfHp(delver, 10)).toEqual({ height: MIN_SIZE, thick: 0.9 });
    expect(sizeOfHp(delver, 30)).toEqual({ height: MIN_SIZE, thick: 0.9 });
    expect(sizeOfHp(delver, 90)).toEqual({ height: 1, thick: 1.15 });
    expect(sizeOfHp(delver, 150)).toEqual({ height: 1.3, thick: MAX_SIZE });
    expect(sizeOfHp(delver, 400)).toEqual({ height: 1.3, thick: MAX_SIZE });
    expect(sizeOfHp(delver, 35).height).toBe(0.7);
    expect(sizeOfHp(delver, 36).height).toBe(0.75);
  });
});

describe('tierOf and isBossFloor', () => {
  it('tiers by floorsPerTier, capped at the last tier, and every third Floor is a Boss Floor', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => tierOf(delver, f))).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(tierOf(delver, 10)).toBe(3);
    expect(tierOf(delver, 0)).toBe(1);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((f) => isBossFloor(delver, f))).toEqual([3, 6, 9]);
  });

  it('a tier without a Boss has no Boss Floor', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((f) => isBossFloor(without(2), f))).toEqual([3, 6]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((f) => isBossFloor(without(0), f))).toEqual([6, 9]);
  });
});

describe('floorTuningOf', () => {
  it('gives each tier its tierRooms (issue #135: a third, a half, then full), the rest of delver.floor as it is', () => {
    expect(delver.tierRooms).toEqual([7, 10, 20]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => floorTuningOf(delver, f).rooms)).toEqual([7, 7, 7, 10, 10, 10, 20, 20, 20]);
    expect({ ...floorTuningOf(delver, 1), rooms: delver.floor.rooms }).toEqual(delver.floor);
    expect(floorTuningOf(delver, 2)).toBe(floorTuningOf(delver, 1));
    expect(floorTuningOf(delver, 9)).toBe(delver.floor);
    const { tierRooms: _, ...plain } = delver;
    expect(floorTuningOf(plain, 1)).toBe(plain.floor);
  });

  it('deals each Floor its tier\'s Halls, judged', () => {
    for (const floor of [1, 4, 7]) {
      const f = delverFloor(tuning, 5, floor);
      expect(f.plan.halls.length).toBe(delver.tierRooms![tierOf(delver, floor) - 1]);
      expect(f.judgement.ok).toBe(true);
    }
  });
});

describe('resolveTroop: a Delver Troop fought in a Duel (docs/plans/enemy-behaviours.md, Stage 0)', () => {
  const uruk = delver.troops.findIndex((p) => p.name === 'Uruk');
  const revenant = delver.troops.findIndex((p) => p.name === 'Revenant');

  it('fields "Uruk (Beginner)" as a Floor does: its Prefab Body and Weapon, its Variant difficulty and Style, Mods, HP at tier 2 and the Size of that HP', () => {
    const t = resolveTroop(tuning, { prefab: 'Uruk', variant: 'Uruk (Beginner)' });
    const v = delver.troops[uruk]!.variants[t.variant]!;
    expect(t.prefab).toBe(uruk);
    expect(t.troop).toBe(floorTroops(delver).troops[floorTroops(delver).plain[uruk]![t.variant]!]);
    expect(t).toMatchObject({ body: 'uruk', weapon: 'Sledge Hammer', difficulty: 'Beginner', style: 'Reckless', quirks: ['Slow'], relics: [], tier: DUEL_TROOP_TIER });
    // Its own damage 0.6, then the Slow Quirk's walk and Wind-up (the roster pass, Stage 6).
    expect(t.mods).toEqual({ ...NO_MODS, damage: 0.6, walkSpeed: 0.7, windUp: 1.35 });
    expect(t.maxHp).toBe(v.hp * delver.tierHp[DUEL_TROOP_TIER - 1]!);
    expect(t.size).toEqual(sizeOfHp(delver, t.maxHp));
  });

  it('scales a plain Variant HP by the Floor tier it names', () => {
    for (let tier = 1; tier <= delver.tiers; tier++) {
      const t = resolveTroop(tuning, { prefab: 'Uruk', variant: 'Uruk (Beginner)', tier });
      expect(t.tier).toBe(tier);
      expect(t.maxHp).toBe(80 * delver.tierHp[tier - 1]!);
      expect(t.size).toEqual(sizeOfHp(delver, t.maxHp));
    }
  });

  it('fields a Boss Variant ("Wraith Lord") with its Relics, its whole HP whatever the tier, and its Size', () => {
    const v = delver.troops[revenant]!.variants.find((x) => x.name === 'Wraith Lord')!;
    for (const tier of [undefined, 1, 3]) {
      const t = resolveTroop(tuning, { prefab: 'Revenant', variant: 'Wraith Lord', ...(tier === undefined ? {} : { tier }) });
      expect(t).toMatchObject({ body: 'wraith', weapon: 'Longsword', difficulty: 'Expert', style: 'Aggressive', relics: ['Heavy Gauntlet'] });
      expect(t.troop.boss).toBe(true);
      expect(t.mods).toEqual(foldMods([{ effects: v.mods }, relicOf(tuning, 'Heavy Gauntlet')]));
      expect(t.maxHp).toBe(v.hp * (1 + relicMods(tuning, v.relics).maxHp));
      expect(t.size).toEqual(sizeOfHp(delver, t.maxHp));
    }
  });

  it('shares its HP and Mods with the Floor: the formula a Crowd deploys with, and the fold a promotion wears', () => {
    const elite = floorTroops(delver).troops.find((t) => t.relics?.length && !t.boss)!;
    const scale = 1.25;
    expect(soldierHp(tuning, elite, false, scale, delver.tierHp[2]!)).toBe(elite.hp * scale * delver.tierHp[2]! * (1 + relicMods(tuning, elite.relics!).maxHp));
    expect(troopMods(tuning, elite)).toEqual(foldMods([{ effects: elite.mods }, ...elite.relics!.map((r) => relicOf(tuning, r))]));
  });

  it("carries its Variant's Quirks (the roster pass's, Stage 6), and folds their body parts into its Mods after its Relics, as a Floor's promotion does", () => {
    expect(resolveTroop(tuning, { prefab: 'Uruk', variant: 'Uruk (Beginner)' }).quirks).toEqual(['Slow']);
    expect(resolveTroop(tuning, { prefab: 'Uruk', variant: 'Warden' }).quirks).toEqual([]);
    expect(resolveTroop(tuning, { prefab: 'Revenant', variant: 'Revenant (Expert)' }).quirks).toEqual([]);
    // Only the roster pass's Variants carry Quirks, their elites too; no Boss does.
    expect([...new Set(floorTroops(delver).troops.filter((t) => 'quirks' in t).map((t) => `${t.name.replace(/ \(elite\)$/, '')}: ${t.quirks!.join(' + ')}`))]).toEqual(['Bruiser (Beginner): Dumb', 'Squire (Skilled): Hopper', 'Squire (Expert): Hopper', 'Uruk (Beginner): Slow', 'Uruk (Skilled): Slow', 'Uruk (Expert): Slow']);
    // Every Variant of the Revenant Dumb and Heavy (a body part: more damage, more max HP), elites and the Boss too.
    const heavy = { damage: 1.5, maxHp: 0.25 };
    const quirky: TuningData = {
      ...tuning,
      ai: { ...tuning.ai, quirks: { ...tuning.ai.quirks, Heavy: { body: heavy } } },
      delver: { ...delver, troops: delver.troops.map((p) => (p.name !== 'Revenant' ? p : { ...p, variants: p.variants.map((v) => ({ ...v, quirks: ['Dumb', 'Heavy'] })) })) },
    };
    const lord = resolveTroop(quirky, { prefab: 'Revenant', variant: 'Wraith Lord' });
    expect(lord.quirks).toEqual(['Dumb', 'Heavy']);
    const v = delver.troops[revenant]!.variants.find((x) => x.name === 'Wraith Lord')!;
    expect(lord.mods).toEqual(foldMods([{ effects: v.mods }, relicOf(tuning, 'Heavy Gauntlet'), { effects: heavy }]));
    // The Floor's own Troops of it, elites included, carry them too, and their promotion's fold is the same.
    const revenants = floorTroops(quirky.delver).troops.filter((t) => t.prefab === revenant);
    expect(revenants.length).toBeGreaterThan(delver.troops[revenant]!.variants.length);
    for (const t of revenants) {
      expect(t.quirks).toEqual(['Dumb', 'Heavy']);
      expect(troopMods(quirky, t)).toEqual(foldMods([{ effects: t.mods }, ...(t.relics ?? []).map((r) => relicOf(tuning, r)), { effects: heavy }]));
    }
    // A Quirk Tuning Data lacks is refused, naming the known ones.
    expect(() => troopMods(tuning, { ...revenants[0]!, quirks: ['Heavy'] })).toThrow(/Unknown Quirk "Heavy" \(have: Dumb, Hopper, Slow\)/);
  });

  it('refuses a Prefab, a Variant or a tier Tuning Data does not have, naming the known ones', () => {
    expect(() => resolveTroop(tuning, { prefab: 'Goblin', variant: 'Goblin (Beginner)' })).toThrow(/Unknown Troop Prefab "Goblin" \(have: Sellsword, .*Uruk\)/);
    expect(() => resolveTroop(tuning, { prefab: 'Uruk', variant: 'Beginner' })).toThrow(/Unknown Variant "Beginner" of Troop Prefab "Uruk" \(have: Uruk \(Beginner\), Uruk \(Skilled\), Uruk \(Expert\), Warden\)/);
    // A Variant of another Prefab is not this one's.
    expect(() => resolveTroop(tuning, { prefab: 'Uruk', variant: 'Wraith Lord' })).toThrow(/Unknown Variant "Wraith Lord"/);
    for (const tier of [0, delver.tiers + 1, 1.5]) expect(() => resolveTroop(tuning, { prefab: 'Uruk', variant: 'Uruk (Beginner)', tier })).toThrow(/Floor tier is 1 to 3/);
  });

  it('names Variants for the Lobby: the difficulty for a plain one, the name and "(Boss)" for a Boss', () => {
    const p = delver.troops[uruk]!;
    expect(p.variants.map((v) => troopLabel(p, v))).toEqual(['Uruk · Beginner', 'Uruk · Skilled', 'Uruk · Expert', 'Uruk · Warden (Boss)']);
    expect(troopLabel(p, { name: 'Uruk Captain', difficulty: 'Expert' })).toBe('Uruk · Uruk Captain');
  });
});
