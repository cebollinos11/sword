import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type ArenaGeometry, type TuningData } from '../tuning';
import { advanceSlide, startSlide } from './slide';
import { createInitialState, kickTimings, hashValue, IDLE_INTENT, step, TICK_SECONDS, type Intent, type Placement, type SimState } from './index';
import type { Slide } from './state';

const repo = loadTuningData();
const PLATFORM: ArenaGeometry = parseArena(
  {
    name: 'edge',
    walk: [
      { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
      { id: 'WALK_platform', points: [[2, 2, 6], [6, 2, 6], [6, 2, 10], [2, 2, 10]] },
    ],
    walls: [],
  },
  'edge',
);
const tuning: TuningData = { ...repo, arenas: { ...repo.arenas, edge: PLATFORM } };
const { kick } = tuning;

/** Kicker (Fighter 0) at the origin facing +z, a victim (Fighter 1) a little over a body-width in front, facing it. */
const GAP = 0.95;
const facing = (z = GAP, teams: number[] = [0, 1]): SimState =>
  createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z }, facing: Math.PI }], [], teams);

const intents = (a: Partial<Intent>, b: Partial<Intent>): Intent[] => [{ ...IDLE_INTENT, ...a }, { ...IDLE_INTENT, ...b }];
const tick = (s: SimState, a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState => step(s, intents(a, b), tuning);
const landedAt = (s: SimState): boolean => s.events.some((e) => e.type === 'KickLanded');

/** Press kick and run, the victim giving `victim` as its Intent, until the Kick lands. Returns the state on the contact Tick. */
function runToContact(s: SimState, victim: (before: SimState) => Partial<Intent> = () => ({})): SimState {
  s = tick(s, { kick: true }, victim(s));
  for (let i = 0; i < 200 && !landedAt(s); i++) s = tick(s, {}, victim(s));
  if (!landedAt(s)) throw new Error('The Kick never landed');
  return s;
}
const run = (s: SimState, n: number, a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, a, b);
  return s;
};
const slid = (from: SimState, to: SimState, i = 1): number =>
  Math.hypot(to.fighters[i]!.position.x - from.fighters[i]!.position.x, to.fighters[i]!.position.z - from.fighters[i]!.position.z);
const SETTLED = 40;
/** A victim that gives its movement Intent only once the Kick is in Release, so it is still in reach when the leg arrives. */
const moveInRelease = (move: { x: number; z: number }) => (s: SimState): Partial<Intent> => {
  const a = s.fighters[0]!.action;
  return a.kind === 'Kick' && a.phase === 'Release' ? { move } : {};
};

describe('Slide', () => {
  it('covers exactly its distance over its Ticks, decelerating', () => {
    let slide: Slide | undefined = startSlide(1, 0, 2.5, 12);
    let x = 0;
    const speeds: number[] = [];
    while (slide) {
      const { delta, next }: { delta: { x: number }; next: Slide | undefined } = advanceSlide(slide);
      speeds.push(delta.x / TICK_SECONDS);
      x += delta.x;
      slide = next;
    }
    expect(speeds).toHaveLength(12);
    expect(x).toBeCloseTo(2.5, 9);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
  });
});

describe('Kick contact: Shove', () => {
  it('shoves an Idle victim: 1 hp, about 0.3 m, its Action untouched', () => {
    const at = runToContact(facing());
    const victim = at.fighters[1]!;
    expect(victim.hp).toBe(tuning.fighter.maxHp - kick.shoveDamage);
    expect(victim.action.kind).toBe('Idle');
    expect(at.events.find((e) => e.type === 'KickLanded')).toMatchObject({ attacker: 0, defender: 1, outcome: 'Shove', damage: kick.shoveDamage });
    const end = run(at, SETTLED);
    expect(slid(at, end)).toBeCloseTo(kick.shoveSlide, 2);
    expect(end.fighters[1]!.position.z).toBeGreaterThan(at.fighters[1]!.position.z);
    expect(end.fighters[1]!.slide).toBeUndefined();
  });

  it('shoves a Blocking victim: the Block is ignored and carries on', () => {
    const at = runToContact(facing(), () => ({ block: true, direction: 'Overhead' }));
    expect(at.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.shoveDamage);
    expect(at.fighters[1]!.action.kind).toBe('Block');
    expect(run(at, 3, {}, { block: true }).fighters[1]!.action.kind).toBe('Block');
  });

  it('shoves an Attacking victim without interrupting the swing, which can still hit the kicker', () => {
    // The victim winds up Overhead from the start and lets go once it has been kicked.
    const wind = { attack: true, direction: 'Overhead' } as const;
    let s = tick(facing(), { kick: true }, wind);
    while (!landedAt(s)) s = tick(s, {}, wind);
    expect(s.fighters[1]!.action.kind).toBe('Attack');
    expect(s.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.shoveDamage);
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      s = tick(s, {}, { attack: false, direction: 'Overhead' });
      hit = s.events.some((e) => e.type === 'Hit' && e.attacker === 1 && e.defender === 0);
    }
    expect(hit).toBe(true);
    expect(s.fighters[0]!.hp).toBeLessThan(tuning.fighter.maxHp);
  });

  it('a Kick that landed does not whiff', () => {
    const at = runToContact(facing());
    expect(at.fighters[0]!.action).toMatchObject({ kind: 'Kick', landed: true });
    let s = at;
    while (s.fighters[0]!.action.kind === 'Kick') s = tick(s);
    // The Kick pressed on Tick 1 is over after `end` Ticks, with none of the whiff hold added.
    expect(s.tick).toBeLessThanOrEqual(kickTimings(tuning, Object.keys(tuning.weapons)[0]!).end + 1);
  });
});

