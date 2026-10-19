import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { createInitialState, duelPlacements, IDLE_INTENT, step, type Intent, type SimState } from './index';

/** One clean Overhead hit decides a Duel. */
const tuning: TuningData = withWeapon(loadTuningData(), { damage: 10_000 });
const attackIntent: Intent = { ...IDLE_INTENT, attack: true, direction: 'Overhead' };

/** Fighter 0 taps Overhead until the Duel ends. */
function fell(): SimState {
  let s = createInitialState(tuning, 1, duelPlacements(1.3));
  for (let i = 0; i < 2000 && s.duel.status === 'Fighting'; i++) s = step(s, [i % 2 === 0 ? attackIntent : IDLE_INTENT, IDLE_INTENT], tuning);
  if (s.duel.status !== 'Over') throw new Error('the Duel never ended');
  return s;
}

describe('Death', () => {
  it('records the blow that felled a Fighter on the Tick the Duel ends', () => {
    const s = fell();
    const hit = s.events.find((e) => e.type === 'Hit')!;
    expect(s.fighters[0]!.death).toBeUndefined();
    expect(s.fighters[1]!.death).toEqual({
      tick: s.tick,
      cause: 'Hit',
      blow: { point: hit.point, bladeSpeed: hit.bladeSpeed, direction: 'Overhead', from: { x: s.fighters[0]!.position.x, z: s.fighters[0]!.position.z } },
    });
  });

  it('raises a Death event on that Tick, after the blow and before the Duel ends, and never again', () => {
    const s = fell();
    const types = s.events.map((e) => e.type).filter((t) => ['Hit', 'Death', 'DuelEnd'].includes(t));
    expect(types).toEqual(['Hit', 'Death', 'DuelEnd']);
    expect(s.events).toContainEqual({ type: 'Death', fighter: 1, cause: 'Hit' });
    const later = step(s, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(later.events.some((e) => e.type === 'Death')).toBe(false);
  });

  it('stops simulating the fallen Fighter: it stays exactly as it fell', () => {
    const s = fell();
    let later = s;
    for (let i = 0; i < 60; i++) later = step(later, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(later.fighters[1]).toEqual(s.fighters[1]);
    expect(later.fighters[0]!.motion).not.toEqual(s.fighters[0]!.motion);
  });
});
