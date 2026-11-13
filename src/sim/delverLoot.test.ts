import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import { DROP_MARGIN, dropSpots, lootSlot, treasurePickups, warbandDrops, warbandLoot } from './delverLoot';
import { floorDuel } from './delverRun';
import { runSeed } from './dungeon';
import { createMatch, type MatchState } from './match';
import { createRng } from './rng';
import { BOSS, ELITE, PLAIN } from './warband';

const base = loadTuningData();
/** Three tiers of one Floor each: every Floor has its tier's Boss, and the elite posts hold elites. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 3, floorsPerTier: 1 } };
const ARENA = 'gen:greybox:4242';
const SEED = runSeed(ARENA);
const { drops, pedestals } = tuning.dungeon.loot;

/** Two Players (Fighters 0 and 1) and an AI ally (Fighter 2). */
const match = (): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
const { config } = match();
/** Floor `floor`'s Crowd, its plan and the Tuning Data it is stepped under. */
const floor = (f: number) => {
  const name = floorArenaName(SEED, f);
  return { crowd: floorDuel(tuning, config, f, null, createRng(1)).crowd!, plan: floorOf(tuning, name)!.plan, t: arenaTuning(tuning, name) };
};

describe('lootSlot', () => {
  it('is one number for each (source, index, Player, k) and throws out of range', () => {
    const seen = new Set<number>();
    for (const source of [0, 1] as const) for (let index = 0; index < 6; index++) for (let player = 0; player < 4; player++) for (let k = 0; k < 16; k++) seen.add(lootSlot(source, index, player, k));
    expect(seen.size).toBe(2 * 6 * 4 * 16);
    expect(lootSlot(0, 0, 0, 0)).toBe(0);
    expect(lootSlot(1, 2, 3, 5)).toBe(((2 * 4 + 3) * 16 + 5) * 2 + 1);
    expect(() => lootSlot(0, 0, 0, 16)).toThrow(RangeError);
    expect(() => lootSlot(0, 0, 0, -1)).toThrow(RangeError);
    expect(() => lootSlot(0, 0, 4, 0)).toThrow(RangeError);
    expect(() => lootSlot(1, 0, -1, 0)).toThrow(RangeError);
  });
});

describe('warbandLoot', () => {
  it('gives the same items twice, and differs between Players over several Warbands', () => {
    const { crowd, t } = floor(1);
    const qs = crowd.warbands!.rank.map((_, q) => q);
    expect(qs.length).toBeGreaterThan(2);
    for (const q of qs) expect(warbandLoot(t, crowd, q, 0, SEED, 1)).toEqual(warbandLoot(t, crowd, q, 0, SEED, 1));
    const differs = [1, 2, 3].some((f) => {
      const c = floor(f);
      return c.crowd.warbands!.rank.some((_, q) => JSON.stringify(warbandLoot(c.t, c.crowd, q, 0, SEED, f)) !== JSON.stringify(warbandLoot(c.t, c.crowd, q, 1, SEED, f)));
    });
    expect(differs).toBe(true);
  });

  it('gives a plain Warband Fight items, an elite its Relic then Elite items, and the Boss its Relic then Boss items', () => {
    const one = floor(1);
    const plain = one.crowd.warbands!.rank.indexOf(PLAIN);
    expect(plain).toBeGreaterThanOrEqual(0);
    expect(warbandLoot(one.t, one.crowd, plain, 0, SEED, 1)).toHaveLength(drops.Fight);

    const elite = one.crowd.warbands!.rank.indexOf(ELITE);
    expect(elite).toBeGreaterThanOrEqual(0);
    const carried = one.t.delver.warbands[0]!.elite![one.crowd.warbands!.encounter[elite]!]!.relics[0]!;
    const eliteLoot = warbandLoot(one.t, one.crowd, elite, 0, SEED, 1);
    expect(eliteLoot[0]).toEqual({ kind: 'relic', item: carried });
    expect(eliteLoot).toHaveLength(1 + drops.Elite);

    const three = floor(3);
    const boss = three.crowd.warbands!.rank.indexOf(BOSS);
    expect(boss).toBeGreaterThanOrEqual(0);
    const bossLoot = warbandLoot(three.t, three.crowd, boss, 1, SEED, 3);
    expect(bossLoot[0]).toEqual({ kind: 'relic', item: three.t.delver.warbands[2]!.boss!.troop.relics[0]! });
    expect(bossLoot).toHaveLength(1 + drops.Boss);
    // The Boss of tier 1 carries nothing: only its picks.
    const first = floor(1);
    expect(warbandLoot(first.t, first.crowd, first.crowd.warbands!.rank.indexOf(BOSS), 0, SEED, 1)).toHaveLength(drops.Boss);
  });
});

/** Whether (x, z) lies in `r` shrunk by DROP_MARGIN (edges included, a float's slack). */
const inside = (r: { x0: number; z0: number; x1: number; z1: number }, s: { x: number; z: number }): boolean => {
  const e = 1e-9;
  const mx = Math.min(DROP_MARGIN, (r.x1 - r.x0) / 2);
  const mz = Math.min(DROP_MARGIN, (r.z1 - r.z0) / 2);
  return s.x >= r.x0 + mx - e && s.x <= r.x1 - mx + e && s.z >= r.z0 + mz - e && s.z <= r.z1 - mz + e;
};
const apart = (spots: readonly { x: number; z: number }[]): boolean => spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) >= 1.1 - 1e-9));

