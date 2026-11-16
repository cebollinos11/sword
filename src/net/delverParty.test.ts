/**
 * A Delver Run online with a full party (docs/plans/delver.md, Stage 8): peers over the memory transport (40 ms ± 20 latency) step the same
 * Delver Run through the Rollback session, each Player's Fighter on the Delver pilot. Four Players at the game's Input Delay; two Players with two
 * AI allies seated on Team 0; and a guest leaving mid-Floor, taken over by an Ally AI on every peer. Each is checked against the same Run
 * replayed offline from the Intents the Players sent: the checksums agree, with no Desync and no resync.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { doorCounters, type MatchState } from '../sim';
import { flatFloors } from '../sim/delver/flat.testdata';
import { BATTLE_INPUT_DELAY, CHECKSUM_INTERVAL } from './session';
import { expectChecksums, nearWarband, offline, startRun, type Peer } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

/** Three flat Floors of one Tier, the Fighters' default Tuning Data otherwise. */
const tune = (t: TuningData): TuningData => flatFloors({ ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 3 } });
const DELVER = { tune };

/** The Pool slots past the party that hold a Soldier (a Promotion's Fighters). */
const promoted = (m: MatchState | null): number => (m ? m.duel.fighters.filter((f, i) => i >= m.config.teams.length && f.soldier !== undefined).length : 0);

/**
 * How many Players' Bubbles hold an enemy now: the distinct nearest Players (flat distance, the lower slot on a tie) of the promoted
 * enemies holding an Attack Slot. Each Bubble's slot-holders are its own Player's nearest enemies, so two or more means two Bubbles at work.
 */
function bubblesInUse(m: MatchState | null): number {
  if (!m) return 0;
  const players = m.config.players ?? [];
  const nearest = new Set<number>();
  m.duel.fighters.forEach((f, i) => {
    if (i < m.config.teams.length || f.soldier?.role !== 'Attack') return;
    let best = -1;
    let bestD = Infinity;
    for (const p of players) {
      const q = m.duel.fighters[p]!;
      const d = (q.position.x - f.position.x) ** 2 + (q.position.z - f.position.z) ** 2;
      if (d < bestD) [best, bestD] = [p, d];
    }
    nearest.add(best);
  });
  return nearest.size;
}

