import { describe, expect, it } from 'vitest';
import { createMatch, IDLE_INTENT, stepMatch, type Intent, type MatchState } from '../sim';
import { loadTuningData, type TuningData } from '../tuning';
import { MatchAnnouncer, type Milestone } from './announcer';

const base = loadTuningData();
// One Overhead decides a Duel (see the Match tests).
const tuning: TuningData = { ...base, weapon: { ...base.weapon, damage: 10000 } };

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
