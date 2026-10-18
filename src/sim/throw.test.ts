import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, createMatch, fighterPose, IDLE_INTENT, step, stepMatch, throwTimings, type Intent, type SimEvent, type SimState } from './index';

const tuning = loadTuningData();
const weapon = Object.keys(tuning.weapons)[0]!;
const timings = throwTimings(tuning, weapon);

const fresh = (weapons: readonly string[] = []): SimState => createInitialState(tuning, 1, undefined, weapons);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const thrower = (s: SimState) => s.fighters[0]!;
const throwing = (s: SimState): boolean => thrower(s).action.kind === 'Throw';

/** Press throw, then run until the Throw ends, collecting the phase of every Tick it lasted and the events. */
function runThrow(s: SimState, intent: Partial<Intent> = {}): { phases: string[]; end: SimState; events: SimEvent[] } {
  const phases: string[] = [];
  const events: SimEvent[] = [];
  s = tick(s, { ...intent, throw: true });
  events.push(...s.events);
  while (throwing(s)) {
    const a = thrower(s).action;
    phases.push(a.kind === 'Throw' ? a.phase : '');
    s = tick(s, intent);
    events.push(...s.events);
    if (phases.length > 1000) throw new Error('Throw never ended');
  }
  return { phases, end: s, events };
}

describe('Throw Action', () => {
  it('starts on throw and runs Wind-up, Release, Recovery in order, then Idle', () => {
    const { phases, end } = runThrow(fresh());
    expect([...new Set(phases)]).toEqual(['Wind-up', 'Release', 'Recovery']);
    expect(phases.indexOf('Release')).toBe(timings.windUpEnd);
    expect(phases.indexOf('Recovery')).toBe(timings.releaseEnd);
    expect(phases.length).toBe(timings.end);
    expect(thrower(end).action.kind).toBe('Idle');
  });

  it('lasts about half a second', () => {
    expect(timings.end).toBeGreaterThanOrEqual(25);
    expect(timings.end).toBeLessThanOrEqual(35);
  });

  it('remembers the Tick its Wind-up started', () => {
    const s = tick(ticks(fresh(), 5), { throw: true });
    const a = thrower(s).action;
    if (a.kind !== 'Throw') throw new Error('expected a Throw');
    expect(a.startTick).toBe(s.tick);
  });

  it('spends one dagger on the first Tick of Release, and says so', () => {
    expect(thrower(fresh()).daggers).toBe(tuning.dagger.count);
    let s = tick(fresh(), { throw: true });
    for (let i = 0; i < timings.windUpEnd - 1; i++) {
      expect(thrower(s).daggers).toBe(tuning.dagger.count);
      s = tick(s);
    }
    expect(thrower(s).daggers).toBe(tuning.dagger.count);
    s = tick(s);
    const a = thrower(s).action;
    expect(a.kind === 'Throw' && a.phase).toBe('Release');
    expect(thrower(s).daggers).toBe(tuning.dagger.count - 1);
    expect(s.events.filter((e) => e.type === 'DaggerThrown')).toEqual([{ type: 'DaggerThrown', thrower: 0 }]);
    s = ticks(s, 10);
    expect(thrower(s).daggers).toBe(tuning.dagger.count - 1);
  });

  it('spends exactly one dagger per throw, and a Fighter with none cannot throw', () => {
    let s = fresh();
    for (let n = 1; n <= tuning.dagger.count; n++) {
      s = runThrow(s).end;
      expect(thrower(s).daggers).toBe(tuning.dagger.count - n);
    }
    expect(thrower(s).daggers).toBe(0);
    s = tick(s, { throw: true });
    expect(thrower(s).action.kind).toBe('Idle');
  });

  it('a Throw that is interrupted before Release spends nothing', () => {
    let s = tick(fresh(), { throw: true });
    s = { ...s, fighters: [{ ...thrower(s), action: { kind: 'Idle' } }] };
    s = ticks(s, 40);
    expect(thrower(s).daggers).toBe(tuning.dagger.count);
  });

  it('the thrower can walk and turn, and crouch', () => {
    const base = tick(fresh(), { throw: true });
    const s = ticks(base, 10, { move: { x: 0, z: 1 }, face: 1, crouch: true });
    expect(thrower(s).action.kind).toBe('Throw');
    expect(thrower(s).position.z - thrower(base).position.z).toBeGreaterThan(0);
    expect(thrower(s).facing).toBeGreaterThan(0.5);
    expect(thrower(s).crouch).toBeGreaterThan(0);
  });

  it('walks at full speed with the default throwWalkFactor of 1', () => {
    expect(tuning.dagger.throwWalkFactor).toBe(1);
    const walking = ticks(fresh(), 6, { move: { x: 0, z: 1 } });
    const throwingWalk = ticks(tick(fresh(), { throw: true, move: { x: 0, z: 1 } }), 5, { move: { x: 0, z: 1 } });
    expect(thrower(throwingWalk).position.z).toBeCloseTo(thrower(walking).position.z, 9);
  });

  it('scales the walk by throwWalkFactor', () => {
    const slow = { ...tuning, dagger: { ...tuning.dagger, throwWalkFactor: 0.5 } };
    // The Throw is the current Action from the second Tick on, so measure what the next five Ticks walk.
    const run = (t: typeof tuning) => {
      let s = step(createInitialState(t, 1), [{ ...IDLE_INTENT, throw: true, move: { x: 0, z: 1 } }], t);
      const from = thrower(s).position.z;
      for (let i = 0; i < 5; i++) s = step(s, [{ ...IDLE_INTENT, move: { x: 0, z: 1 } }], t);
      return thrower(s).position.z - from;
    };
    expect(run(slow)).toBeCloseTo(run(tuning) / 2, 9);
  });

  it('cannot Attack, Block, Kick, Feint or cancel while throwing', () => {
    let s = tick(fresh(), { throw: true });
    s = ticks(s, 10, { attack: true, block: true, kick: true, direction: 'Left' });
    expect(thrower(s).action.kind).toBe('Throw');
    s = ticks(s, 2, { block: false, attack: false });
    expect(thrower(s).action.kind).toBe('Throw');
  });

  it('does not start from a Block or an Attack', () => {
    const blocking = tick(fresh(), { block: true });
    expect(thrower(tick(blocking, { block: true, throw: true })).action.kind).toBe('Block');
    const attacking = tick(fresh(), { attack: true });
    expect(thrower(tick(attacking, { attack: true, throw: true })).action.kind).toBe('Attack');
  });

  it('the Kick wins if both are pressed on the same Tick', () => {
    expect(thrower(tick(fresh(), { throw: true, kick: true })).action.kind).toBe('Kick');
  });

  it('starts in a Jump, but not after walking off a ledge', () => {
    let s = tick(fresh(), { jump: true });
    s = ticks(s, 3);
    expect(thrower(s).air?.jumped).toBe(true);
    s = tick(s, { throw: true });
    expect(thrower(s).action.kind).toBe('Throw');
    const idle = fresh();
    const walkedOff = { ...idle, fighters: [{ ...thrower(idle), air: { vx: 0, vz: 0, vy: 0, peakY: 0, ticks: 0, jumped: false } }] };
    expect(thrower(tick(walkedOff, { throw: true })).action.kind).not.toBe('Throw');
  });

  it('is deterministic', () => {
    const a = runThrow(fresh(), { move: { x: 1, z: 0 }, face: 0.4 }).end;
    const b = runThrow(fresh(), { move: { x: 1, z: 0 }, face: 0.4 }).end;
    expect(a).toEqual(b);
  });
});

