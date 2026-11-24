import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { LAVA_KEEP } from './delver/plan';
import { flatFloors, noLava, noSetPieces } from './delver/flat.testdata';
import { arenaOf, deadly, surfaceHeight } from './arena';
import { floorNear } from './levels';
import { delverFloor } from './delver';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import { DROP_MARGIN, dropSpots, lootSlot, treasurePickups, warbandDrops, warbandLoot } from './delverLoot';
import { floorDuel } from './delverRun';
import { runSeed } from './dungeon';
import { createMatch, type MatchState } from './match';
import { createRng } from './rng';
import { BOSS, ELITE, PLAIN } from './warband';

const base = flatFloors(loadTuningData());
/** Three tiers of one Floor each: every Floor has its tier's Boss, and the elite posts hold elites. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 3, floorsPerTier: 1 } };
const ARENA = 'gen:greybox:4242';
const SEED = runSeed(ARENA);
const { drops, pedestals } = tuning.dungeon.loot;

/** Two Players (Fighters 0 and 1) and an AI ally (Fighter 2). */
const match = (): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
const { config } = match();
/** Floor `floor`'s Crowd, its plan and the Tuning Data it is stepped under. */
const floor = (f: number) => {
  const name = floorArenaName(SEED, f);
  return { crowd: floorDuel(tuning, config, f, null, createRng(1)).crowd!, plan: floorOf(tuning, name)!.plan, t: arenaTuning(tuning, name), arena: arenaOf(arenaTuning(tuning, name), name) };
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
    // A tier 1 elite's carried Relic drops at the tier's Rarity: Common.
    expect(eliteLoot[0]).toEqual({ kind: 'relic', item: { name: carried, rarity: 'Common' } });
    expect(eliteLoot).toHaveLength(1 + drops.Elite);

    const three = floor(3);
    const boss = three.crowd.warbands!.rank.indexOf(BOSS);
    expect(boss).toBeGreaterThanOrEqual(0);
    const bossLoot = warbandLoot(three.t, three.crowd, boss, 1, SEED, 3);
    expect(bossLoot[0]).toEqual({ kind: 'relic', item: { name: (() => { const b = three.t.delver.warbands[2]!.boss!; return three.t.delver.troops[b.prefab]!.variants[b.variant]!.relics[0]!; })(), rarity: 'Legendary' } });
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

describe('dropSpots on tiers, pits and daises (Stage 7c)', () => {
  const bundled = loadTuningData();
  const cases: { kind: string; at: { x: number; z: number; y: number }; plan: ReturnType<typeof floor>['plan']; arena: ReturnType<typeof floor>['arena']; t: TuningData }[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    for (const f of [1, 2, 4, 5]) {
      const name = floorArenaName(runSeed(`gen:greybox:${seed}`), f);
      const plan = floorOf(bundled, name)!.plan;
      const t = arenaTuning(bundled, name);
      const arena = arenaOf(t, name);
      for (const h of plan.halls) {
        const ft = h.feature;
        if (ft?.kind === 'split') {
          // A fall on the main tier half a metre inside its cut (the nearer one to an outer tier).
          const main = ft.tiers.find((q) => q.y === h.y)!;
          const r = main.rect;
          const at = ft.axis === 'x' ? { x: r.x0 + 0.5, z: h.cz, y: h.y } : { x: h.cx, z: r.z0 + 0.5, y: h.y };
          if (ft.tiers.length > 1 && ft.tiers.some((q) => q !== main)) cases.push({ kind: 'split', at, plan, arena, t });
          const outer = ft.tiers.find((q) => q !== main)!;
          cases.push({ kind: 'outer', at: { x: (outer.rect.x0 + outer.rect.x1) / 2, z: (outer.rect.z0 + outer.rect.z1) / 2, y: outer.y }, plan, arena, t });
        } else if (ft?.kind === 'pit') cases.push({ kind: 'pit', at: { x: h.cx, z: h.cz, y: h.y }, plan, arena, t });
        else if (ft?.kind === 'dais') cases.push({ kind: 'dais', at: { x: (ft.rect.x0 + ft.rect.x1) / 2, z: (ft.rect.z0 + ft.rect.z1) / 2, y: ft.y }, plan, arena, t });
      }
    }
  }

  it('lays every spot of a fall on a main tier near its cut, on an outer tier, on a pit\'s floor and on a dais on a Walk Surface that is neither deadly nor a roof', () => {
    for (const kind of ['split', 'outer', 'pit', 'dais']) expect(cases.filter((c) => c.kind === kind).length, kind).toBeGreaterThan(0);
    for (const c of cases) {
      const spots = dropSpots(c.plan, c.arena, c.t.battle.levels, c.at.x, c.at.z, c.at.y, 4);
      expect(spots).toHaveLength(4);
      for (const sp of spots) {
        const g = floorNear(c.arena, sp.x, sp.z, sp.y);
        expect(g, `${c.kind} spot (${sp.x}, ${sp.z})`).toBeGreaterThanOrEqual(0);
        const walk = c.arena.walk[g]!;
        expect(deadly(walk)).toBeFalsy();
        expect(walk.roof).toBeFalsy();
        expect(surfaceHeight(c.arena, g, sp.x, sp.z)).toBeCloseTo(sp.y, 6);
      }
      // The first spot lies at the fall's own height (the floor part it fell on).
      expect(spots[0]!.y).toBeCloseTo(c.at.y, 6);
    }
  }, 120_000);
});

describe('dropSpots', () => {
  const { plan, arena, t } = floor(1);
  const lv = t.battle.levels;
  const centre = (r: { x0: number; z0: number; x1: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

  it('lays up to three spots in a Hall, inside its shrunk rect and at least 1.1 m apart', () => {
    for (const hall of plan.halls) {
      const c = centre(hall.rect);
      for (const count of [1, 2, 3]) {
        const spots = dropSpots(plan, arena, lv, c.x, c.z, 0, count);
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
      const spots = dropSpots(plan, arena, lv, c.x, c.z, 0, 3);
      for (const s of spots) expect(inside(pass.rect, s)).toBe(true);
      expect(apart(spots)).toBe(true);
    }
  });

  it('lays a fall in a turning Passage\'s corner on its longest neighbouring leg: four spots, 1.1 m apart, all inside that Passage\'s pieces', () => {
    const t7 = base;
    let found = 0;
    for (let seed = 1; seed <= 12 && found < 4; seed++) {
      const name = floorArenaName(runSeed(`gen:greybox:${seed}`), 1);
      const p7 = floorOf(t7, name)!.plan;
      const at7 = arenaTuning(t7, name);
      const a7 = arenaOf(at7, name);
      for (const pass of p7.passages)
        for (const [k, piece] of pass.pieces.entries()) {
          if (!piece.corner) continue;
          const c = centre(piece.rect);
          if (p7.halls.some((h) => c.x >= h.rect.x0 && c.x <= h.rect.x1 && c.z >= h.rect.z0 && c.z <= h.rect.z1)) continue;
          const spots = dropSpots(p7, a7, at7.battle.levels, c.x, c.z, piece.y0, 4);
          expect(spots).toHaveLength(4);
          expect(apart(spots)).toBe(true);
          const len = (r: { x0: number; z0: number; x1: number; z1: number }) => Math.max(r.x1 - r.x0, r.z1 - r.z0);
          const legs = [pass.pieces[k - 1]!, pass.pieces[k + 1]!];
          const longest = len(legs[1]!.rect) > len(legs[0]!.rect) ? legs[1]! : legs[0]!;
          for (const s of spots) {
            expect(pass.pieces.some((q) => inside(q.rect, s))).toBe(true);
            expect(inside(longest.rect, s)).toBe(true);
          }
          found++;
        }
    }
    expect(found).toBeGreaterThan(0);
  }, 120_000);

  it('clamps a fall point in a wall corner, or outside every rect, to the nearest rect', () => {
    const hall = plan.halls[0]!;
    const corner = dropSpots(plan, arena, lv, hall.rect.x0, hall.rect.z0, 0, 1)[0]!;
    expect(corner).toEqual({ x: hall.rect.x0 + DROP_MARGIN, y: 0, z: hall.rect.z0 + DROP_MARGIN });
    const all = [...plan.halls.map((h) => h.rect), ...plan.passages.map((p) => p.rect)];
    const far = { x: Math.min(...all.map((r) => r.x0)) - 40, z: all[0]!.z0 };
    const spots = dropSpots(plan, arena, lv, far.x, far.z, 0, 3);
    for (const s of spots) expect(all.some((r) => inside(r, s))).toBe(true);
    expect(apart(spots)).toBe(true);
    expect(dropSpots(plan, arena, lv, far.x, far.z, 0, 3)).toEqual(spots);
  });

  it('reuses the spots found in turn when it needs more than it has room for, and gives none for none', () => {
    const c = centre(plan.halls[0]!.rect);
    const many = dropSpots(plan, arena, lv, c.x, c.z, 0, 40);
    expect(many).toHaveLength(40);
    expect(new Set(many.map((s) => `${s.x},${s.z}`)).size).toBeLessThan(40);
    expect(many[20]).toEqual(many[20 % new Set(many.map((s) => `${s.x},${s.z}`)).size]);
    expect(dropSpots(plan, arena, lv, c.x, c.z, 0, 0)).toEqual([]);
  });
});

describe('warbandDrops', () => {
  const { crowd, plan, t, arena } = floor(1);
  const q = crowd.warbands!.rank.indexOf(ELITE);
  const fall = { x: plan.halls[plan.entrance]!.cx, y: 0, z: plan.halls[plan.entrance]!.cz };

  it('lays one set for each present Player, on the same spots, with ids from firstId', () => {
    const drops = warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, 1, 5);
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
    expect(warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, 1, 5)).toEqual(drops);
  });

  it('gives an away Player nothing, and an AI ally nothing', () => {
    const away = warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, 1, 0, [1]);
    expect(away.every((d) => d.owner === 0)).toBe(true);
    expect(away.length).toBeGreaterThan(0);
    expect(warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, 1, 0, [0, 1])).toEqual([]);
    expect(warbandDrops(t, config, plan, arena, crowd, q, fall, SEED, 1, 0).some((d) => d.owner === 2)).toBe(false);
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

describe('dropSpots on a levelled Floor', () => {
  const real = loadTuningData();
  const found = Array.from({ length: 30 }, (_, k) => delverFloor(real, k + 1, 1));
  const lv = real.battle.levels;
  const centre = (r: { x0: number; z0: number; x1: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

  it('a fall on a sloped Passage lands every spot on its Ramp, never in the abyss under it', () => {
    const f = found.find((b) => b.plan.passages.some((p) => p.ya !== p.yb))!;
    expect(f).toBeDefined();
    const p = f.plan.passages.find((q) => q.ya !== q.yb)!;
    const lo = Math.min(p.ya, p.yb);
    const hi = Math.max(p.ya, p.yb);
    const c = centre(p.rect);
    const spots = dropSpots(f.plan, f.field.arena, lv, c.x, c.z, lo, 16);
    for (const s of spots) {
      expect(s.y).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(s.y).toBeLessThanOrEqual(hi + 1e-9);
      expect(s.y).toBeGreaterThanOrEqual(0);
    }
    // Spread along the Passage, so some lie more than a step over the fall.
    expect(Math.max(...spots.map((s) => s.y))).toBeGreaterThan(lo + lv.stepUp);
  });

  it('a spot that lands on a gallery Ramp gets the Ramp\'s height', () => {
    const f = found.find((b) => b.plan.halls.some((h) => h.gallery))!;
    expect(f).toBeDefined();
    const h = f.plan.halls.find((q) => q.gallery)!;
    const g = h.gallery!;
    const c = centre(g.ramp);
    const [spot] = dropSpots(f.plan, f.field.arena, lv, c.x, c.z, h.y, 1);
    expect(spot!.y).toBeGreaterThan(h.y + 0.5);
    expect(spot!.y).toBeLessThan(g.y);
    expect(spot!.y).toBeCloseTo((h.y + g.y) / 2, 6);
    // And a fall on the Deck lies on the Deck.
    const d = centre(g.deck);
    expect(dropSpots(f.plan, f.field.arena, lv, d.x, d.z, g.y, 1)[0]!.y).toBe(g.y);
  });
});

describe('dropSpots round pillars and in a shaped Hall (Stage 7b)', () => {
  const shaped = loadTuningData();
  const floors = Array.from({ length: 40 }, (_, k) => delverFloor(shaped, k + 1, 1 + (k % 3)));
  const lv = shaped.battle.levels;
  const near = (q: { x0: number; z0: number; x1: number; z1: number }, s: { x: number; z: number }) => Math.hypot(s.x - Math.min(q.x1, Math.max(q.x0, s.x)), s.z - Math.min(q.z1, Math.max(q.z0, s.z)));

  it('keeps every spot at least DROP_MARGIN from a pillar of the Hall, and inside its rects shrunk by the margin', () => {
    let found = 0;
    for (const f of floors)
      for (const hall of f.plan.halls) {
        const q = hall.pillars[0];
        if (!q) continue;
        // A fall 1.5 m off the pillar's west face, on the Hall's floor.
        const x = q.x0 - 1.5;
        const z = (q.z0 + q.z1) / 2;
        if (!hall.rects.some((r) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1)) continue;
        const spots = dropSpots(f.plan, f.field.arena, lv, x, z, 0, 6);
        expect(spots).toHaveLength(6);
        for (const s of spots) {
          for (const p of hall.pillars) expect(near(p, s)).toBeGreaterThanOrEqual(DROP_MARGIN - 1e-9);
          expect(hall.rects.some((r) => inside(r, s))).toBe(true);
        }
        found++;
      }
    expect(found).toBeGreaterThan(0);
  });

  it('keeps the spots of a fall in an L\'s arm in that arm\'s rect', () => {
    let found = 0;
    for (const f of floors)
      for (const hall of f.plan.halls) {
        if (hall.shape !== 'L') continue;
        for (const r of hall.rects) {
          const c = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
          const spots = dropSpots(f.plan, f.field.arena, lv, c.x, c.z, 0, 3);
          for (const s of spots) expect(inside(r, s)).toBe(true);
          found++;
        }
      }
    expect(found).toBeGreaterThan(0);
  });

  it('is never empty: a fall point wedged among pillars still gets its spot', () => {
    const f = floors.find((b) => b.plan.halls.some((h) => h.pillars.length > 0))!;
    const hall = f.plan.halls.find((h) => h.pillars.length > 0)!;
    const q = hall.pillars[0]!;
    const spots = dropSpots(f.plan, f.field.arena, lv, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, 0, 2);
    expect(spots).toHaveLength(2);
  });
});

describe('dropSpots and lava (Stage 7d)', () => {
  // Stage 7f's set pieces off (`noSetPieces`): these Floors were found on 7d's data.
  const shipped = noSetPieces(loadTuningData());
  const KEEP2 = LAVA_KEEP * LAVA_KEEP;
  /** Found by scanning seeds 1 to 40: Floors with a pit (10, 1), a river with one bridge (16, 1), a river with two (10, 5), a trough on one wall (1, 3) and on two (10, 3). */
  const FLOORS = [[10, 1, 'pit'], [16, 1, 'river'], [10, 5, 'river'], [1, 3, 'trough'], [10, 3, 'trough']] as const;
  const loaded = FLOORS.map(([seed, f, kind]) => {
    const name = floorArenaName(seed, f);
    const t = arenaTuning(shipped, name);
    const plan = floorOf(shipped, name)!.plan;
    return { kind, plan, t, arena: arenaOf(t, name), k: plan.halls.findIndex((h) => h.lava?.kind === kind) };
  });
  /** The squared ground distance (m) from (x, z) to the lava rect `q` seen from above, 0 over it. */
  const lavaGap2 = (q: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number) => {
    const dx = x - Math.min(q.x1, Math.max(q.x0, x));
    const dz = z - Math.min(q.z1, Math.max(q.z0, z));
    return dx * dx + dz * dz;
  };

  it('has the kinds the Floors were found for', () => {
    expect(loaded.map((c) => c.k >= 0)).toEqual([true, true, true, true, true]);
  });

  it('lays every spot at least LAVA_KEEP from the Hall\'s lava, on the Hall\'s floor, for a fall at the middle of each lava rect (count 1, 3 and 8)', () => {
    for (const { plan, t, arena, k, kind } of loaded) {
      const h = plan.halls[k]!;
      const lava = h.lava!;
      for (const q of lava.rects) {
        for (const count of [1, 3, 8]) {
          const spots = dropSpots(plan, arena, t.battle.levels, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, lava.y, count);
          expect(spots).toHaveLength(count);
          for (const s of spots) {
            for (const r of lava.rects) expect(lavaGap2(r, s.x, s.z), `${kind} ${h.id}`).toBeGreaterThanOrEqual(KEEP2 - 1e-9);
            const ground = floorNear(arena, s.x, s.z, h.y);
            expect(ground, `${kind} ${h.id} at ${s.x}, ${s.z}`).toBeGreaterThanOrEqual(0);
            expect(deadly(arena.walk[ground]!)).toBeFalsy();
            expect(s.y).toBeCloseTo(surfaceHeight(arena, ground, s.x, s.z), 9);
            expect(s.y).toBeCloseTo(h.y, 9);
            expect(h.rects.some((r) => s.x >= r.x0 && s.x <= r.x1 && s.z >= r.z0 && s.z <= r.z1)).toBe(true);
          }
        }
      }
    }
  });

  it('is pure: the same fall gives the same spots', () => {
    const { plan, t, arena, k } = loaded[1]!;
    const q = plan.halls[k]!.lava!.rects[0]!;
    const at = (x: number) => dropSpots(plan, arena, t.battle.levels, x, (q.z0 + q.z1) / 2, plan.halls[k]!.lava!.y, 5);
    expect(at(q.x0 + 1)).toEqual(at(q.x0 + 1));
  });

  it('lays spots in a lava Floor\'s Hall without lava, and on its Passages, as before: inside the rect, the first the point clamped in', () => {
    for (const { plan, t, arena } of loaded) {
      const k = plan.halls.findIndex((h, i) => i !== plan.entrance && !h.lava && h.rects.length === 1 && h.pillars.length === 0 && h.feature === undefined);
      const h = plan.halls[k]!;
      const r = h.rects[0]!;
      const spots = dropSpots(plan, arena, t.battle.levels, h.cx, h.cz, h.y, 3);
      expect(spots[0]).toEqual({ x: Math.min(r.x1 - DROP_MARGIN, Math.max(r.x0 + DROP_MARGIN, h.cx)), y: expect.any(Number), z: Math.min(r.z1 - DROP_MARGIN, Math.max(r.z0 + DROP_MARGIN, h.cz)) });
      for (const s of spots) expect(s.x >= r.x0 + DROP_MARGIN && s.x <= r.x1 - DROP_MARGIN && s.z >= r.z0 + DROP_MARGIN && s.z <= r.z1 - DROP_MARGIN).toBe(true);
      const piece = plan.passages[0]!.pieces[Math.floor(plan.passages[0]!.pieces.length / 2)]!.rect;
      const inPass = dropSpots(plan, arena, t.battle.levels, (piece.x0 + piece.x1) / 2, (piece.z0 + piece.z1) / 2, 0, 2);
      expect(inPass).toHaveLength(2);
    }
  });

  it('gives the same spots on a Floor without lava as the rect alone does', () => {
    const flat = noLava(shipped);
    const name = floorArenaName(10, 1);
    const f = floorOf(flat, name)!;
    const arena = arenaOf(arenaTuning(flat, name), name);
    const h = f.plan.halls.find((q) => q.rects.length === 1 && q.pillars.length === 0)!;
    const r = h.rects[0]!;
    const spots = dropSpots(f.plan, arena, flat.battle.levels, r.x0 - 3, h.cz, h.y, 1);
    expect(spots[0]!.x).toBeGreaterThanOrEqual(r.x0 + DROP_MARGIN);
  });

  it('warbandDrops lays a fall on lava off it', () => {
    const { crowd, t } = floor(1);
    const q = crowd.warbands!.rank.indexOf(ELITE);
    const { plan, arena, k } = loaded[0]!;
    const h = plan.halls[k]!;
    const r = h.lava!.rects[0]!;
    const drops = warbandDrops(t, config, plan, arena, crowd, q, { x: (r.x0 + r.x1) / 2, y: h.lava!.y, z: (r.z0 + r.z1) / 2 }, SEED, 1, 0);
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(lavaGap2(r, d.at.x, d.at.z)).toBeGreaterThanOrEqual(KEEP2 - 1e-9);
      expect(d.at.y).toBeCloseTo(h.y, 9);
    }
  });
});
