import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../../tuning';
import { groundOf } from '../battlefield';
import { BOSS, ELITE, GUARD, PATROL, PLAIN } from '../warband';
import type { FloorPlan } from './plan';
import { floorTroops } from './troops';
import { deployWarbands, warbandHomes, warbandPools, warbandsFit } from './warbands';
import { arenaTuning, floorArenaName, floorOf } from './world';
import { flatFloors } from './flat.testdata';

const tuning = flatFloors(loadTuningData());
const SEEDS = [1, 7, 42];
const TIMEOUT = 120_000;
/** The bundled Tuning with no elite posts: the Stage 3 tests that pin one Warband's Soldiers or HP to its template run on it. */
const noElites: TuningData = { ...tuning, delver: { ...tuning.delver, elitePosts: 0 } };

/** The Floor `floor` of Run `seed`: its Tuning Data (`arenaTuning`), plan and Battlefield, and the Crowd deployed for `humans`. */
function deal(seed: number, floor: number, humans = 1, base: TuningData = tuning) {
  const name = floorArenaName(seed, floor);
  const built = floorOf(base, name)!;
  const t = arenaTuning(base, name);
  return { t, plan: built.plan, field: built.field, crowd: deployWarbands(t, built.plan, built.field, seed, floor, humans) };
}

const FACINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
/** The index into `plan.markers.patrols[loop].halls` a patrol starts at: the first not a Fight Hall nor the Stairs', else 0. */
const startPoint = (plan: FloorPlan, loop: number): number => Math.max(0, plan.markers.patrols[loop]!.halls.findIndex((h) => plan.halls[h]!.kind !== 'Fight' && plan.halls[h]!.kind !== 'Stairs'));
const startHall = (plan: FloorPlan, loop: number): number => plan.markers.patrols[loop]!.halls[startPoint(plan, loop)]!;
const members = (crowd: ReturnType<typeof deal>['crowd'], q: number) => crowd.squad.map((s, i) => (s === q ? i : -1)).filter((i) => i >= 0);

