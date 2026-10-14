import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, DIRECTIONS, hashValue, IDLE_INTENT, stepMatch, type Intent } from '../sim';
import { createMemoryTransportPair, type MemoryTransportOptions } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, ROLLBACK_WINDOW, type SessionEvent } from './session';

const repoTuning = loadTuningData();
/** One clean hit decides a Duel, so Matches move through several Duels quickly. */
const tuning: TuningData = { ...repoTuning, weapon: { ...repoTuning.weapon, damage: 10_000 } };
const TICK_MS = 1000 / 60;
/** Directions with an Attack Motion in the repo data (all four once every Direction is authored). */
const PLAYABLE = DIRECTIONS.filter((d) => tuning.motions[d]);
const MATCH = { bestOf: 3, distance: 1.3, interDuelTicks: 30, seed: 5 };

function connect(net: MemoryTransportOptions = {}, guestTuning: TuningData = tuning) {
  const pair = createMemoryTransportPair(net);
  const hostEvents: SessionEvent[] = [];
  const guestEvents: SessionEvent[] = [];
  const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH });
  const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning: guestTuning });
  host.onEvent((e) => hostEvents.push(e));
  guest.onEvent((e) => guestEvents.push(e));
  return { pair, host, guest, hostEvents, guestEvents };
}

/** One wall-clock frame: the network moves, then each session runs one Tick with its local Intent. */
function frame(
  s: ReturnType<typeof connect>,
  hostIntent: (tick: number) => Intent = () => IDLE_INTENT,
  guestIntent: (tick: number) => Intent = () => IDLE_INTENT,
) {
  s.pair.advance(TICK_MS);
  const h = s.host.tick(hostIntent(s.host.currentTick + 1));
  const g = s.guest.tick(guestIntent(s.guest.currentTick + 1));
  return { h, g };
}

describe('Rollback session: connect', () => {
  it('connects two peers with identical Tuning Data and starts the host-configured Match', () => {
    const s = connect({ latencyMs: 40 });
    for (let i = 0; i < 20; i++) frame(s);
    expect(s.host.status).toBe('Running');
    expect(s.guest.status).toBe('Running');
    expect(s.guestEvents).toContainEqual({ type: 'Connected' });
    expect(s.guest.state!.config).toEqual(s.host.state!.config);
    expect(s.host.localFighter).toBe(0);
    expect(s.guest.localFighter).toBe(1);
  });

  it('refuses the connection on a Tuning Data hash mismatch, on both sides', () => {
    const other: TuningData = { ...tuning, weapon: { ...tuning.weapon, length: tuning.weapon.length + 0.1 } };
    const s = connect({ latencyMs: 40 }, other);
    for (let i = 0; i < 30; i++) frame(s);
    expect(s.host.status).toBe('Refused');
    expect(s.guest.status).toBe('Refused');
    expect(s.hostEvents).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
    expect(s.guestEvents).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
    expect(s.hostEvents.some((e) => e.type === 'Connected')).toBe(false);
    expect(s.host.currentTick).toBe(0);
    expect(s.guest.currentTick).toBe(0);
  });
});

/** Busy, reproducible Intents: a new random Intent every 6 Ticks, so predictions keep missing. */
function randomIntents(seed: number): (tick: number) => Intent {
  return (tick) => {
    let h = Math.imul(seed ^ Math.floor(tick / 6), 0x9e3779b1) >>> 0;
    const next = () => {
      h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
      return (h >>> 0) / 4294967296;
    };
    const r = next();
    return {
      move: { x: next() < 0.3 ? next() * 2 - 1 : 0, z: next() < 0.5 ? next() * 2 - 1 : 0 },
      direction: PLAYABLE[Math.floor(next() * PLAYABLE.length)]!,
      attack: r < 0.35 && tick % 2 === 0,
      block: r > 0.8,
      face: next() < 0.2 ? next() * 2 * Math.PI - Math.PI : null,
    };
  };
}

const HOST_INTENTS = randomIntents(11);
const GUEST_INTENTS = randomIntents(23);

/** The Match both peers should agree on: plain stepMatch with the real Intents, Tick by Tick. */
function offlineHashes(ticks: number): Map<number, string> {
  let m = createMatch(tuning, MATCH);
  const hashes = new Map<number, string>();
  for (let t = 1; t <= ticks; t++) {
    m = stepMatch(m, [HOST_INTENTS(t), GUEST_INTENTS(t)], tuning);
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, hashValue(m));
  }
  return hashes;
}

function playUntilConfirmed(s: ReturnType<typeof connect>, ticks: number, limit = 20_000) {
  const results: ReturnType<typeof frame>[] = [];
  for (let i = 0; i < limit && Math.min(s.host.confirmedTick, s.guest.confirmedTick) < ticks; i++) {
    results.push(frame(s, HOST_INTENTS, GUEST_INTENTS));
  }
  expect(Math.min(s.host.confirmedTick, s.guest.confirmedTick)).toBeGreaterThanOrEqual(ticks);
  return results;
}

