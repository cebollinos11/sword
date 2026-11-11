/**
 * The Flail online (docs/plans/flail.md, Verification): two peers, the host's Player and an AI on its side with a Flail, through spins,
 * Feints, Heavy Blows, Input Delay, Rollbacks and a forced resync caught while the AI's Flail is mid-spin, so its memory then (its
 * spin aim, and a defender's read of a spin) crosses the wire. Every peer must agree with the offline Match, hash for hash.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, hashValue, IDLE_INTENT, stepMatch, TICK_RATE, type Direction, type Intent, type MatchState } from '../sim';
import { lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { createMemoryTransportPair } from './memoryTransport';
import { CHECKSUM_INTERVAL, createRollbackSession, type SessionEvent } from './session';

const tuning = loadTuningData();
const TICK_MS = 1000 / TICK_RATE;
const MATCH = { bestOf: 3, interDuelTicks: 30, seed: 7 };
/** Both Players walk at each other for this many Ticks first, and the host steps in this many more at the start of each loop. */
const OPEN = 60;
const WALK = 10;
/** The host's Flail and the guest's Longsword (the Players' picks, in Player order). */
const PICKS = ['Flail', 'Longsword'];
/** The host's Player and an Expert Flail AI against the guest's Player and an Expert Longsword AI. */
const LINEUP: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'Player', player: 1 } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Expert' }, weapon: 'Flail' },
  { team: 1, pilot: { kind: 'AI', difficulty: 'Expert' }, weapon: 'Longsword' },
];
const DELAY = [2, 3];
const TICKS = 1500;
/**
 * The guest drifts here (a "floating-point difference": Fighter 1 moves 5 cm), so its checksum at DESYNC_AT fails and the host resyncs
 * it to its confirmed state a round trip later: the AI's Flail letting go of a spin it held, and the AI facing it stepping back from the spin
 * it read (a Back plan).
 */
const DRIFT_AT = 320;
const DESYNC_AT = 330;

/**
 * The host's Flail, on a 200-Tick loop: it walks in, spins a Left to full and Feints it into a Right (the charge kept), lets go; taps an
 * Overhead; presses Thrust (an Overhead); spins and Block-Feints out of it (the charge dropped).
 */
function host(tick: number): Intent {
  if (tick < OPEN) return { ...IDLE_INTENT, move: { x: 1, z: 0 } };
  const t = (tick - OPEN) % 200;
  const at = (from: number, to: number) => t >= from && t < to;
  const swing = (direction: Direction): Intent => ({ ...IDLE_INTENT, attack: true, direction });
  if (at(0, WALK)) return { ...IDLE_INTENT, move: { x: 1, z: 0 } };
  if (at(30, 80)) return swing('Left');
  if (at(80, 130)) return swing('Right');
  if (at(140, 150)) return swing('Overhead');
  if (at(160, 170)) return swing('Thrust');
  if (at(175, 190)) return swing('Overhead');
  if (at(190, 195)) return { ...IDLE_INTENT, block: true, direction: 'Left' };
  return IDLE_INTENT;
}

/** The guest's Longsword: walks about, swings and Blocks in a pattern that keeps the host's predictions missing. */
function guest(tick: number): Intent {
  if (tick < OPEN) return { ...IDLE_INTENT, move: { x: -1, z: 0 } };
  const k = Math.floor(tick / 7) + 3;
  return { ...IDLE_INTENT, move: { x: k % 4 === 3 ? 1 : -(k % 2), z: (k % 3) - 1 }, attack: k % 5 === 0 && tick % 2 === 0, block: k % 4 === 1, direction: (['Left', 'Right', 'Overhead', 'Thrust'] as const)[k % 4]! };
}
const SCRIPTS = [host, guest];

/** The part of an AI's memory (`save()`, through JSON) this test reads. */
type Memory = { readonly attackPlan: object | null; readonly defencePlan: object | null } | null;

/**
 * The Match every peer should agree on: stepped offline, each Player's Intent played its Input Delay late, the AIs on the state. With the
 * AIs' memory (as a host would send it) on the Ticks a resync may land on.
 */

function offline(): { hashes: Map<number, string>; states: MatchState[]; memory: Memory[][] } {
  let m = createMatch(tuning, lineupMatch(tuning, LINEUP, PICKS, MATCH));
  const ais = lineupAis(tuning, LINEUP);
  const hashes = new Map<number, string>();
  const states = [m];
  const memory: Memory[][] = [];
  for (let t = 1; t <= TICKS; t++) {
    const intents = LINEUP.map((s, i) => {
      if (s.pilot.kind === 'AI') return (ais[i] as Controller).intent(m.duel, i);
      const p = s.pilot.player;
      return t > DELAY[p]! ? SCRIPTS[p]!(t - DELAY[p]!) : IDLE_INTENT;
    });
    m = stepMatch(m, intents, tuning);
    states.push(m);
    if (t > DESYNC_AT && t <= DESYNC_AT + 120) memory[t] = ais.map((a) => (a?.save ? JSON.parse(JSON.stringify(a.save())) : null));
    if (t % CHECKSUM_INTERVAL === 0) hashes.set(t, hashValue(m));
  }
  return { hashes, states, memory };
}

