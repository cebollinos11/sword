import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { addPoseKey, removePoseKey, retimePoseKey, setChannel } from './motionEdit';
import { EditorSession } from './session';

const tuning = loadTuningData();

describe('Pose Key editing', () => {
  it('adds a Pose Key at a time, in time order, holding the pose the Motion has there', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Overhead');
    const i = addPoseKey(d, 0.5, tuning.skeleton);
    expect(i).toBe(2);
    expect(d.poseKeys.map((k) => k.time)).toEqual([0, 0.35, 0.5, 0.6, 1.1]);
    // Torso twist at 0.5 s: easeIn from 15 (0.35) to -5 (0.6), u = 0.6 -> 15 - 20 * 0.36 = 7.8.
    expect(d.poseKeys[2]!.torso!.twist).toBeCloseTo(7.8, 6);
    // Feet are only set at 0 s, so they hold that plant.
    expect(d.poseKeys[2]!.leftFoot).toEqual({ x: -0.12, z: 0.12 });
    // It takes the easing curve of the segment it splits.
    expect(d.poseKeys[2]!.ease).toBe('easeIn');
    expect(() => session.commit('Overhead')).not.toThrow();
  });

  it('retimes a Pose Key, snapping to hundredths, clamping into the Motion and keeping time order', () => {
    const d = new EditorSession(tuning).draft('Overhead');
    const released = d.poseKeys[2]!; // the 0.6 s key
    expect(retimePoseKey(d, 2, 0.4234)).toBe(2);
    expect(released.time).toBe(0.42);
    // Dragged past its neighbour: it moves in the list and the new index is returned.
    expect(retimePoseKey(d, 2, 0.2)).toBe(1);
    expect(d.poseKeys[1]).toBe(released);
    expect(d.poseKeys.map((k) => k.time)).toEqual([0, 0.2, 0.35, 1.1]);
    expect(retimePoseKey(d, 1, 5)).toBe(3);
    expect(released.time).toBe(1.1);
    expect(retimePoseKey(d, 3, -1)).toBe(0);
    expect(released.time).toBe(0);
  });

  it('removes a Pose Key but never the last one', () => {
    const d = new EditorSession(tuning).draft('Idle');
    while (d.poseKeys.length > 1) removePoseKey(d, 0);
    expect(() => removePoseKey(d, 0)).toThrow(/at least one Pose Key/);
    expect(d.poseKeys).toHaveLength(1);
  });

  it('sets a channel on a Pose Key from the pose there, and clears it again', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Overhead');
    // The 0.35 s key does not plant the feet; turning the channel on holds the 0 s plant.
    expect(d.poseKeys[1]!.rightFoot).toBeUndefined();
    setChannel(d, 1, 'rightFoot', true, tuning.skeleton);
    expect(d.poseKeys[1]!.rightFoot).toEqual({ x: 0.14, z: -0.12 });
    // Already set: switching on again keeps the authored value.
    d.poseKeys[1]!.rightFoot!.x = 0.3;
    setChannel(d, 1, 'rightFoot', true, tuning.skeleton);
    expect(d.poseKeys[1]!.rightFoot!.x).toBe(0.3);
    setChannel(d, 1, 'rightFoot', false, tuning.skeleton);
    expect(d.poseKeys[1]).not.toHaveProperty('rightFoot');
    // A channel no key sets comes from the rest pose (rest right foot: half the 0.2 m hip width out).
    const idle = session.draft('Idle');
    setChannel(idle, 0, 'rightFoot', false, tuning.skeleton);
    setChannel(idle, 1, 'rightFoot', true, tuning.skeleton);
    expect(idle.poseKeys[1]!.rightFoot).toEqual({ x: 0.1, z: 0 });
  });
});
