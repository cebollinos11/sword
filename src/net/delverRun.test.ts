/**
 * A Delver Run online (docs/plans/delver.md, Stage 2 follow-up; with Warbands, Stage 3): two peers over the memory transport (40 ms ± 20 latency) step the same Delver
 * Run through the Rollback session, each Player's Fighter on the Delver pilot, fed the peer's own (possibly predicted) state. Nothing crosses the
 * wire but Intents and the start message: both peers build every Floor from the Run seed and the Floor number. The checksums agree with no resync,
 * and a guest forced to diverge is brought back by a resync of a Delver state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { stepMatch, type MatchState } from '../sim';
import { CHECKSUM_INTERVAL, type SessionEvent } from './session';
import { startRun, type Step } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

/** Three Floors of one Tier, the Fighters' default Tuning Data otherwise. */
const DELVER = { tune: (t: TuningData): TuningData => ({ ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 3 } }) };

/** The Tick the party is set down beside the first Warband (the same edit on every peer, so a Rollback over it repeats it). */
const SET_DOWN = 2;
/** The party's Fighters stood 3 m from the first Warband's first Soldier: its Bubble promotes the Soldiers about it within a few Ticks. */
const nearWarband: Step = (m, intents, t) => {
  const next = stepMatch(m, intents, t);
  const crowd = next.duel.crowd;
  if (next.tick !== SET_DOWN || !crowd || crowd.x.length === 0) return next;
  const party = next.config.teams.length;
  return { ...next, duel: { ...next.duel, fighters: next.duel.fighters.map((f, i) => (i < party ? { ...f, position: { x: crowd.x[0]! - 3, z: crowd.z[0]! } } : f)) } };
};
const both = (): Step => nearWarband;

/** The Pool slots past the party that hold a Soldier (a Promotion's Fighters). */
const promoted = (m: MatchState | null): number => (m ? m.duel.fighters.filter((f, i) => i >= m.config.teams.length && f.soldier !== undefined).length : 0);

describe('a Delver Run over the memory transport', () => {
  it('two peers on the Delver pilot step a Floor of Warbands for a few hundred Ticks with equal checksums, no resync and a Promotion', () => {
    const r = startRun({ players: 2, delver: DELVER, step: both });
    let mostPromoted = 0;
    r.until(() => r.confirmed() >= 400, () => (mostPromoted = Math.max(mostPromoted, promoted(r.host.session.state))), 600);
    expect(r.confirmed()).toBeGreaterThanOrEqual(400);
    // Warbands stand on the Floor, in a Pool past the party, and a Warband was promoted into it.
    const state = r.host.session.state!;
    expect(state.duel.crowd?.warbands?.mode.length, 'Warbands').toBeGreaterThan(1);
    expect(state.duel.fighters.length).toBeGreaterThan(state.config.teams.length);
    expect(state.config.teams).toEqual([0, 0]);
    expect(mostPromoted, 'a Promotion happened').toBeGreaterThanOrEqual(1);
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
      const next = nearWarband(m, intents, t);
      driftAt ??= next.tick >= 120 ? next.tick : null;
      if (next.tick !== driftAt) return next;
      return { ...next, duel: { ...next.duel, fighters: next.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: f.hp - 1 } : f)) } };
    };
    const r = startRun({ players: 2, delver: DELVER, step: (k) => (k === 1 ? drift : nearWarband) });
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
