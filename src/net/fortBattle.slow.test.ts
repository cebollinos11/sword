/**
 * docs/plans/battle-objectives.md, Stage 3a: an online Battle on the Fort over the memory transport (40 ms ± 20 latency), as
 * `battle.test.ts` and `battle*.slow.test.ts` play one on the open field. Each peer drives its own Player with a Hard Battle autopilot fed its own (possibly
 * predicted) state, and every other Pool slot is a Pool AI on every peer. Every peer's Tick function notes the hash of the Match each Tick
 * leaves, and the Battle is stepped offline again from the Intents the Players sent, so the peers are compared with it Tick by Tick: the
 * Crowd pushed out of the walls, the Pool AIs routed round them by the navmesh, all of it. The armies are small (60 a side, half a Ticket
 * a Soldier), so the Battle is short.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { applyBattleKnobs, loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Lineup, type PlayerNumber } from '../controllers';
import { createMatch, hashValue, IDLE_INTENT, stepMatch, TICK_RATE, type Intent, type MatchOptions, type MatchState } from '../sim';
import { createMemoryTransportPair } from './memoryTransport';
import { createRollbackSession, type RollbackSession, type SessionEvent } from './session';

const TICK_MS = 1000 / TICK_RATE;
const MATCH: MatchOptions = { format: 'Battle', bestOf: 1, seed: 5, arena: 'battle:fort' };
const WEAPON = 'Longsword';
/** The most Ticks the test plays: the Battle ends in about half of it. */
const TICK_CAP = 20_000;

/** Each peer loads its own Tuning Data and folds the Lobby's knobs in: the Fort, 60 a side, half a Ticket a Soldier. */
const peerTuning = (): TuningData => {
  const t = loadTuningData();
  const battle = applyBattleKnobs(t.battle, { map: 'fort', armySize: 60 });
  return { ...t, battle: { ...battle, tickets: { ...battle.tickets, perSoldier: 0.5 } } };
};

interface Peer {
  readonly session: RollbackSession;
  readonly sent: Map<number, Intent>;
  readonly events: SessionEvent[];
  readonly hashes: Map<number, string>;
}

afterEach(() => vi.restoreAllMocks());

it('two Players, one a Team, play a whole Battle on the Fort online: both peers and the offline Battle agree on every Tick, and it ends on the same Tick', () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const lineup: Lineup = [0, 1].map((team, p) => ({ team, pilot: { kind: 'Player', player: p as PlayerNumber } }));
  const pair = createMemoryTransportPair({ latencyMs: 40, jitterMs: 20, seed: 7 });
  const tunings = [peerTuning(), peerTuning()];
  const hashes = [new Map<number, string>(), new Map<number, string>()];
  // A Rollback re-simulates a Tick several times and only the last version counts, so each step just notes its Match, and a Tick is hashed
  // once, when it is confirmed (a confirmed Tick is never simulated again). Hashing every step cost more than a third of the test.
  const latest = [new Map<number, MatchState>(), new Map<number, MatchState>()];
  const hashed = [0, 0];
  const settle = () =>
    peers.forEach((p, k) => {
      for (; hashed[k]! < p.session.confirmedTick; ) {
        const t = ++hashed[k]!;
        hashes[k]!.set(t, hashValue(latest[k]!.get(t)!));
        latest[k]!.delete(t);
      }
    });
  const stepOf = (k: number) => (m: MatchState, intents: readonly Intent[], t: TuningData) => {
    const next = stepMatch(m, intents, t);
    latest[k]!.set(next.tick, next);
    return next;
  };
  const host = createRollbackSession({ role: 'host', guests: [pair.a], tuning: tunings[0]!, match: MATCH, lineup, weapon: WEAPON, step: stepOf(0) });
  const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning: tunings[1]!, weapon: WEAPON, step: stepOf(1) });
  const peers: Peer[] = [host, guest].map((session, k) => {
    const peer: Peer = { session, sent: new Map(), events: [], hashes: hashes[k]! };
    session.onEvent((e) => peer.events.push(e));
    return peer;
  });
  const pilots = tunings.map((t) => createBattlePilot(t, 'Hard'));
  let end: number | null = null;
  while (host.currentTick < TICK_CAP && !(end !== null && Math.min(host.confirmedTick, guest.confirmedTick) >= end + 30)) {
    clock += TICK_MS;
    pair.advance(TICK_MS);
    peers.forEach((peer, k) => {
      const { session } = peer;
      const state = session.state;
      const intent = !state || session.localFighter < 0 || state.status.status === 'Over' ? IDLE_INTENT : pilots[k]!.intent(state.duel, session.localFighter);
      const r = session.tick(intent);
      if (r.advanced) peer.sent.set(session.currentTick, JSON.parse(JSON.stringify(intent)) as Intent);
    });
    settle();
    if (end === null && host.state?.status.status === 'Over') end = host.state.status.tick;
  }
  expect(end, 'the Battle ended').not.toBeNull();
  for (const p of peers) {
    expect(p.session.status).toBe('Running');
    expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(p.session.stats.rollbacks).toBeGreaterThan(10);
  }

  // The same Battle offline, from the Intents the Players sent: every Tick both peers confirmed hashes the same.
  const upTo = Math.min(host.confirmedTick, guest.confirmedTick);
  const tuning = peerTuning();
  const ais = lineupAis(tuning, lineup, 'Battle', MATCH);
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), MATCH));
  const bad: string[] = [];
  for (let t = 1; t <= upTo; t++) {
    const at = m;
    m = stepMatch(at, ais.map((ai, k) => (ai ? ai.intent(at.duel, k) : (peers[k]!.sent.get(t) ?? IDLE_INTENT))), tuning);
    const want = hashValue(m);
    peers.forEach((p, k) => {
      if (p.hashes.get(t) !== want) bad.push(`peer ${k} @${t}`);
    });
  }
  expect(bad.slice(0, 10)).toEqual([]);
  expect(m.status.status).toBe('Over');
  expect(m.status.status === 'Over' && m.status.tick).toBe(end);
  process.stderr.write(
    `\nFort online, two Players: ${upTo} Ticks confirmed, the Battle ended on Tick ${end}; ${peers.map((p, k) => `peer ${k}: ${p.session.stats.rollbacks} Rollbacks (deepest ${p.session.stats.maxRollback}), ${p.session.stats.resyncs} resyncs`).join('; ')}\n`,
  );
}, 600_000);
