import type { TuningData } from '../tuning';
import { TICK_SECONDS } from './constants';
import { IDLE_INTENT, type Intent } from './intent';
import { createRng } from './rng';
import type { FighterState, SimState } from './state';

/** Build the state at Tick 0: one Idle Fighter at the Arena centre. */
export function createInitialState(tuning: TuningData, seed: number): SimState {
  return {
    tick: 0,
    rng: createRng(seed),
    fighters: [{ position: { x: 0, z: 0 }, facing: 0, hp: tuning.fighter.maxHp, action: 'Idle' }],
  };
}

function stepFighter(f: FighterState, intent: Intent, tuning: TuningData): FighterState {
  let { x: mx, z: mz } = intent.move;
  const len = Math.hypot(mx, mz);
  if (len === 0) return f;
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const d = tuning.fighter.walkSpeed * TICK_SECONDS;
  let x = f.position.x + mx * d;
  let z = f.position.z + mz * d;
  // Stay on the flat circular Arena.
  const maxR = tuning.arena.radius - tuning.fighter.radius;
  const r = Math.hypot(x, z);
  if (r > maxR) {
    x = (x / r) * maxR;
    z = (z / r) * maxR;
  }
  return { ...f, position: { x, z } };
}

/**
 * Advance the Simulation by exactly one Tick. Pure: never mutates `state`.
 * `intents[i]` drives `state.fighters[i]`; a missing Intent means Idle.
 */
export function step(state: SimState, intents: readonly Intent[], tuning: TuningData): SimState {
  return {
    tick: state.tick + 1,
    rng: state.rng,
    fighters: state.fighters.map((f, i) => stepFighter(f, intents[i] ?? IDLE_INTENT, tuning)),
  };
}
