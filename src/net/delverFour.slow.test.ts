/**
 * A Delver Run online with four Players, its slow tier (`npm run test:slow`; docs/plans/delver.md, Stage 8): four peers through the co-op harness,
 * every Player's Fighter on the Delver pilot, at the Input Delay the game plays an online Delver Run with (`BATTLE_INPUT_DELAY`), play a Run of one
 * Tier of two Floors to its Victory: Floor 1, its Stairs, then Floor 2, the Boss Floor, its Boss Warband wiped and its Stairs taken. The party is
 * kept at max HP each Tick (`withImmortalParty`, a test harness edit made in every peer's Tick function, so a Rollback repeats it): this checks the
 * netcode over a whole Run, not the balance of four pilots against the Warbands. It prints each peer's Rollbacks as the game feels them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { stepMatch, type MatchState } from '../sim';
import { withImmortalParty } from '../play/driver';
import { flatHalls } from '../sim/delver/flat.testdata';
import { BATTLE_INPUT_DELAY, CHECKSUM_INTERVAL } from './session';
import { startRun, type Step } from './coopHarness';

/** The Tick a Match ended on (0 while it is on). */
const endTick = (m: MatchState | null): number => (m?.status.status === 'Over' ? m.status.tick : 0);

afterEach(() => vi.restoreAllMocks());

/**
 * One Tier of two Floors (Floor 2 its Boss Floor), on Stage 7b's Halls (`flatHalls`: on 7c's Floors the pilots' walk outruns the cap, as in
 * `delverCoop.slow.test.ts`), each Floor as long as the first tier's (`tierRooms`, kept), the bundled Warbands otherwise.
 */
const tune = (t0: TuningData): TuningData => {
  const t = flatHalls(t0);
  return { ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 2, ...(t0.delver.tierRooms ? { tierRooms: t0.delver.tierRooms } : {}) } };
};

/** The party at max HP after every Tick. */
const immortal: Step = (m, intents, t) => withImmortalParty(stepMatch(m, intents, t));

/** The most Ticks the Run may take. */
const CAP = 60_000;

const percentile = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const f = (x: number, d = 2) => x.toFixed(d);

/** The distinct nearest Players (flat) of the promoted enemies holding an Attack Slot: how many Players' Bubbles hold an enemy now. */
function bubblesInUse(m: MatchState): number {
  const players = m.config.players ?? [];
  const nearest = new Set<number>();
  m.duel.fighters.forEach((x, i) => {
    if (i < m.config.teams.length || x.soldier?.role !== 'Attack') return;
    let [best, bestD] = [-1, Infinity];
    for (const p of players) {
      const q = m.duel.fighters[p]!;
      const d = (q.position.x - x.position.x) ** 2 + (q.position.z - x.position.z) ** 2;
      if (d < bestD) [best, bestD] = [p, d];
    }
    nearest.add(best);
  });
  return nearest.size;
}

describe('a Delver Run online with four Players, slow', () => {
  it('four Delver pilots at the game’s Input Delay play a Run to its Victory with no desync, and the Rollbacks are measured', () => {
    const wall = Date.now();
    const r = startRun({ players: 4, delver: { tune }, step: () => immortal, inputDelay: BATTLE_INPUT_DELAY, timed: true });
    let floor2: number | null = null;
    let mostBubbles = 0;
    let mostPromoted = 0;
    /** Every peer's Match is over, and every peer has confirmed the Tick it ended on (and the next checksum Tick after it). */
    const done = () => r.peers.every((p) => p.session.state?.status.status === 'Over') && r.confirmed() >= Math.max(...r.peers.map((p) => endTick(p.session.state))) + CHECKSUM_INTERVAL;
    r.until(
      done,
      (peer) => {
        const s = peer.session.state;
        if (peer !== r.host || !s) return;
        if (floor2 === null && s.delver && s.delver.floor >= 2) floor2 = s.tick;
        mostBubbles = Math.max(mostBubbles, bubblesInUse(s));
        mostPromoted = Math.max(mostPromoted, s.duel.fighters.filter((x, i) => i >= s.config.teams.length && x.soldier !== undefined).length);
      },
      CAP,
    );
    const state = r.host.session.state!;

    // The Rollbacks, as `delverCoop.slow.test.ts` measures them: a frame that re-simulated Ticks, costed above a plain frame's median.
    const frames = r.peers.flatMap((p) => p.frames);
    const plain = frames.filter((x) => x.rollbacks === 0 && x.advanced).map((x) => x.ms).sort((a, b) => a - b);
    const base = percentile(plain, 0.5);
    const back = frames.filter((x) => x.rollbacks > 0);
    const ticks = back.map((x) => x.steps - (x.advanced ? 1 : 0)).sort((a, b) => a - b);
    const cost = back.map((x) => Math.max(0, x.ms - base)).sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `\nDelver Run, 4 peers at Input Delay ${BATTLE_INPUT_DELAY}: ${state.status.status === 'Over' ? `over at Tick ${endTick(state)}, winner ${state.status.winner}` : `not over by Tick ${r.host.session.currentTick}`}, Floor 2 at Tick ${floor2}, ` +
        `${f((Date.now() - wall) / 1000, 0)} s wall; most promoted ${mostPromoted}, most Bubbles holding enemies ${mostBubbles}; resyncs ${r.peers.map((p) => p.session.stats.resyncs).join('/')}; ` +
        `${frames.length} frames (all peers), plain frame ${f(base)} ms (median), Rollbacks in ${back.length} (${f((back.length / Math.max(1, frames.length)) * 100, 1)}% of frames); ` +
        `Ticks re-simulated p50 ${percentile(ticks, 0.5)}, p99 ${percentile(ticks, 0.99)}, max ${ticks.at(-1) ?? 0}; ms per Rollback p50 ${f(percentile(cost, 0.5))}, p99 ${f(percentile(cost, 0.99))}, max ${f(cost.at(-1) ?? 0)}\n`,
    );

    // A Victory: Floor 2 (the Boss Floor) entered, the Run over and won by the party.
    expect(floor2, 'reached Floor 2').not.toBeNull();
    expect(state.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(state.delver).toMatchObject({ floor: 2, floors: 2 });
    expect(state.config).toMatchObject({ humans: 4, players: [0, 1, 2, 3] });
    expect(mostPromoted, 'Soldiers were promoted').toBeGreaterThanOrEqual(1);
    expect(mostBubbles, 'two or more Players’ Bubbles held enemies at once').toBeGreaterThanOrEqual(2);

    // Every peer ran it with no Desync and no resync, and all four agree on every checksum they recorded.
    for (const p of r.peers) {
      expect(p.session.status, `peer ${p.player}`).toBe('Running');
      expect(p.events.filter((e) => e.type === 'Desync'), `peer ${p.player}`).toEqual([]);
      expect(p.session.stats.resyncs, `peer ${p.player}`).toBe(0);
      expect(p.session.state!.status).toMatchObject({ status: 'Over', winner: 0 });
    }
    let compared = 0;
    for (const [tick, sum] of r.host.sums) {
      for (const g of r.guests) {
        const other = g.sums.get(tick);
        if (other === undefined) continue;
        expect(other, `peer ${g.player} @${tick}`).toBe(sum);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan((3 * endTick(state)) / CHECKSUM_INTERVAL / 2);
  }, 3_600_000);
});
