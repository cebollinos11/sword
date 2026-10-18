import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, hashValue, IDLE_INTENT, stepMatch, TICK_RATE, type Intent } from '../sim';
import { createAiController, lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { createMemoryTransportPair, type MemoryTransportOptions, type MemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, TAKEOVER_DIFFICULTY, type RollbackSession, type SessionEvent } from './session';

const tuning = loadTuningData();
const TICK_MS = 1000 / TICK_RATE;
const MATCH = { bestOf: 3, interDuelTicks: 30, seed: 12 };
const PICKS = ['Longsword', 'Halberd', 'Arming Sword', 'Halberd'];

const P = (team: number, player: 0 | 1 | 2 | 3) => ({ team, pilot: { kind: 'Player', player } }) as const;
/** Four Players, two a side. */
const TWO_VS_TWO: Lineup = [P(0, 0), P(1, 1), P(0, 2), P(1, 3)];
/** Three Players against the fourth and two AIs. */
const THREE_VS_ONE: Lineup = [
  P(0, 0),
  P(0, 1),
  { team: 1, pilot: { kind: 'AI', difficulty: 'Hard' }, weapon: 'Halberd' },
  P(1, 3),
  P(0, 2),
  { team: 1, pilot: { kind: 'AI', difficulty: 'Easy' } },
];
/** The host and two guests against three AIs. */
const THREE_VS_AIS: Lineup = [P(0, 0), P(0, 1), P(0, 2), ...Array.from({ length: 3 }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } }) as const)];

/** Busy Players: walk, swing and block in a pattern that keeps predictions missing. */
const busy = (seed: number) => (tick: number): Intent => {
  const k = Math.floor(tick / (5 + seed)) + seed;
  return { ...IDLE_INTENT, move: { x: (k % 3) - 1, z: k % 4 === 3 ? -1 : 1 }, attack: k % 4 === 0 && tick % 2 === 0, block: k % 5 === 1, direction: (['Left', 'Right', 'Overhead'] as const)[k % 3]! };
};
const INTENTS = [busy(1), busy(2), busy(3), busy(4)];

interface Star {
  readonly pairs: MemoryTransportPair[];
  readonly host: RollbackSession;
  /** guests[p - 1] is Player p (null for one that never connected). */
  readonly guests: (RollbackSession | null)[];
  readonly events: SessionEvent[][];
  /** Peers that stopped ticking (a frozen tab). */
  readonly frozen: Set<RollbackSession>;
}

/** The host and a guest per network condition (null: a guest gone before the Match), as a star of links. */
function star(lineup: Lineup, nets: (MemoryTransportOptions | null)[], opts: { timeoutTicks?: number; drift?: number } = {}): Star {
  const pairs = nets.map((n) => (n ? createMemoryTransportPair(n) : null));
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p?.a ?? null), tuning, match: MATCH, lineup, weapon: PICKS[0], timeoutTicks: opts.timeoutTicks });
  const guests = pairs.map((pair, i) => {
    if (!pair) return null;
    // A "floating-point difference" on one guest only: every time it simulates Tick 100, Fighter 0 drifts 5 cm.
    const step: typeof stepMatch | undefined =
      opts.drift === i + 1
        ? (m, intents, t) => {
            const next = stepMatch(m, intents, t);
            if (next.tick !== 100) return next;
            const fighters = next.duel.fighters.map((f, j) => (j === 0 ? { ...f, position: { x: f.position.x + 0.05, z: f.position.z } } : f));
            return { ...next, duel: { ...next.duel, fighters } };
          }
        : undefined;
    return createRollbackSession({ role: 'guest', transport: pair.b, tuning, weapon: PICKS[i + 1], step, timeoutTicks: opts.timeoutTicks });
  });
  const events: SessionEvent[][] = [host, ...guests].map(() => []);
  [host, ...guests].forEach((s, i) => s?.onEvent((e) => events[i]!.push(e)));
  return { pairs: pairs.filter((p): p is MemoryTransportPair => p !== null), host, guests, events, frozen: new Set() };
}

