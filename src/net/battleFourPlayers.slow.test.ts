/**
 * docs/plans/big-battle.md, Stage 6: a Battle with four Players, two a Team. See `battle.test.ts` for the setup; this is its slow tier (`npm run test:slow`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECKSUM_INTERVAL } from './session';
import { attackedTeam, disagreements, expectChecksums, log, offline, startBattle } from './battleHarness';

afterEach(() => vi.restoreAllMocks());

describe('online Battles over the memory transport (Stage 6): four Players', () => {
  it('four Players, two a Team: every peer and the offline Battle agree on every Tick while the four Bubbles share the Pool', () => {
    const r = startBattle({ teams: [0, 1, 0, 1] });
    r.until(() => r.confirmed() >= 1500);
    for (const p of r.peers) expect(p.session.status).toBe('Running');

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo);
    r.peers.forEach((p, k) => expect(expectChecksums(`peer ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2));
    for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);

    // Four Bubbles in use with Soldiers promoted round both Teams' Players, and the Pool busy.
    const busy = [...expected.trace.values()].filter((s) => s.inPlay.slice(0, 4).every(Boolean) && s.slots.filter(Boolean).length >= 8);
    expect(busy.length).toBeGreaterThan(60);
    expect(attackedTeam(expected.trace, 0)).toBe(true);
    expect(attackedTeam(expected.trace, 1)).toBe(true);
    for (const p of r.peers) expect(p.session.stats.maxRollback).toBeGreaterThan(0);
    log('Four Players', r.peers, upTo, `; ${busy.length} Ticks with four Bubbles and 8 or more slots bound`);
  }, 300_000);
});
