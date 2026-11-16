import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry } from '../tuning';
import { knockdown } from './actions';
import { createInitialState, fighterPose, hashState, hitZoneCapsules, IDLE_INTENT, step, throwTimings, TICK_SECONDS, type DaggerState, type Intent, type Placement, type SimState } from './index';
import type { SimEvent } from './events';

const base = loadTuningData();
const corner = (x: number, z: number) => ({ x, y: 0, z });
const flat: ArenaGeometry = {
  name: 'contact',
  walk: [{ id: 'floor', points: [corner(-60, -60), corner(-60, 60), corner(60, 60), corner(60, -60)] }],
  walls: [],
  spawns: [],
};
const tuning = { ...base, arenas: { ...base.arenas, contact: flat } };
const { dagger, hitZones, fighter } = tuning;

/** Thrower (Fighter 0) at the origin facing +z; the rest of the lineup on the +z axis, each facing `facing`. */
function lineup(zs: number[], teams: number[], facing = 0): SimState {
  const placements: Placement[] = [{ position: { x: 0, z: 0 }, facing: 0 }, ...zs.map((z) => ({ position: { x: 0, z }, facing }))];
  return createInitialState(tuning, 1, placements, [], teams, 'contact');
}

const intents = (n: number, per: Record<number, Partial<Intent>>): Intent[] => Array.from({ length: n }, (_, i) => ({ ...IDLE_INTENT, ...per[i] }));
const tick = (s: SimState, per: Record<number, Partial<Intent>> = {}): SimState => step(s, intents(s.fighters.length, per), tuning);
const find = <T extends SimEvent['type']>(s: SimState, type: T) => s.events.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);

/** Press throw with `thrower`, then run (the victims' Intents given per Tick) until a dagger Hits or is Blocked, or fails. */
function throwToContact(s: SimState, others: (s: SimState, n: number) => Record<number, Partial<Intent>> = () => ({})): { at: SimState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let launched = false;
  for (let n = 0; n < 400; n++) {
    s = tick(s, { ...others(s, n), 0: { throw: n === 0 } });
    events.push(...s.events);
    if (events.some((e) => e.type === 'DaggerHit' || e.type === 'DaggerBlocked')) return { at: s, events };
    launched ||= s.daggers.length > 0;
    if (launched && s.daggers.length === 0) break;
  }
  throw new Error('The dagger never reached anyone');
}

/** A dagger just behind Fighter `at`'s torso, flying at it. */
const dartAt = (s: SimState, target: number, over: Partial<DaggerState> = {}): DaggerState => {
  const t = s.fighters[target]!;
  return { owner: 0, team: s.fighters[0]!.team, thrownAt: 0, position: { x: t.position.x, y: t.y + 1.1, z: t.position.z - 0.15 }, velocity: { x: 0, y: 0, z: 18 }, ticks: 3, ...over };
};
const withDagger = (s: SimState, d: DaggerState): SimState => ({ ...s, daggers: [...s.daggers, d] });

/** Fighter 1 knocked down and lying (guarding, if it holds `block`), and a dagger a hand behind the middle of its torso, flying at it. */
function lyingWithDagger(guard: boolean): SimState {
  let s = lineup([5], [0, 1], Math.PI);
  const down = knockdown();
  s = { ...s, fighters: s.fighters.map((f, i) => (i === 1 ? { ...f, action: down.action, motion: down.motion } : f)) };
  for (let n = 0; n < 60; n++) s = tick(s, { 1: { block: guard, face: Math.PI } });
  expect(s.fighters[1]!.action.kind).toBe('Knockdown');
  const torso = hitZoneCapsules(fighterPose(s.fighters[1]!, tuning), tuning).find((c) => c.zone === 'torso')!;
  const mid = { x: (torso.a.x + torso.b.x) / 2, y: (torso.a.y + torso.b.y) / 2, z: (torso.a.z + torso.b.z) / 2 };
  return withDagger(s, dartAt(s, 1, { position: { ...mid, z: mid.z - 0.15 } }));
}

const walkAway = { move: { x: 0, z: 1 }, face: 0 };

