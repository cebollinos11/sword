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
  hitZoneCapsules,
  hold,
  intentAt,
  motionPose,
  restore,
  runDuel,
  runScript,
  secondsToTicks,
  snapshot,
  wait,
  walk,
  type HitEvent,
  type Track,
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
/** The ankles where the Fighter's current Motion puts them at its position and facing (the feet's home). */
const homeAnkle = (run: ScriptRun, tick: number, foot: Foot, fighter = 0): Vec3 => {
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
  it('with no movement the feet stay where the Motion puts them and never step', () => {
    const run = runDuel(tuning, { ...lone, a: wait(120), b: wait(120), ticks: 120 });
    for (let t = 0; t <= 120; t++) for (const foot of FEET) expectSame(ankle(run, t, foot), homeAnkle(run, t, foot), `${foot} at Tick ${t}`);
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

  it('a Fighter walking into the Arena edge and then sliding along it steps, and planted feet never slide while it moves', () => {
    const nearEdge = { placements: [{ position: { x: 0, z: 6 }, facing: 0 }, { position: { x: 0, z: -6 }, facing: Math.PI }] };
    const intoEdge = 60;
    const run = runDuel(tuning, { ...nearEdge, a: [...walk(intoEdge, { x: 0, z: 1 }), ...walk(120, { x: 1, z: 0.2 })], b: wait(180), ticks: 180 });
    const edge = tuning.arena.radius - tuning.fighter.radius;
    const fromCentre = (t: number) => Math.hypot(run.states[t]!.fighters[0]!.position.x, run.states[t]!.fighters[0]!.position.z);
    // Walking straight at the edge until it stops the body (pressed against it, the body stands still and the feet settle).
    const reached = run.states.findIndex((_, t) => t > 0 && fromCentre(t) > edge - 1e-9);
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(intoEdge);
    expectPlantedFeetFixed(run, 0, reached);
    // Sliding along the edge: the edge turns the walk, the body keeps moving and the feet keep stepping.
    for (let t = intoEdge + 1; t <= 180; t++) expect(fromCentre(t), `Tick ${t}`).toBeCloseTo(edge, 9);
    expect(run.final.fighters[0]!.position.x).toBeGreaterThan(1);
    expect(steps(run).filter((e) => e.tick > intoEdge).length).toBeGreaterThan(4);
    expectPlantedFeetFixed(run, intoEdge + 1, 180);
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

describe('Gait: stopping', () => {
  for (const [name, move] of Object.entries(DIRECTIONS)) {
    it(`after walking ${name} and stopping, the feet settle where the Motion puts them within a step or two and stay there`, () => {
      const run = runDuel(tuning, { ...lone, a: [...walk(47, move), ...wait(120)], ticks: 167 });
      const settled = 47 + 4 * STEP_TICKS;
      for (let t = settled; t <= 167; t++) for (const foot of FEET) expectSame(ankle(run, t, foot), homeAnkle(run, t, foot), `${foot} at Tick ${t}`);
      expect(steps(run).filter((e) => e.tick > settled)).toEqual([]);
    });
  }
});

describe('Gait never touches the blade', () => {
  for (const direction of ['Overhead', 'Left', 'Right', 'Thrust'] as const) {
    it(`walking through a ${direction} Attack gives the same blade every Tick as the Attack standing at the same placement`, () => {
      const run = runDuel(tuning, { ...lone, a: [...hold(1, { attack: true, direction, move: { x: 0.6, z: 0.8 } }), ...walk(80, { x: -1, z: 0.3 })], ticks: 81 });
      expect(steps(run).length).toBeGreaterThan(4);
      for (const s of run.states) {
        const f = s.fighters[0]!;
        const standing = motionPose(tuning, f.motion.name, f.motion.tick, f).blade;
        expect(f.blade, `Tick ${s.tick}`).toEqual(standing);
        expect(fighterPose(f, tuning).blade, `Tick ${s.tick}`).toEqual(standing);
      }
    });
  }
});

describe('Gait: the hips carry the walk', () => {
  const withHips = (hipBob: number, hipSway: number) => ({ ...tuning, gait: { ...tuning.gait, hipBob, hipSway } });
  const pelvis = (t: typeof tuning, run: ScriptRun, tick: number) => fighterPose(run.states[tick]!.fighters[0]!, t).joints.pelvis;
  /** The pelvis where the Motion's hip target puts it at the Fighter's position and facing. */
  const motionPelvis = (t: typeof tuning, run: ScriptRun, tick: number) => {
    const f = run.states[tick]!.fighters[0]!;
    return motionPose(t, f.motion.name, f.motion.tick, f).joints.pelvis;
  };
  /** For each Step, the Tick its foot was highest (the middle of the step). */
  const midSteps = (t: typeof tuning, run: ScriptRun) =>
    steps(run).map((e) => {
      const ticks = Array.from({ length: STEP_TICKS - 1 }, (_, k) => e.tick - 1 - k).filter((k) => k > 0);
      const tick = ticks.reduce((a, b) => (fighterPose(run.states[b]!.fighters[0]!, t).joints[`${e.foot}Ankle`].y > fighterPose(run.states[a]!.fighters[0]!, t).joints[`${e.foot}Ankle`].y ? b : a));
      return { tick, foot: e.foot };
    });

  it("with hip bob, the pelvis dips below the Motion's hip target mid-step", () => {
    const t = withHips(0.03, 0);
    const run = runDuel(t, { ...lone, a: walk(120, { x: 0.3, z: 1 }), ticks: 120 });
    const mids = midSteps(t, run);
    expect(mids.length).toBeGreaterThan(6);
    for (const { tick } of mids) expect(pelvis(t, run, tick).y, `Tick ${tick}`).toBeLessThan(motionPelvis(t, run, tick).y - 0.015);
    for (let k = 0; k <= 120; k++) expect(pelvis(t, run, k).y, `Tick ${k}`).toBeLessThanOrEqual(motionPelvis(t, run, k).y + 1e-12);
  });

  /** Every Motion with its feet crossed: the left foot planted on the Fighter's right and vice versa. */
  const crossed = (t: typeof tuning): typeof tuning => ({
    ...t,
    motions: Object.fromEntries(
      Object.entries(t.motions).map(([name, m]) => [
        name,
        {
          ...m,
          poseKeys: m.poseKeys.map((k) => ({
            ...k,
            ...(k.leftFoot && { leftFoot: { ...k.leftFoot, x: -k.leftFoot.x } }),
            ...(k.rightFoot && { rightFoot: { ...k.rightFoot, x: -k.rightFoot.x } }),
          })),
        },
      ]),
    ),
  });

  for (const [name, feet] of [['', (t: typeof tuning) => t], [' (feet crossed)', crossed]] as const) {
    it(`with hip sway, the pelvis shifts sideways toward the planted foot mid-step${name}`, () => {
      const t = feet(withHips(0, 0.03));
      const run = runDuel(t, { ...lone, a: walk(120, { x: -0.5, z: -1 }), ticks: 120 });
      const mids = midSteps(t, run);
      expect(mids.length).toBeGreaterThan(6);
      for (const { tick, foot } of mids) {
        const f = run.states[tick]!.fighters[0]!;
        const right = { x: -Math.cos(f.facing), z: Math.sin(f.facing) }; // the Fighter's right, on the floor
        const sideways = (p: Vec3) => p.x * right.x + p.z * right.z;
        const [now, motion] = [pelvis(t, run, tick), motionPelvis(t, run, tick)];
        const planted = fighterPose(f, t).joints[foot === 'left' ? 'rightAnkle' : 'leftAnkle'];
        expect(lifted(planted)).toBe(false);
        const towardPlanted = Math.sign(sideways(planted) - sideways(motion));
        expect((sideways(now) - sideways(motion)) * towardPlanted, `Tick ${tick}`).toBeGreaterThan(0.015);
        expect(now.y, `Tick ${tick}`).toBeCloseTo(motion.y, 9); // sway alone does not dip
      }
    });
  }

  it("with hip bob and sway at zero, the pelvis is at the Motion's hip target on every Tick", () => {
    const t = withHips(0, 0);
    const run = runDuel(t, { ...lone, a: [...walk(60, { x: 0.6, z: 0.8 }), ...hold(20, { face: 1 }), ...attack('Left'), ...walk(40, { x: 0, z: -1 })] });
    expect(steps(run).length).toBeGreaterThan(6);
    for (const s of run.states) expect(pelvis(t, run, s.tick), `Tick ${s.tick}`).toEqual(motionPelvis(t, run, s.tick));
  });

  it("with strong hip bob and sway, planted feet still never slide and the blade is still the standing Attack's", () => {
    const t = withHips(0.06, 0.06);
    const run = runDuel(t, { ...lone, a: [...hold(1, { attack: true, direction: 'Right', move: { x: 0.6, z: 0.8 } }), ...walk(80, { x: -1, z: 0.3 })], ticks: 81 });
    expect(steps(run).length).toBeGreaterThan(4);
    for (const s of run.states) {
      const f = s.fighters[0]!;
      const standing = motionPose(t, f.motion.name, f.motion.tick, f);
      expect(fighterPose(f, t).blade, `Tick ${s.tick}`).toEqual(standing.blade);
      expect(f.blade, `Tick ${s.tick}`).toEqual(standing.blade);
    }
    // ankle() reads the repo Tuning Data; use the strong hips here.
    for (const foot of FEET) {
      let plantedAt: Vec3 | null = null;
      for (let k = 0; k <= 81; k++) {
        const a = fighterPose(run.states[k]!.fighters[0]!, t).joints[`${foot}Ankle`];
        if (lifted(a)) plantedAt = null;
        else if (!plantedAt) plantedAt = a;
        else {
          expect(a.x, `${foot} slid at Tick ${k}`).toBeCloseTo(plantedAt.x, 9);
          expect(a.z, `${foot} slid at Tick ${k}`).toBeCloseTo(plantedAt.z, 9);
          expect(a.y).toBeCloseTo(ANKLE, 9);
        }
      }
    }
  });
});

/** Distance from p to the segment a→b. */
function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ap = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / (ab.x * ab.x + ab.y * ab.y + ab.z * ab.z)));
  return Math.hypot(ap.x - ab.x * t, ap.y - ab.y * t, ap.z - ab.z * t);
}

describe('Gait and Hit Zones', () => {
  it('a leg hit lands where the stepping leg is drawn, not where the Motion alone would put it', () => {
    // Repo swings never reach below the hips, so pitch the Thrust 45° down to reach the shins.
    const thrust = tuning.motions.Thrust!;
    const low = {
      ...thrust,
      poseKeys: thrust.poseKeys.map((k) => (k.rightHand ? { ...k, rightHand: { ...k.rightHand, rotation: { ...k.rightHand.rotation, x: 45 } } } : k)),
    };
    const lowThrust = { ...tuning, motions: { ...tuning.motions, Thrust: low } };
    // Fighter 1 walks into the Thrust and is hit on the leg it is stepping with.
    const run = runDuel(lowThrust, { distance: 2.1, a: [...wait(8), ...attack('Thrust')], b: walk(60, { x: 0, z: -0.5 }), ticks: 60 });
    const hit = run.events.find((e): e is HitEvent & { tick: number } => e.type === 'Hit')!;
    expect(hit).toMatchObject({ defender: 1, zone: 'limbs' });

    const defender = run.states[hit.tick]!.fighters[1]!;
    const drawn = fighterPose(defender, lowThrust);
    const motionOnly = motionPose(lowThrust, defender.motion.name, defender.motion.tick, defender);
    const leg = (pose: typeof drawn) => Math.min(segmentDistance(hit.point, pose.joints.leftHip, pose.joints.leftKnee), segmentDistance(hit.point, pose.joints.leftKnee, pose.joints.leftAnkle));
    const radius = lowThrust.hitZones.limbs.radius;
    expect(lifted(drawn.joints.leftAnkle)).toBe(true); // mid-step
    expect(leg(drawn)).toBeLessThanOrEqual(radius + 1e-9);
    expect(leg(motionOnly)).toBeGreaterThan(radius);
    // And the Hit Zone capsules the Editor overlays are those same drawn legs.
    const capsules = hitZoneCapsules(drawn, lowThrust).filter((c) => c.zone === 'limbs');
    expect(capsules).toContainEqual({ zone: 'limbs', a: drawn.joints.leftKnee, b: drawn.joints.leftAnkle, radius });
  });
});

describe('Gait determinism', () => {
  const tracks = [
    [...walk(40, { x: 0.3, z: 1 }), ...hold(30, { move: { x: -1, z: 0 }, face: 1 }), ...attack('Left'), ...walk(40, { x: 0, z: -1 })],
    [...wait(20), ...walk(60, { x: 0.2, z: -1 }), ...hold(30, { block: true, direction: 'Left', move: { x: 1, z: 0 } })],
  ];

  it('identical walking scripts give identical state hashes', () => {
    const a = runDuel(tuning, { distance: 2, a: tracks[0], b: tracks[1] });
    const b = runDuel(tuning, { distance: 2, a: tracks[0], b: tracks[1] });
    expect(steps(a).length).toBeGreaterThan(4);
    expect(a.states.map(hashState)).toEqual(b.states.map(hashState));
  });

  it('snapshot mid-step, restore and re-simulate gives an identical hash', () => {
    const straight = runDuel(tuning, { distance: 2, a: tracks[0], b: tracks[1] });
    const midStep = steps(straight)[2]!.tick - 2; // a foot is in the air
    expect(lifted(ankle(straight, midStep, steps(straight)[2]!.foot))).toBe(true);
    const snap = snapshot(straight.states[midStep]!);
    const remaining = straight.final.tick - midStep;
    // The rest of each Track, from the snapshot's Tick on.
    const rest = tracks.map((t): Track => Array.from({ length: remaining }, (_, k) => ({ ticks: 1, intent: intentAt(t, midStep + k) })));
    const replayed = runScript(tuning, restore(snap), rest, remaining);
    expect(hashState(replayed.final)).toBe(hashState(straight.final));
  });

  it('the feet are part of the state hash', () => {
    // Turn away and back: the body ends exactly where a standing Fighter is, but the feet have stepped.
    const turned = runDuel(tuning, { ...lone, a: [...hold(15, { face: Math.PI / 2 }), ...hold(16, { face: 0 })], ticks: 31 });
    const stood = runDuel(tuning, { ...lone, ticks: 31 });
    const [t, s] = [turned.final.fighters[0]!, stood.final.fighters[0]!];
    expect([t.position, t.facing, t.hp, t.action, t.motion, t.blade]).toEqual([s.position, s.facing, s.hp, s.action, s.motion, s.blade]);
    expect(turned.final.fighters[1]).toEqual(stood.final.fighters[1]);
    expect(steps(turned).length).toBeGreaterThan(0);
    expect(ankle(turned, 31, 'left')).not.toEqual(ankle(stood, 31, 'left'));
    expect(hashState(turned.final)).not.toBe(hashState(stood.final));
  });
});
