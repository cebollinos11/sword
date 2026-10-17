import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import {
  createMatch,
  duelPlacements,
  hashValue,
  IDLE_INTENT,
  restore,
  snapshot,
  stepMatch,
  type Intent,
  type MatchState,
} from './index';

const repoTuning = loadTuningData();
/** One clean Overhead hit decides a Duel. */
const tuning: TuningData = withWeapon(repoTuning, { damage: 10_000 });

const DISTANCE = 1.3; // an Overhead from here hits (see combat.test.ts)

const attackIntent: Intent = { ...IDLE_INTENT, attack: true, direction: 'Overhead' };

type Attacker = number | 'both' | null;
const attackers = (a: Attacker): number[] => (a === null ? [] : a === 'both' ? [0, 1] : [a]);

/**
 * Step the Match until `done` (or fail after `limit` Ticks). Fighter(s) `attacker`
 * tap attack every other Tick; holding it would freeze the Wind-up.
 */
function runUntil(m: MatchState, attacker: Attacker, done: (m: MatchState) => boolean, limit = 2000): MatchState {
  for (let i = 0; i < limit && !done(m); i++) {
    const intents = [IDLE_INTENT, IDLE_INTENT];
    if (m.tick % 2 === 0) for (const a of attackers(attacker)) intents[a] = attackIntent;
    m = stepMatch(m, intents, tuning);
  }
  if (!done(m)) throw new Error('condition never reached');
  return m;
}

const duelOver = (m: MatchState) => m.duel.duel.status === 'Over';
const nextDuelOrEnd = (m: MatchState) => (n: MatchState) => n.duelNumber > m.duelNumber || n.status.status === 'Over';
/** Fighter `winner` takes the current Duel; then wait for the next Duel to start (or the Match to end). */
const winDuel = (m: MatchState, winner: number) => {
  const ended = runUntil(m, winner, duelOver);
  return runUntil(ended, null, nextDuelOrEnd(ended));
};

describe('Match pacing from Tuning Data', () => {
  it('starts every Duel at the Tuning Data distance and pauses the Tuning Data time between Duels', () => {
    const paced: TuningData = { ...tuning, match: { ...tuning.match, duelDistance: 1.3, interDuelSeconds: 0.5 } };
    const gap = (m: MatchState) => Math.abs(m.duel.fighters[1]!.position.z - m.duel.fighters[0]!.position.z);
    const start = createMatch(paced, { arena: 'circle', bestOf: 3 });
    expect(gap(start)).toBeCloseTo(1.3, 9);
    let m = start;
    for (let i = 0; i < 2000 && m.duel.duel.status === 'Fighting'; i++) m = stepMatch(m, [m.tick % 2 === 0 ? attackIntent : IDLE_INTENT, IDLE_INTENT], paced);
    const ended = m.tick;
    for (let i = 0; i < 2000 && m.duelNumber === 1; i++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], paced);
    expect(m.tick - ended).toBe(30); // 0.5 s
    expect(gap(m)).toBeCloseTo(1.3, 9);
  });
});

