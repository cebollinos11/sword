import { expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createBattlePilot, poolControllers, type Controller } from '../controllers';
import { createMatch, hashValue, stepMatch, TICK_SECONDS, type Intent, type MatchState } from '.';

const tuning = loadTuningData();
/** Ten minutes of Battle time, at 60 Ticks a second. */
const SOAK_TICKS = Math.round(600 / TICK_SECONDS);
/** Every this many Ticks (and at each Battle's end) the replay's hash is compared. */
const HASH_EVERY = 30;
/**
 * A Tick's budget (ms): Stage 0's ~8 ms of Simulation per Tick, AI included (docs/plans/big-battle.md). The mean must stay
 * under it. On the Stage 0 laptop it is 1.8 ms alone, but the full parallel suite slows every Tick 2.5 times (4.4 to 4.6 ms;
 * CPU time rises with it, so it can't tell a busy machine from a slow Tick), so the bound is the budget, not the alone figure.
 */
const TICK_BUDGET_MS = 8;
/**
 * The 99th percentile's bound (ms): a frame and a half at 60 fps. Alone it is about 6 ms (the Ticks over 8 ms are mostly a
 * full Bubble's, 9 to 12 slots bound, the rest warm-up or a garbage collection); in the full suite 16 to 18 ms.
 */
const P99_MS = 25;
/** A 60 fps frame (ms): the Ticks over it are logged. */
const FRAME_MS = 1000 / 60;

/**
 * Full-size Battles (200 v 200) one after another, seeds 1, 2, ..., the Player on a Hard Battle autopilot and every other
 * Pool slot a Pool AI, for ten minutes of Battle time; then the same Intents replayed through `stepMatch` alone.
 *
 * Its timeout is long: ten minutes of Battle is 36,000 Ticks, at about 2 ms each with the AI (and 1 ms replayed) on the
 * Stage 0 laptop, so about two minutes alone (124 s) and three sharing the CPU with the suite (183 s); it cannot fit in the
 * suite's 20 s.
 */
it('plays ten minutes of Battles on autopilot with no hash divergence on replay and its Ticks within budget', () => {
  type Battle = { seed: number; intents: Intent[][]; hashes: Map<number, string>; final: string; ticks: number; takeovers: number; winner: number | null };
  const battles: Battle[] = [];
  const costs: number[] = [];
  const slow: { seed: number; tick: number; bound: number; ms: number }[] = [];
  let total = 0;
  for (let seed = 1; total < SOAK_TICKS; seed++) {
    const controllers: Controller[] = poolControllers(tuning, [createBattlePilot(tuning, 'Hard')]);
    let m: MatchState = createMatch(tuning, { format: 'Battle', bestOf: 1, seed, teams: [0] });
    const b: Battle = { seed, intents: [], hashes: new Map(), final: '', ticks: 0, takeovers: 0, winner: null };
    while (m.status.status === 'InProgress' && total < SOAK_TICKS) {
      const at = m;
      const t0 = performance.now();
      const intents = controllers.map((c, i) => c.intent(at.duel, i));
      m = stepMatch(at, intents, tuning);
      const ms = performance.now() - t0;
      costs.push(ms);
      if (ms > TICK_BUDGET_MS) slow.push({ seed, tick: m.tick, bound: m.duel.fighters.filter((f) => f.soldier).length, ms });
      b.intents.push(intents);
      total++;
      if (m.tick % HASH_EVERY === 0) b.hashes.set(m.tick, hashValue(m));
    }
    b.final = hashValue(m);
    b.ticks = m.tick;
    b.takeovers = m.duel.crowd!.players[0]!.taken;
    b.winner = m.status.status === 'Over' ? m.status.winner : null;
    battles.push(b);
  }

  for (const b of battles) {
    let m: MatchState = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: b.seed, teams: [0] });
    for (const intents of b.intents) {
      m = stepMatch(m, intents, tuning);
      const want = b.hashes.get(m.tick);
      if (want !== undefined) expect(hashValue(m), `seed ${b.seed}, Tick ${m.tick}`).toBe(want);
    }
    expect(hashValue(m), `seed ${b.seed}, the end`).toBe(b.final);
  }

  const sorted = [...costs].sort((a, b) => a - b);
  const mean = costs.reduce((s, v) => s + v, 0) / costs.length;
  const over = costs.filter((c) => c > TICK_BUDGET_MS).length;
  const overFrame = costs.filter((c) => c > FRAME_MS).length;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
  process.stderr.write(
    `\nBattle soak: ${costs.length} Ticks in ${battles.length} Battles (${battles.map((b) => `seed ${b.seed}: ${b.ticks} Ticks, ${b.winner === null ? 'unfinished' : `Team ${b.winner} won`}, ${b.takeovers} takeovers`).join('; ')}); ` +
      `Tick ${mean.toFixed(2)} ms mean, p99 ${p99.toFixed(2)} ms, max ${sorted[sorted.length - 1]!.toFixed(1)} ms, ${over} over ${TICK_BUDGET_MS} ms, ${overFrame} over a frame\n`,
  );
  process.stderr.write(`Slow Ticks (seed/tick/bound/ms): ${slow.map((s) => `${s.seed}/${s.tick}/${s.bound}/${s.ms.toFixed(1)}`).join(' ')}\n`);
  expect(costs.length).toBe(SOAK_TICKS);
  expect(mean).toBeLessThan(TICK_BUDGET_MS);
  expect(p99).toBeLessThan(P99_MS);
}, 600_000);