describe('Throw: the off hand', () => {
  const leftHand = (s: SimState) => fighterPose(thrower(s), tuning).joints.leftHand;
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  for (const name of Object.keys(tuning.weapons)) {
    it(`with the ${name} the left hand leaves its guard and comes back, and the sword hand stays near its guard`, () => {
      let s = ticks(fresh([name]), 30);
      const rest = leftHand(s);
      const hilt = thrower(s).blade.hilt;
      s = tick(s, { throw: true });
      let far = 0;
      while (throwing(s)) {
        far = Math.max(far, dist(leftHand(s), rest));
        expect(dist(thrower(s).blade.hilt, hilt)).toBeLessThan(0.5);
        s = tick(s);
      }
      expect(far).toBeGreaterThan(0.15);
      // Back in the guard once the Throw and its Motion Blend are over.
      s = ticks(s, 30);
      expect(dist(leftHand(s), rest)).toBeLessThan(0.02);
    });
  }
});

describe('Throw: daggers per Duel', () => {
  it('refills the count when the next Duel starts', () => {
    let m = createMatch(tuning, { bestOf: 3, seed: 1 });
    m = stepMatch(m, [{ ...IDLE_INTENT, throw: true }, IDLE_INTENT], tuning);
    for (let i = 0; i < 60; i++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(m.duel.fighters[0]!.daggers).toBe(tuning.dagger.count - 1);
    // Fighter 1 dies; once the next Duel starts both Fighters are full again.
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 1 ? { ...f, hp: 0 } : f)) } };
    const duel = m.duelNumber;
    for (let i = 0; i < 2000 && m.duelNumber === duel; i++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(m.duelNumber).toBe(duel + 1);
    expect(m.duel.fighters.map((f) => f.daggers)).toEqual([tuning.dagger.count, tuning.dagger.count]);
  });
});
