/**
 * The Gait (ADR 0003): feet plant and step whenever the body moves. Every test
 * drives a scripted Duel and reads the solved Skeleton and the event log, never
 * internal Gait state.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import {
  attack,
  createInitialState,
  fighterPose,
  hashState,
  hitZoneCapsules,
  hold,
  intentAt,
  playbackPose,
  restore,
  runDuel,
  runScript,
  secondsToTicks,
  SHEATHED_IDLE_MOTION,
  SHEATHED_RUN_MOTION,
  snapshot,
  step,
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
  return playbackPose(tuning, f.motion, f).joints[foot === 'left' ? 'leftAnkle' : 'rightAnkle'];
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
 * the air for `maxAir` Ticks (default: one step) or longer.
 */
function expectPlantedFeetFixed(run: ScriptRun, from: number, to: number, fighter = 0, maxAir = STEP_TICKS) {
  for (const foot of FEET) {
    let plantedAt: Vec3 | null = null;
    let airborne = 0;
    for (let t = from; t <= to; t++) {
      const a = ankle(run, t, foot, fighter);
      if (lifted(a)) {
        plantedAt = null;
        airborne++;
        expect(airborne, `${foot} foot in the air too long at Tick ${t}`).toBeLessThan(maxAir);
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
      expect(steps(run).length).toBeGreaterThan(5);
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
      const peak = Math.max(...Array.from({ length: STEP_TICKS }, (_, k) => e.tick - 1 - k).filter((t) => t >= 0).map((t) => ankle(run, t, e.foot).y));
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
    expect(steps(run, 1).length).toBeGreaterThan(3);
    expectPlantedFeetFixed(run, 0, 120, 1);
  });

  it('a Fighter walking into the Arena edge and then sliding along it steps, and planted feet never slide while it moves', () => {
    const nearEdge = { placements: [{ position: { x: 0, z: 6 }, facing: 0 }, { position: { x: 0, z: -6 }, facing: Math.PI }] };
    const intoEdge = 60;
    const run = runDuel(tuning, { ...nearEdge, a: [...walk(intoEdge, { x: 0, z: 1 }), ...walk(120, { x: 1, z: 0.2 })], b: wait(180), ticks: 180 });
    const edge = tuning.arenas.circle!.radius! - tuning.fighter.radius;
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
    const liftedWhileStaggered = run.states.some((s, t) => staggered(t) && FEET.some((foot) => lifted(ankle(run, s.tick, foot, 1))));
    expect(liftedWhileStaggered).toBe(true);
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
        const standing = playbackPose(tuning, f.motion, f).blade;
        expect(f.blade, `Tick ${s.tick}`).toEqual(standing);
        expect(fighterPose(f, tuning).blade, `Tick ${s.tick}`).toEqual(standing);
      }
    });
  }
});

