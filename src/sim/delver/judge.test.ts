import { beforeAll, describe, expect, it } from 'vitest';
import { MapCompileError, mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { deadly } from '../arena';
import { groundOf } from '../battlefield';
import { buildFloor, buildFromSource, delverFloor, describeFloor, judgeBuilt, judgeFloor, judgePlan, planFloor, type BuiltFloor, type DelverFloor, type FloorPlan } from './index';

const tuning = loadTuningData();
const t = tuning.delver.floor;

/** Real Floors, built once and reused: the tests below mutate copies of their plans and sources, never the Floors. */
let floors: DelverFloor[];
/** A Floor whose plan has Halls in line with its Entrance, found by seed. */
let inLine: DelverFloor;

beforeAll(() => {
  floors = [1, 2, 3].map((seed) => delverFloor(tuning, seed, 1));
  const seed = Array.from({ length: 60 }, (_, k) => k + 1).find((s) => planFloor(t, s, 1, 0).inLine.length > 0)!;
  inLine = delverFloor(tuning, seed, 1);
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
      expect(f.attempts).toBe(1);
      expect(judgeBuilt(t, f)).toEqual([]);
      expect(judgeFloor(tuning, f.plan).judgement.ok).toBe(true);
    }
  });

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

  it('halls: refuses a Hall whose centre is in the abyss', () => {
    const b = good();
    const at = abyssPoint(b);
    const k = (b.plan.entrance + 1) % b.plan.halls.length;
    const plan = { ...b.plan, halls: b.plan.halls.map((h, i) => (i === k ? { ...h, cx: at.x, cz: at.z } : h)) };
    const reasons = judgeBuilt(t, withPlan(b, plan));
    expect(reasons.some((r) => r.startsWith(`halls: ${plan.halls[k]!.id} `))).toBe(true);
  });

  it('passages: refuses a loop Passage whose Brush is gone, the Halls then reached the long way round', () => {
    const b = good();
    const loop = b.plan.passages.find((p) => p.loop)!;
    expect(loop).toBeDefined();
    const source = { ...b.source, brushes: b.source.brushes.filter((br) => br.id !== loop.id) };
    const cut = buildFromSource(tuning, b.plan, source);
    const reasons = judgeBuilt(t, cut);
    expect(reasons.some((r) => r.startsWith(`passages: ${loop.id} `))).toBe(true);
    // The tree's Passages are still followed.
    expect(reasons.filter((r) => r.startsWith('passages:'))).toHaveLength(1);
    expect(reasons.filter((r) => r.startsWith('halls:'))).toEqual([]);
  });

  it('markers: refuses a fire in the abyss, and a post in another Hall', () => {
    const b = good();
    const at = abyssPoint(b);
    const fire = b.plan.markers.fires[0]!;
    const inAbyss = { ...b.plan, markers: { ...b.plan.markers, fires: [{ hall: fire.hall, ...at }, ...b.plan.markers.fires.slice(1)] } };
    expect(judgeBuilt(t, withPlan(b, inAbyss)).some((r) => r.startsWith('markers: fire0 '))).toBe(true);

    const post = b.plan.markers.posts[0]!;
    const other = b.plan.halls[(post.hall + 1) % b.plan.halls.length]!;
    const wrongHall = { ...b.plan, markers: { ...b.plan.markers, posts: [{ hall: post.hall, x: other.cx, z: other.cz }, ...b.plan.markers.posts.slice(1)] } };
    expect(judgeBuilt(t, withPlan(b, wrongHall)).some((r) => r.startsWith('markers: post0 ') && r.includes(b.plan.halls[post.hall]!.id))).toBe(true);
  });

  it('sight: refuses a post in the first Hall in line with the Entrance, naming it', () => {
    const b = inLine;
    const h = b.plan.halls[b.plan.inLine[0]!]!;
    const posts = [{ hall: b.plan.inLine[0]!, x: h.cx, z: h.cz }, ...b.plan.markers.posts.slice(1)];
    const moved = withPlan(b, { ...b.plan, markers: { ...b.plan.markers, posts } });
    const reasons = judgeBuilt(t, moved);
    expect(reasons.filter((r) => r.startsWith('sight: post0 ') && r.includes(h.id))).toHaveLength(1);
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