/** Every peer still in play: the host, and guests not gone or frozen. */
function playing(s: Star): RollbackSession[] {
  return [s.host, ...s.guests].filter((x): x is RollbackSession => x !== null && x.status !== 'Disconnected' && x.status !== 'Refused' && !s.frozen.has(x));
}

/** One wall-clock frame: the network moves, then every peer still ticking runs one Tick with its Player's Intent. */
function frame(s: Star): void {
  for (const p of s.pairs) p.advance(TICK_MS);
  // Peer i is Player i (a guest only learns its number from the host's hello, inside a tick).
  [s.host, ...s.guests].forEach((peer, i) => {
    if (peer && !s.frozen.has(peer)) peer.tick(INTENTS[i]!(peer.currentTick + 1));
  });
}

function playUntilConfirmed(s: Star, ticks: number): void {
  for (let i = 0; i < 20_000 && Math.min(...playing(s).map((x) => x.confirmedTick)) < ticks; i++) frame(s);
  expect(Math.min(...playing(s).map((x) => x.confirmedTick))).toBeGreaterThanOrEqual(ticks);
}

/** The Match every peer should agree on: stepped offline with the real Intents; Player p's Fighter goes to a fresh AI at `takeovers[p]`. */
function offlineHashes(lineup: Lineup, ticks: number, takeovers: Record<number, number> = {}): Map<number, string> {
  let m = createMatch(tuning, lineupMatch(tuning, lineup, PICKS, MATCH));
  const ais = lineupAis(tuning, lineup);
  const hashes = new Map<number, string>();
  for (let t = 1; t <= ticks; t++) {
    const intents = lineup.map((s, i) => {
      if (s.pilot.kind === 'AI') return (ais[i] as Controller).intent(m.duel, i);
      const p = s.pilot.player;
      if (takeovers[p] !== undefined && t >= takeovers[p]) {
        if (t === takeovers[p]) ais[i] = createAiController(tuning, TAKEOVER_DIFFICULTY);
        return ais[i]!.intent(m.duel, i);
      }
      return INTENTS[p]!(t);
    });
    m = stepMatch(m, intents, tuning);
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, hashValue(m));
  }
  return hashes;
}

function expectHashes(peers: RollbackSession[], expected: Map<number, string>, from = 0): void {
  for (const [tick, hash] of expected) {
    if (tick < from) continue;
    peers.forEach((p) => expect(p.checksumAt(tick), `${p.role} ${p.localPlayer} @${tick}`).toBe(hash));
  }
}

const NETS: MemoryTransportOptions[] = [
  { latencyMs: 40, jitterMs: 30, seed: 1 },
  { latencyMs: 70, jitterMs: 40, loss: 0.15, seed: 2 },
  { latencyMs: 25, jitterMs: 20, loss: 0.1, seed: 3 },
];

