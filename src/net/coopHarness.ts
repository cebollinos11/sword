/**
 * The harness the co-op Run tests share (`coop.test.ts` and `coop.slow.test.ts`): peers over the memory transport, each driving its own
 * Player with the dev autopilot, compared Tick by Tick with the same Run stepped offline. See `coop.test.ts` for what is being tested.
 */
import { expect, vi } from 'vitest';
import { loadTuningData, type DungeonEncounter, type TuningData } from '../tuning';
import { createAutopilot, createDelverPilot, lineupAis, lineupMatch, FLOOR_DIFFICULTY, type Autopilot, type AutopilotLoot, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { createMatch, doorCounters, doorTicksNeeded, dropItem, hashValue, IDLE_INTENT, MAX_TEAM_SIZE, stepMatch, takeOverFighter, TICK_RATE, withGeneratedArena, type Intent, type Inventory, type InventoryRef, type MatchEvent, type MatchOptions, type MatchState, type Mods, type Pickup, type RunState } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena, type ArenaWorld } from '../play/arenaWorlds';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, takeoverAi, type RollbackSession, type SessionEvent } from './session';

export const NAME = 'gen:greybox:4242';
export const TICK_MS = 1000 / TICK_RATE;
export const MATCH: MatchOptions = { bestOf: 1, arena: NAME, seed: 9, format: 'Gauntlet' };
export const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
export const WEAPON = 'Arming Sword';
/** The most Ticks a test may play (a Run to Hall 3 takes a fraction of this). */
export const TICK_CAP = 6000;

/** One-hit enemies: any blow that lands fells them, so a Hall is soon cleared. */
export function oneHit(t: TuningData): TuningData {
  const weak = (e: DungeonEncounter): DungeonEncounter => ({ enemies: e.enemies.map((x) => ({ ...x, hpScale: 0.01 })) });
  const floors = t.dungeon.floors.map((f) => ({ ...f, encounters: { Fight: f.encounters.Fight.map(weak), Elite: f.encounters.Elite.map(weak) }, boss: weak(f.boss) }));
  return { ...t, dungeon: { ...t.dungeon, floors } };
}

/** Each peer loads its own Tuning Data and builds the Run's first Arena from the name, as the game does. */
export const peerTuning = (): TuningData => withGeneratedArena(oneHit(loadTuningData()), NAME).tuning;

/** The Halls entered so far (1 the first). */
export const hallsIn = (m: { readonly run?: { readonly path: readonly unknown[] } | null } | null | undefined): number => m?.run?.path.length ?? 0;

/** The host and `players - 1` guests on Team 0, then the MAX_TEAM_SIZE Floor slots: the Lineup a Gauntlet Lobby builds. */
export function runLineup(players: number): Lineup {
  const own = Array.from({ length: players }, (_, p) => ({ team: 0, pilot: { kind: 'Player', player: p as PlayerNumber } }) as const);
  const floors = Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const);
  return [...own, ...floors];
}

/** The Match stepped one Tick: the Tick function of every peer and of the offline Run. */
export type Step = typeof stepMatch;

/** What is kept of the Match each Tick leaves (a long Run would not fit in memory whole): its Run, its events, the Fighters' Inventories and Mods, and who the Doors count. */
export interface Snap {
  readonly tick: number;
  /** The Hall-graph Run's progress (undefined in a Delver Run: see `delver`). */
  readonly run: RunState;
  /** A Delver Run's progress (`MatchState.delver`); absent otherwise. */
  readonly delver?: MatchState['delver'];
  readonly events: readonly MatchEvent[];
  readonly fighters: readonly { readonly inventory?: Inventory; readonly mods?: Mods }[];
  /** `doorCounters` with the Takeovers (`run.away`) taken into account, and without. */
  readonly counting: readonly number[];
  readonly countingEveryone: readonly number[];
}

export const snap = (m: MatchState): Snap => ({
  tick: m.tick,
  run: m.run!,
  ...(m.delver ? { delver: m.delver } : {}),
  events: m.events,
  fighters: m.duel.fighters.map((f) => ({ inventory: f.inventory, mods: f.mods })),
  counting: doorCounters(m.config, m.duel.fighters, (m.run ?? m.delver)?.away),
  countingEveryone: doorCounters(m.config, m.duel.fighters),
});

