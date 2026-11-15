import { beforeAll, describe, expect, it } from 'vitest';
import { checkMap } from '../../mapEditor/checks';
import { MapCompileError, mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { arenaOf, deadly, surfaceHeight } from '../arena';
import { groundOf } from '../battlefield';
import { floorNear } from '../levels';
import { navMesh, SHORTCUT_RISE, type JumpLink } from '../nav';
import { flatRooms, plainHalls } from './flat.testdata';
import { isBossFloor, tierOf } from './troops';
import { arenaTuning, floorArenaName } from './world';
import { buildFloor, buildFromSource, delverFloor, describeFloor, judgeAttempt, judgeBuilt, judgeFields, judgeFloor, judgePlan, planFloor, type BuiltFloor, type DelverFloor, type FloorPlan } from './index';

/** The data as shipped (7a's Floors); the cases written before 7a run on `tuning`, Stage 6's lattice with the 7a knobs off (`flatRooms`). */
const bundled = loadTuningData();
const tuning = flatRooms(bundled);
const t = tuning.delver.floor;

/** Real Floors, built once and reused: the tests below mutate copies of their plans and sources, never the Floors. */
let floors: DelverFloor[];
/** A Floor whose plan has Halls in line with its Entrance, found by seed. */
let inLine: DelverFloor;
/** A Boss Floor (Floor 3 of the bundled Tuning), and one whose Entrance has Halls in line. */
let bossFloor: DelverFloor;
let bossInLine: DelverFloor;

/** The first Floor of a seed from 1 whose dealt plan has a Hall in line with its Entrance at the Entrance's own height (sight there is not cut by a level). */
function firstInLine(floor: number, boss: boolean): DelverFloor {
  for (let seed = 1; seed <= 80; seed++) {
    if (!planFloor(t, seed, floor, 0, boss).inLine.length && !planFloor(t, seed, floor, 1, boss).inLine.length) continue;
    const f = delverFloor(tuning, seed, floor);
    const first = f.plan.inLine[0];
    if (first !== undefined && f.plan.halls[first]!.y === f.plan.halls[f.plan.entrance]!.y) return f;
  }
  throw new Error('no Floor with a Hall in line at the Entrance\'s height');
}

beforeAll(() => {
  floors = [1, 2, 3].map((seed) => delverFloor(tuning, seed, 1));
  inLine = firstInLine(1, false);
  bossFloor = delverFloor(tuning, 1, 3);
  bossInLine = firstInLine(3, true);
}, 120_000);

/** Levelled Floors found by seed: one with a gallery (a balcony and a stairwell between them) and one with a sloped Passage. */
let withGallery: DelverFloor;
let withSlope: DelverFloor;
beforeAll(() => {
  const found = Array.from({ length: 40 }, (_, k) => delverFloor(tuning, k + 1, 1));
  withGallery = found.find((f) => f.plan.halls.some((h) => h.gallery))!;
  withSlope = found.find((f) => f.plan.passages.some((p) => p.ya !== p.yb))!;
}, 120_000);

const good = () => floors[0]!;
const surfaceHeightAt = (b: BuiltFloor, s: number, x: number, z: number) => surfaceHeight(b.field.arena, s, x, z);
/** The same Floor, built, with another plan (the field and the source stay the good Floor's). */
const withPlan = (b: BuiltFloor, plan: FloorPlan): BuiltFloor => ({ ...b, plan });

/** Somewhere in the abyss between the Halls (whole metres, not on any Hall or Passage). */
function abyssPoint(b: BuiltFloor): { x: number; z: number } {
  for (let x = -90; x <= 90; x++) {
    for (let z = -90; z <= 90; z++) {
      const s = groundOf(b.battle, b.field, x, z);
      if (s >= 0 && deadly(b.field.arena.walk[s]!)) return { x, z };
    }
  }
  throw new Error('no abyss');
}

describe('the Delver Floor judge', () => {
  it('passes real Floors with no reasons, first try', () => {
    for (const f of floors) {
      expect(f.judgement).toEqual({ ok: true, reasons: [] });
      // A layout with too few levels is rerolled (the `levels` rule), so a Floor may need a second attempt.
      expect(f.attempts).toBeGreaterThanOrEqual(1);
      expect(judgeBuilt(t, f)).toEqual([]);
      expect(judgeFloor(tuning, f.plan).judgement.ok).toBe(true);
    }
  });

  it('no Wall of a real Floor stands on a 2 m destination-field cell centre', () => {
    const at2 = { ...tuning, battle: { ...tuning.battle, crowd: { ...tuning.battle.crowd, flowCell: 2 } } };
    for (const f of floors) {
      const centres = checkMap(f.source, at2).issues.filter((i) => i.kind === 'centre');
      expect(centres).toEqual([]);
    }
  }, 60_000);

  it('rooms: refuses a plan cut to 21 Halls, and one whose Stairs is Empty', () => {
    const b = good();
    const cut = { ...b.plan, halls: b.plan.halls.slice(0, t.rooms - 1) };
    expect(judgePlan(t, cut).some((r) => r.startsWith('rooms: 21 Halls'))).toBe(true);
    const noStairs = { ...b.plan, halls: b.plan.halls.map((h) => (h.kind === 'Stairs' ? { ...h, kind: 'Empty' as const } : h)) };
    const verdict = judgeFloor(tuning, noStairs).judgement;
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toContain('rooms: 0 Stairs, one wanted');
  });

  it('compile: a leaf Hall left with no Passage does not compile, and the judge says so and skips the rest', () => {
    const b = good();
    const leaf = b.plan.halls.findIndex((h, k) => k !== b.plan.entrance && Object.keys(h.doors).length === 1);
    const pass = b.plan.passages.find((p) => p.a === leaf || p.b === leaf)!;
    const source = { ...b.source, brushes: b.source.brushes.filter((br) => br.id !== pass.id) };
    expect(() => buildFromSource(tuning, b.plan, source)).toThrow(MapCompileError);
    const plan = { ...b.plan, passages: b.plan.passages.filter((p) => p !== pass) };
    const { judgement, built } = judgeFloor(tuning, plan);
    expect(built).toBeUndefined();
    expect(judgement.reasons).toHaveLength(1);
    expect(judgement.reasons[0]).toMatch(/^compile: /);
  });

  it('rooms: a plan rule 1 refuses is not built (no built Floor, no compile line)', () => {
    const b = good();
    const cut = { ...b.plan, halls: b.plan.halls.slice(0, t.rooms - 1) };
    const { reasons, built } = judgeAttempt(tuning, cut);
    expect(built).toBeUndefined();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.startsWith('rooms: '))).toBe(true);
    expect(judgeAttempt(tuning, b.plan)).toMatchObject({ reasons: [], built: expect.anything() });
  });

  it('halls: refuses a Hall whose centre is in the abyss', () => {
    const b = good();
    const at = abyssPoint(b);
    const k = (b.plan.entrance + 1) % b.plan.halls.length;
    const plan = { ...b.plan, halls: b.plan.halls.map((h, i) => (i === k ? { ...h, cx: at.x, cz: at.z } : h)) };
    const reasons = judgeBuilt(t, withPlan(b, plan));
    expect(reasons.some((r) => r.startsWith(`halls: ${plan.halls[k]!.id} `))).toBe(true);
  });

  it('passages: refuses a loop Passage with a Hole Brush across its middle, both ways (a Wall Brush there did not stop the fields, and a removed Brush leaves the abyss to walk on)', () => {
    const b = good();
    const loop = b.plan.passages.find((p) => p.loop && p.ya === p.yb)!;
    expect(loop).toBeDefined();
    const r = loop.rect;
    const mid = Math.round((loop.axis === 'x' ? r.x0 + r.x1 : r.z0 + r.z1) / 2);
    const hole = {
      kind: 'hole' as const,
      id: 'plug',
      y: loop.ya,
      rect: loop.axis === 'x' ? { x0: mid - 2, z0: r.z0, x1: mid + 2, z1: r.z1 } : { x0: r.x0, z0: mid - 2, x1: r.x1, z1: mid + 2 },
    };
    const cut = buildFromSource(tuning, b.plan, { ...b.source, brushes: [...b.source.brushes, hole] });
    const reasons = judgeBuilt(t, cut);
    // The field from either end, read at the other, goes round by hundreds of metres. The tree's Passages are still followed.
    expect(reasons.filter((r2) => r2.startsWith(`passages: ${loop.id} `))).toHaveLength(2);
    expect(reasons.filter((r2) => r2.startsWith('passages:'))).toHaveLength(2);
    expect(reasons.filter((r2) => r2.startsWith('halls:'))).toEqual([]);
  });

  it('passages: refuses a loop Passage whose Brush is removed (its ends stand on no floor), and only that Passage', () => {
    const b = good();
    const loop = b.plan.passages.find((p) => p.loop && p.ya === p.yb)!;
    expect(loop).toBeDefined();
    const source = { ...b.source, brushes: b.source.brushes.filter((br) => br.id !== loop.id) };
    expect(source.brushes).toHaveLength(b.source.brushes.length - 1);
    const reasons = judgeBuilt(t, buildFromSource(tuning, b.plan, source));
    const mine = reasons.filter((r) => r.startsWith(`passages: ${loop.id} `));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatch(/stands on no floor/);
    expect(reasons.filter((r) => r.startsWith('passages:'))).toHaveLength(1);
  });

  it('floorNear: both ends of every sloped Passage stand on a floor within the Passage\'s heights, short ones included', () => {
    let sloped = 0;
    for (const f of [...floors, withSlope]) {
      for (const p of f.plan.passages) {
        if (p.ya === p.yb) continue;
        sloped++;
        const r = p.rect;
        const cx = (r.x0 + r.x1) / 2;
        const cz = (r.z0 + r.z1) / 2;
        const ends = p.axis === 'x' ? [{ x: r.x0 + 1, z: cz, y: p.ya }, { x: r.x1 - 1, z: cz, y: p.yb }] : [{ x: cx, z: r.z0 + 1, y: p.ya }, { x: cx, z: r.z1 - 1, y: p.yb }];
        for (const e of ends) {
          const s = floorNear(f.field.arena, e.x, e.z, e.y);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(Math.abs(surfaceHeightAt(f, s, e.x, e.z) - e.y)).toBeLessThanOrEqual(1.01);
        }
      }
    }
    expect(sloped).toBeGreaterThan(0);
  });

  it('markers: refuses a fire in the abyss, and a post in another Hall', () => {
    const b = good();
    const at = abyssPoint(b);
    const fire = b.plan.markers.fires[0]!;
    const inAbyss = { ...b.plan, markers: { ...b.plan.markers, fires: [{ hall: fire.hall, y: fire.y, ...at }, ...b.plan.markers.fires.slice(1)] } };
    expect(judgeBuilt(t, withPlan(b, inAbyss)).some((r) => r.startsWith('markers: fire0 '))).toBe(true);

    const post = b.plan.markers.posts[0]!;
    const other = b.plan.halls[(post.hall + 1) % b.plan.halls.length]!;
    const wrongHall = { ...b.plan, markers: { ...b.plan.markers, posts: [{ hall: post.hall, x: other.cx, y: other.y, z: other.cz }, ...b.plan.markers.posts.slice(1)] } };
    expect(judgeBuilt(t, withPlan(b, wrongHall)).some((r) => r.startsWith('markers: post0 ') && r.includes(b.plan.halls[post.hall]!.id))).toBe(true);
  });

  it('sight: refuses a post in the first Hall in line with the Entrance, naming it', () => {
    const b = inLine;
    const h = b.plan.halls[b.plan.inLine[0]!]!;
    const posts = [{ hall: b.plan.inLine[0]!, x: h.cx, y: h.y, z: h.cz }, ...b.plan.markers.posts.slice(1)];
    const moved = withPlan(b, { ...b.plan, markers: { ...b.plan.markers, posts } });
    const reasons = judgeBuilt(t, moved);
    expect(reasons.filter((r) => r.startsWith('sight: post0 ') && r.includes(h.id))).toHaveLength(1);
    expect(judgeBuilt(t, b)).toEqual([]);
  });
});