describe('dropSpots', () => {
  const { plan } = floor(1);
  const centre = (r: { x0: number; z0: number; x1: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

  it('lays up to three spots in a Hall, inside its shrunk rect and at least 1.1 m apart', () => {
    for (const hall of plan.halls) {
      const c = centre(hall.rect);
      for (const count of [1, 2, 3]) {
        const spots = dropSpots(plan, c.x, c.z, count);
        expect(spots).toHaveLength(count);
        for (const s of spots) {
          expect(s.y).toBe(0);
          expect(inside(hall.rect, s)).toBe(true);
        }
        expect(apart(spots)).toBe(true);
      }
    }
  });

  it('does the same in a Passage, along its longer side', () => {
    for (const pass of plan.passages) {
      const c = centre(pass.rect);
      const spots = dropSpots(plan, c.x, c.z, 3);
      for (const s of spots) expect(inside(pass.rect, s)).toBe(true);
      expect(apart(spots)).toBe(true);
    }
  });

  it('clamps a fall point in a wall corner, or outside every rect, to the nearest rect', () => {
    const hall = plan.halls[0]!;
    const corner = dropSpots(plan, hall.rect.x0, hall.rect.z0, 1)[0]!;
    expect(corner).toEqual({ x: hall.rect.x0 + DROP_MARGIN, y: 0, z: hall.rect.z0 + DROP_MARGIN });
    const all = [...plan.halls.map((h) => h.rect), ...plan.passages.map((p) => p.rect)];
    const far = { x: Math.min(...all.map((r) => r.x0)) - 40, z: all[0]!.z0 };
    const spots = dropSpots(plan, far.x, far.z, 3);
    for (const s of spots) expect(all.some((r) => inside(r, s))).toBe(true);
    expect(apart(spots)).toBe(true);
    expect(dropSpots(plan, far.x, far.z, 3)).toEqual(spots);
  });

  it('reuses the spots found in turn when it needs more than it has room for, and gives none for none', () => {
    const c = centre(plan.halls[0]!.rect);
    const many = dropSpots(plan, c.x, c.z, 40);
    expect(many).toHaveLength(40);
    expect(new Set(many.map((s) => `${s.x},${s.z}`)).size).toBeLessThan(40);
    expect(many[20]).toEqual(many[20 % new Set(many.map((s) => `${s.x},${s.z}`)).size]);
    expect(dropSpots(plan, c.x, c.z, 0)).toEqual([]);
  });
});

describe('warbandDrops', () => {
  const { crowd, plan, t } = floor(1);
  const q = crowd.warbands!.rank.indexOf(ELITE);
  const fall = { x: plan.halls[plan.entrance]!.cx, z: plan.halls[plan.entrance]!.cz };

  it('lays one set for each present Player, on the same spots, with ids from firstId', () => {
    const drops = warbandDrops(t, config, plan, crowd, q, fall, SEED, 1, 5);
    const each = warbandLoot(t, crowd, q, 0, SEED, 1).length;
    expect(drops).toHaveLength(2 * each);
    expect(drops.map((d) => d.id)).toEqual(drops.map((_, k) => 5 + k));
    expect(drops.map((d) => d.owner)).toEqual([...Array<number>(each).fill(0), ...Array<number>(each).fill(1)]);
    expect(drops.every((d) => !d.taken && d.group === undefined)).toBe(true);
    for (let k = 0; k < each; k++) expect(drops[each + k]!.at).toEqual(drops[k]!.at);
    for (const p of [0, 1]) {
      const items = drops.filter((d) => d.owner === p).map(({ kind, item }) => ({ kind, item }));
      expect(items).toEqual(warbandLoot(t, crowd, q, p, SEED, 1));
    }
    expect(warbandDrops(t, config, plan, crowd, q, fall, SEED, 1, 5)).toEqual(drops);
  });

  it('gives an away Player nothing, and an AI ally nothing', () => {
    const away = warbandDrops(t, config, plan, crowd, q, fall, SEED, 1, 0, [1]);
    expect(away.every((d) => d.owner === 0)).toBe(true);
    expect(away.length).toBeGreaterThan(0);
    expect(warbandDrops(t, config, plan, crowd, q, fall, SEED, 1, 0, [0, 1])).toEqual([]);
    expect(warbandDrops(t, config, plan, crowd, q, fall, SEED, 1, 0).some((d) => d.owner === 2)).toBe(false);
  });
});

describe('treasurePickups', () => {
  const { plan } = floor(1);

  it('stands three pedestals for each Player on the Hall\'s three markers, one group each', () => {
    const halls = plan.markers.pedestals.length / 3;
    expect(halls).toBeGreaterThan(0);
    const all = treasurePickups(tuning, config, plan, SEED, 1);
    expect(all).toHaveLength(halls * 2 * pedestals);
    expect(all.map((p) => p.id)).toEqual(all.map((_, k) => k));
    for (let t = 0; t < halls; t++) {
      const markers = plan.markers.pedestals.slice(3 * t, 3 * t + 3);
      for (const [n, owner] of [0, 1].entries()) {
        const mine = all.slice((t * 2 + n) * pedestals, (t * 2 + n + 1) * pedestals);
        expect(mine.every((p) => p.owner === owner && p.group === mine[0]!.id && !p.taken)).toBe(true);
        expect(mine.map((p) => p.at)).toEqual(Array.from({ length: pedestals }, (_, k) => ({ x: markers[k % 3]!.x, y: 0, z: markers[k % 3]!.z })));
      }
    }
  });

  it('leaves an away Player\'s out, and is the same every time', () => {
    const away = treasurePickups(tuning, config, plan, SEED, 1, [1]);
    expect(away.length).toBeGreaterThan(0);
    expect(away.every((p) => p.owner === 0)).toBe(true);
    expect(away.map((p) => p.id)).toEqual(away.map((_, k) => k));
    expect(treasurePickups(tuning, config, plan, SEED, 1)).toEqual(treasurePickups(tuning, config, plan, SEED, 1));
  });
});
