import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type ArenaGeometry } from '../../tuning';
import { deadly, groundBelow } from '../arena';
import { hashValue } from '../hash';
import { cellGraph, distances, owners } from './grid';
import { DEFAULT_GEN_PARAMS, generateArena, generateLayout, GREYBOX_KIT, judgeArena, type GeneratedArena, type Layout } from './index';

/**
 * Hall Arenas (docs/plans/dungeon.md, "Hall Arenas: Doors in the generator"): `gen:<kit>:<seed>:d<n>` places n Doors
 * on the footprint's edge, Door 0 (the entrance) holding Team 0's spawns.
 */
const tuning = loadTuningData();
/** How many seeds per Door count the soak below builds; DOOR_SOAK_SEEDS=<n> builds more. */
const SOAK_SEEDS = Number(process.env.DOOR_SOAK_SEEDS ?? 6);

/** Per Door of a Layout, its cell (row by row) and level, in Layout order. */
const doorCells = (layout: Layout) => layout.placements.filter((p) => p.piece === 'door').map((p) => ({ cell: p.row * layout.cols + p.col, level: p.level, col: p.col, row: p.row }));

/** The Arena with no Doors as it was before Doors were added: seed, Layout hash, Arena hash (without `doors`), attempts. */
const BEFORE_DOORS: readonly [seed: number, layout: string, arena: string, attempts: number][] = [
  [0, 'd288f9aa', '033edc98', 1],
  [1, '68cbac5c', 'f046a9dd', 1],
  [2, 'fc9371cb', 'bb38cb83', 4],
  [3, '42c13831', '3aa2ebd2', 1],
  [7, 'af4d4ae0', 'e3ebffb0', 1],
  [12, 'cb885285', '4b57ad56', 1],
  [42, '86a3d51d', 'e2d72c3a', 1],
  [99, 'b1431ed0', 'ed6a444f', 1],
  [1234, 'd2f4bfe6', '5f89bfb7', 1],
  [381967, '6523f03d', '09fdc2fc', 2],
  [999999, '33ed067c', 'e3be3741', 1],
];

describe('a name without :d builds exactly the Arena it did before Doors', () => {
  it('the same Layout, and the same Arena with no Doors', () => {
    for (const [seed, layout, arena, attempts] of BEFORE_DOORS) {
      const built = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      const { doors, ...rest } = built.arena;
      expect(doors).toEqual([]);
      expect([seed, hashValue(built.layout), hashValue(rest), built.attempts]).toEqual([seed, layout, arena, attempts]);
      expect(built.layout.placements.some((p) => p.piece === 'door')).toBe(false);
    }
  });
});

describe('generateLayout with Doors', () => {
  it('places the Doors asked for (fewer only when the edge has no room), on edge cells (not corners) at ground level, Wall outward', () => {
    for (const doors of [1, 2, 3, 4]) {
      let short = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const layout = generateLayout(GREYBOX_KIT, seed, { ...DEFAULT_GEN_PARAMS, doors });
        const { cols, rows } = layout;
        const placed = doorCells(layout);
        expect(placed.length).toBeLessThanOrEqual(doors);
        if (placed.length < doors) short++;
        expect(layout.placements.filter((p) => p.door !== undefined).map((p) => p.door).sort()).toEqual(placed.map((_, i) => i));
        for (const { col, row, level } of placed) {
          expect(level).toBe(0);
          const outward = [row === 0, col === cols - 1, row === rows - 1, col === 0];
          expect(outward.filter(Boolean)).toHaveLength(1);
          // The door's Wall (along -z unturned, side 0) is on the side that faces out.
          expect(layout.placements.find((p) => p.col === col && p.row === row)!.turn).toBe(outward.indexOf(true));
        }
        // Walking joins every Door to every other cell walking reaches.
        const graph = cellGraph(GREYBOX_KIT, layout);
        const owner = owners(GREYBOX_KIT, layout);
        if (!placed.length) continue;
        const dist = distances(graph, placed[0]!.cell);
        for (const { cell } of placed) expect(dist[cell]).toBeGreaterThanOrEqual(0);
        for (let k = 0; k < cols * rows; k++) if (GREYBOX_KIT.pieces[layout.placements[owner[k]!]!.piece].walk.length) expect(dist[k], `cell ${k}`).toBeGreaterThanOrEqual(0);
      }
      expect(short, `:d${doors}`).toBeLessThanOrEqual(4);
    }
  });

  it('spreads the Doors round the footprint: no two Doors side by side', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const placed = doorCells(generateLayout(GREYBOX_KIT, seed, { ...DEFAULT_GEN_PARAMS, doors: 4 }));
      for (const a of placed) for (const b of placed) if (a !== b) expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBeGreaterThan(1);
    }
  });

  it('is deterministic, and gives another Layout for another Door count', () => {
    const a = generateLayout(GREYBOX_KIT, 5, { ...DEFAULT_GEN_PARAMS, doors: 2 });
    expect(generateLayout(GREYBOX_KIT, 5, { ...DEFAULT_GEN_PARAMS, doors: 2 })).toEqual(a);
    expect(generateLayout(GREYBOX_KIT, 5, { ...DEFAULT_GEN_PARAMS, doors: 3 })).not.toEqual(a);
  });
});