describe('the judge on a Boss Floor', () => {
  it('passes a Boss Floor with no reasons: one Boss Hall, which is the Stairs Hall', () => {
    const b = bossFloor;
    expect(b.judgement).toEqual({ ok: true, reasons: [] });
    expect(b.plan.halls[b.plan.stairs]!.kind).toBe('Boss');
    expect(b.plan.markers.boss).toBeDefined();
    expect(judgeBuilt(t, b)).toEqual([]);
    expect(b.source.look!.props!.at(-1)).toMatchObject({ id: 'boss', kind: 'banner', team: 1, x: b.plan.markers.boss!.x, z: b.plan.markers.boss!.z });
    expect(describeFloor(b)).toContain(`Boss ${b.plan.halls[b.plan.stairs]!.id}`);
  });

  it('rooms: refuses a Boss Floor with an extra Stairs Hall, or with the Boss Hall not the Stairs Hall', () => {
    const b = bossFloor;
    const other = b.plan.halls.findIndex((h) => h.kind === 'Fight' || h.kind === 'Empty');
    const extra = { ...b.plan, halls: b.plan.halls.map((h, k) => (k === other ? { ...h, kind: 'Stairs' as const } : h)) };
    expect(judgePlan(t, extra).some((r) => r.startsWith('rooms: 1 Stairs on a Boss Floor'))).toBe(true);
    const moved = { ...b.plan, stairs: other };
    expect(judgePlan(t, moved).some((r) => r.startsWith('rooms: the Boss Hall is not the Stairs Hall'))).toBe(true);
    const twice = { ...b.plan, halls: b.plan.halls.map((h, k) => (k === other ? { ...h, kind: 'Boss' as const } : h)) };
    expect(judgePlan(t, twice).some((r) => r.startsWith('rooms: 2 Boss Halls'))).toBe(true);
    expect(judgePlan(t, b.plan)).toEqual([]);
  });

  it('markers: refuses the boss marker in the abyss', () => {
    const b = bossFloor;
    const at = abyssPoint(b);
    const plan = { ...b.plan, markers: { ...b.plan.markers, boss: { hall: b.plan.markers.boss!.hall, y: b.plan.markers.boss!.y, ...at } } };
    expect(judgeBuilt(t, withPlan(b, plan)).some((r) => r.startsWith('markers: boss '))).toBe(true);
  });

  it('sight: refuses the boss marker in the first Hall in line with the Entrance, naming it', () => {
    const b = bossInLine;
    const k = b.plan.inLine[0]!;
    const h = b.plan.halls[k]!;
    const moved = withPlan(b, { ...b.plan, markers: { ...b.plan.markers, boss: { hall: k, x: h.cx, y: h.y, z: h.cz } } });
    expect(judgeBuilt(t, moved).filter((r) => r.startsWith('sight: boss ') && r.includes(h.id))).toHaveLength(1);
    expect(judgeBuilt(t, b)).toEqual([]);
  });
});

