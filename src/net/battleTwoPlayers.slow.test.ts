/**
 * docs/plans/big-battle.md, Stage 6: a whole Battle between two Players, one a Team. See `battle.test.ts` for the setup; this is its slow tier (`npm run test:slow`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECKSUM_INTERVAL } from './session';
import { attackedTeam, eventTicks, expectChecksums, disagreements, log, offline, startBattle } from './battleHarness';

afterEach(() => vi.restoreAllMocks());

describe('online Battles over the memory transport (Stage 6): two Players', () => {
  it('two Players, one a Team, play a whole Battle: every peer and the offline Battle agree on every Tick, the Crowd and the Pool included, and it ends on the same Tick', () => {
    const r = startBattle({ teams: [0, 1] });
    let end: number | null = null;
    r.until(
      () => end !== null && r.confirmed() >= end + 30,
      (peer) => {
        if (end === null && peer === r.host && peer.session.state?.status.status === 'Over') end = peer.session.state.status.tick;
      },
    );
    expect(end, 'the Battle ended').not.toBeNull();
    for (const p of r.peers) expect(p.session.status).toBe('Running');

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo);
    expect(expected.state.status.status).toBe('Over');
    r.peers.forEach((p, k) => expect(expectChecksums(`peer ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2));
    for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);

    // The Battle's Rout and end, once, on the same Tick everywhere; both Bubbles promoted enemies; and Rollbacks re-simulated across all of it.
    const ends = eventTicks(expected.trace, 'BattleEnd');
    expect(ends).toHaveLength(1);
    expect(eventTicks(expected.trace, 'Rout')).toHaveLength(1);
    for (const p of r.peers) expect(eventTicks(p.trace, 'BattleEnd').filter((t) => t <= upTo)).toEqual(ends);
    expect(attackedTeam(expected.trace, 0)).toBe(true);
    expect(attackedTeam(expected.trace, 1)).toBe(true);
    for (const p of r.peers) expect(p.session.stats.rollbacks).toBeGreaterThan(10);
    log('Two Players', r.peers, upTo, `; the Battle ended on Tick ${ends[0]}`);
  }, 300_000);
});
