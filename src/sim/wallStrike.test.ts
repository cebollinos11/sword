import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry, type TuningData, type WallSegment } from '../tuning';
import { attack, createInitialState, runScript, type ScriptRun } from './index';

const base = loadTuningData();
const corner = (x: number, z: number) => ({ x, y: 0, z });
const flat: ArenaGeometry = {
  name: 'walled',
  walk: [{ id: 'floor', points: [corner(-20, -20), corner(-20, 20), corner(20, 20), corner(20, -20)] }],
  walls: [],
  spawns: [],
};

/** Fighter 0 at the origin facing +z swings an Overhead at Fighter 1, 1.3 m ahead (in range), with `walls` in the Arena. */
function overheadWith(walls: WallSegment[]): ScriptRun {
  const tuning: TuningData = { ...base, arenas: { ...base.arenas, walled: { ...flat, walls } } };
  const placements = [
    { position: { x: 0, z: 0 }, facing: 0 },
    { position: { x: 0, z: 1.3 }, facing: Math.PI },
  ];
  return runScript(tuning, createInitialState(tuning, 1, placements, [], [], 'walled'), [attack('Overhead'), []]);
}

/** A Wall across the gap between the two Fighters, from `bottom` to `top`. */
const between = (bottom: number, top: number): WallSegment => ({ id: 'w', a: { x: -5, z: 0.65 }, b: { x: 5, z: 0.65 }, bottom, top });

describe('a Blade Sweep against Arena Walls', () => {
  it('lands without a Wall in the way', () => {
    const run = overheadWith([]);
    expect(run.events.filter((e) => e.type === 'Hit')).toHaveLength(1);
    expect(run.events.filter((e) => e.type === 'WallStrike')).toHaveLength(0);
  });

  it('stops at a Wall between the Fighters: no Hit, and the attacker recoils', () => {
    const run = overheadWith([between(0, 3)]);
    expect(run.events.filter((e) => e.type === 'Hit')).toHaveLength(0);
    const strikes = run.events.filter((e) => e.type === 'WallStrike');
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({ attacker: 0, direction: 'Overhead' });
    if (strikes[0]!.type === 'WallStrike') expect(strikes[0]!.point.z).toBeCloseTo(0.65, 6);
    expect(run.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 0, cause: 'Blocked', tick: strikes[0]!.tick }));
    expect(run.final.fighters[1]!.hp).toBe(base.fighter.maxHp);
  });

  it('passes over a Wall lower than the blade (a low rail)', () => {
    const run = overheadWith([between(0, 0.2)]);
    expect(run.events.filter((e) => e.type === 'Hit')).toHaveLength(1);
    expect(run.events.filter((e) => e.type === 'WallStrike')).toHaveLength(0);
  });
});
