/**
 * docs/plans/big-battle.md, Stage 6: the cost of a Rollback in an online Battle with four Bubbles full. A full-size Battle (200 v 200)
 * with four Players, two a Team, each on a Hard Battle autopilot, and a Pool AI on every other slot, stepped as a Rollback session
 * steps it: each Tick snapshots the state and saves every Pool AI's memory. Every ROLLBACK_EVERY Ticks a ROLLBACK_WINDOW-Tick Rollback
 * (the deepest the session allows) is timed: restore the snapshot from that far back, load the Pool AIs' memory, and re-simulate (the
 * Players' Intents as they were sent, the Pool AIs deciding again), which must land on the same hash.
 *
 * The Bubbles' shared slots (`battle.slots.shared`) were chosen from it: Stage 0 put the budget at about 8 to 10 bound Fighters in all,
 * and four Bubbles of 1 enemy and 1 ally hold about that (Waiting Fighters and corpses fill the Pool past the slots). The figures it
 * logs are the measurement (docs/plans/big-battle.md, Stage 6's Result). The full parallel suite slows every Tick about 3 times, so
 * the time asserted is relative: a Rollback in the melee against one on the march (nothing bound) in the same run, which catches a
 * blow-up in the bound Fighters' cost whatever the machine's load.
 *
 * Its timeout is long: a Battle is about 3,000 Ticks, and the Rollbacks re-simulate about 1.5 times as many again.
 */
import { expect, it } from 'vitest';
import { bubbleSlots, loadTuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { createMatch, hashValue, inDuel, restore, snapshot, stepMatch, type Intent, type MatchState, type Snapshot } from '../sim';
import { ROLLBACK_WINDOW } from './session';

const tuning = loadTuningData();
/** A Rollback is timed every this many Ticks, from FROM_TICK (the armies about to meet) to the Battle's end. */
const ROLLBACK_EVERY = 10;
const FROM_TICK = 300;
/** Stage 0's budget: about this many bound Fighters in all, on average while four Bubbles are fighting. */
const BOUND_BUDGET = 10;
/** The most a Rollback in the melee may cost against one on the march, on average: about 2.7 times alone at 1 enemy + 1 ally a Bubble. */
const MELEE_OVER_MARCH = 4.5;
const LINEUP: Lineup = [0, 1, 0, 1].map((team, player) => ({ team, pilot: { kind: 'Player', player: player as 0 | 1 | 2 | 3 } }));

interface Timed {
  readonly tick: number;
  readonly ms: number;
  /** Pool slots bound to a Soldier still standing. */
  readonly bound: number;
  /** Bubbles in use: the Players' Fighters still fighting. */
  readonly bubbles: number;
}

function soak(seed: number) {
  const options = { format: 'Battle', bestOf: 1, seed } as const;
  const pilots: Controller[] = LINEUP.map(() => createBattlePilot(tuning, 'Hard'));
  const pool = lineupAis(tuning, LINEUP, 'Battle', options);
  let m = createMatch(tuning, lineupMatch(tuning, LINEUP, LINEUP.map(() => 'Longsword'), options));
  const states = new Map<number, Snapshot<MatchState>>([[0, snapshot(m)]]);
  const memories = new Map<number, unknown[]>([[0, pool.map((ai) => ai?.save?.() ?? null)]]);
  const sent = new Map<number, Intent[]>();
  const tickMs: number[] = [];
  const rollbacks: Timed[] = [];
  /** One Tick as the session simulates it: the Players' Intents as sent, the Pool AIs deciding; then the snapshot and the AIs' memory. */
  const simulate = (at: MatchState): MatchState => {
    const t = at.tick + 1;
    const players = sent.get(t)!;
    const next = stepMatch(at, pool.map((ai, k) => (ai ? ai.intent(at.duel, k) : players[k]!)), tuning);
    states.set(t, snapshot(next));
    memories.set(t, pool.map((ai) => ai?.save?.() ?? null));
    return next;
  };
  while (m.status.status === 'InProgress') {
    const at = m;
    sent.set(at.tick + 1, pilots.map((p, k) => JSON.parse(JSON.stringify(p.intent(at.duel, k))) as Intent));
    const t0 = performance.now();
    m = simulate(at);
    tickMs.push(performance.now() - t0);
    states.delete(m.tick - ROLLBACK_WINDOW - 1);
    memories.delete(m.tick - ROLLBACK_WINDOW - 1);
    if (m.tick < FROM_TICK || m.tick % ROLLBACK_EVERY !== 0 || m.status.status !== 'InProgress') continue;
    const target = m.tick;
    const want = hashValue(m);
    const t1 = performance.now();
    let r = restore(states.get(target - ROLLBACK_WINDOW)!);
    const memory = memories.get(target - ROLLBACK_WINDOW)!;
    pool.forEach((ai, k) => ai?.load?.(memory[k]));
    while (r.tick < target) r = simulate(r);
    const bubbles = m.duel.fighters.slice(0, LINEUP.length).filter((f, k) => inDuel(f) && !m.duel.crowd!.players[k]!.away).length;
    rollbacks.push({ tick: target, ms: performance.now() - t1, bound: m.duel.fighters.filter((f) => f.soldier && inDuel(f)).length, bubbles });
    expect(hashValue(r), `seed ${seed}, a Rollback to Tick ${target}`).toBe(want);
    m = r;
  }
  return { ticks: m.tick, winner: m.status.status === 'Over' ? m.status.winner : null, tickMs, rollbacks };
}

const stats = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p99: s[Math.floor(s.length * 0.99)] ?? 0, max: s.at(-1) ?? 0, n: xs.length };
};
const ms = (x: number) => x.toFixed(1);

