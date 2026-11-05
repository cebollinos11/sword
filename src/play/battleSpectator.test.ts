import { describe, expect, it } from 'vitest';
import { createMatch, type CrowdState } from '../sim';
import { loadTuningData } from '../tuning';
import { battleFocus } from './battleSpectator';

const tuning = loadTuningData();
const crowd = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1 }).duel.crowd!;

describe('battleFocus (where the spectator camera looks)', () => {
  it('is the middle of every living Soldier while none is engaged', () => {
    // The armies deploy as mirrors of each other through the centre.
    const f = battleFocus(crowd, { x: 9, z: 9 })!;
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.z).toBeCloseTo(0, 9);
  });

  it('is the middle of the fighting once some are engaged, and null once none is left', () => {
    const engaged: CrowdState = { ...crowd, target: crowd.target.map((_, i) => (i === 0 || i === 1 ? 300 : -1)) };
    const f = battleFocus(engaged, { x: 0, z: 0 })!;
    expect(f.x).toBeCloseTo((crowd.x[0]! + crowd.x[1]!) / 2, 9);
    expect(f.z).toBeCloseTo((crowd.z[0]! + crowd.z[1]!) / 2, 9);
    // A fallen Soldier is not in the fighting.
    const fallen: CrowdState = { ...engaged, alive: engaged.alive.map((a, i) => (i === 0 ? 0 : a)) };
    expect(battleFocus(fallen, { x: 0, z: 0 })!.x).toBeCloseTo(crowd.x[1]!, 9);
    expect(battleFocus({ ...crowd, alive: crowd.alive.map(() => 0) }, { x: 0, z: 0 })).toBeNull();
  });
});
