/**
 * The harness the online Run tests share (`delver*.test.ts`): peers over the memory transport, each driving its own Player with the Delver
 * pilot (a traitor's with the traitor pilot), compared Tick by Tick with the same Run stepped offline.
 */
import { expect, vi } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createDelverPilot, createTraitorPilot, lineupAis, lineupMatch, FLOOR_DIFFICULTY, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { createMatch, stairsCounters, hashValue, IDLE_INTENT, MAX_TEAM_SIZE, stepMatch, takeOverFighter, TICK_RATE, type Intent, type Inventory, type MatchEvent, type MatchOptions, type MatchState, type StoredMods, type Pickup } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena, type ArenaWorld } from '../play/arenaWorlds';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, takeoverAi, type RollbackSession, type SessionEvent } from './session';

export const NAME = 'gen:greybox:4242';
export const TICK_MS = 1000 / TICK_RATE;
export const MATCH: MatchOptions = { bestOf: 1, arena: NAME, seed: 9, format: 'Gauntlet' };
export const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
export const WEAPON = 'Arming Sword';
/** The most Ticks a test may play unless it names its own cap. */
export const TICK_CAP = 6000;
/** The difficulty of the AI allies `runLineup` seats on Team 0. */
export const ALLY_DIFFICULTY = 'Expert';

/**
 * The host and `players - 1` guests on Team 0, then `allies` AI allies on Team 0 (an Open Seat the host set to an AI), then the MAX_TEAM_SIZE
 * Floor slots: the Lineup a Gauntlet Lobby builds.
 */
export function runLineup(players: number, allies = 0, traitors = 0): Lineup {
  const own = Array.from({ length: players }, (_, p) => ({ team: 0, pilot: { kind: 'Player', player: p as PlayerNumber } }) as const);
  const ais = Array.from({ length: allies }, () => ({ team: 0, pilot: { kind: 'AI', difficulty: ALLY_DIFFICULTY }, weapon: WEAPON }) as const);
  // A Delver Run's traitors (docs/plans/delver.md, Stage 8a): the Players after the party's, on Team 1 before the Floor slots.
  const traitorSlots = Array.from({ length: traitors }, (_, j) => ({ team: 1, pilot: { kind: 'Player', player: (players + j) as PlayerNumber } }) as const);
  const floors = Array.from({ length: MAX_TEAM_SIZE - traitors }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const);
  return [...own, ...ais, ...traitorSlots, ...floors];
}

/** The Match stepped one Tick: the Tick function of every peer and of the offline Run. */
export type Step = typeof stepMatch;

/** What is kept of the Match each Tick leaves (a long Run would not fit in memory whole): its Run, its events, the Fighters' Inventories and Mods, and who the Stairs count. */
export interface Snap {
  readonly tick: number;
  /** The Run's progress (`MatchState.delver`). */
  readonly delver?: MatchState['delver'];
  readonly events: readonly MatchEvent[];
  readonly fighters: readonly { readonly inventory?: Inventory; readonly mods?: StoredMods }[];
  /** `stairsCounters` with the Takeovers (`delver.away`) taken into account, and without. */
  readonly counting: readonly number[];
  readonly countingEveryone: readonly number[];
}

export const snap = (m: MatchState): Snap => ({
  tick: m.tick,
  ...(m.delver ? { delver: m.delver } : {}),
  events: m.events,
  fighters: m.duel.fighters.map((f) => ({ inventory: f.inventory, mods: f.mods })),
  counting: stairsCounters(m.config, m.duel.fighters, m.delver?.away),
  countingEveryone: stairsCounters(m.config, m.duel.fighters),
});

export interface Peer {
  readonly player: number;
  readonly session: RollbackSession;
  readonly tuning: TuningData;
  readonly worlds: (name: string) => ArenaWorld;
  readonly warmed: Set<string>;
  readonly autopilot: Controller;
  /** The Intents this peer's Player sent, by Tick. */
  readonly sent: Map<number, Intent>;
  readonly events: SessionEvent[];
  /** The checksum this peer recorded for each confirmed checksum Tick (the latest, after any resync). */
  readonly sums: Map<number, string>;
  /** The Match each Tick left, by Tick: the last version this peer simulated (final once the Tick is confirmed). */
  readonly trace: Map<number, Snap>;
  /** What each of this peer's frames cost (only when the Run is made with `timed`), in order. */
  readonly frames: FrameCost[];
  /** How many Ticks this peer's Tick function has been called for (every simulated Tick, a Rollback's re-simulated ones too). */
  steps: number;
  gone: boolean;
}

