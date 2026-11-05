/**
 * docs/plans/big-battle.md, Stage 6: an AI Takeover mid-Battle. See `battle.test.ts` for the setup; this is its slow tier (`npm run test:slow`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inDuel, type MatchState } from '../sim';
import { ROLLBACK_WINDOW, type SessionEvent } from './session';
import { disagreements, expectChecksums, log, offline, peerTuning, startBattle } from './battleHarness';

afterEach(() => vi.restoreAllMocks());

describe('online Battles across an AI Takeover (Stage 6)', () => {
  it('an AI Takeover mid-Battle: every peer agrees on its Tick, the Player is marked away with no Bubble, and the Battle goes on in step', () => {
    const r = startBattle({ teams: [0, 1, 0] });
    const leaver = r.guests[1]!; // Player 2, of Team 0
    const leftIn: { s: MatchState | null } = { s: null };
    r.until(
      () => leaver.gone && r.confirmed() >= (leftIn.s?.tick ?? 0) + 1200,
      (peer) => {
        const s = r.host.session.state;
        if (peer !== r.host || !s || leaver.gone) return;
        // Its Bubble holds enemies (Team 1 Fighters holding Attack Slots nearer it than Player 0): its tab closes.
        const me = s.duel.fighters[2]!;
        const near = (k: number) => Math.hypot(s.duel.fighters[k]!.position.x - me.position.x, s.duel.fighters[k]!.position.z - me.position.z);
        const mine = s.duel.fighters.some((f, k) => f.team === 1 && f.soldier?.role === 'Attack' && inDuel(f) && near(k) < Math.hypot(f.position.x - s.duel.fighters[0]!.position.x, f.position.z - s.duel.fighters[0]!.position.z));
        if (inDuel(me) && mine && s.tick > 300) {
          leaver.session.close();
          leaver.gone = true;
          leftIn.s = s;
        }
      },
    );
    expect(leaver.gone, 'the guest left').toBe(true);

    const left = r.host.events.find((e) => e.type === 'PlayerLeft') as Extract<SessionEvent, { type: 'PlayerLeft' }>;
    expect(left).toMatchObject({ type: 'PlayerLeft', player: 2 });
    expect(r.guests[0]!.events).toContainEqual(left);
    const takeover = { player: 2, from: left.tick };
    expect(takeover.from).toBeGreaterThan(leftIn.s!.tick - ROLLBACK_WINDOW - 1);

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo, [takeover]);
    const remaining = [r.host, r.guests[0]!];
    for (const p of remaining) {
      expect(expectChecksums(`peer ${p.player}`, p, expected.hashes), `peer ${p.player}`).toBeGreaterThan(20);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      expect(p.session.status).toBe('Running');
    }
    expect(disagreements(remaining, expected.trace, upTo)).toEqual([]);

    // Marked away from the Takeover Tick on, on every peer, and not before.
    expect(expected.trace.get(takeover.from - 1)!.players[2]!.away).toBeUndefined();
    for (const p of remaining) for (let t = takeover.from; t <= upTo; t++) expect(p.trace.get(t)!.players[2]!.away, `peer ${p.player} @${t}`).toBe(true);
    // Its Bubble is gone: every Team 1 Fighter that takes an Attack Slot after it (promoted, or Waiting and taking one back) takes it within
    // reach of Player 0, the one Team 0 Player still playing.
    const promote = peerTuning().battle.bubble.promote;
    let after = 0;
    for (let t = takeover.from + 1; t <= upTo; t++) {
      const [was, now] = [expected.trace.get(t - 1)!, expected.trace.get(t)!];
      now.slots.forEach((b, k) => {
        const before = was.slots[k];
        if (!b || b.team !== 1 || b.role !== 'Attack' || (before && before.index === b.index && before.since === b.since && before.role === 'Attack')) return;
        after++;
        const p0 = now.at[0]!;
        expect(Math.hypot(b.x - p0.x, b.z - p0.z), `slot ${k} @${t}`).toBeLessThanOrEqual(promote + 1);
      });
    }
    expect(after, 'Team 1 Fighters took Attack Slots after the Takeover').toBeGreaterThan(0);
    log('Takeover', remaining, upTo, `; Player 2 left on Tick ${takeover.from}, ${after} Attack Slots taken by Team 1 after it`);
  }, 300_000);
});
