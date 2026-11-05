/**
 * docs/plans/battle-objectives.md, Stage 0: the Squad bench. A smoke test at tiny sizes, and the full 200 v 200 run whose
 * figures go in that plan's Stage 0 Result (it logs them; the asserts are loose, because the full parallel suite slows every
 * Tick about 3 times).
 */
import { describe, expect, it } from 'vitest';
import { benchCrowd, DEFAULT_CROWD } from './benchCore';
import { benchSquads, createSquadCrowd, DEFAULT_SQUADS, insideWalls, stepSquadCrowd, type SquadBench } from './benchSquads';

const ms = (x: number) => x.toFixed(2);
const row = (label: string, s: { mean: number; p99: number; max: number; samples: number }) => `${label} ${ms(s.mean)} mean, ${ms(s.p99)} p99, ${ms(s.max)} max (${s.samples})`;

function report(title: string, r: SquadBench): string {
  return (
    `\n${title}: ${r.soldiers} Soldiers in ${r.squads} Squads, ${r.fields} cached destination fields built in ${ms(r.buildMs)} ms; ended ${r.alive.join(' v ')}, Walls: at most ${r.insideWalls} inside; Squad-Ticks column/line/loose ${r.formations.join('/')}\n` +
    `  ${row('Tick', r.step)}; brains ${ms(r.brains.mean)}, anchors ${ms(r.anchors.mean)}, Soldiers ${ms(r.soldiersStep.mean)} mean\n` +
    `  ${row('online Tick (+ snapshot)', r.onlineTick)}\n` +
    `  march: ${row('Tick', r.stepMarch)}; ${row('15-Tick Rollback', r.rollbackMarch)}\n` +
    `  melee: ${row('Tick', r.stepMelee)}; ${row('15-Tick Rollback', r.rollbackMelee)}\n`
  );
}

describe('Squad bench', () => {
  it('deploys whole Squads, the remainder folded into the last ones', () => {
    const crowd = createSquadCrowd({ ...DEFAULT_SQUADS, perTeam: 200 });
    expect(crowd.squadCount).toBe(32);
    const first = Array.from(crowd.sizes.slice(0, 16));
    expect(first.reduce((a, b) => a + b, 0)).toBe(200);
    expect(Math.min(...first)).toBe(12);
    expect(Math.max(...first)).toBe(13);
    expect(first.slice(0, 8).every((n) => n === 12)).toBe(true);
    expect(insideWalls(crowd)).toBe(0);
  });

  it('steps every Squad brain once per brain period and keeps Soldiers out of the Walls', () => {
    const crowd = createSquadCrowd({ ...DEFAULT_SQUADS, perTeam: 48 });
    for (let t = 1; t <= 300; t++) stepSquadCrowd(crowd, t);
    expect(insideWalls(crowd)).toBe(0);
    expect(Array.from(crowd.living).every((n) => n > 0)).toBe(true);
  });

  it('re-simulates a Rollback to the same state', () => {
    const r = benchSquads({ ...DEFAULT_SQUADS, perTeam: 48 }, 200, 10);
    expect(r.deterministic).toBe(true);
    expect(r.step.samples).toBe(200);
  });

  it('times the full 200 v 200 Battle with Squads, on the march and in the melee', () => {
    const r = benchSquads({ ...DEFAULT_SQUADS, perTeam: 200 }, 3600, 10);
    process.stderr.write(report('Squad Crowd bench (200 v 200)', r));
    // The same Crowd with no Squads (benchCore's prototype: a flow field rebuilt from positions), in the same process.
    const plain = benchCrowd({ ...DEFAULT_CROWD, perTeam: 200 }, 3600);
    process.stderr.write(`  no Squads, same run: Tick ${ms(plain.step.mean)} mean, ${ms(plain.step.p99)} p99, ${ms(plain.step.max)} max\n`);
    expect(r.deterministic).toBe(true);
    expect(r.insideWalls).toBe(0);
    expect(r.rollbackMarch.samples).toBeGreaterThan(5);
    expect(r.rollbackMelee.samples).toBeGreaterThan(5);
    expect(r.stepMelee.mean).toBeLessThan(5);
  }, 120_000);

  it('times a 300 v 300 and a 100 v 100 Battle for the scaling', () => {
    for (const perTeam of [100, 300]) {
      const r = benchSquads({ ...DEFAULT_SQUADS, perTeam }, 2400, 10);
      process.stderr.write(report(`Squad Crowd bench (${perTeam} v ${perTeam})`, r));
      expect(r.deterministic).toBe(true);
    }
  }, 120_000);
});
