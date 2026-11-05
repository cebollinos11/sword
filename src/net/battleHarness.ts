/**
 * The harness the online-Battle tests share (`battle.test.ts` and the `battle*.slow.test.ts` files): peers over the memory transport, each
 * driving its own Player, compared Tick by Tick with the same Battle stepped offline. See `battle.test.ts` for what is being tested.
 */
import { expect, vi } from 'vitest';
import { applyBattleKnobs, loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { createMatch, hashValue, IDLE_INTENT, inDuel, stepMatch, takeOverFighter, TICK_RATE, type BattlePlayer, type Intent, type MatchEvent, type MatchOptions, type MatchState } from '../sim';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, takeoverAi, type RollbackSession, type SessionEvent } from './session';

export const TICK_MS = 1000 / TICK_RATE;
export const MATCH: MatchOptions = { format: 'Battle', bestOf: 1, seed: 11 };
export const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
export const WEAPON = 'Longsword';
/** The most Ticks a test may play (a whole Battle of these armies takes about half of it). */
export const TICK_CAP = 5000;

/**
 * Each peer loads its own Tuning Data: two armies of 60, 10 m out from the centre on the open field; on a hand-built `map`, 60 a side
 * folded in as the Lobby folds it (`applyBattleKnobs`), half a Ticket a Soldier.
 */
export const peerTuning = (map?: string): TuningData => {
  const t = loadTuningData();
  if (map) {
    const battle = applyBattleKnobs(t.battle, { map, armySize: 60 });
    return { ...t, battle: { ...battle, tickets: { ...battle.tickets, perSoldier: 0.5 } } };
  }
  return { ...t, battle: { ...t.battle, armySize: 60, deploy: { ...t.battle.deploy, front: 10, perRank: 20 }, tickets: { ...t.battle.tickets, perSoldier: 0.5 } } };
};

/** The Match: the open field, or hand-built map `map`. */
export const matchOn = (map?: string): MatchOptions => (map ? { ...MATCH, arena: `battle:${map}` } : MATCH);

/** One Player per Team given, in Lobby order: the host first. */
export const battleLineup = (teams: readonly number[]): Lineup => teams.map((team, p) => ({ team, pilot: { kind: 'Player', player: p as PlayerNumber } }));

export type Step = typeof stepMatch;

/** What is kept of the Match each Tick leaves: its hash (the Crowd, the Pool, every binding), its events, and the Players' records. */
export interface Snap {
  readonly hash: string;
  readonly events: readonly MatchEvent[];
  readonly players: readonly BattlePlayer[];
  /** Per Pool slot: its binding (Soldier, Promotion Tick, role), Team and place, or null while unbound; and whether it is in the fight. */
  readonly slots: readonly ({ readonly index: number; readonly since: number; readonly role: string; readonly team: number; readonly x: number; readonly z: number } | null)[];
  readonly inPlay: readonly boolean[];
  /** Each Fighter's place. */
  readonly at: readonly { readonly x: number; readonly z: number }[];
}

export const snap = (m: MatchState): Snap => ({
  hash: hashValue(m),
  events: m.events,
  players: m.duel.crowd!.players,
  slots: m.duel.fighters.map((f) => (f.soldier ? { index: f.soldier.index, since: f.soldier.since, role: f.soldier.role, team: f.team, x: f.position.x, z: f.position.z } : null)),
  inPlay: m.duel.fighters.map((f) => inDuel(f)),
  at: m.duel.fighters.map((f) => f.position),
});

/** One line of figures for the Stage's Result. */
export const log = (name: string, peers: readonly Peer[], upTo: number, extra = '') =>
  process.stderr.write(`
${name}: ${upTo} Ticks confirmed; ${peers.map((p) => `peer ${p.player}: ${p.session.stats.rollbacks} Rollbacks (deepest ${p.session.stats.maxRollback}), ${p.session.stats.stalls} stalls, ${p.session.stats.resyncs} resyncs`).join('; ')}${extra}
`);

export interface Peer {
  readonly player: number;
  readonly session: RollbackSession;
  readonly pilot: Controller;
  readonly sent: Map<number, Intent>;
  readonly events: SessionEvent[];
  readonly sums: Map<number, string>;
  readonly trace: Map<number, Snap>;
  gone: boolean;
}

export interface BattleOptions {
  readonly teams: readonly number[];
  /** Per Player: a Tick function in place of `stepMatch` (to inject divergence). */
  readonly step?: (player: number) => Step | undefined;
  /** A hand-built Battle map (`battle.maps`) in place of the open field. */
  readonly map?: string;
}

