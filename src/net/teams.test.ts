import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash } from '../tuning';
import { createMatch, hashValue, IDLE_INTENT, stepMatch, TICK_RATE, type Intent } from '../sim';
import { lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { createMemoryTransportPair, type MemoryTransportOptions } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, type SessionEvent } from './session';
import { parseNetMessage, PROTOCOL_VERSION } from './messages';

const tuning = loadTuningData();
const TICK_MS = 1000 / TICK_RATE;
const MATCH = { bestOf: 3, interDuelTicks: 30, seed: 8 };

/** The two Players together (the guest beside the host) against three AIs of mixed difficulty and Weapon. */
const ALLIES_VS_THREE: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'AI', difficulty: 'Hard' }, weapon: 'Halberd' },
  { team: 0, pilot: { kind: 'Player', player: 1 } },
  { team: 1, pilot: { kind: 'AI', difficulty: 'Easy' } },
  { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' }, weapon: 'Longsword' },
];

/** The Players on opposite sides, each with an AI ally: 2 v 2. */
const MIXED: Lineup = [
  { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } },
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'Player', player: 1 } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } },
];

/** Busy Players: walk forward, swinging and blocking in a pattern that keeps predictions missing. */
const busy = (seed: number) => (tick: number): Intent => {
  const k = Math.floor(tick / 7) + seed;
  return { ...IDLE_INTENT, move: { x: (k % 3) - 1, z: 1 }, attack: k % 4 === 0 && tick % 2 === 0, block: k % 5 === 1, direction: (['Left', 'Right', 'Overhead'] as const)[k % 3]! };
};
const HOST = busy(1);
const GUEST = busy(2);

function connect(lineup: Lineup, net: MemoryTransportOptions) {
  const pair = createMemoryTransportPair(net);
  const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup, weapon: 'Longsword' });
  const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning, weapon: 'Halberd' });
  const guestEvents: SessionEvent[] = [];
  guest.onEvent((e) => guestEvents.push(e));
  return { pair, host, guest, guestEvents };
}

/** The Match both peers should agree on: stepped offline with the Players' real Intents and fresh AI Controllers. */
function offlineHashes(lineup: Lineup, ticks: number): Map<number, string> {
  let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Longsword', 'Halberd'], MATCH));
  const players: Record<number, (t: number) => Intent> = { 0: HOST, 1: GUEST };
  const ais = lineupAis(tuning, lineup);
  const hashes = new Map<number, string>();
  for (let t = 1; t <= ticks; t++) {
    const intents = lineup.map((s, i) => (s.pilot.kind === 'Player' ? players[s.pilot.player]!(t) : (ais[i] as Controller).intent(m.duel, i)));
    m = stepMatch(m, intents, tuning);
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, hashValue(m));
  }
  return hashes;
}

function play(s: ReturnType<typeof connect>, ticks: number): void {
  for (let i = 0; i < 20_000 && Math.min(s.host.confirmedTick, s.guest.confirmedTick) < ticks; i++) {
    s.pair.advance(TICK_MS);
    s.host.tick(HOST(s.host.currentTick + 1));
    s.guest.tick(GUEST(s.guest.currentTick + 1));
  }
  expect(Math.min(s.host.confirmedTick, s.guest.confirmedTick)).toBeGreaterThanOrEqual(ticks);
}

