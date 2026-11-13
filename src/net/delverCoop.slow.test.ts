/**
 * A Delver Run online, its slow tier (`npm run test:slow`): two peers through the co-op harness, both Players' Fighters on the Delver pilot, go down
 * Floor 1 to its Stairs and into Floor 2 (a Tuning of one Tier of two Floors) with no desync, against Warbands (docs/plans/delver.md, Stage 3).
 * It measures each peer's Rollbacks as the game feels them and prints them, beside the same Run on an empty Floor (`postFill 0, patrolFill 0`, Stage
 * 2's): a Rollback is a frame whose `session.tick` re-simulated Ticks, and what it costs is that frame's wall time less a plain frame's (the median
 * one that only advanced). The rule for the Input Delay a Run takes online (Stage 3's Design) reads its p99.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuningData } from '../tuning';
import { CHECKSUM_INTERVAL } from './session';
import { startRun } from './coopHarness';

afterEach(() => vi.restoreAllMocks());

const TWO_FLOORS = (t: TuningData): TuningData => ({ ...t, delver: { ...t.delver, tiers: 1, floorsPerTier: 2 } });
/**
 * The Warbands case's Floors: a quarter of the posts filled (`postFill` 25, `patrolFill` as bundled). Two pilots with no AI allies against Warbands sized
 * for two humans lose by attrition on the full Floor (the Warband soak); that is balance, a playtest question, not the netcode this test checks.
 */
const QUARTER_POSTS = (t: TuningData): TuningData => {
  const two = TWO_FLOORS(t);
  return { ...two, delver: { ...two.delver, postFill: 25 } };
};
const EMPTY_FLOORS = (t: TuningData): TuningData => {
  const two = TWO_FLOORS(t);
  return { ...two, delver: { ...two.delver, postFill: 0, patrolFill: 0 } };
};

const percentile = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const f = (x: number, d = 2) => x.toFixed(d);

/** Two peers play until Floor 2 has run for 120 Ticks (or the Run ends, or `cap` Ticks), timed; returns what happened and the Rollbacks' figures. */
function play(tune: (t: TuningData) => TuningData, cap = 20_000) {
  const r = startRun({ players: 2, delver: { tune }, timed: true });
  let started: number | null = null;
  const isOver = () => r.host.session.state?.status.status === 'Over';
  r.until(
    () => (started !== null && r.confirmed() >= started + 120) || isOver(),
    () => {
      const s = r.host.session.state;
      if (started === null && s?.delver && s.delver.floor >= 2) started = s.tick;
    },
    cap,
  );
  const frames = r.peers.flatMap((p) => p.frames);
  const plain = frames.filter((x) => x.rollbacks === 0 && x.advanced).map((x) => x.ms).sort((a, b) => a - b);
  const base = percentile(plain, 0.5);
  const back = frames.filter((x) => x.rollbacks > 0);
  const ticks = back.map((x) => x.steps - (x.advanced ? 1 : 0)).sort((a, b) => a - b);
  const cost = back.map((x) => Math.max(0, x.ms - base)).sort((a, b) => a - b);
  const figures = {
    frames: frames.length,
    rollbackFrames: back.length,
    share: back.length / Math.max(1, frames.length),
    plainMs: base,
    ticks: { p50: percentile(ticks, 0.5), p99: percentile(ticks, 0.99), max: ticks.at(-1) ?? 0 },
    ms: { p50: percentile(cost, 0.5), p99: percentile(cost, 0.99), max: cost.at(-1) ?? 0 },
  };
  return { r, started, figures };
}

const describeRun = (label: string, run: ReturnType<typeof play>) => {
  const { r, started, figures: g } = run;
  const state = r.host.session.state!;
  return (
    `${label}: Floor 2 at Tick ${started}, ${r.host.session.currentTick} Ticks, ${state.duel.crowd?.x.length ?? 0} Soldiers on the Floor now, resyncs ${r.peers.map((p) => p.session.stats.resyncs).join('/')}; ` +
    `${g.frames} frames (both peers), plain frame ${f(g.plainMs)} ms (median), Rollbacks in ${g.rollbackFrames} (${f(g.share * 100, 1)}% of frames); ` +
    `party ${state.duel.fighters.slice(0, state.config.teams.length).map((x) => `hp ${f(x.hp, 0)} at (${f(x.position.x, 0)}, ${f(x.position.z, 0)})`).join(', ')}, ${state.duel.fighters.filter((x, i) => i >= state.config.teams.length && x.soldier).length} promoted now, ${state.duel.crowd?.alive.filter((a) => a === 1).length ?? 0} Soldiers alive, phase ${state.delver?.phase}; ` +
    `Ticks re-simulated p50 ${g.ticks.p50}, p99 ${g.ticks.p99}, max ${g.ticks.max}; ms per Rollback p50 ${f(g.ms.p50)}, p99 ${f(g.ms.p99)}, max ${f(g.ms.max)}`
  );
};

/** Both peers reached Floor 2 (or the Victory) and agree on every checksum, with no desync and no resync. */
function expectInStep(run: ReturnType<typeof play>): void {
  const { r, started } = run;
  expect(started !== null || r.host.session.state?.status.status === 'Over', 'reached Floor 2 or Victory').toBe(true);
  for (const p of r.peers) {
    expect(p.session.status).toBe('Running');
    expect(p.events.filter((e) => e.type === 'Desync')).toEqual([]);
    expect(p.session.stats.resyncs).toBe(0);
  }
  let compared = 0;
  for (const [tick, sum] of r.host.sums) {
    const other = r.guests[0]!.sums.get(tick);
    if (other === undefined) continue;
    expect(other, `@${tick}`).toBe(sum);
    compared++;
  }
  expect(compared).toBeGreaterThan(r.host.session.currentTick / CHECKSUM_INTERVAL / 2);
}

describe('a Delver Run over the memory transport, slow', () => {
  it('two Delver pilots go down Floor 1 to Floor 2 (or Victory) through Warbands with no desync, and the Rollbacks are measured', () => {
    const warbands = play(QUARTER_POSTS);
    const empty = play(EMPTY_FLOORS);
    // eslint-disable-next-line no-console
    console.log(`\n${describeRun('Delver Run with Warbands, 2 peers', warbands)}\n${describeRun('Delver Run on empty Floors, 2 peers', empty)}\n`);
    expect(warbands.r.host.session.state!.duel.crowd?.warbands?.mode.length ?? 0, 'Floor 2 holds Warbands').toBeGreaterThan(0);
    expect(empty.r.host.session.state!.duel.crowd?.x.length, 'the empty Floors hold no Soldier').toBe(0);
    expectInStep(warbands);
    expectInStep(empty);
  }, 1_800_000);
});
