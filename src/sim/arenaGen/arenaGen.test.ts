import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../../tuning';
import { groundBelow, surfacesAt } from '../arena';
import type { ArenaGeometry, SpawnPoint } from '../../tuning';
import { hashValue } from '../hash';
import { assembleArena, DEFAULT_GEN_PARAMS, generateArena, generateLayout, GREYBOX_KIT, judgeArena, MAX_ATTEMPTS, MIN_SPAWN_GAP, type Layout } from './index';

const tuning = loadTuningData();

/** Which placed Piece covers each cell of a Layout (by index), or -1. Throws when two cover the same cell. */
function cover(layout: Layout): number[] {
  const owner = new Array<number>(layout.cols * layout.rows).fill(-1);
  layout.placements.forEach((p, i) => {
    const piece = GREYBOX_KIT.pieces[p.piece];
    const [w, d] = p.turn % 2 === 0 ? [piece.cols, piece.rows] : [piece.rows, piece.cols];
    for (let r = p.row; r < p.row + d; r++)
      for (let c = p.col; c < p.col + w; c++) {
        expect(c).toBeLessThan(layout.cols);
        expect(r).toBeLessThan(layout.rows);
        expect(owner[r * layout.cols + c]).toBe(-1);
        owner[r * layout.cols + c] = i;
      }
  });
  return owner;
}

describe('generateLayout', () => {
  it('covers every cell of the footprint with exactly one Piece', () => {
    for (const seed of [1, 2, 3, 99]) {
      const layout = generateLayout(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS);
      expect(layout.cols).toBe(DEFAULT_GEN_PARAMS.cols);
      expect(cover(layout).every((o) => o >= 0)).toBe(true);
    }
  });

  it('gives the same Layout for the same seed, and another for another seed', () => {
    const a = generateLayout(GREYBOX_KIT, 7, DEFAULT_GEN_PARAMS);
    expect(generateLayout(GREYBOX_KIT, 7, DEFAULT_GEN_PARAMS)).toEqual(a);
    expect(generateLayout(GREYBOX_KIT, 8, DEFAULT_GEN_PARAMS)).not.toEqual(a);
  });

  it('gives every raised level a ramp onto it', () => {
    let raised = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const layout = generateLayout(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS);
      const tops = new Set(layout.placements.filter((p) => p.piece === 'ramp').map((p) => p.level + 1));
      for (const p of layout.placements) if (p.level > 0 && p.piece !== 'ramp' && p.piece !== 'void') expect(tops.has(p.level)).toBe(true);
      if (layout.placements.some((p) => p.level > 0)) raised++;
    }
    expect(raised).toBeGreaterThan(40);
  });

  it('uses its params: the same seed with other params gives another Layout', () => {
    const a = generateLayout(GREYBOX_KIT, 7, DEFAULT_GEN_PARAMS);
    expect(generateLayout(GREYBOX_KIT, 7, { ...DEFAULT_GEN_PARAMS, voidDensity: 0.4 })).not.toEqual(a);
    expect(generateLayout(GREYBOX_KIT, 7, { ...DEFAULT_GEN_PARAMS, levels: 1 })).not.toEqual(a);
  });
});

describe('assembleArena', () => {
  const seeds = [1, 2, 3, 4, 5, 42];

  it('builds an Arena parseArena accepts after a round trip through JSON', () => {
    for (const seed of seeds) {
      const arena = assembleArena(GREYBOX_KIT, generateLayout(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS), `gen:greybox:${seed}`);
      expect(arena.name).toBe(`gen:greybox:${seed}`);
      expect(parseArena(JSON.parse(JSON.stringify(arena)), arena.name)).toEqual(arena);
    }
  });

  it('puts one Abyss under the whole footprint, below every floor', () => {
    for (const seed of seeds) {
      const arena = assembleArena(GREYBOX_KIT, generateLayout(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS), 'gen');
      const abyss = arena.walk.flatMap((w, i) => (w.abyss ? [i] : []));
      expect(abyss).toHaveLength(1);
      const low = Math.min(...arena.walk.filter((w) => !w.abyss).flatMap((w) => w.points.map((p) => p.y)));
      expect(arena.walk[abyss[0]!]!.points.every((p) => p.y < low - 3)).toBe(true);
      const size = DEFAULT_GEN_PARAMS.cols * GREYBOX_KIT.cell;
      for (let x = -size / 2; x <= size / 2; x += 0.5) for (let z = -size / 2; z <= size / 2; z += 0.5) expect(surfacesAt(arena, x, z)).toContain(abyss[0]);
    }
  });

  it('gives each Team three spawns on safe ground, the two Teams far apart', () => {
    for (const seed of seeds) {
      const arena = assembleArena(GREYBOX_KIT, generateLayout(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS), 'gen');
      for (const team of [0, 1]) expect(arena.spawns.filter((s) => s.team === team).map((s) => s.slot)).toEqual([0, 1, 2]);
      for (const s of arena.spawns) {
        const g = groundBelow(arena, s.position.x, s.position.z, s.position.y + 0.01)!;
        expect(g.y).toBeCloseTo(s.position.y, 9);
        expect(arena.walk[g.surface]!.abyss).toBeUndefined();
      }
      const gap = Math.min(...arena.spawns.filter((s) => s.team === 0).flatMap((a) => arena.spawns.filter((s) => s.team === 1).map((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z))));
      expect(gap).toBeGreaterThanOrEqual(MIN_SPAWN_GAP);
    }
  });
});