describe('Rollback session: team battles', () => {
  it('builds the host\'s Lineup on both peers: each Player drives their own slot', () => {
    const s = connect(ALLIES_VS_THREE, { latencyMs: 40 });
    expect(s.guest.localFighter).toBe(-1); // not until the host's hello brings the Lineup
    for (let i = 0; i < 20; i++) {
      s.pair.advance(TICK_MS);
      s.host.tick(IDLE_INTENT);
      s.guest.tick(IDLE_INTENT);
    }
    expect(s.host.localFighter).toBe(0);
    expect(s.guest.localFighter).toBe(2);
    expect(s.guest.state!.config).toEqual(s.host.state!.config);
    expect(s.host.state!.config.teams).toEqual([0, 1, 0, 1, 1]);
    expect(s.host.state!.config.weapons).toEqual(['Longsword', 'Halberd', 'Halberd', 'Arming Sword', 'Longsword']);
  });

  it.each([
    ['allies vs three AIs, latency + jitter', ALLIES_VS_THREE, { latencyMs: 60, jitterMs: 40, seed: 3 }],
    ['2 v 2 with AI allies, latency + jitter + loss', MIXED, { latencyMs: 50, jitterMs: 40, loss: 0.2, seed: 5 }],
  ])('both peers converge to the same hashes as an offline Match, AI Fighters included (%s)', (_name, lineup, net) => {
    const TICKS = 600; // the session keeps checksums this far back
    const expected = offlineHashes(lineup, TICKS);
    const s = connect(lineup, net);
    play(s, TICKS);
    for (const [tick, hash] of expected) {
      expect(s.host.checksumAt(tick), `host @${tick}`).toBe(hash);
      expect(s.guest.checksumAt(tick), `guest @${tick}`).toBe(hash);
    }
    expect(s.host.stats.rollbacks + s.guest.stats.rollbacks).toBeGreaterThan(0);
    expect(s.guestEvents.some((e) => e.type === 'Desync')).toBe(false);
  });

  it('resyncs a diverged guest to the host state and its AI Controllers\' memory', () => {
    const pair = createMemoryTransportPair({ latencyMs: 50, jitterMs: 20, seed: 6 });
    // A "floating-point difference" on the guest only: every time it simulates Tick 100, an AI Fighter drifts 5 cm.
    const drifting: typeof stepMatch = (m, intents, t) => {
      const next = stepMatch(m, intents, t);
      if (next.tick !== 100) return next;
      const fighters = next.duel.fighters.map((f, i) => (i === 1 ? { ...f, position: { x: f.position.x + 0.05, z: f.position.z } } : f));
      return { ...next, duel: { ...next.duel, fighters } };
    };
    const s = {
      pair,
      host: createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup: ALLIES_VS_THREE, weapon: 'Longsword' }),
      guest: createRollbackSession({ role: 'guest', transport: pair.b, tuning, weapon: 'Halberd', step: drifting }),
      guestEvents: [] as SessionEvent[],
    };
    s.guest.onEvent((e) => s.guestEvents.push(e));
    const TICKS = 600;
    const expected = offlineHashes(ALLIES_VS_THREE, TICKS);
    play(s, TICKS);
    expect(s.guestEvents).toContainEqual(expect.objectContaining({ type: 'Resynced' }));
    for (const [tick, hash] of expected) {
      if (tick < 200) continue; // after the resync
      expect(s.guest.checksumAt(tick), `guest @${tick}`).toBe(hash);
    }
  });

  it('refuses a Lineup it cannot field', () => {
    const pair = createMemoryTransportPair({});
    const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning });
    const events: SessionEvent[] = [];
    guest.onEvent((e) => events.push(e));
    // A broken or hostile host: its hello's Lineup fields an AI difficulty nobody has.
    const lineup = [MIXED[0], MIXED[1], MIXED[2], { team: 0, pilot: { kind: 'AI', difficulty: 'Godlike' } }];
    pair.a.send({ type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: tuningDataHash(tuning), weapon: 'Halberd', match: MATCH, lineup });
    for (let i = 0; i < 5; i++) {
      pair.advance(TICK_MS);
      guest.tick(IDLE_INTENT);
    }
    expect(guest.status).toBe('Refused');
    expect(events).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
  });

  it('refuses to host a Lineup without both Players', () => {
    const pair = createMemoryTransportPair({});
    const solo: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } }];
    expect(() => createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup: solo })).toThrow(/Player 1/);
  });
});

describe('Peer message validation: team battles', () => {
  const hello = { type: 'hello', protocol: 4, tuningHash: 'abcd1234', weapon: 'Halberd', match: { bestOf: 3 } };

  it('accepts a hello with a Lineup of up to six', () => {
    expect(parseNetMessage({ ...hello, lineup: ALLIES_VS_THREE })).toEqual({ ...hello, lineup: ALLIES_VS_THREE });
    expect(parseNetMessage({ ...hello, lineup: [...MIXED, ...MIXED.slice(0, 2)] })).not.toBeNull();
  });

  it('refuses a malformed Lineup', () => {
    const player = { team: 0, pilot: { kind: 'Player', player: 0 } };
    for (const lineup of [
      [player],
      Array(7).fill(player),
      [player, { team: 2, pilot: { kind: 'Player', player: 1 } }],
      [player, { team: 1, pilot: { kind: 'Player', player: 2 } }],
      [player, { team: 1, pilot: { kind: 'AI' } }],
      [player, { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' }, weapon: 3 }],
      [player, { team: 1, pilot: { kind: 'Ghost' } }],
    ]) {
      expect(parseNetMessage({ ...hello, lineup }), JSON.stringify(lineup)).toBeNull();
    }
  });
});
