/**
 * ADR 0025: an online Battle with the Input Delay the game gives it. See `battle.test.ts` for the setup; this is its slow tier (`npm run test:slow`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BATTLE_INPUT_DELAY, type SessionEvent } from './session';
import { disagreements, expectChecksums, log, offline, startBattle } from './battleHarness';

afterEach(() => vi.restoreAllMocks());

/** Peers as near as friends on good connections: about 24 ms there and back. */
const NEAR = { latencyMs: 9, jitterMs: 6 };

describe('online Battles with Input Delay (ADR 0025)', () => {
  it('three Players, two a Team: every peer and the offline Battle agree on every Tick across an AI Takeover, and near peers hardly ever roll back', () => {
    const r = startBattle({ teams: [0, 1, 0], inputDelay: BATTLE_INPUT_DELAY, net: NEAR });
    const leaver = r.guests[1]!;
    let leftAt = 0;
    r.until(
      () => leaver.gone && r.confirmed() >= leftAt + 900,
      (peer) => {
        const s = r.host.session.state;
        if (peer !== r.host || !s || leaver.gone) return;
        // Well into the melee, with most of the Pool bound: Player 2's tab closes.
        if (s.tick > 600 && s.duel.fighters.filter((f) => f.soldier).length >= 6) {
          leaver.session.close();
          leaver.gone = true;
          leftAt = s.tick;
        }
      },
    );
    expect(leaver.gone, 'the guest left').toBe(true);
    const left = r.host.events.find((e) => e.type === 'PlayerLeft') as Extract<SessionEvent, { type: 'PlayerLeft' }>;
    expect(left).toMatchObject({ type: 'PlayerLeft', player: 2 });
    // The host held its Intents up to its Input Delay ahead: the AI takes over after the last of them.
    expect(left.tick).toBeGreaterThan(leftAt - 1);
    expect(left.tick).toBeLessThanOrEqual(leftAt + BATTLE_INPUT_DELAY + 1);

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo, [{ player: 2, from: left.tick }]);
    const remaining = [r.host, r.guests[0]!];
    for (const p of remaining) {
      expect(expectChecksums(`peer ${p.player}`, p, expected.hashes), `peer ${p.player}`).toBeGreaterThan(20);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      expect(p.session.status).toBe('Running');
      expect(p.session.stats.stalls).toBe(0);
    }
    expect(disagreements(remaining, expected.trace, upTo)).toEqual([]);

    // The same Battle with no Input Delay rolls back on most Ticks; with it, on few (the start-up hop, the Takeover, a late packet).
    const plain = startBattle({ teams: [0, 1, 0], net: NEAR });
    plain.until(() => plain.confirmed() >= upTo);
    for (const k of [0, 1]) {
      const [delayed, undelayed] = [r.peers[k]!.session.stats, plain.peers[k]!.session.stats];
      expect(undelayed.rollbacks, `peer ${k}, no delay`).toBeGreaterThan(upTo / 4);
      expect(delayed.rollbacks, `peer ${k}`).toBeLessThan(undelayed.rollbacks / 5);
    }
    log('Input Delay', remaining, upTo, `; Player 2 left on Tick ${left.tick}; with no Input Delay: ${plain.peers.map((p) => `${p.session.stats.rollbacks} Rollbacks (deepest ${p.session.stats.maxRollback})`).join(', ')}`);
  }, 300_000);
});