/** One frame of a peer: the wall time of `session.tick` (ms), the Rollbacks it ran, the Ticks it simulated in all, and whether it advanced the Match. */
export interface FrameCost {
  readonly ms: number;
  readonly rollbacks: number;
  readonly steps: number;
  readonly advanced: boolean;
}

export interface RunOptions {
  readonly players: number;
  readonly net?: MemoryTransportOptions;
  /** Per Player: a Tick function in place of `stepMatch` (to inject divergence). */
  readonly step?: (player: number) => Step | undefined;
  /** Per Player: the Intent for Tick `tick` instead of the autopilot's (null: the autopilot's). Reads the peer's own state. */
  readonly intent?: (player: number, state: MatchState, tick: number) => Intent | null;
  /** Tuning Data as `tune` makes it (default: as it is). */
  readonly delver?: { readonly tune?: (t: TuningData) => TuningData };
  /** Time every frame of every peer into `Peer.frames` (wall clock, not the virtual one). */
  readonly timed?: boolean;
  /** AI allies seated on Team 0 after the Players (default 0; `runLineup`). */
  readonly allies?: number;
  /** Every peer's Input Delay in Ticks (`RollbackSessionOptions.inputDelay`; default 0, the game's online Delver Run takes `BATTLE_INPUT_DELAY`). */
  readonly inputDelay?: number;
  /** A Delver Run's traitors: this many more peers, Players `players` on, on Team 1, each on the traitor pilot (default 0; `runLineup`). */
  readonly traitors?: number;
}

/** The autopilot's Intent for the local Fighter, as `playerVsPlayer` asks it: from the session's own (possibly predicted) state. */
export function autopilotIntent(peer: Peer): Intent {
  const { session } = peer;
  const state = session.state;
  if (!state || session.localFighter < 0 || state.status.status === 'Over') return IDLE_INTENT;
  return peer.autopilot.intent(state.duel, session.localFighter);
}