describe('deployWarbands', { timeout: TIMEOUT }, () => {
  it('fills ceil(posts x postFill) posts and ceil(loops x patrolFill) loops, guards first in post order, then patrols in loop order', () => {
    for (const seed of SEEDS) {
      for (const floor of [1, 7]) {
        const { plan, crowd, t } = deal(seed, floor);
        const w = crowd.warbands!;
        const guards = Math.ceil((plan.markers.posts.length * t.delver.postFill) / 100);
        const patrols = Math.ceil((plan.markers.patrols.length * t.delver.patrolFill) / 100);
        expect(w.mode).toHaveLength(guards + patrols);
        expect(w.mode.slice(0, guards).every((m) => m === GUARD)).toBe(true);
        expect(w.mode.slice(guards).every((m) => m === PATROL)).toBe(true);
        const posts = w.post.slice(0, guards);
        const loops = w.patrol.slice(guards);
        expect(posts).toEqual([...posts].sort((a, b) => a - b));
        expect(new Set(posts).size).toBe(guards);
        expect(loops).toEqual([...loops].sort((a, b) => a - b));
        expect(new Set(loops).size).toBe(patrols);
        expect(w.post.slice(guards).every((p) => p === -1)).toBe(true);
        expect(w.patrol.slice(0, guards).every((p) => p === -1)).toBe(true);
        expect(crowd.squads.team).toHaveLength(guards + patrols);
      }
    }
  });

  it('stands each guard at its post facing the way the party comes, and each patrol at its start point facing its leg', () => {
    for (const seed of SEEDS) {
      for (const floor of [1, 7]) {
        const { plan, crowd } = deal(seed, floor);
        const w = crowd.warbands!;
        const homes = warbandHomes(plan);
        for (let q = 0; q < w.mode.length; q++) {
          const s = crowd.squads;
          if (w.mode[q] === GUARD) {
            const home = homes.posts[w.post[q]!]!;
            expect([s.x[q], s.z[q], s.heading[q], s.aim[q]]).toEqual([home.x, home.z, home.facing, home.facing]);
            expect(FACINGS).toContain(home.facing);
            expect(w.leg[q]).toBe(0);
          } else {
            const points = homes.patrols[w.patrol[q]!]!;
            const start = startPoint(plan, w.patrol[q]!);
            const leg = (start + 1) % points.length;
            expect(w.leg[q]).toBe(leg);
            expect([s.x[q], s.z[q]]).toEqual([points[start]!.x, points[start]!.z]);
            const dx = points[leg]!.x - points[start]!.x;
            const dz = points[leg]!.z - points[start]!.z;
            const facing = dx > 0 ? Math.PI / 2 : dx < 0 ? -Math.PI / 2 : dz > 0 ? 0 : Math.PI;
            expect(s.heading[q]).toBe(facing);
            expect(s.aim[q]).toBe(facing);
          }
          expect([s.speed[q], s.shape[q], s.fall[q], s.target[q], s.since[q], s.respawnAt[q], s.team[q]]).toEqual([0, 0, 0, -1, 0, -1, 1]);
          expect(s.order[q]).toBe(1);
          expect([w.chased[q], w.seen[q]]).toEqual([-1, -1]);
          expect(w.size[q]).toBe(s.living[q]);
          expect(w.size[q]).toBe(members(crowd, q).length);
        }
      }
    }
  });

  it('gives each Warband the Soldiers of its template, in list order, and stands them inside their Hall on the floor', () => {
    for (const seed of SEEDS) {
      for (const floor of [1, 7]) {
        const { plan, crowd, t, field } = deal(seed, floor, 1, noElites);
        const w = crowd.warbands!;
        const tier = t.delver.warbands[Math.ceil(floor / t.delver.floorsPerTier) - 1]!;
        for (let q = 0; q < w.mode.length; q++) {
          const template = (w.mode[q] === GUARD ? tier.guard : tier.patrol)[w.encounter[q]!]!;
          const expected = template.troops.flatMap((r) => new Array<number>(r.count).fill(r.troop));
          const ids = members(crowd, q);
          expect(ids.map((i) => crowd.troop[i])).toEqual(expected);
          expect(ids.map((i) => crowd.place[i])).toEqual(expected.map((_, p) => p));
          const hall = plan.halls[w.mode[q] === GUARD ? plan.markers.posts[w.post[q]!]!.hall : startHall(plan, w.patrol[q]!)]!;
          for (const i of ids) {
            expect(crowd.x[i]).toBeGreaterThan(hall.rect.x0);
            expect(crowd.x[i]).toBeLessThan(hall.rect.x1);
            expect(crowd.z[i]).toBeGreaterThan(hall.rect.z0);
            expect(crowd.z[i]).toBeLessThan(hall.rect.z1);
            expect(crowd.surface[i]).toBe(groundOf(t.battle, field, crowd.x[i]!, crowd.z[i]!, 0));
            expect(crowd.heading[i]).toBe(crowd.squads.heading[q]);
          }
        }
      }
    }
  });

  it('is plain Team 1 data: every Soldier living, unpromoted and untargeted, its arrays one long, none of the Battle-only parts', () => {
    const { crowd } = deal(7, 1);
    const n = crowd.x.length;
    expect(n).toBeGreaterThan(0);
    for (const key of ['z', 'surface', 'vx', 'vz', 'heading', 'hp', 'team', 'target', 'engage', 'alive', 'slot', 'sizeHeight', 'sizeThick', 'troop', 'look', 'squad', 'place', 'maxHp'] as const) {
      expect(crowd[key]).toHaveLength(n);
    }
    expect(crowd.team.every((v) => v === 1)).toBe(true);
    expect(crowd.alive.every((v) => v === 1)).toBe(true);
    expect(crowd.slot.every((v) => v === -1)).toBe(true);
    expect(crowd.target.every((v) => v === -1)).toBe(true);
    expect(crowd.vx.every((v) => v === 0) && crowd.vz.every((v) => v === 0) && crowd.engage.every((v) => v === 0)).toBe(true);
    expect(crowd.tickets).toEqual([0, 0]);
    expect(crowd.rout).toBeNull();
    expect(crowd.players).toEqual([]);
    expect(crowd.objectives.progress).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(crowd))).toEqual(crowd);
  });

  it('sizes each Soldier within its Troop\'s ranges and picks a look among its Bodies', () => {
    const { crowd, t } = deal(7, 7);
    for (let i = 0; i < crowd.x.length; i++) {
      const troop = t.battle.troops[crowd.troop[i]!]!;
      const [hlo, hhi] = troop.height ?? [1, 1];
      const [wlo, whi] = troop.width ?? [1, 1];
      // clampSize snaps to a step, so allow it.
      expect(crowd.sizeHeight[i]!).toBeGreaterThanOrEqual(hlo - 0.05);
      expect(crowd.sizeHeight[i]!).toBeLessThanOrEqual(hhi + 0.05);
      expect(crowd.sizeThick[i]!).toBeGreaterThanOrEqual(wlo - 0.05);
      expect(crowd.sizeThick[i]!).toBeLessThanOrEqual(whi + 0.05);
      expect(crowd.look[i]!).toBeGreaterThanOrEqual(0);
      expect(crowd.look[i]!).toBeLessThan((troop.teamBodies?.[1] ?? troop.bodies).length);
    }
  });

  it('makes each Warband perPlayerSoldiers x (humans - 1) bigger: the whole part, and the fraction as a seeded chance, held to squad.size', () => {
    for (const seed of SEEDS) {
      for (const floor of [1, 7]) {
        const base = deal(seed, floor, 1);
        const sizes = (humans: number) => deal(seed, floor, humans).crowd.warbands!.size;
        const solo = base.crowd.warbands!.size;
        const cap = base.t.battle.squad.size;
        expect(sizes(1)).toEqual(solo);
        // 1.5, 3 and 4.5 more per Warband for 2, 3 and 4 humans.
        for (const [humans, extra] of [[2, 1.5], [3, 3], [4, 4.5]] as const) {
          const bigger = sizes(humans);
          bigger.forEach((n, q) => {
            const lo = Math.min(cap, solo[q]! + Math.floor(extra));
            const hi = Math.min(cap, solo[q]! + Math.ceil(extra));
            expect(n).toBeGreaterThanOrEqual(lo);
            expect(n).toBeLessThanOrEqual(hi);
            if (Number.isInteger(extra)) expect(n).toBe(lo);
          });
        }
        // 4.5 more is a coin toss each, so across the Floor's Warbands both outcomes turn up.
        const four = sizes(4);
        const ups = four.filter((n, q) => n === Math.min(cap, solo[q]! + 5)).length;
        expect(ups).toBeGreaterThan(0);
        expect(ups).toBeLessThan(four.length);
      }
    }
  });

  it('adds the extras as the first Troop of the template, after the template\'s own Soldiers', () => {
    const { crowd, t } = deal(7, 7, 3, noElites);
    const w = crowd.warbands!;
    const tier = t.delver.warbands[2]!;
    for (let q = 0; q < w.mode.length; q++) {
      const template = (w.mode[q] === GUARD ? tier.guard : tier.patrol)[w.encounter[q]!]!;
      const own = template.troops.reduce((n, r) => n + r.count, 0);
      const ids = members(crowd, q);
      for (const i of ids.slice(own)) expect(crowd.troop[i]).toBe(template.troops[0]!.troop);
    }
  });

  it('holds a full template at squad.size however many humans', () => {
    const full = { ...tuning.delver, warbands: tuning.delver.warbands.map((tier) => ({ guard: tier.guard.map((g) => ({ ...g, troops: [{ troop: 0, count: tuning.battle.squad.size }] })), patrol: tier.patrol })) };
    const { crowd } = deal(7, 1, 4, { ...tuning, delver: full });
    const w = crowd.warbands!;
    for (let q = 0; q < w.mode.length; q++) if (w.mode[q] === GUARD) expect(w.size[q]).toBe(tuning.battle.squad.size);
  });

  it('scales HP by the template and the tier: floors 1, 4 and 7 are tiers 1, 2 and 3', () => {
    for (const [floor, tier] of [[1, 1], [4, 2], [7, 3]] as const) {
      const { crowd, t } = deal(7, floor, 1, noElites);
      expect(crowd.maxHp).toEqual(crowd.hp);
      expect(crowd.hp.length).toBeGreaterThan(0);
      crowd.hp.forEach((hp, i) => expect(hp).toBeCloseTo(t.battle.troops[crowd.troop[i]!]!.hp * t.delver.tierHp[tier - 1]!));
    }
    const doubled = { ...tuning.delver, warbands: tuning.delver.warbands.map((tier) => ({ guard: tier.guard.map((g) => ({ ...g, hpScale: 2 })), patrol: tier.patrol.map((p) => ({ ...p, hpScale: 2 })) })) };
    const { crowd, t } = deal(7, 4, 1, { ...tuning, delver: doubled });
    crowd.hp.forEach((hp, i) => expect(hp).toBeCloseTo(t.battle.troops[crowd.troop[i]!]!.hp * 2 * t.delver.tierHp[1]!));
  });

  it('deals the same Crowd for the same inputs, a different one for another seed or Floor', () => {
    const a = deal(42, 7, 2).crowd;
    const b = deployWarbands(deal(42, 7, 2).t, deal(42, 7, 2).plan, deal(42, 7, 2).field, 42, 7, 2);
    expect(b).toEqual(a);
    expect(deal(7, 7, 2).crowd).not.toEqual(a);
    expect(deal(42, 1, 2).crowd).not.toEqual(a);
  });

  it('seeds the Crowd\'s generator from the Run seed and the Floor', () => {
    expect(deal(7, 1).crowd.rng).not.toEqual(deal(7, 2).crowd.rng);
    expect(deal(7, 1).crowd.rng).not.toEqual(deal(1, 1).crowd.rng);
  });

  it('deploys nothing with postFill 0 and patrolFill 0: every array empty', () => {
    const bare = { ...tuning, delver: { ...tuning.delver, postFill: 0, patrolFill: 0 } };
    const { crowd } = deal(7, 1, 3, bare);
    for (const [key, value] of Object.entries(crowd)) {
      if (key === 'squads' || key === 'warbands') for (const arr of Object.values(value as Record<string, unknown[]>)) expect(arr).toHaveLength(0);
      else if (Array.isArray(value) && key !== 'tickets') expect(value, key).toHaveLength(0);
    }
    expect(crowd.maxHp).toEqual([]);
  });

  it('fills only a share of the posts when postFill is lower, and none of the loops at patrolFill 0', () => {
    const half = { ...tuning, delver: { ...tuning.delver, postFill: 50, patrolFill: 0 } };
    const { crowd, plan } = deal(7, 1, 1, half);
    expect(crowd.warbands!.mode).toHaveLength(Math.ceil(plan.markers.posts.length / 2));
    expect(crowd.warbands!.mode.every((m) => m === GUARD)).toBe(true);
  });
});

