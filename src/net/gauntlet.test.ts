/**
 * A Gauntlet Run online (docs/plans/gauntlet.md, Stage 4; a Dungeon Run since docs/plans/dungeon.md): two to four
 * Players on Team 0 through a Floor's Halls, over the memory transport with latency and jitter, as `randomMap.test.ts`
 * plays a Random Map. Nothing new crosses the wire during play: every peer builds each Hall (its Arena, its enemies and
 * their scaled HP) from the Run's options, the Lineup and Tuning Data, and warms the next Hall's Arena itself.
 *
 * The Players fight on a Hard AI autopilot, each on its own peer's (possibly predicted) state: what they send is
 * ordinary Intents, recorded as sent, so the Run can be stepped offline with the very same Intents. Until the Hall AI
 * walks a party to a Door, every peer's Tick function (and the offline one) puts a cleared Hall's living Players in its
 * first exit's zone (`walkOn`): a pure function of the state, so it rolls back and agrees like the rest.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, type DungeonEncounter, type TuningData } from '../tuning';
import { createAiController, FLOOR_DIFFICULTY, lineupAis, lineupMatch, lineupPlayers, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { arenaOf, createMatch, enemyMaxHp, exitDoor, hallOf, hallRoster, hashValue, IDLE_INTENT, inDuel, inExitZone, MAX_TEAM_SIZE, presentPlayers, runCleared, runHall, runPlayers, stepMatch, takeOverFighter, TICK_RATE, withGeneratedArena, type Intent, type MatchOptions, type MatchState } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena, type ArenaWorld } from '../play/arenaWorlds';
import { GuestLobby, HostLobby } from '../lobby';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, takeoverAi, type RollbackSession, type SessionEvent } from './session';
import { parseNetMessage, PROTOCOL_VERSION, type HelloMessage } from './messages';

const NAME = 'gen:greybox:4242';
/** The first three Halls' Arenas, taking each Hall's first exit (all three Fights for this Run seed). */
const HALLS = [0, 1, 2].reduce<{ index: number; arenas: string[] }>(
  (at, row) => {
    const hall = hallOf(loadTuningData(), NAME, { floor: 1, row, index: at.index });
    return { index: hall.exits[0]!, arenas: [...at.arenas, hall.arena] };
  },
  { index: 0, arenas: [] },
).arenas;
const TICK_MS = 1000 / TICK_RATE;
const MATCH: MatchOptions = { bestOf: 1, arena: NAME, seed: 9, format: 'Gauntlet' };
const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
const WEAPON = 'Arming Sword';

/** One-hit enemies: any blow that lands fells them, so a Hall is soon cleared. */
function oneHit(t: TuningData): TuningData {
  const weak = (e: DungeonEncounter): DungeonEncounter => ({ enemies: e.enemies.map((x) => ({ ...x, hpScale: 0.01 })) });
  const floors = t.dungeon.floors.map((f) => ({ ...f, encounters: { Fight: f.encounters.Fight.map(weak), Elite: f.encounters.Elite.map(weak) }, boss: weak(f.boss) }));
  return { ...t, dungeon: { ...t.dungeon, floors } };
}

/** The Tick function of every peer and of the offline Run: a cleared Hall's living Players are put in its first exit's zone, then `stepMatch`. */
const walkOn: typeof stepMatch = (m, intents, t) => {
  if (m.run?.phase !== 'Cleared') return stepMatch(m, intents, t);
  const zone = arenaOf(t, m.arena).doors[exitDoor(0)]!.zone;
  const c = { x: zone.reduce((a, p) => a + p.x, 0) / zone.length, z: zone.reduce((a, p) => a + p.z, 0) / zone.length };
  const players = presentPlayers(m.config, m.run.away);
  const fighters = m.duel.fighters.map((f, i) => (players.includes(i) && inDuel(f) ? { ...f, position: { x: c.x + 0.5 * ((i % 2) - 0.5), z: c.z + 0.5 * ((i >> 1) - 0.5) }, y: zone[0]!.y } : f));
  return stepMatch({ ...m, duel: { ...m.duel, fighters } }, intents, t);
};

