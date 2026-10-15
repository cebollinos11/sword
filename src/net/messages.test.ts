import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, IDLE_INTENT, stepMatch, type MatchState } from '../sim';
import { parseNetMessage } from './messages';

const tuning = loadTuningData();

/** A real, mid-Duel Match state, as a host would send it in a resync. */
function matchState(): MatchState {
  let m = createMatch(tuning, { bestOf: 3, distance: 1.3, seed: 3 });
  for (let t = 0; t < 40; t++) m = stepMatch(m, [{ ...IDLE_INTENT, attack: t === 0 }, IDLE_INTENT], tuning);
  return JSON.parse(JSON.stringify(m)) as MatchState;
}

const resync = (state: unknown) => ({ type: 'resync', tick: 40, state, intentsFrom: 38, intents: [IDLE_INTENT, IDLE_INTENT, IDLE_INTENT] });

describe('Peer message validation', () => {
  it('accepts well-formed messages of every type', () => {
    const valid = [
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234' },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', match: { bestOf: 3, distance: 2, interDuelTicks: 60, seed: 9 } },
      { type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 'Halberd', match: { bestOf: 3, weapons: ['Halberd', 'Longsword'] } },
      { type: 'refuse', reason: 'TuningDataMismatch', tuningHash: 'abcd1234' },
      { type: 'intents', from: 1, intents: [IDLE_INTENT, { ...IDLE_INTENT, move: { x: 1, z: 0 }, direction: 'Left', attack: true, face: 1.5 }], ack: 0 },
      { type: 'checksum', tick: 30, hash: 'abcd1234' },
      { type: 'resyncRequest', tick: 30 },
      resync(matchState()),
    ];
    for (const m of valid) expect(parseNetMessage(m), JSON.stringify(m).slice(0, 80)).toEqual(m);
  });

  it('refuses a hello whose Match options are malformed', () => {
    for (const match of [{}, { bestOf: 0 }, { bestOf: 2.5 }, { bestOf: 3, distance: 'far' }, { bestOf: 3, interDuelTicks: 0 }, { bestOf: 3, seed: 'x' }, { bestOf: 3, weapons: ['Halberd'] }, { bestOf: 3, weapons: [1, 2] }]) {
      expect(parseNetMessage({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match })).toBeNull();
    }
    expect(parseNetMessage({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', weapon: 7 })).toBeNull();
  });

  it('refuses a resync whose Match state is malformed', () => {
    const good = matchState();
    const fighter = good.duel.fighters[0]!;
    const withFighter = (f: unknown) => ({ ...good, duel: { ...good.duel, fighters: [f, good.duel.fighters[1]] } });
    const broken: unknown[] = [
      {},
      null,
      { ...good, tick: 'late' },
      { ...good, score: [1] },
      { ...good, config: { ...good.config, bestOf: -1 } },
      { ...good, config: { ...good.config, weapons: undefined } },
      { ...good, config: { ...good.config, weapons: ['Halberd'] } },
      { ...good, status: { status: 'Paused' } },
      { ...good, duel: { ...good.duel, fighters: [fighter] } },
      { ...good, duel: { ...good.duel, rng: {} } },
      { ...good, duel: { ...good.duel, duel: { status: 'Over' } } },
      withFighter({ ...fighter, hp: '100' }),
      withFighter({ ...fighter, weapon: undefined }),
      withFighter({ ...fighter, position: { x: 0 } }),
      withFighter({ ...fighter, action: { kind: 'Dance' } }),
      withFighter({ ...fighter, action: { kind: 'Attack', direction: 'Overhead', phase: 'Twirl', landed: false } }),
      withFighter({ ...fighter, action: { kind: 'Stagger', cause: 'Tired' } }),
      withFighter({ ...fighter, motion: { name: 'Idle', tick: -1 } }),
      withFighter({ ...fighter, blade: { hilt: { x: 0, y: 0, z: 0 } } }),
      withFighter({ ...fighter, gait: undefined }),
      withFighter({ ...fighter, gait: { left: fighter.gait.left } }),
      withFighter({ ...fighter, gait: { ...fighter.gait, left: { planted: { x: 0 }, step: null } } }),
      withFighter({ ...fighter, gait: { ...fighter.gait, right: { planted: { x: 0, z: 0 }, step: { tick: -1, target: { x: 0, z: 0 } } } } }),
      withFighter({ ...fighter, gait: { ...fighter.gait, right: { planted: { x: 0, z: 0 }, step: { tick: 2, target: 'there' } } } }),
    ];
    for (const state of broken) expect(parseNetMessage(resync(state)), JSON.stringify(state)?.slice(0, 120)).toBeNull();
    expect(parseNetMessage({ ...resync(good), intents: [{}] })).toBeNull();
  });
});