describe('Dagger Hit', () => {
  it('hits a Fighter walking away: damage, Stagger, then a Slow for exactly slowTicks', () => {
    const { at, events } = throwToContact(lineup([5], [0, 1]), () => ({ 1: walkAway }));
    const hit = events.find((e) => e.type === 'DaggerHit')!;
    expect(hit).toMatchObject({ type: 'DaggerHit', thrower: 0, defender: 1 });
    if (hit.type !== 'DaggerHit') throw new Error();
    const damage = dagger.damage * hitZones[hit.zone].multiplier;
    expect(hit.damage).toBeCloseTo(damage, 9);
    expect(at.fighters[1]!.hp).toBeCloseTo(fighter.maxHp - damage, 9);
    expect(events.some((e) => e.type === 'Stagger' && e.fighter === 1 && e.cause === 'Hit')).toBe(true);
    // A dagger Hit plays the generic Stagger, not a directional hit reaction.
    expect(at.fighters[1]!.action).toEqual({ kind: 'Stagger', cause: 'Hit' });
    expect(at.fighters[1]!.motion.name).toBe('Stagger');
    expect(at.daggers).toHaveLength(0);
    expect(at.fighters[1]!.slow).toEqual({ ticks: dagger.slowTicks });

    // The Stagger wears off; from then on the Fighter walks at slowFactor until the timer runs out.
    let s = at;
    const walked: { tick: number; step: number; slowed: boolean }[] = [];
    for (let n = 0; n < dagger.slowTicks + 20; n++) {
      const before = s.fighters[1]!;
      s = tick(s, { 1: walkAway });
      const f = s.fighters[1]!;
      if (before.action.kind === 'Idle' && f.action.kind === 'Idle') walked.push({ tick: n + 1, step: f.position.z - before.position.z, slowed: before.slow !== undefined });
    }
    const unit = fighter.walkSpeed * TICK_SECONDS;
    expect(walked.filter((w) => w.slowed).length).toBeGreaterThan(60);
    for (const w of walked) expect(w.step).toBeCloseTo(w.slowed ? unit * dagger.slowFactor : unit, 6);
    expect(s.fighters[1]!.slow).toBeUndefined();
    // Exactly slowTicks Ticks after the Hit Tick the Slow is gone, and not a Tick sooner.
    const lastSlowed = walked.filter((w) => w.slowed).pop()!;
    expect(lastSlowed.tick).toBe(dagger.slowTicks);
  });

  it('restarts the timer on a second Hit and does not slow further', () => {
    let s = lineup([5], [0, 1]);
    s = { ...s, fighters: s.fighters.map((f, i) => (i === 1 ? { ...f, slow: { ticks: 40 } } : f)) };
    s = tick(withDagger(s, dartAt(s, 1)));
    expect(find(s, 'DaggerHit')).toBeDefined();
    expect(s.fighters[1]!.slow).toEqual({ ticks: dagger.slowTicks });
    // Recovered from the Stagger, it walks at slowFactor, not slowFactor squared.
    for (let n = 0; n < 200 && s.fighters[1]!.action.kind !== 'Idle'; n++) s = tick(s);
    const before = s.fighters[1]!;
    s = tick(s, { 1: walkAway });
    expect(s.fighters[1]!.position.z - before.position.z).toBeCloseTo(fighter.walkSpeed * TICK_SECONDS * dagger.slowFactor, 6);
  });

  it('slows air steering too', () => {
    let s = lineup([5], [0, 1]);
    s = { ...s, fighters: s.fighters.map((f, i) => (i === 1 ? { ...f, y: 3, air: { vx: 0, vz: 0, vy: 0, peakY: 3, ticks: 0, jumped: true }, slow: { ticks: 100 } } : f)) };
    const slowed = tick(s, { 1: { move: { x: 0, z: 1 } } });
    const free = tick({ ...s, fighters: s.fighters.map((f) => ({ ...f, slow: undefined })) }, { 1: { move: { x: 0, z: 1 } } });
    // Steering is capped by airControl either way; a slowed one steers toward 0.6 of the walk speed, so a long fall shows it.
    let a = s;
    let b = { ...s, fighters: s.fighters.map(({ slow: _slow, ...f }) => f) } as SimState;
    for (let n = 0; n < 30; n++) {
      a = tick(a, { 1: { move: { x: 0, z: 1 } } });
      b = tick(b, { 1: { move: { x: 0, z: 1 } } });
    }
    expect(slowed.fighters[1]!.slow!.ticks).toBe(99);
    expect(free.fighters[1]!.slow).toBeUndefined();
    expect(a.fighters[1]!.air?.vz ?? 0).toBeLessThanOrEqual(fighter.walkSpeed * dagger.slowFactor + 1e-9);
    expect(b.fighters[1]!.air?.vz ?? 0).toBeGreaterThan(fighter.walkSpeed * dagger.slowFactor + 1e-6);
  });

  it('wounds a Fighter in Knockdown and slows it without Staggering it', () => {
    let s = lyingWithDagger(false);
    const hp = s.fighters[1]!.hp;
    s = tick(s);
    expect(find(s, 'DaggerHit')).toBeDefined();
    expect(s.fighters[1]!.hp).toBeLessThan(hp);
    expect(s.fighters[1]!.action.kind).toBe('Knockdown');
    expect(s.events.some((e) => e.type === 'Stagger')).toBe(false);
    expect(s.fighters[1]!.slow).toEqual({ ticks: dagger.slowTicks });
  });

  it('can fell a Fighter, with the dagger as the felling blow', () => {
    let s = lineup([5], [0, 1]);
    s = { ...s, fighters: s.fighters.map((f, i) => (i === 1 ? { ...f, hp: 1 } : f)) };
    s = tick(withDagger(s, dartAt(s, 1)));
    const victim = s.fighters[1]!;
    expect(victim.hp).toBe(0);
    expect(victim.death).toMatchObject({ cause: 'Hit' });
    expect(victim.death!.blow).not.toBeNull();
    expect(victim.death!.blow!.from).toEqual({ x: 0, z: 0 });
    expect(victim.death!.blow!.point.z).toBeGreaterThan(0);
    expect(victim.death!.blow!.bladeSpeed).toBeGreaterThan(0);
  });

  it('passes through the thrower and a teammate, and hits the enemy behind', () => {
    const s = lineup([3, 6], [0, 0, 1]);
    const { at } = throwToContact(s);
    expect(at.fighters[1]!.hp).toBe(fighter.maxHp);
    expect(at.fighters[2]!.hp).toBeLessThan(fighter.maxHp);
    expect(find(at, 'DaggerHit')).toMatchObject({ thrower: 0, defender: 2 });
  });

  it('hits the nearer of two enemies in its path, and only that one', () => {
    const s = lineup([4, 6], [0, 1, 1]);
    const { at } = throwToContact(s);
    expect(find(at, 'DaggerHit')).toMatchObject({ defender: 1 });
    expect(at.fighters[2]!.hp).toBe(fighter.maxHp);
    expect(at.daggers).toHaveLength(0);
  });

  it('still hits a Fighter on the Tick it would have stuck in a Wall behind it', () => {
    const walled = { ...flat, walls: [{ id: 'w', a: { x: -5, z: 5.3 }, b: { x: 5, z: 5.3 }, bottom: 0, top: 3 }] };
    const t = { ...tuning, arenas: { ...tuning.arenas, contact: walled } };
    let s = createInitialState(t, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 5 }, facing: 0 }], [], [0, 1], 'contact');
    s = { ...s, daggers: [{ owner: 0, team: 0, thrownAt: 0, position: { x: 0, y: 1.1, z: 4.9 }, velocity: { x: 0, y: 0, z: 18 }, ticks: 3 }] };
    s = step(s, intents(2, {}), t);
    expect(find(s, 'DaggerHit')).toBeDefined();
    expect(s.daggers).toHaveLength(0);
  });
});

