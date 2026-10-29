import { describe, expect, it } from 'vitest';
import { hashValue, IDLE_INTENT, stepMatch, TICK_RATE, type Intent, type MatchState } from '../sim';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { createMemoryTransportPair, createRollbackSession, type MemoryTransportOptions } from '../net';
import { playerVsPlayer } from './online';
import type { MatchDriver } from './driver';

const tuning = loadTuningData();
const TICK_MS = 1000 / TICK_RATE;

function room(
  net: MemoryTransportOptions = {},
  opts: { guestTuning?: TuningData; step?: typeof stepMatch; rematchTicks?: number; names?: string[] } = {},
) {
  const pair = createMemoryTransportPair(net);
  const host = playerVsPlayer(
    createRollbackSession({ role: 'host', transport: pair.a, tuning, match: { bestOf: 3, seed: 5, rematchTicks: opts.rematchTicks }, step: opts.step }),
    opts.names,
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

/** The host starts a hop ahead (time sync evens it out over a few seconds): let the peer behind catch up alone. */
function level(r: ReturnType<typeof room>) {
  for (let i = 0; i < 200 && r.host.state!.tick !== r.guest.state!.tick; i++) {
    r.pair.advance(TICK_MS);
    if (r.host.state!.tick < r.guest.state!.tick) r.host.tick(IDLE_INTENT);
    else r.guest.tick(IDLE_INTENT);
  }
  // Deliver what is in flight; the next joint Tick takes it in (rolling back where needed).
  r.pair.advance(200);
  r.tick();
}

const forward: Intent = { ...IDLE_INTENT, move: { x: 0, z: 1 } };

describe('Player vs Player Match driver (Rollback session over a Transport)', () => {
  it('the host drives Fighter 0 and the guest Fighter 1 (by default, once connected)', () => {
    const r = room();
    runUntilConnected(r);
    expect(r.host.localFighter).toBe(0);
    expect(r.guest.localFighter).toBe(1);
  });

  it("the opponent's Fighter is driven by a Remote Controller that supplies the peer's Intents", () => {
    const r = room({ latencyMs: 20 });
    const blocking: Intent = { ...IDLE_INTENT, block: true, direction: 'Left' };
    runUntilConnected(r);
    expect(r.host.remote.intent(r.host.state!.duel, 1)).toEqual(IDLE_INTENT);
    for (let i = 0; i < 30; i++) r.tick(forward, blocking);
    expect(r.host.remote.intent(r.host.state!.duel, 1)).toEqual(blocking);
    expect(r.guest.remote.intent(r.guest.state!.duel, 0)).toEqual(forward);
    expect(r.host.state!.duel.fighters[1]!.action).toMatchObject({ kind: 'Block', direction: 'Left' });
  });

  it('shows a waiting message and no Match until the peers have connected', () => {
    const r = room();
    expect(r.host.state).toBeNull();
    expect(r.host.waiting).toMatch(/other player/i);
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
    level(r);
    const host = r.host.state!;
    const guest = r.guest.state!;
    expect(host.duel.fighters[0]!.position.z).toBeGreaterThan(z0);
    expect(host.duel.fighters[1]!.position.z).toBeGreaterThan(z1);
    // Same Tick, same state on both browsers.
    expect(host.tick).toBe(guest.tick);
    expect(hashValue(host)).toBe(hashValue(guest));
  });

  it('a click made while the session is stalled still reaches the Simulation', () => {
    // 400 ms one way: the host runs into the Rollback window and stalls.
    const r = room({ latencyMs: 400 });
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

  it('refuses a guest with different Tuning Data, with a message that says so; the host plays on', () => {
    const other: TuningData = withWeapon(tuning, { damage: tuning.weapons['Arming Sword']!.damage + 1 });
    const r = room({}, { guestTuning: other });
    for (let i = 0; i < 30; i++) r.tick();
    expect(r.guest.failure).toMatch(/Tuning Data/);
    expect(r.guest.state).toBeNull();
    expect(r.host.failure).toBeNull();
    expect(r.host.takeNotice()).toMatch(/Player 2 left: the AI takes over/);
  });

  it('tells the host when a guest leaves, by name, and plays on with the AI in their place', () => {
    const r = room({}, { names: ['Ann', 'Bo'] });
    runUntilConnected(r);
    r.guest.close();
    const at = r.host.state!.tick;
    for (let i = 0; i < 10; i++) r.tick();
    expect(r.host.failure).toBeNull();
    expect(r.host.takeNotice()).toBe('Bo left: the AI takes over');
    expect(r.host.takeNotice()).toBeNull();
    expect(r.host.state!.tick).toBe(at + 10);
  });

  it('tells a guest when the host disconnects', () => {
    const r = room();
    runUntilConnected(r);
    r.host.close();
    r.tick();
    expect(r.guest.failure).toMatch(/host left/i);
  });

  it('tells a guest when the host stops answering, and the host that the guest did', () => {
    const r = room();
    runUntilConnected(r);
    // The guest's browser freezes: only the host keeps ticking.
    for (let i = 0; i < 400; i++) {
      r.pair.advance(TICK_MS);
      r.host.tick(IDLE_INTENT);
    }
    expect(r.host.failure).toBeNull();
    expect(r.host.takeNotice()).toMatch(/left/);
    // The guest wakes: the host has let it go, so nothing more arrives.
    for (let i = 0; i < 400; i++) {
      r.pair.advance(TICK_MS);
      r.guest.tick(IDLE_INTENT);
    }
    expect(r.guest.failure).toMatch(/host/i);
  });

  it('a disconnect after the Match is over is still a failure: a rematch would follow', () => {
    // A stand-in Tick function that ends the Match on Tick 5.
    const endsAt5: typeof stepMatch = (match, intents, t) => {
      const next = stepMatch(match, intents, t);
      return next.tick >= 5 ? ({ ...next, status: { status: 'Over', winner: 0, tick: 5 } } as MatchState) : next;
    };
    const r = room({}, { step: endsAt5 });
    runUntilConnected(r);
    for (let i = 0; i < 30; i++) r.tick();
    expect(r.guest.state!.status.status).toBe('Over');
    r.host.close();
    r.tick();
    expect(r.guest.failure).toMatch(/left/);
  });

  it('both peers roll into the same rematch once the Match is over (the host chose `rematchTicks`)', () => {
    // A stand-in Tick function that ends the first Match on Tick 5.
    const endsAt5: typeof stepMatch = (match, intents, t) => {
      const next = stepMatch(match, intents, t);
      return next.matchNumber === 1 && next.tick >= 5 && next.status.status === 'InProgress'
        ? ({ ...next, status: { status: 'Over', winner: 0, tick: next.tick } } as MatchState)
        : next;
    };
    const r = room({ latencyMs: 30 }, { step: endsAt5, rematchTicks: 20 });
    runUntilConnected(r);
    for (let i = 0; i < 80; i++) r.tick(forward, forward);
    for (let i = 0; i < 30; i++) r.tick();
    level(r);
    expect(r.host.failure).toBeNull();
    expect(r.host.state).toMatchObject({ matchNumber: 2, duelNumber: 1, score: [0, 0], status: { status: 'InProgress' } });
    expect(r.guest.state!.tick).toBe(r.host.state!.tick);
    expect(hashValue(r.guest.state)).toBe(hashValue(r.host.state));
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

describe('Player vs Player Match driver with the dev autopilot', () => {
  /** A Controller that records what it is asked, and always presses attack. */
  const attacker = () => {
    const calls: { tick: number; fighter: number }[] = [];
    const watched: number[] = [];
    return {
      calls,
      watched,
      watch: (m: MatchState) => void watched.push(m.tick),
      intent: (s: { tick: number }, fighter: number): Intent => {
        calls.push({ tick: s.tick, fighter });
        return { ...IDLE_INTENT, attack: true };
      },
    };
  };

  it('sends the autopilot\'s Intent for the local Fighter, fed the session state, instead of the Local Controller\'s', () => {
    const pair = createMemoryTransportPair();
    const pilot = attacker();
    const host = playerVsPlayer(createRollbackSession({ role: 'host', transport: pair.a, tuning, match: { bestOf: 3, seed: 5 } }), [], pilot);
    const guest = playerVsPlayer(createRollbackSession({ role: 'guest', transport: pair.b, tuning }));
    for (let i = 0; i < 60 && !(host.state && guest.state); i++) {
      pair.advance(TICK_MS);
      host.tick(forward);
      guest.tick(IDLE_INTENT);
    }
    pilot.calls.length = 0;
    pilot.watched.length = 0;
    pair.advance(TICK_MS);
    const real = host.localFighter;
    const before = host.state!.duel.tick;
    host.tick(forward);
    // Not asked before the Match exists; once it does, asked for the local Fighter with the state about to be stepped.
    expect(pilot.calls).toEqual([{ tick: before, fighter: real }]);
    expect(pilot.watched).toEqual([host.state!.tick - 1]);
  });

  it('is asked once per new Tick: while the session stalls on the same state, its Intent is reused and its memory does not move', () => {
    // 400 ms one way: the host runs into the Rollback window and stalls, its state not advancing.
    const pair = createMemoryTransportPair({ latencyMs: 400 });
    const pilot = attacker();
    const host = playerVsPlayer(createRollbackSession({ role: 'host', transport: pair.a, tuning, match: { bestOf: 3, seed: 5 } }), [], pilot);
    const guest = playerVsPlayer(createRollbackSession({ role: 'guest', transport: pair.b, tuning }));
    let stalledFrames = 0;
    for (let i = 0; i < 150; i++) {
      pair.advance(TICK_MS);
      const { advanced } = host.tick(forward);
      guest.tick(IDLE_INTENT);
      if (!advanced) stalledFrames++;
    }
    expect(stalledFrames).toBeGreaterThan(5);
    // Each Tick of the state it was asked about, and watched, once, in order, however many frames the session spent on it.
    const ticks = pilot.calls.map((c) => c.tick);
    expect(ticks.length).toBeGreaterThan(20);
    expect(ticks).toEqual([...new Set(ticks)]);
    expect(pilot.watched).toEqual([...new Set(pilot.watched)]);
  });

  it('is not asked, and the local Intent goes through, without one', () => {
    const r = room();
    runUntilConnected(r);
    const z0 = r.host.state!.duel.fighters[r.host.localFighter]!.position.z;
    for (let i = 0; i < 20; i++) r.tick(forward);
    expect(r.host.state!.duel.fighters[r.host.localFighter]!.position.z).not.toBe(z0);
  });
});
