/**
 * The Enclosure Brush (a room): its floor, its roof at the next level up (a roof Soldiers need never reach), its Walls with a doorway centred
 * on each side it names, one Wall where two meet edge to edge, its half turn, and the Battle standing nobody on its roof.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type BattleMapTuning } from '../tuning';
import { battlefieldOf, groundOf, surfaceHeight } from '../sim';
import { walkCheck, walled } from '../sim/levels';
import { compileMap } from './compile';
import { turnBrush } from './mirror';
import { GROUND, withBrushes } from './sample.testdata';
import { MapEditorSession } from './session';
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
