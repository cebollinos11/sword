import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { floorOf } from '../sim/delver';
import { createMatch, IDLE_INTENT, MAX_TEAM_SIZE, secondsToTicks, stepMatch, type MatchState } from '../sim';
import { delverScore, floorFade, hpText, runResultLine, runTime, statsText } from './hud';
import { flatFloors } from '../sim/delver/flat.testdata';

describe('the Run’s HUD text', () => {
  it('gives the Run time as m:ss', () => {
    expect(runTime(0)).toBe('0:00');
    expect(runTime(65.9)).toBe('1:05');
    expect(runTime(754)).toBe('12:34');
  });
});

describe('the fade between a Delver Run’s Floors', () => {
  const base = flatFloors(loadTuningData());
  const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  const start = () => createMatch(tuning, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  /** The only Player stands in the Stairs zone's centre. */
  const onStairs = (m: MatchState): MatchState => {
    const { zone } = floorOf(tuning, m.arena)!.plan.markers.stairs;
    const position = { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
    return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position, y: 0 } : f)) } };
  };

  it('is 0 on Floor 1, rises over the fade to 1 on its last Tick, and falls over the next Floor’s start', () => {
    let m = start();
    expect(floorFade(m, tuning)).toBe(0);
    expect(floorFade(stepMatch(m, idle(m), tuning), tuning)).toBe(0);
    while (m.delver!.phase === 'Exploring') m = stepMatch(onStairs(m), idle(m), tuning);
    const fade = secondsToTicks(tuning.dungeon.fadeSeconds);
    expect(floorFade(m, tuning)).toBeCloseTo(1 / fade);
    let last = 0;
    while (m.duelNumber === 1) {
      const f = floorFade(m, tuning);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
      m = stepMatch(m, idle(m), tuning);
    }
    expect(last).toBe(1);
    expect(m.delver!.floor).toBe(2);
    expect(floorFade(m, tuning)).toBe(1);
    let prior = 1;
    for (let k = 0; k < fade; k++) {
      m = stepMatch(m, idle(m), tuning);
      const f = floorFade(m, tuning);
      expect(f).toBeLessThanOrEqual(prior);
      prior = f;
    }
    expect(floorFade(m, tuning)).toBe(0);
  });
});

describe('the HP shown on a bar', () => {
  it('rounds up a part HP, so a Fighter alive never shows 0', () => {
    expect(hpText(42.3)).toBe('43');
    expect(hpText(0.2)).toBe('1');
    expect(hpText(0)).toBe('0');
    expect(hpText(-5)).toBe('0');
  });

  it('a scaled max HP shows as itself, not one over (100 × 1.1 is 110.00000000000001)', () => {
    const tuning = loadTuningData();
    const hp = tuning.fighter.maxHp * 1.1;
    expect(hp).not.toBe(110);
    expect(hpText(hp)).toBe('110');
  });
});

describe('the fps and ping counter', () => {
  it('shows the fps alone offline, and online the ping split into network and CPU, and the Input Delay', () => {
    expect(statsText(60, null)).toBe('60 fps');
    expect(statsText(58, { total: 84.4, network: 30.2, cpu: 54.2, inputDelay: 2 })).toBe('58 fps · 84 ms (net 30 · cpu 54) · delay 2');
  });
});

describe('a Delver Run’s HUD line', () => {
  const base = loadTuningData().delver;
  const three = { ...base, tiers: 3, floorsPerTier: 3 };

  it('names the Floor within its tier, the tier and the Run’s count', () => {
    expect(delverScore(three, 1, 9)).toBe('Floor 1 of tier 1 (1 / 9)');
    expect(delverScore(three, 2, 9)).toBe('Floor 2 of tier 1 (2 / 9)');
    expect(delverScore(three, 4, 9)).toBe('Floor 1 of tier 2 (4 / 9)');
    expect(delverScore(three, 8, 9)).toBe('Floor 2 of tier 3 (8 / 9)');
  });

  it('adds "Boss Floor" on the last Floor of a tier that has a Boss, and only there', () => {
    for (const floor of [3, 6, 9]) expect(delverScore(three, floor, 9)).toBe(`Floor 3 of tier ${floor / 3} (${floor} / 9) · Boss Floor`);
    const noBoss = { ...three, warbands: three.warbands.map(({ boss: _b, ...tier }) => tier) };
    expect(delverScore(noBoss, 3, 9)).toBe('Floor 3 of tier 1 (3 / 9)');
  });

  it('follows floorsPerTier', () => {
    const two = { ...base, tiers: 2, floorsPerTier: 2 };
    expect(delverScore(two, 3, 4)).toBe('Floor 1 of tier 2 (3 / 4)');
    expect(delverScore(two, 4, 4)).toBe('Floor 2 of tier 2 (4 / 4) · Boss Floor');
  });
});

describe('a Delver Run’s results line', () => {
  it('says the Floor reached and the Warbands and Bosses beaten (no Bosses part for a Tuning without a Boss)', () => {
    expect(runResultLine({ victory: false, floors: 9, reached: 4, warbands: 12, bosses: 1, bossTotal: 3, seconds: 125, seed: 9 })).toBe('Defeat · Floor 4 / 9 · Warbands 12 · Bosses 1 / 3 · 2:05 · Run seed 9');
    expect(runResultLine({ victory: true, floors: 9, reached: 9, warbands: 40, seconds: 5, seed: 1 })).toBe('Victory · Floor 9 / 9 · Warbands 40 · 0:05 · Run seed 1');
  });
});
