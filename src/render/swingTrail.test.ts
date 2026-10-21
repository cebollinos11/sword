import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel } from '../sim';
import { trailing } from './swingTrail';

const tuning = loadTuningData();

describe('trailing', () => {
  it('an Attack trails through its Release and not its Wind-up or Recovery', () => {
    const { states } = runDuel(tuning, { distance: 3, a: attack('Right'), b: [] });
    const phases = states.slice(1).map((s, k) => {
      const a = s.fighters[0]!.action;
      return { phase: a.kind === 'Attack' ? a.phase : a.kind, trails: trailing(states[k]!, s, 0) };
    });
    expect(phases.filter((p) => p.trails).every((p) => p.phase === 'Release' || p.phase === 'Recovery')).toBe(true);
    expect(phases.some((p) => p.phase === 'Release' && p.trails)).toBe(true);
    expect(phases.filter((p) => p.phase === 'Recovery' && p.trails)).toHaveLength(1);
    expect(phases.some((p) => p.phase === 'Wind-up' && p.trails)).toBe(false);
  });

  it('a held Block never trails', () => {
    const { states } = runDuel(tuning, { distance: 3, a: hold(60, { block: true, direction: 'Left' }), b: [] });
    expect(states.slice(1).some((s, k) => trailing(states[k]!, s, 0))).toBe(false);
  });
});