/** Whether (x, z) is inside the convex polygon `zone` (from above). */
const inside = (zone: ArenaGeometry['doors'][number]['zone'], x: number, z: number) => {
  let sign = 0;
  for (let i = 0; i < zone.length; i++) {
    const a = zone[i]!;
    const b = zone[(i + 1) % zone.length]!;
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};

describe('Hall Arenas: every :d1 to :d4 name passes the judge', () => {
  for (const doors of [1, 2, 3, 4])
    it(`:d${doors}, over ${SOAK_SEEDS} seeds`, () => {
      for (let seed = 1; seed <= SOAK_SEEDS; seed++) {
        const params = { ...DEFAULT_GEN_PARAMS, doors };
        const { arena, layout, report } = generateArena(GREYBOX_KIT, seed * 7919, params, tuning);
        const label = `${arena.name}`;
        expect(arena.name).toBe(`gen:greybox:${seed * 7919}:d${doors}`);
        expect(report.reasons, label).toEqual([]);
        expect(arena.doors, label).toHaveLength(doors);
        // Door 0 holds Team 0's spawns; Team 1's are elsewhere.
        expect(arena.spawns.filter((s) => s.team === 0)).toStrictEqual(arena.doors[0]!.spawns);
        expect(layout.placements.filter((p) => p.piece === 'door')).toHaveLength(doors);
        for (const door of arena.doors) {
          expect(door.spawns.map((s) => [s.team, s.slot])).toEqual([
            [0, 0],
            [0, 1],
            [0, 2],
            [0, 3],
          ]);
          // The zone on ground level, never deadly; its Door's spawns stand in it, facing the Door's way.
          for (const p of door.zone) expect(p.y).toBe(0);
          for (const s of door.spawns) {
            expect(inside(door.zone, s.position.x, s.position.z), label).toBe(true);
            expect(s.facing).toBe(door.facing);
            const g = groundBelow(arena, s.position.x, s.position.z, s.position.y + 0.01)!;
            expect(deadly(arena.walk[g.surface]!)).toBeFalsy();
          }
        }
        expect(parseArena(JSON.parse(JSON.stringify(arena)), arena.name)).toStrictEqual(arena);
      }
    }, 120_000);
});

describe('a Hall Arena whose first Layouts all fail', () => {
  // Seed 10's first Layout has no room on its edge for any Door; a budget of one attempt runs out on it.
  const doorsOf = (built: GeneratedArena) => [built.arena.doors.length, built.layout.placements.filter((p) => p.piece === 'door').length];

  it('searches further attempt seeds until one passes, so it still has all its Doors', () => {
    expect(doorCells(generateLayout(GREYBOX_KIT, 10, { ...DEFAULT_GEN_PARAMS, doors: 1 }))).toHaveLength(0);
    const built = generateArena(GREYBOX_KIT, 10, { ...DEFAULT_GEN_PARAMS, doors: 1 }, tuning, 1);
    expect(built.report.reasons).toEqual([]);
    expect(doorsOf(built)).toEqual([1, 1]);
    expect(built.attempts).toBeGreaterThan(1);
    expect(generateArena(GREYBOX_KIT, 10, { ...DEFAULT_GEN_PARAMS, doors: 1 }, tuning, 1)).toEqual(built);
  });

  it('when no Layout passes at all, ends on one with all its Doors (Door 0 holding Team 0\'s spawns)', () => {
    // No Layout has 200% open floor, so the judge turns every one down.
    const params = { ...DEFAULT_GEN_PARAMS, doors: 3, minOpenFloor: 2 };
    const built = generateArena(GREYBOX_KIT, 10, params, tuning, 1);
    expect(built.report.ok).toBe(false);
    expect(doorsOf(built)).toEqual([3, 3]);
    expect(built.arena.spawns.filter((s) => s.team === 0)).toStrictEqual(built.arena.doors[0]!.spawns);
    expect(generateArena(GREYBOX_KIT, 10, params, tuning, 1)).toEqual(built);
  });

  it('leaves a name without :d as it was: its best failing Layout once the attempts run out', () => {
    const built = generateArena(GREYBOX_KIT, 10, { ...DEFAULT_GEN_PARAMS, minOpenFloor: 2 }, tuning, 1);
    expect(built.attempts).toBe(1);
    expect(built.layout).toEqual(generateLayout(GREYBOX_KIT, 10, DEFAULT_GEN_PARAMS));
  });
});

describe('the judge on Doors', () => {
  const built = generateArena(GREYBOX_KIT, 11, { ...DEFAULT_GEN_PARAMS, doors: 2 }, tuning);

  it('asks for the number of Doors the name gives', () => {
    expect(judgeArena(built.arena, tuning, { doors: 2 }).ok).toBe(true);
    expect(judgeArena(built.arena, tuning, { doors: 3 }).reasons).toContain('the Arena has 2 Doors (needs 3)');
  });

  it('refuses a Door zone over deadly ground, and a Door cut off from the enemy', () => {
    const far = { x: 100, y: 0, z: 100 };
    const [first, second] = built.arena.doors as [ArenaGeometry['doors'][number], ArenaGeometry['doors'][number]];
    const offEdge: ArenaGeometry = { ...built.arena, doors: [first, { ...second, zone: second.zone.map((p) => ({ ...p, x: p.x + 100 })), spawns: second.spawns.map((s) => ({ ...s, position: far })) }] };
    const reasons = judgeArena(offEdge, tuning, { doors: 2 }).reasons;
    expect(reasons).toContain('door 1 has its zone over deadly ground');
    expect(reasons).toContain('door 1 spawn 0 stands on no Walk Surface');
  });
});

describe('Hall Arenas stay within ADR 0014\'s navmesh budget', () => {
  it('build their navmesh in under 250 ms (seeds 1-20, :d1 to :d4 in turn, timed by the judge on a fresh copy; logged)', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { arena } = generateArena(GREYBOX_KIT, seed, { ...DEFAULT_GEN_PARAMS, doors: 1 + (seed % 4) }, tuning);
      const copy = parseArena(JSON.parse(JSON.stringify(arena)), arena.name);
      times.push(judgeArena(copy, tuning, { now: () => performance.now(), doors: copy.doors.length }).stats.buildMs!);
    }
    times.sort((a, b) => a - b);
    console.log(`Hall Arenas 1-20: navmesh builds in ${times[10]!.toFixed(0)} ms (median), ${times[19]!.toFixed(0)} ms at most`);
    // As for Random Maps: test files run side by side, so the median holds the line, the slowest only a gross one.
    expect(times[10]).toBeLessThan(250);
    expect(times[19]).toBeLessThan(1000);
  }, 60_000);
});
