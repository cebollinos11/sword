import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, withWeapon, type TuningData } from '../tuning';
import { createMatch, DIRECTIONS, hashValue, IDLE_INTENT, stepMatch, TICK_RATE, type Intent } from '../sim';
import { createMemoryTransportPair, type MemoryTransportOptions } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, ROLLBACK_WINDOW, type SessionEvent } from './session';
import { PROTOCOL_VERSION } from './messages';

const repoTuning = loadTuningData();
/** One clean hit decides a Duel, so Matches move through several Duels quickly. */
const tuning: TuningData = withWeapon(repoTuning, { damage: 10_000 });
const TICK_MS = 1000 / TICK_RATE;
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

/**
 * The host starts a hop before the guest (it waits for the guest's pick), and time sync evens that out
 * over a few seconds. To compare the two at one Tick, let the peer behind catch up alone.
 */
function level(s: { pair: { advance(ms: number): void }; host: { currentTick: number; tick(i: Intent): unknown }; guest: { currentTick: number; tick(i: Intent): unknown } }) {
  for (let i = 0; i < 200 && s.host.currentTick !== s.guest.currentTick; i++) {
    s.pair.advance(TICK_MS);
    if (s.host.currentTick < s.guest.currentTick) s.host.tick(IDLE_INTENT);
    else s.guest.tick(IDLE_INTENT);
  }
  // Deliver what is in flight; the next joint Tick takes it in (rolling back where needed).
  s.pair.advance(200);
  expect(s.host.currentTick).toBe(s.guest.currentTick);
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

  it('refuses a guest with other Tuning Data; the host plays on with the AI in its place', () => {
    const other: TuningData = withWeapon(tuning, { length: tuning.weapons['Arming Sword']!.length + 0.1 });
    const s = connect({ latencyMs: 40 }, other);
    for (let i = 0; i < 30; i++) frame(s);
    expect(s.guest.status).toBe('Refused');
    expect(s.guestEvents).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
    expect(s.guest.currentTick).toBe(0);
    expect(s.hostEvents).toContainEqual({ type: 'PlayerLeft', player: 1, tick: 1 });
    expect(s.host.status).toBe('Running');
    expect(s.host.currentTick).toBeGreaterThan(0);
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

  it('never rolls back more than the Rollback window; it stalls instead when the peer falls too far behind', () => {
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

  it('never runs more than the Rollback window ahead of the confirmed Tick', () => {
    const s = connect({ latencyMs: 400 });
    for (let i = 0; i < 200; i++) {
      frame(s, HOST_INTENTS, GUEST_INTENTS);
      expect(s.host.currentTick - s.host.confirmedTick).toBeLessThanOrEqual(ROLLBACK_WINDOW);
      expect(s.guest.currentTick - s.guest.confirmedTick).toBeLessThanOrEqual(ROLLBACK_WINDOW);
    }
  });
});

describe('Rollback session: time sync', () => {
  /**
   * Each peer on its own wall clock, as in two browsers: a steady 60 fps desktop and a phone with uneven
   * frames that freezes for 400 ms once (a GC pause, a notification). Returns the frames each peer stalled
   * in after it had time to recover.
   */
  function freeRunning(withHiccup: boolean) {
    const s = connect({ latencyMs: 100, jitterMs: 40, seed: 3 });
    let r = 7;
    const uneven = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const peers = [
      { session: s.host, intents: HOST_INTENTS, next: 0, acc: 0, frameMs: (_now: number) => 1000 / 60, stalledFrames: 0 },
      {
        session: s.guest,
        intents: GUEST_INTENTS,
        next: 37,
        acc: 0,
        frameMs: (now: number) => (withHiccup && now >= 5000 && now < 5100 ? 400 : 16.7 + (uneven() < 0.2 ? 17 : 0) + uneven() * 4),
        stalledFrames: 0,
      },
    ];
    for (let now = 1; now <= 20_000; now++) {
      s.pair.advance(1);
      for (const p of peers) {
        if (now < p.next) continue;
        const ms = p.frameMs(now);
        p.next = now + ms;
        p.acc += Math.min(ms, 8 * TICK_MS);
        let stalled = false;
        for (; p.acc >= TICK_MS; p.acc -= TICK_MS) stalled = p.session.tick(p.intents(p.session.currentTick + 1)).stalled || stalled;
        if (stalled && now > 8000) p.stalledFrames++;
      }
    }
    return { s, host: peers[0]!.stalledFrames, guest: peers[1]!.stalledFrames };
  }

  it('after one peer hiccups, the peer left ahead waits a few Ticks and both play on without stalling', () => {
    const { s, host, guest } = freeRunning(true);
    expect(s.host.stats.waits + s.guest.stats.waits).toBeGreaterThan(0);
    expect(host).toBe(0);
    expect(guest).toBe(0);
    expect(Math.abs(s.host.currentTick - s.guest.currentTick)).toBeLessThanOrEqual(3);
    expect(s.guestEvents.some((e) => e.type === 'Desync')).toBe(false);
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

describe('Rollback session: malformed peer messages', () => {
  /** Messages a broken or hostile peer might send around Tick `t`; none of them is a valid message. */
  const junk = (t: number): unknown[] => [
    null,
    42,
    'intents',
    [],
    { type: 'intents' },
    { type: 'intents', from: t, intents: [{}], ack: 0 },
    { type: 'intents', from: t, intents: [{ ...IDLE_INTENT, direction: 'Sideways' }], ack: 0 },
    { type: 'intents', from: t, intents: [{ ...IDLE_INTENT, move: null }], ack: 0 },
    { type: 'intents', from: t, intents: [{ ...IDLE_INTENT, move: { x: 'fast', z: 0 } }], ack: 0 },
    { type: 'intents', from: t, intents: [{ ...IDLE_INTENT, attack: 'yes' }], ack: 0 },
    { type: 'intents', from: t, intents: [{ ...IDLE_INTENT, face: 'north' }], ack: 0 },
    { type: 'intents', from: t, intents: [IDLE_INTENT, null], ack: 0 },
    { type: 'intents', from: 'x', intents: 'abc', ack: null },
    { type: 'hello', protocol: 1, tuningHash: 7 },
    { type: 'refuse', reason: 'Bored', tuningHash: 'x' },
    { type: 'checksum', tick: 'x', hash: 5 },
    { type: 'resyncRequest', tick: null },
    { type: 'resync', tick: t, state: {}, intentsFrom: 1, intents: [{}] },
  ];

  it('ignores them without throwing, and both peers still converge to the offline Match', () => {
    const s = connect({ latencyMs: 30 });
    const TICKS = 300;
    const expected = offlineHashes(TICKS);
    for (let i = 0; i < 20_000 && Math.min(s.host.confirmedTick, s.guest.confirmedTick) < TICKS; i++) {
      if (i % 7 === 0) {
        for (const [from, to] of [[s.pair.a, s.guest], [s.pair.b, s.host]] as const) {
          for (let t = to.confirmedTick - 2; t <= to.confirmedTick + 3; t++) for (const m of junk(t)) from.send(m);
        }
      }
      expect(() => frame(s, HOST_INTENTS, GUEST_INTENTS)).not.toThrow();
    }
    expect(s.host.status).toBe('Running');
    expect(s.guest.status).toBe('Running');
    for (const [tick, hash] of expected) {
      expect(s.host.checksumAt(tick), `host @${tick}`).toBe(hash);
      expect(s.guest.checksumAt(tick), `guest @${tick}`).toBe(hash);
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

  it('a guest that goes silent times out: the AI drives its Fighter and the host plays on', () => {
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
    expect(host.status).toBe('Running');
    expect(events).toContainEqual(expect.objectContaining({ type: 'PlayerLeft', player: 1 }));
    const at = host.currentTick;
    for (let i = 0; i < 10; i++) host.tick(IDLE_INTENT);
    expect(host.currentTick).toBe(at + 10);
  });

  it('a guest the host has dropped is told so, and its Match ends', () => {
    const s = connect({ latencyMs: 30 });
    for (let i = 0; i < 30; i++) frame(s);
    // Host's view: the guest sent nothing for a long while. Feed the guest the host's verdict directly.
    s.pair.a.send({ type: 'intents', tick: 40, streams: [], acks: [40, 20], dropped: [{ player: 1, tick: 21 }] });
    s.pair.advance(50);
    frame(s);
    expect(s.guest.status).toBe('Disconnected');
    expect(s.guestEvents).toContainEqual({ type: 'Disconnected', reason: 'Dropped' });
  });
});
describe('Rollback session: Weapons', () => {
  function connectArmed(hostWeapon: string, guestWeapon: string) {
    const pair = createMemoryTransportPair({ latencyMs: 30 });
    const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, weapon: hostWeapon });
    const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning, weapon: guestWeapon });
    return { pair, host, guest, hostEvents: [] as SessionEvent[], guestEvents: [] as SessionEvent[] };
  }

  it('each peer picks its own Weapon, and both build the same Match from the exchanged picks', () => {
    const s = connectArmed('Halberd', 'Longsword');
    for (let i = 0; i < 20; i++) frame(s);
    expect(s.host.state!.config.weapons).toEqual(['Halberd', 'Longsword']);
    expect(s.guest.state!.config.weapons).toEqual(['Halberd', 'Longsword']);
    expect(s.guest.state!.duel.fighters.map((f) => f.weapon)).toEqual(['Halberd', 'Longsword']);
    const swing = (t: number): Intent => (t % 90 < 30 ? { ...IDLE_INTENT, attack: true } : IDLE_INTENT);
    for (let i = 0; i < 200; i++) frame(s, swing, swing);
    for (let i = 0; i < 30; i++) frame(s);
    level(s);
    frame(s);
    expect(s.host.currentTick).toBe(s.guest.currentTick);
    expect(hashValue(s.guest.state)).toBe(hashValue(s.host.state));
  });

  it('refuses a guest whose hello carries a Weapon missing from its roster, like a Tuning Data mismatch', () => {
    const pair = createMemoryTransportPair({ latencyMs: 30 });
    const events: SessionEvent[] = [];
    const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH });
    host.onEvent((e) => events.push(e));
    pair.b.send({ type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: tuningDataHash(tuning), weapon: 'Pike' });
    for (let i = 0; i < 10; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
    }
    const refusals: unknown[] = [];
    pair.b.onMessage((m) => refusals.push(m));
    pair.b.send({ type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: tuningDataHash(tuning), weapon: 'Pike' });
    for (let i = 0; i < 10; i++) {
      pair.advance(TICK_MS);
      host.tick(IDLE_INTENT);
    }
    expect(refusals).toContainEqual(expect.objectContaining({ type: 'refuse', reason: 'TuningDataMismatch' }));
    expect(events).toContainEqual({ type: 'PlayerLeft', player: 1, tick: 1 });
    expect(host.state!.config.weapons).toEqual(['Arming Sword', 'Arming Sword']);
  });

  it('refuses to start with a Weapon of its own that is not in the roster', () => {
    const pair = createMemoryTransportPair();
    expect(() => createRollbackSession({ role: 'guest', transport: pair.b, tuning, weapon: 'Pike' })).toThrow(/Pike/);
  });
});