describe('Gait: the hips carry the walk', () => {
  /** Legs long enough that no stride is out of reach, so the pelvis never sinks for reach and only bob and sway move it. */
  const roomy = { ...tuning.skeleton, thigh: 0.7, shin: 0.7 };
  const withHips = (hipBob: number, hipSway: number) => ({ ...tuning, skeleton: roomy, gait: { ...tuning.gait, hipBob, hipSway } });
  const pelvis = (t: typeof tuning, run: ScriptRun, tick: number) => fighterPose(run.states[tick]!.fighters[0]!, t).joints.pelvis;
  /** The pelvis where the Motion's hip target puts it at the Fighter's position and facing. */
  const motionPelvis = (t: typeof tuning, run: ScriptRun, tick: number) => {
    const f = run.states[tick]!.fighters[0]!;
    return playbackPose(t, f.motion, f).joints.pelvis;
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
    expect(steps(run).length).toBeGreaterThan(5);
    for (const s of run.states) expect(pelvis(t, run, s.tick), `Tick ${s.tick}`).toEqual(motionPelvis(t, run, s.tick));
  });

  it('a stride longer than the legs reach sinks the pelvis just enough that the planted foot stays on the floor', () => {
    // Legs that only just reach the floor from the Motion's hips, so every stride is out of their reach.
    const t = { ...tuning, skeleton: { ...tuning.skeleton, thigh: 0.45, shin: 0.45 }, gait: { ...tuning.gait, hipBob: 0, hipSway: 0 } };
    const run = runDuel(t, { ...lone, a: walk(120, { x: 0, z: 1 }), ticks: 120 });
    expect(run.states.some((s) => pelvis(t, run, s.tick).y < motionPelvis(t, run, s.tick).y - 0.01)).toBe(true);
    expectPlantedFeetFixed(run, 0, 120);
    // The same walk on legs that reach every stride never sinks.
    const long = { ...t, skeleton: roomy };
    const reaching = runDuel(long, { ...lone, a: walk(120, { x: 0, z: 1 }), ticks: 120 });
    for (const s of reaching.states) expect(pelvis(long, reaching, s.tick), `Tick ${s.tick}`).toEqual(motionPelvis(long, reaching, s.tick));
  });

  it("with strong hip bob and sway, planted feet still never slide and the blade is still the standing Attack's", () => {
    const t = withHips(0.06, 0.06);
    const run = runDuel(t, { ...lone, a: [...hold(1, { attack: true, direction: 'Right', move: { x: 0.6, z: 0.8 } }), ...walk(80, { x: -1, z: 0.3 })], ticks: 81 });
    expect(steps(run).length).toBeGreaterThan(4);
    for (const s of run.states) {
      const f = s.fighters[0]!;
      const standing = playbackPose(t, f.motion, f);
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
    const run = runDuel(lowThrust, { distance: 2, a: [...wait(2), ...attack('Thrust')], b: walk(60, { x: 0, z: -0.5 }), ticks: 60 });
    const hit = run.events.find((e): e is HitEvent & { tick: number } => e.type === 'Hit')!;
    expect(hit).toMatchObject({ defender: 1, zone: 'legs' });

    const defender = run.states[hit.tick]!.fighters[1]!;
    const drawn = fighterPose(defender, lowThrust);
    const motionOnly = playbackPose(lowThrust, defender.motion, defender);
    const leg = (pose: typeof drawn) => Math.min(segmentDistance(hit.point, pose.joints.leftHip, pose.joints.leftKnee), segmentDistance(hit.point, pose.joints.leftKnee, pose.joints.leftAnkle));
    const radius = lowThrust.hitZones.legs.radius;
    expect(lifted(drawn.joints.leftAnkle)).toBe(true); // mid-step
    expect(leg(drawn)).toBeLessThanOrEqual(radius + 1e-9);
    expect(leg(motionOnly)).toBeGreaterThan(radius);
    // And the Hit Zone capsules the Editor overlays are those same drawn legs.
    const capsules = hitZoneCapsules(drawn, lowThrust).filter((c) => c.zone === 'legs');
    expect(capsules).toContainEqual({ zone: 'legs', a: drawn.joints.leftKnee, b: drawn.joints.leftAnkle, radius });
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

describe('Gait: paced like a person', () => {
  /** Fighter 0 with a clear path forward (Fighter 1 parked off to the side, behind it). */
  const open = { placements: [{ position: { x: 0, z: -5 }, facing: 0 }, { position: { x: 6, z: -6 }, facing: Math.PI }] };
  const walkAt = (t: typeof tuning, speed: number) => runDuel(t, { ...open, a: walk(150, { x: 0, z: speed }), ticks: 150 });
  /** Over a steady walk: steps per second, metres per step and the share of Ticks with both feet down. */
  const pace = (run: ScriptRun) => {
    const late = steps(run).filter((e) => e.tick > 40);
    const perStep = (late[late.length - 1]!.tick - late[0]!.tick) / (late.length - 1);
    const [a, b] = [run.states[late[0]!.tick]!.fighters[0]!.position, run.states[late[late.length - 1]!.tick]!.fighters[0]!.position];
    const ticks = run.states.slice(41);
    const bothDown = ticks.filter((s) => FEET.every((foot) => !lifted(ankle(run, s.tick, foot)))).length / ticks.length;
    return { cadence: 60 / perStep, length: Math.hypot(b.x - a.x, b.z - a.z) / (late.length - 1), bothDown };
  };

  it('a faster walk takes longer strides and quicker steps', () => {
    const [slow, fast] = [pace(walkAt(tuning, 0.3)), pace(walkAt(tuning, 1))];
    expect(fast.length).toBeGreaterThan(slow.length * 1.5);
    expect(fast.cadence).toBeGreaterThan(slow.cadence * 1.2);
  });

  it('a full-speed walk steps no faster than once per step duration', () => {
    expect(pace(walkAt(tuning, 1)).cadence).toBeLessThanOrEqual(1 / tuning.gait.stepDuration + 1e-9);
  });

  it('a slow walk keeps both feet down between steps, a full-speed one hardly ever', () => {
    expect(pace(walkAt(tuning, 0.3)).bothDown).toBeGreaterThan(0.3);
    expect(pace(walkAt(tuning, 1)).bothDown).toBeLessThan(0.15); // only the Tick one foot lands and the other lifts
  });

  it('the first step off a standstill is a quick one, and the pelvis never has to sink far for it', () => {
    for (const move of Object.values(DIRECTIONS)) {
      const run = runDuel(tuning, { ...lone, a: walk(40, move), ticks: 40 });
      expect(steps(run)[0]!.tick).toBeLessThan(STEP_TICKS);
      for (const s of run.states) expect(fighterPose(s.fighters[0]!, tuning).joints.pelvis.y, `Tick ${s.tick}`).toBeGreaterThan(homeAnkle(run, s.tick, 'left').y + 0.75);
    }
  });

  /** Where each foot lands front to back, relative to the body, averaged over a steady walk: the stance's stagger. */
  const stagger = (t: typeof tuning, speed: number) => {
    const run = walkAt(t, speed);
    const late = steps(run).filter((e) => e.tick > 40);
    const mean = (foot: Foot) => {
      const own = late.filter((e) => e.foot === foot);
      return own.reduce((sum, e) => sum + e.position.z - run.states[e.tick]!.fighters[0]!.position.z, 0) / own.length;
    };
    return Math.abs(mean('left') - mean('right'));
  };

  it("walking forward draws the stance's front-to-back stagger in under the hips, the more the faster", () => {
    const keep = { ...tuning, gait: { ...tuning.gait, squareUp: 0 } };
    expect(stagger(tuning, 1)).toBeLessThan(stagger(keep, 1) / 2);
    expect(stagger(tuning, 1)).toBeLessThan(stagger(tuning, 0.3));
  });
});

describe('Gait: the foot rolls', () => {
  const run = runDuel(tuning, { ...lone, a: walk(60, { x: 0, z: -1 }), ticks: 60 });
  /** The foot's pitch (degrees, + toe up) on a Tick, measured against its planted pitch. */
  const pitch = (r: ScriptRun, t: number, foot: Foot, tn = tuning) => {
    const j = fighterPose(r.states[t]!.fighters[0]!, tn).joints;
    const [a, toe] = foot === 'left' ? [j.leftAnkle, j.leftToe] : [j.rightAnkle, j.rightToe];
    const flat = Math.atan2(-ANKLE, Math.hypot(toe.x - a.x, toe.z - a.z));
    return ((Math.atan2(toe.y - a.y, Math.hypot(toe.x - a.x, toe.z - a.z)) - flat) * 180) / Math.PI;
  };
  const midSteps = (r: ScriptRun) => steps(r).filter((e) => e.tick > 20);

  it('a planted foot is flat on the floor', () => {
    for (let t = 0; t <= 60; t++)
      for (const foot of FEET) if (!lifted(ankle(run, t, foot))) expect(Math.abs(pitch(run, t, foot)), `${foot} at Tick ${t}`).toBeLessThan(1e-6);
  });

  it('stepping back, the foot lifts heel first and lands toes first; stepping forward the reverse', () => {
    const forward = runDuel(tuning, { ...lone, a: walk(60, { x: 0, z: 1 }), ticks: 60 });
    for (const [r, sign] of [[forward, 1], [run, -1]] as const) {
      for (const e of midSteps(r)) {
        const early = e.tick - Math.round((STEP_TICKS * 3) / 4); // a quarter into a full step
        const late = e.tick - Math.round(STEP_TICKS / 4); // three quarters in
        expect(sign * pitch(r, early, e.foot), `toe-off, Step at ${e.tick}`).toBeLessThan(-tuning.gait.toeRoll / 2);
        expect(sign * pitch(r, late, e.foot), `heel strike, Step at ${e.tick}`).toBeGreaterThan(tuning.gait.toeRoll / 2);
      }
    }
  });

  it('the toes never dip below the floor, and with no toe roll the feet stay flat', () => {
    for (let t = 0; t <= 60; t++) {
      const j = fighterPose(run.states[t]!.fighters[0]!, tuning).joints;
      expect(Math.min(j.leftToe.y, j.rightToe.y), `Tick ${t}`).toBeGreaterThanOrEqual(-1e-9);
    }
    const flatFeet = { ...tuning, gait: { ...tuning.gait, toeRoll: 0 } };
    const r = runDuel(flatFeet, { ...lone, a: walk(60, { x: 0, z: -1 }), ticks: 60 });
    for (let t = 0; t <= 60; t++) for (const foot of FEET) expect(Math.abs(pitch(r, t, foot, flatFeet)), `${foot} at Tick ${t}`).toBeLessThan(1e-6);
  });
});

describe('Gait: the hips turn with the stride', () => {
  /** How far (degrees) the pelvis is turned on a Tick, + with the right hip forward of the left (Fighter-local). */
  const hipTurn = (t: typeof tuning, r: ScriptRun, tick: number) => {
    const f = r.states[tick]!.fighters[0]!;
    const j = fighterPose(f, t).joints;
    const forward = { x: Math.sin(f.facing), z: Math.cos(f.facing) };
    const right = { x: -Math.cos(f.facing), z: Math.sin(f.facing) };
    const d = { x: j.rightHip.x - j.leftHip.x, z: j.rightHip.z - j.leftHip.z };
    return (Math.atan2(d.x * forward.x + d.z * forward.z, d.x * right.x + d.z * right.z) * 180) / Math.PI;
  };
  /** How far forward (m, Fighter-local) the right foot is of the left, beyond where the Motion puts them. */
  const rightAhead = (r: ScriptRun, tick: number) => {
    const f = r.states[tick]!.fighters[0]!;
    const forward = { x: Math.sin(f.facing), z: Math.cos(f.facing) };
    const along = (p: Vec3) => p.x * forward.x + p.z * forward.z;
    const gap = (foot: Foot) => along(ankle(r, tick, foot)) - along(homeAnkle(r, tick, foot));
    return gap('right') - gap('left');
  };

  it('the pelvis turns toward whichever foot is forward, by up to the hip twist', () => {
    const run = runDuel(tuning, { ...lone, a: walk(90, { x: 0.3, z: -1 }), ticks: 90 });
    let turned = 0;
    for (let t = 20; t <= 90; t++) {
      const [turn, ahead] = [hipTurn(tuning, run, t), rightAhead(run, t)];
      expect(Math.abs(turn), `Tick ${t}`).toBeLessThanOrEqual(tuning.gait.hipTwist + 1e-6);
      if (Math.abs(ahead) > 0.2) {
        expect(Math.sign(turn), `Tick ${t}`).toBe(Math.sign(ahead));
        turned++;
      }
    }
    expect(turned).toBeGreaterThan(10);
  });

  it('standing, or with no hip twist, the pelvis is square', () => {
    const still = runDuel(tuning, { ...lone, a: wait(60), ticks: 60 });
    for (const s of still.states) expect(Math.abs(hipTurn(tuning, still, s.tick)), `Tick ${s.tick}`).toBeLessThan(1e-9);
    const square = { ...tuning, gait: { ...tuning.gait, hipTwist: 0 } };
    const run = runDuel(square, { ...lone, a: walk(60, { x: 0, z: 1 }), ticks: 60 });
    for (const s of run.states) expect(Math.abs(hipTurn(square, run, s.tick)), `Tick ${s.tick}`).toBeLessThan(1e-9);
  });
});

describe('Gait: a Sheathed run', () => {
  const RUN_STEP = secondsToTicks(tuning.gait.runStepDuration);
  /** A foot of a run is in the air for less than two run steps (it lands one run step after the other foot). */
  const RUN_AIR = 2 * RUN_STEP + 1;
  const FORWARD = { x: 0, z: 1 };
  /** The repo's Arenas plus a long strip that climbs a Kit ramp's slope (3 m over 6 m), crosses a landing and comes back down. */
  const hilly: typeof tuning = {
    ...tuning,
    arenas: {
      ...tuning.arenas,
      hill: parseArena(
        {
          name: 'hill',
          walk: [
            { id: 'WALK_a', points: [[-3, 0, -40], [3, 0, -40], [3, 0, 4], [-3, 0, 4]] },
            { id: 'WALK_up', points: [[-3, 0, 4], [3, 0, 4], [3, 3, 10], [-3, 3, 10]] },
            { id: 'WALK_top', points: [[-3, 3, 10], [3, 3, 10], [3, 3, 14], [-3, 3, 14]] },
            { id: 'WALK_down', points: [[-3, 3, 14], [3, 3, 14], [3, 0, 20], [-3, 0, 20]] },
            { id: 'WALK_b', points: [[-3, 0, 20], [3, 0, 20], [3, 0, 60], [-3, 0, 60]] },
          ],
          walls: [],
        },
        'hill',
      ),
    },
  };
  /** A clear path forward: Fighter 1 parked off to the side, behind. */
  const open = [{ position: { x: 0, z: -5 }, facing: 0 }, { position: { x: 6, z: -6 }, facing: Math.PI }];
  /** Fighter 0 at the Arena centre facing +z, Sheathed or drawn (Fighter 1 parked far away, facing it). */
  const sheathedAt = (sheathed: boolean, placements = lone.placements, data = tuning, arena?: string) => {
    const s = createInitialState(data, 1, placements, [], [], arena);
    return { ...s, fighters: [{ ...s.fighters[0]!, sheathed, motion: { name: sheathed ? SHEATHED_IDLE_MOTION : 'Idle', tick: 0 } }, ...s.fighters.slice(1)] };
  };
  const pelvis = (data: typeof tuning, run: ScriptRun, tick: number) => {
    const f = run.states[tick]!.fighters[0]!;
    return fighterPose(f, data).joints.pelvis.y - f.y;
  };
  const inAir = (run: ScriptRun, tick: number, foot: Foot) => run.states[tick]!.fighters[0]!.gait[foot].step !== null;

  for (const [name, move] of Object.entries(DIRECTIONS)) {
    it(`running ${name} Sheathed (faster), planted feet never slide and the feet step`, () => {
      const run = runScript(tuning, sheathedAt(true), [walk(30, move)], 30);
      const at = run.states[30]!.fighters[0]!.position;
      const back = Math.max(0, -move.z / Math.hypot(move.x, move.z));
      expect(Math.hypot(at.x, at.z)).toBeCloseTo(30 * (tuning.fighter.walkSpeed / 60) * tuning.fighter.sheathedWalkFactor * (1 - (1 - tuning.fighter.backwardWalkFactor) * back), 6);
      expectPlantedFeetFixed(run, 0, 30, 0, RUN_AIR);
      expect(steps(run).length).toBeGreaterThan(1);
    });
  }

  it('footfalls come one run step apart, left and right in turn, with both feet off the ground between them', () => {
    const run = runScript(tuning, sheathedAt(true, open), [walk(120, FORWARD)], 120);
    const late = steps(run).filter((e) => e.tick > 30);
    expect(late.length).toBeGreaterThan(5);
    for (let k = 1; k < late.length; k++) {
      expect(late[k]!.tick - late[k - 1]!.tick, `footfall ${k}`).toBe(RUN_STEP);
      expect(late[k]!.foot).not.toBe(late[k - 1]!.foot);
      // The Tick before a foot lands, the other has already lifted: a flight.
      expect(FEET.every((foot) => inAir(run, late[k]!.tick - 1, foot)), `flight before footfall ${k}`).toBe(true);
    }
    // The feet land ahead of the hips and lift behind them.
    const z = (tick: number, foot: Foot) => ankle(run, tick, foot).z - run.states[tick]!.fighters[0]!.position.z;
    for (const e of late) expect(z(e.tick, e.foot)).toBeGreaterThan(0.1);
  });

  it('the pelvis keeps its height through every stride, on the flat and up and down a ramp', () => {
    // From z = -8 at 0.1 m a Tick: the ramp up from Tick 120 to 180, the ramp down from 220 to 280.
    const run = runScript(hilly, sheathedAt(true, [{ position: { x: 0, z: -8 }, facing: 0 }, { position: { x: 2, z: -39 }, facing: 0 }], hilly, 'hill'), [walk(320, FORWARD)], 320);
    expect(run.states[150]!.fighters[0]!.y).toBeGreaterThan(1);
    const heights = run.states.slice(30).map((s) => pelvis(hilly, run, s.tick));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.12);
    expect(Math.min(...heights)).toBeGreaterThan(0.75);
    expect(run.states.every((s) => !s.fighters[0]!.air)).toBe(true);
  });

  it('running forward plays the Sheathed run (leaning in, both hands behind the hips); standing, sidestepping and backing away stay upright', () => {
    const run = runScript(tuning, sheathedAt(true, open), [[...walk(60, FORWARD), ...wait(30)]], 90);
    const f = (tick: number) => run.states[tick]!.fighters[0]!;
    expect(f(1).motion.name).toBe(SHEATHED_RUN_MOTION);
    expect(f(1).motion.blend).toBeDefined(); // eased into, not snapped
    const pose = fighterPose(f(60), tuning);
    const ahead = (joint: Vec3) => joint.z - f(60).position.z;
    expect(ahead(pose.joints.head)).toBeGreaterThan(0.3);
    expect(ahead(pose.joints.leftHand)).toBeLessThan(ahead(pose.joints.pelvis) - 0.1);
    expect(ahead(pose.joints.rightHand)).toBeLessThan(ahead(pose.joints.pelvis) - 0.1);
    // Stopping hands back to the Sheathed Idle, whose playhead carries on.
    expect(f(61).motion.name).toBe(SHEATHED_IDLE_MOTION);
    expect(f(61).motion.tick).toBe(f(60).motion.tick + 1);
    expect(ahead(fighterPose(f(90), tuning).joints.head)).toBeLessThan(0.1 + f(90).position.z - f(60).position.z);
    for (const move of [DIRECTIONS['sideways left'], DIRECTIONS.backwards, DIRECTIONS['diagonally back-right']]) {
      const aside = runScript(tuning, sheathedAt(true), [walk(20, move)], 20);
      expect(aside.states.every((s) => s.fighters[0]!.motion.name === SHEATHED_IDLE_MOTION)).toBe(true);
    }
  });

  it('a drawn Fighter never runs, nor does a Sheathed one creeping along crouched', () => {
    const drawn = runScript(tuning, sheathedAt(false, open), [walk(60, FORWARD)], 60);
    const crouched = runScript(tuning, sheathedAt(true, open), [hold(60, { move: FORWARD, crouch: true })], 60);
    // (The crouch takes a few Ticks to slow it to a walk, and the running steps under way then land.)
    for (const states of [drawn.states, crouched.states.slice(40)]) {
      for (const s of states) {
        expect(s.fighters[0]!.motion.name).not.toBe(SHEATHED_RUN_MOTION);
        for (const foot of FEET) expect(s.fighters[0]!.gait[foot].step?.run).toBeUndefined();
      }
    }
  });

  it('a run is deterministic and survives a snapshot mid-stride', () => {
    const script: Track[] = [walk(80, { x: 0.3, z: 1 })];
    const whole = runScript(tuning, sheathedAt(true, open), script, 80);
    const mid = whole.states[37]!;
    expect(FEET.some((foot) => mid.fighters[0]!.gait[foot].step?.run)).toBe(true);
    let s = restore(snapshot(mid));
    for (let t = 37; t < 80; t++) s = step(s, [intentAt(script[0]!, t)], tuning);
    expect(hashState(s)).toBe(hashState(whole.final));
  });
});
