import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type ArenaGeometry, type TuningData } from '../tuning';
import { groundBelow } from './arena';
import { resolveBodies } from './collision';
import { createInitialState, hold, runScript, walk, type Placement, type SimState } from './index';

const repo = loadTuningData();

/**
 * A small test Arena (all heights in m):
 *   - floor:    x -10..10, z -10..10 at 0
 *   - ramp:     x 2..4, z 0..6, rising from 0 to 2 (slope 1/3)
 *   - platform: x 2..6, z 6..10 at 2, walled below on its sides (except where the ramp meets it); open ledge east (x = 6)
 *   - step:     x -4..-2, z -2..2 at 0.3 (within a step up)
 *   - block:    x -8..-6, z -2..2 at 1 (too high to step onto, and no Wall)
 *   - a Wall along z = -5, from 0 to 3
 */
const TEST_ARENA: ArenaGeometry = parseArena(
  {
    name: 'test',
    walk: [
      { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
      { id: 'WALK_ramp', points: [[2, 0, 0], [4, 0, 0], [4, 2, 6], [2, 2, 6]] },
      { id: 'WALK_platform', points: [[2, 2, 6], [6, 2, 6], [6, 2, 10], [2, 2, 10]] },
      { id: 'WALK_step', points: [[-4, 0.3, -2], [-2, 0.3, -2], [-2, 0.3, 2], [-4, 0.3, 2]] },
      { id: 'WALK_block', points: [[-8, 1, -2], [-6, 1, -2], [-6, 1, 2], [-8, 1, 2]] },
    ],
    walls: [
      { id: 'WALL_south', a: [-10, -5], b: [10, -5], bottom: 0, top: 3 },
      { id: 'WALL_platformSouth', a: [4, 6], b: [6, 6], bottom: 0, top: 2 },
      { id: 'WALL_platformWest', a: [2, 6], b: [2, 10], bottom: 0, top: 2 },
      { id: 'WALL_platformEast', a: [6, 6], b: [6, 10], bottom: 0, top: 2 },
      { id: 'WALL_rampWest', a: [2, 0], b: [2, 6], bottom: 0, top: 2 },
      { id: 'WALL_rampEast', a: [4, 0], b: [4, 6], bottom: 0, top: 2 },
    ],
  },
  'test',
);

const tuning: TuningData = { ...repo, arenas: { ...repo.arenas, test: TEST_ARENA } };

function run(placement: Placement, track: Parameters<typeof runScript>[2][number], ticks: number): SimState[] {
  const initial = createInitialState(tuning, 1, [placement], [], [], 'test');
  return runScript(tuning, initial, [track], ticks).states as SimState[];
}

const rampHeight = (z: number) => Math.min(2, Math.max(0, z / 3));

describe('Arena ground', () => {
  it('finds the highest Walk Surface at or below a height', () => {
    expect(groundBelow(TEST_ARENA, 3, 3, 10)!.y).toBeCloseTo(1, 9);
    expect(groundBelow(TEST_ARENA, 3, 3, 0.5)!.y).toBe(0); // under the ramp, below its surface
    expect(groundBelow(TEST_ARENA, 5, 8, 10)!.y).toBe(2);
    expect(groundBelow(TEST_ARENA, 20, 0, 10)).toBeNull();
  });

  it('a Fighter walks up the ramp onto the platform, its feet on the ramp all the way, and never leaves the ground', () => {
    const states = run({ position: { x: 3, z: 0.5 }, facing: 0 }, walk(240, { x: 0, z: 1 }), 240);
    for (const s of states) {
      const f = s.fighters[0]!;
      expect(f.air, `Tick ${s.tick}`).toBeUndefined();
      expect(f.y).toBeCloseTo(rampHeight(f.position.z), 6);
    }
    const end = states.at(-1)!.fighters[0]!;
    expect(end.position.z).toBeGreaterThan(7);
    expect(end.y).toBe(2);
    for (const foot of ['left', 'right'] as const) expect(end.gait[foot].y).toBe(2);
  });

  it('walks back down the ramp without going airborne', () => {
    const states = run({ position: { x: 3, z: 8 }, facing: Math.PI, y: 2 }, walk(240, { x: 0, z: -1 }), 240);
    for (const s of states) expect(s.fighters[0]!.air, `Tick ${s.tick}`).toBeUndefined();
    expect(states.at(-1)!.fighters[0]!.y).toBe(0);
  });

  it('steps up onto ground within a step, and is stopped by higher ground, sliding along it', () => {
    const up = run({ position: { x: -1, z: 0 }, facing: 0 }, walk(60, { x: -1, z: 0 }), 60).at(-1)!.fighters[0]!;
    expect(up.y).toBeCloseTo(0.3, 9);
    expect(up.position.x).toBeLessThan(-2);
    // Into the 1 m block, slanted: held at its edge, sliding along z.
    const blocked = run({ position: { x: -5, z: -1 }, facing: 0 }, walk(120, { x: -1, z: 0.5 }), 120);
    for (const s of blocked) expect(s.fighters[0]!.position.x).toBeGreaterThanOrEqual(-6 - 1e-9);
    const end = blocked.at(-1)!.fighters[0]!;
    expect(end.y).toBe(0);
    expect(end.position.z).toBeGreaterThan(1);
  });

  it('a Wall stops the body and turns a slanted walk into a slide along it', () => {
    const states = run({ position: { x: 0, z: -3 }, facing: 0 }, walk(120, { x: 1, z: -1 }), 120);
    for (const s of states) expect(s.fighters[0]!.position.z).toBeGreaterThanOrEqual(-5 + repo.fighter.radius - 1e-9);
    expect(states.at(-1)!.fighters[0]!.position.x).toBeGreaterThan(3);
  });

  it('walking off a ledge goes airborne with the walk, and lands on the floor below', () => {
    const states = run({ position: { x: 5, z: 8 }, facing: Math.PI / 2, y: 2 }, walk(120, { x: 1, z: 0 }), 120);
    const off = states.findIndex((s) => s.fighters[0]!.air);
    expect(off).toBeGreaterThan(0);
    expect(states[off]!.fighters[0]!.position.x).toBeGreaterThan(6 - 0.05);
    expect(states[off]!.fighters[0]!.air!.vx).toBeCloseTo(repo.fighter.walkSpeed, 6);
    const landed = states.findIndex((s, t) => t > off && !s.fighters[0]!.air);
    expect(landed).toBeGreaterThan(off);
    expect(states[landed]!.fighters[0]!.y).toBe(0);
    for (let t = off; t < landed; t++) expect(states[t + 1]!.fighters[0]!.y).toBeLessThanOrEqual(states[t]!.fighters[0]!.y);
  });

  it('Fighters at different heights pass over each other; at the same height they push apart', () => {
    const noWalls: ArenaGeometry = { ...TEST_ARENA, walls: [] };
    const apart = resolveBodies([{ position: { x: 4, z: 8 }, y: 0 }, { position: { x: 4, z: 8 }, y: 2 }], noWalls, tuning);
    expect(apart[0]).toEqual(apart[1]);
    const pushed = resolveBodies([{ position: { x: 4, z: 8 }, y: 2 }, { position: { x: 4.1, z: 8 }, y: 2 }], noWalls, tuning);
    expect(pushed[1]!.x - pushed[0]!.x).toBeCloseTo(2 * repo.fighter.radius, 9);
  });

  it('stays still standing on the ramp (no sliding down it)', () => {
    const states = run({ position: { x: 3, z: 3 }, facing: 0, y: 1 }, hold(60), 60);
    const f = states.at(-1)!.fighters[0]!;
    expect(f.position).toEqual({ x: 3, z: 3 });
    expect(f.y).toBeCloseTo(1, 9);
  });
});