describe('rerolling a Floor', () => {
  const refuse0 = (_: unknown, b: BuiltFloor) => (b.plan.attempt === 0 ? ['test: refused'] : []);

  it('takes the next layout when the first is refused', () => {
    const f = delverFloor(tuning, 1, 1, { judge: refuse0 });
    expect(f.attempts).toBe(2);
    expect(f.plan.attempt).toBe(1);
    expect(f.plan).toEqual(planFloor(t, 1, 1, 1));
    expect(f.judgement.ok).toBe(true);
    expect(mapFileText(f.map)).not.toBe(mapFileText(good().map));
  });

  it('gives the best layout with ok false when all are refused, and the same bytes every time', () => {
    const refuseAll = () => ['test: refused'];
    const a = delverFloor(tuning, 1, 1, { maxAttempts: 3, judge: refuseAll });
    const b = delverFloor(tuning, 1, 1, { maxAttempts: 3, judge: refuseAll });
    expect(a.judgement).toEqual({ ok: false, reasons: ['test: refused'] });
    expect(a.attempts).toBe(3);
    expect(a.plan.attempt).toBe(0);
    expect(mapFileText(a.map)).toBe(mapFileText(b.map));
    const c = delverFloor(tuning, 1, 1);
    expect(mapFileText(c.map)).toBe(mapFileText(delverFloor(tuning, 1, 1).map));
  });

  it('builds the same Floor from buildFloor and delverFloor', () => {
    expect(mapFileText(buildFloor(tuning, good().plan).map)).toBe(mapFileText(good().map));
  });
});

describe('describeFloor', () => {
  it('names the seed, the Floor, the attempt and every kind present', () => {
    const f = floors[1]!;
    const line = describeFloor(f);
    expect(line).toContain('Floor 1 of seed 2');
    expect(line).toContain(`attempt ${f.plan.attempt + 1}`);
    for (const kind of ['Entrance', 'Stairs', 'Rest', 'Treasure', 'Fight', 'Empty']) {
      expect(f.plan.halls.some((h) => h.kind === kind)).toBe(true);
      expect(line).toContain(kind);
    }
    expect(line).toContain('passes the judge');
    expect(describeFloor({ ...f, judgement: { ok: false, reasons: ['a: b'] } })).toContain('fails: a: b');
  });
});

describe('the judge on a Floor with levels', () => {
  it('passes levelled Floors, whose Halls stand at several levels, with galleries and sloped Passages', () => {
    for (const f of [withGallery, withSlope]) {
      expect(f.judgement).toEqual({ ok: true, reasons: [] });
      expect(judgeBuilt(t, f)).toEqual([]);
      expect(new Set(f.plan.halls.map((h) => h.level)).size).toBeGreaterThanOrEqual(t.levels.min);
    }
    expect(withGallery.plan.halls.some((h) => h.gallery)).toBe(true);
    expect(withSlope.plan.passages.some((p) => p.ya !== p.yb)).toBe(true);
    expect(describeFloor(withGallery)).toMatch(/levels \d to \d \(\d Hall levels\), \d+ galleries \(\d+ balconies, \d+ stairwells\), \d+ sloped Passages/);
  });

  it('levels: refuses a plan flattened to one level, under levels.min', () => {
    const b = withGallery;
    expect(t.levels.min).toBeGreaterThan(1);
    const flat = { ...b.plan, halls: b.plan.halls.map((h) => ({ ...h, level: 0, y: 0 })) };
    // Only the Halls are flattened (their Passages keep their door heights), so the 7c `features` door check refuses it too: read the `levels` line alone.
    expect(judgePlan(t, flat).filter((r) => r.startsWith('levels:'))).toEqual([`levels: 1 Hall level, at least ${t.levels.min} wanted`]);
    expect(judgePlan(t, b.plan)).toEqual([]);
    expect(judgeAttempt(tuning, flat).built).toBeUndefined();
  });

  it('passages: refuses a sloped Passage whose Ramp Brush is gone, the way up (or the compile) failing', () => {
    const b = withSlope;
    const slope = b.plan.passages.find((p) => p.ya !== p.yb)!;
    const source = { ...b.source, brushes: b.source.brushes.filter((br) => br.id !== `${slope.id}-ramp`) };
    expect(b.source.brushes.some((br) => br.id === `${slope.id}-ramp`)).toBe(true);
    let reasons: string[];
    try {
      reasons = judgeBuilt(t, buildFromSource(tuning, b.plan, source));
    } catch (e) {
      if (!(e instanceof MapCompileError)) throw e;
      return;
    }
    // Climbing from the low Hall to the high one is the direction that fails (the way down is a drop).
    const [low, high] = slope.ya < slope.yb ? [slope.a, slope.b] : [slope.b, slope.a];
    expect(reasons.some((r) => r.startsWith(`passages: ${slope.id} `) && r.includes(`from ${b.plan.halls[low]!.id}'s end to ${b.plan.halls[high]!.id}'s: no way`))).toBe(true);
  });

  it('markers: refuses a fire whose height is 2 m off its Hall\'s floor', () => {
    const b = withGallery;
    const fire = b.plan.markers.fires[0]!;
    const raised = { ...b.plan, markers: { ...b.plan.markers, fires: [{ ...fire, y: fire.y + 2 }, ...b.plan.markers.fires.slice(1)] } };
    expect(judgeBuilt(t, withPlan(b, raised)).some((r) => r.startsWith('markers: fire0 '))).toBe(true);
  });

  it('galleries: refuses a gallery whose Deck height is 2 m off', () => {
    const b = withGallery;
    const k = b.plan.halls.findIndex((h) => h.gallery);
    const g = b.plan.halls[k]!.gallery!;
    const raised = { ...b.plan, halls: b.plan.halls.map((h, i) => (i === k ? { ...h, gallery: { ...g, y: g.y + 2 } } : h)) };
    const reasons = judgeBuilt(t, withPlan(b, raised));
    expect(reasons.some((r) => r.startsWith(`galleries: ${b.plan.halls[k]!.id}'s Deck `))).toBe(true);
    expect(reasons.filter((r) => !r.startsWith('galleries:'))).toEqual([]);
  });

  it('sight: takes each marker at its own height, so a post on a Deck is judged as standing there', () => {
    // A built Floor with a Deck post passes `sight` (no reason), as the judge reads both heights.
    const f = [withGallery, ...floors].find((x) => x.plan.markers.posts.some((q) => q.y > 0));
    if (f) expect(judgeBuilt(t, f).filter((r) => r.startsWith('sight:') || r.startsWith('markers:'))).toEqual([]);
  });

  it('builds a navmesh with a shortcut jump Link from each gallery Hall\'s floor onto its Deck, and no other jump Link', () => {
    const b = withGallery;
    expect(b.map.shortcuts).toBe(true);
    const name = floorArenaName(b.plan.seed, b.plan.floor);
    const tn = arenaTuning(tuning, name);
    const mesh = navMesh(arenaOf(tn, name), tn);
    const jumps = mesh.links.filter((l): l is JumpLink => l.kind === 'jump');
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps.every((l) => l.shortcut)).toBe(true);
    const arena = arenaOf(tn, name);
    expect(jumps.every((l) => !arena.walk[l.to]!.roof)).toBe(true);
    for (const h of b.plan.halls) {
      const g = h.gallery;
      if (!g) continue;
      // The Hall's floor is cut into several Walk Surfaces round the gallery: the Jump leaves the one in front of the Deck.
      const deck = groundOf(b.battle, b.field, (g.deck.x0 + g.deck.x1) / 2, (g.deck.z0 + g.deck.z1) / 2, g.y);
      const onFloor = (k: number) => arena.walk[k]!.id.startsWith(`WALK_${h.id}_`) && !arena.walk[k]!.roof;
      expect(jumps.some((l) => onFloor(l.from) && l.to === deck), `${h.id}: a jump Link from its floor onto its Deck`).toBe(true);
    }
    // A Floor without a gallery asks for none.
    const flat = floors.find((f) => !f.plan.halls.some((h) => h.gallery));
    if (flat) expect(flat.map.shortcuts).toBeUndefined();
  });

  it('no Wall of a levelled Floor stands on a 2 m destination-field cell centre', () => {
    const at2 = { ...tuning, battle: { ...tuning.battle, crowd: { ...tuning.battle.crowd, flowCell: 2 } } };
    for (const f of [withGallery, withSlope]) expect(checkMap(f.source, at2).issues.filter((i) => i.kind === 'centre')).toEqual([]);
  }, 60_000);
});

