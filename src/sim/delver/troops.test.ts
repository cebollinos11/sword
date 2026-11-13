import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import { delverBattle } from './build';
import { floorTroops, isBossFloor, tierOf } from './troops';

const tuning = loadTuningData();
const { battle, delver } = tuning;
const base = battle.troops.length;
const without = (tier: number) => ({ ...delver, warbands: delver.warbands.map((t, i) => (i === tier ? { guard: t.guard, patrol: t.patrol, elite: t.elite } : t)) });

describe('floorTroops', () => {
  const ft = floorTroops(battle, delver);

  it('lists battle.troops first, then the Bosses in tier order, then the elites tier by tier, template by template, row by row', () => {
    expect(ft.troops.slice(0, base)).toEqual(battle.troops);
    ft.troops.slice(0, base).forEach((t, i) => expect(t).toBe(battle.troops[i]));
    expect(ft.boss).toEqual([base, base + 1, base + 2]);
    expect(ft.troops.slice(base, base + 3).map((t) => t.name)).toEqual(['Warden', 'Duelist', 'Wraith Lord']);
    let next = base + 3;
    delver.warbands.forEach((tier, ti) =>
      (tier.elite ?? []).forEach((template, ei) =>
        template.troops.forEach((row, ri) => {
          expect(ft.elite[ti]![ei]![ri]).toBe(next++);
          expect(ft.troops[ft.elite[ti]![ei]![ri]!]!.name).toBe(`${battle.troops[row.troop]!.name} (elite)`);
        }),
      ),
    );
    expect(ft.troops.length).toBe(next);
    expect(ft.elite.map((t) => t.map((e) => e.length))).toEqual([[2], [2, 2], [3]]);
  });

  it('a Boss Troop has no Mods, is fixed in Size, wears its Body, Style and Relics and is flagged', () => {
    const wraith = ft.troops[ft.boss[2]!]!;
    const brute = battle.troops.find((t) => t.name === 'Brute')!;
    expect(wraith).toEqual({
      ...brute,
      name: 'Wraith Lord',
      weight: 1,
      bodies: ['wraith'],
      teamBodies: undefined,
      height: [1.4, 1.4],
      width: [1.4, 1.4],
      weapon: 'Sledge Hammer',
      difficulty: 'Expert',
      mods: {},
      style: 'Aggressive',
      relics: ['Heavy Gauntlet'],
      boss: true,
    });
    expect(ft.troops[ft.boss[0]!]!.relics).toEqual([]);
    expect(ft.troops[ft.boss[1]!]!.style).toBe('Counter');
  });

  it('an elite Troop keeps its base (Mods included) and adds the template\'s Relics', () => {
    const t = delver.warbands[1]!.elite![1]!;
    t.troops.forEach((row, r) => {
      const e = ft.troops[ft.elite[1]![1]![r]!]!;
      const b = battle.troops[row.troop]!;
      expect(e).toEqual({ ...b, name: `${b.name} (elite)`, relics: t.relics });
      expect(e.mods).toBe(b.mods);
      expect(e.boss).toBeUndefined();
    });
  });

  it('is cached per (battle, delver) objects, and a changed Tuning gives its own list', () => {
    expect(floorTroops(battle, delver)).toBe(ft);
    const other = without(0);
    expect(floorTroops(battle, other)).not.toBe(ft);
    expect(floorTroops(battle, other)).toBe(floorTroops(battle, other));
    expect(floorTroops(battle, other).boss).toEqual([-1, base, base + 1]);
  });

  it('delverBattle carries them as the Floor\'s troops, and leaves battle.troops alone', () => {
    const b = delverBattle(tuning, { ...(Object.values(battle.maps)[0] ?? ({} as never)) });
    expect(b.troops).toBe(ft.troops);
    expect(battle.troops.length).toBe(base);
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
