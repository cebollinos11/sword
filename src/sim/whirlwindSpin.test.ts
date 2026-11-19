import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, IDLE_INTENT, step, whirlwindTimings, type FighterState, type Intent, type SimState } from './index';
import { whirlwindLowMotion, whirlwindSpinMotion } from './actions';
import { applyCrouch, fighterPose } from './pose';
import { motionTargets, playbackTargets } from './motion';
import { solveSkeleton, NO_GAIT } from './skeleton';

const tuning = loadTuningData();
const t = whirlwindTimings(tuning);
const WEAPONS = ['Arming Sword', 'Longsword', 'Halberd'];
const fresh = (weapon: string): SimState => createInitialState(tuning, 1, undefined, [weapon]);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const me = (s: SimState): FighterState => s.fighters[0]!;

/** Hold G (and C, if `crouch`) until armed, then let go of G (keeping C): the Tick the Spin begins. */
function spinning(weapon: string, direction: 'Left' | 'Right', crouch: boolean): SimState {
  const g: Partial<Intent> = { whirlwind: true, direction, crouch };
  let s = ticks(fresh(weapon), t.armTicks + 1 + (crouch ? 20 : 0), g);
  s = tick(s, { direction, crouch });
  expect(me(s).action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
  return s;
}

/** The lowest and highest point of the blade (hilt and tip). */
const heights = (f: FighterState): { low: number; high: number } => {
  const ys = [f.blade.hilt.y, f.blade.tip.y];
  return { low: Math.min(...ys), high: Math.max(...ys) };
};

describe('Whirlwind Spin pose', () => {
  it('plays WhirlwindSpinRight or WhirlwindSpinLeft, held at its last Tick, once released', () => {
    for (const direction of ['Right', 'Left'] as const) {
      const s = spinning(WEAPONS[0]!, direction, false);
      const last = Math.round(tuning.motions[whirlwindSpinMotion(direction)]!.duration * 60);
      expect(me(s).motion).toMatchObject({ name: `WhirlwindSpin${direction}`, tick: last });
      expect(me(ticks(s, 10)).motion).toMatchObject({ name: whirlwindSpinMotion(direction), tick: last });
    }
  });

  it('has four Motions with the contract shape', () => {
    for (const name of ['WhirlwindSpinLeft', 'WhirlwindSpinRight', 'WhirlwindLowLeft', 'WhirlwindLowRight']) {
      const m = tuning.motions[name]!;
      expect(m.loop).toBe(false);
      expect(m.duration).toBeCloseTo(0.1);
      expect(m.poseKeys).toHaveLength(2);
      expect(m.markers ?? {}).toEqual({});
    }
    expect(whirlwindLowMotion('Left')).toBe('WhirlwindLowLeft');
  });

  for (const direction of ['Right', 'Left'] as const) {
    it.each(WEAPONS)(`standing, the ${direction} blade lies above 1.3 m once the Motion Blend settles (%s)`, (weapon) => {
      const s = ticks(spinning(weapon, direction, false), 20);
      expect(heights(me(s)).low).toBeGreaterThan(1.3);
    });

    it.each(WEAPONS)(`fully crouched, the ${direction} blade lies below 0.5 m (%s)`, (weapon) => {
      const s = ticks(spinning(weapon, direction, true), 20, { crouch: true });
      expect(me(s).crouch).toBe(1);
      expect(heights(me(s)).high).toBeLessThan(0.5);
    });
  }

  it.each(WEAPONS)('half crouched, the blade lies between the two (%s)', (weapon) => {
    const standing = heights(me(ticks(spinning(weapon, 'Right', false), 20)));
    const s = ticks(spinning(weapon, 'Right', false), 25);
    const half = me(ticks(s, 5, { crouch: true }));
    expect(half.crouch).toBeCloseTo(0.5);
    const crouched = heights(me(ticks(spinning(weapon, 'Right', true), 20, { crouch: true })));
    const h = heights(half);
    expect(h.low).toBeLessThan(standing.low);
    expect(h.low).toBeGreaterThan(crouched.low);
    expect(h.high).toBeLessThan(standing.high);
    expect(h.high).toBeGreaterThan(crouched.high);
  });

  it('a Fighter that is not spinning poses as the crouch alone gives', () => {
    const s = ticks(fresh(WEAPONS[0]!), 20, { crouch: true });
    const f = me(s);
    expect(f.crouch).toBe(1);
    expect(f.action.kind).toBe('Idle');
    const expected = solveSkeleton(
      { ...applyCrouch(playbackTargets(tuning, f.weapon, f.motion), f.crouch, tuning), leftFoot: motionTargets(tuning, f.weapon, 'Idle', 0).leftFoot, rightFoot: motionTargets(tuning, f.weapon, 'Idle', 0).rightFoot },
      tuning.skeleton,
      tuning.weapons[f.weapon]!,
      f,
      NO_GAIT,
    );
    const pose = fighterPose(f, tuning);
    expect(pose.blade.hilt.y).toBeCloseTo(expected.blade.hilt.y, 6);
    expect(pose.blade.tip.y).toBeCloseTo(expected.blade.tip.y, 6);
  });
});
