/**
 * A Random Map online (docs/plans/generated-arenas.md, Stage 5): each peer builds the Generated Arena from the
 * Lobby's Map setting alone, and the two stay in step; peers whose generators or Kits differ refuse each other.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash, type TuningData } from '../tuning';
import { createMatch, DIRECTIONS, GENERATOR_VERSION, hashValue, IDLE_INTENT, stepMatch, TICK_RATE, withGeneratedArena, type Intent } from '../sim';
import { createMemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, type SessionEvent } from './session';
import { PROTOCOL_VERSION } from './messages';

const NAME = 'gen:greybox:4242';
const TICKS = 600;
const TICK_MS = 1000 / TICK_RATE;
const MATCH = { bestOf: 3, arena: NAME, seed: 9 };

/** Each peer loads its own Tuning Data and builds the Arena from the name, as the game does. */
const peerTuning = (): TuningData => withGeneratedArena(loadTuningData(), NAME).tuning;

/** Something to fight over: each side walks and swings in its own pattern. */
const busy =
  (phase: number) =>
  (tick: number): Intent => ({
    ...IDLE_INTENT,
    move: { x: Math.sign(((tick + phase) % 90) - 45) * 0.5, z: 1 },
    attack: (tick + phase) % 40 === 0,
    direction: DIRECTIONS[Math.floor((tick + phase) / 40) % DIRECTIONS.length]!,
  });
const HOST = busy(0);
const GUEST = busy(17);

function connect(hostTuning: TuningData, guestTuning: TuningData) {
  const pair = createMemoryTransportPair({ latencyMs: 40, jitterMs: 20, seed: 4 });
  const host = createRollbackSession({ role: 'host', transport: pair.a, tuning: hostTuning, match: MATCH });
  const guest = createRollbackSession({ role: 'guest', transport: pair.b, tuning: guestTuning });
  const guestEvents: SessionEvent[] = [];
  guest.onEvent((e) => guestEvents.push(e));
  const frame = (h = HOST, g = GUEST) => {
    pair.advance(TICK_MS);
    host.tick(h(host.currentTick + 1));
    guest.tick(g(guest.currentTick + 1));
  };
  return { pair, host, guest, guestEvents, frame };
}

describe('a Random Map online', () => {
  it('two peers build the same Arena from gen:greybox:<seed>, and their checksums agree for 600 Ticks', () => {
    const [hostTuning, guestTuning] = [peerTuning(), peerTuning()];
    expect(hostTuning).not.toBe(guestTuning);
    expect(hashValue(guestTuning.arenas[NAME])).toBe(hashValue(hostTuning.arenas[NAME]));
    expect(tuningDataHash(guestTuning)).toBe(tuningDataHash(hostTuning));

    // What both should agree on: the Match stepped offline with the same Intents.
    let m = createMatch(hostTuning, MATCH);
    const expected = new Map<number, string>();
    for (let t = 1; t <= TICKS; t++) {
      m = stepMatch(m, [HOST(t), GUEST(t)], hostTuning);
      if (t % CHECKSUM_INTERVAL === 0) expected.set(t, hashValue(m));
    }

    const s = connect(hostTuning, guestTuning);
    for (let i = 0; i < 5000 && Math.min(s.host.confirmedTick, s.guest.confirmedTick) < TICKS; i++) s.frame();
    expect(s.guest.status).toBe('Running');
    expect(s.guest.state!.config.arena).toBe(NAME);
    expect(Math.min(s.host.confirmedTick, s.guest.confirmedTick)).toBeGreaterThanOrEqual(TICKS);
    for (const [tick, hash] of expected) {
      expect(s.host.checksumAt(tick), `host @${tick}`).toBe(hash);
      expect(s.guest.checksumAt(tick), `guest @${tick}`).toBe(hash);
    }
    expect(s.guestEvents.some((e) => e.type === 'Desync')).toBe(false);
  });

  it('a peer whose Kit file differs is refused', () => {
    const base = loadTuningData();
    const kit = base.kits.greybox!;
    const otherKit: TuningData = { ...base, kits: { greybox: { ...kit, pieces: { ...kit.pieces, crate: { ...kit.pieces.crate, walls: [] } } } } };
    const s = connect(peerTuning(), withGeneratedArena(otherKit, NAME).tuning);
    for (let i = 0; i < 30; i++) s.frame(() => IDLE_INTENT, () => IDLE_INTENT);
    expect(s.guest.status).toBe('Refused');
    expect(s.guestEvents).toContainEqual(expect.objectContaining({ type: 'Refused', reason: 'TuningDataMismatch' }));
  });

  it('a peer on another GENERATOR_VERSION is refused, though its Tuning Data is the same', () => {
    const tuning = peerTuning();
    /** What the host replies to a hello hashed with generator `version`. */
    const replies = (version: number) => {
      const pair = createMemoryTransportPair({ latencyMs: 30 });
      const host = createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH });
      const heard: unknown[] = [];
      pair.b.onMessage((m) => heard.push(m));
      pair.b.send({ type: 'hello', protocol: PROTOCOL_VERSION, tuningHash: tuningDataHash(tuning, version), weapon: 'Arming Sword' });
      for (let i = 0; i < 20; i++) {
        pair.advance(TICK_MS);
        host.tick(IDLE_INTENT);
      }
      return heard;
    };
    const refusal = expect.objectContaining({ type: 'refuse', reason: 'TuningDataMismatch' });
    expect(replies(GENERATOR_VERSION)).not.toContainEqual(refusal);
    expect(replies(GENERATOR_VERSION + 1)).toContainEqual(refusal);
  });
});