export interface Peer {
  readonly player: number;
  readonly session: RollbackSession;
  readonly tuning: TuningData;
  readonly worlds: (name: string) => ArenaWorld;
  readonly warmed: Set<string>;
  readonly autopilot: Autopilot;
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
  /** Per Player: what its autopilot does with loot (default 'take'). */
  readonly loot?: (player: number) => AutopilotLoot | null;
  /** Per Player: a Tick function in place of `stepMatch` (to inject divergence). */
  readonly step?: (player: number) => Step | undefined;
  /** Per Player: the Intent for Tick `tick` instead of the autopilot's (null: the autopilot's). Reads the peer's own state. */
  readonly intent?: (player: number, state: MatchState, tick: number) => Intent | null;
  /**
   * A Delver Run instead of the Hall-graph Run (docs/plans/delver.md): Match options with `delver: true`, each peer's Fighter on the Delver
   * pilot, and Tuning Data as `tune` makes it (default: as it is). The Run's own checks (`offline`, `disagreements`) are for the Hall-graph Run.
   */
  readonly delver?: { readonly tune?: (t: TuningData) => TuningData };
  /** Time every frame of every peer into `Peer.frames` (wall clock, not the virtual one). */
  readonly timed?: boolean;
}

/** The autopilot's Intent for the local Fighter, as `playerVsPlayer` asks it: from the session's own (possibly predicted) state. */
export function autopilotIntent(peer: Peer): Intent {
  const { session } = peer;
  const state = session.state;
  if (!state || session.localFighter < 0 || state.status.status === 'Over') return IDLE_INTENT;
  peer.autopilot.watch(state);
  return peer.autopilot.intent(state.duel, session.localFighter);
}

