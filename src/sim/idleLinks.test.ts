import { describe, expect, it } from 'vitest';
import { checkIdleLinks, loadTuningData, parseMotion, serializeMotion, type Motion, type TuningData } from '../tuning';
import { motionTargets } from './motion';

const tuning = loadTuningData();
const SWORD = 'Arming Sword';
const HAMMER = 'Sledge Hammer';

/** `motion` with its first Pose Key's sword hand raised to `y`. */
function guardAt(motion: Motion, y: number): Motion {
  const [first, ...rest] = motion.poseKeys;
  return { ...motion, poseKeys: [{ ...first!, rightHand: { ...first!.rightHand!, position: { ...first!.rightHand!.position, y } } }, ...rest] };
}

const withIdle = (t: TuningData, idle: Motion): TuningData => ({ ...t, motions: { ...t.motions, Idle: idle } });
const withIdleOverride = (t: TuningData, weapon: string, idle: Motion): TuningData => ({
  ...t,
  motionOverrides: { ...t.motionOverrides, [weapon]: { ...t.motionOverrides[weapon], Idle: idle } },
});

describe('Channels linked to the guard ("idle")', () => {
  it('start and end the Attacks on the Idle pose', () => {
    expect(tuning.motions.Overhead!.poseKeys[0]!.idle).toEqual(['rightHand', 'leftHand', 'torso', 'hip', 'leftFoot', 'rightFoot']);
    const guard = motionTargets(tuning, SWORD, 'Idle', 0);
    const start = motionTargets(tuning, SWORD, 'Overhead', 0);
    const end = motionTargets(tuning, SWORD, 'Overhead', 1000);
    for (const pose of [start, end]) {
      expect(pose.rightHand).toEqual(guard.rightHand);
      expect(pose.torso).toEqual(guard.torso);
      expect(pose.hip).toEqual(guard.hip);
    }
  });

  it('follow a changed Idle: every Motion that starts on guard moves with it', () => {
    const raised = withIdle(tuning, guardAt(tuning.motions.Idle!, 1.3));
    for (const name of ['Overhead', 'Thrust', 'Kick', 'Stagger', 'BlockLeft']) {
      expect(motionTargets(raised, SWORD, name, 0).rightHand.position.y).toBe(1.3);
    }
    // A key of its own is untouched: the Overhead's held Wind-up.
    expect(motionTargets(raised, SWORD, 'Overhead', 21).rightHand).toEqual(motionTargets(tuning, SWORD, 'Overhead', 21).rightHand);
  });

  it("take each Weapon's own Idle override, even in a default Motion it shares", () => {
    const t = withIdleOverride(tuning, HAMMER, guardAt(tuning.motions.Idle!, 0.8));
    expect(motionTargets(t, HAMMER, 'Overhead', 0).rightHand.position.y).toBe(0.8);
    expect(motionTargets(t, SWORD, 'Overhead', 0).rightHand.position.y).toBe(motionTargets(tuning, SWORD, 'Idle', 0).rightHand.position.y);
  });

  it('are written "idle" in a Motion file and read back the same', () => {
    const overhead = tuning.motions.Overhead!;
    const text = serializeMotion(overhead);
    expect(JSON.parse(text).poseKeys[0].rightHand).toBe('idle');
    expect(parseMotion(JSON.parse(text))).toEqual(overhead);
    // An Editor draft lists them instead; a value it still holds for a linked channel is dropped.
    const draft = { ...overhead, poseKeys: [{ ...overhead.poseKeys[0]!, rightHand: { position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } } }] };
    expect(parseMotion(draft).poseKeys[0]).not.toHaveProperty('rightHand');
    expect(() => parseMotion({ ...overhead, poseKeys: [{ time: 0, idle: ['wing'] }] })).toThrow(/idle.*not a Pose Key channel/);
  });

  it("must be channels every playing Weapon's guard sets, and an Idle links nothing", () => {
    const [first, ...rest] = tuning.motions.Idle!.poseKeys;
    const { rightHand: _gone, ...noHand } = first!;
    expect(() => checkIdleLinks(withIdleOverride(tuning, HAMMER, { ...tuning.motions.Idle!, poseKeys: [noHand, ...rest] }))).toThrow(
      /rightHand is linked to "idle", but Sledge Hammer's Idle does not set rightHand/,
    );
    const selfLinked = parseMotion({ ...tuning.motions.Idle!, poseKeys: [{ ...first!, idle: ['hip'] }, ...rest] });
    expect(() => checkIdleLinks(withIdle(tuning, selfLinked))).toThrow(/Idle Motion cannot link/);
  });
});