describe('Match', () => {
  it('starts the first Duel with both Fighters at their starting positions and full HP, score 0–0', () => {
    const m = createMatch(tuning, { arena: 'circle', bestOf: 3, distance: DISTANCE, seed: 7 });
    expect(m.score).toEqual([0, 0]);
    expect(m.duelNumber).toBe(1);
    expect(m.status).toEqual({ status: 'InProgress' });
    expect(m.duel.fighters.map((f) => f.position)).toEqual(duelPlacements(DISTANCE).map((p) => p.position));
    expect(m.duel.fighters.map((f) => f.hp)).toEqual([100, 100]);
  });

  it('resets Fighters to their starting positions, facing and HP between Duels', () => {
    let m = createMatch(tuning, { arena: 'circle', bestOf: 3, distance: DISTANCE, seed: 7, interDuelTicks: 30 });
    m = runUntil(m, 0, duelOver);
    expect(m.duel.fighters[1]!.hp).toBeLessThanOrEqual(0);
    expect(m.score).toEqual([1, 0]);

    // The finished Duel stays visible for the pause, then the next one starts fresh.
    const endedAt = m.tick;
    m = runUntil(m, null, (s) => s.duelNumber === 2);
    expect(m.tick).toBe(endedAt + 30);
    const start = duelPlacements(DISTANCE);
    expect(m.duel.tick).toBe(0);
    expect(m.duel.duel).toEqual({ status: 'Fighting' });
    m.duel.fighters.forEach((f, i) => {
      expect(f.position).toEqual(start[i]!.position);
      expect(f.facing).toBe(start[i]!.facing);
      expect(f.hp).toBe(100);
      expect(f.action).toEqual({ kind: 'Idle' });
    });
    expect(m.score).toEqual([1, 0]);
    expect(m.events).toContainEqual({ type: 'DuelStart', duelNumber: 2 });
  });

  it('ends with the correct winner once a Fighter has won the majority of a best-of-3', () => {
    let m = createMatch(tuning, { arena: 'circle', bestOf: 3, distance: DISTANCE, interDuelTicks: 10 });
    m = winDuel(m, 0);
    expect(m.score).toEqual([1, 0]);
    expect(m.status.status).toBe('InProgress');
    m = winDuel(m, 1);
    expect(m.score).toEqual([1, 1]);
    expect(m.status.status).toBe('InProgress');
    m = runUntil(m, 1, duelOver);
    expect(m.score).toEqual([1, 2]);
    expect(m.status).toMatchObject({ status: 'Over', winner: 1 });
    expect(m.events).toContainEqual({ type: 'MatchEnd', winner: 1, score: [1, 2] });
  });

  it('a 2–0 best-of-3 ends without a third Duel, and no further Duel ever starts', () => {
    let m = createMatch(tuning, { arena: 'circle', bestOf: 3, distance: DISTANCE, interDuelTicks: 10 });
    m = winDuel(winDuel(m, 0), 0);
    expect(m.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(m.duelNumber).toBe(2);
    for (let i = 0; i < 300; i++) m = stepMatch(m, [attackIntent, attackIntent], tuning);
    expect(m.duelNumber).toBe(2);
    expect(m.score).toEqual([2, 0]);
  });

  it('N is configurable: best of 1 ends after one Duel, best of 5 needs three wins', () => {
    const one = runUntil(createMatch(tuning, { arena: 'circle', bestOf: 1, distance: DISTANCE }), 1, duelOver);
    expect(one.status).toMatchObject({ status: 'Over', winner: 1 });

    let five = createMatch(tuning, { arena: 'circle', bestOf: 5, distance: DISTANCE, interDuelTicks: 10 });
    five = winDuel(winDuel(five, 0), 0);
    expect(five.status.status).toBe('InProgress');
    five = winDuel(winDuel(five, 1), 1);
    expect(five.status.status).toBe('InProgress');
    five = winDuel(five, 0);
    expect(five.score).toEqual([3, 2]);
    expect(five.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(five.duelNumber).toBe(5);
  });

  it('rejects a bestOf that is not a positive integer', () => {
    expect(() => createMatch(tuning, { arena: 'circle', bestOf: 0 })).toThrow(RangeError);
    expect(() => createMatch(tuning, { arena: 'circle', bestOf: 2.5 })).toThrow(RangeError);
  });

  it('a drawn Duel scores for nobody and is replayed', () => {
    let m = createMatch(tuning, { arena: 'circle', bestOf: 1, distance: DISTANCE, interDuelTicks: 10 });
    m = runUntil(m, 'both', duelOver);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: null });
    expect(m.score).toEqual([0, 0]);
    m = runUntil(m, null, (s) => s.duelNumber === 2);
    expect(m.status.status).toBe('InProgress');
    expect(m.duel.fighters.map((f) => f.hp)).toEqual([100, 100]);
  });

  it('is deterministic and snapshottable across Duel boundaries', () => {
    const intentsFor = (t: number): Intent[] => [t % 2 === 0 ? attackIntent : IDLE_INTENT, IDLE_INTENT];
    const run = (from: MatchState, fromTick: number, toTick: number) => {
      let m = from;
      for (let t = fromTick; t < toTick; t++) m = stepMatch(m, intentsFor(t), tuning);
      return m;
    };
    const start = createMatch(tuning, { arena: 'circle', bestOf: 3, distance: DISTANCE, interDuelTicks: 20, seed: 3 });
    const full = run(start, 0, 600);
    expect(full.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(hashValue(run(start, 0, 600))).toBe(hashValue(full));

    const mid = run(start, 0, 150);
    expect(mid.duelNumber).toBe(2); // the snapshot straddles a Duel boundary
    const snap = snapshot(mid);
    expect(hashValue(run(restore(snap), 150, 600))).toBe(hashValue(full));
    expect(hashValue(run(restore(snap), 150, 600))).toBe(hashValue(full)); // snapshots are reusable
  });
});

describe('Rematch', () => {
  const overAfterBestOf1 = (rematchTicks?: number) => {
    const m = createMatch(tuning, { arena: 'circle', bestOf: 1, distance: DISTANCE, seed: 7, ...(rematchTicks === undefined ? {} : { rematchTicks }) });
    return runUntil(m, 0, (n) => n.status.status === 'Over');
  };

  it('never restarts by default', () => {
    let m = overAfterBestOf1();
    for (let i = 0; i < 500; i++) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(m.matchNumber).toBe(1);
    expect(m.status.status).toBe('Over');
  });

  it('starts a fresh Match `rematchTicks` after the Match ends: Duel 1, score 0–0, same config, the Match Tick carried on', () => {
    const over = overAfterBestOf1(40);
    const endedAt = over.tick;
    expect(over.score).toEqual([1, 0]);
    let m = over;
    while (m.tick < endedAt + 39) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(m.matchNumber).toBe(1);
    m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(m).toMatchObject({ matchNumber: 2, tick: endedAt + 40, duelNumber: 1, score: [0, 0], status: { status: 'InProgress' }, nextDuelTick: null, config: over.config });
    expect(m.events).toEqual([{ type: 'DuelStart', duelNumber: 1 }]);
    expect(m.duel.fighters.map((f) => f.hp)).toEqual([100, 100]);
    expect(m.duel.fighters.map((f) => f.position)).toEqual(duelPlacements(DISTANCE).map((p) => p.position));
    // ...and the rematch plays out like any Match.
    m = runUntil(m, 1, (n) => n.status.status === 'Over');
    expect(m).toMatchObject({ matchNumber: 2, score: [0, 1], status: { status: 'Over', winner: 1 } });
  });

  it('rejects a rematch pause below one Tick', () => {
    expect(() => createMatch(tuning, { arena: 'circle', bestOf: 1, rematchTicks: 0 })).toThrow(/rematchTicks/);
  });
});
