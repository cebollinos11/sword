import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { groundBelow } from './arena';
import { createInitialState, createMatch, IDLE_INTENT, runScript, step, walk, type Placement, type SimState } from './index';

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

type Move = { x: number; z: number };

/** The id of the Walk Surface Fighter 0 stands on. */
function standingOn(s: SimState): string | undefined {
  const f = s.fighters[0]!;
  const g = groundBelow(library, f.position.x, f.position.z, f.y + 1e-6);
  return g && Math.abs(g.y - f.y) < 1e-6 ? library.walk[g.surface]!.id : undefined;
}

/**
 * Fighter 0 alone in the library at (x, y, z), Jumps walking along `move`, holding Jump for `hold` Ticks (0 is a tap),
 * keeps walking until it lands, then stands still for a moment.
 */
function jumpFrom([x, y, z]: [number, number, number], move: Move, hold: number): SimState {
  let s = createInitialState(tuning, 1, [{ position: { x, z }, facing: Math.atan2(move.x, move.z), y }], [], [], 'library');
  let rose = false;
  for (let t = 0; t < 300; t++) {
    s = step(s, [{ ...IDLE_INTENT, move, jump: t === 0, jumpHeld: t < hold }], tuning);
    if (s.fighters[0]!.air) rose = true;
    else if (rose) break;
  }
  for (let t = 0; t < 10; t++) s = step(s, [IDLE_INTENT], tuning);
  return s;
}

/** Steps Fighter 0 walking `move` for `ticks` Ticks; every state along the way. */
function walkAlong(s: SimState, move: Move, ticks: number): SimState[] {
  const states = [s];
  for (let t = 0; t < ticks; t++) states.push((s = step(s, [{ ...IDLE_INTENT, move }], tuning)));
  return states;
}

describe('The reading tables can be jumped onto and walked on', () => {
  const landed = jumpFrom([-5, 0, 8.6], { x: 0, z: 1 }, 0);

  it('a tap from the floor ends standing on the table', () => {
    const f = landed.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.death).toBeUndefined();
    expect(f.y).toBeCloseTo(0.8, 6);
    expect(standingOn(landed)).toBe('WALK_table0_top');
  });

  it('walking along the top keeps the Fighter up there', () => {
    const states = walkAlong(landed, { x: 1, z: 0 }, 30);
    for (const s of states) {
      expect(s.fighters[0]!.y).toBeCloseTo(0.8, 6);
      expect(standingOn(s)).toBe('WALK_table0_top');
    }
    expect(states.at(-1)!.fighters[0]!.position.x).toBeGreaterThan(landed.fighters[0]!.position.x + 1);
  });

  it('walking off the edge comes back down to the floor', () => {
    const s = walkAlong(walkAlong(landed, { x: -1, z: 0 }, 60).at(-1)!, { x: 0, z: 0 }, 60).at(-1)!;
    const f = s.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(0);
    expect(standingOn(s)).toMatch(/^WALK_floor_/);
  });
});
