import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import type { Rect } from '../../mapEditor/source';
import { attemptSeed, planFloor, type FloorPlan } from './plan';

const t = loadTuningData().delver.floor;
const SEEDS = Array.from({ length: 50 }, (_, k) => k + 1);
const floorOf = (seed: number) => 1 + (seed % 9);
const plans = SEEDS.map((seed) => planFloor(t, seed, floorOf(seed), 0));
const full = plans.filter((p) => p.halls.length === t.rooms);

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const touches = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

function joinedHalls(p: FloorPlan, a: number, b: number): boolean {
  return p.passages.some((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a));
}

describe('planFloor', () => {
  it('is deterministic and plain data', () => {
    for (const seed of [1, 7, 4_000_000_000]) {
      const a = planFloor(t, seed, 2, 0);
      expect(planFloor(t, seed, 2, 0)).toEqual(a);
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    }
  });

  it('stalls rarely', () => {
    const stalls = plans.length - full.length;
    console.log(`stalled layouts in 50 seeds: ${stalls}`);
    expect(full.length).toBeGreaterThanOrEqual(45);
  });

  it('lays Halls and Passages on the lattice without overlap', () => {
    for (const p of full) {
      for (const h of p.halls) {
        expect(Number.isInteger(h.cx) && Number.isInteger(h.cz)).toBe(true);
        for (const v of [h.rect.x0, h.rect.x1, h.rect.z0, h.rect.z1]) expect(Math.abs(v)).toBeLessThanOrEqual(98);
        expect(h.rect.x1 - h.cx).toBe(h.cx - h.rect.x0);
      }
      p.halls.forEach((a, i) => p.halls.forEach((b, k) => i < k && expect(touches(a.rect, b.rect)).toBe(false)));
      p.passages.forEach((q, n) => {
        const a = p.halls[q.a]!;
        const b = p.halls[q.b]!;
        const half = t.passage / 2;
        if (q.axis === 'x') {
          expect(a.cz).toBe(b.cz);
          expect(q.rect).toEqual({ x0: a.rect.x1, x1: b.rect.x0, z0: a.cz - half, z1: a.cz + half });
          expect(a.doors.e).toBe(t.passage);
          expect(b.doors.w).toBe(t.passage);
        } else {
          expect(a.cx).toBe(b.cx);
          expect(q.rect).toEqual({ x0: a.cx - half, x1: a.cx + half, z0: a.rect.z1, z1: b.rect.z0 });
          expect(a.doors.n).toBe(t.passage);
          expect(b.doors.s).toBe(t.passage);
        }
        expect(q.length).toBe(Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz));
        expect(q.rect.x1 - q.rect.x0 > 0 && q.rect.z1 - q.rect.z0 > 0).toBe(true);
        const gap = q.axis === 'x' ? q.rect.x1 - q.rect.x0 : q.rect.z1 - q.rect.z0;
        if (Math.abs(a.i - b.i) + Math.abs(a.j - b.j) === 1) expect(gap).toBeGreaterThanOrEqual(t.minPassage);
        p.halls.forEach((h) => expect(overlaps(q.rect, h.rect)).toBe(false));
        p.passages.forEach((o, m) => m > n && expect(overlaps(q.rect, o.rect)).toBe(false));
      });
      // Doorways exist exactly where a Passage leaves, at most one per side.
      p.halls.forEach((h, k) => {
        const sides = Object.keys(h.doors).length;
        const leaving = p.passages.filter((q) => q.a === k || q.b === k).length;
        expect(sides).toBe(leaving);
        for (const wd of Object.values(h.doors)) expect(wd).toBe(t.passage);
      });
    }
  });

  it('keeps every Hall Wall on an odd metre, within the size and gap limits', () => {
    for (const p of full) {
      for (const h of p.halls) {
        for (const v of [h.rect.x0, h.rect.x1, h.rect.z0, h.rect.z1]) expect(((v % 2) + 2) % 2).toBe(1);
        for (const half of [h.rect.x1 - h.cx, h.rect.z1 - h.cz]) {
          expect(half).toBeGreaterThanOrEqual(t.halfSize[0]);
          expect(half).toBeLessThanOrEqual(t.halfSize[1]);
        }
      }
    }
    // The gap limits (Halls apart, Passages at least minPassage) are checked in the lattice test above, over the same plans.
  });

  it('joins every Hall: a spanning tree plus loops', () => {
    for (const p of full) {
      const seen = new Set<number>([0]);
      const queue = [0];
      for (let q = 0; q < queue.length; q++) {
        for (const e of p.passages) {
          const o = e.a === queue[q] ? e.b : e.b === queue[q] ? e.a : -1;
          if (o >= 0 && !seen.has(o)) {
            seen.add(o);
            queue.push(o);
          }
        }
      }
      expect(seen.size).toBe(p.halls.length);
      expect(p.passages.filter((e) => !e.loop).length).toBe(p.halls.length - 1);
      const loops = p.passages.filter((e) => e.loop).length;
      expect(loops).toBeLessThanOrEqual(t.loops[1]);
      p.passages.forEach((e, n) => expect(e.id).toBe(`pass${n}`));
      // Tree Passages come first.
      p.passages.forEach((e, n) => expect(e.loop).toBe(n >= p.halls.length - 1));
    }
  });

  it('assigns kinds, the main path, markers and patrols by the rules', () => {
    for (const p of full) {
      const kinds = p.halls.map((h) => h.kind);
      expect(kinds.filter((k) => k === 'Entrance')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'Stairs')).toHaveLength(1);
      expect(kinds[p.entrance]).toBe('Entrance');
      expect(kinds[p.stairs]).toBe('Stairs');
      const count = (h: number) => p.passages.filter((e) => e.a === h || e.b === h).length;
      if (p.halls.some((_, h) => count(h) === 1)) expect(count(p.entrance)).toBe(1);
      expect(p.halls[p.entrance]!.depth).toBe(0);
      expect(p.halls[p.stairs]!.depth).toBe(Math.max(...p.halls.map((h) => h.depth)));

      expect(p.mainPath[0]).toBe(p.entrance);
      expect(p.mainPath[p.mainPath.length - 1]).toBe(p.stairs);
      p.mainPath.forEach((h, k) => {
        if (k === 0) return;
        expect(joinedHalls(p, p.mainPath[k - 1]!, h)).toBe(true);
        expect(p.halls[h]!.depth).toBeGreaterThan(p.halls[p.mainPath[k - 1]!]!.depth);
      });

      const rests = p.halls.flatMap((h, k) => (h.kind === 'Rest' ? [k] : []));
      expect(rests.length).toBeGreaterThanOrEqual(1);
      expect(rests.length).toBeLessThanOrEqual(t.rests[1]);
      if (p.mainPath.length > 2) expect(rests.some((h) => p.mainPath.includes(h))).toBe(true);
      const treasures = p.halls.flatMap((h, k) => (h.kind === 'Treasure' ? [k] : []));
      expect(treasures.length).toBeLessThanOrEqual(t.treasures);
      for (const h of treasures) expect(p.mainPath.includes(h)).toBe(false);
      for (const h of p.inLine) expect(p.halls[h]!.kind).not.toBe('Fight');

      const m = p.markers;
      const centres = (ks: number[]) => ks.map((h) => ({ hall: h, x: p.halls[h]!.cx, z: p.halls[h]!.cz }));
      expect(m.posts).toEqual(centres(p.halls.flatMap((h, k) => (h.kind === 'Fight' ? [k] : []))));
      expect(m.fires).toEqual(centres(rests));
      expect(m.pedestals).toHaveLength(3 * treasures.length);
      expect(m.spawns).toHaveLength(4);
      const e = p.halls[p.entrance]!;
      for (const s of m.spawns) {
        expect(s.hall).toBe(p.entrance);
        expect(s.x).toBeGreaterThan(e.rect.x0 + 1);
        expect(s.x).toBeLessThan(e.rect.x1 - 1);
        expect(s.z).toBeGreaterThan(e.rect.z0 + 1);
        expect(s.z).toBeLessThan(e.rect.z1 - 1);
      }
      expect(m.stairs.hall).toBe(p.stairs);

      expect(m.patrols.length).toBeLessThanOrEqual(t.patrols);
      for (const pt of m.patrols) {
        expect(pt.halls.length).toBeGreaterThanOrEqual(4);
        expect(pt.points).toHaveLength(pt.halls.length);
        pt.halls.forEach((h, k) => {
          expect(joinedHalls(p, h, pt.halls[(k + 1) % pt.halls.length]!)).toBe(true);
          expect(h).not.toBe(p.entrance);
          expect(p.inLine.includes(h)).toBe(false);
        });
      }
    }
  });

  it('gives each attempt its own layout', () => {
    const seeds = Array.from({ length: 10 }, (_, a) => attemptSeed(12345, 3, a));
    expect(seeds[0]).toBe(12345);
    expect(new Set(seeds).size).toBe(10);
    expect(planFloor(t, 12345, 3, 1)).not.toEqual(planFloor(t, 12345, 3, 0));
  });

  it('exercises every feature across 50 seeds', () => {
    const maxGap = Math.max(...t.gaps);
    expect(full.some((p) => p.passages.some((q) => q.length > maxGap))).toBe(true);
    expect(full.some((p) => p.passages.some((q) => q.loop))).toBe(true);
    expect(full.some((p) => p.markers.patrols.length > 0)).toBe(true);
    expect(full.some((p) => p.halls.some((h) => h.kind === 'Treasure'))).toBe(true);
    const restCounts = new Set(full.map((p) => p.halls.filter((h) => h.kind === 'Rest').length));
    expect(restCounts.has(1) && restCounts.has(2)).toBe(true);
    expect(full.some((p) => p.halls.some((h) => h.kind === 'Empty'))).toBe(true);
    expect(full.some((p) => p.halls.some((h) => h.kind === 'Fight'))).toBe(true);
  });
});
