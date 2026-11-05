/**
 * docs/plans/battle-objectives.md, Stage 3a (Open question 3): the budget gate on the Fort. The same soak as `battleRollback.test.ts`
 * (four Players on a Hard Battle autopilot, two a Team, a Pool AI on every other slot, stepped as a Rollback session steps it, a
 * ROLLBACK_WINDOW-Tick Rollback timed every ROLLBACK_EVERY Ticks and checked to land on the same hash), on the Fort at its standard army
 * size (`FORT_ARMY` in the environment to try another; `FORT_MAP=ziggurat` for Stage 5's temple, `bridge` or `platform` for Stage 4a's test maps of several levels,
 * `levelMaps.testdata.ts`). On the Fort the Pool AIs path over its navmesh, and the Crowd is pushed out of
 * its walls, so both the Crowd step and the bound Fighters' share are measured here. The figures it logs are the measurement (the
 * Stage's Result); the times asserted are relative, as in `battleRollback.test.ts`, so a loaded machine does not fail it.
 */
import { expect, it } from 'vitest';
import { applyBattleKnobs, loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { battleMapOf, createMatch, hashValue, inDuel, restore, snapshot, stepCrowd, stepMatch, stepSquads, type Intent, type MatchState, type Snapshot } from '../sim';
import { withLevelMaps } from '../sim/levelMaps.testdata';
import { ROLLBACK_WINDOW } from './session';

const MAP = process.env.FORT_MAP ?? 'fort';
const loaded = loadTuningData();
const base = Object.hasOwn(loaded.battle.maps, MAP) ? loaded : withLevelMaps(loaded, MAP as 'platform' | 'bridge');
const army = Number(process.env.FORT_ARMY ?? base.battle.maps[MAP]!.armySize.standard);
const tuning: TuningData = { ...base, battle: applyBattleKnobs(base.battle, { map: MAP, armySize: army }) };
const ROLLBACK_EVERY = 10;
const FROM_TICK = 300;
/** As in `battleRollback.test.ts`: 2.5 minutes hold the march, the melee, captures and Squads respawning. */
const MAX_TICKS = 9000;
const LINEUP: Lineup = [0, 1, 0, 1].map((team, player) => ({ team, pilot: { kind: 'Player', player: player as 0 | 1 | 2 | 3 } }));

interface Timed {
  readonly ms: number;
  readonly bound: number;
  readonly bubbles: number;
}

function soak(seed: number) {
  const options = { format: 'Battle', bestOf: 1, seed, arena: `battle:${MAP}` } as const;
  const pilots: Controller[] = LINEUP.map(() => createBattlePilot(tuning, 'Hard'));
  const pool = lineupAis(tuning, LINEUP, 'Battle', options);
  let m = createMatch(tuning, lineupMatch(tuning, LINEUP, LINEUP.map(() => 'Longsword'), options));
  const states = new Map<number, Snapshot<MatchState>>([[0, snapshot(m)]]);
  const memories = new Map<number, unknown[]>([[0, pool.map((ai) => ai?.save?.() ?? null)]]);
  const sent = new Map<number, Intent[]>();
  const tickMs: number[] = [];
  const crowdMs: number[] = [];
  const squadMs: number[] = [];
  const rollbacks: Timed[] = [];
  const map = battleMapOf(tuning.battle, m.arena);
  const simulate = (at: MatchState): MatchState => {
    const t = at.tick + 1;
    const players = sent.get(t)!;
    const next = stepMatch(at, pool.map((ai, k) => (ai ? ai.intent(at.duel, k) : players[k]!)), tuning);
    states.set(t, snapshot(next));
    memories.set(t, pool.map((ai) => ai?.save?.() ?? null));
    return next;
  };
  while (m.status.status === 'InProgress' && m.tick < MAX_TICKS) {
    const at = m;
    sent.set(at.tick + 1, pilots.map((p, k) => JSON.parse(JSON.stringify(p.intent(at.duel, k))) as Intent));
    const t0 = performance.now();
    m = simulate(at);
    tickMs.push(performance.now() - t0);
    const c0 = performance.now();
    stepCrowd(at.duel.crowd!, m.tick, tuning.battle, [], map);
    const c1 = performance.now();
    stepSquads(at.duel.crowd!, m.tick, tuning.battle, map);
    crowdMs.push(c1 - c0);
    squadMs.push(performance.now() - c1);
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
    rollbacks.push({ ms: performance.now() - t1, bound: m.duel.fighters.filter((f) => f.soldier && inDuel(f)).length, bubbles });
    expect(hashValue(r), `seed ${seed}, a Rollback to Tick ${target}`).toBe(want);
    m = r;
  }
  return { ticks: m.tick, tickMs, rollbacks, crowdMs, squadMs };
}

const stats = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p99: s[Math.floor(s.length * 0.99)] ?? 0, max: s.at(-1) ?? 0, n: xs.length };
};
const ms = (x: number) => x.toFixed(1);
const ms2 = (x: number) => x.toFixed(2);

it(`times a ${ROLLBACK_WINDOW}-Tick Rollback through a four-Player Battle on the Fort, re-simulating to the same hash every time`, () => {
  const run = soak(1);
  const march = stats(run.rollbacks.filter((r) => r.bound === 0).map((r) => r.ms));
  const melee = stats(run.rollbacks.filter((r) => r.bubbles === 4 && r.bound > 0).map((r) => r.ms));
  const bound = stats(run.rollbacks.filter((r) => r.bubbles === 4 && r.bound > 0).map((r) => r.bound));
  const tick = stats(run.tickMs);
  const crowd = stats(run.crowdMs);
  const squads = stats(run.squadMs);
  process.stderr.write(
    `\n${MAP} Rollback soak, ${army} v ${army} (four Players): ${run.ticks} Ticks; Tick (+ snapshot, AI save) ${ms(tick.mean)} ms mean, p99 ${ms(tick.p99)}; ` +
      `Crowd step ${ms2(crowd.mean)} ms mean, p99 ${ms2(crowd.p99)} (Squad step ${ms2(squads.mean)}); ` +
      `${ROLLBACK_WINDOW}-Tick Rollback on the march ${ms(march.mean)} ms mean, p99 ${ms(march.p99)} (${march.n}); in the four-Bubble melee ${ms(melee.mean)} mean, p99 ${ms(melee.p99)} (${melee.n}), ${ms(bound.mean)} bound on average\n`,
  );
  expect(march.n).toBeGreaterThan(20);
  expect(squads.mean).toBeLessThan(crowd.mean);
  expect(crowd.mean).toBeLessThan(tick.mean);
}, 900_000);