export function startRun(o: RunOptions) {
  // The session pings on the wall clock, and each ping draws from the transport's jitter: a virtual clock keeps a Run the same from one run to the next.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const lineup = runLineup(o.players);
  const pairs: MemoryTransportPair[] = Array.from({ length: o.players - 1 }, (_, i) => createMemoryTransportPair({ ...(o.net ?? NET), seed: 4 + i }));
  const match = o.delver ? { ...MATCH, delver: true as const } : MATCH;
  const tunings = Array.from({ length: o.players }, () => (o.delver ? (o.delver.tune ?? ((t: TuningData) => t))(loadTuningData()) : peerTuning()));
  const traces = tunings.map(() => new Map<number, Snap>());
  const counts = tunings.map(() => 0);
  const stepOf = (k: number): Step => (m, intents, t) => {
    counts[k]!++;
    const next = (o.step?.(k) ?? stepMatch)(m, intents, t);
    traces[k]!.set(next.tick, snap(next));
    return next;
  };
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match, lineup, weapon: WEAPON, step: stepOf(0) });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: stepOf(i + 1) }));
  const peers: Peer[] = [host, ...guests].map((session, k) => {
    const peer: Peer = {
      player: k,
      session,
      tuning: tunings[k]!,
      worlds: createArenaWorlds(tunings[k]!),
      warmed: new Set(),
      autopilot: o.delver ? Object.assign(createDelverPilot(tunings[k]!, 'Hard'), { watch() {} }) : createAutopilot(tunings[k]!, 'Hard', [0], o.loot ? o.loot(k) : 'take'),
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
      // The game builds the next Hall's Arena ahead, on every peer (`warmNextArena`).
      const next = session.state && arenaToWarm(session.state, peer.tuning);
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
  return { lineup, pairs, peers, host: peers[0]!, guests: peers.slice(1), confirmed, frame, until };
}

/** A Player who left: the AI drives their Fighter from `from` on. */
export interface Takeover {
  readonly player: number;
  readonly from: number;
}

/** The Run stepped offline with the Intents the Players sent and fresh AI Controllers: the Match each Tick left, and what happened. */
export function offline(tuning: TuningData, lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = []) {
  const ais = lineupAis(tuning, lineup, 'Gauntlet', MATCH);
  const fighterOf = (p: number) => lineup.findIndex((s) => s.pilot.kind === 'Player' && s.pilot.player === p);
  const taken = new Map(takeovers.map((d) => [d.player, { from: d.from, ai: takeoverAi(tuning, lineup, 'Gauntlet', fighterOf(d.player)) }]));
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), MATCH));
  const trace = new Map<number, Snap>();
  const hashes = new Map<number, string>();
  /** Every Match event, with the Tick it happened on and the pickups lying before it. */
  const events: { tick: number; event: MatchEvent; pickups: readonly Pickup[] }[] = [];
  for (let t = 1; t <= upTo; t++) {
    // The Takeover Tick: the Fighter is marked away before that Tick's Intents, as the Rollback session does on every peer.
    for (const [p, d] of taken) if (t === d.from) m = takeOverFighter(m, fighterOf(p));
    const intents = lineup.map((slot, i) => {
      if (slot.pilot.kind !== 'Player') return (ais[i] as Controller).intent(m.duel, i);
      const p = slot.pilot.player;
      const ai = taken.get(p);
      if (ai && t >= ai.from) return ai.ai.intent(m.duel, i);
      return peers[p]!.sent.get(t) ?? IDLE_INTENT;
    });
    const before = m;
    m = stepMatch(m, intents, tuning);
    trace.set(t, snap(m));
    for (const event of m.events) events.push({ tick: t, event, pickups: before.run!.pickups });
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


/** The Tick each Hall after the first began on (by `run.path`), in the trace of one peer (or the offline Run). */
export function hallStarts(trace: ReadonlyMap<number, Snap>, upTo: number): number[] {
  const starts: number[] = [];
  for (let t = 2; t <= upTo; t++) if (hallsIn(trace.get(t)) !== hallsIn(trace.get(t - 1))) starts.push(t);
  return starts;
}

/**
 * Every Tick in `(from, upTo]` on which a peer's Match differs from the offline Run's, in what a Run must agree on: the Hall and its phase,
 * the Door gathering (`doorTicks`), the pickups lying and taken, the Takeovers, the Team 0 Fighters' Inventories and Mods, and the
 * Match events (Doors taken, items dropped and taken). Empty when they agree.
 */
export function disagreements(peers: readonly Peer[], expected: ReadonlyMap<number, Snap>, upTo: number, from = 0): string[] {
  const key = (m: Snap) => JSON.stringify([m.run.path, m.run.phase, m.run.doorTicks, m.run.pickups, m.run.away ?? null, m.fighters.map((f) => [f.inventory ?? null, f.mods ?? null]), m.events]);
  const bad: string[] = [];
  for (const peer of peers) {
    for (let t = from + 1; t <= upTo; t++) {
      const m = peer.trace.get(t);
      if (!m || key(m) !== key(expected.get(t)!)) bad.push(`peer ${peer.player} @${t}`);
    }
  }
  return bad;
}

/** The effective equips of Player `p`'s Fighter in the offline Run: Ticks on which what it wields or has equipped changed (and nothing was taken or dropped). */
export function equipTicks(trace: ReadonlyMap<number, Snap>, upTo: number, p: number): number[] {
  const ticks: number[] = [];
  for (let t = 2; t <= upTo; t++) {
    const [a, b] = [trace.get(t - 1)!.fighters[p]!.inventory, trace.get(t)!.fighters[p]!.inventory];
    if (a && b && (a.weapon !== b.weapon || a.equipped.join() !== b.equipped.join()) && a.weapons.length === b.weapons.length && a.relics.length === b.relics.length) ticks.push(t);
  }
  return ticks;
}

/**
 * Test only: Player `dropper` drops one item it carries once it has taken its own pickups of a Cleared Hall, then holds still on it until another
 * Player has taken it up (a dropper may not take its drop back before it steps off it). A shared pickup for the others' autopilots to walk onto.
 * What it sends is recorded like any Intent, so the offline Run replays it.
 */
export function handOver(dropper: number): NonNullable<RunOptions['intent']> {
  let dropped = false;
  return (player, state) => {
    const run = state.run;
    const me = state.duel.fighters[player];
    if (player !== dropper || !run || run.phase !== 'Cleared' || !me?.inventory) return null;
    if (run.pickups.some((p) => !p.taken && p.by === player)) {
      dropped = true;
      return IDLE_INTENT;
    }
    if (dropped || run.pickups.some((p) => !p.taken && p.owner === player)) return null;
    const inv = me.inventory;
    const refs: InventoryRef[] = [...inv.relics.map((_, slot) => ({ kind: 'relic' as const, slot })), ...inv.weapons.map((_, slot) => ({ kind: 'weapon' as const, slot }))];
    const ref = refs.find((r) => dropItem(inv, r) !== null);
    return ref ? { ...IDLE_INTENT, drop: ref, face: null } : null;
  };
}


/** `players` Players reach Hall 3: checksums, Hall changes, Door gathering, pickups and Inventories agree on every peer and offline. */
export function reachHall3(players: number): void {
  const r = startRun({ players, intent: handOver(0) });
  let hall3: number | null = null;
  r.until(
    () => hall3 !== null && r.confirmed() >= hall3 + 90,
    (peer) => {
      if (hall3 === null && peer === r.host && hallsIn(peer.session.state) >= 3) hall3 = peer.session.currentTick;
    },
  );
  expect(hall3, 'reached Hall 3').not.toBeNull();
  for (const p of r.peers) expect(p.session.status).toBe('Running');

  const upTo = r.confirmed();
  const tuning = peerTuning();
  const expected = offline(tuning, r.lineup, r.peers, upTo);
  expect(hallsIn(expected.state)).toBeGreaterThanOrEqual(3);
  expect(expected.state.status.status).toBe('InProgress');

  // Every checksum on every peer is the offline Run's, and nobody desynced.
  r.peers.forEach((p, k) => expect(expectChecksums(`peer ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2));
  for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
  // Tick by Tick, the peers are in the offline Run's state where it matters.
  expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);

  // Hall changes on the same Tick on every peer.
  const starts = hallStarts(expected.trace, upTo);
  expect(starts).toHaveLength(2);
  for (const p of r.peers) expect(hallStarts(p.trace, upTo)).toEqual(starts);

  // Door gathering: each Door was taken after the whole party had stood in its zone for doorSeconds, the same one on every peer.
  const doors = expected.events.filter((e) => e.event.type === 'DoorTaken');
  expect(doors).toHaveLength(2);
  for (const d of doors) {
    const gathered = expected.trace.get(d.tick)!.run.doorTicks;
    expect(Math.max(...gathered)).toBeGreaterThanOrEqual(doorTicksNeeded(tuning));
    expect(d.tick).toBeLessThan(starts[doors.indexOf(d)]!);
    for (const p of r.peers) expect(p.trace.get(d.tick)!.run.doorTicks).toEqual(gathered);
  }

  // Pickups: each Player took its own (or a shared drop), never another's, and everyone took some.
  const taking = expected.events
    .filter((e) => e.event.type === 'ItemTaken')
    .map((e) => {
      const taken = e.event as Extract<MatchEvent, { type: 'ItemTaken' }>;
      return { tick: e.tick, fighter: taken.fighter, id: taken.id, owner: e.pickups.find((p) => p.id === taken.id)!.owner };
    });
  for (const t of taking) expect(t.owner === null || t.owner === t.fighter, `Fighter ${t.fighter} took pickup ${t.id} @${t.tick}`).toBe(true);
  for (let p = 0; p < players; p++) expect(taking.filter((t) => t.fighter === p && t.owner === p).length, `Player ${p} took its own`).toBeGreaterThanOrEqual(1);

  // Equips: every Player equipped at least once (an Intent that changed what it wields or wears), as the autopilot sent it.
  for (let p = 0; p < players; p++) {
    expect(equipTicks(expected.trace, upTo, p).length, `Player ${p} equipped`).toBeGreaterThanOrEqual(1);
    expect([...r.peers[p]!.sent.values()].some((i) => i.equip !== undefined && i.equip !== null)).toBe(true);
  }

  // A drop (a shared pickup) taken up by another Player than the one who dropped it.
  const dropped = expected.events.find((e) => e.event.type === 'ItemDropped');
  expect(dropped, 'someone dropped').toBeDefined();
  const dropper = (dropped!.event as { fighter: number }).fighter;
  expect(dropper).toBe(0);
  const dropId = expected.trace.get(dropped!.tick)!.run.pickups.at(-1)!.id;
  const handed = taking.find((t) => t.id === dropId);
  expect(handed, 'the drop was taken up').toBeDefined();
  expect(handed!.fighter).not.toBe(dropper);
  expect(handed!.tick).toBeGreaterThan(dropped!.tick);
  expect(handed!.owner).toBeNull();

  // Inventories (and Mods) equal on every peer, and the offline Run's, at the last Tick they all confirmed.
  const inventories = (m: Snap) => m.fighters.filter((f) => f.inventory).map((f) => ({ inventory: f.inventory, mods: f.mods }));
  for (const p of r.peers) expect(inventories(p.trace.get(upTo)!)).toEqual(inventories(expected.trace.get(upTo)!));
  expect(inventories(expected.trace.get(upTo)!).some((f) => f.inventory!.relics.length > 0)).toBe(true);
}