describe('the judge on Floors with great halls and turning Passages (Stage 7a)', () => {
  const tuning7 = plainHalls(bundled);
  const t7 = tuning7.delver.floor;
  const size = tuning7.battle.field.size;
  let floors7: DelverFloor[];
  let boss7: DelverFloor;
  let turning: DelverFloor;
  let gallery7: DelverFloor;
  beforeAll(() => {
    floors7 = [1, 2, 3, 4].flatMap((seed) => [1, 3].map((floor) => delverFloor(tuning7, seed, floor)));
    boss7 = floors7.find((f) => f.plan.markers.boss)!;
    turning = floors7.find((f) => f.plan.passages.some((p) => p.shape !== 'straight' && p.ya === p.yb))!;
    gallery7 = floors7.find((f) => f.plan.halls.some((h) => h.gallery))!;
  }, 300_000);

  /** The first turning Passage of `f` of the shape asked (any turning one without it). */
  const turningOf = (f: DelverFloor, flat: boolean) => f.plan.passages.find((p) => p.shape !== 'straight' && (p.ya === p.yb) === flat)!;

  it('passes 7a Floors (Floors 1 and 3 of four seeds) first try, with no reasons', () => {
    for (const f of floors7) {
      expect(f.plan.attempt).toBe(0);
      expect(f.judgement).toEqual({ ok: true, reasons: [] });
      expect(judgeBuilt(t7, f)).toEqual([]);
      expect(f.plan.halls.some((h) => h.great)).toBe(true);
    }
    expect(floors7.some((f) => f.plan.passages.some((p) => p.shape !== 'straight'))).toBe(true);
  });

  it('layout: refuses a piece moved onto a Hall, naming both, and a Hall moved outside the field', () => {
    const f = turning;
    const p = turningOf(f, true);
    const hall = f.plan.halls.find((h) => h !== f.plan.halls[p.a] && h !== f.plan.halls[p.b])!;
    const onto = { x0: hall.rect.x0 + 2, z0: hall.rect.z0 + 2, x1: hall.rect.x0 + 2 + (p.pieces[0]!.rect.x1 - p.pieces[0]!.rect.x0), z1: hall.rect.z0 + 2 + (p.pieces[0]!.rect.z1 - p.pieces[0]!.rect.z0) };
    const moved = { ...f.plan, passages: f.plan.passages.map((q) => (q === p ? { ...q, pieces: q.pieces.map((pc, k) => (k === 0 ? { ...pc, rect: onto } : pc)) } : q)) };
    expect(judgePlan(t7, f.plan, size)).toEqual([]);
    expect(judgePlan(t7, moved, size)).toContain(`layout: ${p.id}-0 overlaps ${hall.id}`);
    const k = 3;
    const r = f.plan.halls[k]!.rect;
    const moved300 = (q: typeof r) => ({ x0: q.x0 + 300, z0: q.z0, x1: q.x1 + 300, z1: q.z1 });
    const out = { ...f.plan, halls: f.plan.halls.map((h, i) => (i === k ? { ...h, rect: moved300(r), rects: [moved300(r)], cx: h.cx + 300 } : h)) };
    expect(judgePlan(t7, out, size)).toContain(`layout: ${f.plan.halls[k]!.id} is outside the field`);
    // Without the field's size, only the field check is skipped.
    expect(judgePlan(t7, out)).toEqual([]);
    expect(judgeAttempt(tuning7, out).built).toBeUndefined();
  });

  it('layout: refuses two Passages\' pieces on one another, and two Halls on one another', () => {
    const f = turning;
    const [p, q] = [f.plan.passages[0]!, f.plan.passages[1]!];
    const stacked = { ...f.plan, passages: f.plan.passages.map((x) => (x === q ? { ...x, pieces: x.pieces.map((pc, k) => (k === 0 ? { ...pc, rect: p.pieces[0]!.rect } : pc)) } : x)) };
    const reasons = judgePlan(t7, stacked, size);
    expect(reasons.some((r) => r.startsWith('layout: ') && r.includes(' overlaps pass'))).toBe(true);
    const twin = { ...f.plan, halls: f.plan.halls.map((h, i) => (i === 1 ? { ...h, rect: f.plan.halls[0]!.rect, rects: f.plan.halls[0]!.rects, solids: [], pillars: [] } : h)) };
    expect(judgePlan(t7, twin, size)).toContain('layout: hall0 overlaps hall1');
  });

  it('rooms: refuses a plan with its great flags stripped, and a Boss Floor whose Boss Hall is not great', () => {
    const f = floors7[0]!;
    const stripped = { ...f.plan, halls: f.plan.halls.map((h) => ({ ...h, great: false })) };
    expect(judgePlan(t7, stripped, size)).toContain(`rooms: 0 great halls, ${t7.great.count[0]} to ${t7.great.count[1]} wanted`);
    const bossHall = boss7.plan.halls.findIndex((h) => h.kind === 'Boss');
    expect(boss7.plan.halls[bossHall]!.great).toBe(true);
    const lone = { ...boss7.plan, halls: boss7.plan.halls.map((h, i) => (i === bossHall ? { ...h, great: false } : h)) };
    const reasons = judgePlan(t7, lone, size);
    expect(reasons).toContain(`rooms: the Boss Hall hall${bossHall} is not a great hall`);
    expect(judgeAttempt(tuning7, lone).built).toBeUndefined();
    // With no great halls wanted (the bundled Tuning), neither line is ever written.
    expect(judgePlan(t, { ...good().plan, halls: good().plan.halls.map((h) => ({ ...h, great: false })) }).some((r) => r.includes('great'))).toBe(false);
  });

  it('passages: refuses a turning Passage whose corner Enclosure is removed, naming the leg', () => {
    const f = turning;
    const p = turningOf(f, true);
    const k = p.pieces.findIndex((q) => q.corner);
    const source = { ...f.source, brushes: f.source.brushes.filter((br) => br.id !== `${p.id}-${k}`) };
    expect(source.brushes).toHaveLength(f.source.brushes.length - 1);
    const reasons = judgeBuilt(t7, buildFromSource(tuning7, f.plan, source));
    const mine = reasons.filter((r) => r.startsWith(`passages: ${p.id} (${f.plan.halls[p.a]!.id} to ${f.plan.halls[p.b]!.id}) leg `));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => / leg \d of \d is not followed from /.test(r) && r.includes('corner 1'))).toBe(true);
    expect(reasons.filter((r) => r.startsWith('passages:') && !r.startsWith(`passages: ${p.id} `))).toEqual([]);
  });

  it('passages: refuses a Hole across a turning Passage\'s middle leg, both ways, naming the leg', () => {
    const f = floors7.find((x) => x.plan.passages.some((q) => q.shape !== 'straight' && q.ya === q.yb && q.pieces.length >= 3))!;
    const p = f.plan.passages.find((q) => q.shape !== 'straight' && q.ya === q.yb && q.pieces.length >= 3)!;
    const leg = p.pieces.find((q) => !q.corner)!;
    const r = leg.rect;
    const mx = Math.round((r.x0 + r.x1) / 2);
    const mz = Math.round((r.z0 + r.z1) / 2);
    const hole = { kind: 'hole' as const, id: 'plug', y: leg.y0, rect: { x0: mx - 2, z0: mz - 2, x1: mx + 2, z1: mz + 2 } };
    const reasons = judgeBuilt(t7, buildFromSource(tuning7, f.plan, { ...f.source, brushes: [...f.source.brushes, hole] }));
    expect(reasons.some((x) => x.startsWith(`passages: ${p.id} `) && / leg 1 of \d is not followed from /.test(x))).toBe(true);
  });

  it('no Wall of a 7a Floor stands on a 2 m destination-field cell centre', () => {
    const at2 = { ...tuning7, battle: { ...tuning7.battle, crowd: { ...tuning7.battle.crowd, flowCell: 2 } } };
    for (const f of [turning, boss7]) expect(checkMap(f.source, at2).issues.filter((i) => i.kind === 'centre')).toEqual([]);
  }, 120_000);

  it('builds a navmesh with a shortcut jump Link from each gallery Hall\'s floor onto its Deck, and no other jump Link, on a 7a Floor', () => {
    const b = gallery7;
    expect(b.map.shortcuts).toBe(true);
    const name = floorArenaName(b.plan.seed, b.plan.floor);
    const tn = arenaTuning(tuning7, name);
    const arena = arenaOf(tn, name);
    const mesh = navMesh(arena, tn);
    const jumps = mesh.links.filter((l): l is JumpLink => l.kind === 'jump');
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps.every((l) => l.shortcut)).toBe(true);
    expect(jumps.every((l) => !arena.walk[l.to]!.roof)).toBe(true);
    for (const h of b.plan.halls) {
      const g = h.gallery;
      if (!g) continue;
      const deck = groundOf(b.battle, b.field, (g.deck.x0 + g.deck.x1) / 2, (g.deck.z0 + g.deck.z1) / 2, g.y);
      const onFloor = (k: number) => arena.walk[k]!.id.startsWith(`WALK_${h.id}_`) && !arena.walk[k]!.roof;
      expect(jumps.some((l) => onFloor(l.from) && l.to === deck), `${h.id}: a jump Link from its floor onto its Deck`).toBe(true);
    }
  }, 120_000);

  it('describeFloor names the great halls and each shape\'s Passages', () => {
    for (const f of floors7.slice(0, 4)) {
      const count = (s: string) => f.plan.passages.filter((p) => p.shape === s).length;
      expect(describeFloor(f)).toContain(`, ${f.plan.halls.filter((h) => h.great).length} great halls, ${count('L')} L, ${count('S')} S and ${count('Z')} Z Passages`);
    }
  });
});

