import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry } from '../tuning';
import { createInitialState, fighterPose, hashState, IDLE_INTENT, restore, snapshot, step, throwTimings, type DaggerStuckEvent, type Intent, type SimState } from './index';

const base = loadTuningData();
const WALL_Z = 6;
const corner = (x: number, z: number) => ({ x, y: 0, z });
const flat: ArenaGeometry = {
  name: 'flight',
  walk: [{ id: 'floor', points: [corner(-40, -40), corner(-40, 40), corner(40, 40), corner(40, -40)] }],
  walls: [{ id: 'wall', a: { x: -5, z: WALL_Z }, b: { x: 5, z: WALL_Z }, bottom: 0, top: 3 }],
  spawns: [],
};
const tuning = { ...base, arenas: { ...base.arenas, flight: flat } };
const { speed, gravity, loft, maxTicks } = tuning.dagger;

const fresh = (): SimState => createInitialState(tuning, 1, undefined, [], [], 'flight');
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
// The Wind-up plays to its held pose, then (throw let go) Releases on the next Tick.
const releaseTicks = throwTimings(tuning, Object.keys(tuning.weapons)[0]!).windUpEnd + 1;

/** Throw from `s`, stopping on the Tick the dagger leaves the hand. */
function throwNow(s: SimState, intent: Partial<Intent> = {}): SimState {
  s = tick(s, { ...intent, throw: true });
  for (let i = 0; i < releaseTicks; i++) s = tick(s, intent);
  return s;
}

/** Fly on until no dagger is left, collecting every event; returns the last Tick that had one. */
function flyOut(s: SimState): { last: SimState; events: SimState['events'][number][]; ticks: number } {
  const events: SimState['events'][number][] = [];
  let n = 0;
  while (s.daggers.length > 0) {
    s = tick(s);
    events.push(...s.events);
    if (++n > 1000) throw new Error('dagger never ended');
  }
  return { last: s, events, ticks: n };
}