describe('Dagger Block', () => {
  // `throwToContact`'s Tick (counted from the throw press) on which the dagger leaves the hand.
  const release = throwTimings(tuning, Object.keys(tuning.weapons)[0]!).windUpEnd + 1;
  // The victim at 6 m faces the thrower and raises a Block `lead` Ticks after the dagger left the hand (negative: before).
  const facingThrower = (lead: number) => (_s: SimState, n: number): Record<number, Partial<Intent>> => ({ 1: { block: n >= release + lead, face: Math.PI } });

  it('Blocks a dagger when the Block was raised on or after it left the hand and the Fighter faces the thrower', () => {
    for (const lead of [0, 3, 8]) {
      const { at, events } = throwToContact(lineup([6], [0, 1], Math.PI), facingThrower(lead));
      expect(events.some((e) => e.type === 'DaggerBlocked' && e.thrower === 0 && e.defender === 1)).toBe(true);
      expect(events.some((e) => e.type === 'DaggerHit')).toBe(false);
      expect(at.fighters[1]!.hp).toBe(fighter.maxHp);
      expect(at.fighters[1]!.slow).toBeUndefined();
      expect(at.fighters[1]!.action.kind).toBe('Block');
      expect(at.fighters[1]!.blockImpact).toBeDefined();
      expect(at.daggers).toHaveLength(0);
    }
  });

  it('gives a lighter Block Impact than a blade does', () => {
    const { at } = throwToContact(lineup([6], [0, 1], Math.PI), facingThrower(0));
    const impact = at.fighters[1]!.blockImpact!;
    expect(impact.tick).toBe(0);
    expect(impact.strength).toBeGreaterThan(0);
    expect(impact.strength).toBeLessThan(0.5);
  });

  it('does not stop a dagger when the Block was raised during the Wind-up, before it left the hand', () => {
    for (const lead of [-1, -10, -release]) {
      const { events } = throwToContact(lineup([6], [0, 1], Math.PI), facingThrower(lead));
      expect(events.some((e) => e.type === 'DaggerBlocked')).toBe(false);
      expect(events.find((e) => e.type === 'DaggerHit')).toMatchObject({ defender: 1 });
    }
  });

  it('does not stop a dagger when the Block was already held before the throw', () => {
    // Block held from Tick -3: the Block is older than the throw's Wind-up.
    let s = lineup([6], [0, 1], Math.PI);
    for (let n = 0; n < 3; n++) s = tick(s, { 1: { block: true, face: Math.PI } });
    const { events } = throwToContact(s, () => ({ 1: { block: true, face: Math.PI } }));
    expect(events.some((e) => e.type === 'DaggerBlocked')).toBe(false);
    expect(events.find((e) => e.type === 'DaggerHit')).toMatchObject({ defender: 1 });
  });

  it('counts a Block let go and raised again from the moment it was raised again', () => {
    // Raised early in the Wind-up, let go on the Tick the dagger leaves the hand, raised again on the next.
    const { events } = throwToContact(lineup([6], [0, 1], Math.PI), (_s, n) => ({ 1: { block: n !== release, face: Math.PI } }));
    expect(events.some((e) => e.type === 'DaggerBlocked')).toBe(true);
  });

  it('does not stop a dagger with the Fighter\'s back to the thrower', () => {
    const { at, events } = throwToContact(lineup([6], [0, 1], 0), (_s, n) => ({ 1: { block: n >= 1, face: 0 } }));
    expect(events.some((e) => e.type === 'DaggerBlocked')).toBe(false);
    expect(find(at, 'DaggerHit')).toBeDefined();
    expect(at.fighters[1]!.hp).toBeLessThan(fighter.maxHp);
  });

  it('does not Block a dagger with a Knockdown guard', () => {
    const s = tick(lyingWithDagger(true));
    expect(find(s, 'DaggerBlocked')).toBeUndefined();
    expect(find(s, 'DaggerHit')).toBeDefined();
  });
});

describe('Dagger determinism', () => {
  it('two runs from the same inputs hash the same', () => {
    const run = () => {
      let s = lineup([5], [0, 1]);
      for (let n = 0; n < 80; n++) s = tick(s, { 0: { throw: n === 0 }, 1: walkAway });
      return s;
    };
    expect(hashState(run())).toBe(hashState(run()));
    expect(run().fighters[1]!.slow).toBeDefined();
  });
});
