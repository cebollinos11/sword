import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import { MAX_SIZE } from '../../tuning/size';
import type { Rect, Side } from '../../mapEditor/source';
import { runPick } from '../dungeon';
import { flatFloors, flatRooms, rooms7a } from './flat.testdata';
import { isBossFloor } from './troops';
import {
  attemptSeed, CENTRE_CLEAR, DECK_MIN, DECK_POST, GALLERY_APPROACH, GALLERY_DEPTH, GALLERY_RAMP, GALLERY_STOREY, HALL_STOREY, JUMP_SHORTCUT_CAP, LEVEL_RISE, MAX_SLOPE, MIN_LEG, PASSAGE_CLEAR,
  passagePieces, planFloor, SALT, STAIRS_HALF, type DelverHall, type DelverPassage, type FloorPlan, type PassagePiece,
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
    /** What a Boss plan was before its Boss changes: the kind back to Stairs, the Hall's and its Passages' rects (and pieces), and `markers.boss` removed. */
    const undone = (boss: FloorPlan, plain: FloorPlan): FloorPlan => {
      const { boss: _boss, ...markers } = boss.markers;
      return {
        ...boss,
        // Its gallery, if any, is worked out from the Hall's rect, so it grows with it (`high` is the Hall's, not the rect's).
        halls: boss.halls.map((h, k) => (k === boss.stairs ? { ...h, kind: 'Stairs' as const, rect: plain.halls[k]!.rect, gallery: plain.halls[k]!.gallery } : h)),
        passages: boss.passages.map((p, n) => (p.a === boss.stairs || p.b === boss.stairs ? { ...p, rect: plain.passages[n]!.rect, pieces: plain.passages[n]!.pieces } : p)),
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


describe('great halls and turning Passages (Stage 7a)', () => {
  const t7 = rooms7a(tuning).delver.floor;
  const w = t7.passage;
  const pairs = Array.from({ length: 200 }, (_, k) => ({ seed: k + 1, floor: 1 + (k % 9) }));
  const plans7 = pairs.map(({ seed, floor }) => planFloor(t7, seed, floor, 0, isBossFloor(tuning.delver, floor)));
  const done = pairs.map((pr, k) => ({ ...pr, p: plans7[k]! })).filter((x) => x.p.halls.length === t7.rooms);

  const opp: Record<Side, Side> = { n: 's', e: 'w', s: 'n', w: 'e' };
  const VEC: Record<Side, [number, number]> = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] };
  /** The coordinate of a rect's `side` edge. */
  const edge = (r: Rect, side: Side): number => (side === 'e' ? r.x1 : side === 'w' ? r.x0 : side === 'n' ? r.z1 : r.z0);
  /** A rect's extent along the axis a `side` edge runs. */
  const along = (r: Rect, side: Side): [number, number] => (side === 'e' || side === 'w' ? [r.z0, r.z1] : [r.x0, r.x1]);
  const gapOf = (a: Rect, b: Rect) => Math.max(Math.max(a.x0 - b.x1, b.x0 - a.x1), Math.max(a.z0 - b.z1, b.z0 - a.z1));
  /** The lattice of a (seed, Floor) by the plan's step 1. */
  const latticeOf = (seed: number, floor: number) => {
    const at = (gaps: number[]) => {
      const out = [-gaps.reduce((a, g) => a + g, 0) / 2];
      for (const g of gaps) out.push(out[out.length - 1]! + g);
      return out;
    };
    return {
      X: at(Array.from({ length: t7.cols - 1 }, (_, k) => t7.gaps[runPick(seed >>> 0, floor, k, SALT.gapX, t7.gaps.length)]!)),
      Z: at(Array.from({ length: t7.rows - 1 }, (_, k) => t7.gaps[runPick(seed >>> 0, floor, k, SALT.gapZ, t7.gaps.length)]!)),
    };
  };
  /** The centre lines a Hall has on a side: one per cell it covers (an x for n and s, a z for e and w). */
  const linesOn = (h: DelverHall, side: Side, lat: ReturnType<typeof latticeOf>): number[] =>
    h.cells.map((c) => (side === 'n' || side === 's' ? lat.X[c % t7.cols]! : lat.Z[Math.floor(c / t7.cols)]!));
  const lineOf = (q: PassagePiece): number => (q.axis === 'x' ? (q.rect.z0 + q.rect.z1) / 2 : (q.rect.x0 + q.rect.x1) / 2);
  const legsOf = (q: DelverPassage) => q.pieces.filter((x) => !x.corner);
  const ends = (q: DelverPassage) => [
    { hall: q.a, side: q.sideA, piece: q.pieces[0]! },
    { hall: q.b, side: q.sideB, piece: q.pieces[q.pieces.length - 1]! },
  ];

  it('stalls rarely', () => {
    const stalls = plans7.length - done.length;
    console.log(`stalled 7a layouts in 200 pairs: ${stalls}`);
    expect(done.length).toBeGreaterThanOrEqual(185);
  });

  it('keeps every Hall Wall on an odd metre, the one-cell halves in halfSize and a great hall over two neighbouring cells', () => {
    for (const { seed, floor, p } of done) {
      const lat = latticeOf(seed, floor);
      for (const h of p.halls) {
        for (const v of [h.rect.x0, h.rect.x1, h.rect.z0, h.rect.z1]) expect(((v % 2) + 2) % 2).toBe(1);
        expect(h.great).toBe(h.cells.length === 2);
        expect(h.cells[0]).toBe(h.j * t7.cols + h.i);
        expect(h.cx).toBe((h.rect.x0 + h.rect.x1) / 2);
        expect(h.cz).toBe((h.rect.z0 + h.rect.z1) / 2);
        const [hx, hz] = [(h.rect.x1 - h.rect.x0) / 2, (h.rect.z1 - h.rect.z0) / 2];
        if (!h.great) {
          expect(h.cells).toEqual([h.j * t7.cols + h.i]);
          expect([h.cx, h.cz]).toEqual([lat.X[h.i], lat.Z[h.j]]);
          for (const half of [hx, hz]) {
            expect(half).toBeGreaterThanOrEqual(t7.halfSize[0]);
            expect(half).toBeLessThanOrEqual(t7.halfSize[1]);
          }
          continue;
        }
        const [c0, c1] = h.cells as [number, number];
        const k = c1 - c0 === 1 ? 'x' : 'z';
        expect(c1 - c0 === 1 || c1 - c0 === t7.cols).toBe(true);
        // Centred between the two cells' centres, the long half in `great.half` (a metre more or less to dodge an even Wall), the short half a Hall's.
        const [lc0, lc1] = [[lat.X[c0 % t7.cols]!, lat.Z[Math.floor(c0 / t7.cols)]!], [lat.X[c1 % t7.cols]!, lat.Z[Math.floor(c1 / t7.cols)]!]] as const;
        expect([h.cx, h.cz]).toEqual([(lc0[0] + lc1[0]) / 2, (lc0[1] + lc1[1]) / 2]);
        const [long, short] = k === 'x' ? [hx, hz] : [hz, hx];
        expect(long).toBeGreaterThanOrEqual(t7.great.half[0]);
        expect(long).toBeLessThanOrEqual(t7.great.half[1] + 1);
        expect(short).toBeGreaterThanOrEqual(t7.halfSize[0]);
        expect(short).toBeLessThanOrEqual(t7.halfSize[1]);
      }
    }
  });

  it('wants the great halls the Tuning says: the count in range, and on a Boss Floor Hall 0 great and the Boss Hall', () => {
    let bad = 0;
    for (const { floor, p } of done) {
      const great = p.halls.filter((h) => h.great).length;
      if (great < t7.great.count[0] || great > t7.great.count[1]) bad++;
      if (isBossFloor(tuning.delver, floor)) {
        expect(p.halls[0]!.great).toBe(true);
        expect(p.stairs).toBe(0);
        expect(p.halls[0]!.kind).toBe('Boss');
        expect(p.markers.boss!.hall).toBe(0);
      }
    }
    console.log(`7a plans with the great count out of range: ${bad}`);
    expect(bad).toBeLessThanOrEqual(2);
  });

  it('chains every Passage\'s pieces from a to b, legs and corners w wide on whole-metre centre lines', () => {
    for (const { seed, floor, p } of done) {
      const lat = latticeOf(seed, floor);
      for (const q of p.passages) {
        const a = p.halls[q.a]!;
        const b = p.halls[q.b]!;
        const first = q.pieces[0]!;
        const last = q.pieces[q.pieces.length - 1]!;
        // The first touches a on sideA and the last touches b on sideB, each on one of the Hall's centre lines there.
        expect(first.from).toBe(opp[q.sideA]);
        expect(edge(first.rect, first.from)).toBe(edge(a.rect, q.sideA));
        expect(last.to).toBe(opp[q.sideB]);
        expect(edge(last.rect, last.to)).toBe(edge(b.rect, q.sideB));
        for (const [e, h] of [[ends(q)[0]!, a], [ends(q)[1]!, b]] as const) {
          expect(linesOn(h, e.side, lat)).toContain(lineOf(e.piece));
          const [lo, hi] = along(h.rect, e.side);
          const [r0, r1] = along(e.piece.rect, e.side);
          expect(r0 >= lo && r1 <= hi).toBe(true);
        }
        q.pieces.forEach((x, k) => {
          const r = x.rect;
          if (x.corner) {
            expect([r.x1 - r.x0, r.z1 - r.z0]).toEqual([w, w]);
            expect(k > 0 && k < q.pieces.length - 1).toBe(true);
          } else {
            const [across, length] = x.axis === 'x' ? [r.z1 - r.z0, r.x1 - r.x0] : [r.x1 - r.x0, r.z1 - r.z0];
            expect(across).toBe(w);
            expect(length).toBeGreaterThan(0);
            expect(Number.isInteger(lineOf(x))).toBe(true);
            expect(x.from).toBe(opp[x.to]);
            expect(x.axis).toBe(x.to === 'e' || x.to === 'w' ? 'x' : 'z');
          }
          const next = q.pieces[k + 1];
          if (next) {
            // Each `to` edge is on the next piece's `from` edge, with the same extent along it.
            expect(next.from).toBe(opp[x.to]);
            expect(edge(r, x.to)).toBe(edge(next.rect, next.from));
            expect(along(r, x.to)).toEqual(along(next.rect, next.from));
            expect(next.corner).toBe(!x.corner);
          }
        });
        expect(first.corner || last.corner).toBe(false);
        expect(q.rect).toEqual({
          x0: Math.min(...q.pieces.map((x) => x.rect.x0)), z0: Math.min(...q.pieces.map((x) => x.rect.z0)),
          x1: Math.max(...q.pieces.map((x) => x.rect.x1)), z1: Math.max(...q.pieces.map((x) => x.rect.z1)),
        });
        expect(q.axis).toBe(legsOf(q)[0]!.axis);
        expect(q.length).toBe(Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz));
        if (q.shape === 'straight') {
          expect(q.pieces).toHaveLength(1);
          expect(q.rect).toEqual(first.rect);
          // A straight Passage keeps a west (or south) of b.
          expect(q.sideA).toBe(q.axis === 'x' ? 'e' : 'n');
          expect(q.sideB).toBe(q.axis === 'x' ? 'w' : 's');
        }
      }
    }
  });

  it('gives each Passage the shape its corners make: an L turns once, an S or Z twice with parallel offset ends, a Z first turning clockwise', () => {
    for (const { p } of done) {
      for (const q of p.passages) {
        const legs = legsOf(q);
        expect(q.pieces.filter((x) => x.corner)).toHaveLength(legs.length - 1);
        if (legs.length === 1) expect(q.shape).toBe('straight');
        if (legs.length === 2) {
          expect(q.shape).toBe('L');
          expect(legs[0]!.axis).not.toBe(legs[1]!.axis);
        }
        if (legs.length === 3) {
          expect(['S', 'Z']).toContain(q.shape);
          // The ends run the same way and are offset; the middle leg turns across.
          expect(legs[0]!.to).toBe(legs[2]!.to);
          expect(legs[1]!.axis).not.toBe(legs[0]!.axis);
          expect(lineOf(legs[0]!)).not.toBe(lineOf(legs[2]!));
          const [v0, v1] = [VEC[legs[0]!.to], VEC[legs[1]!.to]];
          const cross = v0[0] * v1[1] - v0[1] * v1[0];
          expect(q.shape).toBe(cross < 0 ? 'Z' : 'S');
          for (const end of [legs[0]!, legs[2]!]) {
            const len = end.axis === 'x' ? end.rect.x1 - end.rect.x0 : end.rect.z1 - end.rect.z0;
            expect(len).toBeGreaterThanOrEqual(MIN_LEG);
          }
        }
        expect(legs.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('slopes at most one leg, on the leg the rule names, at least 2 * LEVEL_RISE long, with every corner level and the heights meeting ya and yb', () => {
    for (const { p } of done) {
      for (const q of p.passages) {
        const legs = legsOf(q);
        const first = q.pieces[0]!;
        const last = q.pieces[q.pieces.length - 1]!;
        expect(first.y0).toBe(q.ya);
        expect(last.y1).toBe(q.yb);
        expect(Math.abs(q.ya - q.yb)).toBeLessThanOrEqual(LEVEL_RISE);
        q.pieces.forEach((x, k) => {
          if (x.corner) expect(x.y0).toBe(x.y1);
          const next = q.pieces[k + 1];
          if (next) expect(x.y1).toBe(next.y0);
        });
        const sloped = legs.flatMap((x, k) => (x.y0 !== x.y1 ? [k] : []));
        if (q.ya === q.yb) {
          expect(sloped).toEqual([]);
          continue;
        }
        expect(sloped).toHaveLength(1);
        const leg = legs[sloped[0]!]!;
        expect(Math.abs(leg.y1 - leg.y0)).toBe(Math.abs(q.ya - q.yb));
        const len = leg.axis === 'x' ? leg.rect.x1 - leg.rect.x0 : leg.rect.z1 - leg.rect.z0;
        expect(len).toBeGreaterThanOrEqual(2 * LEVEL_RISE);
        // Straight: its only leg. L: the leg at the lower end. S or Z: the middle leg.
        if (legs.length === 1) expect(sloped[0]).toBe(0);
        if (legs.length === 2) expect(sloped[0]).toBe(q.ya < q.yb ? 0 : 1);
        if (legs.length === 3) expect(sloped[0]).toBe(1);
      }
    }
  });

  it('keeps PASSAGE_CLEAR between a turning Passage and every Hall and Passage it does not join, and from a great hall to every Passage', () => {
    for (const { p } of done) {
      p.passages.forEach((q, n) => {
        const turning = q.shape !== 'straight';
        q.pieces.forEach((x, k) => {
          p.halls.forEach((h, hi) => {
            const joins = (hi === q.a && k === 0) || (hi === q.b && k === q.pieces.length - 1);
            if (joins) return expect(gapOf(x.rect, h.rect)).toBeGreaterThanOrEqual(0);
            // A straight Passage keeps its own ends and no more; a turning piece (and any piece against a great hall) keeps the clearance.
            if (turning || h.great) expect(gapOf(x.rect, h.rect)).toBeGreaterThanOrEqual(PASSAGE_CLEAR);
            else expect(overlaps(x.rect, h.rect)).toBe(false);
          });
          p.passages.forEach((o, m) => {
            if (m === n) return;
            for (const y of o.pieces) {
              if (turning || o.shape !== 'straight') expect(gapOf(x.rect, y.rect)).toBeGreaterThanOrEqual(PASSAGE_CLEAR);
              else expect(overlaps(x.rect, y.rect)).toBe(false);
            }
          });
        });
      });
      p.halls.forEach((h, hi) => p.halls.forEach((o, oi) => hi < oi && expect(touches(h.rect, o.rect)).toBe(false)));
    }
  });

  it('lists a Hall\'s doors at the side centres a Passage attaches to at its floor, never a great hall\'s long side, and keeps long-side Passages flat', () => {
    for (const { p } of done) {
      p.halls.forEach((h, k) => {
        const want = new Set<Side>();
        for (const q of p.passages) {
          for (const e of ends(q)) {
            if (e.hall !== k) continue;
            const centre = e.side === 'n' || e.side === 's' ? h.cx : h.cz;
            if (lineOf(e.piece) !== centre) {
              // A great hall's long side: flat and unlisted.
              expect(h.great).toBe(true);
              expect(q.ya).toBe(q.yb);
              expect(q.pieces.every((x) => x.y0 === x.y1 && x.y0 === q.ya)).toBe(true);
              continue;
            }
            if (h.gallery?.side !== e.side) want.add(e.side);
          }
        }
        expect(Object.keys(h.doors).sort()).toEqual([...want].sort());
        for (const wd of Object.values(h.doors)) expect(wd).toBe(w);
        // Every Passage end is a distinct slot: two Passages never leave one place.
        const spots = p.passages.flatMap((q) => ends(q).filter((e) => e.hall === k).map((e) => `${e.side}${lineOf(e.piece)}`));
        expect(new Set(spots).size).toBe(spots.length);
      });
    }
  });

  it('keeps the Entrance off a great hall, a great hall out of Empty unless in line, and the line on straight Passages', () => {
    for (const { floor, p } of done) {
      const count = (h: number) => p.passages.filter((q) => q.a === h || q.b === h).length;
      const flatLeaf = p.halls.some((h, k) => count(k) === 1 && !h.great);
      if (flatLeaf || p.halls.some((h) => !h.great)) expect(p.halls[p.entrance]!.great).toBe(false);
      if (flatLeaf) expect(count(p.entrance)).toBe(1);
      p.halls.forEach((h, k) => {
        if (h.great && h.kind === 'Empty') expect(p.inLine).toContain(k);
        if (h.great && !p.inLine.includes(k) && !['Entrance', 'Stairs', 'Boss', 'Rest', 'Treasure'].includes(h.kind)) expect(h.kind).toBe('Fight');
      });
      for (const h of p.inLine) {
        const via = p.passages.filter((q) => q.shape === 'straight' && (q.a === h || q.b === h)).map((q) => (q.a === h ? q.b : q.a));
        expect(via.some((o) => o === p.entrance || p.inLine.includes(o))).toBe(true);
      }
      if (isBossFloor(tuning.delver, floor) && p.halls[0]!.great) {
        // The Entrance is the furthest leaf that is not great from the Boss Hall, by walking (ties to the lower index).
        const dist = new Array<number>(p.halls.length).fill(Infinity);
        dist[0] = 0;
        for (let round = 0; round < p.halls.length; round++) for (const q of p.passages) {
          dist[q.b] = Math.min(dist[q.b]!, dist[q.a]! + q.length);
          dist[q.a] = Math.min(dist[q.a]!, dist[q.b]! + q.length);
        }
        const leaves = p.halls.flatMap((h, k) => (count(k) === 1 && !h.great ? [k] : []));
        if (leaves.length > 0) {
          const far = Math.max(...leaves.map((k) => dist[k]!));
          expect(p.entrance).toBe(leaves.find((k) => dist[k] === far));
        }
      }
    }
  });

  it('exercises every feature across 200 seeds and Floors 1 to 9, and logs the counts', () => {
    const all = done.flatMap((x) => x.p.passages.map((q) => ({ q, p: x.p })));
    const by = (shape: string, loop: boolean) => all.filter((x) => x.q.shape === shape && x.q.loop === loop).length;
    for (const shape of ['L', 'S', 'Z']) {
      expect(by(shape, false), `${shape} in the tree`).toBeGreaterThan(0);
      expect(by(shape, true), `${shape} as a loop`).toBeGreaterThan(0);
    }
    const isSloped = (q: DelverPassage) => q.ya !== q.yb;
    expect(all.some((x) => x.q.shape === 'L' && isSloped(x.q))).toBe(true);
    expect(all.some((x) => (x.q.shape === 'S' || x.q.shape === 'Z') && isSloped(x.q))).toBe(true);
    const greats = done.map((x) => x.p.halls.filter((h) => h.great).length);
    expect(greats).toContain(1);
    expect(greats).toContain(2);
    expect(
      done.some(({ p }) => p.passages.some((q) => ends(q).some((e) => lineOf(e.piece) !== (e.side === 'n' || e.side === 's' ? p.halls[e.hall]!.cx : p.halls[e.hall]!.cz)))),
    ).toBe(true);
    expect(done.some(({ floor, p }) => isBossFloor(tuning.delver, floor) && p.halls[p.stairs]!.great)).toBe(true);
    expect(done.some(({ p }) => p.halls.some((h) => h.great && h.kind === 'Treasure'))).toBe(true);
    expect(done.some(({ p }) => p.halls.some((h) => h.great && h.kind === 'Fight'))).toBe(true);
    const flat = pairs.map(({ seed, floor }) => planFloor(flatRooms(tuning).delver.floor, seed, floor, 0, isBossFloor(tuning.delver, floor)));
    const mean = (ps: FloorPlan[]) => ps.reduce((n, p) => n + p.halls[p.stairs]!.depth, 0) / ps.length;
    console.log(
      `7a over ${done.length} full plans: straight ${all.filter((x) => x.q.shape === 'straight').length}, L ${all.filter((x) => x.q.shape === 'L').length} (loops ${by('L', true)}), S ${all.filter((x) => x.q.shape === 'S').length} (loops ${by('S', true)}), ` +
        `Z ${all.filter((x) => x.q.shape === 'Z').length} (loops ${by('Z', true)}); sloped turning ${all.filter((x) => x.q.shape !== 'straight' && isSloped(x.q)).length}; ` +
        `great halls per Floor 0:${greats.filter((n) => n === 0).length} 1:${greats.filter((n) => n === 1).length} 2:${greats.filter((n) => n === 2).length}; ` +
        `mean Stairs depth ${mean(plans7).toFixed(1)} m vs ${mean(flat).toFixed(1)} m under flatRooms (${(mean(plans7) / mean(flat)).toFixed(2)}x)`,
    );
  });

  it('builds the same pieces from a route as the plan does (passagePieces is pure)', () => {
    for (const { p } of done.slice(0, 40)) {
      for (const q of p.passages) {
        const a = p.halls[q.a]!;
        const b = p.halls[q.b]!;
        const first = q.pieces[0]!;
        const last = q.pieces[q.pieces.length - 1]!;
        const corners = q.pieces.filter((x) => x.corner).map((x) => ({ x: (x.rect.x0 + x.rect.x1) / 2, z: (x.rect.z0 + x.rect.z1) / 2 }));
        const again = passagePieces(a.rect, b.rect, { sideA: q.sideA, lineA: lineOf(first), sideB: q.sideB, lineB: lineOf(last), corners }, w, q.ya, q.yb);
        expect(again).toEqual(q.pieces);
      }
    }
  });

  describe('on flatRooms (Stage 6\'s lattice, the knobs off)', () => {
    const flat = flatRooms(tuning).delver.floor;
    const flatPairs = pairs.slice(0, 60);

    it('is all straight Passages, each one piece equal to its rect, and no great hall', () => {
      for (const { seed, floor } of flatPairs) {
        const p = planFloor(flat, seed, floor, 0, isBossFloor(tuning.delver, floor));
        for (const h of p.halls) {
          expect(h.great).toBe(false);
          expect(h.cells).toEqual([h.j * flat.cols + h.i]);
        }
        for (const q of p.passages) {
          expect(q.shape).toBe('straight');
          expect(q.pieces).toHaveLength(1);
          expect(q.pieces[0]!.rect).toEqual(q.rect);
          expect([q.pieces[0]!.y0, q.pieces[0]!.y1]).toEqual([q.ya, q.yb]);
          expect(q.pieces[0]!.corner).toBe(false);
        }
      }
    });

    it('makes no 7a pick: a changed salt or great.half changes nothing', () => {
      expect([SALT.greatCount, SALT.greatAxis, SALT.greatLong, SALT.great, SALT.turn, SALT.turnPick]).toEqual([40, 41, 42, 43, 44, 45]);
      const salts = SALT as unknown as Record<string, number>;
      for (const { seed, floor } of flatPairs.slice(0, 20)) {
        const boss = isBossFloor(tuning.delver, floor);
        const base = planFloor(flat, seed, floor, 0, boss);
        const saved = { ...salts };
        try {
          for (const key of ['greatCount', 'greatAxis', 'greatLong', 'great', 'turn', 'turnPick']) salts[key] = 9000 + salts[key]!;
          expect(planFloor(flat, seed, floor, 0, boss)).toEqual(base);
        } finally {
          Object.assign(salts, saved);
        }
        expect(planFloor({ ...flat, great: { count: [0, 0], half: [13, 15] } }, seed, floor, 0, boss)).toEqual(base);
      }
    });

    it('is the plan under the bundled data, which has the same lattice with the 7a fields off', () => {
      expect(tuning.delver.floor).toEqual(flat);
      for (const { seed, floor } of flatPairs.slice(0, 20)) {
        const boss = isBossFloor(tuning.delver, floor);
        expect(planFloor(flat, seed, floor, 0, boss)).toEqual(planFloor(t, seed, floor, 0, boss));
      }
    });
  });
});
