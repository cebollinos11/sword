import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createInitialState, hashValue, IDLE_INTENT, step, type FighterState, type Intent, type SimState } from './index';

const tuning: TuningData = loadTuningData();
const { kick } = tuning;

/**
 * The kicker (Fighter 0) at the origin facing +z, its victim (Fighter 1) in front facing it, and a line of Fighters behind the victim
 * along +z, `spacing` apart, each facing the kicker. Teams as given (the kicker's first).
 */
function line(teams: readonly number[], spacing = 0.85): SimState {
  const placements = teams.map((_, i) => (i === 0 ? { position: { x: 0, z: 0 }, facing: 0 } : { position: { x: 0, z: 0.95 + (i - 1) * spacing }, facing: Math.PI }));
  return createInitialState(tuning, 1, placements, [], teams);
}

const intents = (s: SimState, overrides: Record<number, Partial<Intent>>): Intent[] => s.fighters.map((_, i) => ({ ...IDLE_INTENT, ...overrides[i] }));

/**
 * Kick Fighter 1 and have it walk away once the Kick is in Release (a Knockdown); everyone else stands. Runs `after` more Ticks past
 * the contact and returns every state on the way (the contact's first).
 */
function kickDown(s: SimState, after: number, victimWalks = true): SimState[] {
  s = step(s, intents(s, { 0: { kick: true } }), tuning);
  for (let i = 0; i < 200 && !s.events.some((e) => e.type === 'KickLanded'); i++) {
    const a = s.fighters[0]!.action;
    const walk = victimWalks && a.kind === 'Kick' && a.phase === 'Release' ? { move: { x: 0, z: -1 } } : {};
    s = step(s, intents(s, { 1: walk }), tuning);
  }
  if (!s.events.some((e) => e.type === 'KickLanded')) throw new Error('The Kick never landed');
  const states = [s];
  for (let i = 0; i < after; i++) states.push((s = step(s, intents(s, {}), tuning)));
  return states;
}

const isDown = (f: FighterState): boolean => f.action.kind === 'Knockdown';
const chains = (states: readonly SimState[]) => states.flatMap((s) => s.events.flatMap((e) => (e.type === 'ChainKnockdown' ? [e] : [])));

describe('Chain Knockdown', () => {
  it('a kicked-down body knocks down the Fighter it slides into, and that one the next, like dominoes', () => {
    const states = kickDown(line([0, 1, 1, 1]), 90);
    const last = states.at(-1)!;
    expect(isDown(states[0]!.fighters[1]!)).toBe(true);
    const chained = chains(states);
    expect(chained.map((e) => [e.by, e.fighter])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    for (const e of chained) {
      expect(e.source).toBe(0);
      expect(e.damage).toBe(kick.knockdownDamage);
    }
    // Each was down at some point, and took a Kick's Knockdown damage.
    for (const i of [2, 3]) {
      expect(states.some((s) => isDown(s.fighters[i]!))).toBe(true);
      expect(last.fighters[i]!.hp).toBe(tuning.fighter.maxHp - kick.knockdownDamage);
    }
    // The kicker is never touched.
    expect(last.fighters[0]!.hp).toBe(tuning.fighter.maxHp);
  });

  it("knocks down the kicker's own teammates, for no damage", () => {
    const states = kickDown(line([0, 1, 0]), 60);
    expect(chains(states).map((e) => [e.fighter, e.damage])).toEqual([[2, 0]]);
    expect(states.some((s) => isDown(s.fighters[2]!))).toBe(true);
    expect(states.at(-1)!.fighters[2]!.hp).toBe(tuning.fighter.maxHp);
  });

  it('never knocks down the Fighter whose blow started the chain', () => {
    // The victim is kicked down, then the kicker is put right in front of its Slide.
    const [contact] = kickDown(line([0, 1]), 0);
    const victim = contact!.fighters[1]!;
    const ahead = { ...contact!.fighters[0]!, position: { x: 0, z: victim.position.z + 0.75 } };
    let s: SimState = { ...contact!, fighters: [ahead, victim] };
    for (let i = 0; i < 40; i++) {
      s = step(s, intents(s, {}), tuning);
      expect(s.events.some((e) => e.type === 'ChainKnockdown')).toBe(false);
      expect(isDown(s.fighters[0]!)).toBe(false);
    }
  });

  it("a Shove's short push knocks nobody down", () => {
    const states = kickDown(line([0, 1, 1], 0.72), 40, false);
    expect(states[0]!.events.some((e) => e.type === 'KickLanded' && e.outcome === 'Shove')).toBe(true);
    expect(chains(states)).toEqual([]);
    expect(states.some((s) => isDown(s.fighters[2]!))).toBe(false);
  });

  it('the chain ends with the push: the body lying still carries none, and its state hashes without it', () => {
    const states = kickDown(line([0, 1]), kick.knockdownSlideTicks + 5);
    expect(states[0]!.fighters[1]!.knockedBy).toBe(0);
    const still = states.at(-1)!.fighters[1]!;
    expect(isDown(still)).toBe(true);
    expect(still.slide).toBeUndefined();
    expect(still.knockedBy).toBeUndefined();
    expect('knockedBy' in still).toBe(false);
    expect(hashValue(states.at(-1)!)).toBe(hashValue(JSON.parse(JSON.stringify(states.at(-1)!))));
  });
});
