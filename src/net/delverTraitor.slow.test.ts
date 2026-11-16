/**
 * A Delver Run online with a traitor, its slow tier (`npm run test:slow`; docs/plans/delver.md, Stage 8a): three peers through the co-op harness,
 * the two party Players on the Delver pilot and the traitor on the traitor pilot, at the game's Input Delay, play a Run of one Tier of two Floors
 * (Floor 2 the Boss Floor) to its Victory. The party is kept at max HP each Tick (`withImmortalParty`, in every peer's Tick function), the traitor
 * is not. The offline replay of the same Intents is walked Tick by Tick to show what the traitor did: every takeover out of the party's sight and
 * reach, a wait that grew with its deaths, no pickup, fire or Stairs of a traitor's, and the Boss never taken over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { doorCounters, stepMatch, type MatchState } from '../sim';
import { withImmortalParty } from '../play/driver';
import { flatHalls } from '../sim/delver/flat.testdata';
import { arenaTuning } from '../sim/delver';
import { traitorCandidates, traitorSlot } from '../sim/delverTraitors';
import { BOSS } from '../sim/warband';
import { BATTLE_INPUT_DELAY, CHECKSUM_INTERVAL } from './session';
import { expectChecksums, offline, startRun, type Step } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

/** One Tier of two Floors on Stage 7b's Halls, each as long as the first tier's, the bundled Warbands and traitor rules otherwise. */
const tune = (t0: TuningData): TuningData => {
  const t = flatHalls(t0);
  return { ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 2, ...(t0.delver.tierRooms ? { tierRooms: t0.delver.tierRooms } : {}) } };
};

const immortal: Step = (m, intents, t) => withImmortalParty(stepMatch(m, intents, t));
const CAP = 60_000;
const endTick = (m: MatchState | null): number => (m?.status.status === 'Over' ? m.status.tick : 0);

describe('a Delver Run online with a traitor, slow', () => {
  it('two party pilots and a traitor pilot play a Run to its Victory in step; the traitor takes over out of sight, waits longer each death and takes nothing', () => {
    const wall = Date.now();
    const r = startRun({ players: 2, traitors: 1, delver: { tune }, step: () => immortal, inputDelay: BATTLE_INPUT_DELAY });
    const done = () => r.peers.every((p) => p.session.state?.status.status === 'Over') && r.confirmed() >= Math.max(...r.peers.map((p) => endTick(p.session.state))) + CHECKSUM_INTERVAL;
    r.until(done, undefined, CAP);
    const state = r.host.session.state!;
    expect(state.status).toMatchObject({ status: 'Over', winner: 0 });
    for (const p of r.peers) {
      expect(p.events.filter((e) => e.type === 'Desync'), `peer ${p.player}`).toEqual([]);
      expect(p.session.stats.resyncs, `peer ${p.player}`).toBe(0);
    }
    const upTo = r.confirmed();
    const k = traitorSlot(state.config, 0);

    // Walk the offline replay, Tick by Tick.
    let prev: MatchState | null = null;
    let floor2 = false;
    const takeovers: { tick: number; soldier: number; floor: number }[] = [];
    const waits: number[] = [];
    const breaches: string[] = [];
    const each = (m: MatchState) => {
      const before = prev;
      prev = m;
      if (!before || !m.delver || !before.delver) return;
      if (m.delver.floor >= 2) floor2 = true;
      const was = before.delver.traitors![0]!;
      const now = m.delver.traitors![0]!;
      if (now.taken > was.taken && m.delver.floor === before.delver.floor) {
        takeovers.push({ tick: m.tick, soldier: now.soldier, floor: m.delver.floor });
        // Its Soldier was one it could take on the Tick before: unseen and far by walking, in a Warband, never the Boss.
        if (!traitorCandidates(arenaTuning(r.host.tuning, before.arena), before.duel, before.config.teams.length).includes(now.soldier)) breaches.push(`takeover of ${now.soldier} at ${m.tick}`);
        const c = m.duel.crowd!;
        const q = c.warbands!.rank.indexOf(BOSS);
        if (q >= 0 && c.squad.indexOf(q) === now.soldier) breaches.push(`the Boss taken at ${m.tick}`);
      }
      if (now.deaths > was.deaths) waits.push(now.next - m.duel.tick);
      for (const e of m.events) {
        if ((e.type === 'ItemTaken' || e.type === 'Rested' || e.type === 'Revived') && e.fighter === k) breaches.push(`${e.type} by the traitor at ${m.tick}`);
      }
      if (doorCounters(m.config, m.duel.fighters, m.delver.away).includes(k)) breaches.push(`the traitor counted at the Stairs at ${m.tick}`);
    };
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [], { ...r.replay, each });
    for (const p of r.peers) expect(expectChecksums(`peer ${p.player}`, p, expected.hashes), `peer ${p.player}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2);

    const record = expected.state.delver!.traitors![0]!;
    process.stdout.write(
      `\nTraitor soak: Victory at Tick ${endTick(state)} in ${((Date.now() - wall) / 1000).toFixed(0)} s; ${takeovers.length} takeovers (${takeovers.map((t) => `F${t.floor}@${t.tick}`).join(', ')}), ` +
        `${record.deaths} deaths, ${record.kills} kills, waits after each fall ${waits.join(', ')} Ticks\n`,
    );
    expect(breaches).toEqual([]);
    expect(floor2, 'Floor 2 entered').toBe(true);
    expect(takeovers.length, 'takeovers').toBeGreaterThanOrEqual(3);
    expect(record.deaths, 'the traitor fell').toBeGreaterThanOrEqual(2);
    expect(Math.max(...waits.slice(1)), 'a later wait is longer than the first').toBeGreaterThan(waits[0]!);
  }, 3_600_000);
});
