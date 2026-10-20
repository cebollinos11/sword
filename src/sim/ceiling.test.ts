import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, runScript, type Track } from './index';

const tuning = loadTuningData();
const { height } = tuning.fighter;

/** A full held Jump in the library from (x, y, z), walking along `move` (still if none), then `after` Ticks more. */
function fullJump(x: number, y: number, z: number, move = { x: 0, z: 0 }, after = 150) {
  const hold = 30;
  const track: Track = [
    { ticks: 1, intent: { move, jump: true, jumpHeld: true } },
    { ticks: hold - 1, intent: { move, jumpHeld: true } },
    { ticks: after, intent: { move } },
  ];
  const facing = Math.atan2(move.x, move.z);
  return runScript(tuning, createInitialState(tuning, 1, [{ position: { x, z }, facing, y }], [], [], 'library'), [track], hold + after);
}

describe('A Walk Surface overhead is solid from below', () => {
  it('a full Jump under the library bridge bumps its head and lands back on the floor', () => {
    const r = fullJump(-5, 0, 0);
    const top = Math.max(...r.states.map((s) => s.fighters[0]!.y));
    expect(top).toBeGreaterThan(3 - height - 0.05);
    expect(top).toBeLessThanOrEqual(3 - height + 1e-9);
    const f = r.final.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.y).toBe(0);
  });

  it('a full Jump in the alcove under the south mezzanine bumps its head and lands back on the floor', () => {
    const r = fullJump(0, 0, -10.5);
    expect(Math.max(...r.states.map((s) => s.fighters[0]!.y))).toBeLessThanOrEqual(3 - height + 1e-9);
    const f = r.final.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.y).toBe(0);
  });

  it('a full Jump still lands on the east mezzanine through a gap in its rail', () => {
    const f = fullJump(7, 0, -4.25, { x: 1, z: 0 }, 70).final.fighters[0]!;
    expect(f.air).toBeUndefined();
    expect(f.death).toBeUndefined();
    expect(f.y).toBe(3);
    expect(f.position.x).toBeGreaterThan(9);
  });
});
