import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, fighterPose, hashValue, IDLE_INTENT, kickTimings, step, type Intent, type SimState } from './index';

const tuning = loadTuningData();
const timings = kickTimings(tuning, Object.keys(tuning.weapons)[0]!);
const WHIFF = tuning.kick.whiffRecovery;

const fresh = (): SimState => createInitialState(tuning, 1);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const kicker = (s: SimState) => s.fighters[0]!;
const kicking = (s: SimState): boolean => kicker(s).action.kind === 'Kick';

/** Press kick, then run until the Kick ends, collecting the phase of every Tick it lasted. */
function runKick(s: SimState): { phases: string[]; end: SimState } {
  const phases: string[] = [];
  s = tick(s, { kick: true });
  while (kicking(s)) {
    const a = kicker(s).action;
    phases.push(a.kind === 'Kick' ? a.phase : '');
    s = tick(s);
    if (phases.length > 1000) throw new Error('Kick never ended');
  }
  return { phases, end: s };
}

describe('Kick Action', () => {
  it('starts on kick and runs Wind-up, Release, Recovery in order, then Idle', () => {
    const { phases, end } = runKick(fresh());
    expect([...new Set(phases)]).toEqual(['Wind-up', 'Release', 'Recovery']);
    expect(phases.indexOf('Release')).toBe(timings.windUpEnd);
    expect(phases.indexOf('Recovery')).toBe(timings.releaseEnd);
    expect(kicker(end).action.kind).toBe('Idle');
  });

  it('raises a KickPhase event as it enters each phase', () => {
    let s = tick(fresh(), { kick: true });
    const phases: { phase: string; at: number }[] = [];
    for (let i = 0; i < 1000 && kicking(s); i++) {
      for (const e of s.events) if (e.type === 'KickPhase') phases.push({ phase: e.phase, at: i });
      s = tick(s);
    }
    // Release begins with the leg snapping out at windUpEnd, Recovery at releaseEnd.
    expect(phases).toEqual([
      { phase: 'Wind-up', at: 0 },
      { phase: 'Release', at: timings.windUpEnd },
      { phase: 'Recovery', at: timings.releaseEnd },
    ]);
  });

  it('a Kick that lands nothing holds its pose for whiffRecovery more Ticks', () => {
    const { phases } = runKick(fresh());
    expect(phases.length).toBe(timings.end + WHIFF);
  });

  it('a Kick that landed recovers without the extra hold', () => {
    let s = ticks(tick(fresh(), { kick: true }), timings.windUpEnd + 2);
    const a = kicker(s).action;
    if (a.kind !== 'Kick') throw new Error('expected a Kick');
    s = { ...s, fighters: [{ ...kicker(s), action: { ...a, landed: true } }] };
    const start = s.tick;
    while (kicking(s)) s = tick(s);
    // The Kick started on Tick 1, so it has run (windUpEnd + 3) motion Ticks by now; it needs `end` in all.
    expect(s.tick - start).toBe(timings.end - (timings.windUpEnd + 3) + 1);
  });

  it('commits the Fighter: it cannot walk, Block, Attack or Jump, but can turn', () => {
    let s = tick(fresh(), { kick: true });
    const at = kicker(s).position;
    s = ticks(s, 10, { move: { x: 1, z: 1 }, attack: true, block: true, direction: 'Left', face: 1 });
    expect(kicker(s).action.kind).toBe('Kick');
    expect(kicker(s).position).toEqual(at);
    expect(kicker(s).facing).toBeGreaterThan(0);
    s = ticks(s, 5, { jump: true, attack: true, direction: 'Thrust' });
    expect(kicker(s).air).toBeUndefined();
    expect(kicker(s).action.kind).toBe('Kick');
  });

  it('cannot be cancelled: pressing Block and Attack does not shorten it', () => {
    const calm = runKick(fresh()).phases.length;
    let s = tick(fresh(), { kick: true });
    let n = 1;
    while (kicking(s)) {
      s = tick(s, { block: true, attack: true });
      n++;
    }
    expect(n).toBe(calm + 1);
  });

  it('cannot start while crouched past half, but can while barely crouched', () => {
    const deep = ticks(fresh(), 30, { crouch: true });
    expect(kicker(deep).crouch).toBe(1);
    expect(kicking(tick(deep, { kick: true, crouch: true }))).toBe(false);
    const shallow = { ...fresh(), fighters: [{ ...kicker(fresh()), crouch: 0.4 }] };
    expect(kicking(tick(shallow, { kick: true }))).toBe(true);
  });

  it('starts in a Jump, but not after walking or being pushed off the ground', () => {
    let s = tick(fresh(), { jump: true });
    expect(kicker(s).air?.jumped).toBe(true);
    s = tick(s, { kick: true });
    expect(kicker(s).action.kind).toBe('Kick');
    expect(kicker(s).air).toBeDefined();
    const pushed = { ...fresh(), fighters: [{ ...kicker(fresh()), y: 3, air: { vx: 0, vz: 0, vy: 0, peakY: 3, ticks: 0, jumped: false } }] };
    expect(kicking(tick(pushed, { kick: true }))).toBe(false);
  });

  it('cannot start from Attack or Block', () => {
    const attacking = tick(fresh(), { attack: true });
    expect(kicker(tick(attacking, { kick: true })).action.kind).toBe('Attack');
    const blocking = tick(fresh(), { block: true });
    expect(kicker(tick(blocking, { kick: true, block: true })).action.kind).toBe('Block');
  });

  it('swings the right leg forward in Release, and plants it again afterwards', () => {
    const rest = fighterPose(fresh().fighters[0]!, tuning).joints.rightToe;
    let s = tick(fresh(), { kick: true });
    let reach = -Infinity;
    let height = -Infinity;
    while (kicking(s)) {
      const f = kicker(s);
      const pose = fighterPose(f, tuning);
      // The recorded leg is the solved Skeleton's.
      expect(f.kickLeg).toEqual({ knee: pose.joints.rightKnee, toe: pose.joints.rightToe });
      reach = Math.max(reach, f.kickLeg.toe.z - f.position.z);
      height = Math.max(height, f.kickLeg.toe.y);
      s = tick(s);
    }
    expect(reach).toBeGreaterThan(0.7);
    expect(height).toBeGreaterThan(rest.y + 0.5);
    expect(kicker(ticks(s, 60)).kickLeg.toe.y).toBeLessThan(0.2);
  });

  it('is deterministic', () => {
    const run = () => ticks(tick(ticks(fresh(), 5), { kick: true }), 120);
    expect(hashValue(run())).toBe(hashValue(run()));
  });
});
