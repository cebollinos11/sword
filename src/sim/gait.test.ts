/**
 * The Gait (ADR 0003): feet plant and step whenever the body moves. Every test
 * drives a scripted Duel and reads the solved Skeleton and the event log, never
 * internal Gait state.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import {
  fighterPose,
  runDuel,
  secondsToTicks,
  walk,
  type ScriptRun,
  type SimEvent,
  type Vec3,
} from './index';

const tuning = loadTuningData();
const ANKLE = tuning.skeleton.ankleHeight;
const STEP_TICKS = secondsToTicks(tuning.gait.stepDuration);
const FEET = ['left', 'right'] as const;
type Foot = (typeof FEET)[number];

/** Fighter 0 alone at the Arena centre facing +z (Fighter 1 parked far away, facing it). */
const lone = { placements: [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 6 }, facing: Math.PI }] };

const ankle = (run: ScriptRun, tick: number, foot: Foot, fighter = 0): Vec3 =>
  fighterPose(run.states[tick]!.fighters[fighter]!, tuning).joints[foot === 'left' ? 'leftAnkle' : 'rightAnkle'];
const lifted = (a: Vec3) => a.y > ANKLE + 1e-6;
type StepEvent = Extract<SimEvent, { type: 'Step' }> & { tick: number };
const steps = (run: ScriptRun, fighter = 0) =>
  run.events.filter((e): e is StepEvent => e.type === 'Step' && e.fighter === fighter);

/**
 * Over ticks [from, to]: each foot's ankle, whenever it is on the floor, stays at
 * exactly the same ground position until it next lifts; and no foot stays in
 * the air longer than one step.
 */
function expectPlantedFeetFixed(run: ScriptRun, from: number, to: number, fighter = 0) {
  for (const foot of FEET) {
    let plantedAt: Vec3 | null = null;
    let airborne = 0;
    for (let t = from; t <= to; t++) {
      const a = ankle(run, t, foot, fighter);
      if (lifted(a)) {
        plantedAt = null;
        airborne++;
        expect(airborne, `${foot} foot in the air too long at Tick ${t}`).toBeLessThan(STEP_TICKS);
        continue;
      }
      airborne = 0;
      expect(a.y).toBeCloseTo(ANKLE, 9);
      if (plantedAt) {
        expect(a.x, `${foot} foot slid at Tick ${t}`).toBeCloseTo(plantedAt.x, 9);
        expect(a.z, `${foot} foot slid at Tick ${t}`).toBeCloseTo(plantedAt.z, 9);
      } else plantedAt = a;
    }
  }
}

const DIRECTIONS = {
  forward: { x: 0, z: 1 },
  backwards: { x: 0, z: -1 },
  'sideways right': { x: 1, z: 0 },
  'sideways left': { x: -1, z: 0 },
  'diagonally forward-left': { x: -1, z: 1 },
  'diagonally back-right': { x: 0.6, z: -0.8 },
};

describe('Gait: walking', () => {
  for (const [name, move] of Object.entries(DIRECTIONS)) {
    it(`walking ${name}, planted feet never slide and the feet step`, () => {
      const run = runDuel(tuning, { ...lone, a: walk(120, move), ticks: 120 });
      expectPlantedFeetFixed(run, 0, 120);
      expect(steps(run).length).toBeGreaterThan(6);
    });
  }
});
