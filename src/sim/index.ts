/**
 * The Simulation: a pure, deterministic, fixed-Tick step from
 * (state, Intents, Tuning Data) to the next state (ADR 0001).
 *
 * Rules for everything under src/sim:
 *   - no wall-clock time, no Math.random (use ./rng, held in state)
 *   - no DOM, no three.js, no rendering
 *   - never mutate an input state
 * The purity test (purity.test.ts) enforces the first two mechanically.
 */
export { TICK_RATE, TICK_SECONDS } from './constants';
export type { Intent } from './intent';
export { IDLE_INTENT } from './intent';
export type { Action, FighterState, MotionPlayback, SimState, Vec2 } from './state';
export type { RngState } from './rng';
export { createInitialState, fighterPose, step } from './step';
export { hashState, hashValue } from './hash';
export type { Vec3 } from './vec';
export type { BladeTransform, JointName, Placement, SkeletonPose } from './skeleton';
export { BONES, JOINT_NAMES } from './skeleton';
export { motionPose } from './pose';
export type { Snapshot } from './snapshot';
export { snapshot, restore } from './snapshot';