describe('warbandHomes', { timeout: TIMEOUT }, () => {
  it('is the same object for the same plan, with a home for every post and loop point', () => {
    const { plan } = deal(7, 1);
    const homes = warbandHomes(plan);
    expect(warbandHomes(plan)).toBe(homes);
    expect(homes.posts).toHaveLength(plan.markers.posts.length);
    expect(homes.patrols.map((p) => p.length)).toEqual(plan.markers.patrols.map((p) => p.points.length));
  });

  /** A hand-built plan: Hall 0 with Passages to Hall 1 (east, depth 8), Hall 2 (north, depth 5), Hall 3 (south, depth 5), Hall 4 (west, depth 2); Hall 5 has none. */
  const hand = (passages: [axis: 'x' | 'z', a: number, b: number][], depths: number[]): FloorPlan =>
    ({
      halls: depths.map((depth) => ({ depth, kind: 'Fight' })),
      passages: passages.map(([axis, a, b]) => ({ axis, a, b })),
      markers: { posts: [{ hall: 0, x: 3, z: 4 }], patrols: [] },
    }) as unknown as FloorPlan;

  it('faces a guard toward the side whose Passage leads to the Hall of least depth', () => {
    const depths = [6, 8, 5, 5, 2, 9];
    // East only: east.
    expect(warbandHomes(hand([['x', 0, 1]], depths)).posts[0]).toEqual({ x: 3, z: 4, facing: Math.PI / 2 });
    // North (5) and east (8): north. North is Passage 'z' with Hall 0 the `a`.
    expect(warbandHomes(hand([['x', 0, 1], ['z', 0, 2]], depths)).posts[0]!.facing).toBe(0);
    // South (5, Hall 3 is `a` of a 'z' Passage) alone: south.
    expect(warbandHomes(hand([['x', 0, 1], ['z', 3, 0]], depths)).posts[0]!.facing).toBe(Math.PI);
    // North and south tie at 5: the earlier side, north.
    expect(warbandHomes(hand([['z', 3, 0], ['z', 0, 2]], depths)).posts[0]!.facing).toBe(0);
    // West (2, Hall 4 is `a` of an 'x' Passage) is the least of all.
    expect(warbandHomes(hand([['x', 0, 1], ['z', 0, 2], ['z', 3, 0], ['x', 4, 0]], depths)).posts[0]!.facing).toBe(-Math.PI / 2);
    // No Passage at all: 0. A Passage elsewhere does not count.
    expect(warbandHomes(hand([['x', 5, 4]], depths)).posts[0]!.facing).toBe(0);
  });
});

