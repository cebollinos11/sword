import { describe, expect, it } from 'vitest';
import { hashValue, IDLE_INTENT, stepMatch, type Intent, type MatchState } from '../sim';
import { loadTuningData, type TuningData } from '../tuning';
import { createMemoryTransportPair, createRollbackSession, type MemoryTransportOptions } from '../net';
import { playerVsPlayer } from './online';
import type { MatchDriver } from './driver';

const tuning = loadTuningData();
const TICK_MS = 1000 / 60;

function room(
  net: MemoryTransportOptions = {},
  opts: { guestTuning?: TuningData; step?: typeof stepMatch } = {},
) {
  const pair = createMemoryTransportPair(net);
  const host = playerVsPlayer(
    createRollbackSession({ role: 'host', transport: pair.a, tuning, match: { bestOf: 3, seed: 5 }, step: opts.step }),
  );
  const guest = playerVsPlayer(
    createRollbackSession({ role: 'guest', transport: pair.b, tuning: opts.guestTuning ?? tuning, step: opts.step }),
  );
  /** One wall-clock Tick on both browsers. */
  const tick = (hostIntent: Intent = IDLE_INTENT, guestIntent: Intent = IDLE_INTENT) => {
    pair.advance(TICK_MS);
    return { host: host.tick(hostIntent), guest: guest.tick(guestIntent) };
  };
  return { pair, host, guest, tick };
}

function runUntilConnected(r: ReturnType<typeof room>) {
  for (let i = 0; i < 60 && !(r.host.state && r.guest.state); i++) r.tick();
}

const forward: Intent = { ...IDLE_INTENT, move: { x: 0, z: 1 } };

describe('Player vs Player Match driver (Rollback session over a Transport)', () => {
  it('the host drives Fighter 0 and the guest Fighter 1', () => {
    const r = room();
    expect(r.host.localFighter).toBe(0);
    expect(r.guest.localFighter).toBe(1);
  });

  it('shows a waiting message and no Match until the peers have connected', () => {
    const r = room();
    expect(r.host.state).toBeNull();
    expect(r.host.waiting).toMatch(/opponent/i);
    expect(r.host.failure).toBeNull();
    runUntilConnected(r);
    expect(r.host.state).not.toBeNull();
    expect(r.guest.state).not.toBeNull();
    expect(r.host.waiting).toBeNull();
  });

  it("each peer's local Intent moves its own Fighter, and both peers agree once Intents have arrived", () => {
    const r = room({ latencyMs: 40, jitterMs: 20, loss: 0.1, seed: 3 });
    runUntilConnected(r);
    const z0 = r.host.state!.duel.fighters[0]!.position.z;
    const z1 = r.host.state!.duel.fighters[1]!.position.z;
    // Host walks toward +z, the guest walks away (+z too, since Fighter 1 starts at +z).
    for (let i = 0; i < 20; i++) r.tick(forward, forward);
    for (let i = 0; i < 60; i++) r.tick();
    const host = r.host.state!;
    const guest = r.guest.state!;
    expect(host.duel.fighters[0]!.position.z).toBeGreaterThan(z0);
    expect(host.duel.fighters[1]!.position.z).toBeGreaterThan(z1);
    // Same Tick, same state on both browsers.
    expect(host.tick).toBe(guest.tick);
    expect(hashValue(host)).toBe(hashValue(guest));
  });

  it('a click made while the session is stalled still reaches the Simulation', () => {
    // 300 ms one way: the host runs into the Rollback window and stalls.
    const r = room({ latencyMs: 300 });
    runUntilConnected(r);
    let stalled = false;
    let attacked = false;
    for (let i = 0; i < 120; i++) {
      const { host } = r.tick();
      if (!host.advanced && !stalled) {
        stalled = true;
        // A tap: pressed and released within this one stalled Tick.
        r.host.tick({ ...IDLE_INTENT, attack: true });
      }
      if (r.host.state!.duel.fighters[0]!.action.kind === 'Attack') attacked = true;
    }
    expect(stalled).toBe(true);
    expect(attacked).toBe(true);
  });

  it('refuses a peer with different Tuning Data, with a message that says so', () => {
    const other: TuningData = { ...tuning, weapon: { ...tuning.weapon, damage: tuning.weapon.damage + 1 } };
    const r = room({}, { guestTuning: other });
    for (let i = 0; i < 30; i++) r.tick();
    expect(r.host.failure).toMatch(/Tuning Data/);
    expect(r.guest.failure).toMatch(/Tuning Data/);
    expect(r.host.state).toBeNull();
  });

  it("tells the player when the opponent disconnects", () => {
    const r = room();
    runUntilConnected(r);
    r.guest.close();
    r.tick();
    expect(r.host.failure).toMatch(/opponent.*(left|disconnected)/i);
  });

  it('tells the player when the opponent stops answering', () => {
    const r = room();
    runUntilConnected(r);
    // The guest's browser freezes: only the host keeps ticking.
    for (let i = 0; i < 400; i++) {
      r.pair.advance(TICK_MS);
      r.host.tick(IDLE_INTENT);
    }
    expect(r.host.failure).toMatch(/lost the connection/i);
  });

  it('a disconnect after the Match is over is not a failure', () => {
    // A stand-in Tick function that ends the Match on Tick 5.
    const endsAt5: typeof stepMatch = (match, intents, t) => {
      const next = stepMatch(match, intents, t);
      return next.tick >= 5 ? ({ ...next, status: { status: 'Over', winner: 0, tick: 5 } } as MatchState) : next;
    };
    const r = room({}, { step: endsAt5 });
    runUntilConnected(r);
    for (let i = 0; i < 30; i++) r.tick();
    expect(r.host.state!.status.status).toBe('Over');
    r.guest.close();
    r.tick();
    expect(r.host.failure).toBeNull();
  });

  it('closing the driver closes the connection for both peers', () => {
    const r = room();
    runUntilConnected(r);
    r.host.close!();
    r.tick();
    expect(r.guest.failure).not.toBeNull();
  });
});

// Keep the shared interface honest: a Player vs Player driver is a MatchDriver.
const _typeCheck: (d: ReturnType<typeof playerVsPlayer>) => MatchDriver = (d) => d;
void _typeCheck;