const drifting: typeof stepMatch = (m, intents, t) => {
  const next = stepMatch(m, intents, t);
  if (next.tick !== DRIFT_AT) return next;
  const fighters = next.duel.fighters.map((f, i) => (i === 1 ? { ...f, position: { x: f.position.x + 0.05, z: f.position.z } } : f));
  return { ...next, duel: { ...next.duel, fighters } };
};

describe('Rollback session: the Flail online (docs/plans/flail.md, Verification)', () => {
  it('two peers, a Player and an AI with a Flail: spins, Feints and Heavy Blows through Input Delay, Rollbacks and a resync mid-spin', () => {
    const o = offline();
    const attack = (m: MatchState, i: number) => {
      const a = m.duel.fighters[i]!.action;
      return a.kind === 'Attack' ? a : null;
    };
    // What the Match goes through: no Flail ever Thrusts (the host's Thrust press is an Overhead), the host's Left spin Feints into a
    // Right keeping its charge, both Flails land Heavy Blows, and the AI's Flail is mid-spin, its foe stepping back, at the resync.
    for (const m of o.states) for (const i of [0, 2]) expect(attack(m, i)?.direction).not.toBe('Thrust');
    const kept = o.states.some((m, t) => {
      const [a, b] = [t > 0 ? attack(o.states[t - 1]!, 0) : null, attack(m, 0)];
      return a?.phase === 'Wind-up' && b?.phase === 'Wind-up' && a.direction === 'Left' && b.direction === 'Right' && b.charge === a.charge! + 1 && a.charge! > 40;
    });
    expect(kept).toBe(true);
    const heavy = o.states.flatMap((m) => m.duel.events.flatMap((e) => ((e.type === 'Hit' || e.type === 'Block') && e.heavy ? [e.attacker] : [])));
    expect(heavy).toContain(0);
    expect(heavy).toContain(2);
    const pair = createMemoryTransportPair({ latencyMs: 60, jitterMs: 30, loss: 0.1, seed: 7 });
    const peers = [
      createRollbackSession({ role: 'host', transport: pair.a, tuning, match: MATCH, lineup: LINEUP, weapon: PICKS[0], inputDelay: DELAY[0] }),
      createRollbackSession({ role: 'guest', transport: pair.b, tuning, weapon: PICKS[1], inputDelay: DELAY[1], step: drifting }),
    ];
    const guestEvents: SessionEvent[] = [];
    peers[1]!.onEvent((e) => guestEvents.push(e));
    // Each peer's checksums as they are confirmed (a session keeps only its recent ones).
    const seen = peers.map(() => new Map<number, string>());
    for (let i = 0; i < 20_000 && Math.min(...peers.map((p) => p.confirmedTick)) < TICKS; i++) {
      pair.advance(TICK_MS);
      peers.forEach((p, k) => {
        p.tick(SCRIPTS[k]!(p.currentTick + 1));
        for (const t of o.hashes.keys()) if (!seen[k]!.has(t) && p.checksumAt(t) !== undefined) seen[k]!.set(t, p.checksumAt(t)!);
      });
    }
    expect(Math.min(...peers.map((p) => p.confirmedTick))).toBeGreaterThanOrEqual(TICKS);
    expect(peers[0]!.stats.rollbacks + peers[1]!.stats.rollbacks).toBeGreaterThan(0);
    expect(guestEvents.find((e) => e.type === 'Desync')).toMatchObject({ tick: DESYNC_AT });
    expect(guestEvents.filter((e) => e.type === 'Desync')).toHaveLength(1);
    const resynced = guestEvents.find((e): e is Extract<SessionEvent, { type: 'Resynced' }> => e.type === 'Resynced')!.tick;
    // The state and the AI memory the host sent: its AI's Flail letting go of a spin (its spin aim still in its plan), the AI facing it
    // stepping back from it (a Back plan, which a resync refused before Stage 5).
    expect(resynced).toBeGreaterThan(DESYNC_AT);
    expect(resynced).toBeLessThanOrEqual(DESYNC_AT + 120);
    const spinning = attack(o.states[resynced]!, 2);
    expect(spinning, `@${resynced}`).toMatchObject({ charge: expect.any(Number) });
    expect(spinning!.charge).toBeGreaterThan(30);
    expect(o.memory[resynced]![2]!.attackPlan).toMatchObject({ spin: expect.any(Number), spinUntil: expect.any(Number) });
    expect(o.memory[resynced]![3]!.defencePlan).toMatchObject({ kind: 'Back', spinRead: true });
    for (const [tick, hash] of o.hashes) {
      expect(seen[0]!.get(tick), `host @${tick}`).toBe(hash);
      if (tick < DRIFT_AT || tick > resynced) expect(seen[1]!.get(tick), `guest @${tick}`).toBe(hash);
    }
  });
});
