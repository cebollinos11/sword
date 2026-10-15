/**
 * The Gait (ADR 0003): feet plant and step whenever the body moves. Every test
 * drives a scripted Duel and reads the solved Skeleton and the event log, never
 * internal Gait state.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import {
  attack,
  fighterPose,
  hashState,
  hold,
  motionPose,
  runDuel,
  secondsToTicks,
  wait,
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
/** The ankles where the Fighter's current Motion puts them at its position and facing (its stance). */
const stanceAnkle = (run: ScriptRun, tick: number, foot: Foot, fighter = 0): Vec3 => {
  const f = run.states[tick]!.fighters[fighter]!;
  return motionPose(tuning, f.motion.name, f.motion.tick, f).joints[foot === 'left' ? 'leftAnkle' : 'rightAnkle'];
};
const expectSame = (a: Vec3, b: Vec3, what: string) => {
  expect(a.x, what).toBeCloseTo(b.x, 9);
  expect(a.y, what).toBeCloseTo(b.y, 9);
  expect(a.z, what).toBeCloseTo(b.z, 9);
};
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

describe('Gait: standing still', () => {
  it('with no movement the feet stay at the Motion stance and never step', () => {
    const run = runDuel(tuning, { ...lone, a: wait(120), b: wait(120), ticks: 120 });
    for (let t = 0; t <= 120; t++) for (const foot of FEET) expectSame(ankle(run, t, foot), stanceAnkle(run, t, foot), `${foot} at Tick ${t}`);
    expect(run.events.filter((e) => e.type === 'Step')).toEqual([]);
  });
});

describe('Gait: stepping', () => {
  const run = runDuel(tuning, { ...lone, a: walk(180, { x: 0.6, z: 0.8 }), ticks: 180 });

  it('Step events alternate between the left and right feet', () => {
    const feet = steps(run).map((e) => e.foot);
    expect(feet.length).toBeGreaterThan(10);
    feet.forEach((foot, k) => k > 0 && expect(foot, `Step ${k}`).not.toBe(feet[k - 1]));
  });

  it('the two ankles are never both above ankle height on the same Tick', () => {
    for (let t = 0; t <= 180; t++) expect(lifted(ankle(run, t, 'left')) && lifted(ankle(run, t, 'right')), `Tick ${t}`).toBe(false);
  });

  it('a stepping foot rises above ankle height mid-step and lands back at ankle height where the Step event says', () => {
    for (const e of steps(run)) {
      const landed = ankle(run, e.tick, e.foot);
      expect(landed.y).toBeCloseTo(ANKLE, 9);
      expect(landed.x).toBeCloseTo(e.position.x, 9);
      expect(landed.z).toBeCloseTo(e.position.z, 9);
      const peak = Math.max(...Array.from({ length: STEP_TICKS }, (_, k) => ankle(run, e.tick - 1 - k, e.foot).y));
      expect(peak).toBeGreaterThan(ANKLE + tuning.gait.stepHeight / 2);
    }
  });
});

describe('Gait: whatever moves the body', () => {
  it('turning in place by face produces steps, and planted feet stay put while turning', () => {
    const run = runDuel(tuning, { ...lone, a: hold(60, { face: Math.PI / 2 }), ticks: 60 });
    expect(run.final.fighters[0]!.position).toEqual({ x: 0, z: 0 });
    expect(steps(run).length).toBeGreaterThanOrEqual(2);
    expectPlantedFeetFixed(run, 0, 15); // the turn itself: 90° at 360°/s takes 15 Ticks
  });

  it('a Fighter pushed by its opponent steps', () => {
    const run = runDuel(tuning, { distance: 2, a: walk(120, { x: 0, z: 1 }), b: wait(120), ticks: 120 });
    expect(run.final.fighters[1]!.position.z).toBeGreaterThan(1.5);
    expect(steps(run, 1).length).toBeGreaterThan(4);
    expectPlantedFeetFixed(run, 0, 120, 1);
  });

  it('a Staggered Fighter pushed by its opponent steps', () => {
    const hit = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: wait(1) }).events.find((e) => e.type === 'Hit')!;
    // Fighter 0 hits Fighter 1, then walks straight into it while it is Staggered.
    const run = runDuel(tuning, { distance: 1.3, a: [...attack('Overhead'), ...wait(hit.tick - 1), ...walk(60, { x: 0, z: 1 })], b: wait(1) });
    const staggered = (t: number) => run.states[t]!.fighters[1]!.action.kind === 'Stagger';
    expect(staggered(hit.tick)).toBe(true);
    expect(steps(run, 1).filter((e) => staggered(e.tick)).length).toBeGreaterThan(0);
    // Not pushed, the same Stagger takes no steps.
    const unpushed = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: wait(1) });
    expect(steps(unpushed, 1)).toEqual([]);
  });
});
