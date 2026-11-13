/**
 * A Delver Run online (docs/plans/delver.md, Stage 2 follow-up): two peers over the memory transport (40 ms ± 20 latency) step the same Delver
 * Run through the Rollback session, each Player's Fighter on the Delver pilot, fed the peer's own (possibly predicted) state. Nothing crosses the
 * wire but Intents and the start message: both peers build every Floor from the Run seed and the Floor number. The checksums agree with no resync,
 * and a guest forced to diverge is brought back by a resync of a Delver state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { stepMatch } from '../sim';
import { CHECKSUM_INTERVAL, type SessionEvent } from './session';
import { startRun, type Step } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

/** Three Floors of one Tier, the Fighters' default Tuning Data otherwise. */
const DELVER = { tune: (t: TuningData): TuningData => ({ ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 3 } }) };

describe('a Delver Run over the memory transport', () => {
  it('two peers on the Delver pilot step a few hundred Ticks with equal checksums and no resync', () => {
    const r = startRun({ players: 2, delver: DELVER });
    r.until(() => r.confirmed() >= 400, undefined, 600);
    expect(r.confirmed()).toBeGreaterThanOrEqual(400);
    for (const p of r.peers) {
      expect(p.session.status).toBe('Running');
      expect(p.session.state!.config).toMatchObject({ format: 'Gauntlet', delver: true, humans: 2 });
      expect(p.session.state!.run).toBeNull();
      expect(p.session.state!.delver).toMatchObject({ floor: 1, floors: 3 });
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      expect(p.session.stats.resyncs).toBe(0);
    }
    // The pilots moved: this is not two idle Fighters.
    const [a, b] = r.peers.map((p) => p.session.state!.duel.fighters[p.player]!.position);
    expect([...r.peers[0]!.sent.values()].some((i) => i.move.x !== 0 || i.move.z !== 0)).toBe(true);
    expect(a).not.toEqual(b);
    // Every checksum both peers recorded is the same.
    let compared = 0;
    for (const [tick, sum] of r.host.sums) {
      const other = r.guests[0]!.sums.get(tick);
      if (other === undefined) continue;
      expect(other, `@${tick}`).toBe(sum);
      compared++;
    }
    expect(compared).toBeGreaterThan(400 / CHECKSUM_INTERVAL / 2);
  }, 120_000);

  it('a guest forced to diverge is resynced by the host (a Delver state through the message check) and stays in step', () => {
    // On the guest only: at one Tick, Fighter 0's HP drifts by 1.
    let driftAt: number | null = null;
    const drift: Step = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      driftAt ??= next.tick >= 120 ? next.tick : null;
      if (next.tick !== driftAt) return next;
      return { ...next, duel: { ...next.duel, fighters: next.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: f.hp - 1 } : f)) } };
    };
    const r = startRun({ players: 2, delver: DELVER, step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    r.until(() => guest.events.some((e) => e.type === 'Resynced') && r.confirmed() >= (driftAt ?? 0) + 300, undefined, 900);
    const desync = guest.events.find((e) => e.type === 'Desync') as Extract<SessionEvent, { type: 'Desync' }> | undefined;
    const resynced = guest.events.find((e) => e.type === 'Resynced') as Extract<SessionEvent, { type: 'Resynced' }> | undefined;
    expect(driftAt, 'the guest diverged').not.toBeNull();
    expect(desync, 'the drift was caught').toBeDefined();
    expect(resynced, 'the host sent its state, and the guest took it').toBeDefined();
    expect(guest.events.filter((e) => e.type === 'Desync')).toHaveLength(1);
    expect(r.host.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(guest.session.status).toBe('Running');
    expect(guest.session.state!.delver).toBeDefined();
    // From the resync on, the checksums are the host's again.
    let compared = 0;
    for (const [tick, sum] of r.host.sums) {
      if (tick <= resynced!.tick) continue;
      const other = guest.sums.get(tick);
      if (other === undefined) continue;
      expect(other, `@${tick}`).toBe(sum);
      compared++;
    }
    expect(compared).toBeGreaterThan(5);
  }, 120_000);
});
