/**
 * A Gauntlet Run online (docs/plans/gauntlet.md, Stage 4): two or three Players on Team 0 against the Floors, over the
 * memory transport with latency and jitter, as `randomMap.test.ts` plays a Random Map. Nothing new crosses the wire
 * during play: every peer builds each Floor (its Arena, its enemies and their scaled HP) from the Run's options, the
 * Lineup and Tuning Data, and warms the next Floor's Arena itself.
 *
 * The Players fight on a Hard AI autopilot, each on its own peer's (possibly predicted) state: what they send is
 * ordinary Intents, recorded as sent, so the Run can be stepped offline with the very same Intents.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, type TuningData } from '../tuning';
import { createAiController, FLOOR_DIFFICULTY, lineupAis, lineupMatch, lineupPlayers, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { arenaOf, createMatch, enemyMaxHp, floorRoster, hashValue, IDLE_INTENT, MAX_TEAM_SIZE, nextArenaName, stepMatch, TICK_RATE, withGeneratedArena, type Intent, type MatchOptions, type MatchState } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena, type ArenaWorld } from '../play/arenaWorlds';
import { GuestLobby, HostLobby } from '../lobby';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, TAKEOVER_DIFFICULTY, type RollbackSession, type SessionEvent } from './session';
import { parseNetMessage, PROTOCOL_VERSION, type HelloMessage } from './messages';

const NAME = 'gen:greybox:4242';
const FLOORS = [NAME, nextArenaName(NAME), nextArenaName(nextArenaName(NAME))];
const TICK_MS = 1000 / TICK_RATE;
const MATCH: MatchOptions = { bestOf: 1, arena: NAME, seed: 9, format: 'Gauntlet' };
const NET: MemoryTransportOptions = { latencyMs: 40, jitterMs: 20 };
const WEAPON = 'Arming Sword';

/** One-hit enemies: any blow that lands fells them, so a Floor is soon cleared. */
function oneHit(t: TuningData): TuningData {
  const floors = t.gauntlet.floors.map((f) => ({ ...f, enemies: f.enemies.map((e) => ({ ...e, hpScale: 0.01 })) }));
  return { ...t, gauntlet: { ...t.gauntlet, floors } };
}

/** Each peer loads its own Tuning Data and builds Floor 1's Arena from the name, as the game does. */
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
  /** The autopilot, fresh for each Floor. */
  pilot: { duel: number; ai: Controller } | null;
  /** This peer builds the next Floor ahead (the game always does; a test may hold it back). */
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

/** The autopilot's Intent: a Hard AI fighting for the local Fighter while a Floor is on; idle in the pause between Floors. */
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
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match: MATCH, lineup, weapon: WEAPON, step: o.step?.(0) });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: WEAPON, step: o.step?.(i + 1) }));
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
      // The game builds the next Floor's Arena ahead, on every peer (`warmNextArena`).
      const next = session.state && arenaToWarm(session.state);
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
 * The Run stepped offline with the Intents the Players sent and fresh AI Controllers (a Floor AI on each Team 1 slot,
 * a Normal AI for a Player who left): its hash at every checksum Tick up to `upTo`, and where each Floor began and its
 * pause.
 */
