import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createInitialState, duelPlacements, fighterPose, IDLE_INTENT, step, TICK_SECONDS, type SimState } from '../sim';
import { loadTuningData } from '../tuning';
import { DaggerViews, embedAt, embedPosition, heldDagger, holdsDagger, SPIN_TURNS_PER_SECOND, spinAngle } from './daggerView';

const tuning = loadTuningData();

describe('a dagger in the hand', () => {
  const tick = (s: SimState, intent = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);

  it('shows from the first Tick of a Throw until it leaves the hand', () => {
    let s = createInitialState(tuning, 1);
    expect(holdsDagger(s.fighters[0]!)).toBe(false);
    s = tick(s, { throw: true });
    expect(holdsDagger(s.fighters[0]!)).toBe(true);
    while (s.daggers.length === 0) s = tick(s);
    expect(holdsDagger(s.fighters[0]!)).toBe(false);
  });

  it('is held by its point: the tip at the wrist, pointing down the forearm, the handle out past the fingers', () => {
    const pose = fighterPose(createInitialState(tuning, 1).fighters[0]!, tuning);
    const { leftHand: h, leftElbow: e } = pose.joints;
    const { origin, tip } = heldDagger(pose);
    const toElbow = { x: e.x - h.x, y: e.y - h.y, z: e.z - h.z };
    const len = Math.hypot(toElbow.x, toElbow.y, toElbow.z);
    expect(tip.x * toElbow.x + tip.y * toElbow.y + tip.z * toElbow.z).toBeCloseTo(len, 9);
    // The blade/handle join is beyond the hand, away from the elbow.
    expect(Math.hypot(origin.x - e.x, origin.y - e.y, origin.z - e.z)).toBeGreaterThan(len + 0.2);
  });
});

describe('a dagger in flight', () => {
  it('leaves the hand handle first and spins end over end at a steady rate', () => {
    expect(spinAngle(0)).toBeCloseTo(Math.PI, 9);
    const perSecond = Math.round(1 / TICK_SECONDS);
    expect(spinAngle(perSecond) - spinAngle(0)).toBeCloseTo(2 * Math.PI * SPIN_TURNS_PER_SECOND, 9);
    expect(spinAngle(3, 0.5)).toBeCloseTo((spinAngle(3) + spinAngle(4)) / 2, 9);
  });
});

describe('a dagger embedded in a Fighter', () => {
  it('stays at the same spot on the body as the Fighter moves and turns', () => {
    const at = { position: { x: 2, z: 3 }, y: 0, facing: 0.7 };
    const point = { x: 2.1, y: 1.2, z: 3.25 };
    const embed = embedAt(1, point, at);
    const back = embedPosition(embed, at);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
    expect(back.z).toBeCloseTo(point.z, 9);
    // Walk 1 m along x and turn a quarter circle: it keeps its distance from the feet and its height.
    const moved = embedPosition(embed, { position: { x: 3, z: 3 }, y: 0, facing: 0.7 + Math.PI / 2 });
    expect(Math.hypot(moved.x - 3, moved.z - 3)).toBeCloseTo(Math.hypot(point.x - 2, point.z - 3), 9);
    expect(moved.y).toBeCloseTo(1.2, 9);
  });
});

describe('the dagger views', () => {
  it('clear on a restart when only a later Fighter has held a dagger', () => {
    const start = createInitialState(tuning, 1, duelPlacements(3));
    const s = step(start, [IDLE_INTENT, { ...IDLE_INTENT, throw: true }], tuning);
    const views = new DaggerViews(new THREE.Scene());
    views.update(start, s, 1, 0, s.fighters.map((f) => fighterPose(f, tuning)));
    // Back to Tick 0, as a Restart does.
    expect(() => views.update(start, start, 1, 0, start.fighters.map((f) => fighterPose(f, tuning)))).not.toThrow();
  });
});
