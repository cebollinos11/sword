import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, fighterPose, IDLE_INTENT, step, type Intent, type SimState } from './index';

const tuning = loadTuningData();
const f = tuning.fighter;

const fresh = (): SimState => createInitialState(tuning, 1);
const ticks = (s: SimState, n: number, intent: Partial<Intent>): SimState => {
  for (let i = 0; i < n; i++) s = step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
  return s;
};
const settle = Math.ceil(2 / f.crouchSpeed / (1 / 60)) + 5;

describe('Crouch', () => {
  it('lowers the hips by crouchDepth while held and rises again when let go', () => {
    const standing = fresh().fighters[0]!;
    const down = ticks(fresh(), settle, { crouch: true });
    expect(down.fighters[0]!.crouch).toBe(1);
    const dy = fighterPose(standing, tuning).joints.pelvis.y - fighterPose(down.fighters[0]!, tuning).joints.pelvis.y;
    expect(Math.abs(dy - f.crouchDepth)).toBeLessThan(0.02); // the feet glide a little as the stance settles
    const up = ticks(down, settle, {});
    expect(up.fighters[0]!.crouch).toBe(0);
  });

  it('eases in rather than snapping', () => {
    const mid = ticks(fresh(), 2, { crouch: true }).fighters[0]!.crouch;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('keeps the feet planted and lowers the head and the blade', () => {
    const before = fresh().fighters[0]!;
    const after = ticks(fresh(), settle, { crouch: true }).fighters[0]!;
    const a = fighterPose(before, tuning);
    const b = fighterPose(after, tuning);
    expect(b.joints.leftAnkle.y).toBeCloseTo(a.joints.leftAnkle.y, 5);
    expect(b.joints.head.y).toBeLessThan(a.joints.head.y);
    expect(b.blade.tip.y).toBeLessThan(a.blade.tip.y);
  });

  it('slows the walk to crouchWalkFactor when fully crouched', () => {
    const walkZ = (crouch: boolean) => ticks(ticks(fresh(), settle, { crouch }), 60, { crouch, move: { x: 0, z: 1 } }).fighters[0]!.position.z;
    const start = ticks(fresh(), settle, { crouch: true }).fighters[0]!.position.z;
    const slow = walkZ(true) - start;
    const fast = walkZ(false) - start;
    expect(slow / fast).toBeCloseTo(f.crouchWalkFactor, 1);
  });

  it('is allowed while attacking, and attacking while crouched', () => {
    let s = ticks(fresh(), settle, { crouch: true });
    s = ticks(s, 3, { crouch: true, attack: true });
    expect(s.fighters[0]!.action.kind).toBe('Attack');
    expect(s.fighters[0]!.crouch).toBe(1);
    s = ticks(s, 3, { crouch: false, attack: true });
    expect(s.fighters[0]!.action.kind).toBe('Attack');
    expect(s.fighters[0]!.crouch).toBeLessThan(1);
  });

  it('can be held in the air', () => {
    const s = ticks(fresh(), 6, { jump: true, crouch: true });
    expect(s.fighters[0]!.air).toBeDefined();
    expect(s.fighters[0]!.crouch).toBeGreaterThan(0);
  });
});
