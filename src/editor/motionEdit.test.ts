import { describe, expect, it } from 'vitest';
import { guardKey, loadTuningData } from '../tuning';
import { addPoseKey, isLinked, linkChannel, removePoseKey, retimePoseKey, setChannel } from './motionEdit';
import { EditorSession } from './session';

const tuning = loadTuningData();
const guard = guardKey(tuning, 'Arming Sword');

describe('Pose Key editing', () => {
  it('adds a Pose Key at a time, in time order, holding the pose the Motion has there', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Overhead');
    const i = addPoseKey(d, 0.5, tuning.skeleton, guard);
    expect(i).toBe(2);
    expect(d.poseKeys.map((k) => k.time)).toEqual([0, 0.35, 0.5, 0.6, 0.72, 1.1]);
    // Torso twist at 0.5 s: easeIn from 15 (0.35) to -5 (0.6), u = 0.6 -> 15 - 20 * 0.36 = 7.8.
    expect(d.poseKeys[2]!.torso!.twist).toBeCloseTo(7.8, 6);
    // Feet are only set at 0 s (linked to the guard), so they hold the guard's plant.
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
    expect(d.poseKeys.map((k) => k.time)).toEqual([0, 0.2, 0.35, 0.72, 1.1]);
    expect(retimePoseKey(d, 1, 5)).toBe(4);
    expect(released.time).toBe(1.1);
    expect(retimePoseKey(d, 4, -1)).toBe(0);
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
    // The 0.35 s key does not plant the feet; turning the channel on holds the 0 s plant (the guard's).
    expect(d.poseKeys[1]!.rightFoot).toBeUndefined();
    setChannel(d, 1, 'rightFoot', true, tuning.skeleton, guard);
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

  it('links a channel to the guard and unlinks it, keeping the guard as its own value', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Overhead');
    expect(isLinked(d, 0, 'rightHand')).toBe(true);
    expect(d.poseKeys[0]).not.toHaveProperty('rightHand');
    linkChannel(d, 0, 'rightHand', false, tuning.skeleton, guard);
    expect(isLinked(d, 0, 'rightHand')).toBe(false);
    expect(d.poseKeys[0]!.rightHand).toEqual(guard.rightHand);
    // Unlinking a channel that is not linked keeps its value.
    linkChannel(d, 0, 'rightHand', false, tuning.skeleton, guard);
    expect(d.poseKeys[0]!.rightHand).toEqual(guard.rightHand);
    linkChannel(d, 1, 'torso', true, tuning.skeleton, guard);
    expect(d.poseKeys[1]).not.toHaveProperty('torso');
    expect(d.poseKeys[1]!.idle).toEqual(['torso']);
    // Turning a linked channel on as its own value (as dragging its gizmo does) unlinks it too.
    setChannel(d, 0, 'hip', true, tuning.skeleton, guard);
    expect(isLinked(d, 0, 'hip')).toBe(false);
    expect(d.poseKeys[0]!.hip).toEqual(guard.hip);
    expect(() => session.commit('Overhead')).not.toThrow();
    expect(session.tuning.motions.Overhead!.poseKeys[1]!.idle).toEqual(['torso']);
  });

  it('refuses an Idle edit that drops a channel some Motion links to', () => {
    const session = new EditorSession(tuning);
    setChannel(session.draft('Idle'), 0, 'rightHand', false, tuning.skeleton);
    expect(() => session.commit('Idle')).toThrow(/linked to "idle"/);
    expect(session.tuning.motions.Idle).toBe(tuning.motions.Idle);
  });
});
