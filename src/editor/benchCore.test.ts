import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { benchCrowd, benchFighters, createCrowd, DEFAULT_CROWD, meleeMatch, stepCrowd } from './benchCore';

const tuning = loadTuningData();

describe('Big Battle bench (smoke: the measurements run, at tiny sizes)', () => {
  it('builds an n-Fighter melee past MAX_TEAM_SIZE without touching the Simulation', () => {
    const { match, ais } = meleeMatch(tuning, 12);
    expect(match.duel.fighters).toHaveLength(12);
    expect(match.config.teams.filter((t) => t === 0)).toHaveLength(6);
    expect(ais).toHaveLength(12);
  });

  it('times Ticks and 15-Tick Rollbacks, which re-simulate to the same hash', () => {
    const r = benchFighters(tuning, 8, 40, 10);
    expect(r.tick.samples).toBe(40);
    expect(r.rollback.samples).toBeGreaterThan(0);
    expect(r.deterministic).toBe(true);
  });

  it('steps every Soldier exactly once per stagger period', () => {
    const crowd = createCrowd({ ...DEFAULT_CROWD, perTeam: 30 });
    for (let t = 1; t <= DEFAULT_CROWD.stagger; t++) stepCrowd(crowd, t);
    const stepped = Array.from(crowd.timer).filter((t) => t > 0);
    expect(stepped).toHaveLength(60);
  });

  it('runs the Crowd prototype deterministically', () => {
    const r = benchCrowd({ ...DEFAULT_CROWD, perTeam: 40 }, 120, 30);
    expect(r.step.samples).toBe(120);
    expect(r.deterministic).toBe(true);
  });
});