describe('the judge on Floors with shaped and pillared Halls (Stage 7b)', () => {
  const tuning7b = bundled;
  const tb = tuning7b.delver.floor;
  const size = tuning7b.battle.field.size;
  /** The first attempt's plan of each of seeds 1 to 6 of Floors 1 to 9. */
  const plans: FloorPlan[] = [];
  for (let seed = 1; seed <= 6; seed++) for (let floor = 1; floor <= 9; floor++) plans.push(planFloor(tb, seed, floor, 0, isBossFloor(tuning7b.delver, floor)));
  const hallWith = (pred: (h: FloorPlan['halls'][number]) => boolean) => {
    for (const plan of plans) {
      const k = plan.halls.findIndex(pred);
      if (k >= 0) return { plan, k, h: plan.halls[k]! };
    }
    throw new Error('no such Hall');
  };
  const withHall = (plan: FloorPlan, k: number, patch: Partial<FloorPlan['halls'][number]>): FloorPlan => ({ ...plan, halls: plan.halls.map((h, i) => (i === k ? { ...h, ...patch } : h)) });

  it('passes 7b Floors first try on 54 plans (seeds 1 to 6 of Floors 1 to 9), with every shape and both layouts among them', () => {
    const shapes = new Set<string>();
    const layouts = new Set<string>();
    for (const plan of plans) {
      for (const h of plan.halls) {
        shapes.add(h.shape);
        if (h.layout) layouts.add(h.layout);
      }
      expect(judgePlan(tb, plan, size)).toEqual([]);
      const { reasons } = judgeAttempt(tuning7b, plan);
      expect(reasons, `Floor ${plan.floor} of seed ${plan.seed}`).toEqual([]);
    }
    expect([...shapes].sort()).toEqual(['L', 'T', 'cross', 'rect', 'ring']);
    expect([...layouts].sort()).toEqual(['colonnade', 'grid']);
  }, 600_000);

  it('shapes: refuses a pillar moved onto a marker, naming both', () => {
    const { plan, k, h } = hallWith((x) => x.pillars.length > 0);
    const p = h.pillars[0]!;
    const posts = plan.markers.posts.map((q, n) => (n === 0 ? { hall: k, x: (p.x0 + p.x1) / 2 + 0.5, y: h.y, z: (p.z0 + p.z1) / 2 } : q));
    const moved = { ...plan, markers: { ...plan.markers, posts } };
    expect(judgePlan(tb, moved, size)).toContain(`shapes: post0 is within 1 m of ${h.id}-pillar0`);
  });

  it('shapes: refuses a solid moved over a doorway, naming the Passage, the Hall and the solid', () => {
    const { plan, k, h } = hallWith((x) => x.solids.length > 0);
    const pass = plan.passages.find((q) => q.a === k)!;
    const r = pass.pieces[0]!.rect;
    const over = { x0: r.x0 - 3, z0: r.z0 - 3, x1: r.x1 + 3, z1: r.z1 + 3 };
    const moved = withHall(plan, k, { solids: [over, ...h.solids.slice(1)] });
    expect(judgePlan(tb, moved, size)).toContain(`shapes: ${pass.id}'s doorway into ${h.id} is blocked by ${h.id}-solid0`);
    expect(judgePlan(tb, plan, size)).toEqual([]);
  });

  it('shapes: refuses a rect dropped from a Hall\'s rects', () => {
    const { plan, k, h } = hallWith((x) => x.rects.length > 1);
    const moved = withHall(plan, k, { rects: h.rects.slice(0, -1) });
    expect(judgePlan(tb, moved, size)).toContain(`shapes: ${h.id}'s rects and solids do not tile its rect`);
  });

  it('shapes: refuses a pillar moved half a metre (a Wall on the field\'s dots)', () => {
    const { plan, k, h } = hallWith((x) => x.pillars.length > 1);
    const p = h.pillars[1]!;
    const moved = withHall(plan, k, { pillars: h.pillars.map((q, n) => (n === 1 ? { ...p, x0: p.x0 + 0.5, x1: p.x1 + 0.5 } : q)) });
    expect(judgePlan(tb, moved, size)).toContain(`shapes: ${h.id}-pillar1 has a Wall on the field's dots`);
  });

  it('shapes: refuses a pillar standing in a solid or off the floor', () => {
    const { plan, k, h } = hallWith((x) => x.pillars.length > 0 && x.shape !== 'rect');
    const s = h.solids[0]!;
    const moved = withHall(plan, k, { pillars: [{ x0: s.x0 + 1, z0: s.z0 + 1, x1: s.x0 + 3, z1: s.z0 + 3 }, ...h.pillars.slice(1)] });
    expect(judgePlan(tb, moved, size)).toContain(`shapes: ${h.id}-pillar0 is not on ${h.id}'s floor`);
  });

  it('shapes: refuses a centre moved into a solid', () => {
    const { plan, k, h } = hallWith((x) => x.solids.length > 0);
    const s = h.solids[0]!;
    const moved = withHall(plan, k, { cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2 });
    expect(judgePlan(tb, moved, size).some((r) => r.startsWith(`shapes: ${h.id}'s centre (`) && r.endsWith(') is not on its floor'))).toBe(true);
  });

  it('describeFloor counts the shaped and pillared Halls', () => {
    const f = delverFloor(tuning7b, 2, 1);
    const count = (s: string) => f.plan.halls.filter((h) => h.shape === s).length;
    const pillared = f.plan.halls.filter((h) => h.pillars.length > 0);
    const shaped = f.plan.halls.filter((h) => h.shape !== 'rect').length;
    expect(describeFloor(f)).toContain(`, ${shaped} shaped Halls (${count('L')} L, ${count('T')} T, ${count('cross')} cross, ${count('ring')} ring), ${f.plan.halls.reduce((n, h) => n + h.pillars.length, 0)} pillars in ${pillared.length} Halls (${pillared.filter((h) => h.layout === 'colonnade').length} colonnades, ${pillared.filter((h) => h.layout === 'grid').length} grids)`);
  }, 120_000);

  it('sight: a post hidden from every spawn only by a pillar passes, and is refused with that pillar\'s Block removed (hand-built on a found Floor)', () => {
    // Found by search: the Entrance of Floor 1 of seed 3 is a plain rect. Post0 goes 10 m east of spawn0 in that Hall, and a pillar stands between them. Hand-built: the plan's
    // generator never aims a post at a spawn, so no dealt Floor shows the case.
    const plan = planFloor(tb, 3, 1, 0, false);
    const eh = plan.halls[plan.entrance]!;
    const sp = plan.markers.spawns[0]!;
    const cx = 2 * Math.round((sp.x + 5) / 2);
    const cz = 2 * Math.round(sp.z / 2);
    const rect = { x0: cx - 1, z0: cz - 1, x1: cx + 1, z1: cz + 1 };
    const pillar = { kind: 'block' as const, id: `${eh.id}-pillar0`, rect, top: eh.top, material: 'stone' as const };
    const moved = { ...plan, markers: { ...plan.markers, posts: [{ hall: plan.entrance, x: sp.x + 10, y: eh.y, z: sp.z }, ...plan.markers.posts.slice(1)] } };
    const base = buildFloor(tuning7b, plan);
    expect(judgeFields(tb, buildFromSource(tuning7b, moved, { ...base.source, brushes: [...base.source.brushes, pillar] }))).toEqual([]);
    const bare = judgeFields(tb, buildFromSource(tuning7b, moved, base.source));
    expect(bare.filter((r) => r.startsWith('sight: post0 '))).toHaveLength(1);
  }, 120_000);

  it('builds a navmesh with a shortcut jump Link from each gallery Hall\'s floor onto its Deck, and no other jump Link, on a 7b Floor', () => {
    const b = [1, 2, 3, 4, 5, 6].map((seed) => delverFloor(tuning7b, seed, 1)).find((f) => f.plan.halls.some((h) => h.gallery) && f.plan.halls.some((h) => h.solids.length + h.pillars.length > 0))!;
    expect(b.map.shortcuts).toBe(true);
    const name = floorArenaName(b.plan.seed, b.plan.floor);
    const tn = arenaTuning(tuning7b, name);
    const arena = arenaOf(tn, name);
    const mesh = navMesh(arena, tn);
    const jumps = mesh.links.filter((l): l is JumpLink => l.kind === 'jump');
    expect(jumps.length).toBeGreaterThan(0);
    expect(jumps.every((l) => l.shortcut)).toBe(true);
    expect(jumps.every((l) => !arena.walk[l.to]!.roof)).toBe(true);
    for (const h of b.plan.halls) {
      const g = h.gallery;
      if (!g) continue;
      const deck = groundOf(b.battle, b.field, (g.deck.x0 + g.deck.x1) / 2, (g.deck.z0 + g.deck.z1) / 2, g.y);
      const onFloor = (k: number) => arena.walk[k]!.id.startsWith(`WALK_${h.id}_`) && !arena.walk[k]!.roof;
      expect(jumps.some((l) => onFloor(l.from) && l.to === deck), `${h.id}: a jump Link from its floor onto its Deck`).toBe(true);
    }
  }, 120_000);
});

