import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { floorOf } from '../sim/delver';
import { arenaOf, createMatch, exitDoor, IDLE_INTENT, inDuel, MAX_TEAM_SIZE, secondsToTicks, stepMatch, type MatchState } from '../sim';
import { delverScore, hallBanner, hallFade, hallScore, hpText, runResultLine, runTime, statsText } from './hud';

describe('the Run’s HUD text', () => {
  it('names the Floor, the Hall’s row of five and the Run seed; the Boss Hall by its Floor', () => {
    expect(hallBanner({ floor: 2, row: 2 }, 3, 4242)).toBe('Floor 2 · Hall 3 / 5 · seed 4242');
    expect(hallBanner({ floor: 1, row: 0 }, 3, 7)).toBe('Floor 1 · Hall 1 / 5 · seed 7');
    expect(hallBanner({ floor: 2, row: 4 }, 3, 4242)).toBe('Boss · Floor 2 / 3');
    expect(hallScore({ floor: 2, row: 2 }, 3)).toBe('Floor 2 · Hall 3 / 5');
    expect(hallScore({ floor: 3, row: 4 }, 3)).toBe('Boss · Floor 3 / 3');
  });

  it('sums a Run up in one line: the verdict, Floors and Halls cleared, the time and the seed', () => {
    expect(runResultLine({ victory: false, cleared: 1, floors: 3, halls: 7, seconds: 312, seed: 4242 })).toBe('Defeat · 1 / 3 Floors · 7 Halls cleared · 5:12 · Run seed 4242');
    expect(runResultLine({ victory: true, cleared: 3, floors: 3, halls: 1, seconds: 5, seed: 1 })).toBe('Victory · 3 / 3 Floors · 1 Hall cleared · 0:05 · Run seed 1');
  });

  it('gives the Run time as m:ss', () => {
    expect(runTime(0)).toBe('0:00');
    expect(runTime(65.9)).toBe('1:05');
    expect(runTime(754)).toBe('12:34');
  });
});

describe('the fade between Halls', () => {
  const tuning = loadTuningData();
  const ARENA = 'gen:greybox:12';
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  /** A Run with two Players on Team 0. */
  const start = () => createMatch(tuning, { format: 'Gauntlet', arena: ARENA, bestOf: 1, humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const cleared = (m: MatchState) => stepMatch({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } }, idle(m), tuning);
  const inZone = (m: MatchState, i: number, exit: number): MatchState => {
    const zone = arenaOf(tuning, m.arena).doors[exitDoor(exit)]!.zone;
    const at = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: at, y: zone[0]!.y } : f)) } };
  };

  it('fades out over the fade once a Door is taken, and back in as the next Hall starts', () => {
    let m = cleared(start());
    expect(hallFade(m, tuning)).toBe(0);
    while (m.run!.phase === 'Cleared') m = stepMatch(inZone(inZone(m, 0, 0), 1, 0), idle(m), tuning);
    const fade = secondsToTicks(tuning.dungeon.hallFadeSeconds);
    expect(hallFade(m, tuning)).toBeCloseTo(1 / fade);
    let last = 0;
    while (m.duelNumber === 1) {
      const f = hallFade(m, tuning);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
      m = stepMatch(m, idle(m), tuning);
    }
    expect(last).toBe(1);
    // The next Hall's first Tick is still dark, then it fades back in.
    expect(hallFade(m, tuning)).toBe(1);
    for (let k = 0; k < fade; k++) m = stepMatch(m, idle(m), tuning);
    expect(hallFade(m, tuning)).toBe(0);
    // A Run's first Hall and Duels never fade.
    expect(hallFade(start(), tuning)).toBe(0);
    // ...nor does a dev start deeper in (its first Hall is not Hall 1).
    const deeper = createMatch(tuning, { format: 'Gauntlet', arena: ARENA, bestOf: 1, humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)], start: { floor: 1, row: 2 } });
    expect(deeper.duelNumber).toBeGreaterThan(1);
    expect(hallFade(deeper, tuning)).toBe(0);
    expect(hallFade(stepMatch(deeper, idle(deeper), tuning), tuning)).toBe(0);
    expect(hallFade(createMatch(tuning, { arena: 'library', bestOf: 3 }), tuning)).toBe(0);
  });
});

describe('the Run’s results line without Halls', () => {
  it('leaves the Halls part out when the Run has none (a Delver Run)', () => {
    expect(runResultLine({ victory: true, cleared: 3, floors: 3, seconds: 125, seed: 9 })).toBe('Victory · 3 / 3 Floors · 2:05 · Run seed 9');
    expect(runResultLine({ victory: false, cleared: 1, floors: 3, halls: 0, seconds: 5, seed: 1 })).toBe('Defeat · 1 / 3 Floors · 0 Halls cleared · 0:05 · Run seed 1');
  });
});