/** The bundled Tuning with every tier's elite templates wearing Vital Charm (+20% max HP), so the Relic share shows in an elite's HP. */
const charmed: TuningData = {
  ...tuning,
  delver: { ...tuning.delver, warbands: tuning.delver.warbands.map((tier) => ({ ...tier, elite: (tier.elite ?? []).map((e) => ({ ...e, relics: ['Vital Charm'] })) })) },
};
/** The bundled Tuning with every tier's elite pool emptied: no elite is ever dealt. */
const emptyPools: TuningData = { ...tuning, delver: { ...tuning.delver, warbands: tuning.delver.warbands.map((tier) => ({ ...tier, elite: [] })) } };
/** The guards of a Floor's plan posts (every guard but the Boss's), as Warband indices. */
const guardsOf = (crowd: ReturnType<typeof deal>['crowd'], plan: FloorPlan): number[] => crowd.warbands!.post.flatMap((p, q) => (p >= 0 && p < plan.markers.posts.length ? [q] : []));

describe('elite Warbands', { timeout: TIMEOUT }, () => {
  it('puts the elite at the deepest filled post, at rank 1, its Soldiers of that template\'s elite Troops', () => {
    for (const seed of SEEDS) {
      for (const floor of [1, 4, 7]) {
        const { plan, crowd, t } = deal(seed, floor);
        const w = crowd.warbands!;
        const guards = guardsOf(crowd, plan);
        const depth = (q: number) => plan.halls[plan.markers.posts[w.post[q]!]!.hall]!.depth;
        const deepest = guards.reduce((best, q) => (depth(q) > depth(best) ? q : best));
        expect(guards.filter((q) => w.rank[q] === ELITE)).toEqual([deepest]);
        expect(w.rank.filter((r) => r === ELITE)).toHaveLength(1);
        const tier = Math.ceil(floor / t.delver.floorsPerTier);
        const elite = t.delver.warbands[tier - 1]!.elite![w.encounter[deepest]!]!;
        const rows = floorTroops(tuning.battle, tuning.delver).elite[tier - 1]![w.encounter[deepest]!]!;
        const expected = elite.troops.flatMap((r, k) => new Array<number>(r.count).fill(rows[k]!));
        expect(members(crowd, deepest).map((i) => crowd.troop[i])).toEqual(expected);
        for (const i of members(crowd, deepest)) expect(t.battle.troops[crowd.troop[i]!]!.relics).toEqual(elite.relics);
      }
    }
  });

  it('takes the elite pick from the elite pool, and gives an elite\'s Soldiers its Relics\' max HP share on top of template and tier', () => {
    const { plan, crowd, t } = deal(7, 4, 1, charmed);
    const w = crowd.warbands!;
    const q = guardsOf(crowd, plan).find((k) => w.rank[k] === ELITE)!;
    const tier = t.delver.warbands[1]!;
    const template = tier.elite![w.encounter[q]!]!;
    expect(w.encounter[q]).toBeLessThan(tier.elite!.length);
    for (const i of members(crowd, q)) {
      const troop = t.battle.troops[crowd.troop[i]!]!;
      expect(crowd.hp[i]).toBeCloseTo(troop.hp * template.hpScale * t.delver.tierHp[1]! * 1.2);
      expect(crowd.maxHp![i]).toBe(crowd.hp[i]);
    }
  });

  it('gives the party\'s extras the first row\'s elite Troop', () => {
    const { plan, crowd } = deal(7, 4, 4);
    const w = crowd.warbands!;
    const q = guardsOf(crowd, plan).find((k) => w.rank[k] === ELITE)!;
    const ids = members(crowd, q);
    const own = tuning.delver.warbands[1]!.elite![w.encounter[q]!]!.troops.reduce((n, r) => n + r.count, 0);
    expect(ids.length).toBeGreaterThan(own);
    for (const i of ids.slice(own)) expect(crowd.troop[i]).toBe(crowd.troop[ids[0]!]);
  });

  it('deals no elite at elitePosts 0, and the same Crowd as with every elite pool empty', () => {
    for (const seed of SEEDS) {
      for (const floor of [1, 4, 7]) {
        const none = deal(seed, floor, 2, noElites).crowd;
        expect(none.warbands!.rank.every((r) => r === PLAIN)).toBe(true);
        expect(none).toEqual(deal(seed, floor, 2, emptyPools).crowd);
      }
    }
  });

  it('leaves every other Warband\'s template, post and Soldiers\' Troops and HP as without elites', () => {
    for (const seed of SEEDS) {
      const plain = deal(seed, 4, 1, noElites).crowd;
      const { crowd } = deal(seed, 4);
      const w = crowd.warbands!;
      expect(w.post).toEqual(plain.warbands!.post);
      expect(w.patrol).toEqual(plain.warbands!.patrol);
      expect(w.mode).toEqual(plain.warbands!.mode);
      for (let q = 0; q < w.mode.length; q++) {
        if (w.rank[q] === ELITE) continue;
        expect(w.encounter[q]).toBe(plain.warbands!.encounter[q]);
        expect(members(crowd, q).map((i) => crowd.troop[i])).toEqual(members(plain, q).map((i) => plain.troop[i]));
        expect(members(crowd, q).map((i) => crowd.hp[i])).toEqual(members(plain, q).map((i) => plain.hp[i]));
      }
    }
  });

  it('holds no elite at all in a tier with no elite pool', () => {
    const { crowd } = deal(7, 4, 1, emptyPools);
    expect(crowd.warbands!.rank.every((r) => r === PLAIN)).toBe(true);
  });
});