/** A flat floor from x0 to x1 (z from -6 to 6) at height y. */
const floor = (id: string, x0: number, x1: number, y = 0) => ({
  id,
  points: [
    { x: x0, y, z: -6 },
    { x: x1, y, z: -6 },
    { x: x1, y, z: 6 },
    { x: x0, y, z: 6 },
  ],
});
const abyss = { ...floor('abyss', -30, 30, -8), abyss: true };
const spawn = (team: number, slot: number, x: number, z: number): SpawnPoint => ({ team, slot, position: { x, y: 0, z }, facing: 0 });
const lineUp = (team: number, x: number) => [0, 1, 2].map((slot) => spawn(team, slot, x, (slot - 1) * 2));

describe('judgeArena', () => {
  it('passes a plain floor with the Teams across it, and reports its stats', () => {
    const arena: ArenaGeometry = { name: 'plain', walk: [floor('a', -12, 0), floor('b', 0, 12), abyss], walls: [], spawns: [...lineUp(0, -6), ...lineUp(1, 6)] };
    const { ok, reasons, stats } = judgeArena(arena, tuning, { now: () => performance.now() });
    expect(reasons).toEqual([]);
    expect(ok).toBe(true);
    expect(stats.walkSurfaces).toBe(3);
    expect(stats.links.walk).toBe(2);
    expect(stats.links.jump).toBe(0);
    expect(stats.buildMs).toBeGreaterThanOrEqual(0);
    expect(stats.longestSpawnPath).toBeCloseTo(Math.hypot(12, 4), 1);
  });

  it('fails Teams that only a Jump joins, and spawns by deadly ground', () => {
    // Two floors 2 m apart across the Abyss: a Jump gets over, walking never does.
    const arena: ArenaGeometry = { name: 'gap', walk: [floor('a', -12, -1), floor('b', 1, 12), abyss], walls: [], spawns: [...lineUp(0, -6), ...lineUp(1, 2)] };
    const { ok, reasons } = judgeArena(arena, tuning);
    expect(ok).toBe(false);
    expect(reasons.some((r) => /reach/.test(r))).toBe(true);
    expect(reasons.some((r) => /deadly/.test(r))).toBe(true);
    expect(reasons.some((r) => /team 0.*deadly/.test(r))).toBe(false);
    // And Teams lined up 4 m apart.
    const close = judgeArena({ ...arena, name: 'close', walk: [floor('a', -12, 12), abyss], spawns: [...lineUp(0, -2), ...lineUp(1, 2)] }, tuning);
    expect(close.reasons.some((r) => /enemy spawns stand 4.0 m apart/.test(r))).toBe(true);
  });

  it('fails too little open floor at the lowest level, and too few spawns', () => {
    const arena: ArenaGeometry = { name: 'thin', walk: [floor('a', -12, -10), floor('b', -10, 12, 3), abyss], walls: [], spawns: lineUp(0, -6).map((s) => ({ ...s, position: { ...s.position, y: 3 } })) };
    const { reasons } = judgeArena(arena, tuning, { minOpenFloor: 0.5 });
    expect(reasons.some((r) => /open floor/.test(r))).toBe(true);
    expect(reasons.some((r) => /team 1.*spawns/.test(r))).toBe(true);
  });

  it('fails a navmesh that builds too slowly', () => {
    const arena: ArenaGeometry = { name: 'slow', walk: [floor('a', -12, 0), floor('b', 0, 12), abyss], walls: [], spawns: [...lineUp(0, -6), ...lineUp(1, 6)] };
    let t = 0;
    const { reasons, stats } = judgeArena(arena, tuning, { now: () => (t += 300) });
    expect(stats.buildMs).toBe(300);
    expect(reasons.some((r) => /navmesh/.test(r))).toBe(true);
  });
});

describe('generateArena', () => {
  it('gives the same Arena for the same seed (deep-equal, and the same hash), named after its Kit and seed', () => {
    const a = generateArena(GREYBOX_KIT, 1234, DEFAULT_GEN_PARAMS, tuning);
    const b = generateArena(GREYBOX_KIT, 1234, DEFAULT_GEN_PARAMS, tuning);
    expect(a.arena.name).toBe('gen:greybox:1234');
    expect(b.arena).toEqual(a.arena);
    expect(hashValue(b.arena)).toBe(hashValue(a.arena));
    expect(b.layout).toEqual(a.layout);
  });

  it('ends with an Arena that passes the judge for every seed from 1 to 200, within MAX_ATTEMPTS, most with a jump Link', () => {
    let jumps = 0;
    let tries = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { arena, attempts, report } = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      expect(report.reasons, `seed ${seed}`).toEqual([]);
      expect(report.ok).toBe(true);
      expect(attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
      expect(parseArena(JSON.parse(JSON.stringify(arena)), arena.name)).toEqual(arena);
      tries += attempts;
      if (report.stats.links.jump + report.stats.links.shortcut > 0) jumps++;
    }
    console.log(`generated Arenas 1-200: ${jumps} with a jump Link, ${(tries / 200).toFixed(2)} attempts on average`);
    expect(jumps).toBeGreaterThan(150);
  }, 120_000);

  it('builds their navmesh in under 250 ms (seeds 1-20, timed by the judge on a fresh copy; logged)', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { arena } = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      const copy = parseArena(JSON.parse(JSON.stringify(arena)), arena.name);
      times.push(judgeArena(copy, tuning, { now: () => performance.now() }).stats.buildMs!);
    }
    times.sort((a, b) => a - b);
    console.log(`generated Arenas 1-20: navmesh builds in ${times[10]!.toFixed(0)} ms (median), ${times[19]!.toFixed(0)} ms at most`);
    // Test files run side by side, so a single build can be slowed: the median holds the line, the slowest only a gross one.
    expect(times[10]).toBeLessThan(250);
    expect(times[19]).toBeLessThan(1000);
  }, 60_000);
});
