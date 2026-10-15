import { describe, expect, it } from 'vitest';
import { createMatch, IDLE_INTENT, stepMatch, type Intent, type MatchState } from '../sim';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { MatchAnnouncer, type Milestone } from './announcer';

const base = loadTuningData();
// One Overhead decides a Duel (see the Match tests).
const tuning: TuningData = withWeapon(base, { damage: 10000 });

/** Fighter 0 taps Overheads from 1.3 m until the Match ends; returns every Match Tick. */
function playMatch(bestOf: number): MatchState[] {
  let match = createMatch(tuning, { bestOf, distance: 1.3, interDuelTicks: 30 });
  const states = [match];
  for (let t = 0; t < 5000 && match.status.status !== 'Over'; t++) {
    const tap: Intent = { ...IDLE_INTENT, attack: t % 2 === 0 };
    match = stepMatch(match, [tap, IDLE_INTENT], tuning);
    states.push(match);
  }
  return states;
}

function announce(states: readonly MatchState[]): Milestone[] {
  const announcer = new MatchAnnouncer();
  return states.flatMap((s) => announcer.update(s));
}

describe('Match announcements', () => {
  const states = playMatch(3);

  it('announces each Duel start, Duel end and the Match end, once each, in order', () => {
    expect(announce(states)).toEqual([
      { type: 'DuelStart', duelNumber: 1 },
      { type: 'DuelEnd', duelNumber: 1, winner: 0 },
      { type: 'DuelStart', duelNumber: 2 },
      { type: 'DuelEnd', duelNumber: 2, winner: 0 },
      { type: 'MatchEnd', winner: 0, score: [2, 0] },
    ]);
  });

  it('still announces everything when the Ticks carrying the events are skipped (a Rollback re-simulated them)', () => {
    // Only every 7th Tick is seen, so most event Ticks are never presented.
    const sparse = states.filter((_, i) => i % 7 === 0 || i === states.length - 1);
    expect(announce(sparse).map((m) => m.type)).toEqual(['DuelStart', 'DuelEnd', 'DuelStart', 'DuelEnd', 'MatchEnd']);
  });

  it('does not repeat an announcement when the same state is seen again', () => {
    const announcer = new MatchAnnouncer();
    const end = states[states.length - 1]!;
    expect(announcer.update(end).filter((m) => m.type === 'MatchEnd')).toHaveLength(1);
    expect(announcer.update(end)).toEqual([]);
  });
});

describe('Match announcements: a team battle', () => {
  it('announces the watched Fighter falling while its team fights on, once', () => {
    // 1 v 2: Fighter 0 fells one of the two; the other still stands.
    let match = createMatch(tuning, { bestOf: 1, teams: [0, 1, 1], distance: 1.3, spacing: 0.8 });
    const states = [match];
    const fallen = () => match.duel.fighters.findIndex((f) => f.death);
    for (let t = 0; t < 2000 && fallen() < 0; t++) {
      match = stepMatch(match, [{ ...IDLE_INTENT, attack: t % 2 === 0 }], tuning);
      states.push(match);
    }
    expect(match.duel.duel.status).toBe('Fighting');
    for (let t = 0; t < 30; t++) states.push((match = stepMatch(match, [], tuning)));
    const announcer = new MatchAnnouncer();
    const fell = states.flatMap((s) => announcer.update(s, fallen())).filter((m) => m.type === 'Fell');
    expect(fell).toEqual([{ type: 'Fell', duelNumber: 1 }]);
    const other = new MatchAnnouncer();
    expect(states.flatMap((s) => other.update(s, 0)).some((m) => m.type === 'Fell')).toBe(false);
  });
});

describe('Rematch announcements', () => {
  it('announces the rematch afresh: its Duels and its result', () => {
    let match = createMatch(tuning, { bestOf: 1, distance: 1.3, interDuelTicks: 30, rematchTicks: 30 });
    const states = [match];
    for (let t = 0; t < 5000 && !(match.matchNumber === 2 && match.status.status === 'Over'); t++) {
      const tap: Intent = { ...IDLE_INTENT, attack: t % 2 === 0 };
      match = stepMatch(match, [tap, IDLE_INTENT], tuning);
      states.push(match);
    }
    const once = [
      { type: 'DuelStart', duelNumber: 1 },
      { type: 'DuelEnd', duelNumber: 1, winner: 0 },
      { type: 'MatchEnd', winner: 0, score: [1, 0] },
    ];
    expect(announce(states)).toEqual([...once, ...once]);
  });
});
