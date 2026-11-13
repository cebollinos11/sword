/**
 * A Delver Run online, its slow tier (`npm run test:slow`): two peers through the co-op harness, both Players' Fighters on the Delver pilot, go down
 * Floor 1 to its Stairs and into Floor 2 (a Tuning of one Tier of two Floors) with no desync. The numbers it prints are the Rollbacks and Ticks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { CHECKSUM_INTERVAL } from './session';
import { startRun } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

const TWO_FLOORS = (t: TuningData): TuningData => ({ ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 2 } });

describe('a Delver Run over the memory transport, slow', () => {
  it('two Delver pilots go down Floor 1 to Floor 2 (or Victory) with no desync', () => {
    const r = startRun({ players: 2, delver: { tune: TWO_FLOORS } });
    let started: number | null = null;
    const isOver = () => r.host.session.state?.status.status === 'Over';
    r.until(
      () => (started !== null && r.confirmed() >= started + 120) || isOver(),
      () => {
        const s = r.host.session.state;
        if (started === null && s?.delver && s.delver.floor >= 2) started = s.tick;
      },
      20_000,
    );
    const ticks = r.host.session.currentTick;
    const state = r.host.session.state!;
    const rollbacks = r.peers.map((p) => p.session.stats.rollbacks);
    const resyncs = r.peers.map((p) => p.session.stats.resyncs);
    // eslint-disable-next-line no-console
    console.log(`Delver Run, 2 peers: Floor 2 started at Tick ${started}, ${ticks} Ticks simulated, confirmed ${r.confirmed()}, Rollbacks host/guest ${rollbacks.join('/')}, resyncs ${resyncs.join('/')}`);
    expect(started !== null || state.status.status === 'Over', 'reached Floor 2 or Victory').toBe(true);
    for (const p of r.peers) {
      expect(p.session.status).toBe('Running');
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      expect(p.session.stats.resyncs).toBe(0);
    }
    let compared = 0;
    for (const [tick, sum] of r.host.sums) {
      const other = r.guests[0]!.sums.get(tick);
      if (other === undefined) continue;
      expect(other, `@${tick}`).toBe(sum);
      compared++;
    }
    expect(compared).toBeGreaterThan(ticks / CHECKSUM_INTERVAL / 2);
  }, 600_000);
});