/** The Halls entered so far (1 the first). */
const hallsIn = (m: MatchState | null | undefined): number => m?.run?.path.length ?? 0;

/** Each peer loads its own Tuning Data and builds the Run's first Arena from the name, as the game does. */
const peerTuning = (tune: (t: TuningData) => TuningData = oneHit): TuningData => withGeneratedArena(tune(loadTuningData()), NAME).tuning;

/** The host and `players - 1` guests on Team 0, then the MAX_TEAM_SIZE Floor slots: the Lineup a Gauntlet Lobby builds. */
function runLineup(players: number): Lineup {
  const own = Array.from({ length: players }, (_, p) => ({ team: 0, pilot: { kind: 'Player', player: p as PlayerNumber } }) as const);
  const floors = Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const);
  return [...own, ...floors];
}

interface Peer {
  readonly session: RollbackSession;
  readonly tuning: TuningData;
  readonly worlds: (name: string) => ArenaWorld;
  /** The Arenas this peer built ahead (`arenaToWarm`), as the game does. */
  readonly warmed: Set<string>;
  /** The Intents this peer's Player sent, by Tick. */
  readonly sent: Map<number, Intent>;
  readonly events: SessionEvent[];
  /** The checksum this peer recorded for each confirmed checksum Tick (the latest, after any resync). */
  readonly sums: Map<number, string>;
  /** The autopilot, fresh for each Hall. */
  pilot: { duel: number; ai: Controller } | null;
  /** This peer builds the next Hall ahead (the game always does; a test may hold it back). */
  warm: boolean;
  gone: boolean;
}

interface RunOptions {
  readonly players: number;
  readonly net?: MemoryTransportOptions;
  /** Per peer (0: the host): its own Tuning Data. */
  readonly tuning?: (peer: number) => TuningData;
  /** Per peer: a Tick function in place of `stepMatch` (to inject divergence). */
  readonly step?: (peer: number) => typeof stepMatch | undefined;
  /** Per peer: the Intent for Tick `tick` instead of the autopilot's (null: the autopilot's). */
  readonly intent?: (peer: number, state: MatchState, tick: number) => Intent | null;
}

/** The autopilot's Intent: a Hard AI fighting for the local Fighter while a Hall is on; idle in the fade between Halls. */
function autopilot(peer: Peer): Intent {
  const { session } = peer;
  const state = session.state;
  if (!state || session.localFighter < 0 || state.nextDuelTick !== null || state.status.status === 'Over') return IDLE_INTENT;
  if (peer.pilot?.duel !== state.duelNumber) peer.pilot = { duel: state.duelNumber, ai: createAiController(peer.tuning, 'Hard') };
  return peer.pilot.ai.intent(state.duel, session.localFighter);
}

