import { describe, expect, it } from 'vitest';
import { hashValue, motionPose, type Placement } from './index';
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

  it('an unknown Motion name is an error', () => {
    expect(() => motionPose(tuning, 'Pirouette', 0, ORIGIN)).toThrow(/Pirouette/);
  });
});
