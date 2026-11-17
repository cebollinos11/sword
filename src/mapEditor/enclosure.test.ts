/**
 * The Enclosure Brush (a room): its floor, its roof at the next level up (a roof Soldiers need never reach), its Walls with a doorway centred
 * on each side it names, one Wall where two meet edge to edge, its half turn, and the Battle standing nobody on its roof.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseBattleMap, type BattleMapTuning } from '../tuning';
import { battlefieldOf, groundOf, navMesh, surfaceHeight, type JumpLink } from '../sim';
import { walkCheck, walled } from '../sim/levels';
import { destinationFields, trace } from '../sim';
import { nodeIn } from '../sim/destinations';
import { SHORTCUT_RISE } from '../sim/nav';
import { compileMap } from './compile';
import { mapFileText } from './compile';
import { turnBrush } from './mirror';
import { GROUND, withBrushes } from './sample.testdata';
import { MapEditorSession, sourceFileText } from './session';
import { parseMapSource, type Brush, type EnclosureBrush } from './source';

const battle = loadTuningData().battle;
const lv = battle.levels;
const compile = (brushes: readonly Brush[], levels = [0, 4]) => compileMap(withBrushes(brushes, levels), battle).map;
const fieldOf = (map: BattleMapTuning) => battlefieldOf({ ...battle, maps: { [map.name]: map } }, `battle:${map.name}`)!;
const wallsOf = (map: BattleMapTuning, id: string) => map.walls.filter((w) => w.id.startsWith(`WALL_${id}_`)).map(({ a, b, bottom, top }) => ({ a, b, bottom, top }));

/** A 10 m room round the centre (where Objective B stands), north of nothing in particular. */
const room = (doors: EnclosureBrush['doors'], id = 'hall', rect = { x0: -5, z0: -5, x1: 5, z1: 5 }): EnclosureBrush => ({ kind: 'enclosure', id, rect, y: 0, doors });

