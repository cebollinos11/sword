import { describe, expect, it } from 'vitest';
import { hashValue, motionPose, sampleMotion, type Placement } from './index';
import { arcLerp, lerp, vec3 } from './vec';
import { loadTuningData, parseMotion, type Motion, type TuningData } from '../tuning';

const tuning = loadTuningData();
const ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };

/** Tuning Data with one Motion replaced, as the Editor does while tweaking. */
function withMotion(base: TuningData, motion: Motion): TuningData {
  return { ...base, motions: { ...base.motions, [motion.name]: motion } };
}

function bladeTrack(t: TuningData, name: string, ticks: number) {
  return Array.from({ length: ticks }, (_, tick) => motionPose(t, name, tick, ORIGIN).blade);
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('The Overhead Motion', () => {
  it('is deterministic: the same Ticks give the same blade transform hash', () => {
    const a = hashValue(bladeTrack(tuning, 'Overhead', 80));
    const b = hashValue(bladeTrack(loadTuningData(), 'Overhead', 80));
    expect(a).toBe(b);
  });

  it('responds to a tweaked Pose Key', () => {
    const o = tuning.motions.Overhead!;
    const tweaked = parseMotion({
      ...o,
      poseKeys: o.poseKeys.map((k, i) =>
        i === 1 && k.rightHand ? { ...k, rightHand: { ...k.rightHand, position: { ...k.rightHand.position, y: 1.6 } } } : k,
      ),
    });
    const before = hashValue(bladeTrack(tuning, 'Overhead', 80));
    const after = hashValue(bladeTrack(withMotion(tuning, tweaked), 'Overhead', 80));
    expect(after).not.toBe(before);
  });

  it('keeps the blade the Weapon length (0.9 m) on every Tick', () => {
    for (const b of bladeTrack(tuning, 'Overhead', 70)) expect(dist(b.hilt, b.tip)).toBeCloseTo(0.9, 9);
  });

  it('reaches a Pose Key: at its time the sword hand is at its target', () => {
    const reach = parseMotion({
      name: 'Overhead',
      duration: 1,
      poseKeys: [
        { time: 0, ease: 'linear', rightHand: { position: { x: 0.3, y: 1.2, z: 0.3 }, rotation: { x: 0, y: 0, z: 0 } } },
        { time: 0.5, ease: 'linear', rightHand: { position: { x: 0.2, y: 1.1, z: 0.35 }, rotation: { x: 0, y: 0, z: 0 } } },
      ],
    });
    // Fighter-local x is the Fighter's right: world -x at the origin facing +z.
    const { hilt } = motionPose(withMotion(tuning, reach), 'Overhead', 30, ORIGIN).blade;
    expect(hilt.x).toBeCloseTo(-0.2, 6);
    expect(hilt.y).toBeCloseTo(1.1, 6);
    expect(hilt.z).toBeCloseTo(0.35, 6);
  });

  it('raises the blade over the head at the end of Wind-up, then brings it down in front', () => {
    const windUp = motionPose(tuning, 'Overhead', 21, ORIGIN).blade; // windUpEnd = 0.35 s
    const release = motionPose(tuning, 'Overhead', 36, ORIGIN).blade; // releaseEnd = 0.6 s
    expect(windUp.tip.y).toBeGreaterThan(1.8); // above a 1.8 m Fighter
    expect(windUp.tip.z).toBeLessThan(0); // behind the Fighter
    expect(release.tip.z).toBeGreaterThan(1); // well in front
    expect(release.tip.y).toBeLessThan(windUp.tip.y);
  });

  it('holds its last pose after the duration', () => {
    const end = motionPose(tuning, 'Overhead', 66, ORIGIN);
    expect(hashValue(motionPose(tuning, 'Overhead', 200, ORIGIN))).toBe(hashValue(end));
  });

  it('moves and turns with the Fighter', () => {
    const atOrigin = motionPose(tuning, 'Overhead', 36, ORIGIN).blade;
    const placed = motionPose(tuning, 'Overhead', 36, { position: { x: 2, z: 3 }, facing: Math.PI / 2 }).blade;
    // The same pose, turned a quarter (facing +x) and carried to (2, 3).
    for (const key of ['hilt', 'tip'] as const) {
      expect(placed[key].x).toBeCloseTo(2 + atOrigin[key].z, 6);
      expect(placed[key].y).toBeCloseTo(atOrigin[key].y, 6);
      expect(placed[key].z).toBeCloseTo(3 - atOrigin[key].x, 6);
    }
  });
});

describe('Looping Motions', () => {
  it('Idle loops: 2 s in is the same pose as Tick 0', () => {
    expect(hashValue(motionPose(tuning, 'Idle', 120, ORIGIN))).toBe(hashValue(motionPose(tuning, 'Idle', 0, ORIGIN)));
  });
});

describe('IK limits', () => {
  it('an unreachable hand target leaves the arm at full reach toward it, never NaN', () => {
    const far = parseMotion({
      name: 'Overhead',
      duration: 1,
      poseKeys: [{ time: 0, ease: 'linear', rightHand: { position: { x: 0, y: 1.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 } } }],
    });
    const pose = motionPose(withMotion(tuning, far), 'Overhead', 0, ORIGIN);
    // The hand reaches out toward the target but stops well short of it.
    expect(pose.blade.hilt.z).toBeGreaterThan(0.5);
    expect(pose.blade.hilt.z).toBeLessThan(1.5);
    for (const j of Object.values(pose.joints)) expect(Number.isFinite(j.x + j.y + j.z)).toBe(true);
  });

  it("a planted foot out of the leg's reach leaves its ankle short of the floor, but its toe stays on the floor", () => {
    const idle = tuning.motions.Idle!;
    const lunge = { ...idle, poseKeys: idle.poseKeys.map((k) => (k.leftFoot ? { ...k, leftFoot: { x: -0.1, z: 2 } } : k)) };
    const pose = motionPose(withMotion(tuning, lunge), 'Idle', 0, ORIGIN);
    expect(pose.joints.leftAnkle.y).toBeGreaterThan(tuning.skeleton.ankleHeight + 0.1);
    expect(pose.joints.leftToe.y).toBe(0);
    expect(pose.joints.rightToe.y).toBe(0);
  });

  it('an unknown Motion name is an error', () => {
    expect(() => motionPose(tuning, 'Pirouette', 0, ORIGIN)).toThrow(/Pirouette/);
  });
});

describe('Hand paths', () => {
  const chest = vec3(0, tuning.skeleton.pelvisHeight + tuning.skeleton.spine, 0);
  const hand = (x: number, y: number, z: number) => ({ position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 } });
  const swing = (path?: 'arc') =>
    parseMotion({
      name: 'Swing',
      duration: 1,
      poseKeys: [
        { time: 0, ease: 'linear', rightHand: hand(0.5, 1.45, 0) },
        { time: 1, ease: 'linear', ...(path && { path }), rightHand: hand(-0.5, 1.45, 0), leftHand: { position: { x: -0.3, y: 1, z: 0.3 } } },
      ],
    });

  it('arcLerp keeps the distance from the pivot when both ends share it, and passes through both ends', () => {
    const a = vec3(0.5, 1.45, 0);
    const b = vec3(0, 1.45, 0.5);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(dist(arcLerp(a, b, chest, t), chest)).toBeCloseTo(0.5, 9);
    expect(dist(arcLerp(a, b, chest, 0), a)).toBeCloseTo(0, 9);
    expect(dist(arcLerp(a, b, chest, 1), b)).toBeCloseTo(0, 9);
  });

  it('arcLerp falls back to a straight line where the arc is undefined', () => {
    const a = vec3(0.5, 1.45, 0);
    for (const b of [vec3(0.8, 1.45, 0), vec3(-0.5, 1.45, 0), chest]) expect(arcLerp(a, b, chest, 0.3)).toEqual(lerp(a, b, 0.3));
  });

  it('a linear key sends the hand straight through the chest; an arc key swings it round in front', () => {
    const linear = sampleMotion(swing(), 0.5, tuning.skeleton).rightHand.position;
    expect(dist(linear, chest)).toBeCloseTo(0, 9);
    // From the right to the left of the chest the arc is a half-circle: in line with it, so it falls back to straight.
    // Nudge the start forward and it must go round in front, keeping its distance.
    const m = swing('arc');
    const nudged = parseMotion({ ...m, poseKeys: [{ ...m.poseKeys[0]!, rightHand: hand(0.5, 1.45, 0.05) }, m.poseKeys[1]!] });
    const arc = sampleMotion(nudged, 0.5, tuning.skeleton).rightHand.position;
    expect(arc.z).toBeGreaterThan(0.4);
    expect(dist(arc, chest)).toBeCloseTo(0.5, 2);
  });

  it('bends only the hands, leaving the rotation and other channels interpolating linearly', () => {
    const m = parseMotion({
      name: 'Swing',
      duration: 1,
      poseKeys: [
        { time: 0, ease: 'linear', rightHand: { position: { x: 0.5, y: 1.45, z: 0 }, rotation: { x: 0, y: 90, z: 0 } }, hip: { x: 0, y: 0.95, z: 0 } },
        { time: 1, ease: 'linear', path: 'arc', rightHand: { position: { x: 0, y: 1.45, z: 0.5 }, rotation: { x: 0, y: 0, z: 0 } }, hip: { x: 0, y: 0.95, z: 0.2 } },
      ],
    });
    const p = sampleMotion(m, 0.5, tuning.skeleton);
    expect(p.rightHand.rotation.y).toBeCloseTo(45, 9);
    expect(p.hip.z).toBeCloseTo(0.1, 9);
    expect(dist(p.rightHand.position, chest)).toBeCloseTo(0.5, 9);
  });

  it('swings the Left and Right hands farther from the chest mid-Release than a straight line would', () => {
    for (const name of ['Left', 'Right']) {
      const m = tuning.motions[name]!;
      const straight = parseMotion({ ...m, poseKeys: m.poseKeys.map(({ path: _, ...k }) => k) });
      const mid = (m.markers.windUpEnd! + m.markers.releaseEnd!) / 2;
      const arc = sampleMotion(m, mid, tuning.skeleton).rightHand.position;
      const line = sampleMotion(straight, mid, tuning.skeleton).rightHand.position;
      expect(dist(arc, chest), name).toBeGreaterThan(dist(line, chest));
    }
  });
});
