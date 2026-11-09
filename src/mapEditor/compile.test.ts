/**
 * docs/plans/map-editor.md, Stage 0: the Map Compiler turns a Map Source into a Battle map the game accepts (its own `parseBattleMap` and
 * `walkCheck`), with Walls where the generators put them, ids made from Brush ids, and the same bytes for the same source.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseBattleMap, type BattleMapTuning } from '../tuning';
import { battlefieldOf, findPath, surfaceHeight, surfacesAt, trace, type NavPoint } from '../sim';
import { walled } from '../sim/levels';
import { compileMap, mapFileText, MapCompileError } from './compile';
import { GROUND, sampleSource, withBrushes } from './sample.testdata';
import { parseMapSource, type Brush, type MapSource } from './source';

const tuning = loadTuningData();
const battle = tuning.battle;
const lv = battle.levels;
const compile = (s: MapSource) => compileMap(s, battle);

/** The compiled map's Battlefield (built as a Battle builds it, `walkCheck` and all). */
function fieldOf(map: BattleMapTuning) {
  return battlefieldOf({ ...battle, maps: { [map.name]: map } }, `battle:${map.name}`)!;
}

/** The error compiling `s` throws. */
function refusal(s: MapSource): MapCompileError {
  try {
    compile(s);
  } catch (e) {
    if (e instanceof MapCompileError) return e;
    throw e;
  }
  throw new Error('it compiled');
}

/** Heights of the Walk Surfaces at (x, z), ascending. */
function heightsAt(map: BattleMapTuning, x: number, z: number): number[] {
  const arena = fieldOf(map).arena;
  return surfacesAt(arena, x, z)
    .map((i) => surfaceHeight(arena, i, x, z))
    .sort((a, b) => a - b);
}

const wall = (map: BattleMapTuning, id: string) => map.walls.find((w) => w.id === id);

const PLATFORM: Brush = { kind: 'platform', id: 'keep', rect: { x0: -10, z0: -6, x1: 10, z1: 6 }, top: 3 };
const RAMP: Brush = { kind: 'ramp', id: 'rampS', rect: { x0: -3, z0: -18, x1: 3, z1: -6 }, lo: 0, hi: 3, up: 'n', rails: ['e', 'w'] };