describe('Rollback session: play', () => {
  const TICKS = 600;
  const expected = offlineHashes(TICKS);

  it.each([
    ['no delay', {}],
    ['latency', { latencyMs: 60 }],
    ['latency + jitter', { latencyMs: 40, jitterMs: 50, seed: 2 }],
    ['latency + jitter + 20% loss', { latencyMs: 50, jitterMs: 40, loss: 0.2, seed: 9 }],
  ])('both peers converge to the same hashes as an offline Match (%s)', (_name, net: MemoryTransportOptions) => {
    const s = connect(net);
    playUntilConfirmed(s, TICKS);
    for (const [tick, hash] of expected) {
      expect(s.host.checksumAt(tick), `host @${tick}`).toBe(hash);
      expect(s.guest.checksumAt(tick), `guest @${tick}`).toBe(hash);
    }
    if (net.latencyMs) expect(s.guest.stats.rollbacks + s.host.stats.rollbacks).toBeGreaterThan(0);
    expect(s.guestEvents.some((e) => e.type === 'Desync')).toBe(false);
  });

  it('never rolls back more than 8 Ticks; it stalls instead when the peer falls too far behind', () => {
    const s = connect({ latencyMs: 250, jitterMs: 100, loss: 0.1, seed: 4 });
    const results = playUntilConfirmed(s, 300);
    for (const { h, g } of results) {
      expect(h.rolledBack).toBeLessThanOrEqual(ROLLBACK_WINDOW);
      expect(g.rolledBack).toBeLessThanOrEqual(ROLLBACK_WINDOW);
    }
    expect(Math.max(s.host.stats.maxRollback, s.guest.stats.maxRollback)).toBeLessThanOrEqual(ROLLBACK_WINDOW);
    expect(results.some(({ h }) => h.stalled)).toBe(true);
    expect(results.some(({ g }) => g.stalled)).toBe(true);
    expect(s.host.checksumAt(300)).toBe(expected.get(300));
    expect(s.guest.checksumAt(300)).toBe(expected.get(300));
  });

  it('never runs more than 8 Ticks ahead of the confirmed Tick', () => {
    const s = connect({ latencyMs: 400 });
    for (let i = 0; i < 200; i++) {
      frame(s, HOST_INTENTS, GUEST_INTENTS);
      expect(s.host.currentTick - s.host.confirmedTick).toBeLessThanOrEqual(ROLLBACK_WINDOW);
      expect(s.guest.currentTick - s.guest.confirmedTick).toBeLessThanOrEqual(ROLLBACK_WINDOW);
    }
  });
});

describe('Rollback session: checksum resync', () => {
  it('detects an injected divergence on the guest by checksum and resyncs it to the host state', () => {
    const pair = createMemoryTransportPair({ latencyMs: 50, jitterMs: 20, loss: 0.1, seed: 6 });
    // A "floating-point difference" on the guest only: every time it simulates Tick 100, Fighter 0 loses 1 HP.
    const driftingStep: typeof stepMatch = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (next.tick !== 100) return next;
      const fighters = next.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: f.hp - 1 } : f));
      return { ...next, duel: { ...next.duel, fighters } };
    };
    const s = {
      pair,
      host: createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH }),
      guest: createRollbackSession({ role: 'guest', transport: pair.b, tuning, step: driftingStep }),
      hostEvents: [] as SessionEvent[],
      guestEvents: [] as SessionEvent[],
    };
    s.guest.onEvent((e) => s.guestEvents.push(e));
    const TICKS = 600;
    const expected = offlineHashes(TICKS);
    playUntilConfirmed(s, TICKS);

    const desync = s.guestEvents.find((e) => e.type === 'Desync');
    expect(desync).toMatchObject({ type: 'Desync', tick: 120 });
    expect(s.guestEvents).toContainEqual(expect.objectContaining({ type: 'Resynced' }));
    expect(s.guest.stats.resyncs).toBeGreaterThan(0);
    for (const [tick, hash] of expected) {
      if (tick < 200) continue; // after the resync
      expect(s.guest.checksumAt(tick), `guest @${tick}`).toBe(hash);
      expect(s.host.checksumAt(tick), `host @${tick}`).toBe(hash);
    }
  });
});

describe('Rollback session: disconnect', () => {
  it('surfaces the peer closing the connection', () => {
    const s = connect({ latencyMs: 30 });
    for (let i = 0; i < 60; i++) frame(s, HOST_INTENTS, GUEST_INTENTS);
    s.host.close();
    const before = s.guest.currentTick;
    frame(s, HOST_INTENTS, GUEST_INTENTS);
    expect(s.guest.status).toBe('Disconnected');
    expect(s.guestEvents).toContainEqual({ type: 'Disconnected', reason: 'Closed' });
    expect(s.hostEvents).toContainEqual({ type: 'Disconnected', reason: 'Closed' });
    expect(s.guest.currentTick).toBe(before);
  });

  it('surfaces a peer that goes silent as a timeout', () => {
    const pair = createMemoryTransportPair({ latencyMs: 30 });
    const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, timeoutTicks: 60 });
    const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning });
    const events: SessionEvent[] = [];
    host.onEvent((e) => events.push(e));
    for (let i = 0; i < 30; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
      guest.tick(IDLE_INTENT);
    }
    expect(host.status).toBe('Running');
    for (let i = 0; i < 70; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT); // the guest's tab froze: it stops ticking and sending
    }
    expect(host.status).toBe('Disconnected');
    expect(events).toContainEqual({ type: 'Disconnected', reason: 'Timeout' });
  });
});