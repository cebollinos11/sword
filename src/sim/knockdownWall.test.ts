import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry, type TuningData } from '../tuning';
import { knockdown } from './actions';
import { createInitialState, IDLE_INTENT, step, type FighterState, type Intent, type SimState } from './index';
import { lyingReach, roomBehind, WALL_CLEARANCE, wallLean } from './knockdownWall';
import { fighterPose } from './pose';

const base = loadTuningData();
const corner = (x: number, z: number) => ({ x, y: 0, z });
const VICTIM_Z = 0.95;

/** The Arena with a Wall across it `behind` m behind the victim (none for null). */
function arena(behind: number | null): TuningData {
  const geometry: ArenaGeometry = {
    name: 'walled',
    walk: [{ id: 'floor', points: [corner(-20, -20), corner(-20, 20), corner(20, 20), corner(20, -20)] }],
    walls: behind === null ? [] : [{ id: 'w', a: { x: -5, z: VICTIM_Z + behind }, b: { x: 5, z: VICTIM_Z + behind }, bottom: 0, top: 3 }],
    spawns: [],
  };
  return { ...base, arenas: { ...base.arenas, walled: geometry } };
}

/** Kicker (Fighter 0) at the origin facing +z, the victim (Fighter 1) in front of it facing it, its back to the Wall. */
const facing = (tuning: TuningData): SimState =>
  createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: VICTIM_Z }, facing: Math.PI }], [], [], 'walled');

const tick = (tuning: TuningData, s: SimState, a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...a }, { ...IDLE_INTENT, ...b }], tuning);

/** Every Tick of the victim from a Kick's Knockdown (it walks back as the kick comes, as in knockdown.test.ts) to Idle again. */
function knockdownTicks(tuning: TuningData): FighterState[] {
  let s = tick(tuning, facing(tuning), { kick: true });
  const seen: FighterState[] = [];
  for (let i = 0; i < 600; i++) {
    const k = s.fighters[0]!.action;
    s = tick(tuning, s, {}, k.kind === 'Kick' && k.phase === 'Release' && seen.length === 0 ? { move: { x: 0, z: -1 } } : {});
    const v = s.fighters[1]!;
    if (v.action.kind === 'Knockdown') seen.push(v);
    else if (seen.length > 0) return [...seen, v];
  }
  throw new Error(seen.length ? 'The victim never got up' : 'The victim was never knocked down');
}

/** How far past the plane z = `wallZ` the farthest point of the Fighter's solved body (joints, head round its centre, blade) reaches. */
function past(f: FighterState, wallZ: number): number {
  const pose = fighterPose(f, base);
  const zs = Object.entries(pose.joints).map(([k, p]) => p.z + (k === 'head' ? base.skeleton.headRadius : 0));
  return Math.max(...zs, pose.blade.hilt.z, pose.blade.tip.z) - wallZ;
}

describe('a Knockdown against a Wall', () => {
  it('lies flat, untouched, with no Wall behind', () => {
    const ticks = knockdownTicks(arena(null));
    expect(ticks.every((f) => f.motion.wall === undefined)).toBe(true);
  });

  it('lies flat with a Wall farther than its body', () => {
    const ticks = knockdownTicks(arena(4));
    expect(ticks.every((f) => f.motion.wall === undefined)).toBe(true);
  });

  for (const behind of [0.5, 0.9, 1.3]) {
    it(`never reaches through a Wall ${behind} m behind it, and sits up against it`, () => {
      const tuning = arena(behind);
      const ticks = knockdownTicks(tuning);
      const wallZ = VICTIM_Z + behind;
      for (const f of ticks) expect(past(f, wallZ)).toBeLessThanOrEqual(0.02);
      const lying = ticks.find((f) => f.action.kind === 'Knockdown' && f.action.phase === 'Down')!;
      expect(lying.motion.wall).toBeGreaterThan(0);
      // The Get-up rises from the pose it lay in, and Idle carries no lean.
      const rising = ticks.filter((f) => f.action.kind === 'Knockdown' && f.action.phase === 'Rising');
      expect(rising.length).toBeGreaterThan(0);
      expect(rising.every((f) => f.motion.wall === ticks.at(-2)!.motion.wall)).toBe(true);
      expect(ticks.at(-1)!.action.kind).toBe('Idle');
      expect(ticks.at(-1)!.motion.wall).toBeUndefined();
    });
  }

  it('sits further up the less room it has to recline', () => {
    // Knocked down where it stands (no Slide toward the Wall), to its lean once down.
    const lean = (behind: number): number => {
      const tuning = arena(behind);
      const start = facing(tuning);
      const fresh = knockdown();
      let s: SimState = { ...start, fighters: [start.fighters[0]!, { ...start.fighters[1]!, action: fresh.action, motion: fresh.motion }] };
      for (let i = 0; i < 60; i++) s = tick(tuning, s);
      const v = s.fighters[1]!;
      expect(v.action).toMatchObject({ kind: 'Knockdown', phase: 'Down' });
      expect(past(v, VICTIM_Z + behind)).toBeLessThanOrEqual(0.02);
      return v.motion.wall ?? 0;
    };
    expect(lean(0.4)).toBeGreaterThan(0.95);
    expect(lean(1.3)).toBeLessThan(lean(0.9));
    expect(lean(1.3)).toBeGreaterThan(0);
    expect(lean(1.3)).toBeLessThan(1);
    expect(lean(1.9)).toBe(0);
  });

  it('measures the room behind along the way the body lies, at any facing', () => {
    const tuning = arena(1);
    const geometry = tuning.arenas.walled!;
    const reach = lyingReach(base.skeleton);
    expect(roomBehind({ position: { x: 0, z: VICTIM_Z }, facing: Math.PI, y: 0 }, reach, 1, geometry)).toBeCloseTo(1, 9);
    // Facing the Wall, its back is to open floor.
    expect(roomBehind({ position: { x: 0, z: VICTIM_Z }, facing: 0, y: 0 }, reach, 1, geometry)).toBe(reach);
    // At 45° the Wall is farther along the line it lies on.
    expect(roomBehind({ position: { x: 0, z: VICTIM_Z }, facing: Math.PI * 0.75, y: 0 }, reach, 1, geometry)).toBeLessThan(reach);
    expect(wallLean(reach + WALL_CLEARANCE, base)).toBe(0);
    expect(wallLean(0, base)).toBe(1);
  });
});