describe('Rollback session: three and four Players', () => {
  it('gives each guest its Player number, its Fighter and the same Match', () => {
    const s = star(THREE_VS_ONE, NETS);
    for (let i = 0; i < 30; i++) frame(s);
    expect(s.guests.map((g) => g!.localPlayer)).toEqual([1, 2, 3]);
    expect([s.host, ...s.guests].map((g) => g!.localFighter)).toEqual([0, 1, 4, 3]);
    for (const g of s.guests) expect(g!.state!.config).toEqual(s.host.state!.config);
    expect(s.host.state!.config.weapons).toEqual(['Longsword', 'Halberd', 'Halberd', 'Halberd', 'Arming Sword', 'Arming Sword']);
  });

  it.each([
    ['2 v 2, four Players', TWO_VS_TWO, NETS],
    ['3 v 1 with two AIs, four Players', THREE_VS_ONE, NETS],
    ['three Players against three AIs', THREE_VS_AIS, NETS.slice(0, 2)],
  ])('every peer converges to the same hashes as an offline Match (%s), guests\' Intents relayed by the host', (_name, lineup, nets) => {
    const TICKS = 600;
    const expected = offlineHashes(lineup, TICKS);
    const s = star(lineup, nets);
    playUntilConfirmed(s, TICKS);
    expectHashes(playing(s), expected);
    for (const g of s.guests) expect(g!.stats.rollbacks).toBeGreaterThan(0);
    expect(s.events.flat().some((e) => e.type === 'Desync' || e.type === 'PlayerLeft')).toBe(false);
  });

  it('a guest that leaves mid-Match is replaced by the AI from the same Tick on every peer, and the rest play on', () => {
    const s = star(TWO_VS_TWO, NETS);
    for (let i = 0; i < 150; i++) frame(s);
    s.guests[1]!.close(); // Player 2 closes the tab
    playUntilConfirmed(s, 600);
    const left = s.events.map((list) => list.filter((e) => e.type === 'PlayerLeft'));
    const tick = (left[0]![0] as { tick: number }).tick;
    expect(tick).toBeGreaterThan(100);
    for (const i of [0, 1, 3]) expect(left[i], `peer ${i}`).toEqual([{ type: 'PlayerLeft', player: 2, tick }]);
    expect(playing(s)).toHaveLength(3);
    expectHashes(playing(s), offlineHashes(TWO_VS_TWO, 600, { 2: tick }));
  });

  it('a guest that goes silent is dropped the same way; when it wakes the host has let it go', () => {
    const s = star(TWO_VS_TWO, NETS, { timeoutTicks: 120 });
    for (let i = 0; i < 100; i++) frame(s);
    const sleeper = s.guests[2]!; // Player 3's tab freezes
    s.frozen.add(sleeper);
    playUntilConfirmed(s, 600);
    const tick = (s.events[0]!.find((e) => e.type === 'PlayerLeft') as { player: number; tick: number }).tick;
    expect(s.events[0]).toContainEqual({ type: 'PlayerLeft', player: 3, tick });
    expectHashes(playing(s), offlineHashes(TWO_VS_TWO, 600, { 3: tick }));
    s.frozen.delete(sleeper);
    for (let i = 0; i < 200; i++) frame(s);
    expect(sleeper.status).toBe('Disconnected');
  });

  it('a guest gone before the Match starts: the AI drives its Fighter from the first Tick', () => {
    const s = star(TWO_VS_TWO, [NETS[0]!, null, NETS[2]!]);
    playUntilConfirmed(s, 300);
    expect(s.events[0]).toContainEqual({ type: 'PlayerLeft', player: 2, tick: 1 });
    // Its pick never arrived: it fights with the default Weapon (as PICKS has it, for the offline Match).
    expect(s.host.state!.config.weapons[2]).toBe('Arming Sword');
    expect(PICKS[2]).toBe('Arming Sword');
    expectHashes(playing(s), offlineHashes(TWO_VS_TWO, 300, { 2: 1 }));
  });

  it('the host leaving ends the Match for every guest', () => {
    const s = star(TWO_VS_TWO, NETS);
    for (let i = 0; i < 60; i++) frame(s);
    s.host.close();
    frame(s);
    for (let i = 1; i <= 3; i++) expect(s.events[i]).toContainEqual({ type: 'Disconnected', reason: 'Closed' });
  });

  it('resyncs a diverged guest to the host state; the other guests never desync', () => {
    const s = star(TWO_VS_TWO, NETS, { drift: 2 });
    const TICKS = 600;
    const expected = offlineHashes(TWO_VS_TWO, TICKS);
    playUntilConfirmed(s, TICKS);
    expect(s.events[2]).toContainEqual(expect.objectContaining({ type: 'Resynced' }));
    expect(s.events[1]!.some((e) => e.type === 'Desync')).toBe(false);
    expect(s.events[3]!.some((e) => e.type === 'Desync')).toBe(false);
    expectHashes(playing(s), expected, 200);
  });
});
