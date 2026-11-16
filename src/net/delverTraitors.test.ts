/**
 * A Delver Run online with traitors (docs/plans/delver.md, Stage 8a): peers over the memory transport (40 ms ± 20 latency) at the game's Input
 * Delay, the party's Players on the Delver pilot and each traitor on the traitor pilot. Two party Players and one traitor; an all-AI party (two
 * Expert allies) and two traitors. Each is checked against the same Run replayed offline from the Intents the Players sent: the checksums agree,
 * with no Desync and no resync, and every traitor took a Soldier over on every peer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import type { MatchState } from '../sim';
import { flatFloors } from '../sim/delver/flat.testdata';
import { BATTLE_INPUT_DELAY, CHECKSUM_INTERVAL } from './session';
import { expectChecksums, offline, startRun, type Peer } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

/** One tier of three short flat Floors; a traitor waits 2 s, then 3 s, at most 4 s, so takeovers come soon. */
const tune = (t: TuningData): TuningData => {
  const f = flatFloors(t);
  return { ...f, delver: { ...f.delver, tiers: 1, floorsPerTier: 3, tierRooms: [7], traitor: { minDistance: 20, respawnSeconds: 2, respawnStep: 1, respawnMax: 4 } } };
};
const DELVER = { tune };

function expectInStep(peers: readonly Peer[], expected: ReadonlyMap<number, string>, upTo: number): void {
  for (const p of peers) {
    expect(p.events.filter((e) => e.type === 'Desync'), `peer ${p.player}`).toEqual([]);
    expect(p.session.stats.resyncs, `peer ${p.player}`).toBe(0);
    expect(expectChecksums(`peer ${p.player}`, p, expected), `peer ${p.player}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2);
  }
}

/** Each traitor's takeovers so far on this peer's state. */
const taken = (m: MatchState | null): number[] => m?.delver?.traitors?.map((r) => r.taken) ?? [];

describe('a Delver Run online with traitors', () => {
  it('two party Players and one traitor play in step with the offline replay, the traitor taking a Soldier over on every peer', () => {
    const r = startRun({ players: 2, traitors: 1, delver: DELVER, inputDelay: BATTLE_INPUT_DELAY });
    r.until(() => r.confirmed() >= 450 && r.peers.every((p) => (taken(p.session.state)[0] ?? 0) >= 1), undefined, 900);
    const upTo = r.confirmed();
    const state = r.host.session.state!;
    expect(state.config).toMatchObject({ delver: true, humans: 2, players: [0, 1], teams: [0, 0], traitors: [{}] });
    for (const p of r.peers) expect(taken(p.session.state)[0], `peer ${p.player}`).toBeGreaterThanOrEqual(1);
    // The traitor's peer drives slot 2 (the first past the party).
    expect(r.peers[2]!.session.localFighter).toBe(2);
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [], r.replay);
    expect(taken(expected.state)[0]).toBeGreaterThanOrEqual(1);
    expectInStep(r.peers, expected.hashes, upTo);
  }, 300_000);

  it('an all-AI party and two traitors (the host one of them) play in step with the offline replay', () => {
    const r = startRun({ players: 0, allies: 2, traitors: 2, delver: DELVER, inputDelay: BATTLE_INPUT_DELAY });
    r.until(() => r.confirmed() >= 450 && r.peers.every((p) => taken(p.session.state).every((n) => n >= 1)), undefined, 900);
    const upTo = r.confirmed();
    const state = r.host.session.state!;
    expect(state.config).toMatchObject({ delver: true, humans: 0, players: [], teams: [0, 0], traitors: [{}, {}] });
    expect(r.peers.map((p) => p.session.localFighter)).toEqual([2, 3]);
    for (const p of r.peers) expect(taken(p.session.state), `peer ${p.player}`).toEqual([expect.any(Number), expect.any(Number)]);
    for (const n of taken(state)) expect(n).toBeGreaterThanOrEqual(1);
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [], r.replay);
    expectInStep(r.peers, expected.hashes, upTo);
  }, 300_000);

  it('a traitor leaving is taken over by a Pool AI on every peer: its Soldier an ordinary promoted enemy, in step with the offline replay', () => {
    const r = startRun({ players: 2, traitors: 1, delver: DELVER, inputDelay: BATTLE_INPUT_DELAY });
    const leaver = r.guests[1]!; // Player 2, the traitor
    r.until(
      () => leaver.gone && r.confirmed() >= 450,
      () => {
        if (!leaver.gone && (taken(r.host.session.state)[0] ?? 0) >= 1 && r.host.session.currentTick >= 200) {
          leaver.session.close();
          leaver.gone = true;
        }
      },
      900,
    );
    expect(leaver.gone, 'the traitor left').toBe(true);
    const stayed = r.peers.filter((p) => !p.gone);
    const upTo = r.confirmed();
    const awayFrom = (p: Peer): number | null => {
      for (let t = 1; t <= upTo; t++) if (p.trace.get(t)?.delver?.traitors?.[0]?.away) return t;
      return null;
    };
    const from = awayFrom(r.host);
    expect(from, 'the host marked the traitor away').not.toBeNull();
    for (const p of stayed) expect(awayFrom(p), `peer ${p.player}`).toBe(from);
    const expected = offline(r.host.tuning, r.lineup, r.peers, upTo, [{ player: 2, from: from! }], r.replay);
    expect(expected.state.delver!.traitors![0]!.away).toBe(true);
    expectInStep(stayed, expected.hashes, upTo);
  }, 300_000);
});