function startRun(o: RunOptions) {
  const lineup = runLineup(o.players);
  const pairs: MemoryTransportPair[] = Array.from({ length: o.players - 1 }, (_, i) => createMemoryTransportPair({ ...(o.net ?? NET), seed: 4 + i }));
  const tunings = Array.from({ length: o.players }, (_, k) => o.tuning?.(k) ?? peerTuning());
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match: MATCH, lineup, weapon: WEAPON, step: o.step?.(0) ?? walkOn });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: o.step?.(i + 1) ?? walkOn }));
  const peers: Peer[] = [host, ...guests].map((session, k) => {
    const peer: Peer = {
      session,
      tuning: tunings[k]!,
      worlds: createArenaWorlds(tunings[k]!),
      warmed: new Set(),
      sent: new Map(),
      events: [],
      sums: new Map(),
      pilot: null,
      warm: true,
      gone: false,
    };
    session.onEvent((e) => peer.events.push(e));
    return peer;
  });
  const live = () => peers.filter((p) => !p.gone);
  const confirmed = () => Math.min(...live().map((p) => p.session.confirmedTick));
  const frame = (each?: (peer: Peer, k: number, before: number, rolledBack: number) => void) => {
    for (const p of pairs) p.advance(TICK_MS);
    peers.forEach((peer, k) => {
      if (peer.gone) return;
      const { session } = peer;
      const tick = session.currentTick + 1;
      const intent = (session.state && o.intent?.(k, session.state, tick)) ?? autopilot(peer);
      const before = session.currentTick;
      const r = session.tick(intent);
      if (r.advanced) peer.sent.set(session.currentTick, intent);
      each?.(peer, k, before, r.rolledBack);
      // The game builds the next Hall's Arena ahead, on every peer (`warmNextArena`).
      const next = session.state && arenaToWarm(session.state, peer.tuning);
      if (next && peer.warm && !peer.warmed.has(next)) {
        warmArena(peer.worlds, peer.tuning, next);
        peer.warmed.add(next);
      }
      // Each peer keeps only its recent checksums: note them as they are confirmed (again after a resync).
      const c = session.confirmedTick;
      for (let t = c - (c % CHECKSUM_INTERVAL); t > 0 && t > c - 600; t -= CHECKSUM_INTERVAL) {
        const sum = session.checksumAt(t);
        if (sum !== undefined) peer.sums.set(t, sum);
      }
    });
  };
  /** Frames until `done`, or the Run ends, or the budget runs out. */
  const until = (done: () => boolean, each?: Parameters<typeof frame>[0], budget = 30_000) => {
    for (let i = 0; i < budget && !done(); i++) frame(each);
  };
  return { lineup, pairs, peers, host: peers[0]!, guests: peers.slice(1), confirmed, frame, until };
}

/** A Player who left: the AI drives their Fighter from `from` on. */
interface Takeover {
  readonly player: number;
  readonly from: number;
}

/**
 * The Run stepped offline with the Intents the Players sent and fresh AI Controllers (a Hall AI on each Team 1 slot,
 * the takeover's Ally AI for a Player who left): its hash at every checksum Tick up to `upTo`, and where each Hall began and was cleared.
 */
function offline(tuning: TuningData, lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = []) {
  const ais = lineupAis(tuning, lineup, 'Gauntlet', MATCH);
  const taken = new Map(takeovers.map((d) => [d.player, { from: d.from, ai: takeoverAi(tuning, lineup, 'Gauntlet', lineup.findIndex((s) => s.pilot.kind === 'Player' && s.pilot.player === d.player)) }]));
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), MATCH));
  const hashes = new Map<number, string>();
  /** Per Hall (1 the first entered): the Tick it was cleared and the Tick it began. */
  const clearedAt = new Map<number, number>();
  const startedAt = new Map<number, number>([[1, 0]]);
  for (let t = 1; t <= upTo; t++) {
    // The Takeover Tick: the Fighter is marked away before that Tick's Intents, as the Rollback session does on every peer.
    for (const [p, d] of taken) if (t === d.from) m = takeOverFighter(m, lineup.findIndex((s) => s.pilot.kind === 'Player' && s.pilot.player === p));
    const intents = lineup.map((slot, i) => {
      if (slot.pilot.kind !== 'Player') return (ais[i] as Controller).intent(m.duel, i);
      const p = slot.pilot.player;
      const ai = taken.get(p);
      if (ai && t >= ai.from) return ai.ai.intent(m.duel, i);
      return peers[p]!.sent.get(t) ?? IDLE_INTENT;
    });
    const before = m;
    m = walkOn(m, intents, tuning);
    if (before.run!.phase === 'Fighting' && m.run!.phase !== 'Fighting') clearedAt.set(hallsIn(m), t);
    if (hallsIn(m) !== hallsIn(before)) startedAt.set(hallsIn(m), t);
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, hashValue(m));
  }
  return { hashes, clearedAt, startedAt, state: m };
}

/** Every checksum Tick in `ticks` that `peer` recorded equals the offline Run's (from `from` on). Returns how many were compared. */
function expectChecksums(name: string, peer: Peer, expected: ReadonlyMap<number, string>, from = 0, to = Infinity): number {
  let checked = 0;
  for (const [tick, hash] of expected) {
    if (tick <= from || tick > to) continue;
    const sum = peer.sums.get(tick);
    if (sum === undefined) continue;
    expect(sum, `${name} @${tick}`).toBe(hash);
    checked++;
  }
  return checked;
}

