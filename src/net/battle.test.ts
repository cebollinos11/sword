/**
 * docs/plans/big-battle.md, Stage 6: online Battles over the memory transport (40 ms ± 20 latency). Each peer drives its own Player with a
 * Hard Battle autopilot fed its own (possibly predicted) state; what it sends is ordinary Intents, recorded as sent, so the very same
 * Battle steps offline. Every other Pool slot is a Pool AI, on every peer.
 *
 * Every peer's Tick function is wrapped to note the hash of the Match each Tick leaves (the last version simulated of a Tick is the true
 * one once that Tick is confirmed), so the peers are compared Tick by Tick, Crowd and Pool and all, and not only every CHECKSUM_INTERVAL.
 * The armies are small and close (60 a side, 10 m out), so a Battle is short.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disagreements, expectChecksums, log, offline, startBattle, type Step } from './battleHarness';
import { inDuel, stepMatch } from '../sim';
import type { SessionEvent } from './session';

afterEach(() => vi.restoreAllMocks());

describe('online Battles across a resync and an AI Takeover (Stage 6)', () => {
  it('a guest forced to diverge mid-Battle, in the Crowd and in a bound Pool slot, resyncs to the host (Crowd and Pool AI memory) and stays in step', () => {
    // On the guest only: once several Pool slots are bound, a Soldier in the Crowd loses HP and a promoted Fighter is moved.
    let driftAt: number | null = null;
    const drift: Step = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (driftAt === null && next.tick > 300 && next.duel.fighters.filter((f) => f.soldier && inDuel(f)).length >= 3) driftAt = next.tick + 10;
      if (next.tick !== driftAt) return next;
      const crowd = next.duel.crowd!;
      const s = crowd.alive.findIndex((a, i) => a === 1 && crowd.slot[i] === -1);
      const k = next.duel.fighters.findIndex((f) => f.soldier && inDuel(f));
      const fighters = next.duel.fighters.map((f, i) => (i === k ? { ...f, position: { x: f.position.x + 0.5, z: f.position.z } } : f));
      return { ...next, duel: { ...next.duel, fighters, crowd: { ...crowd, hp: crowd.hp.map((h, i) => (i === s ? h - 7 : h)) } } };
    };
    const r = startBattle({ teams: [0, 1], step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    r.until(() => driftAt !== null && r.confirmed() >= driftAt + 600);
    expect(driftAt, 'the guest diverged').not.toBeNull();

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo);
    const desync = guest.events.find((e) => e.type === 'Desync');
    const resynced = guest.events.find((e) => e.type === 'Resynced') as Extract<SessionEvent, { type: 'Resynced' }> | undefined;
    expect(desync, 'the drift was caught').toBeDefined();
    expect(resynced).toBeDefined();
    expect(guest.events.filter((e) => e.type === 'Desync')).toHaveLength(1);
    expect(r.host.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(guest.trace.get(driftAt!)!.hash).not.toBe(expected.trace.get(driftAt!)!.hash);
    // The state the host sent had Pool slots bound: their Pool AIs' memory came with it, or the guest's AIs would not decide alike after.
    expect(expected.trace.get(resynced!.tick)!.slots.filter(Boolean).length).toBeGreaterThan(0);
    expect(resynced!.tick).toBeGreaterThan(driftAt!);

    expect(disagreements([r.host], expected.trace, upTo)).toEqual([]);
    expect(disagreements([guest], expected.trace, upTo, resynced!.tick)).toEqual([]);
    expect(expectChecksums('guest', guest, expected.hashes, resynced!.tick)).toBeGreaterThan(10);
    expect(guest.session.stats.resyncs).toBe(1);
    log('Resync', r.peers, upTo, `; drift on Tick ${driftAt}, resynced to Tick ${resynced!.tick} with ${expected.trace.get(resynced!.tick)!.slots.filter(Boolean).length} slots bound`);
  }, 300_000);
});