it(`times a ${ROLLBACK_WINDOW}-Tick Rollback through a four-Player Battle, its four Bubbles full, re-simulating to the same hash every time`, () => {
  const run = soak(1);
  // The melee with four Bubbles in use: every Player fighting, some slot bound.
  const melee = run.rollbacks.filter((r) => r.bubbles === 4 && r.bound > 0);
  const all = stats(run.rollbacks.map((r) => r.ms));
  const busy = stats(melee.map((r) => r.ms));
  const march = stats(run.rollbacks.filter((r) => r.bound === 0).map((r) => r.ms));
  const bound = stats(melee.map((r) => r.bound));
  const byBound = new Map<number, number[]>();
  for (const r of melee) byBound.set(r.bound, [...(byBound.get(r.bound) ?? []), r.ms]);
  const tick = stats(run.tickMs);
  const shared = bubbleSlots(tuning.battle.slots, 4);
  process.stderr.write(
    `\nBattle Rollback soak (four Players, four Bubbles at ${shared.enemies} enemy + ${shared.allies} ally): ${run.ticks} Ticks, ${run.winner === null ? 'unfinished' : `Team ${run.winner} won`}; ` +
      `Tick (+ snapshot, AI save) ${ms(tick.mean)} ms mean, p99 ${ms(tick.p99)}; ` +
      `${ROLLBACK_WINDOW}-Tick Rollback ${ms(all.mean)} ms mean, p99 ${ms(all.p99)}, max ${ms(all.max)} (${all.n}); on the march ${ms(march.mean)} mean (${march.n}); in the melee ${ms(busy.mean)} mean, p99 ${ms(busy.p99)}, max ${ms(busy.max)} (${busy.n}), ${ms(bound.mean)} bound on average, at most ${bound.max}\n` +
      `By slots bound, in the melee (bound: n, mean / max ms): ${[...byBound].sort((a, b) => a[0] - b[0]).map(([b, xs]) => `${b}: ${xs.length}, ${ms(stats(xs).mean)} / ${ms(stats(xs).max)}`).join('; ')}\n`,
  );
  // Four Bubbles fought for much of the Battle, holding about Stage 0's budget of bound Fighters, and the Pool never overflowed.
  expect(busy.n).toBeGreaterThan(100);
  expect(bound.mean).toBeLessThanOrEqual(BOUND_BUDGET);
  expect(bound.max).toBeLessThanOrEqual(tuning.battle.bubble.poolSize - LINEUP.length);
  expect(march.n).toBeGreaterThan(20);
  expect(busy.mean / march.mean).toBeLessThan(MELEE_OVER_MARCH);
}, 600_000);
