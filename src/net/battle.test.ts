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
import { loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { createMatch, hashValue, IDLE_INTENT, inDuel, stepMatch, takeOverFighter, TICK_RATE, type BattlePlayer, type Intent, type MatchEvent, type MatchOptions, type MatchState } from '../sim';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, ROLLBACK_WINDOW, takeoverAi, type RollbackSession, type SessionEvent } from './session';

const TICK_MS = 1000 / TICK_RATE;
const MATCH: MatchOptions = { format: 'Battle', bestOf: 1, seed: 11 };
const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
const WEAPON = 'Longsword';
/** The most Ticks a test may play (a whole Battle of these armies takes about half of it). */
const TICK_CAP = 5000;

/** Each peer loads its own Tuning Data: two armies of 60, 10 m out from the centre. */
const peerTuning = (): TuningData => {
  const t = loadTuningData();
  return { ...t, battle: { ...t.battle, armySize: 60, deploy: { ...t.battle.deploy, front: 10, perRank: 20 } } };
};

/** One Player per Team given, in Lobby order: the host first. */
const battleLineup = (teams: readonly number[]): Lineup => teams.map((team, p) => ({ team, pilot: { kind: 'Player', player: p as PlayerNumber } }));

type Step = typeof stepMatch;

/** What is kept of the Match each Tick leaves: its hash (the Crowd, the Pool, every binding), its events, and the Players' records. */
interface Snap {
  readonly hash: string;
  readonly events: readonly MatchEvent[];
  readonly players: readonly BattlePlayer[];
  /** Per Pool slot: its binding (Soldier, Promotion Tick, role), Team and place, or null while unbound; and whether it is in the fight. */
  readonly slots: readonly ({ readonly index: number; readonly since: number; readonly role: string; readonly team: number; readonly x: number; readonly z: number } | null)[];
  readonly inPlay: readonly boolean[];
  /** Each Fighter's place. */
  readonly at: readonly { readonly x: number; readonly z: number }[];
}

const snap = (m: MatchState): Snap => ({
  hash: hashValue(m),
  events: m.events,
  players: m.duel.crowd!.players,
  slots: m.duel.fighters.map((f) => (f.soldier ? { index: f.soldier.index, since: f.soldier.since, role: f.soldier.role, team: f.team, x: f.position.x, z: f.position.z } : null)),
  inPlay: m.duel.fighters.map((f) => inDuel(f)),
  at: m.duel.fighters.map((f) => f.position),
});

/** One line of figures for the Stage's Result. */
const log = (name: string, peers: readonly Peer[], upTo: number, extra = '') =>
  process.stderr.write(`
${name}: ${upTo} Ticks confirmed; ${peers.map((p) => `peer ${p.player}: ${p.session.stats.rollbacks} Rollbacks (deepest ${p.session.stats.maxRollback}), ${p.session.stats.stalls} stalls, ${p.session.stats.resyncs} resyncs`).join('; ')}${extra}
`);

interface Peer {
  readonly player: number;
  readonly session: RollbackSession;
  readonly pilot: Controller;
  readonly sent: Map<number, Intent>;
  readonly events: SessionEvent[];
  readonly sums: Map<number, string>;
  readonly trace: Map<number, Snap>;
  gone: boolean;
}

interface BattleOptions {
  readonly teams: readonly number[];
  /** Per Player: a Tick function in place of `stepMatch` (to inject divergence). */
  readonly step?: (player: number) => Step | undefined;
}

/** The pilot's Intent for the local Fighter, from the session's own (possibly predicted) state. */
function pilotIntent(peer: Peer): Intent {
  const { session } = peer;
  const state = session.state;
  if (!state || session.localFighter < 0 || state.status.status === 'Over') return IDLE_INTENT;
  return peer.pilot.intent(state.duel, session.localFighter);
}

