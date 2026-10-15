import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel } from '../sim';
import { impactBursts } from './impacts';

const tuning = loadTuningData();

describe('impactBursts', () => {
  it('a Hit bursts where the blade connected', () => {
    const run = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const hit = run.states.flatMap((s) => s.events).find((e) => e.type === 'Hit')!;
    const bursts = run.states.flatMap((s) => impactBursts(s, tuning));
    expect(bursts).toEqual([{ kind: 'Hit', point: hit.point, strength: expect.any(Number) }]);
    expect(bursts[0]!.strength).toBeGreaterThan(0);
    expect(bursts[0]!.strength).toBeLessThanOrEqual(1);
  });

  it('a Block bursts where the blades meet, up by the blades rather than at the body', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    const bursts = run.states.flatMap((s) => impactBursts(s, tuning));
    expect(bursts.map((b) => b.kind)).toEqual(['Block']);
    expect(bursts[0]!.point.y).toBeGreaterThan(1);
  });
});