describe('the judge on Floors with vertical features and wrapped galleries (Stage 7c)', () => {
  const t7 = bundled;
  const tc = t7.delver.floor;
  const size = t7.battle.field.size;
  const at2 = { ...t7, battle: { ...t7.battle, crowd: { ...t7.battle.crowd, flowCell: 2 } } };
  /** 20 pairs: seeds 1 to 4 of Floors 1, 2, 3 and 9 (the Boss Floors) and 4; each is its first attempt's built Floor, or (when that did not compile) the Floor `delverFloor` deals. */
  const pool: BuiltFloor[] = [];
  /** The first attempts that were refused, with their reasons. */
  const refused: { seed: number; floor: number; reasons: string[] }[] = [];
  beforeAll(() => {
    for (let seed = 1; seed <= 4; seed++) {
      for (const floor of [1, 2, 3, 4, 9]) {
        const first = judgeAttempt(t7, planFloor(tc, seed, floor, 0, isBossFloor(t7.delver, floor), tierOf(t7.delver, floor)));
        if (first.built && first.reasons.length === 0) pool.push(first.built);
        else {
          refused.push({ seed, floor, reasons: first.reasons });
          pool.push(delverFloor(t7, seed, floor));
        }
      }
    }
  }, 900_000);

  const featureHalls = (kind: 'split' | 'pit' | 'dais') => pool.flatMap((b) => b.plan.halls.flatMap((h, k) => (h.feature?.kind === kind ? [{ b, k, h, f: h.feature }] : [])));
  const withHall = (plan: FloorPlan, k: number, patch: Partial<FloorPlan['halls'][number]>): FloorPlan => ({ ...plan, halls: plan.halls.map((h, i) => (i === k ? { ...h, ...patch } : h)) });
  const featureReasons = (plan: FloorPlan) => judgePlan(tc, plan, size).filter((r) => r.startsWith('features: '));
  /** The judge's verdict on `b`'s plan built from `source`: the build's `compile:` line when it does not compile. */
  const judgeSource = (b: BuiltFloor, source: BuiltFloor['source']): string[] => {
    try {
      return judgeFields(tc, buildFromSource(t7, b.plan, source));
    } catch (e) {
      if (!(e instanceof MapCompileError)) throw e;
      return [`compile: ${e.message}`];
    }
  };
  /** The lane of the Passage end into a Hall (3 m from the Passage's piece into the Hall), as `shapes` builds it. */
  const lane = (r: { x0: number; z0: number; x1: number; z1: number }, side: string) =>
    side === 'w' ? { x0: r.x0 - 3, z0: r.z0, x1: r.x0, z1: r.z1 } : side === 'e' ? { x0: r.x1, z0: r.z0, x1: r.x1 + 3, z1: r.z1 } : side === 'n' ? { x0: r.x0, z0: r.z1, x1: r.x1, z1: r.z1 + 3 } : { x0: r.x0, z0: r.z0 - 3, x1: r.x1, z1: r.z0 };

  it('passes the 20 pairs, every kind of feature and wrap among them; a first attempt refused only for a pit its step cannot be climbed from', () => {
    expect(pool.length).toBe(20);
    for (const b of pool) {
      expect(b.plan.halls.length).toBe(tc.rooms);
      expect(judgeBuilt(tc, b), `Floor ${b.plan.floor} of seed ${b.plan.seed}`).toEqual([]);
    }
    // A refused first attempt is a layout that did not compile (a 4 m pit as wide as its step is long cannot be entered), never a judged rule.
    for (const r of refused) expect(r.reasons.every((x) => x.startsWith('compile: Soldiers cannot walk the whole map')), `${r.seed}/${r.floor}: ${r.reasons.join(' | ')}`).toBe(true);
    expect(featureHalls('split').some(({ f }) => f.kind === 'split' && f.tiers.length === 2)).toBe(true);
    expect(featureHalls('split').some(({ f }) => f.kind === 'split' && f.tiers.length === 3)).toBe(true);
    expect(featureHalls('pit').length).toBeGreaterThan(0);
    expect(featureHalls('dais').length).toBeGreaterThan(0);
    expect(pool.some((b) => b.plan.halls.some((h) => h.gallery?.wrap))).toBe(true);
  });

  it('no Wall of a 7c Floor stands on a 2 m destination-field cell centre (the editor\'s checkMap)', () => {
    for (const b of pool.slice(0, 8)) expect(checkMap(b.source, at2).issues.filter((i) => i.kind === 'centre')).toEqual([]);
  }, 120_000);

  it('features: refuses a step moved onto a doorway\'s lane, naming the Passage, the Hall and the step', () => {
    const { b, k, h, f } = featureHalls('split')[0]!;
    const pass = b.plan.passages.find((p) => p.a === k || p.b === k)!;
    const end = pass.a === k ? { q: pass.pieces[0]!, side: pass.pieces[0]!.from } : { q: pass.pieces[pass.pieces.length - 1]!, side: pass.pieces[pass.pieces.length - 1]!.to };
    const moved = withHall(b.plan, k, { feature: { ...f, steps: [{ ...f.steps[0]!, rect: lane(end.q.rect, end.side) }, ...f.steps.slice(1)] } as typeof f });
    expect(featureReasons(b.plan)).toEqual([]);
    expect(featureReasons(moved)).toContain(`features: ${pass.id}'s doorway into ${h.id} is blocked by ${h.id}-step0`);
  });

  it('features: refuses a tier edge moved half a metre (a Wall on the field\'s dots), and a cut under 4 m from the centre', () => {
    const { b, k, h, f } = featureHalls('split')[0]!;
    if (f.kind !== 'split') throw new Error('split');
    const half = (r: { x0: number; z0: number; x1: number; z1: number }, hi: boolean) => (f.axis === 'x' ? (hi ? { ...r, x1: r.x1 + 0.5 } : { ...r, x0: r.x0 + 0.5 }) : hi ? { ...r, z1: r.z1 + 0.5 } : { ...r, z0: r.z0 + 0.5 });
    const tiers = f.tiers.map((t, n) => (n === 0 ? { ...t, rect: half(t.rect, true) } : n === 1 ? { ...t, rect: half(t.rect, false) } : t));
    const reasons = featureReasons(withHall(b.plan, k, { feature: { ...f, tiers } }));
    expect(reasons.some((r) => r.startsWith(`features: ${h.id}-tier`) && r.endsWith(' has a Wall on the field\'s dots'))).toBe(true);
    // Only the cut moved: the tiers still tile, so no other tier rule fires.
    expect(reasons.every((r) => r.endsWith(' has a Wall on the field\'s dots'))).toBe(true);
    // A cut 2 m from the centre (on an odd metre) and nothing else wrong with the tiling.
    const c = f.axis === 'x' ? h.cx : h.cz;
    const cut = c + 2 + (Math.abs(c) % 2 === 0 ? 1 : 0);
    const near = f.tiers.map((t, n) => {
      const r = t.rect;
      const set = (lo: number | undefined, hi: number | undefined) => (f.axis === 'x' ? { ...r, x0: lo ?? r.x0, x1: hi ?? r.x1 } : { ...r, z0: lo ?? r.z0, z1: hi ?? r.z1 });
      return n === 0 ? { ...t, rect: set(undefined, cut) } : n === 1 ? { ...t, rect: set(cut, undefined) } : t;
    });
    expect(featureReasons(withHall(b.plan, k, { feature: { ...f, tiers: near } })).some((r) => r.includes('m from its centre') || r.includes('does not hold its centre'))).toBe(true);
  });

  it('features: refuses a marker moved off its tier, onto the outer tier\'s edge, naming the Hall\'s tier edge', () => {
    const { b, k, h, f } = featureHalls('split')[0]!;
    if (f.kind !== 'split') throw new Error('split');
    const main = f.tiers.find((t) => t.level === h.level)!;
    const x = f.axis === 'x' ? main.rect.x0 : h.cx;
    const z = f.axis === 'x' ? h.cz : main.rect.z0;
    const posts = b.plan.markers.posts.map((q, n) => (n === 0 ? { hall: k, x, y: h.y, z } : q));
    const moved = { ...b.plan, markers: { ...b.plan.markers, posts } };
    expect(featureReasons(moved)).toContain(`features: post0 stands within 1 m of ${h.id}'s tier edge`);
    const near = featureReasons({ ...b.plan, markers: { ...b.plan.markers, posts: posts.map((q, n) => (n === 0 ? { ...q, x: f.steps[0]!.rect.x0 - 0.5, z: (f.steps[0]!.rect.z0 + f.steps[0]!.rect.z1) / 2, y: f.tiers[0]!.y } : q)) } });
    expect(near).toContain(`features: post0 stands within 1 m of ${h.id}-step0`);
  });

  it('features: refuses a Passage\'s ya raised by 2, naming its Hall\'s floor', () => {
    const b = pool[0]!;
    const p = b.plan.passages.find((q) => q.pieces.length === 1 && q.ya === q.yb)!;
    const raised = { ...b.plan, passages: b.plan.passages.map((q) => (q === p ? { ...q, ya: q.ya + 2 } : q)) };
    expect(featureReasons(raised)).toEqual([`features: ${p.id}'s door into ${b.plan.halls[p.a]!.id} is at ${p.ya + 2}, its floor there at ${p.ya}`]);
    // Also on a pit's Hall, whose floor at every wall is its rim.
    const { b: pb, k, h, f } = featureHalls('pit')[0]!;
    const pp = pb.plan.passages.find((q) => q.a === k || q.b === k)!;
    expect(f.kind === 'pit' && f.rim).toBe(pp.a === k ? pp.ya : pp.yb);
    expect(h.y).not.toBe(f.kind === 'pit' ? f.rim : -1);
  });

  it('features: refuses a feature on a Hall with a gallery, a dais on a wall a Passage leaves by, and a pit not its rect less 4 m', () => {
    const { b, k, h, f } = featureHalls('pit')[0]!;
    if (f.kind !== 'pit') throw new Error('pit');
    const g = b.plan.halls.find((x) => x.gallery)!.gallery!;
    expect(featureReasons(withHall(b.plan, k, { gallery: g }))).toContain(`features: ${h.id}'s pit is not on a one-cell rect Hall without a gallery`);
    expect(featureReasons(withHall(b.plan, k, { feature: { ...f, pit: { ...f.pit, x0: f.pit.x0 + 2 } } }))).toContain(`features: ${h.id}'s pit is not its rect less 4 m`);
    const d = featureHalls('dais')[0]!;
    if (d.f.kind !== 'dais') throw new Error('dais');
    const side = d.f.side;
    const flipped = { ...d.f, side: (side === 'n' ? 's' : side === 'e' ? 'w' : side === 's' ? 'n' : 'e') as typeof side };
    expect(featureReasons(withHall(d.b.plan, d.k, { feature: flipped })).length).toBeGreaterThan(0);
  });

  it('tiers: a split whose main tier Platform is removed from the source does not compile (the rule is then skipped); a tier whose height is wrong is refused by tiers', () => {
    const { b, k, h, f } = featureHalls('split')[0]!;
    if (f.kind !== 'split') throw new Error('split');
    // The main tier's doors open 2 m over the floor left under it: the walk check refuses the source, so the judge's `compile:` line stands for the rule here.
    const reasons = judgeSource(b, { ...b.source, brushes: b.source.brushes.filter((br) => br.id !== `${h.id}-tier`) });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^compile: Soldiers cannot walk the whole map: Walk Surface WALK_hall\d+_0 cannot be walked to from /);
    // The rule itself, on the built Floor with a plan whose main tier claims another height: its centre is no floor at that height.
    const raised = { ...b.plan, halls: b.plan.halls.map((x, i) => (i === k ? { ...x, feature: { ...f, tiers: f.tiers.map((t) => (t.level === h.level ? { ...t, y: t.y + 4 } : t)) } } : x)) };
    const main = f.tiers.find((t) => t.level === h.level)!.rect;
    const got = judgeFields(tc, { ...b, plan: raised }).filter((r) => r.startsWith('tiers: '));
    expect(got).toEqual([`tiers: ${h.id}'s tier ${f.tiers.findIndex((t) => t.level === h.level)} (${(main.x0 + main.x1) / 2}, ${(main.z0 + main.z1) / 2}) at ${h.y + 4} is not at that height`]);
    expect(judgeFields(tc, b).filter((r) => r.startsWith('tiers: '))).toEqual([]);
  });

  it('tiers: a pit whose step Brushes are removed from the source does not compile (nothing climbs out of it); a dais and a pit rim whose heights are wrong are refused by tiers', () => {
    const { b, h } = featureHalls('pit')[0]!;
    // With no step the pit floor cannot be walked back from, which the walk check refuses before the judge's rule could read the fields.
    const reasons = judgeSource(b, { ...b.source, brushes: b.source.brushes.filter((br) => !br.id.startsWith(`${h.id}-step`)) });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^compile: Soldiers cannot walk the whole map: Walk Surface WALK_hall\d+_0 cannot walk back to /);
    const d = featureHalls('dais')[0]!;
    const dais = d.f;
    if (dais.kind !== 'dais') throw new Error('dais');
    const sunk = { ...d.b.plan, halls: d.b.plan.halls.map((x, i) => (i === d.k ? { ...x, feature: { ...dais, y: dais.y + 4 } } : x)) };
    expect(judgeFields(tc, { ...d.b, plan: sunk }).filter((r) => r.startsWith('tiers: ')).length).toBe(1);
    const p = featureHalls('pit')[0]!;
    const pit = p.f;
    if (pit.kind !== 'pit') throw new Error('pit');
    const high = { ...p.b.plan, halls: p.b.plan.halls.map((x, i) => (i === p.k ? { ...x, feature: { ...pit, rim: pit.rim + 4 } } : x)) };
    expect(judgeFields(tc, { ...p.b, plan: high }).some((r) => r.startsWith(`tiers: ${p.h.id}'s rim (`) && r.endsWith(' is not at that height'))).toBe(true);
  });

  it('galleries: refuses a wrapped gallery whose second Deck Brush is removed from the source', () => {
    const w = pool.flatMap((b) => b.plan.halls.flatMap((h) => (h.gallery?.wrap ? [{ b, h }] : [])))[0]!;
    const source = { ...w.b.source, brushes: w.b.source.brushes.filter((br) => br.id !== `${w.h.id}-deck1`) };
    const reasons = judgeSource(w.b, source);
    // The Deck's Brush gone, its centre stands on the Hall's floor, 2 m under it.
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(new RegExp(`^galleries: ${w.h.id}'s Deck 1 \\(.*\\) at ${w.h.gallery!.y} is not at that height$`));
  });

  it('builds a navmesh with no jump Link from a 4 m pit\'s floor, every shortcut Link within SHORTCUT_RISE, and Links onto a tier, a rim or a dais', () => {
    // A Floor with a 4 m pit; and (maybe another) with a 2 m pit, a split and a dais, for the ledges.
    let withPit: BuiltFloor | undefined = pool.find((b) => b.plan.halls.some((h) => h.feature?.kind === 'pit' && h.feature.depth === 4));
    for (let seed = 5; !withPit && seed < 40; seed++) {
      const f = delverFloor(t7, seed, 1);
      if (f.plan.halls.some((h) => h.feature?.kind === 'pit' && h.feature.depth === 4)) withPit = f;
    }
    expect(withPit).toBeDefined();
    const ledges = new Map<string, number>();
    const check = (b: BuiltFloor, deep: boolean) => {
      const name = floorArenaName(b.plan.seed, b.plan.floor);
      const tn = arenaTuning(t7, name);
      const arena = arenaOf(tn, name);
      const mesh = navMesh(arena, tn);
      const jumps = mesh.links.filter((l): l is JumpLink => l.kind === 'jump');
      expect(b.map.shortcuts).toBe(true);
      expect(jumps.length).toBeGreaterThan(0);
      for (const l of jumps) {
        expect(l.shortcut).toBe(true);
        const rise = l.lands.y - surfaceHeight(arena, l.from, l.takeoff.x, l.takeoff.z);
        expect(rise).toBeLessThanOrEqual(SHORTCUT_RISE + 1e-9);
        const id = arena.walk[l.to]!.id;
        for (const kind of ['tier', 'rim', 'dais']) if (new RegExp(`^WALK_hall\\d+-${kind}`).test(id)) ledges.set(kind, (ledges.get(kind) ?? 0) + 1);
      }
      if (!deep) return;
      for (const h of b.plan.halls) {
        const ft = h.feature;
        if (ft?.kind !== 'pit' || ft.depth !== 4) continue;
        const onPitFloor = (k: number) => arena.walk[k]!.id.startsWith(`WALK_${h.id}_`) && !arena.walk[k]!.roof && arena.walk[k]!.points.every((p) => p.y === h.y);
        expect(arena.walk.some((_, k) => onPitFloor(k))).toBe(true);
        expect(jumps.filter((l) => onPitFloor(l.from)), `${h.id}: no jump Link from its 4 m pit's floor`).toEqual([]);
      }
    };
    check(withPit!, true);
    // The ledges: the Floors of the pool with a feature, until each kind has been landed on.
    for (const b of pool) {
      if (['tier', 'rim', 'dais'].every((k) => ledges.has(k))) break;
      if (b !== withPit && b.plan.halls.some((h) => h.feature)) check(b, true);
    }
    expect(ledges.has('tier') || ledges.has('rim') || ledges.has('dais')).toBe(true);
  }, 600_000);

  it('describeFloor counts the splits, pits, daises and wrapped galleries', () => {
    for (const b of pool.slice(0, 12)) {
      const f = { ...b, attempts: 1, judgement: { ok: true, reasons: [] } } as DelverFloor;
      const hs = b.plan.halls;
      const splits = hs.filter((h) => h.feature?.kind === 'split');
      const pits = hs.filter((h) => h.feature?.kind === 'pit');
      const daises = hs.filter((h) => h.feature?.kind === 'dais');
      const wraps = hs.flatMap((h) => (h.gallery?.wrap ? [h.gallery.wrap] : []));
      const n = (xs: unknown[]) => xs.length;
      const text = `${n(splits)} split Halls (${n(splits.filter((h) => h.feature?.kind === 'split' && h.feature.tiers.length === 2))} two-tier, ${n(splits.filter((h) => h.feature?.kind === 'split' && h.feature.tiers.length === 3))} three-tier), ${n(pits)} pits (${n(pits.filter((h) => h.feature?.kind === 'pit' && h.feature.depth === 2))} 2 m, ${n(pits.filter((h) => h.feature?.kind === 'pit' && h.feature.depth === 4))} 4 m), ${n(daises)} daises (${n(daises.filter((h) => h.kind === 'Boss'))} thrones, ${n(daises.filter((h) => h.kind === 'Treasure'))} altars), ${n(wraps)} wrapped galleries (${n(wraps.filter((w) => w.walls.length === 1))} L, ${n(wraps.filter((w) => w.walls.length === 2))} U)`;
      expect(describeFloor(f)).toContain(`pillars in `);
      expect(describeFloor(f)).toContain(`, ${text}; passes the judge`);
    }
  });
});