function startBattle(o: BattleOptions) {
  // The session pings on the wall clock, and each ping draws from the transport's jitter: a virtual clock keeps a Battle the same each run.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const players = o.teams.length;
  const lineup = battleLineup(o.teams);
  const pairs: MemoryTransportPair[] = Array.from({ length: players - 1 }, (_, i) => createMemoryTransportPair({ ...NET, seed: 7 + i }));
  const tunings = Array.from({ length: players }, () => peerTuning());
  const traces = tunings.map(() => new Map<number, Snap>());
  const stepOf = (k: number): Step => (m, intents, t) => {
    const next = (o.step?.(k) ?? stepMatch)(m, intents, t);
    traces[k]!.set(next.tick, snap(next));
    return next;
  };
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match: MATCH, lineup, weapon: WEAPON, step: stepOf(0) });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: stepOf(i + 1) }));
  const peers: Peer[] = [host, ...guests].map((session, k) => {
    const peer: Peer = { player: k, session, pilot: createBattlePilot(tunings[k]!, 'Hard'), sent: new Map(), events: [], sums: new Map(), trace: traces[k]!, gone: false };
    session.onEvent((e) => peer.events.push(e));
    return peer;
  });
  const live = () => peers.filter((p) => !p.gone);
  const confirmed = () => Math.min(...live().map((p) => p.session.confirmedTick));
  const frame = (each?: (peer: Peer) => void) => {
    clock += TICK_MS;
    for (const p of pairs) p.advance(TICK_MS);
    for (const peer of peers) {
      if (peer.gone) continue;
      const { session } = peer;
      const intent = pilotIntent(peer);
      const r = session.tick(intent);
      // Recorded as sent: as the other peers read it off the wire (JSON has no -0).
      if (r.advanced) peer.sent.set(session.currentTick, JSON.parse(JSON.stringify(intent)) as Intent);
      each?.(peer);
      const c = session.confirmedTick;
      for (let t = c - (c % CHECKSUM_INTERVAL); t > 0 && t > c - 600; t -= CHECKSUM_INTERVAL) {
        const sum = session.checksumAt(t);
        if (sum !== undefined) peer.sums.set(t, sum);
      }
    }
  };
  /** Frames until `done`, or the host reaches Tick `cap`. */
  const until = (done: () => boolean, each?: (peer: Peer) => void, cap = TICK_CAP) => {
    while (!done() && peers[0]!.session.currentTick < cap) frame(each);
  };
  return { lineup, peers, host: peers[0]!, guests: peers.slice(1), confirmed, until };
}

/** A Player who left: the AI drives their Fighter from `from` on. */
interface Takeover {
  readonly player: number;
  readonly from: number;
}

/** The Battle stepped offline with the Intents the Players sent and fresh AI Controllers: the Match each Tick left, and its checksums. */
function offline(lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = []) {
  const tuning = peerTuning();
  const ais = lineupAis(tuning, lineup, 'Battle', MATCH);
  const taken = new Map(takeovers.map((d) => [d.player, { from: d.from, ai: takeoverAi(tuning, lineup, 'Battle', d.player) }]));
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), MATCH));
  const trace = new Map<number, Snap>();
  const hashes = new Map<number, string>();
  for (let t = 1; t <= upTo; t++) {
    // The Takeover Tick: the Player is marked away before that Tick's Intents, as the Rollback session does on every peer.
    for (const [p, d] of taken) if (t === d.from) m = takeOverFighter(m, p);
    const at = m;
    const intents = ais.map((ai, k) => {
      if (ai) return ai.intent(at.duel, k);
      const d = taken.get(k);
      if (d && t >= d.from) return d.ai.intent(at.duel, k);
      return peers[k]!.sent.get(t) ?? IDLE_INTENT;
    });
    m = stepMatch(at, intents, tuning);
    const s = snap(m);
    trace.set(t, s);
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, s.hash);
  }
  return { trace, hashes, state: m };
}

/** Every checksum Tick `peer` recorded equals the offline Battle's (after `from`). Returns how many were compared. */
function expectChecksums(name: string, peer: Peer, expected: ReadonlyMap<number, string>, from = 0): number {
  let checked = 0;
  for (const [tick, hash] of expected) {
    if (tick <= from) continue;
    const sum = peer.sums.get(tick);
    if (sum === undefined) continue;
    expect(sum, `${name} @${tick}`).toBe(hash);
    checked++;
  }
  return checked;
}

