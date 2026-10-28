/**
 * Dungeon Stage 4, co-op online: two and four Players walk, loot and equip through a Run's Halls over the memory transport
 * (40 ms ± 20 latency), with no teleport. Each peer drives its own Player with the dev autopilot (Hard, with loot), fed its own
 * (possibly predicted) state; what it sends is ordinary Intents, recorded as sent, so the very same Run steps offline.
 *
 * Every peer's Tick function is wrapped to note what the Match each Tick leaves (`trace`: the last version simulated of a Tick is the
 * true one once that Tick is confirmed), so the tests compare the peers Tick by Tick (Hall changes, Door gathering, pickups,
 * Inventories) and not only by checksum. Enemies are one-hit (as gauntlet.test.ts does); the Ticks are capped.
 *
 * `COOP_LONG=1 npx vitest run src/net/coop.test.ts` adds a longer variant (four Players, Halls 1 to 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTuningData, type DungeonEncounter, type TuningData } from '../tuning';
import { createAutopilot, lineupAis, lineupMatch, FLOOR_DIFFICULTY, type Autopilot, type AutopilotLoot, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { arenaOf, createMatch, doorCounters, doorTicksNeeded, dropItem, hashValue, IDLE_INTENT, inExitZone, MAX_TEAM_SIZE, stepMatch, takeOverFighter, TICK_RATE, withGeneratedArena, type Intent, type Inventory, type InventoryRef, type MatchEvent, type MatchOptions, type MatchState, type Mods, type Pickup, type RunState } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena, type ArenaWorld } from '../play/arenaWorlds';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, ROLLBACK_WINDOW, takeoverAi, type RollbackSession, type SessionEvent } from './session';

const NAME = 'gen:greybox:4242';
const TICK_MS = 1000 / TICK_RATE;
const MATCH: MatchOptions = { bestOf: 1, arena: NAME, seed: 9, format: 'Gauntlet' };
const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
const WEAPON = 'Arming Sword';
/** The most Ticks a test may play (a Run to Hall 3 takes a fraction of this). */
const TICK_CAP = 6000;

/** One-hit enemies: any blow that lands fells them, so a Hall is soon cleared. */
function oneHit(t: TuningData): TuningData {
  const weak = (e: DungeonEncounter): DungeonEncounter => ({ enemies: e.enemies.map((x) => ({ ...x, hpScale: 0.01 })) });
  const floors = t.dungeon.floors.map((f) => ({ ...f, encounters: { Fight: f.encounters.Fight.map(weak), Elite: f.encounters.Elite.map(weak) }, boss: weak(f.boss) }));
  return { ...t, dungeon: { ...t.dungeon, floors } };
}

/** Each peer loads its own Tuning Data and builds the Run's first Arena from the name, as the game does. */
const peerTuning = (): TuningData => withGeneratedArena(oneHit(loadTuningData()), NAME).tuning;

/** The Halls entered so far (1 the first). */
const hallsIn = (m: { readonly run?: { readonly path: readonly unknown[] } | null } | null | undefined): number => m?.run?.path.length ?? 0;

/** The host and `players - 1` guests on Team 0, then the MAX_TEAM_SIZE Floor slots: the Lineup a Gauntlet Lobby builds. */
function runLineup(players: number): Lineup {
  const own = Array.from({ length: players }, (_, p) => ({ team: 0, pilot: { kind: 'Player', player: p as PlayerNumber } }) as const);
  const floors = Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const);
  return [...own, ...floors];
}

/** The Match stepped one Tick: the Tick function of every peer and of the offline Run. */
type Step = typeof stepMatch;

/** What is kept of the Match each Tick leaves (a long Run would not fit in memory whole): its Run, its events, the Fighters' Inventories and Mods, and who the Doors count. */
interface Snap {
  readonly tick: number;
  readonly run: RunState;
  readonly events: readonly MatchEvent[];
  readonly fighters: readonly { readonly inventory?: Inventory; readonly mods?: Mods }[];
  /** `doorCounters` with the Takeovers (`run.away`) taken into account, and without. */
  readonly counting: readonly number[];
  readonly countingEveryone: readonly number[];
}

const snap = (m: MatchState): Snap => ({
  tick: m.tick,
  run: m.run!,
  events: m.events,
  fighters: m.duel.fighters.map((f) => ({ inventory: f.inventory, mods: f.mods })),
  counting: doorCounters(m.config, m.duel.fighters, m.run!.away),
  countingEveryone: doorCounters(m.config, m.duel.fighters),
});

interface Peer {
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
  gone: boolean;
}