describe('Kick contact: Knockdown push', () => {
  it('slides a walking victim 2.5 m for 5 hp', () => {
    const at = runToContact(facing(), () => ({ move: { x: 0, z: -1 } }));
    expect(at.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.knockdownDamage);
    expect(at.events.find((e) => e.type === 'KickLanded')).toMatchObject({ outcome: 'Knockdown', damage: kick.knockdownDamage });
    expect(slid(at, run(at, SETTLED))).toBeCloseTo(kick.knockdownSlide, 2);
  });

  it('counts strafing as movement', () => {
    const at = runToContact(facing(), moveInRelease({ x: 0.05, z: 0 }));
    expect(at.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.knockdownDamage);
  });

  it('gives a teammate the push but no damage', () => {
    const at = runToContact(facing(GAP, [0, 0]), () => ({ move: { x: 0, z: -1 } }));
    expect(at.fighters[1]!.hp).toBe(tuning.fighter.maxHp);
    expect(at.events.find((e) => e.type === 'KickLanded')).toMatchObject({ outcome: 'Knockdown', damage: 0 });
    expect(slid(at, run(at, SETTLED))).toBeCloseTo(kick.knockdownSlide, 2);
  });

  it('can fell a Fighter: a Death with no blow', () => {
    const s = facing();
    const weak = { ...s, fighters: [s.fighters[0]!, { ...s.fighters[1]!, hp: 1 }] };
    const at = runToContact(weak);
    expect(at.fighters[1]!.hp).toBe(0);
    expect(at.fighters[1]!.death).toMatchObject({ cause: 'Hit', blow: null });
  });
});

describe('Kick contact: the sweep', () => {
  it('lands only once', () => {
    let s = runToContact(facing());
    let landings = 1;
    while (s.fighters[0]!.action.kind === 'Kick') {
      s = tick(s);
      landings += s.events.filter((e) => e.type === 'KickLanded').length;
    }
    expect(landings).toBe(1);
    expect(s.fighters[1]!.hp).toBe(tuning.fighter.maxHp - kick.shoveDamage);
  });

  it('misses a victim out of reach', () => {
    let s = tick(facing(2.5), { kick: true });
    let landed = false;
    while (s.fighters[0]!.action.kind === 'Kick') {
      s = tick(s);
      landed ||= landedAt(s);
    }
    expect(landed).toBe(false);
    expect(s.fighters[1]!.hp).toBe(tuning.fighter.maxHp);
  });

  it('ignores a Block that would stop a blade', () => {
    const at = runToContact(facing(), () => ({ block: true, direction: 'Thrust' }));
    expect(at.events.some((e) => e.type === 'Block')).toBe(false);
    expect(at.fighters[0]!.action.kind).toBe('Kick');
  });
});

describe('Kick contact: ledges', () => {
  it('a Slide off a ledge goes airborne, carrying the push', () => {
    // On the platform's east edge (x = 6), the kicker facing +x, the victim in front of it, close to the edge.
    const place: Placement[] = [
      { position: { x: 4.7, z: 8 }, facing: Math.PI / 2, y: 2 },
      { position: { x: 5.65, z: 8 }, facing: -Math.PI / 2, y: 2 },
    ];
    const s = createInitialState(tuning, 1, place, [], [], 'edge');
    expect(s.fighters[1]!.y).toBe(2);
    let after = runToContact(s, moveInRelease({ x: 0, z: 1 }));
    let flew = false;
    for (let i = 0; i < 40 && !flew; i++) {
      after = tick(after);
      flew = after.fighters[1]!.air !== undefined;
    }
    expect(flew).toBe(true);
    expect(after.fighters[1]!.air!.vx).toBeGreaterThan(0);
  });
});

describe('Kick contact: determinism', () => {
  it('is deterministic', () => {
    const go = () => run(runToContact(facing(), () => ({ move: { x: 0, z: -1 } })), 60);
    expect(hashValue(go())).toBe(hashValue(go()));
  });
});
