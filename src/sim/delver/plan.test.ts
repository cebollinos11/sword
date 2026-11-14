import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import { MAX_SIZE } from '../../tuning/size';
import type { Rect, Side } from '../../mapEditor/source';
import { runPick } from '../dungeon';
import { flatFloors } from './flat.testdata';
import {
  attemptSeed, CENTRE_CLEAR, DECK_MIN, DECK_POST, GALLERY_APPROACH, GALLERY_DEPTH, GALLERY_RAMP, GALLERY_STOREY, HALL_STOREY, JUMP_SHORTCUT_CAP, LEVEL_RISE, MAX_SLOPE, planFloor, SALT,
  STAIRS_HALF, type DelverHall, type FloorPlan,
} from './plan';

const tuning = loadTuningData();
const t = tuning.delver.floor;
const SEEDS = Array.from({ length: 50 }, (_, k) => k + 1);
const floorOf = (seed: number) => 1 + (seed % 9);
const plans = SEEDS.map((seed) => planFloor(t, seed, floorOf(seed), 0));
const full = plans.filter((p) => p.halls.length === t.rooms);

/** Whether a marker stands on its Hall's Deck of at least `DECK_POST` m (a Deck post). */
const onDeck = (h: DelverHall, q: { x: number; y: number; z: number }): boolean => !!h.gallery && q.y === h.gallery.y;

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
        // A Hall's doors list the Passages attached at its floor, not those through a gallery's wall.
        const door = (h: DelverHall, side: Side) => (h.gallery?.side === side ? undefined : t.passage);
        if (q.axis === 'x') {
          expect(a.cz).toBe(b.cz);
          expect(q.rect).toEqual({ x0: a.rect.x1, x1: b.rect.x0, z0: a.cz - half, z1: a.cz + half });
          expect(a.doors.e).toBe(door(a, 'e'));
          expect(b.doors.w).toBe(door(b, 'w'));
        } else {
          expect(a.cx).toBe(b.cx);
          expect(q.rect).toEqual({ x0: a.cx - half, x1: a.cx + half, z0: a.rect.z1, z1: b.rect.z0 });
          expect(a.doors.n).toBe(door(a, 'n'));
          expect(b.doors.s).toBe(door(b, 's'));
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
        const sideOf = (q: FloorPlan['passages'][number]): Side => (q.a === k ? (q.axis === 'x' ? 'e' : 'n') : q.axis === 'x' ? 'w' : 's');
        const leaving = p.passages.filter((q) => (q.a === k || q.b === k) && h.gallery?.side !== sideOf(q)).length;
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
      const centres = (ks: number[]) => ks.map((h) => ({ hall: h, x: p.halls[h]!.cx, y: p.halls[h]!.y, z: p.halls[h]!.cz }));
      // A post stands at its Hall's centre, but on a long enough Deck (checked below).
      expect(m.posts.map((q) => q.hall)).toEqual(p.halls.flatMap((h, k) => (h.kind === 'Fight' ? [k] : [])));
      m.posts.forEach((q) => !onDeck(p.halls[q.hall]!, q) && expect(q).toEqual(centres([q.hall])[0]));
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

  describe('Boss Halls', () => {
    const pairs = Array.from({ length: 200 }, (_, k) => ({ seed: k + 1, floor: 1 + (k % 9) }));
    /** What a Boss plan was before its Boss changes: the kind back to Stairs, the Hall's and its Passages' rects, and `markers.boss` removed. */
    const undone = (boss: FloorPlan, plain: FloorPlan): FloorPlan => {
      const { boss: _boss, ...markers } = boss.markers;
      return {
        ...boss,
        // Its gallery, if any, is worked out from the Hall's rect, so it grows with it (`high` is the Hall's, not the rect's).
        halls: boss.halls.map((h, k) => (k === boss.stairs ? { ...h, kind: 'Stairs' as const, rect: plain.halls[k]!.rect, gallery: plain.halls[k]!.gallery } : h)),
        passages: boss.passages.map((p, n) => (p.a === boss.stairs || p.b === boss.stairs ? { ...p, rect: plain.passages[n]!.rect } : p)),
        markers,
      };
    };

    it('boss false is the plan as it was: no Boss key anywhere', () => {
      for (const { seed, floor } of pairs.slice(0, 40)) {
        const p = planFloor(t, seed, floor, 0);
        expect(planFloor(t, seed, floor, 0, false)).toEqual(p);
        expect(JSON.stringify(p)).not.toMatch(/boss|Boss/);
      }
    });

    it('boss true differs from boss false only by the Boss Hall, its Passages\' rects and markers.boss', () => {
      let bosses = 0;
      for (const { seed, floor } of pairs) {
        const plain = planFloor(t, seed, floor, 0, false);
        const boss = planFloor(t, seed, floor, 0, true);
        expect(undone(boss, plain)).toEqual(plain);
        if (boss.stairs === boss.entrance) {
          // A one-Hall layout has no Stairs apart from its Entrance: nothing changes.
          expect(boss).toEqual(plain);
          continue;
        }
        bosses++;
        const h = boss.halls[boss.stairs]!;
        expect(h.kind).toBe('Boss');
        expect(boss.halls.filter((x) => x.kind === 'Stairs')).toHaveLength(0);
        expect(boss.markers.boss).toEqual({ hall: boss.stairs, x: h.cx, y: h.y, z: h.cz });
        expect(boss.markers.stairs).toEqual({ hall: boss.stairs, zone: { x0: h.cx - STAIRS_HALF, z0: h.cz - STAIRS_HALF, x1: h.cx + STAIRS_HALF, z1: h.cz + STAIRS_HALF }, y: h.y });
        expect(h.depth).toBe(plain.halls[boss.stairs]!.depth);
        // As large as its gaps allow: the lattice's gaps by the same picks as the plan's step 1.
        const gx = Array.from({ length: t.cols - 1 }, (_, k) => t.gaps[runPick(seed >>> 0, floor, k, SALT.gapX, t.gaps.length)]!);
        const gz = Array.from({ length: t.rows - 1 }, (_, k) => t.gaps[runPick(seed >>> 0, floor, k, SALT.gapZ, t.gaps.length)]!);
        const limX = Math.floor((Math.min(...[...(h.i > 0 ? [gx[h.i - 1]!] : []), ...(h.i < t.cols - 1 ? [gx[h.i]!] : [])]) - t.minPassage) / 2);
        const limZ = Math.floor((Math.min(...[...(h.j > 0 ? [gz[h.j - 1]!] : []), ...(h.j < t.rows - 1 ? [gz[h.j]!] : [])]) - t.minPassage) / 2);
        const dots = (half: number, centre: number, lim: number) => (((centre + half) % 2) + 2) % 2 !== 0 ? half : half - 1 >= t.halfSize[0] ? half - 1 : half + 1 <= lim ? half + 1 : half;
        expect(h.rect.x1 - h.cx).toBe(dots(Math.min(t.halfSize[1], limX), h.cx, limX));
        expect(h.rect.z1 - h.cz).toBe(dots(Math.min(t.halfSize[1], limZ), h.cz, limZ));
        expect(h.rect.x1 - h.cx).toBeLessThanOrEqual(limX);
        expect(h.rect.z1 - h.cz).toBeLessThanOrEqual(limZ);
        expect(h.rect.x1 - h.cx).toBeGreaterThanOrEqual(plain.halls[boss.stairs]!.rect.x1 - h.cx);
        // It touches no other Hall and no Passage but its own.
        boss.halls.forEach((o, k) => k !== boss.stairs && expect(touches(h.rect, o.rect)).toBe(false));
        boss.passages.forEach((q) => {
          if (q.a !== boss.stairs && q.b !== boss.stairs) expect(overlaps(h.rect, q.rect)).toBe(false);
        });
      }
      expect(bosses).toBeGreaterThan(150);
    });
  });
});