interface RunOptions {
  readonly players: number;
  readonly net?: MemoryTransportOptions;
  /** Per Player: what its autopilot does with loot (default 'take'). */
  readonly loot?: (player: number) => AutopilotLoot | null;
  /** Per Player: a Tick function in place of `stepMatch` (to inject divergence). */
  readonly step?: (player: number) => Step | undefined;
  /** Per Player: the Intent for Tick `tick` instead of the autopilot's (null: the autopilot's). Reads the peer's own state. */
  readonly intent?: (player: number, state: MatchState, tick: number) => Intent | null;
}

/** The autopilot's Intent for the local Fighter, as `playerVsPlayer` asks it: from the session's own (possibly predicted) state. */
function autopilotIntent(peer: Peer): Intent {
  const { session } = peer;
  const state = session.state;
  if (!state || session.localFighter < 0 || state.status.status === 'Over') return IDLE_INTENT;
  peer.autopilot.watch(state);
  return peer.autopilot.intent(state.duel, session.localFighter);
}

function startRun(o: RunOptions) {
  // The session pings on the wall clock, and each ping draws from the transport's jitter: a virtual clock keeps a Run the same from one run to the next.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const lineup = runLineup(o.players);
  const pairs: MemoryTransportPair[] = Array.from({ length: o.players - 1 }, (_, i) => createMemoryTransportPair({ ...(o.net ?? NET), seed: 4 + i }));
  const tunings = Array.from({ length: o.players }, () => peerTuning());
  const traces = tunings.map(() => new Map<number, Snap>());
  const stepOf = (k: number): Step => (m, intents, t) => {
    const next = (o.step?.(k) ?? stepMatch)(m, intents, t);
    traces[k]!.set(next.tick, snap(next));
    return next;
  };
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match: MATCH, lineup, weapon: WEAPON, step: stepOf(0) });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: stepOf(i + 1) }));
  const peers: Peer[] = [host, ...guests].map((session, k) => {
    const peer: Peer = {
      player: k,
      session,
      tuning: tunings[k]!,
      worlds: createArenaWorlds(tunings[k]!),
      warmed: new Set(),
      autopilot: createAutopilot(tunings[k]!, 'Hard', [0], o.loot ? o.loot(k) : 'take'),
      sent: new Map(),
      events: [],
      sums: new Map(),
      trace: traces[k]!,
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
      const r = session.tick(intent);
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
interface Takeover {
  readonly player: number;
  readonly from: number;
}

/** The Run stepped offline with the Intents the Players sent and fresh AI Controllers: the Match each Tick left, and what happened. */
function offline(tuning: TuningData, lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = []) {
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


/** The Tick each Hall after the first began on (by `run.path`), in the trace of one peer (or the offline Run). */
function hallStarts(trace: ReadonlyMap<number, Snap>, upTo: number): number[] {
  const starts: number[] = [];
  for (let t = 2; t <= upTo; t++) if (hallsIn(trace.get(t)) !== hallsIn(trace.get(t - 1))) starts.push(t);
  return starts;
}

/**
 * Every Tick in `(from, upTo]` on which a peer's Match differs from the offline Run's, in what a Run must agree on: the Hall and its phase,
 * the Door gathering (`doorTicks`), the pickups lying and taken, the Takeovers, the Team 0 Fighters' Inventories and Mods, and the
 * Match events (Doors taken, items dropped and taken). Empty when they agree.
 */
function disagreements(peers: readonly Peer[], expected: ReadonlyMap<number, Snap>, upTo: number, from = 0): string[] {
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
function equipTicks(trace: ReadonlyMap<number, Snap>, upTo: number, p: number): number[] {
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
function handOver(dropper: number): NonNullable<RunOptions['intent']> {
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

afterEach(() => vi.restoreAllMocks());

describe('co-op Runs over the memory transport: walking, looting and equipping, no teleport', () => {
  for (const players of [2, 4]) {
    it(`${players} Players reach Hall 3: checksums, Hall changes, Door gathering, pickups and Inventories agree on every peer and offline`, () => {
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
    }, 300_000);
  }
});

describe('co-op Runs across a resync and an AI Takeover', () => {
  it('a guest forced to diverge mid-Hall, with pickups lying and an Inventory changed, resyncs to the host and stays in step with no Desync after', () => {
    const relic = loadTuningData().relics[0]!.name;
    // On the guest only: some way into the first Cleared Hall (its drops lying) its own Fighter gains a Relic and one of the pickups reads taken.
    let driftAt: number | null = null;
    const drift: Step = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (hallsIn(next) !== 1 || next.run?.phase !== 'Cleared') return next;
      driftAt ??= next.tick + 40;
      if (next.tick !== driftAt) return next;
      const fighters = next.duel.fighters.map((f, i) => (i === 1 && f.inventory ? { ...f, inventory: { ...f.inventory, relics: [...f.inventory.relics, relic] } } : f));
      const pickups = next.run!.pickups.map((p, i) => (i === 0 ? { ...p, taken: true } : p));
      return { ...next, duel: { ...next.duel, fighters }, run: { ...next.run!, pickups } };
    };
    const r = startRun({ players: 2, step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    let hall2: number | null = null;
    r.until(
      () => hall2 !== null && r.confirmed() >= hall2 + 150,
      () => {
        if (hall2 === null && hallsIn(r.host.session.state) >= 2) hall2 = r.host.session.currentTick;
      },
    );
    expect(hall2, 'reached Hall 2').not.toBeNull();
    expect(driftAt, 'the guest diverged').not.toBeNull();

    const upTo = r.confirmed();
    const expected = offline(peerTuning(), r.lineup, r.peers, upTo);
    const desync = guest.events.find((e) => e.type === 'Desync') as Extract<SessionEvent, { type: 'Desync' }> | undefined;
    const resynced = guest.events.find((e) => e.type === 'Resynced') as Extract<SessionEvent, { type: 'Resynced' }> | undefined;
    expect(desync, 'the drift was caught').toBeDefined();
    expect(resynced).toBeDefined();
    expect(guest.events.filter((e) => e.type === 'Desync')).toHaveLength(1);
    expect(guest.events.indexOf(resynced!)).toBeGreaterThan(guest.events.indexOf(desync!));
    expect(r.host.events.filter((e) => e.type === 'Desync')).toEqual([]);

    // Its Match did differ: the Relic it did not take, and a pickup the host still had lying...
    const [mine, theirs] = [guest.trace.get(driftAt!)!, expected.trace.get(driftAt!)!];
    expect(mine.fighters[1]!.inventory!.relics.length).toBe(theirs.fighters[1]!.inventory!.relics.length + 1);
    expect(theirs.run.pickups[0]!.taken).toBe(false);
    // ...in a Hall that stood Cleared with pickups lying, when the host's state came.
    const sent = expected.trace.get(resynced!.tick)!;
    expect(sent.run.phase).toBe('Cleared');
    expect(hallsIn(sent)).toBe(1);
    expect(sent.run.pickups.filter((p) => !p.taken).length).toBeGreaterThan(0);
    expect(resynced!.tick).toBeGreaterThan(driftAt!);

    // From the resync on, the guest is the host's and the offline Run's, through the Hall change into Hall 2.
    expect(disagreements([r.host], expected.trace, upTo)).toEqual([]);
    expect(disagreements([guest], expected.trace, upTo, resynced!.tick)).toEqual([]);
    expect(expectChecksums('host', r.host, expected.hashes)).toBeGreaterThan(30);
    expect(expectChecksums('guest', guest, expected.hashes, resynced!.tick)).toBeGreaterThan(20);
    const start2 = hallStarts(expected.trace, upTo)[0]!;
    expect(start2).toBeGreaterThan(resynced!.tick);
    expect(expectChecksums('guest in Hall 2', guest, expected.hashes, start2)).toBeGreaterThan(3);
    expect(guest.session.stats.resyncs).toBe(1);
  }, 300_000);

  it('an AI Takeover mid-Hall while the party gathers: every peer agrees on the Takeover Tick, the Fighter keeps its Inventory and Mods, the others take the Door, the Run goes on in step', () => {
    const r = startRun({ players: 3 });
    const leaver = r.guests[1]!; // Player 2
    const arenaOfHost = () => arenaOf(r.host.tuning, r.host.session.state!.arena);
    let hall2: number | null = null;
    const leftIn: { s: MatchState | null } = { s: null };
    r.until(
      () => hall2 !== null && r.confirmed() >= hall2 + 200,
      (peer) => {
        const s = r.host.session.state;
        if (peer !== r.host || !s) return;
        if (hall2 === null && hallsIn(s) >= 2) hall2 = s.tick;
        // The Cleared Hall, the party gathering at exit 0 (some of the others there, nobody yet the whole party), and the leaver, with a Relic on, still walking: its tab closes.
        const zone = (i: number) => inExitZone(arenaOfHost(), 0, s.duel.fighters[i]!);
        const gathering = s.run!.phase === 'Cleared' && (zone(0) || zone(1)) && !zone(2) && Math.max(...s.run!.doorTicks) === 0;
        if (!leaver.gone && hallsIn(s) <= 2 && gathering && s.duel.fighters[2]!.inventory!.equipped.length > 0) {
          leaver.session.close();
          leaver.gone = true;
          leftIn.s = s;
        }
      },
    );
    expect(leaver.gone, 'the guest left').toBe(true);
    expect(hall2, 'reached Hall 2').not.toBeNull();

    // Every peer still playing hears of it, with the same Takeover Tick.
    const left = r.host.events.find((e) => e.type === 'PlayerLeft') as Extract<SessionEvent, { type: 'PlayerLeft' }>;
    expect(left).toMatchObject({ type: 'PlayerLeft', player: 2 });
    expect(r.guests[0]!.events).toContainEqual(left);
    const takeover = { player: 2, from: left.tick };
    // The host's Tick is ahead of the confirmed one: the Takeover Tick may lie in the past of the state it closed in, which it rolled back over.
    expect(takeover.from).toBeGreaterThan(leftIn.s!.tick - ROLLBACK_WINDOW - 1);

    const upTo = r.confirmed();
    const tuning = peerTuning();
    const expected = offline(tuning, r.lineup, r.peers, upTo, [takeover]);
    const remaining = [r.host, r.guests[0]!];
    for (const p of remaining) {
      expect(expectChecksums(`peer ${p.player}`, p, expected.hashes), `peer ${p.player}`).toBeGreaterThan(30);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      expect(p.session.status).toBe('Running');
    }
    expect(disagreements(remaining, expected.trace, upTo)).toEqual([]);

    // Mid-Hall: the Hall was Cleared and the party gathering when the Takeover Tick came, and no Door had been taken in it.
    const at = expected.trace.get(takeover.from)!;
    const hall = hallsIn(at);
    expect(at.run.phase).toBe('Cleared');
    expect(expected.trace.get(takeover.from - 1)!.run.away).toBeUndefined();
    // From that Tick on the Fighter is marked away, on every peer, and its Inventory and Mods stay as they were through the Hall change.
    const before = expected.trace.get(takeover.from - 1)!.fighters[2]!;
    expect(before.inventory!.equipped.length).toBeGreaterThan(0);
    for (const p of remaining) {
      for (let t = takeover.from; t <= upTo; t++) {
        const m = p.trace.get(t)!;
        expect(m.run.away, `peer ${p.player} @${t}`).toEqual([2]);
        const f = m.fighters[2]!;
        if (f.inventory !== before.inventory || f.mods !== before.mods) {
          expect(f.inventory, `peer ${p.player} @${t}`).toEqual(before.inventory);
          expect(f.mods, `peer ${p.player} @${t}`).toEqual(before.mods);
        }
      }
    }

    // The Door is taken by the remaining Players alone: after the Takeover Tick, waiting on Fighters 0 and 1 only, into the next Hall.
    const door = expected.events.find((e) => e.event.type === 'DoorTaken' && e.tick > takeover.from);
    expect(door, 'the Door was taken after the Takeover').toBeDefined();
    const taken = expected.trace.get(door!.tick)!;
    expect(hallsIn(taken)).toBe(hall);
    expect(taken.counting).toEqual([0, 1]);
    expect(taken.countingEveryone).toEqual([0, 1, 2]);
    const starts = hallStarts(expected.trace, upTo);
    expect(starts.find((t) => t > door!.tick)).toBeDefined();
    for (const p of remaining) expect(hallStarts(p.trace, upTo)).toEqual(starts);
    expect(hallsIn(expected.state)).toBeGreaterThan(hall);
    expect(expectChecksums('after the Door', remaining[1]!, expected.hashes, door!.tick)).toBeGreaterThan(5);
    expect(expected.state.run!.away).toEqual([2]);
  }, 300_000);
});

describe.skipIf(!process.env.COOP_LONG)('co-op Runs: the long variant (COOP_LONG=1)', () => {
  it('four Players on the autopilot play Halls 1 to 5 with loot, a hand-over and no Desync', () => {
    const r = startRun({ players: 4, intent: handOver(1) });
    let hall5: number | null = null;
    r.until(
      () => hall5 !== null && r.confirmed() >= hall5 + 120,
      (peer) => {
        if (hall5 === null && peer === r.host && hallsIn(peer.session.state) >= 5) hall5 = peer.session.currentTick;
      },
      40_000,
    );
    const at = r.host.session.state!;
    expect(hall5, `reached Hall 5 (Hall ${hallsIn(at)}, ${at.run!.phase}, Tick ${at.tick})`).not.toBeNull();
    const upTo = r.confirmed();
    const expected = offline(peerTuning(), r.lineup, r.peers, upTo);
    for (const p of r.peers) {
      expect(expectChecksums(`peer ${p.player}`, p, expected.hashes)).toBeGreaterThan(upTo / CHECKSUM_INTERVAL / 2);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    }
    expect(disagreements(r.peers, expected.trace, upTo)).toEqual([]);
  }, 1_800_000);
});