export function startRun(o: RunOptions) {
  // The session pings on the wall clock, and each ping draws from the transport's jitter: a virtual clock keeps a Run the same from one run to the next.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const traitors = o.traitors ?? 0;
  const lineup = runLineup(o.players, o.allies ?? 0, traitors);
  const inputDelay = o.inputDelay ?? 0;
  const humans = o.players + traitors;
  const pairs: MemoryTransportPair[] = Array.from({ length: humans - 1 }, (_, i) => createMemoryTransportPair({ ...(o.net ?? NET), seed: 4 + i }));
  const match = MATCH;
  const tunings = Array.from({ length: humans }, () => (o.delver?.tune ?? ((t: TuningData) => t))(loadTuningData()));
  const traces = tunings.map(() => new Map<number, Snap>());
  const counts = tunings.map(() => 0);
  const stepOf = (k: number): Step => (m, intents, t) => {
    counts[k]!++;
    const next = (o.step?.(k) ?? stepMatch)(m, intents, t);
    traces[k]!.set(next.tick, snap(next));
    return next;
  };
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match, lineup, weapon: WEAPON, step: stepOf(0), inputDelay });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: stepOf(i + 1), inputDelay }));
  const peers: Peer[] = [host, ...guests].map((session, k) => {
    const peer: Peer = {
      player: k,
      session,
      tuning: tunings[k]!,
      worlds: createArenaWorlds(tunings[k]!),
      warmed: new Set(),
      autopilot: k >= o.players ? createTraitorPilot(tunings[k]!, 'Hard', { walk: inputDelay > 0 }) : createDelverPilot(tunings[k]!, 'Hard', { walk: inputDelay > 0 }),
      sent: new Map(),
      events: [],
      sums: new Map(),
      trace: traces[k]!,
      frames: [],
      get steps() {
        return counts[k]!;
      },
      gone: false,
    };
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
      const tick = session.currentTick + 1;
      const intent = (session.state && o.intent?.(peer.player, session.state, tick)) ?? autopilotIntent(peer);
      const [before, steps] = [session.stats.rollbacks, peer.steps];
      const t0 = o.timed ? process.hrtime.bigint() : 0n;
      const r = session.tick(intent);
      if (o.timed) peer.frames.push({ ms: Number(process.hrtime.bigint() - t0) / 1e6, rollbacks: session.stats.rollbacks - before, steps: peer.steps - steps, advanced: r.advanced });
      // Recorded as sent: as the other peers read it off the wire (JSON has no -0).
      if (r.advanced) peer.sent.set(session.currentTick, JSON.parse(JSON.stringify(intent)) as Intent);
      each?.(peer);
      // The game builds the next Floor's Arena ahead, on every peer (`warmNextArena`).
      const next = session.state && arenaToWarm(session.state);
      if (next && !peer.warmed.has(next)) {
        warmArena(peer.worlds, peer.tuning, next);
        peer.warmed.add(next);
      }
      // Each peer keeps only its recent checksums: note them as they are confirmed (again after a resync).
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
  /** What `offline` needs to replay this Run: its Match options, the Tick function every peer stepped (the test's edit included), and the Input Delay. */
  const replay: Replay = { match, inputDelay, ...(o.step?.(0) ? { step: o.step(0)! } : {}) };
  return { lineup, pairs, peers, host: peers[0]!, guests: peers.slice(1), confirmed, frame, until, replay };
}

/** The Tick `nearWarband` sets the party down beside the first Warband. */
export const SET_DOWN = 2;
/**
 * A Delver Run's Tick, with the party's Fighters stood 3 m from the first Warband's first Soldier on Tick `SET_DOWN` (the same edit on every
 * peer and in the offline replay, so a Rollback over it repeats it): its Bubbles promote the Soldiers about them within a few Ticks.
 */
export const nearWarband: Step = (m, intents, t) => {
  const next = stepMatch(m, intents, t);
  const crowd = next.duel.crowd;
  if (next.tick !== SET_DOWN || !crowd || crowd.x.length === 0) return next;
  const party = next.config.teams.length;
  return { ...next, duel: { ...next.duel, fighters: next.duel.fighters.map((f, i) => (i < party ? { ...f, position: { x: crowd.x[0]! - 3 + i * 0.8, z: crowd.z[0]! } } : f)) } };
};

/** A Player who left: the AI drives their Fighter from `from` on. */
export interface Takeover {
  readonly player: number;
  readonly from: number;
}

/** How `offline` replays a Run: its Match options (default `MATCH`), the Tick function (default `stepMatch`) and the Input Delay the peers played at (default 0). */
export interface Replay {
  readonly match?: MatchOptions;
  readonly step?: Step;
  readonly inputDelay?: number;
  /** Called with the Match each Tick of the replay leaves. */
  readonly each?: (m: MatchState) => void;
}

/**
 * The Run stepped offline with the Intents the Players sent and fresh AI Controllers: the Match each Tick left, and what happened. A Player's
 * Intent sent on Tick t is played on Tick t + the Input Delay (idle before), as the Rollback session plays it.
 */
export function offline(tuning: TuningData, lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = [], replay: Replay = {}) {
  const match = replay.match ?? MATCH;
  const step = replay.step ?? stepMatch;
  const delay = replay.inputDelay ?? 0;
  const ais = lineupAis(tuning, lineup, 'Gauntlet', match);
  const fighterOf = (p: number) => lineup.findIndex((s) => s.pilot.kind === 'Player' && s.pilot.player === p);
  const taken = new Map(takeovers.map((d) => [d.player, { from: d.from, ai: takeoverAi(tuning, lineup, 'Gauntlet', fighterOf(d.player)) }]));
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), match));
  const trace = new Map<number, Snap>();
  const hashes = new Map<number, string>();
  /** Every Match event, with the Tick it happened on and the pickups lying before it. */
  const events: { tick: number; event: MatchEvent; pickups: readonly Pickup[] }[] = [];
  for (let t = 1; t <= upTo; t++) {
    // The Takeover Tick: the Fighter is marked away before that Tick's Intents, as the Rollback session does on every peer.
    for (const [p, d] of taken) if (t === d.from) m = takeOverFighter(m, fighterOf(p));
    // Every Fighter of the Match: a Player's slot plays what it sent; any other the AI the Lineup gives it (in a Delver Run, a Pool AI past the party).
    const intents = m.duel.fighters.map((_, i) => {
      const slot = lineup[i];
      if (slot?.pilot.kind !== 'Player') return ais[i]?.intent(m.duel, i) ?? IDLE_INTENT;
      const p = slot.pilot.player;
      const ai = taken.get(p);
      if (ai && t >= ai.from) return ai.ai.intent(m.duel, i);
      return peers[p]!.sent.get(t - delay) ?? IDLE_INTENT;
    });
    const before = m;
    m = step(m, intents, tuning);
    replay.each?.(m);
    trace.set(t, snap(m));
    for (const event of m.events) events.push({ tick: t, event, pickups: before.delver!.pickups });
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, hashValue(m));
  }
  return { trace, hashes, events, state: m };
}

/** Every checksum Tick `peer` recorded equals the offline Run's (from `from` on). Returns how many were compared. */
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
