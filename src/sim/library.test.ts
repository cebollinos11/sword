import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { groundBelow } from './arena';
import { createInitialState, createMatch, runScript, walk, type Placement } from './index';

const tuning = loadTuningData();
const library = tuning.arenas.library!;

function run(placement: Placement, move: { x: number; z: number }, ticks: number) {
  return runScript(tuning, createInitialState(tuning, 1, [placement], [], [], 'library'), [walk(ticks, move)], ticks).final.fighters[0]!;
}

describe('The library Arena', () => {
  it('is the Match Arena, and a Match starts every Fighter at its spawn, on the ground', () => {
    expect(tuning.arena.match).toBe('library');
    const m = createMatch(tuning, { bestOf: 1, teams: [0, 1, 0, 1] });
    expect(m.duel.arena).toBe('library');
    const spawn = (team: number, slot: number) => library.spawns.find((s) => s.team === team && s.slot === slot)!;
    const expected = [spawn(0, 0), spawn(1, 0), spawn(0, 1), spawn(1, 1)];
    m.duel.fighters.forEach((f, i) => {
      expect(f.position).toEqual({ x: expected[i]!.position.x, z: expected[i]!.position.z });
      expect(f.facing).toBe(expected[i]!.facing);
      expect(f.y).toBe(groundBelow(library, f.position.x, f.position.z, expected[i]!.position.y + 0.1)!.y);
    });
  });

  it('has a spawn for every slot of both teams', () => {
    for (const team of [0, 1]) for (const slot of [0, 1, 2]) expect(library.spawns.some((s) => s.team === team && s.slot === slot)).toBe(true);
  });

  it('a Fighter walks from the alcove up the west ramp onto the mezzanine', () => {
    const f = run({ position: { x: 0, z: -8 }, facing: -Math.PI / 2 }, { x: -1, z: 0 }, 60 * 7);
    expect(f.air).toBeUndefined();
    expect(f.y).toBe(3);
    expect(f.position.x).toBeLessThan(-9);
  });

  it('a Fighter on the ground cannot walk into the solid wedge under a ramp', () => {
    const f = run({ position: { x: -5, z: -5 }, facing: Math.PI }, { x: 0, z: -1 }, 120);
    expect(f.y).toBe(0);
    expect(f.position.z).toBeGreaterThan(-7);
  });
});