describe('an Enclosure', () => {
  it('lays its floor, a roof Soldiers need not reach at the next level, and compiles though no Ramp climbs to the roof', () => {
    const map = compile([GROUND, room({ n: 2, e: 2, s: 2, w: 2 })]);
    const own = map.walk.filter((w) => w.id.startsWith('WALK_hall_'));
    expect(own.map((w) => [w.points[0]!.y, w.roof ?? false])).toEqual([
      [0, false],
      [4, true],
    ]);
    expect(walkCheck(fieldOf(map).arena, lv)).toBeNull();
  });

  it('stands a Wall round each side from under its floor to its roof, with a doorway centred where it names one and a lintel over it', () => {
    const map = compile([GROUND, room({ n: 2, s: 3 })]);
    expect(wallsOf(map, 'hall')).toEqual([
      // West and east: solid (no doorway), the whole side.
      { a: { x: -5, z: -5 }, b: { x: -5, z: 5 }, bottom: -1, top: 4 },
      { a: { x: 5, z: -5 }, b: { x: 5, z: 5 }, bottom: -1, top: 4 },
      // South: 3 m doorway centred, a lintel from 3 m.
      { a: { x: -5, z: -5 }, b: { x: -1.5, z: -5 }, bottom: -1, top: 4 },
      { a: { x: -1.5, z: -5 }, b: { x: 1.5, z: -5 }, bottom: 3, top: 4 },
      { a: { x: 1.5, z: -5 }, b: { x: 5, z: -5 }, bottom: -1, top: 4 },
      // North: 2 m.
      { a: { x: -5, z: 5 }, b: { x: -1, z: 5 }, bottom: -1, top: 4 },
      { a: { x: -1, z: 5 }, b: { x: 1, z: 5 }, bottom: 3, top: 4 },
      { a: { x: 1, z: 5 }, b: { x: 5, z: 5 }, bottom: -1, top: 4 },
    ]);
    // A body walks in through a doorway, not through a solid side; the lintel is over its head.
    const arena = fieldOf(map).arena;
    expect(walled(arena, lv, 0, 7, 0, 3, 0)).toBe(false);
    expect(walled(arena, lv, 7, 0, 3, 0, 0)).toBe(true);
    // On the roof, nothing stands in the way of walking off its edge.
    expect(walled(arena, lv, 4, 0, 6, 0, 4)).toBe(false);
  });

  it('with no lintel where the ceiling is within a step of the doorway, and a doorway as wide as its side opens it all', () => {
    const map = compile([GROUND, room({ e: 10 })], [0, 3]);
    expect(wallsOf(map, 'hall').filter((w) => w.a.x === 5 && w.b.x === 5)).toEqual([]);
  });

  it('two edge to edge share one Wall, and a doorway in either opens through it', () => {
    const west = room({ e: 2, w: 2 }, 'west', { x0: -10, z0: -5, x1: 0, z1: 5 });
    const east = room({}, 'east', { x0: 0, z0: -5, x1: 10, z1: 5 });
    const map = compile([GROUND, west, east]);
    // One Wall on x = 0, the earlier Brush's (west), with west's doorway.
    const shared = map.walls.filter((w) => w.a.x === 0 && w.b.x === 0).map(({ id, a, b, bottom, top }) => ({ id, a, b, bottom, top }));
    expect(shared).toEqual([
      { id: 'WALL_west_ed0', a: { x: 0, z: -5 }, b: { x: 0, z: -1 }, bottom: -1, top: 4 },
      { id: 'WALL_west_ed1', a: { x: 0, z: -1 }, b: { x: 0, z: 1 }, bottom: 3, top: 4 },
      { id: 'WALL_west_ed2', a: { x: 0, z: 1 }, b: { x: 0, z: 5 }, bottom: -1, top: 4 },
    ]);
    // East names no doorway there, but walks through west's.
    expect(walled(fieldOf(map).arena, lv, 3, 0, -3, 0, 0)).toBe(false);
  });

  it('a corridor: two doorways opposite, its long sides solid', () => {
    const map = compile([GROUND, room({ n: 4, s: 4 }, 'corridor', { x0: -2, z0: -10, x1: 2, z1: 10 })]);
    const arena = fieldOf(map).arena;
    expect(walled(arena, lv, 0, -12, 0, 12, 0)).toBe(false);
    expect(walled(arena, lv, -4, 0, 0, 0, 0)).toBe(true);
  });

  it('a roof stands no Objective, Base or Soldier put down: they take the floor under it', () => {
    const map = compile([GROUND, room({ n: 2 })]);
    const field = fieldOf(map);
    const b = map.objectives.findIndex((o) => o.id === 'B');
    expect(surfaceHeight(field.arena, field.objectiveSurfaces[b]!, 0, 0)).toBe(0);
    expect(surfaceHeight(field.arena, groundOf(battle, field, 1, 1), 1, 1)).toBe(0);
    // A Fighter's feet on the roof are on the roof.
    expect(surfaceHeight(field.arena, groundOf(battle, field, 1, 1, 4), 1, 1)).toBe(4);
  });

  it('turns half round with its doorways, and parses its own output', () => {
    const r = room({ n: 2, e: 3 }, 'r', { x0: 5, z0: 10, x1: 15, z1: 20 });
    expect(turnBrush(r)).toEqual({ ...r, rect: { x0: -15, z0: -20, x1: -5, z1: -10 }, doors: { s: 2, w: 3 } });
    expect(turnBrush(turnBrush(r))).toEqual(r);
    const source = withBrushes([GROUND, r]);
    expect(parseMapSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
  });

  it('is refused on the top level (no ceiling) and with a doorway on no side', () => {
    expect(() => parseMapSource(withBrushes([GROUND, { ...room({}), y: 4 }]))).toThrow(/ceiling is the level above its floor/);
    expect(() => parseMapSource(withBrushes([GROUND, room({ up: 2 } as never)]))).toThrow(/must be one of n, e, s, w/);
  });

  it('is drawn in the editor with a doorway on every side, and on the top level adds the level above for its ceiling', () => {
    const s = new MapEditorSession(withBrushes([GROUND]));
    const b = s.addBrush('enclosure', { x: -5, z: -5 }, { x: 5, z: 5 });
    expect(b).toEqual({ kind: 'enclosure', id: 'enclosure1', rect: { x0: -5, z0: -5, x1: 5, z1: 5 }, y: 0, doors: { n: 2, e: 2, s: 2, w: 2 } });
    const top = s.source.levels[s.source.levels.length - 1]!;
    s.level = top;
    expect(s.addBrush('enclosure', { x: 20, z: 20 }, { x: 30, z: 30 })).toMatchObject({ y: top });
    expect(s.source.levels[s.source.levels.length - 1]).toBeGreaterThan(top);
  });
});

/** A stairwell off a Hall: a tall Enclosure (floor 0, ceiling 6) holding a railed Ramp up to a Deck along its north wall, and a corridor at 2 opening through that wall. */
const STAIR_LEVELS = [-8, 0, 2, 6];
const stairwell = (): Brush[] => [
  { kind: 'hazard', id: 'abyss', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: -8, hazard: 'abyss' },
  { kind: 'enclosure', id: 'hall', rect: { x0: -7, z0: -9, x1: 7, z1: 9 }, y: 0, top: 6, doors: {} },
  { kind: 'ramp', id: 'stair', rect: { x0: 1, z0: 5, x1: 5, z1: 9 }, lo: 0, hi: 2, up: 'w', rails: ['n', 's'] },
  { kind: 'deck', id: 'landing', rect: { x0: -7, z0: 5, x1: 1, z1: 9 }, y: 2 },
  { kind: 'enclosure', id: 'gallery', rect: { x0: -5, z0: 9, x1: -1, z1: 13 }, y: 2, top: 6, doors: { s: 4 } },
];
const stairSource = (more = {}) =>
  withBrushes(stairwell(), STAIR_LEVELS, {
    objectives: [
      { id: 'D', x: 0, z: -3, weight: 1, owner: 0, spawn: true },
      { id: 'E', x: -3, z: 11, y: 2, weight: 1, owner: 1, spawn: true },
    ],
    bases: [
      { x: 0, z: -3 },
      { x: -3, z: 11 },
    ],
    ...more,
  });

describe('an Enclosure with a ceiling of its own', () => {
  it('compiles its roof and its Walls to `top`, not the next level up', () => {
    const map = compile([GROUND, { ...room({ n: 2 }), top: 8 }], [-8, 0, 4, 8]);
    expect(map.walk.filter((w) => w.id.startsWith('WALK_hall_')).map((w) => [w.points[0]!.y, w.roof ?? false])).toEqual([
      [0, false],
      [8, true],
    ]);
    expect(wallsOf(map, 'hall').every((w) => w.top === 8)).toBe(true);
  });

  it('a stairwell: a Ramp up to a Deck, a corridor through the Hall wall over it, walkable from the Hall floor', () => {
    const { map } = compileMap(stairSource({ shortcuts: true }), battle);
    const arena = fieldOf(map).arena;
    expect(walkCheck(arena, lv)).toBeNull();
    const floor = arena.walk.findIndex((w) => w.id.startsWith('WALK_hall_') && !w.roof);
    const deck = arena.walk.findIndex((w) => w.id.startsWith('WALK_landing'));
    const gallery = arena.walk.findIndex((w) => w.id.startsWith('WALK_gallery_') && !w.roof);
    // Up the Ramp, along the Deck, through the doorway into the corridor.
    expect(trace(arena, lv, floor, 6, 2, 6, 7, false)).toBeGreaterThanOrEqual(0);
    expect(trace(arena, lv, deck, -3, 6, -3, 11, false)).toBe(gallery);
    // The Hall's wall is solid beside the doorway.
    expect(walled(arena, lv, -6, 6, -6, 11, 2)).toBe(true);
  });

  it('stands no Wall up to the Hall’s roof along its Ramp’s side: the roof over the Ramp is no floor beside it (issue #157)', () => {
    const { map } = compileMap(stairSource(), battle);
    // Along the Ramp's open (south) side, z = 5 from x 1 to 5: its rail only, to a rail's height over its top; nothing of the Hall's.
    const along = map.walls.filter((w) => w.a.z === 5 && w.b.z === 5 && Math.min(w.a.x, w.b.x) < 5 && Math.max(w.a.x, w.b.x) > 1);
    expect(along.map((w) => [w.id, w.top])).toEqual([['WALL_stair_s', 3]]);
  });

  it('a shortcuts map builds only shortcut jump Links, from the Hall floor onto the Deck, none onto a roof; false builds none', () => {
    const { map } = compileMap(stairSource({ shortcuts: true }), battle);
    expect(map.shortcuts).toBe(true);
    const field = fieldOf(map);
    expect(field.arena.jumpLinks).toBe('shortcuts');
    const links = navMesh(field.arena, loadTuningData()).links.filter((l): l is JumpLink => l.kind === 'jump');
    const floor = field.arena.walk.findIndex((w) => w.id.startsWith('WALK_hall_') && !w.roof);
    const deck = field.arena.walk.findIndex((w) => w.id.startsWith('WALK_landing'));
    expect(links.some((l) => l.from === floor && l.to === deck)).toBe(true);
    expect(links.every((l) => l.shortcut)).toBe(true);
    expect(links.every((l) => !field.arena.walk[l.to]!.roof)).toBe(true);
    const none = fieldOf(compileMap(stairSource(), battle).map);
    expect(none.arena.jumpLinks).toBe(false);
    expect(navMesh(none.arena, loadTuningData()).links.some((l) => l.kind === 'jump')).toBe(false);
  });
});

describe('an Enclosure\'s roof as a ledge', () => {
  it('a Platform beside a plain Enclosure meets its roof: the face Wall stands to the ceiling, as before levels (only a body under its own roof skips it)', () => {
    const map = compile(
      [
        GROUND,
        { kind: 'enclosure', id: 'hall', rect: { x0: -5, z0: -5, x1: 5, z1: 5 }, y: 0, top: 4, doors: { n: 2 } },
        { kind: 'platform', id: 'pad', rect: { x0: 5, z0: -3, x1: 9, z1: 3 }, top: 2 },
        { kind: 'ramp', id: 'up', rect: { x0: 9, z0: -3, x1: 13, z1: 3 }, lo: 0, hi: 2, up: 'w', rails: ['n', 's'] },
      ],
      [0, 2, 4],
    );
    // The Platform's west edge, along the Enclosure's solid east side: a Wall from under the Platform to the roof.
    expect(wallsOf(map, 'hall').filter((w) => w.a.x === 5 && w.b.x === 5 && w.top === 4 && w.bottom === 1)).toEqual([{ a: { x: 5, z: -3 }, b: { x: 5, z: 3 }, bottom: 1, top: 4 }]);
  });
});

describe('top and shortcuts in the Map Source and the map file', () => {
  const hall = (extra: object) => withBrushes([GROUND, { ...room({ n: 2 }), ...extra }], [0, 4, 8]);
  it('refuses a `top` that is not a level or not above the floor', () => {
    expect(() => parseMapSource(hall({ top: 5 }))).toThrow(/\.top \(5\) must be one of the source's levels/);
    expect(() => parseMapSource(hall({ top: 0 }))).toThrow(/top \(0\) must be above its floor/);
    expect(() => parseMapSource(hall({ top: '8' }))).toThrow(/must be a finite number/);
  });
  it('refuses `shortcuts` that is not true', () => {
    expect(() => parseMapSource({ ...hall({}), shortcuts: false })).toThrow(/source\.shortcuts must be true/);
    expect(() => parseMapSource({ ...hall({}), shortcuts: 1 })).toThrow(/source\.shortcuts must be true/);
  });
  it('round-trips both through the source file and the map file, writing nothing when absent', () => {
    const source = { ...hall({ top: 8 }), shortcuts: true as const };
    const text = sourceFileText(source);
    expect(parseMapSource(JSON.parse(text))).toEqual(source);
    expect(text).toContain('"top":8');
    const plain = sourceFileText(hall({}));
    expect(plain).not.toContain('shortcuts');
    expect(plain).not.toContain('"top"');
    const { map } = compileMap(source, battle);
    const file = mapFileText(map);
    expect(file.indexOf('"shortcuts": true')).toBeGreaterThan(file.indexOf('"armySize"'));
    expect(parseBattleMap(JSON.parse(file), 'map test', battle)).toEqual(map);
    expect(mapFileText(compileMap(hall({}), battle).map)).not.toContain('shortcuts');
  });
});

describe('a Block in an Enclosure', () => {
  /** A Delver Floor's ground: an abyss hazard over the whole field at -8, as the generator lays it. */
  const ABYSS: Brush = { kind: 'hazard', id: 'abyss', rect: GROUND.rect, y: -8, hazard: 'abyss' };
  const hall = (y: number, id = 'hall'): EnclosureBrush => ({ kind: 'enclosure', id, rect: { x0: -9, z0: -9, x1: 9, z1: 9 }, y, doors: { n: 2, s: 2 } });
  const pillar = (top: number, rect = { x0: 1, z0: 1, x1: 3, z1: 3 }): Brush => ({ kind: 'block', id: 'pillar', rect, top });
  const covers = (map: BattleMapTuning, prefix: string, x: number, z: number, y: number) =>
    map.walk.some((w) => w.id.startsWith(prefix) && w.points[0]!.y === y && w.points[0]!.x <= x && w.points[1]!.x >= x && w.points[0]!.z <= z && w.points[2]!.z >= z);

  for (const [name, y, levels, top] of [
    ['a pillar (odd-metre edges) in an Enclosure over an abyss', 0, [-8, 0, 4], 4],
    ['a pillar in a raised Hall', 2, [-8, 2, 6], 6],
  ] as const) {
    it(`${name}: the Hall's floor is cut under it, the roof kept, no face Wall stands by the floor, and the map walks`, () => {
      const map = compile([ABYSS, hall(y), pillar(top)], [...levels]);
      expect(map.blocks).toEqual([{ id: 'BLOCK_pillar', minX: 1, minZ: 1, maxX: 3, maxZ: 3, top }]);
      expect(covers(map, 'WALK_hall_', 2, 2, y)).toBe(false);
      expect(covers(map, 'WALK_hall_', 2, 2, top)).toBe(true);
      expect(covers(map, 'WALK_hall_', -5, -5, y)).toBe(true);
      expect(map.walls.filter((w) => w.id.startsWith('WALL_') && !w.id.startsWith('WALL_hall_') && !w.id.startsWith('WALL_edge_'))).toEqual([]);
      expect(walkCheck(fieldOf(map).arena, lv)).toBeNull();
    });
  }

  it('a big solid notch in a corner, touching two of the Enclosure\'s walls, compiles', () => {
    const map = compile([ABYSS, hall(0), pillar(4, { x0: 3, z0: 3, x1: 9, z1: 9 })], [-8, 0, 4]);
    expect(map.blocks.map((b) => b.id)).toEqual(['BLOCK_pillar']);
    expect(covers(map, 'WALK_hall_', 6, 6, 0)).toBe(false);
    expect(covers(map, 'WALK_hall_', 6, 6, 4)).toBe(true);
    expect(covers(map, 'WALK_hall_', -5, -5, 0)).toBe(true);
  });

  it('is still refused when its top is under the ceiling, when it sticks out of the Enclosure, or when a Deck lies over it', () => {
    expect(() => compile([ABYSS, hall(0), pillar(3)], [-8, 0, 4])).toThrow(/stands under/);
    expect(() => compile([ABYSS, hall(0), pillar(4, { x0: 7, z0: 1, x1: 11, z1: 3 })], [-8, 0, 4])).toThrow(/stands under/);
    const deck: Brush = { kind: 'deck', id: 'gallery', rect: { x0: -3, z0: -3, x1: 3, z1: 3 }, y: 2 };
    expect(() => compile([ABYSS, { ...hall(0), top: 4 }, deck, pillar(4)], [-8, 0, 2, 4])).toThrow(/stands under gallery/);
  });

  it('is refused over a floor under the Enclosure that is not deadly ground (only the abyss under a Hall is cut)', () => {
    const room: Brush = { ...hall(4), top: 8 };
    expect(() => compile([GROUND, room, pillar(8)], [0, 4, 8])).toThrow(/Block pillar stands in Enclosure hall over .+ \(at 0\)/);
  });

  it('a Block in no Enclosure compiles as before (compile.test.ts: the tower on plain floor)', () => {
    const map = compile([GROUND, { kind: 'block', id: 'tower', rect: { x0: 20, z0: -4, x1: 28, z1: 4 }, top: 6 }], [0, 6]);
    expect(map.blocks).toEqual([{ id: 'BLOCK_tower', minX: 20, minZ: -4, maxX: 28, maxZ: 4, top: 6 }]);
  });
});

/** Stage 7c: a Hall's split levels, pits and dais, hand-built as Platforms and Ramps inside an Enclosure, on an abyss field at -8. */
const ABYSS: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: -8, hazard: 'abyss' };
const hall7c = (id: string, rect: EnclosureBrush['rect'], y: number, top: number, doors: EnclosureBrush['doors']): EnclosureBrush => ({ kind: 'enclosure', id, rect, y, top, doors });
const slab = (id: string, x0: number, z0: number, x1: number, z1: number, top: number): Brush => ({ kind: 'platform', id, rect: { x0, z0, x1, z1 }, top });
const hallSource = (brushes: Brush[], levels: number[], objectives: { x: number; z: number; y?: number }[]) =>
  withBrushes([ABYSS, ...brushes], levels, {
    shortcuts: true,
    objectives: [
      { id: 'D', ...objectives[0]!, weight: 1, owner: 0, spawn: true },
      { id: 'E', ...objectives[1]!, weight: 1, owner: 1, spawn: true },
    ],
    bases: [{ x: objectives[0]!.x, z: objectives[0]!.z }, { x: objectives[1]!.x, z: objectives[1]!.z }],
  });

const twoTiers = () =>
  hallSource(
    [
      hall7c('hall', { x0: -9, z0: -11, x1: 9, z1: 11 }, 0, 6, { n: 3 }),
      hall7c('pn', { x0: -1.5, z0: 11, x1: 1.5, z1: 17 }, 0, 4, { n: 3, s: 3 }),
      hall7c('pe', { x0: 9, z0: -1.5, x1: 15, z1: 1.5 }, 2, 6, { e: 3, w: 3 }),
      slab('hall-tier', -9, -11, 9, 5, 2),
      { kind: 'ramp', id: 'hall-step0', rect: { x0: 5, z0: 5, x1: 9, z1: 9 }, lo: 0, hi: 2, up: 's', rails: ['e', 'w'] },
    ],
    [-8, 0, 2, 4, 6],
    [{ x: 0, z: 0, y: 2 }, { x: 0, z: 9 }],
  );
const pit = (D: number) =>
  hallSource(
    [
      hall7c('hall', { x0: -9, z0: -13, x1: 9, z1: 13 }, 0, D + 4, {}),
      hall7c('pe', { x0: 9, z0: -1.5, x1: 15, z1: 1.5 }, D, D + 4, { e: 3, w: 3 }),
      slab('hall-rim0', -9, -13, 9, -9, D),
      slab('hall-rim1', -9, -9, -5, 9, D),
      slab('hall-rim2', 5, -9, 9, 9, D),
      slab('hall-rim3', -9, 9, 9, 13, D),
      { kind: 'ramp', id: 'hall-step0', rect: { x0: -5, z0: -9, x1: -5 + 2 * D, z1: -5 }, lo: 0, hi: D, up: 'w', rails: ['n', 's'] },
      { kind: 'ramp', id: 'hall-step1', rect: { x0: 5 - 2 * D, z0: 5, x1: 5, z1: 9 }, lo: 0, hi: D, up: 'e', rails: ['n', 's'] },
    ],
    [-8, 0, D, D + 4],
    [{ x: 0, z: 0 }, { x: 12, z: 0, y: D }],
  );
const dais = () =>
  hallSource(
    [
      hall7c('hall', { x0: -13, z0: -13, x1: 13, z1: 13 }, 0, 4, { s: 3 }),
      hall7c('ps', { x0: -1.5, z0: -19, x1: 1.5, z1: -13 }, 0, 4, { n: 3, s: 3 }),
      slab('hall-dais', -5, 7, 5, 13, 1),
      { kind: 'ramp', id: 'hall-step0', rect: { x0: -3, z0: 5, x1: 3, z1: 7 }, lo: 0, hi: 1, up: 'n', rails: ['e', 'w'] },
    ],
    [-8, 0, 1, 4],
    [{ x: 0, z: 0 }, { x: 0, z: 10, y: 1 }],
  );

const built = (source: ReturnType<typeof hallSource>) => {
  const map = compileMap(source, battle).map;
  return { map, field: fieldOf(map) };
};
const idx = (arena: { walk: readonly { id: string; roof?: boolean }[] }, prefix: string, roof = false) =>
  arena.walk.findIndex((w) => w.id.startsWith(prefix) && (w.roof ?? false) === roof);
const jumps = (arena: Parameters<typeof navMesh>[0]) => navMesh(arena, loadTuningData()).links.filter((l): l is JumpLink => l.kind === 'jump');

describe('Platforms in an Enclosure (Stage 7c)', () => {
  it('two tiers: the main tier cuts the Hall floor, keeps its roof, has a face Wall, and walks from the doorway up to it and up its step', () => {
    const { map, field } = built(twoTiers());
    const arena = field.arena;
    expect(walkCheck(arena, lv)).toBeNull();
    const underTier = (w: { points: readonly { x: number; z: number }[] }) => w.points.some((p) => p.x > -8 && p.x < 4 && p.z > -10 && p.z < 4);
    expect(map.walk.filter((w) => w.id.startsWith('WALK_hall_') && !w.roof && w.points[0]!.y === 0 && underTier(w))).toEqual([]);
    expect(map.walk.some((w) => w.id.startsWith('WALK_hall_') && w.roof && w.points[0]!.y === 6)).toBe(true);
    const faces = map.walls.filter((w) => w.id.startsWith('WALL_hall-tier_') && w.a.z === 5 && w.b.z === 5 && Math.min(w.a.x, w.b.x) === -9 && Math.max(w.a.x, w.b.x) === 5);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((w) => w.bottom === -1 && w.top === 2)).toBe(true);
    const pe = idx(arena, 'WALK_pe_');
    const tier = idx(arena, 'WALK_hall-tier');
    expect(tier).toBeGreaterThanOrEqual(0);
    expect(trace(arena, lv, pe, 12, 0, 6, 0, false)).toBe(tier);
    expect(trace(arena, lv, groundOf(battle, field, 7, 10, 0), 7, 10, 7, 4, false)).toBe(tier);
  });

  it.each([2, 4])('a %i m pit compiles and walks; a Soldier drops into a 2 m pit but never a 4 m one', (D) => {
    const { field } = built(pit(D));
    const arena = field.arena;
    expect(walkCheck(arena, lv)).toBeNull();
    const rim = idx(arena, 'WALK_hall-rim0');
    expect(rim).toBeGreaterThanOrEqual(0);
    const floor = trace(arena, lv, rim, 0, -9.5, 0, -6, false);
    expect(floor).toBe(-1);
    const into = trace(arena, lv, rim, 0, -9.5, 0, -3, true);
    if (D === 4) expect(into).toBe(-1);
    else expect(into).toBeGreaterThanOrEqual(0);
  });

  it('a dais compiles and walks; no Soldier walks up its face, anyone steps off it, and each cell on it has one node at 1 m', () => {
    const { map, field } = built(dais());
    const arena = field.arena;
    expect(walkCheck(arena, lv)).toBeNull();
    const floor = idx(arena, 'WALK_hall_');
    const top = idx(arena, 'WALK_hall-dais');
    expect(trace(arena, lv, floor, 4, 4, 4, 8, true)).toBe(-1);
    expect(trace(arena, lv, floor, -4, 4, -4, 8, true)).toBe(-1);
    expect(trace(arena, lv, top, 0, 8, 0, 4, true)).toBe(floor);
    const b = { ...battle, maps: { [map.name]: map } };
    const f = destinationFields(b, field);
    expect(f.levels).not.toBeNull();
    let seen = 0;
    for (let c = 0; c < f.side * f.side; c++) {
      const x = ((c % f.side) - (f.side - 1) / 2) * f.cell;
      const z = (Math.floor(c / f.side) - (f.side - 1) / 2) * f.cell;
      if (!(x > -5 && x < 5 && z > 7 && z < 13)) continue;
      seen++;
      // The Hall's roof, a ledge a Player's Jump gets onto, may have a node of its own overhead; the Soldiers' nodes are the floors'.
      const ks = Array.from({ length: f.levels!.start[c + 1]! - f.levels!.start[c]! }, (_, i) => f.levels!.start[c]! + i).filter((k) => !arena.walk[f.levels!.surface[k]!]!.roof);
      expect(ks.map((k) => f.levels!.y[k])).toEqual([1]);
      expect(nodeIn(f, c, floor)).toBe(-1);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('shortcut jump Links: onto the tier, onto the dais, out of a 2 m pit, none out of a 4 m pit; every one a shortcut within SHORTCUT_RISE', () => {
    const tiers = built(twoTiers()).field.arena;
    const outer = idx(tiers, 'WALK_hall_');
    const tier = idx(tiers, 'WALK_hall-tier');
    expect(jumps(tiers).some((l) => l.to === tier && l.from === outer)).toBe(true);

    const d = built(dais()).field.arena;
    expect(jumps(d).some((l) => l.to === idx(d, 'WALK_hall-dais') && d.walk[l.from]!.id.startsWith('WALK_hall_'))).toBe(true);

    const rims = (a: ReturnType<typeof built>['field']['arena']) => a.walk.flatMap((w, i) => (w.id.startsWith('WALK_hall-rim') ? [i] : []));
    const p2 = built(pit(2)).field.arena;
    const floors2 = p2.walk.flatMap((w, i) => (w.id.startsWith('WALK_hall_') && !w.roof ? [i] : []));
    expect(jumps(p2).some((l) => floors2.includes(l.from) && rims(p2).includes(l.to))).toBe(true);
    const p4 = built(pit(4)).field.arena;
    const floors4 = p4.walk.flatMap((w, i) => (w.id.startsWith('WALK_hall_') && !w.roof ? [i] : []));
    expect(jumps(p4).filter((l) => floors4.includes(l.from) && rims(p4).includes(l.to))).toEqual([]);

    for (const a of [tiers, d, p2, p4])
      for (const l of jumps(a)) {
        expect(l.shortcut).toBe(true);
        expect(l.lands.y - surfaceHeight(a, l.from, l.takeoff.x, l.takeoff.z)).toBeLessThanOrEqual(SHORTCUT_RISE + 1e-9);
      }
  });

  it('the rise cap is a shortcuts map\'s only: with every Jump allowed a 4 m pit\'s floor still has a jump Link onto its rim', () => {
    const { jumpLinks: _shortcuts, ...arena } = built(pit(4)).field.arena; // the field's own (a Battle map's) is every Jump: `jumpLinks` absent
    const floors = arena.walk.flatMap((w, i) => (w.id.startsWith('WALK_hall_') && !w.roof ? [i] : []));
    const rimIds = arena.walk.flatMap((w, i) => (w.id.startsWith('WALK_hall-rim') ? [i] : []));
    expect(jumps(arena).some((l) => floors.includes(l.from) && rimIds.includes(l.to))).toBe(true);
  });
});