describe('the fade between a Delver Run’s Floors', () => {
  const base = loadTuningData();
  const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  const start = () => createMatch(tuning, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, delver: true, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  /** The only Player stands in the Stairs zone's centre. */
  const onStairs = (m: MatchState): MatchState => {
    const { zone } = floorOf(tuning, m.arena)!.plan.markers.stairs;
    const position = { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
    return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position, y: 0 } : f)) } };
  };

  it('is 0 on Floor 1, rises over the fade to 1 on its last Tick, and falls over the next Floor’s start', () => {
    let m = start();
    expect(hallFade(m, tuning)).toBe(0);
    expect(hallFade(stepMatch(m, idle(m), tuning), tuning)).toBe(0);
    while (m.delver!.phase === 'Exploring') m = stepMatch(onStairs(m), idle(m), tuning);
    const fade = secondsToTicks(tuning.dungeon.hallFadeSeconds);
    expect(hallFade(m, tuning)).toBeCloseTo(1 / fade);
    let last = 0;
    while (m.duelNumber === 1) {
      const f = hallFade(m, tuning);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
      m = stepMatch(m, idle(m), tuning);
    }
    expect(last).toBe(1);
    expect(m.delver!.floor).toBe(2);
    expect(hallFade(m, tuning)).toBe(1);
    let prior = 1;
    for (let k = 0; k < fade; k++) {
      m = stepMatch(m, idle(m), tuning);
      const f = hallFade(m, tuning);
      expect(f).toBeLessThanOrEqual(prior);
      prior = f;
    }
    expect(hallFade(m, tuning)).toBe(0);
  });
});

describe('the HP shown on a bar', () => {
  it('rounds up a part HP, so a Fighter alive never shows 0', () => {
    expect(hpText(42.3)).toBe('43');
    expect(hpText(0.2)).toBe('1');
    expect(hpText(0)).toBe('0');
    expect(hpText(-5)).toBe('0');
  });

  it('a depth-scaled max HP shows as itself, not one over (100 × 1.1 is 110.00000000000001)', () => {
    const tuning = loadTuningData();
    const hp = tuning.fighter.maxHp * (1 + tuning.dungeon.depthHp * 1);
    expect(hp).not.toBe(110);
    expect(hpText(hp)).toBe('110');
  });
});

describe('the fps and ping counter', () => {
  it('shows the fps alone offline, and online the ping split into network and CPU', () => {
    expect(statsText(60, null)).toBe('60 fps');
    expect(statsText(58, { total: 84.4, network: 30.2, cpu: 54.2 })).toBe('58 fps · 84 ms (net 30 · cpu 54)');
  });
});

describe('a Delver Run’s results line', () => {
  it('adds "Bosses b / B" after the Floors, and none for a Hall-graph Run or a Tuning without a Boss', () => {
    expect(runResultLine({ victory: true, cleared: 9, floors: 9, bosses: 3, bossTotal: 3, seconds: 125, seed: 9 })).toBe('Victory · 9 / 9 Floors · Bosses 3 / 3 · 2:05 · Run seed 9');
    expect(runResultLine({ victory: false, cleared: 4, floors: 9, bosses: 1, bossTotal: 3, seconds: 5, seed: 1 })).toBe('Defeat · 4 / 9 Floors · Bosses 1 / 3 · 0:05 · Run seed 1');
    expect(runResultLine({ victory: false, cleared: 1, floors: 3, halls: 7, seconds: 312, seed: 4242 })).toBe('Defeat · 1 / 3 Floors · 7 Halls cleared · 5:12 · Run seed 4242');
    expect(runResultLine({ victory: true, cleared: 3, floors: 3, seconds: 125, seed: 9 })).toBe('Victory · 3 / 3 Floors · 2:05 · Run seed 9');
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
  it('says the Floor reached and the Warbands and Bosses beaten', () => {
    expect(runResultLine({ victory: false, cleared: 3, floors: 9, reached: 4, warbands: 12, bosses: 1, bossTotal: 3, seconds: 125, seed: 9 })).toBe('Defeat · Floor 4 / 9 · Warbands 12 · Bosses 1 / 3 · 2:05 · Run seed 9');
    expect(runResultLine({ victory: true, cleared: 9, floors: 9, reached: 9, warbands: 40, seconds: 5, seed: 1 })).toBe('Victory · Floor 9 / 9 · Warbands 40 · 0:05 · Run seed 1');
  });
});