describe('the Map Compiler', () => {
  it('compiles a flat field to one floor and the field edge', () => {
    const { map, warnings } = compile(withBrushes([GROUND], [0]));
    expect(map.walk.map((w) => w.id)).toEqual(['WALK_ground_0']);
    expect(map.walk[0]!.points).toEqual([
      { x: -100, y: 0, z: -100 },
      { x: 100, y: 0, z: -100 },
      { x: 100, y: 0, z: 100 },
      { x: -100, y: 0, z: 100 },
    ]);
    expect(map.walls.map((w) => w.id)).toEqual(['WALL_edge_s', 'WALL_edge_e', 'WALL_edge_n', 'WALL_edge_w']);
    expect(map.blocks).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('cuts the ground out under a Platform, faces it with Walls, and joins its top to the ground by its Ramp for Soldiers and Fighters', () => {
    const { map } = compile(withBrushes([GROUND, PLATFORM, RAMP], [0, 3]));
    // No ground under the keep or the ramp: only the keep's top at its centre, only the ramp on its line.
    expect(heightsAt(map, 0, 0)).toEqual([3]);
    expect(heightsAt(map, 0, -12)).toEqual([1.5]);
    expect(heightsAt(map, 20, 0)).toEqual([0]);
    // Its faces stand from below the ground to its top, cut round the ramp's top on the south face.
    expect(wall(map, 'WALL_keep_w0')).toEqual({ id: 'WALL_keep_w0', a: { x: -10, z: -6 }, b: { x: -10, z: 6 }, bottom: -1, top: 3 });
    expect(map.walls.filter((w) => w.id.startsWith('WALL_keep_s')).map((w) => [w.a.x, w.b.x])).toEqual([
      [-10, -3],
      [3, 10],
    ]);
    expect(wall(map, 'WALL_rampS_e')).toEqual({ id: 'WALL_rampS_e', a: { x: 3, z: -18 }, b: { x: 3, z: -6 }, bottom: -1, top: 4 });
    // walkCheck passed (it compiled), and the Fighters' navmesh walks from the ground up the ramp onto the top.
    const arena = fieldOf(map).arena;
    const from: NavPoint = { x: 0, z: -40, y: 0 };
    const to: NavPoint = { x: 0, z: 0, y: 3 };
    const path = findPath(arena, tuning, from, to, { jumps: false });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });

  it('keeps the ground under a Deck: a tunnel under it and a bridge over it at one x, z, walled in by the Platforms beside', () => {
    const brushes: Brush[] = [
      GROUND,
      { kind: 'platform', id: 'west', rect: { x0: -20, z0: -6, x1: -3, z1: 6 }, top: 4 },
      { kind: 'platform', id: 'east', rect: { x0: 3, z0: -6, x1: 20, z1: 6 }, top: 4 },
      { kind: 'deck', id: 'roof', rect: { x0: -3, z0: -6, x1: 3, z1: 6 }, y: 4 },
      { kind: 'ramp', id: 'rampW', rect: { x0: -32, z0: -3, x1: -20, z1: 3 }, lo: 0, hi: 4, up: 'e', rails: ['n', 's'] },
      { kind: 'ramp', id: 'rampE', rect: { x0: 20, z0: -3, x1: 32, z1: 3 }, lo: 0, hi: 4, up: 'w', rails: ['n', 's'] },
    ];
    const { map } = compile(withBrushes(brushes));
    expect(heightsAt(map, 0, 0)).toEqual([0, 4]);
    expect(heightsAt(map, -10, 0)).toEqual([4]);
    expect(wall(map, 'WALL_west_e0')).toEqual({ id: 'WALL_west_e0', a: { x: -3, z: -6 }, b: { x: -3, z: 6 }, bottom: -1, top: 4 });
    expect(wall(map, 'WALL_east_w0')).toEqual({ id: 'WALL_east_w0', a: { x: 3, z: -6 }, b: { x: 3, z: 6 }, bottom: -1, top: 4 });
    // Nothing stands across the tunnel's mouths, nor under the Deck's open edges.
    expect(map.walls.some((w) => w.id.startsWith('WALL_roof'))).toBe(false);
    // A Soldier walks through the tunnel on the ground, and along the top over it.
    const arena = fieldOf(map).arena;
    const ground = surfacesAt(arena, 0, -20).find((i) => surfaceHeight(arena, i, 0, -20) === 0)!;
    expect(surfaceHeight(arena, trace(arena, lv, ground, 0, -20, 0, 20, false), 0, 20)).toBe(0);
    const top = surfacesAt(arena, -10, 0)[0]!;
    expect(map.walk[trace(arena, lv, top, -10, 0, 10, 0, false)]!.id).toBe('WALK_east_0');
  });

  it('opens a doorway through a Platform with a Hole at its top: the ground comes back, jambs either side', () => {
    const rampart: Brush = { kind: 'platform', id: 'rampart', rect: { x0: -100, z0: -1, x1: 100, z1: 1 }, top: 4 };
    const up: Brush = { kind: 'ramp', id: 'up', rect: { x0: 20, z0: -13, x1: 26, z1: -1 }, lo: 0, hi: 4, up: 'n', rails: ['e', 'w'] };
    const up2: Brush = { ...up, id: 'up2', rect: { x0: -26, z0: -13, x1: -20, z1: -1 } };
    const door: Brush = { kind: 'hole', id: 'door', rect: { x0: -2, z0: -1, x1: 2, z1: 1 }, y: 4 };
    // Without the door the north can never be walked to: the rampart is too high to drop off northward and has no ramp there.
    const shut = refusal(withBrushes([GROUND, rampart, up, up2]));
    expect(shut.message).toMatch(/cannot be walked to/);
    expect(shut.brushes).toEqual(['ground']);
    const { map, warnings } = compile(withBrushes([GROUND, rampart, up, up2, door]));
    expect(warnings).toEqual([]);
    expect(heightsAt(map, 0, 0)).toEqual([0]);
    expect(heightsAt(map, 10, 0)).toEqual([4]);
    expect(wall(map, 'WALL_rampart_e0')).toEqual({ id: 'WALL_rampart_e0', a: { x: -2, z: -1 }, b: { x: -2, z: 1 }, bottom: -1, top: 4 });
    expect(wall(map, 'WALL_rampart_w0')).toEqual({ id: 'WALL_rampart_w0', a: { x: 2, z: -1 }, b: { x: 2, z: 1 }, bottom: -1, top: 4 });
    const arena = fieldOf(map).arena;
    const south = surfacesAt(arena, 0, -5)[0]!;
    expect(trace(arena, lv, south, 0, -5, 0, 5, false)).toBeGreaterThanOrEqual(0);
    expect(trace(arena, lv, surfacesAt(arena, 10, -5)[0]!, 10, -5, 10, 5, false)).toBe(-1);
  });

  it('lays lava 8 m down in a pit beside an open bank, and leaves it out of the walk check', () => {
    const { map, warnings } = compile(
      withBrushes(
        [
          GROUND,
          { kind: 'hole', id: 'pit', rect: { x0: 20, z0: -10, x1: 40, z1: 10 }, y: 0 },
          { kind: 'hazard', id: 'lava', rect: { x0: 20, z0: -10, x1: 40, z1: 10 }, y: -8, hazard: 'lava' },
        ],
        [-8, 0],
      ),
    );
    expect(warnings).toEqual([]);
    expect(map.walk.filter((w) => w.lava)).toEqual([
      {
        id: 'WALK_lava_0',
        lava: true,
        points: [
          { x: 20, y: -8, z: -10 },
          { x: 40, y: -8, z: -10 },
          { x: 40, y: -8, z: 10 },
          { x: 20, y: -8, z: 10 },
        ],
      },
    ]);
    expect(heightsAt(map, 30, 0)).toEqual([-8]);
    // The bank is an open ledge: no Wall but the field's edge, and they reach below the lava.
    expect(map.walls.map((w) => w.id)).toEqual(['WALL_edge_s', 'WALL_edge_e', 'WALL_edge_n', 'WALL_edge_w']);
    expect(map.walls[0]!.bottom).toBe(-9);
    // A Soldier on the bank walking at the lava stops at the edge: no ground within its drop.
    const arena = fieldOf(map).arena;
    expect(trace(arena, lv, surfacesAt(arena, 15, 0)[0]!, 15, 0, 25, 0, true)).toBe(-1);
  });

  it('refuses a Block under a Deck, naming both', () => {
    const e = refusal(
      withBrushes([GROUND, { kind: 'block', id: 'tower', rect: { x0: -4, z0: -4, x1: 4, z1: 4 }, top: 6 }, { kind: 'deck', id: 'bridge', rect: { x0: -10, z0: -2, x1: 10, z1: 2 }, y: 4 }]),
    );
    expect(e.brushes).toEqual(['tower', 'bridge']);
    expect(e.message).toMatch(/Block tower stands under bridge/);
  });

  it('carries Blocks through, the ground cut out under them, and refuses one whose Walls would not stand at its floor', () => {
    const tower: Brush = { kind: 'block', id: 'tower', rect: { x0: 20, z0: -4, x1: 28, z1: 4 }, top: 6 };
    const { map, warnings } = compile(withBrushes([GROUND, tower], [0]));
    expect(map.blocks).toEqual([{ id: 'BLOCK_tower', minX: 20, minZ: -4, maxX: 28, maxZ: 4, top: 6 }]);
    expect(surfacesAt(fieldOf(map).arena, 24, 0)).toEqual([]);
    expect(warnings).toEqual([]);
    // Painted before the ground, it still cuts it out.
    expect(compile(withBrushes([tower, GROUND], [0])).map.walk).toEqual(map.walk);
    const sunk = refusal(withBrushes([{ kind: 'floor', id: 'ground', rect: GROUND.rect, y: -4 }, tower], [-4]));
    expect(sunk.brushes).toEqual(['tower']);
    expect(sunk.message).toMatch(/Walls stand from -1/);
  });

  it('refuses a Platform no Ramp reaches, by walkCheck, naming it', () => {
    const e = refusal(withBrushes([GROUND, { kind: 'platform', id: 'mesa', rect: { x0: 40, z0: 40, x1: 50, z1: 50 }, top: 4 }]));
    expect(e.message).toMatch(/Soldiers cannot walk the whole map: Walk Surface WALK_mesa_0 cannot be walked to/);
    expect(e.brushes).toEqual(['mesa']);
  });

  it('refuses what the game refuses, naming the Brush: an Objective inside a Block, a floor short of the field edge', () => {
    const inBlock = refusal(withBrushes([GROUND, { kind: 'block', id: 'tower', rect: { x0: -2, z0: -2, x1: 2, z1: 2 }, top: 6 }], [0]));
    expect(inBlock.message).toMatch(/objectives\[2\] \(B\) stands inside a block/);
    const short = refusal(withBrushes([{ kind: 'floor', id: 'yard', rect: { x0: -90, z0: -100, x1: 100, z1: 100 }, y: 0 }], [0]));
    expect(short.message).toMatch(/must reach every side/);
    expect(refusal({ ...withBrushes([GROUND], [0]), size: 150 }).message).toMatch(/a Battle's field is 200 m/);
  });

  it('refuses a floor in a Ramp’s way and overlapping Ramps, whatever their order', () => {
    const e = refusal(withBrushes([GROUND, PLATFORM, RAMP, { kind: 'deck', id: 'patch', rect: { x0: -1, z0: -12, x1: 1, z1: -10 }, y: 3 }], [0, 3]));
    expect(e.brushes).toEqual(['rampS', 'patch']);
    // Floor under its wedge is cut out whether it comes before or after the Ramp, so a Platform it stands on may follow it.
    const upper: Brush = { kind: 'ramp', id: 'upper', rect: { x0: -2, z0: -6, x1: 2, z1: 2 }, lo: 3, hi: 6, up: 'n', rails: ['e', 'w'] };
    const top: Brush = { kind: 'platform', id: 'top', rect: { x0: -6, z0: 2, x1: 6, z1: 6 }, top: 6 };
    const after = compile(withBrushes([GROUND, RAMP, upper, PLATFORM, top], [0, 3, 6]));
    const before = compile(withBrushes([GROUND, PLATFORM, RAMP, upper, top], [0, 3, 6])).map;
    const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(byId(after.map.walk)).toEqual(byId(before.walk));
    expect(byId(after.map.walls)).toEqual(byId(before.walls));
    expect(heightsAt(after.map, 0, -2)).toEqual([4.5]);
    const twin: Brush = { ...RAMP, id: 'rampT', rect: { x0: 0, z0: -18, x1: 6, z1: -6 } };
    expect(refusal(withBrushes([GROUND, PLATFORM, RAMP, twin], [0, 3])).brushes).toEqual(['rampS', 'rampT']);
  });

  it('steps the skirt of an unrailed Ramp: nobody on it is stopped sideways, nobody beside it walks under', () => {
    const open: Brush = { ...RAMP, rails: [] };
    const { map } = compile(withBrushes([GROUND, PLATFORM, open], [0, 3]));
    const skirt = map.walls.filter((w) => w.id.startsWith('WALL_rampS_e'));
    // Steps of 3 / 9 m; the first, no higher than a step, is stepped onto from beside and needs no skirt.
    expect(skirt.length).toBe(Math.ceil(3 / lv.stepUp) - 1);
    skirt.forEach((w, k) => {
      expect(w.a.x).toBe(3);
      expect(w.bottom).toBe(-1);
      if (k > 0) expect(w.top - skirt[k - 1]!.top).toBeLessThanOrEqual(lv.stepUp + 1e-9);
    });
    const arena = fieldOf(map).arena;
    for (const z of [-17, -14, -11, -7]) {
      const y = 3 * ((z + 18) / 12);
      // On the ramp, stepping off east: no Wall at its height (it may drop).
      expect(walled(arena, lv, 2.9, z, 3.1, z, y), `on the ramp at z ${z}`).toBe(false);
      // Beside it on the ground, walking in under it where it is above a step: walled.
      if (y > lv.stepUp + 0.25) expect(walled(arena, lv, 3.1, z, 2.9, z, 0), `beside the ramp at z ${z}`).toBe(true);
    }
  });

  it('warns of a Brush painted over, a Hole over nothing, and an edge over nothing', () => {
    const { warnings } = compile(
      withBrushes(
        [
          { kind: 'floor', id: 'lost', rect: { x0: -10, z0: -10, x1: 10, z1: 10 }, y: 0 },
          GROUND,
          { kind: 'hole', id: 'void', rect: { x0: 60, z0: 60, x1: 70, z1: 70 }, y: 4 },
          { kind: 'hole', id: 'pit', rect: { x0: 60, z0: -70, x1: 70, z1: -60 }, y: 0 },
        ],
      ),
    );
    expect(warnings.map((w) => w.brush)).toEqual(['void', 'lost', 'ground']);
  });

  it('compiles the same source to the same bytes, and the file reads back as the same map', () => {
    const a = mapFileText(compile(sampleSource()).map);
    const b = mapFileText(compile(parseMapSource(JSON.parse(JSON.stringify(sampleSource())))).map);
    expect(b).toBe(a);
    const { map } = compile(sampleSource());
    expect(parseBattleMap(JSON.parse(a), 'sample', battle)).toEqual(map);
  });

  it('keeps every id of the other Brushes when an unrelated Brush is added', () => {
    const before = compile(sampleSource()).map;
    const s = sampleSource();
    const more: Brush[] = [
      { kind: 'platform', id: 'tower', rect: { x0: -80, z0: 60, x1: -70, z1: 70 }, top: 4 },
      { kind: 'ramp', id: 'towerRamp', rect: { x0: -80, z0: 48, x1: -76, z1: 60 }, lo: 0, hi: 4, up: 'n', rails: ['e', 'w'] },
      { kind: 'wall', id: 'fence', a: { x: 60, z: -60 }, b: { x: 70, z: -60 }, bottom: -1, top: 2 },
    ];
    const after = compile({ ...s, brushes: [...s.brushes, ...more] }).map;
    const others = <T extends { id: string }>(xs: readonly T[]) => xs.filter((x) => !/^WALK_(ground_|tower)|^WALL_(tower|fence|edge)/.test(x.id));
    expect(others(after.walk)).toEqual(others(before.walk));
    expect(others(after.walls)).toEqual(others(before.walls));
    expect(after.walls.filter((w) => /^WALL_(tower|fence)/.test(w.id)).length).toBeGreaterThan(4);
  });

  it('compiles the sample (a keep, two ramps, a bridge over a lava pit, five Objectives) to a map a Battle builds', () => {
    const { map, warnings } = compile(sampleSource());
    expect(warnings).toEqual([]);
    const field = fieldOf(map);
    expect(field.layered).toBe(true);
    // B on the keep's top, C on the bridge's end, the lava under the bridge.
    expect(field.objectives.map((o) => o.id)).toEqual(['D', 'A', 'B', 'C', 'E']);
    expect(map.walk[field.objectiveSurfaces[2]!]!.id).toBe('WALK_keep_0');
    expect(map.walk[field.objectiveSurfaces[3]!]!.id).toBe('WALK_bridge_0');
    expect(heightsAt(map, 28, 0)).toEqual([-8, 4]);
  });
});

describe('the Map Source', () => {
  const raw = () => JSON.parse(JSON.stringify(sampleSource())) as Record<string, unknown> & { brushes: Record<string, unknown>[] };

  it('parses its own output', () => {
    const once = parseMapSource(raw());
    expect(parseMapSource(once)).toEqual(once);
    expect(once).toEqual(sampleSource());
  });

  it('refuses a coordinate off the grid, a height not among its levels, a second Brush of one id, and a rail on a ramp’s end', () => {
    const off = raw();
    off.brushes[1]!.rect = { x0: -12.25, z0: -8, x1: 12, z1: 8 };
    expect(() => parseMapSource(off)).toThrow(/x0 \(-12.25\) must lie on the 0.5 m grid/);
    const high = raw();
    high.brushes[1]!.top = 5;
    expect(() => parseMapSource(high)).toThrow(/keep\)\.top \(5\) must be one of the source's levels/);
    const under = raw();
    under.brushes[1]!.id = 'keep_n0';
    expect(() => parseMapSource(under)).toThrow(/may hold only letters, digits and -/);
    const twice = raw();
    twice.brushes[2]!.id = 'keep';
    expect(() => parseMapSource(twice)).toThrow(/another Brush is already "keep"/);
    const end = raw();
    end.brushes[2]!.rails = ['n'];
    expect(() => parseMapSource(end)).toThrow(/must be a long side of the ramp/);
  });
});

describe('the Map Editor’s pure part', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.testdata.ts'));

  it.each(files)('%s uses no randomness, clock, trig, DOM or three.js', (file) => {
    const src = readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/Math\.(random|sin|cos|tan|asin|acos|atan2?)\b|\bDate\b|\bperformance\b|\b(window|document)\b|from\s+['"]three/);
  });
});
