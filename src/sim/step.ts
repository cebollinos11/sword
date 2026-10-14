import type { TuningData } from '../tuning';
import { TICK_SECONDS } from './constants';
import { IDLE_INTENT, type Intent } from './intent';
import { motionPose } from './pose';
import { createRng } from './rng';
import type { SkeletonPose } from './skeleton';
import type { FighterState, SimState } from './state';

/** The full solved Skeleton of a Fighter at its current Tick (what the Renderer draws). */
export function fighterPose(f: FighterState, tuning: TuningData): SkeletonPose {
  return motionPose(tuning, f.motion.name, f.motion.tick, f);
}

/** Build the state at Tick 0: one Idle Fighter at the Arena centre. */
export function createInitialState(tuning: TuningData, seed: number): SimState {
  const placement = { position: { x: 0, z: 0 }, facing: 0 };
  const motion = { name: 'Idle', tick: 0 };
  return {
    tick: 0,
    rng: createRng(seed),
    fighters: [
      {
        ...placement,
        hp: tuning.fighter.maxHp,
        action: 'Idle',
        motion,
        blade: motionPose(tuning, motion.name, motion.tick, placement).blade,
      },
    ],
  };
}

function walk(f: FighterState, intent: Intent, tuning: TuningData): FighterState['position'] {
  let { x: mx, z: mz } = intent.move;
  const len = Math.hypot(mx, mz);
  if (len === 0) return f.position;
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
  return { x, z };
}

function stepFighter(f: FighterState, intent: Intent, tuning: TuningData): FighterState {
  const position = walk(f, intent, tuning);
  const motion = { name: f.motion.name, tick: f.motion.tick + 1 };
  // Motion is simulation: the Skeleton is solved by IK inside the Tick (ADR 0001).
  const blade = motionPose(tuning, motion.name, motion.tick, { position, facing: f.facing }).blade;
  return { ...f, position, motion, blade };
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