describe('levels, galleries and sloped Passages', () => {
  const pairs = Array.from({ length: 200 }, (_, k) => ({ seed: k + 1, floor: 1 + (k % 9) }));
  const levelled = pairs.map(({ seed, floor }) => planFloor(t, seed, floor, 0, floor % 3 === 0)).filter((p) => p.halls.length === t.rooms);
  const sideOf = (p: FloorPlan, q: FloorPlan['passages'][number], end: 'a' | 'b'): { hall: DelverHall; side: Side } =>
    end === 'a' ? { hall: p.halls[q.a]!, side: q.axis === 'x' ? 'e' : 'n' } : { hall: p.halls[q.b]!, side: q.axis === 'x' ? 'w' : 's' };
  const galleries = levelled.flatMap((p) => p.halls.flatMap((h) => (h.gallery ? [{ p, h, g: h.gallery }] : [])));

  it('keeps the constants the Design fixes', () => {
    expect(LEVEL_RISE).toBe(2);
    expect(LEVEL_RISE).toBeLessThanOrEqual(JUMP_SHORTCUT_CAP);
    expect(LEVEL_RISE / GALLERY_RAMP).toBe(MAX_SLOPE);
    expect(GALLERY_STOREY - LEVEL_RISE).toBeGreaterThanOrEqual(tuning.fighter.height * MAX_SIZE);
    expect(2 * LEVEL_RISE).toBeLessThanOrEqual(t.minPassage);
  });

  it('puts every Hall at a whole level from 0 to levels.max, with its roof over it', () => {
    for (const p of levelled) {
      for (const h of p.halls) {
        expect(Number.isInteger(h.level) && h.level >= 0 && h.level <= t.levels.max).toBe(true);
        expect(h.y).toBe(h.level * LEVEL_RISE);
        expect(h.top).toBe(h.y + (h.gallery ? GALLERY_STOREY : HALL_STOREY));
        // The Deck's headroom (a Fighter of the largest Size stands under the roof).
        if (h.gallery) expect(h.top - h.gallery.y).toBeGreaterThanOrEqual(tuning.fighter.height * MAX_SIZE);
      }
    }
  });

  it('keeps every Passage at most a level from flat, equal through a gallery\'s wall, and never steeper than 1 in 2', () => {
    for (const p of levelled) {
      for (const q of p.passages) {
        for (const [end, y] of [['a', q.ya], ['b', q.yb]] as const) {
          const { hall, side } = sideOf(p, q, end);
          expect(y).toBe(hall.y + (hall.gallery?.side === side ? LEVEL_RISE : 0));
        }
        expect(Math.abs(q.ya - q.yb)).toBeLessThanOrEqual(LEVEL_RISE);
        if (sideOf(p, q, 'a').hall.gallery?.side === sideOf(p, q, 'a').side || sideOf(p, q, 'b').hall.gallery?.side === sideOf(p, q, 'b').side) expect(q.ya).toBe(q.yb);
        const run = q.axis === 'x' ? q.rect.x1 - q.rect.x0 : q.rect.z1 - q.rect.z0;
        expect(Math.abs(q.ya - q.yb) / run).toBeLessThanOrEqual(MAX_SLOPE);
      }
    }
  });

  it('cuts every gallery from its Hall\'s rect: Deck, Ramp and approach along the wall, in the strip, the Deck covering a stairwell\'s door', () => {
    for (const { p, h, g } of galleries) {
      const r = h.rect;
      const alongX = g.side === 'n' || g.side === 's';
      const u = (b: Rect): [number, number] => (alongX ? [b.x0, b.x1] : [b.z0, b.z1]);
      const v = (b: Rect): [number, number] => (alongX ? [b.z0, b.z1] : [b.x0, b.x1]);
      const [u0, u1] = alongX ? [r.x0, r.x1] : [r.z0, r.z1];
      // The strip: GALLERY_DEPTH in from the wall.
      const wall = g.side === 'n' ? r.z1 : g.side === 'e' ? r.x1 : g.side === 's' ? r.z0 : r.x0;
      const high = g.side === 'n' || g.side === 'e';
      for (const b of [g.deck, g.ramp]) expect(v(b)).toEqual(high ? [wall - GALLERY_DEPTH, wall] : [wall, wall + GALLERY_DEPTH]);
      const [d0, d1] = u(g.deck);
      const [r0, r1] = u(g.ramp);
      expect(r1 - r0).toBe(GALLERY_RAMP);
      expect(d1 - d0).toBeGreaterThanOrEqual(DECK_MIN);
      if (g.end === 0) {
        expect([d0, d1, r0, r1, g.up]).toEqual([u0, u1 - GALLERY_APPROACH - GALLERY_RAMP, u1 - GALLERY_APPROACH - GALLERY_RAMP, u1 - GALLERY_APPROACH, alongX ? 'w' : 's']);
      } else {
        expect([d0, d1, r0, r1, g.up]).toEqual([u0 + GALLERY_APPROACH + GALLERY_RAMP, u1, u0 + GALLERY_APPROACH, u0 + GALLERY_APPROACH + GALLERY_RAMP, alongX ? 'e' : 'n']);
      }
      // Disjoint, inside the Hall, clear of the centre.
      expect(overlaps(g.deck, g.ramp)).toBe(false);
      for (const b of [g.deck, g.ramp]) expect(b.x0 >= r.x0 && b.x1 <= r.x1 && b.z0 >= r.z0 && b.z1 <= r.z1).toBe(true);
      const inner = high ? wall - GALLERY_DEPTH : wall + GALLERY_DEPTH;
      expect(Math.abs(inner - (alongX ? h.cz : h.cx))).toBeGreaterThanOrEqual(CENTRE_CLEAR);
      // Every edge off the 2 m dots.
      for (const e of [d0, d1, r0, r1, inner]) expect(((e % 2) + 2) % 2).toBe(1);
      expect(g.y).toBe(h.y + LEVEL_RISE);
      // A stairwell: a Passage leaves through this wall at the Deck's height, over the Deck with a metre each side. Else none does.
      const through = p.passages.filter((q) => ([sideOf(p, q, 'a'), sideOf(p, q, 'b')] as const).some((e) => e.hall === h && e.side === g.side));
      expect(g.high).toBe(through.length > 0);
      for (const q of through) {
        expect(q.ya).toBe(g.y);
        expect(q.yb).toBe(g.y);
        const c = alongX ? h.cx : h.cz;
        expect(d0).toBeLessThanOrEqual(c - t.passage / 2 - 1);
        expect(d1).toBeGreaterThanOrEqual(c + t.passage / 2 + 1);
      }
    }
  });

  it('stands every marker on its Hall\'s floor or Deck, and a post on a long enough Deck', () => {
    for (const p of levelled) {
      const m = p.markers;
      const all = [...m.spawns, ...m.fires, ...m.pedestals, ...m.posts, ...(m.boss ? [m.boss] : [])];
      for (const q of all) {
        const h = p.halls[q.hall]!;
        expect(q.y === h.y || q.y === h.gallery?.y).toBe(true);
      }
      for (const q of [...m.spawns, ...m.fires, ...m.pedestals]) expect(q.y).toBe(p.halls[q.hall]!.y);
      expect(m.stairs.y).toBe(p.halls[m.stairs.hall]!.y);
      m.patrols.forEach((pt) => pt.halls.forEach((h, k) => expect(pt.points[k]!.y).toBe(p.halls[h]!.y)));
      p.halls.forEach((h, k) => {
        if (h.kind !== 'Fight') return;
        const post = m.posts.find((q) => q.hall === k)!;
        const g = h.gallery;
        const long = g && (g.side === 'n' || g.side === 's' ? g.deck.x1 - g.deck.x0 : g.deck.z1 - g.deck.z0) >= DECK_POST;
        if (!g || !long) return expect(post.y).toBe(h.y);
        expect(post.y).toBe(g.y);
        expect(post.x > g.deck.x0 && post.x < g.deck.x1 && post.z > g.deck.z0 && post.z < g.deck.z1).toBe(true);
        // 2 m in from the wall, at the Deck's centre along it.
        const r = h.rect;
        const wallDist = g.side === 'n' ? r.z1 - post.z : g.side === 's' ? post.z - r.z0 : g.side === 'e' ? r.x1 - post.x : post.x - r.x0;
        expect(wallDist).toBe(2);
        expect(g.side === 'n' || g.side === 's' ? post.x : post.z).toBe(g.side === 'n' || g.side === 's' ? (g.deck.x0 + g.deck.x1) / 2 : (g.deck.z0 + g.deck.z1) / 2);
      });
    }
  });

  it('is Stage 5\'s plan plus the new fields on a flat Tuning: level 0, y 0, roofs at 4, no gallery, no slopes', () => {
    const flat = flatFloors(tuning).delver.floor;
    for (const { seed, floor } of pairs.slice(0, 60)) {
      const p = planFloor(flat, seed, floor, 0, floor % 3 === 0);
      expect(JSON.stringify(p)).not.toMatch(/gallery/);
      for (const h of p.halls) expect([h.level, h.y, h.top]).toEqual([0, 0, HALL_STOREY]);
      for (const q of p.passages) expect([q.ya, q.yb]).toEqual([0, 0]);
      const m = p.markers;
      for (const q of [...m.spawns, ...m.fires, ...m.pedestals, ...m.posts, ...(m.boss ? [m.boss] : [])]) expect(q.y).toBe(0);
      expect(m.stairs.y).toBe(0);
      // The same tree as the levelled plan (its loops may differ, and so the Stairs and a Boss Hall's growth: a non-Boss Floor is compared).
      if (floor % 3 === 0) continue;
      const l = planFloor(t, seed, floor, 0);
      p.passages.forEach((q, n) => !q.loop && expect(l.passages[n]!.rect).toEqual(q.rect));
    }
  });

  it('makes no new pick on a flat Tuning', () => {
    // levelBase, levelChange, levelUp and the gallery picks are never made: a changed salt for them changes nothing.
    const flat = flatFloors(tuning).delver.floor;
    const a = planFloor(flat, 5, 2, 0);
    expect(planFloor({ ...flat, levels: { max: 0, min: 1, changePercent: 100, galleryPercent: 0 } }, 5, 2, 0)).toEqual(a);
    expect(SALT.galleryOrder).toBe(30);
    expect([SALT.gallerySide, SALT.galleryEnd, SALT.levelBase, SALT.levelChange, SALT.levelUp]).toEqual([31, 32, 33, 34, 35]);
  });

  it('exercises every feature across 200 seeds and Floors 1 to 9', () => {
    const levelCounts = levelled.map((p) => new Set(p.halls.map((h) => h.level)).size);
    expect(levelled.length).toBeGreaterThanOrEqual(180);
    expect(levelCounts.filter((n) => n >= 2).length).toBeGreaterThan(100);
    expect(levelCounts.filter((n) => n >= 3).length).toBeGreaterThan(20);
    expect(galleries.some((x) => !x.g.high)).toBe(true);
    expect(galleries.some((x) => x.g.high)).toBe(true);
    expect(levelled.some((p) => p.passages.some((q) => q.ya !== q.yb))).toBe(true);
    expect(levelled.some((p) => p.markers.posts.some((q) => q.y > 0 && onDeck(p.halls[q.hall]!, q)))).toBe(true);
    expect(galleries.some((x) => x.g.end === 0) && galleries.some((x) => x.g.end === 1)).toBe(true);
    for (const side of ['n', 'e', 's', 'w']) expect(galleries.some((x) => x.g.side === side)).toBe(true);
  });
});