function offline(tuning: TuningData, lineup: Lineup, peers: readonly Peer[], upTo: number, takeovers: readonly Takeover[] = []) {
  const ais = lineupAis(tuning, lineup, 'Gauntlet');
  const taken = new Map(takeovers.map((d) => [d.player, { from: d.from, ai: createAiController(tuning, TAKEOVER_DIFFICULTY) }]));
  let m = createMatch(tuning, lineupMatch(tuning, lineup, lineup.map(() => WEAPON), MATCH));
  const hashes = new Map<number, string>();
  /** Per Floor: the Tick it was cleared (its pause began) and the Tick the next began. */
  const clearedAt = new Map<number, number>();
  const startedAt = new Map<number, number>([[1, 0]]);
  for (let t = 1; t <= upTo; t++) {
    const intents = lineup.map((slot, i) => {
      if (slot.pilot.kind !== 'Player') return (ais[i] as Controller).intent(m.duel, i);
      const p = slot.pilot.player;
      const ai = taken.get(p);
      if (ai && t >= ai.from) return ai.ai.intent(m.duel, i);
      return peers[p]!.sent.get(t) ?? IDLE_INTENT;
    });
    const before = m;
    m = stepMatch(m, intents, tuning);
    if (before.nextDuelTick === null && m.nextDuelTick !== null) clearedAt.set(m.run!.floor, t);
    if (m.run!.floor !== before.run!.floor) startedAt.set(m.run!.floor, t);
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

/** The enemies on the current Floor: each Team 1 slot's max HP, null for a Benched one. */
const enemyHp = (m: MatchState) => m.duel.fighters.flatMap((f) => (f.team === 1 ? [f.benched ? null : f.maxHp] : []));

describe('a Gauntlet Run online', () => {
  for (const players of [2, 3]) {
    it(`${players} Players with one-hit enemies play Floors 1 to 3: every checksum on every peer equals the Run stepped offline, and each peer built each Floor itself`, () => {
      const r = startRun({ players });
      // Into Floor 3, and a while on into it, every peer having confirmed that far.
      let floor3: number | null = null;
      r.until(() => floor3 !== null && r.confirmed() >= floor3 + 300, (peer) => {
        if (floor3 === null && peer === r.host && peer.session.state?.run?.floor === 3) floor3 = peer.session.currentTick;
      });
      expect(floor3, 'reached Floor 3').not.toBeNull();
      for (const p of r.peers) expect(p.session.status).toBe('Running');

      const upTo = r.confirmed();
      const expected = offline(peerTuning(), r.lineup, r.peers, upTo);
      expect(expected.state.run).toMatchObject({ floor: 3, cleared: 2 });
      expect(expected.state.status.status).toBe('InProgress');
      r.peers.forEach((p, k) => expect(expectChecksums(k === 0 ? 'host' : `guest ${k}`, p, expected.hashes), `peer ${k}`).toBeGreaterThan(20));
      for (const p of r.peers) expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);

      // Each Floor on its own Arena, the next seed each time, which every peer built for itself: different objects, equal hashes.
      for (const p of r.peers) expect(p.session.state).toMatchObject({ arena: FLOORS[2], run: { floor: 3 }, config: { arena: NAME, humans: players } });
      for (const name of FLOORS) {
        const built = r.peers.map((p) => arenaOf(p.tuning, name));
        expect(new Set(built).size).toBe(players);
        expect(new Set(built.map((a) => hashValue(a))).size).toBe(1);
      }
      // ...and each built Floors 2 and 3 ahead, in the pause before them (none of it on the wire).
      for (const p of r.peers) expect([...p.warmed]).toEqual(FLOORS.slice(1));
    }, 240_000);
  }

  it('every peer gives the enemies the same HP, scaled by the humans the start message carries', () => {
    for (const players of [2, 3]) {
      const r = startRun({ players });
      r.until(() => r.peers.every((p) => p.session.status === 'Running'), undefined, 200);
      const floor1 = floorRoster(r.host.tuning, { arena: NAME, humans: players }, 1).map((e) => e && enemyMaxHp(r.host.tuning, 0.01, players));
      for (const p of r.peers) {
        expect(p.session.state!.config.humans).toBe(players);
        expect(enemyHp(p.session.state!)).toEqual(floor1);
      }
      expect(floor1[0]).toBeCloseTo(r.host.tuning.fighter.maxHp * 0.01 * (1 + r.host.tuning.gauntlet.perPlayerHp * (players - 1)));
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

  it('a guest leaving on Floor 2 is taken over by a Normal AI on every peer; the Run goes on in step, and Floor 3 keeps the starting humans’ enemy HP', () => {
    const r = startRun({ players: 3 });
    const leaver = r.guests[1]!; // Player 2
    let floor3: number | null = null;
    r.until(() => floor3 !== null && r.confirmed() >= floor3 + 300, (peer) => {
      const s = r.host.session.state;
      // Some way into Floor 2, the guest closes its tab.
      if (!leaver.gone && s?.run?.floor === 2 && s.nextDuelTick === null && s.duel.tick > 90) {
        leaver.session.close();
        leaver.gone = true;
      }
      if (floor3 === null && peer === r.host && s?.run?.floor === 3) floor3 = s.tick;
    });
    expect(leaver.gone).toBe(true);
    expect(floor3, 'reached Floor 3').not.toBeNull();

    // Every peer still playing hears of it, with the same takeover Tick, on Floor 2.
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
      // The Run was started by three humans, and its Floors stay scaled for three.
      const s = p.session.state!;
      expect(s.run!.floor).toBe(3);
      expect(s.config.humans).toBe(3);
      expect(enemyHp(s)).toEqual(floorRoster(p.tuning, { arena: NAME, humans: 3 }, 3).map((e) => e && enemyMaxHp(p.tuning, 0.01, 3)));
      expect(enemyHp(s).filter((hp) => hp !== null).length).toBeGreaterThan(0);
    }
  }, 240_000);

  it('a guest forced to resync in the pause between Floors, before it built the next Floor, catches up with no Desync after', () => {
    const interDuel = (m: MatchState) => m.config.interDuelTicks;
    // On the guest only: every time it simulates the first Tick of Floor 1's pause, Fighter 0 drifts 5 cm.
    const drift: typeof stepMatch = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (next.run?.floor !== 1 || next.nextDuelTick === null || next.tick !== next.nextDuelTick - interDuel(next) + 1) return next;
      const fighters = next.duel.fighters.map((f, j) => (j === 0 ? { ...f, position: { x: f.position.x + 0.05, z: f.position.z } } : f));
      return { ...next, duel: { ...next.duel, fighters } };
    };
    const r = startRun({ players: 2, step: (k) => (k === 1 ? drift : undefined) });
    const guest = r.guests[0]!;
    // This guest never builds a Floor ahead: the Floor change Tick builds it (slow, but the same Arena).
    guest.warm = false;
    let floor2: number | null = null;
    r.until(() => floor2 !== null && r.confirmed() >= floor2 + 300, () => {
      const s = r.host.session.state;
      if (floor2 === null && s?.run?.floor === 2) floor2 = s.tick;
    });
    expect(floor2, 'reached Floor 2').not.toBeNull();

    const expected = offline(peerTuning(), r.lineup, r.peers, r.confirmed());
    const [cleared, next] = [expected.clearedAt.get(1)!, expected.startedAt.get(2)!];
    const desync = guest.events.find((e) => e.type === 'Desync');
    const resynced = guest.events.find((e) => e.type === 'Resynced');
    expect(desync, 'the drift was caught').toBeDefined();
    expect(resynced).toBeDefined();
    // Both inside the pause: after Floor 1 was cleared, before Floor 2 began.
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
    // ...through the Floor change, on an Arena the guest built itself.
    expect(expectChecksums('guest on Floor 2', guest, expected.hashes, next)).toBeGreaterThan(5);
    expect(guest.session.state!.arena).toBe(FLOORS[1]);
    expect(arenaOf(guest.tuning, FLOORS[1]!)).not.toBe(arenaOf(r.host.tuning, FLOORS[1]!));
    expect(hashValue(arenaOf(guest.tuning, FLOORS[1]!))).toBe(hashValue(arenaOf(r.host.tuning, FLOORS[1]!)));
  }, 240_000);

  it('a Rollback across a Floor change (a late Intent from the Tick before it) re-simulates to the same state', () => {
    // The guest's Intent for the last Tick of the pause differs from the idle one the host predicts, and arrives a few Ticks late.
    const LATE: Intent = { ...IDLE_INTENT, move: { x: 1, z: 0 }, attack: true, face: 1 };
    const r = startRun({
      players: 2,
      net: { latencyMs: 100, jitterMs: 20 },
      intent: (k, s, tick) => (k === 1 && s.run?.floor === 1 && s.nextDuelTick !== null && tick === s.nextDuelTick - 1 ? LATE : null),
    });
    let floor2: number | null = null;
    /** Host Rollbacks: [first re-simulated Tick, last]. */
    const rollbacks: [number, number][] = [];
    r.until(() => floor2 !== null && r.confirmed() >= floor2 + 300, (peer, _k, before, rolledBack) => {
      const s = r.host.session.state;
      if (peer === r.host && rolledBack > 0) rollbacks.push([before - rolledBack + 1, before]);
      if (floor2 === null && s?.run?.floor === 2) floor2 = s.tick;
    });
    expect(floor2, 'reached Floor 2').not.toBeNull();

    const expected = offline(peerTuning(), r.lineup, r.peers, r.confirmed());
    const t = expected.startedAt.get(2)!;
    expect(r.guests[0]!.sent.get(t - 1)).toEqual(LATE);
    // The host rolled back from the Tick before the Floor change to past it: re-simulating the change itself.
    expect(rollbacks.some(([from, to]) => from <= t - 1 && to >= t)).toBe(true);
    for (const [k, p] of r.peers.entries()) {
      expect(expectChecksums(`peer ${k}`, p, expected.hashes)).toBeGreaterThan(10);
      expect(expectChecksums(`peer ${k} on Floor 2`, p, expected.hashes, t)).toBeGreaterThan(5);
      expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    }
  }, 240_000);

  it('a guest with a different gauntlet.json is refused at connect', () => {
    const otherFloors = (t: TuningData) => ({ ...oneHit(t), gauntlet: { ...oneHit(t).gauntlet, heal: 0.25 } });
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