/** Every peer ran to the end with no Desync and no resync, and agrees with the offline replay on every checksum it recorded. */
function expectInStep(peers: readonly Peer[], expected: ReadonlyMap<number, string>, upTo: number): void {
  for (const p of peers) {
    expect(p.events.filter((e) => e.type === 'Desync'), `peer ${p.player}`).toEqual([]);
    expect(p.session.stats.resyncs, `peer ${p.player}`).toBe(0);
    expect(expectChecksums(`peer ${p.player}`, p, expected), `peer ${p.player}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2);
  }
}

describe('a Delver Run online with a full party', () => {
  it('four Players at the Input Delay the game plays step a Floor of Warbands in step with the offline replay, two Bubbles at work', () => {
    const r = startRun({ players: 4, delver: DELVER, step: () => nearWarband, inputDelay: BATTLE_INPUT_DELAY });
    let [mostPromoted, mostBubbles] = [0, 0];
    r.until(
      () => r.confirmed() >= 400,
      (peer) => {
        if (peer !== r.host) return;
        mostPromoted = Math.max(mostPromoted, promoted(peer.session.state));
        mostBubbles = Math.max(mostBubbles, bubblesInUse(peer.session.state));
      },
      700,
    );
    const upTo = r.confirmed();
    expect(upTo).toBeGreaterThanOrEqual(400);
    const state = r.host.session.state!;
    expect(state.config).toMatchObject({ delver: true, humans: 4, players: [0, 1, 2, 3], teams: [0, 0, 0, 0] });
    expect(mostPromoted, 'a Promotion happened').toBeGreaterThanOrEqual(1);
    expect(mostBubbles, 'two Players’ Bubbles held enemies at once').toBeGreaterThanOrEqual(2);
    // Every peer's pilot moved, and sent its Intents from the delayed Tick on.
    for (const p of r.peers) expect([...p.sent.values()].some((i) => i.move.x !== 0 || i.move.z !== 0), `Player ${p.player} moved`).toBe(true);
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [], r.replay);
    expectInStep(r.peers, expected.hashes, upTo);
  }, 300_000);

  it('two Players and two AI allies seated on Team 0: the Ally AIs run on every peer, in step with the offline replay', () => {
    const r = startRun({ players: 2, allies: 2, delver: DELVER, inputDelay: BATTLE_INPUT_DELAY });
    r.until(() => r.confirmed() >= 300, undefined, 600);
    const upTo = r.confirmed();
    expect(upTo).toBeGreaterThanOrEqual(300);
    const state = r.host.session.state!;
    // The party is four: the two Players first (they alone count at the Stairs), then the two allies; the Pool is past them.
    expect(state.config).toMatchObject({ delver: true, humans: 2, players: [0, 1], teams: [0, 0, 0, 0] });
    expect(state.duel.fighters.length).toBeGreaterThan(4);
    // The allies walked off with the party (they were not left idle at the Entrance).
    let walked = [0, 0];
    let begin: MatchState | null = null;
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [], {
      ...r.replay,
      each: (m) => {
        begin ??= m;
        walked = [2, 3].map((i) => Math.hypot(m.duel.fighters[i]!.position.x - begin!.duel.fighters[i]!.position.x, m.duel.fighters[i]!.position.z - begin!.duel.fighters[i]!.position.z));
      },
    });
    walked.forEach((d, k) => expect(d, `ally ${k + 2} moved`).toBeGreaterThan(2));
    expectInStep(r.peers, expected.hashes, upTo);
    // And the guest's state is the host's at a confirmed Tick.
    const last = upTo - (upTo % CHECKSUM_INTERVAL);
    expect(r.guests[0]!.sums.get(last)).toBe(r.host.sums.get(last));
  }, 300_000);

  it('a guest leaving mid-Floor is taken over by an Ally AI on every peer, marked away from one Tick, and the Run goes on in step', () => {
    const r = startRun({ players: 3, delver: DELVER, inputDelay: BATTLE_INPUT_DELAY });
    const leaver = r.guests[1]!; // Player 2
    r.until(
      () => leaver.gone && r.confirmed() >= 450,
      () => {
        if (!leaver.gone && r.host.session.currentTick >= 150) {
          leaver.session.close();
          leaver.gone = true;
        }
      },
      900,
    );
    expect(leaver.gone, 'the guest left').toBe(true);
    const stayed = r.peers.filter((p) => !p.gone);
    const upTo = r.confirmed();
    // Every peer still in the Run marks Fighter 2 away, and from the same Tick.
    const awayFrom = (p: Peer): number | null => {
      for (let t = 1; t <= upTo; t++) if (p.trace.get(t)?.delver?.away?.includes(2)) return t;
      return null;
    };
    const from = awayFrom(r.host);
    expect(from, 'the host marked Player 2 away').not.toBeNull();
    for (const p of stayed) {
      expect(p.events.some((e) => e.type === 'PlayerLeft' && e.player === 2), `peer ${p.player} heard it`).toBe(true);
      expect(awayFrom(p), `peer ${p.player}`).toBe(from);
      expect(p.session.state!.delver!.away).toEqual([2]);
      expect(p.session.state!.config.humans, 'the Warbands stay sized for three').toBe(3);
    }
    // The Stairs no longer wait on it: only the two Players left count.
    const state = r.host.session.state!;
    expect(doorCounters(state.config, state.duel.fighters, state.delver!.away)).not.toContain(2);
    // The offline replay with that Takeover gives the same checksums, and the Fighter kept moving under its AI.
    let taken: { x: number; z: number } | null = null;
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [{ player: 2, from: from! }], {
      ...r.replay,
      each: (m) => {
        if (m.tick === from) taken = m.duel.fighters[2]!.position;
      },
    });
    expectInStep(stayed, expected.hashes, upTo);
    const now = expected.state.duel.fighters[2]!.position;
    expect(taken, 'the replay reached the Takeover').not.toBeNull();
    expect(Math.hypot(taken!.x - now.x, taken!.z - now.z), 'the taken-over Fighter moved').toBeGreaterThan(1);
  }, 300_000);
});
