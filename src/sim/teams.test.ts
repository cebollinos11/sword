import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import {
  createInitialState,
  createMatch,
  duelPlacements,
  IDLE_INTENT,
  step,
  stepMatch,
  teamMembers,
  teamPlacements,
  type Intent,
  type MatchState,
  type Placement,
  type SimState,
} from './index';

/** One clean Overhead hit fells a Fighter. */
const tuning: TuningData = withWeapon(loadTuningData(), { damage: 10_000 });
const attackIntent: Intent = { ...IDLE_INTENT, attack: true, direction: 'Overhead' };

/** Fighters 0 and 1 face each other close enough to hit; Fighter 2 stands well out of reach. */
const CLOSE: Placement[] = [...duelPlacements(1.3), { position: { x: 5, z: 5 }, facing: 0 }];

/** Fighter 0 taps Overhead (everyone else Idle) until `done`, for at most 2000 Ticks. */
function tapUntil(s: SimState, done: (s: SimState) => boolean): SimState {
  for (let i = 0; i < 2000 && !done(s); i++) s = step(s, [i % 2 === 0 ? attackIntent : IDLE_INTENT], tuning);
  if (!done(s)) throw new Error('never happened');
  return s;
}

describe('Team placements', () => {
  it('puts one Fighter a side exactly where a Duel does', () => {
    expect(teamPlacements([0, 1], 2, 1.5)).toEqual(duelPlacements(2));
  });

  it('lines each team up side by side, the two lines facing each other', () => {
    const p = teamPlacements([0, 1, 1, 0, 1], 2, 1.5);
    // Team 0: Fighters 0 and 3, at -z facing +z, 1.5 m apart and centred.
    expect(p[0]).toEqual({ position: { x: -0.75, z: -1 }, facing: 0 });
    expect(p[3]).toEqual({ position: { x: 0.75, z: -1 }, facing: 0 });
    // Team 1: Fighters 1, 2 and 4, at +z facing -z.
    expect([p[1], p[2], p[4]].map((q) => q!.position.z)).toEqual([1, 1, 1]);
    expect([p[1], p[2], p[4]].map((q) => q!.facing)).toEqual([Math.PI, Math.PI, Math.PI]);
    expect([p[1], p[2], p[4]].map((q) => q!.position.x).sort((a, b) => a - b)).toEqual([-1.5, 0, 1.5]);
  });
});

describe('Teammates', () => {
  it('Stagger each other with a Hit but deal no damage', () => {
    const s = tapUntil(createInitialState(tuning, 1, CLOSE, [], [0, 0, 1]), (s) => s.events.some((e) => e.type === 'Hit'));
    const hit = s.events.find((e) => e.type === 'Hit')!;
    expect(hit).toMatchObject({ attacker: 0, defender: 1, damage: 0 });
    expect(s.fighters[1]!.hp).toBe(tuning.fighter.maxHp);
    expect(s.fighters[1]!.action).toEqual({ kind: 'Stagger', cause: 'Hit' });
    expect(s.duel.status).toBe('Fighting');
  });
});

describe('A Fighter falling while its team fights on', () => {
  const felled = () => tapUntil(createInitialState(tuning, 1, CLOSE, [], [0, 1, 1]), (s) => s.fighters[1]!.hp <= 0);

  it('falls on the Tick its HP reaches zero, and the Duel goes on', () => {
    const s = felled();
    expect(s.fighters[1]!.death?.tick).toBe(s.tick);
    expect(s.fighters[1]!.death?.blow?.direction).toBe('Overhead');
    expect(s.duel.status).toBe('Fighting');
  });

  it('is no longer simulated, hit, or in anyone\'s way', () => {
    const s = felled();
    let later = s;
    // Fighter 0 keeps swinging and walks over where Fighter 1 lies.
    for (let i = 0; i < 120; i++) later = step(later, [i % 2 === 0 ? { ...attackIntent, move: { x: 0, z: 1 } } : { ...IDLE_INTENT, move: { x: 0, z: 1 } }], tuning);
    expect(later.fighters[1]).toEqual(s.fighters[1]);
    expect(later.fighters[0]!.position.z).toBeGreaterThan(s.fighters[1]!.position.z);
  });

  it('ends the Duel when the last of its team falls: the other team wins', () => {
    const placements: Placement[] = [...duelPlacements(1.3), { position: { x: 0, z: 0.65 }, facing: Math.PI }];
    // Fighter 2 stands where Fighter 1 does: once Fighter 1 falls, the bodies no longer push and Fighter 2 is next.
    let s = createInitialState(tuning, 1, [placements[0]!, placements[1]!, { position: { x: 0, z: 2.5 }, facing: Math.PI }], [], [0, 1, 1]);
    s = tapUntil(s, (s) => s.fighters[1]!.hp <= 0);
    expect(s.duel.status).toBe('Fighting');
    // Fighter 2 walks into reach of Fighter 0's swings.
    for (let i = 0; i < 2000 && s.duel.status === 'Fighting'; i++) s = step(s, [i % 2 === 0 ? attackIntent : IDLE_INTENT, IDLE_INTENT, { ...IDLE_INTENT, move: { x: 0, z: -1 } }], tuning);
    expect(s.duel).toEqual({ status: 'Over', winner: 0, tick: s.tick });
    expect(s.events).toContainEqual({ type: 'DuelEnd', winner: 0 });
    expect(s.fighters[2]!.death?.tick).toBe(s.tick);
  });
});

describe('A team Match', () => {
  it('fields the lineup in facing lines, scored per team', () => {
    const m = createMatch(tuning, { arena: 'circle', bestOf: 3, teams: [0, 1, 1, 0, 1], weapons: ['Longsword'] });
    expect(m.score).toEqual([0, 0]);
    expect(m.duel.fighters.map((f) => f.team)).toEqual([0, 1, 1, 0, 1]);
    expect(m.config.weapons).toEqual(['Longsword', 'Arming Sword', 'Arming Sword', 'Arming Sword', 'Arming Sword']);
    expect(teamMembers(m, 1)).toEqual([1, 2, 4]);
    expect(m.duel.fighters.map((f) => f.position)).toEqual(teamPlacements([0, 1, 1, 0, 1], 2, 1.5).map((p) => p.position));
  });

  it('refuses a team with no Fighters or more than three', () => {
    expect(() => createMatch(tuning, { arena: 'circle', bestOf: 1, teams: [0, 0] })).toThrow(/Team 1/);
    expect(() => createMatch(tuning, { arena: 'circle', bestOf: 1, teams: [0, 0, 0, 0, 1] })).toThrow(/Team 0/);
    expect(() => createMatch(tuning, { arena: 'circle', bestOf: 1, teams: [0, 2] })).toThrow(/0 or 1/);
  });

  it('scores a Duel for the team left standing', () => {
    // 2 v 1: Fighter 0 (team 0, left in its line) turns to fell Fighter 1, the lone Fighter of team 1.
    let m: MatchState = createMatch(tuning, { arena: 'circle', bestOf: 3, teams: [0, 1, 0], distance: 1.2, spacing: 0.8 });
    const [me, foe] = [m.duel.fighters[0]!.position, m.duel.fighters[1]!.position];
    const face = Math.atan2(foe.x - me.x, foe.z - me.z);
    for (let i = 0; i < 2000 && m.duel.duel.status === 'Fighting'; i++) m = stepMatch(m, [{ ...(i % 2 === 0 ? attackIntent : IDLE_INTENT), face }], tuning);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 0 });
    expect(m.score).toEqual([1, 0]);
  });
});
