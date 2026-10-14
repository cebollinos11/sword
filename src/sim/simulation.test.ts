import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  fighterPose,
  hashState,
  IDLE_INTENT,
  restore,
  snapshot,
  step,
  type Intent,
  type SimState,
} from './index';
import { loadTuningData } from '../tuning';

const tuning = loadTuningData();

function run(state: SimState, intents: readonly (readonly Intent[])[]): SimState {
  return intents.reduce((s, tickIntents) => step(s, tickIntents, tuning), state);
}

/** A scripted Intent sequence: walk forward, then strafe, then stand still. */
function scriptedIntents(ticks: number): Intent[][] {
  const out: Intent[][] = [];
  for (let t = 0; t < ticks; t++) {
    const move = t < 40 ? { x: 0, z: 1 } : t < 80 ? { x: 1, z: 0.5 } : { x: 0, z: 0 };
    out.push([{ ...IDLE_INTENT, move }]);
  }
  return out;
}

describe('A lone Fighter on the Arena', () => {
  it('starts Idle at the Arena centre with full HP (fighter.json maxHp = 100)', () => {
    const s = createInitialState(tuning, 1);
    expect(s.fighters).toHaveLength(1);
    expect(s.fighters[0]).toMatchObject({ action: { kind: 'Idle' }, hp: 100, position: { x: 0, z: 0 } });
  });

  it('stays put and Idle while given no Intents, with the Tick advancing', () => {
    const s = run(createInitialState(tuning, 1), Array.from({ length: 60 }, () => []));
    expect(s.tick).toBe(60);
    expect(s.fighters[0]).toMatchObject({ action: { kind: 'Idle' }, hp: 100, position: { x: 0, z: 0 } });
  });

  it('walks at walkSpeed: one second forward at 2.5 m/s covers 2.5 m', () => {
    const forward = Array.from({ length: 60 }, () => [{ ...IDLE_INTENT, move: { x: 0, z: 1 } }]);
    const s = run(createInitialState(tuning, 1), forward);
    expect(s.fighters[0]!.position.z).toBeCloseTo(2.5, 6);
    expect(s.fighters[0]!.position.x).toBeCloseTo(0, 6);
  });

  it('holds its sword in the Idle Motion from Tick 0 (idle.json: hand at local (0.2, 1.05, 0.3))', () => {
    const f = createInitialState(tuning, 1).fighters[0]!;
    expect(f.motion).toEqual({ name: 'Idle', tick: 0 });
    expect(f.blade.hilt.x).toBeCloseTo(-0.2, 6); // the Fighter's right is world -x when facing +z
    expect(f.blade.hilt.y).toBeCloseTo(1.05, 6);
    expect(f.blade.hilt.z).toBeCloseTo(0.3, 6);
  });

  it('solves its Skeleton inside the Tick: the blade walks with the Fighter and follows the Idle Motion', () => {
    const forward = Array.from({ length: 60 }, () => [{ ...IDLE_INTENT, move: { x: 0, z: 1 } }]);
    const f = run(createInitialState(tuning, 1), forward).fighters[0]!;
    expect(f.motion).toEqual({ name: 'Idle', tick: 60 });
    // 2.5 m walked + 0.3 m hand reach; idle.json's 1 s Pose Key lowers the hand to 1.03.
    expect(f.blade.hilt.z).toBeCloseTo(2.8, 6);
    expect(f.blade.hilt.y).toBeCloseTo(1.03, 6);
  });

  it('exposes the full solved Skeleton for the Renderer, matching the blade in state', () => {
    const f = run(createInitialState(tuning, 1), scriptedIntents(30)).fighters[0]!;
    const pose = fighterPose(f, tuning);
    expect(pose.blade).toEqual(f.blade);
    expect(pose.joints.head.y).toBeGreaterThan(1.5);
  });

  it('never leaves the Arena (radius 8, Fighter radius 0.35)', () => {
    const forward = Array.from({ length: 600 }, () => [{ ...IDLE_INTENT, move: { x: 1, z: 0 } }]);
    const s = run(createInitialState(tuning, 1), forward);
    expect(s.fighters[0]!.position.x).toBeCloseTo(7.65, 6);
  });
});

describe('Simulation determinism', () => {
  it('identical Intent sequences yield identical state hashes', () => {
    const a = run(createInitialState(tuning, 1234), scriptedIntents(120));
    const b = run(createInitialState(tuning, 1234), scriptedIntents(120));
    expect(hashState(a)).toBe(hashState(b));
  });

  it('different Intent sequences yield different state hashes', () => {
    const intents = scriptedIntents(120);
    const altered = intents.map((tick, t) => (t === 10 ? [{ ...IDLE_INTENT, move: { x: -1, z: 0 } }] : tick));
    const a = run(createInitialState(tuning, 1234), intents);
    const b = run(createInitialState(tuning, 1234), altered);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('different seeds yield different state hashes', () => {
    expect(hashState(createInitialState(tuning, 1))).not.toBe(hashState(createInitialState(tuning, 2)));
  });

  it('stepping never mutates the input state', () => {
    const s0 = createInitialState(tuning, 7);
    const before = hashState(s0);
    run(s0, scriptedIntents(30));
    expect(hashState(s0)).toBe(before);
  });
});

describe('Snapshot and restore', () => {
  it('snapshot → restore → re-simulate yields an identical hash', () => {
    const intents = scriptedIntents(120);
    const straight = run(createInitialState(tuning, 99), intents);

    const mid = run(createInitialState(tuning, 99), intents.slice(0, 50));
    const snap = snapshot(mid);
    // Keep simulating past the snapshot, then rewind and replay.
    run(mid, intents.slice(50, 90));
    const replayed = run(restore(snap), intents.slice(50));

    expect(hashState(replayed)).toBe(hashState(straight));
  });

  it('a snapshot is unaffected by later changes to the restored state', () => {
    const s = run(createInitialState(tuning, 5), scriptedIntents(20));
    const snap = snapshot(s);
    const restored = restore(snap) as unknown as { fighters: { position: { x: number } }[] };
    restored.fighters[0]!.position.x = 42;
    expect(hashState(restore(snap))).toBe(hashState(s));
  });
});