/** The pilot's Intent for the local Fighter, from the session's own (possibly predicted) state. */
export function pilotIntent(peer: Peer): Intent {
  const { session } = peer;
  const state = session.state;
  if (!state || session.localFighter < 0 || state.status.status === 'Over') return IDLE_INTENT;
  return peer.pilot.intent(state.duel, session.localFighter);
}

export function startBattle(o: BattleOptions) {
  // The session pings on the wall clock, and each ping draws from the transport's jitter: a virtual clock keeps a Battle the same each run.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const players = o.teams.length;
  const lineup = battleLineup(o.teams);
  const pairs: MemoryTransportPair[] = Array.from({ length: players - 1 }, (_, i) => createMemoryTransportPair({ ...NET, seed: 7 + i }));
  const tunings = Array.from({ length: players }, () => peerTuning(o.map));
  const traces = tunings.map(() => new Map<number, Snap>());
  // A Rollback re-simulates a Tick several times and only the last version counts, so each step just notes its Match and a Tick is turned
  // into its Snap (hashed) once, when it is confirmed. Snapping every step cost over a third of the run.
  const latest = tunings.map(() => new Map<number, MatchState>());
  const snapped = tunings.map(() => 0);
  const settle = (k: number, confirmed: number) => {
    while (snapped[k]! < confirmed) {
      const t = ++snapped[k]!;
      const m = latest[k]!.get(t);
      if (m) traces[k]!.set(t, snap(m)); // none for a Tick a resync skipped
      latest[k]!.delete(t);
    }
  };
  const stepOf = (k: number): Step => (m, intents, t) => {
    const next = (o.step?.(k) ?? stepMatch)(m, intents, t);
    latest[k]!.set(next.tick, next);
    return next;
  };
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match: matchOn(o.map), lineup, weapon: WEAPON, step: stepOf(0) });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: stepOf(i + 1) }));
  const peers: Peer[] = [host, ...guests].map((session, k) => {
    const peer: Peer = { player: k, session, pilot: createBattlePilot(tunings[k]!, 'Hard'), sent: new Map(), events: [], sums: new Map(), trace: traces[k]!, gone: false };
    session.onEvent((e) => {
      peer.events.push(e);
      // A resync puts the guest on the host's state and re-simulates Ticks it had already confirmed: snap them again.
      if (e.type === 'Resynced') snapped[k] = Math.min(snapped[k]!, e.tick);
    });
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
      settle(peer.player, c);
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
  return { lineup, map: o.map, peers, host: peers[0]!, guests: peers.slice(1), confirmed, until };
}

/** A Player who left: the AI drives their Fighter from `from` on. */
export interface Takeover {
  readonly player: number;
  readonly from: number;
}

/** The Battle stepped offline with the Intents the Players sent and fresh AI Controllers: the Match each Tick left, and its checksums. */
export function offline(lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = [], map?: string) {
  const tuning = peerTuning(map);
  const match = matchOn(map);
  const ais = lineupAis(tuning, lineup, 'Battle', match);
  const taken = new Map(takeovers.map((d) => [d.player, { from: d.from, ai: takeoverAi(tuning, lineup, 'Battle', d.player) }]));
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), match));
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
export function expectChecksums(name: string, peer: Peer, expected: ReadonlyMap<number, string>, from = 0): number {
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
export function disagreements(peers: readonly Peer[], expected: ReadonlyMap<number, Snap>, upTo: number, from = 0): string[] {
  const bad: string[] = [];
  for (const peer of peers) for (let t = from + 1; t <= upTo; t++) if (peer.trace.get(t)?.hash !== expected.get(t)!.hash) bad.push(`peer ${peer.player} @${t}`);
  return bad;
}

/** The Ticks of the offline Battle on which `event` happened. */
export const eventTicks = (trace: ReadonlyMap<number, Snap>, type: MatchEvent['type']): number[] => [...trace].filter(([, s]) => s.events.some((e) => e.type === type)).map(([t]) => t);

/** Whether Pool slots past the Players' were bound, as an enemy of Team `team`'s Player holding an Attack Slot, at some Tick. */
export const attackedTeam = (trace: ReadonlyMap<number, Snap>, team: number): boolean => [...trace.values()].some((s) => s.slots.some((b) => b?.role === 'Attack' && b.team !== team));
