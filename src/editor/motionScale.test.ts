import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { scaleMotion } from './motionEdit';
import { EditorSession } from './session';

const tuning = loadTuningData();

describe('scaling a Motion timeline', () => {
  it('stretches the duration, Pose Keys and markers by one factor', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Overhead');
    scaleMotion(d, 2.2); // Overhead is 1.1 s: everything doubles
    expect(d.duration).toBe(2.2);
    expect(d.poseKeys.map((k) => k.time)).toEqual([0, 0.7, 1.2, 1.44, 2.2]);
    expect(d.markers).toEqual({ windUpEnd: 0.7, releaseEnd: 1.2 });
    expect(() => session.commit('Overhead')).not.toThrow();
  });

  it('compresses the timeline, keeping poses, easing and the last key on the new end', () => {
    const session = new EditorSession(tuning);
    const d = session.draft('Overhead');
    const before = structuredClone(d.poseKeys.map(({ time: _t, ...rest }) => rest));
    scaleMotion(d, 0.55); // half length
    expect(d.duration).toBe(0.55);
    expect(d.poseKeys[d.poseKeys.length - 1]!.time).toBe(0.55);
    expect(d.poseKeys.map((k) => k.ease)).toEqual(['linear', 'easeOut', 'easeIn', 'easeOut', 'easeInOut']);
    expect(d.poseKeys.map(({ time: _t, ...rest }) => rest)).toEqual(before);
    expect(d.markers.releaseEnd).toBeLessThanOrEqual(d.duration);
    expect(() => session.commit('Overhead')).not.toThrow();
  });

  it('snaps to hundredths and never reorders Pose Keys', () => {
    const d = new EditorSession(tuning).draft('Overhead');
    scaleMotion(d, 1.37);
    for (const k of d.poseKeys) expect(Math.round(k.time * 100)).toBeCloseTo(k.time * 100, 6);
    for (let i = 1; i < d.poseKeys.length; i++) expect(d.poseKeys[i]!.time).toBeGreaterThanOrEqual(d.poseKeys[i - 1]!.time);
    expect(d.duration).toBe(1.37);
  });

  it('leaves a single-key Motion holding its one key at the end', () => {
    const d = new EditorSession(tuning).draft('Idle');
    scaleMotion(d, 3);
    expect(d.duration).toBe(3);
    expect(d.poseKeys.every((k) => k.time >= 0 && k.time <= 3)).toBe(true);
  });

  it('refuses a length that is not positive', () => {
    const d = new EditorSession(tuning).draft('Overhead');
    expect(() => scaleMotion(d, 0)).toThrow(RangeError);
    expect(() => scaleMotion(d, -1)).toThrow(RangeError);
    expect(d.duration).toBe(1.1);
  });
});
