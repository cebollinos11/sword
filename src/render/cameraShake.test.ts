import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, createInitialState, duelPlacements, hold, runDuel } from '../sim';
import { blockJolts } from './cameraShake';

const tuning = loadTuningData();

describe('blockJolts', () => {
  const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
  const jolts = (fighter: number) => run.states.flatMap((s) => blockJolts(s, tuning, fighter));

  it('a Block jolts the defender hardest, the attacker less, and nobody else', () => {
    const [defender] = jolts(1);
    const [attacker] = jolts(0);
    expect(jolts(1)).toHaveLength(1);
    expect(defender).toBeGreaterThan(0);
    expect(defender).toBeLessThanOrEqual(1);
    expect(attacker).toBeLessThan(defender!);
    expect(jolts(2)).toEqual([]);
  });

  it('a Hit makes no jolt; a Blocked dagger jolts its defender lightly', () => {
    const hit = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    expect(hit.states.flatMap((s) => blockJolts(s, tuning, 1))).toEqual([]);
    const fighters = createInitialState(tuning, 1, duelPlacements(3)).fighters;
    const dagger = blockJolts({ fighters, events: [{ type: 'DaggerBlocked', thrower: 0, defender: 1, point: { x: 0, y: 1, z: 1 } }] }, tuning, 1);
    expect(dagger).toHaveLength(1);
    expect(dagger[0]).toBeLessThan(1);
  });
});
