import { beforeAll, describe, expect, it } from 'vitest';
import { checkMap } from '../../mapEditor/checks';
import { MapCompileError, mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { arenaOf, deadly } from '../arena';
import { groundOf } from '../battlefield';
import { navMesh, type JumpLink } from '../nav';
import { arenaTuning, floorArenaName } from './world';
import { buildFloor, buildFromSource, delverFloor, describeFloor, judgeAttempt, judgeBuilt, judgeFloor, judgePlan, planFloor, type BuiltFloor, type DelverFloor, type FloorPlan } from './index';

const tuning = loadTuningData();
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
    expect(judgePlan(t, flat)).toEqual([`levels: 1 Hall level, at least ${t.levels.min} wanted`]);
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