describe('the Boss Warband', { timeout: TIMEOUT }, () => {
  const bossOf = (crowd: ReturnType<typeof deal>['crowd']) => crowd.warbands!.rank.indexOf(BOSS);

  it('is the last Warband of a Boss Floor, rank 2 at the post after the plan\'s, a guard in GUARD', () => {
    for (const seed of SEEDS) {
      const { plan, crowd } = deal(seed, 3);
      const w = crowd.warbands!;
      const q = bossOf(crowd);
      expect(plan.markers.boss).toBeDefined();
      expect(q).toBe(w.mode.length - 1);
      expect(w.rank.filter((r) => r === BOSS)).toHaveLength(1);
      expect(w.post[q]).toBe(plan.markers.posts.length);
      expect(w.patrol[q]).toBe(-1);
      expect(w.mode[q]).toBe(GUARD);
      const at = warbandHomes(plan).posts[plan.markers.posts.length]!;
      expect(crowd.squads.x[q]).toBe(at.x);
      expect(crowd.squads.z[q]).toBe(at.z);
    }
  });

  it('opens with the Boss Soldier of the tier\'s Boss Troop, 250 HP for tier 1, in its fixed Size, then its guard\'s rows', () => {
    for (const seed of SEEDS) {
      const { crowd, t } = deal(seed, 3);
      const q = bossOf(crowd);
      const ids = members(crowd, q);
      const boss = t.delver.warbands[0]!.boss!;
      const index = floorTroops(tuning.battle, tuning.delver).boss[0]!;
      expect(crowd.troop[ids[0]!]).toBe(index);
      expect(t.battle.troops[index]!.name).toBe(boss.troop.name);
      expect(crowd.hp[ids[0]!]).toBeCloseTo(250);
      expect(crowd.maxHp![ids[0]!]).toBe(crowd.hp[ids[0]!]);
      expect(crowd.sizeHeight[ids[0]!]).toBeCloseTo(boss.troop.height);
      expect(crowd.sizeThick[ids[0]!]).toBeCloseTo(boss.troop.width);
      expect(crowd.look[ids[0]!]).toBe(0);
      expect(crowd.place[ids[0]!]).toBe(0);
      const guard = boss.guard[crowd.warbands!.encounter[q]!]!;
      const rows = guard.troops.flatMap((r) => new Array<number>(r.count).fill(r.troop));
      expect(ids.slice(1).map((i) => crowd.troop[i])).toEqual(rows);
      ids.slice(1).forEach((i, k) => expect(crowd.hp[i]).toBeCloseTo(t.battle.troops[rows[k]!]!.hp * guard.hpScale * t.delver.tierHp[0]!));
    }
  });

  it('adds the party\'s extras as the guard\'s first Troop for 4 humans, never a second Boss, held to the Squad size', () => {
    for (const seed of SEEDS) {
      const { crowd, t } = deal(seed, 3, 4);
      const q = bossOf(crowd);
      const ids = members(crowd, q);
      const guard = t.delver.warbands[0]!.boss!.guard[crowd.warbands!.encounter[q]!]!;
      const own = guard.troops.reduce((n, r) => n + r.count, 0);
      expect(ids.length).toBeGreaterThan(1 + own);
      expect(ids.length).toBeLessThanOrEqual(t.battle.squad.size);
      for (const i of ids.slice(1 + own)) expect(crowd.troop[i]).toBe(guard.troops[0]!.troop);
      expect(crowd.troop.filter((tr) => t.battle.troops[tr]!.boss === true)).toHaveLength(1);
    }
  });

  it('adds the Relic share of the Boss Troop\'s Relics to its Soldier\'s HP', () => {
    const vital: TuningData = { ...tuning, delver: { ...tuning.delver, warbands: tuning.delver.warbands.map((tier) => ({ ...tier, boss: { ...tier.boss!, troop: { ...tier.boss!.troop, relics: ['Vital Charm'] } } })) } };
    const { crowd } = deal(7, 3, 1, vital);
    const q = bossOf(crowd);
    expect(crowd.hp[members(crowd, q)[0]!]).toBeCloseTo(250 * 1.2);
  });

  it('gives the Boss\'s guard Soldiers none of the Boss Troop\'s Relic share', () => {
    const vital: TuningData = { ...tuning, delver: { ...tuning.delver, warbands: tuning.delver.warbands.map((tier) => ({ ...tier, boss: { ...tier.boss!, troop: { ...tier.boss!.troop, relics: ['Vital Charm'] } } })) } };
    const { crowd, t } = deal(7, 3, 1, vital);
    const q = bossOf(crowd);
    const ids = members(crowd, q);
    const guard = t.delver.warbands[0]!.boss!.guard[crowd.warbands!.encounter[q]!]!;
    expect(ids.length).toBeGreaterThan(1);
    for (const i of ids.slice(1)) expect(crowd.hp[i]).toBeCloseTo(t.battle.troops[crowd.troop[i]!]!.hp * guard.hpScale * t.delver.tierHp[0]!);
  });

  it('deals none on a non-Boss Floor, and the same Crowd as a Tuning with no Boss (elites aside)', () => {
    const bossless: TuningData = { ...noElites, delver: { ...noElites.delver, warbands: noElites.delver.warbands.map(({ boss: _b, ...tier }) => tier) } };
    for (const seed of SEEDS) {
      for (const floor of [1, 2]) {
        const a = deal(seed, floor, 2, noElites).crowd;
        expect(a.warbands!.rank.includes(BOSS)).toBe(false);
        expect(a).toEqual(deal(seed, floor, 2, bossless).crowd);
      }
    }
  });

  it('puts the Boss post in warbandHomes only on a Boss Floor', () => {
    for (const seed of SEEDS) {
      const boss = deal(seed, 3).plan;
      const homes = warbandHomes(boss);
      expect(homes.posts).toHaveLength(boss.markers.posts.length + 1);
      expect(homes.posts[boss.markers.posts.length]).toMatchObject({ x: boss.markers.boss!.x, z: boss.markers.boss!.z });
      const plain = deal(seed, 2).plan;
      expect(plain.markers.boss).toBeUndefined();
      expect(warbandHomes(plain).posts).toHaveLength(plain.markers.posts.length);
    }
  });
});