describe('Dagger flight', () => {
  it('leaves the left hand on the first Tick of Release, and moves from the next Tick', () => {
    const s = throwNow(fresh());
    expect(s.daggers).toHaveLength(1);
    const d = s.daggers[0]!;
    expect(d).toMatchObject({ owner: 0, team: 0, ticks: 0 });
    const f = s.fighters[0]!;
    expect(f.action.kind === 'Throw' && f.action.phase).toBe('Release');
    expect(d.thrownAt).toBe(f.action.kind === 'Throw' ? f.action.startTick : -1);
    expect(d.position).toEqual(fighterPose(f, tuning).joints.leftHand);
    const next = tick(s);
    expect(next.daggers[0]!.ticks).toBe(1);
    expect(next.daggers[0]!.position).not.toEqual(d.position);
  });

  it('is aimed along facing and pitch plus the loft, at launch speed', () => {
    const turned = ticks(fresh(), 60, { face: Math.PI / 2, pitch: 0.2 });
    const s = throwNow(turned, { face: Math.PI / 2, pitch: 0.2 });
    const v = s.daggers[0]!.velocity;
    const f = s.fighters[0]!;
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(speed, 9);
    expect(Math.atan2(v.x, v.z)).toBeCloseTo(f.facing, 9);
    expect(Math.asin(v.y / speed)).toBeCloseTo(f.pitch + (loft * Math.PI) / 180, 9);
  });

  it('lands where gravity says a level throw lands', () => {
    // Away from the Wall: face -z.
    const s = throwNow(ticks(fresh(), 60, { face: Math.PI }), { face: Math.PI });
    const d = s.daggers[0]!;
    const { last, events } = flyOut(s);
    const stuck = events.find((e): e is DaggerStuckEvent => e.type === 'DaggerStuck')!;
    expect(stuck).toBeDefined();
    expect(stuck.point.y).toBeCloseTo(0, 6);
    const elevation = (loft * Math.PI) / 180;
    const vy = Math.sin(elevation) * speed;
    const vh = Math.cos(elevation) * speed;
    const t = (vy + Math.sqrt(vy * vy + 2 * gravity * d.position.y)) / gravity;
    const dx = stuck.point.x - d.position.x;
    const dz = stuck.point.z - d.position.z;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(vh * t - 0.5);
    expect(Math.hypot(dx, dz)).toBeLessThan(vh * t + 0.5);
    expect(dz).toBeLessThan(0);
    expect(last.daggers).toHaveLength(0);
  });

  it('stops at a Wall', () => {
    const s = throwNow(fresh());
    const { events } = flyOut(s);
    const stuck = events.find((e): e is DaggerStuckEvent => e.type === 'DaggerStuck')!;
    expect(stuck.point.z).toBeCloseTo(WALL_Z, 6);
    expect(stuck.point.y).toBeGreaterThan(0);
    expect(stuck.point.y).toBeLessThan(3);
  });

  it('flies over a Wall that is lower than its path', () => {
    const low = { ...tuning, arenas: { ...tuning.arenas, flight: { ...flat, walls: [{ ...flat.walls[0]!, top: 0.2 }] } } };
    let s = createInitialState(low, 1, undefined, [], [], 'flight');
    s = step(s, [{ ...IDLE_INTENT, throw: true }], low);
    for (let i = 0; i < releaseTicks; i++) s = step(s, [IDLE_INTENT], low);
    for (let i = 0; i < 20; i++) s = step(s, [IDLE_INTENT], low);
    const d = s.daggers[0]!;
    expect(d.position.z).toBeGreaterThan(WALL_Z);
  });

  it('expires after maxTicks if it never lands', () => {
    // Hover: no gravity, thrown over the edge of the world (no Wall, no ground), so only maxTicks ends it.
    const open = { ...tuning, dagger: { ...tuning.dagger, gravity: 0 }, arenas: { ...tuning.arenas, flight: { ...flat, walls: [], walk: [{ id: 'f', points: [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)] }] } } };
    let s = createInitialState(open, 1, undefined, [], [], 'flight');
    s = step(s, [{ ...IDLE_INTENT, throw: true }], open);
    for (let i = 0; i < releaseTicks; i++) s = step(s, [IDLE_INTENT], open);
    const spawned = s.tick;
    let events: SimState['events'][number][] = [];
    while (s.daggers.length > 0) {
      s = step(s, [IDLE_INTENT], open);
      events = events.concat(s.events);
    }
    expect(s.tick - spawned).toBe(maxTicks);
    expect(events.some((e) => e.type === 'DaggerStuck')).toBe(false);
  });

  it('keeps daggers in the order they were thrown, and two in the air at once', () => {
    // Away from the Wall, and floating for long enough, so the first is still flying when the second leaves the hand
    // (a whole Throw outlasts a real dagger's flight).
    const floaty = { ...tuning, dagger: { ...tuning.dagger, gravity: 0, maxTicks: 600 } };
    const away = { ...IDLE_INTENT, face: Math.PI };
    const run = (s: SimState, n: number, intent: Intent = away): SimState => {
      for (let i = 0; i < n; i++) s = step(s, [i === 0 ? intent : away], floaty);
      return s;
    };
    let s = run(run(fresh(), 60), releaseTicks + 1, { ...away, throw: true });
    s = run(s, throwTimings(tuning, Object.keys(tuning.weapons)[0]!).end - releaseTicks);
    s = run(s, releaseTicks + 1, { ...away, throw: true });
    expect(s.daggers.length).toBe(2);
    expect(s.daggers[0]!.thrownAt).toBeLessThan(s.daggers[1]!.thrownAt);
    expect(s.daggers[0]!.ticks).toBeGreaterThan(s.daggers[1]!.ticks);
  });

  it('is deterministic, and a Rollback re-simulation matches', () => {
    const run = (s: SimState, n: number) => ticks(s, n, { face: 0.3 });
    const a = run(throwNow(fresh(), { face: 0.3 }), 10);
    const b = run(throwNow(fresh(), { face: 0.3 }), 10);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.daggers.length).toBe(1);
    const mid = throwNow(fresh(), { face: 0.3 });
    const snap = snapshot(mid);
    const replay = run(restore(snap), 10);
    expect(hashState(replay)).toBe(hashState(a));
    expect(replay).toEqual(a);
  });
});