/** The enemies in the current Hall: each Team 1 slot's max HP, null for a Benched one. */
const enemyHp = (m: MatchState) => m.duel.fighters.flatMap((f) => (f.team === 1 ? [f.benched ? null : f.maxHp] : []));

describe('a Gauntlet Run online', () => {
  for (const players of [2, 3, 4]) {
    it(`${players} Players with one-hit enemies play Halls 1 to 3: every checksum on every peer equals the Run stepped offline, and each peer built each Hall itself`, () => {
      const r = startRun({ players });
      // Into Hall 3, and a while on into it, every peer having confirmed that far.
      let hall3: number | null = null;
      r.until(() => hall3 !== null && r.confirmed() >= hall3 + 300, (peer) => {
        if (hall3 === null && peer === r.host && hallsIn(peer.session.state) === 3) hall3 = peer.session.currentTick;
      });
      expect(hall3, 'reached Hall 3').not.toBeNull();
      for (const p of r.peers) expect(p.session.status).toBe('Running');

      const upTo = r.confirmed();
      const expected = offline(peerTuning(), r.lineup, r.peers, upTo);
      expect(expected.state.run).toMatchObject({ floor: 1, row: 2 });
      expect(runCleared(expected.state.run!).halls).toBeGreaterThanOrEqual(2);
      expect(expected.state.status.status).toBe('InProgress');
      r.peers.forEach((p, k) => expect(expectChecksums(k === 0 ? 'host' : `guest ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(20));
      for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);

      // Each Hall on its own Arena, which every peer built for itself: different objects, equal hashes.
      for (const p of r.peers) expect(p.session.state).toMatchObject({ arena: HALLS[2], run: { row: 2 }, config: { arena: NAME, humans: players } });
      for (const name of HALLS) {
        const built = r.peers.map((p) => arenaOf(p.tuning, name));
        expect(new Set(built).size).toBe(players);
        expect(new Set(built.map((a) => hashValue(a))).size).toBe(1);
      }
      // ...and each built Halls 2 and 3 ahead, in the fade before them (none of it on the wire).
      for (const p of r.peers) expect([...p.warmed]).toEqual(HALLS.slice(1));
    }, 240_000);
  }

  it('every peer gives the enemies the same HP, scaled by the humans the start message carries', () => {
    for (const players of [2, 3, 4]) {
      const r = startRun({ players });
      r.until(() => r.peers.every((p) => p.session.status === 'Running'), undefined, 200);
      const hall1 = hallRoster(r.host.tuning, r.host.session.state!.config, { floor: 1, row: 0, index: 0 }).map((e) => e && enemyMaxHp(r.host.tuning, 0.01, players, 0));
      for (const p of r.peers) {
        expect(p.session.state!.config.humans).toBe(players);
        expect(enemyHp(p.session.state!)).toEqual(hall1);
      }
      expect(hall1[0]).toBeCloseTo(r.host.tuning.fighter.maxHp * 0.01 * (1 + r.host.tuning.dungeon.perPlayerHp * (players - 1)));
    }

    // The host's start message: the Run's Format and its humans in the Match options (weapons and teams stay out).
    const tuning = peerTuning();
    const lineup = runLineup(2);
    const pair = createMemoryTransportPair(NET);
    const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup, weapon: WEAPON });
    const heard: HelloMessage[] = [];
    pair.b.onMessage((m) => {
      const parsed = parseNetMessage(m);
      if (parsed?.type === 'hello' && parsed.match) heard.push(parsed);
    });
    pair.b.send({ type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: tuningDataHash(tuning), weapon: WEAPON });
    for (let i = 0; i < 20; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
    }
    expect(heard.length).toBeGreaterThan(0);
    expect(heard[0]!.match).toEqual({ bestOf: 1, arena: NAME, seed: 9, format: 'Gauntlet', humans: 2 });
    expect(lineupPlayers(heard[0]!.lineup!)).toBe(2);
  });

  it('a guest leaving in Hall 2 is taken over by a Normal Ally AI on every peer; the Run goes on in step, and Hall 3 keeps the starting humans’ enemy HP', () => {
    const r = startRun({ players: 3 });
    const leaver = r.guests[1]!; // Player 2
    let hall3: number | null = null;
    r.until(() => hall3 !== null && r.confirmed() >= hall3 + 300, (peer) => {
      const s = r.host.session.state;
      // Some way into Hall 2, the guest closes its tab.
      if (!leaver.gone && hallsIn(s) === 2 && s!.run!.phase === 'Fighting' && s!.duel.tick > 30) {
        leaver.session.close();
        leaver.gone = true;
      }
      if (hall3 === null && peer === r.host && hallsIn(s) === 3) hall3 = s!.tick;
    });
    expect(leaver.gone).toBe(true);
    expect(hall3, 'reached Hall 3').not.toBeNull();

    // Every peer still playing hears of it, with the same takeover Tick, in Hall 2.
    const left = r.host.events.find((e) => e.type === 'PlayerLeft');
    expect(left).toMatchObject({ type: 'PlayerLeft', player: 2 });
    expect(r.guests[0]!.events).toContainEqual(left);
    const takeover = { player: 2, from: (left as Extract<SessionEvent, { type: 'PlayerLeft' }>).tick };

    const upTo = r.confirmed();
    const expected = offline(peerTuning(), r.lineup, r.peers, upTo, [takeover]);
    expect(expected.startedAt.get(2)!).toBeLessThan(takeover.from);
    expect(expected.startedAt.get(3)!).toBeGreaterThan(takeover.from);
    for (const [k, p] of [r.host, r.guests[0]!].entries()) {
      expect(expectChecksums(`peer ${k}`, p, expected.hashes)).toBeGreaterThan(20);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
      // The Run was started by three humans, and its Halls stay scaled for three.
      const s = p.session.state!;
      expect(s.run!.row).toBe(2);
      expect(s.config.humans).toBe(3);
      expect(enemyHp(s)).toEqual(hallRoster(p.tuning, s.config, runHall(s.run!)).map((e) => e && enemyMaxHp(p.tuning, 0.01, 3, 2)));
      expect(enemyHp(s).filter((hp) => hp !== null).length).toBeGreaterThan(0);
    }
  }, 240_000);

  it('a guest forced to resync while the first Hall stands cleared, before it built the next Hall, catches up with no Desync after', () => {
    // On the guest only: every time it simulates the Tick the first Hall is cleared on, Fighter 0's HP drifts by 1.
    const drift: typeof stepMatch = (m, intents, t) => {
      const next = walkOn(m, intents, t);
      if (hallsIn(next) !== 1 || m.run?.phase !== 'Fighting' || next.run?.phase !== 'Cleared') return next;
      const fighters = next.duel.fighters.map((f, j) => (j === 0 ? { ...f, hp: f.hp - 1 } : f));
      return { ...next, duel: { ...next.duel, fighters } };
    };
    const r = startRun({ players: 2, step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    // This guest never builds a Hall ahead: the Hall change Tick builds it (slow, but the same Arena).
    guest.warm = false;
    let hall2: number | null = null;
    r.until(() => hall2 !== null && r.confirmed() >= hall2 + 300, () => {
      const s = r.host.session.state;
      if (hall2 === null && hallsIn(s) === 2) hall2 = s!.tick;
    });
    expect(hall2, 'reached Hall 2').not.toBeNull();

    const expected = offline(peerTuning(), r.lineup, r.peers, r.confirmed());
    const [cleared, next] = [expected.clearedAt.get(1)!, expected.startedAt.get(2)!];
    const desync = guest.events.find((e) => e.type === 'Desync');
    const resynced = guest.events.find((e) => e.type === 'Resynced');
    expect(desync, 'the drift was caught').toBeDefined();
    expect(resynced).toBeDefined();
    // Both while the first Hall stood cleared: after it was cleared, before Hall 2 began.
    for (const e of [desync!, resynced!] as { tick: number }[]) {
      expect(e.tick).toBeGreaterThan(cleared);
      expect(e.tick).toBeLessThan(next);
    }
    expect(guest.events.filter((e) => e.type === 'Desync')).toHaveLength(1);
    expect(guest.events.indexOf(resynced!)).toBeGreaterThan(guest.events.indexOf(desync!));
    expect(guest.warmed.size).toBe(0);

    const after = (resynced as { tick: number }).tick;
    expect(expectChecksums('host', r.host, expected.hashes)).toBeGreaterThan(10);
    expect(expectChecksums('guest', guest, expected.hashes, after)).toBeGreaterThan(10);
    // ...through the Hall change, on an Arena the guest built itself.
    expect(expectChecksums('guest in Hall 2', guest, expected.hashes, next)).toBeGreaterThan(5);
    expect(guest.session.state!.arena).toBe(HALLS[1]);
    expect(arenaOf(guest.tuning, HALLS[1]!)).not.toBe(arenaOf(r.host.tuning, HALLS[1]!));
    expect(hashValue(arenaOf(guest.tuning, HALLS[1]!))).toBe(hashValue(arenaOf(r.host.tuning, HALLS[1]!)));
  }, 240_000);

  it('a Rollback across a Hall change (a late Intent from the Tick before it) re-simulates to the same state', () => {
    // The guest's Intent for the last Tick of the fade differs from the idle one the host predicts, and arrives a few Ticks late.
    const LATE: Intent = { ...IDLE_INTENT, move: { x: 1, z: 0 }, attack: true, face: 1 };
    const r = startRun({
      players: 2,
      net: { latencyMs: 100, jitterMs: 20 },
      intent: (k, s, tick) => (k === 1 && hallsIn(s) === 1 && s.nextDuelTick !== null && tick === s.nextDuelTick - 1 ? LATE : null),
    });
    let hall2: number | null = null;
    /** Host Rollbacks: [first re-simulated Tick, last]. */
    const rollbacks: [number, number][] = [];
    r.until(() => hall2 !== null && r.confirmed() >= hall2 + 300, (peer, _k, before, rolledBack) => {
      const s = r.host.session.state;
      if (peer === r.host && rolledBack > 0) rollbacks.push([before - rolledBack + 1, before]);
      if (hall2 === null && hallsIn(s) === 2) hall2 = s!.tick;
    });
    expect(hall2, 'reached Hall 2').not.toBeNull();

    const expected = offline(peerTuning(), r.lineup, r.peers, r.confirmed());
    const t = expected.startedAt.get(2)!;
    expect(r.guests[0]!.sent.get(t - 1)).toEqual(LATE);
    // The host rolled back from the Tick before the Hall change to past it: re-simulating the change itself.
    expect(rollbacks.some(([from, to]) => from <= t - 1 && to >= t)).toBe(true);
    for (const [k, p] of r.peers.entries()) {
      expect(expectChecksums(`peer ${k}`, p, expected.hashes)).toBeGreaterThan(10);
      expect(expectChecksums(`peer ${k} in Hall 2`, p, expected.hashes, t)).toBeGreaterThan(5);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    }
  }, 240_000);

  it('a guest with a different dungeon.json is refused at connect', () => {
    const otherFloors = (t: TuningData) => ({ ...oneHit(t), dungeon: { ...oneHit(t).dungeon, restHeal: 0.25 } });
    const r = startRun({ players: 2, tuning: (k) => (k === 1 ? peerTuning(otherFloors) : peerTuning()) });
    r.until(() => r.guests[0]!.session.status === 'Refused', undefined, 60);
    expect(r.guests[0]!.session.status).toBe('Refused');
    expect(r.guests[0]!.events).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
  });

  it('a guest on the old protocol is refused, by the Run session and by the Lobby', () => {
    const tuning = peerTuning();
    const pair = createMemoryTransportPair(NET);
    const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup: runLineup(2), weapon: WEAPON });
    const heard: unknown[] = [];
    pair.b.onMessage((m) => heard.push(m));
    pair.b.send({ type: 'hello', protocol: PROTOCOL_VERSION - 1, tuningHash: tuningDataHash(tuning), weapon: WEAPON });
    for (let i = 0; i < 20; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
    }
    expect(heard).toContainEqual(expect.objectContaining({ type: 'refuse', reason: 'ProtocolMismatch' }));
    expect(heard).not.toContainEqual(expect.objectContaining({ type: 'hello', match: expect.anything() }));

    // A Room in Gauntlet turns away a guest on the old protocol before it joins.
    const lobby = new HostLobby(tuning, {
      host: { name: 'Ana', weapon: WEAPON, body: 'monk' },
      settings: { arena: NAME, bestOf: 3, format: 'Gauntlet' },
      online: true,
      ai: { difficulty: 'Normal', weapon: WEAPON },
    });
    const link = createMemoryTransportPair(NET);
    lobby.addGuest(link.a);
    const guest = new GuestLobby(link.b, tuning, { name: 'Bo', weapon: WEAPON, body: 'snake' });
    // The guest's join goes out as an older build would send it.
    let now = 0;
    const realSend = link.b.send.bind(link.b);
    link.b.send = (m: unknown) => realSend(rewriteProtocol(m, PROTOCOL_VERSION - 1));
    for (let i = 0; i < 120; i++) {
      now += TICK_MS;
      link.advance(TICK_MS);
      lobby.pump(now);
      guest.pump(now);
    }
    expect(guest.status).toBe('Closed');
    expect(guest.failure).toMatch(/version/);
    expect(lobby.state.members).toHaveLength(1);
  });
});

/** A message as an older build would send it: its `protocol` (on a Room channel's `join`) set to `protocol`. */
function rewriteProtocol(m: unknown, protocol: number): unknown {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return o.type === 'join' && 'protocol' in o ? { ...o, protocol } : o;
  };
  return walk(m);
}

describe('the AI taking over a Player who left a Run', () => {
  it('leaves the Cleared Hall with the taken-over Fighter anywhere: the Doors no longer wait on it', () => {
    const tuning = peerTuning();
    const lineup = runLineup(2);
    const start = (() => {
      const m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), MATCH));
      expect(runPlayers(m.config)).toEqual([0, 1]);
      // Every enemy is felled, so the Hall is Cleared.
      return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
    })();
    const arena = arenaOf(tuning, start.arena);
    const zone = arena.doors[exitDoor(0)]!.zone;
    const door = { x: zone.reduce((a, p) => a + p.x, 0) / zone.length, z: zone.reduce((a, p) => a + p.z, 0) / zone.length };
    // Player 0 stands in exit 0's zone throughout; Fighter 1 stands where Team 1 started, at no Door.
    const away = arena.spawns.find((sp) => sp.team === 1)!.position;
    const wait = Math.ceil(tuning.dungeon.doorSeconds * TICK_RATE) + 10;
    const hold = (m0: MatchState): MatchState => {
      let m = m0;
      for (let t = 0; t < wait && !m.events.some((e) => e.type === 'DoorTaken'); t++) {
        m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: door, y: zone[0]!.y } : i === 1 ? { ...f, position: { x: away.x, z: away.z }, y: away.y } : f)) } };
        m = stepMatch(m, lineup.map(() => IDLE_INTENT), tuning);
      }
      return m;
    };
    expect(arena.doors.slice(1).some((_, exit) => inExitZone(arena, exit, { position: { x: away.x, z: away.z }, y: away.y }))).toBe(false);
    // While Player 1 is a Player, the Doors wait on it...
    expect(hold(start).run!.phase).toBe('Cleared');
    // ...and once the AI has taken it over, they do not: the Run leaves through exit 0.
    const left = hold(takeOverFighter(start, 1));
    expect(left.run!.phase).toBe('Leaving');
    expect(left.events).toContainEqual(expect.objectContaining({ type: 'DoorTaken', exit: 0 }));
    // Its Ally AI still follows the party (it reads the state, where the other Player is), and nothing about it holds the Run.
    const taken = takeoverAi(tuning, lineup, 'Gauntlet', 1);
    expect(() => taken.intent(left.duel, 1)).not.toThrow();
  }, 60_000);
});