/** Every Tick in `(from, upTo]` on which a peer's Match hashes differently from the offline Battle's. Empty when they agree. */
function disagreements(peers: readonly Peer[], expected: ReadonlyMap<number, Snap>, upTo: number, from = 0): string[] {
  const bad: string[] = [];
  for (const peer of peers) for (let t = from + 1; t <= upTo; t++) if (peer.trace.get(t)?.hash !== expected.get(t)!.hash) bad.push(`peer ${peer.player} @${t}`);
  return bad;
}

/** The Ticks of the offline Battle on which `event` happened. */
const eventTicks = (trace: ReadonlyMap<number, Snap>, type: MatchEvent['type']): number[] => [...trace].filter(([, s]) => s.events.some((e) => e.type === type)).map(([t]) => t);

/** Whether Pool slots past the Players' were bound, as an enemy of Team `team`'s Player holding an Attack Slot, at some Tick. */
const attackedTeam = (trace: ReadonlyMap<number, Snap>, team: number): boolean => [...trace.values()].some((s) => s.slots.some((b) => b?.role === 'Attack' && b.team !== team));

afterEach(() => vi.restoreAllMocks());

describe('online Battles over the memory transport (Stage 6)', () => {
  it('two Players, one a Team, play a whole Battle: every peer and the offline Battle agree on every Tick, the Crowd and the Pool included, and it ends on the same Tick', () => {
    const r = startBattle({ teams: [0, 1] });
    let end: number | null = null;
    r.until(
      () => end !== null && r.confirmed() >= end + 30,
      (peer) => {
        if (end === null && peer === r.host && peer.session.state?.status.status === 'Over') end = peer.session.state.status.tick;
      },
    );
    expect(end, 'the Battle ended').not.toBeNull();
    for (const p of r.peers) expect(p.session.status).toBe('Running');

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo);
    expect(expected.state.status.status).toBe('Over');
    r.peers.forEach((p, k) => expect(expectChecksums(`peer ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2));
    for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);

    // The Battle's Rout and end, once, on the same Tick everywhere; both Bubbles promoted enemies; and Rollbacks re-simulated across all of it.
    const ends = eventTicks(expected.trace, 'BattleEnd');
    expect(ends).toHaveLength(1);
    expect(eventTicks(expected.trace, 'Rout')).toHaveLength(1);
    for (const p of r.peers) expect(eventTicks(p.trace, 'BattleEnd').filter((t) => t <= upTo)).toEqual(ends);
    expect(attackedTeam(expected.trace, 0)).toBe(true);
    expect(attackedTeam(expected.trace, 1)).toBe(true);
    for (const p of r.peers) expect(p.session.stats.rollbacks).toBeGreaterThan(10);
    log('Two Players', r.peers, upTo, `; the Battle ended on Tick ${ends[0]}`);
  }, 300_000);

  it('four Players, two a Team: every peer and the offline Battle agree on every Tick while the four Bubbles share the Pool', () => {
    const r = startBattle({ teams: [0, 1, 0, 1] });
    r.until(() => r.confirmed() >= 1500);
    for (const p of r.peers) expect(p.session.status).toBe('Running');

    const upTo = r.confirmed();
    const expected = offline(r.lineup, r.peers, upTo);
    r.peers.forEach((p, k) => expect(expectChecksums(`peer ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2));
    for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);

    // Four Bubbles in use with Soldiers promoted round both Teams' Players, and the Pool busy.
    const busy = [...expected.trace.values()].filter((s) => s.inPlay.slice(0, 4).every(Boolean) && s.slots.filter(Boolean).length >= 8);
    expect(busy.length).toBeGreaterThan(60);
    expect(attackedTeam(expected.trace, 0)).toBe(true);
    expect(attackedTeam(expected.trace, 1)).toBe(true);
    for (const p of r.peers) expect(p.session.stats.maxRollback).toBeGreaterThan(0);
    log('Four Players', r.peers, upTo, `; ${busy.length} Ticks with four Bubbles and 8 or more slots bound`);
  }, 300_000);
});

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