describe('warbandsFit and rank', { timeout: TIMEOUT }, () => {
  const fitOf = (seed: number, floor: number) => {
    const { plan, crowd, t } = deal(seed, floor);
    const pools = warbandPools(t.delver, floor);
    const fits = (c: typeof crowd) => warbandsFit(c, plan, 1, t.battle.troops.length, pools);
    const withRank = (rank: (r: number, q: number) => number, extra: Partial<NonNullable<typeof crowd.warbands>> = {}) => ({ ...crowd, warbands: { ...crowd.warbands!, ...extra, rank: crowd.warbands!.rank.map(rank) } });
    return { plan, crowd, fits, withRank };
  };

  it('accepts what a Boss Floor and an ordinary Floor deal', () => {
    for (const [seed, floor] of [[7, 3], [7, 1], [42, 6]] as const) expect(fitOf(seed, floor).fits(fitOf(seed, floor).crowd), `${seed}/${floor}`).toBe(true);
  });

  it('refuses a rank array of the wrong length, and a rank outside 0 to 2', () => {
    const { crowd, fits, withRank } = fitOf(7, 3);
    expect(fits({ ...crowd, warbands: { ...crowd.warbands!, rank: crowd.warbands!.rank.slice(1) } })).toBe(false);
    expect(fits(withRank((r, q) => (q === 0 ? 3 : r)))).toBe(false);
    expect(fits(withRank((r, q) => (q === 0 ? -1 : r)))).toBe(false);
    expect(fits(withRank((r, q) => (q === 0 ? 0.5 : r)))).toBe(false);
  });

  it('refuses two Bosses', () => {
    const { crowd, fits, withRank } = fitOf(7, 3);
    const guards = crowd.warbands!.post.flatMap((p, q) => (p >= 0 ? [q] : []));
    expect(guards.length).toBeGreaterThan(1);
    expect(fits(withRank((r, q) => (q === guards[0] || q === guards[guards.length - 1] ? 2 : r)))).toBe(false);
  });

  it('refuses a Boss Floor with no Boss, and a Boss on an ordinary Floor', () => {
    const boss = fitOf(7, 3);
    expect(boss.fits(boss.withRank((r) => (r === BOSS ? PLAIN : r)))).toBe(false);
    const plain = fitOf(7, 1);
    expect(plain.crowd.warbands!.rank.includes(BOSS)).toBe(false);
    expect(plain.fits(plain.crowd)).toBe(true);
  });

  it('refuses a Boss on an ordinary post, a Boss on a patrol, and a Boss on a Floor with no Boss Hall', () => {
    const boss = fitOf(7, 3);
    const w = boss.crowd.warbands!;
    const ordinary = w.post.findIndex((p) => p >= 0 && p < boss.plan.markers.posts.length);
    expect(boss.fits(boss.withRank((r, q) => (q === ordinary ? 2 : q === w.rank.indexOf(2) ? 0 : r)))).toBe(false);
    const patrol = w.patrol.findIndex((p) => p >= 0);
    expect(boss.fits(boss.withRank((r, q) => (q === patrol ? 2 : q === w.rank.indexOf(2) ? 0 : r)))).toBe(false);
    const plain = fitOf(7, 1);
    expect(plain.fits(plain.withRank((r, q) => (q === 0 ? 2 : r)))).toBe(false);
  });

  it('refuses an elite on a patrol, and an encounter beyond its rank\'s pool', () => {
    const { crowd, fits, withRank } = fitOf(7, 4);
    const w = crowd.warbands!;
    const patrol = w.patrol.findIndex((p) => p >= 0);
    expect(fits(withRank((r, q) => (q === patrol ? 1 : r)))).toBe(false);
    const elite = w.rank.indexOf(1);
    const pool = tuning.delver.warbands[1]!.elite!.length;
    expect(fits({ ...crowd, warbands: { ...w, encounter: w.encounter.map((e, q) => (q === elite ? pool : e)) } })).toBe(false);
    const guard = w.post.findIndex((p, q) => p >= 0 && w.rank[q] === 0);
    expect(fits({ ...crowd, warbands: { ...w, encounter: w.encounter.map((e, q) => (q === guard ? tuning.delver.warbands[1]!.guard.length : e)) } })).toBe(false);
    const bossFloor = fitOf(7, 3);
    const b = bossFloor.crowd.warbands!;
    const at = b.rank.indexOf(2);
    expect(bossFloor.fits({ ...bossFloor.crowd, warbands: { ...b, encounter: b.encounter.map((e, q) => (q === at ? tuning.delver.warbands[0]!.boss!.guard.length : e)) } })).toBe(false);
  });
});
