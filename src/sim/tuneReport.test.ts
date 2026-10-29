import { describe, expect, it } from 'vitest';
import { aggregate, formatAggregate, groupHalls, median, percentile, type HallRecord, type RunRecord } from './tuneReport';

const hall = (o: Partial<HallRecord> & Pick<HallRecord, 'floor' | 'row' | 'kind'>): HallRecord => ({
  index: 0,
  encounter: o.kind === 'Fight' || o.kind === 'Elite' ? 0 : o.kind === 'Boss' ? 0 : null,
  enemies: o.kind === 'Rest' || o.kind === 'Treasure' ? 0 : 2,
  enemyMaxHp: 100,
  outcome: 'cleared',
  fightTicks: 600,
  contactTicks: 120,
  walkTicks: 300,
  walkHang: false,
  hpIn: 1,
  hpOut: 0.8,
  hpLeave: 0.8,
  deaths: 0,
  revives: 0,
  restHeal: 0,
  ...o,
});

const run = (o: Partial<RunRecord> & Pick<RunRecord, 'seed' | 'halls'>): RunRecord => ({
  players: 1,
  allies: 0,
  difficulty: 'Expert',
  result: 'lost',
  endHall: null,
  hallsCleared: o.halls.filter((h) => h.outcome === 'cleared').length,
  ticks: 6000,
  seconds: 100,
  route: o.halls.map((h) => `${h.floor}.${h.row}.${h.index} ${h.kind}`),
  loot: {},
  builds: [],
  wallMs: 1000,
  ...o,
});

describe('median and percentile', () => {
  it('takes the middle, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
  it('interpolates percentiles', () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4);
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe('groupHalls', () => {
  it('counts cleared, deaths and revives, and takes medians of what exists', () => {
    const g = groupHalls([
      hall({ floor: 1, row: 1, kind: 'Fight', hpIn: 1, hpLeave: 0.6, fightTicks: 1200, deaths: 1 }),
      hall({ floor: 1, row: 1, kind: 'Fight', hpIn: 0.5, hpLeave: 0.2, fightTicks: 600, revives: 2 }),
      hall({ floor: 1, row: 1, kind: 'Fight', outcome: 'wiped', hpIn: 0.3, hpOut: 0, hpLeave: null, walkTicks: null, fightTicks: 900, deaths: 3 }),
    ]);
    expect(g.fought).toBe(3);
    expect(g.cleared).toBe(2);
    expect(g.winRate).toBeCloseTo(2 / 3);
    expect(g.medianHpIn).toBe(0.5);
    expect(g.medianHpLeave).toBeCloseTo(0.4);
    expect(g.medianFightSeconds).toBe(15);
    expect(g.medianWalkSeconds).toBe(5);
    expect(g.deaths).toBe(4);
    expect(g.revives).toBe(2);
  });
  it('leaves enemy HP out of Halls with no enemies', () => {
    const g = groupHalls([hall({ floor: 1, row: 3, kind: 'Rest', enemyMaxHp: 0 }), hall({ floor: 1, row: 3, kind: 'Rest', enemyMaxHp: 0, restHeal: 0.5 })]);
    expect(g.medianEnemyMaxHp).toBeNaN();
    expect(g.meanRestHeal).toBe(0.25);
  });
});

describe('aggregate', () => {
  const won = run({
    seed: 1,
    result: 'won',
    ticks: 3 * 3600,
    halls: [
      hall({ floor: 1, row: 0, kind: 'Fight', hpLeave: 0.9 }),
      hall({ floor: 1, row: 4, kind: 'Boss', hpOut: 0.5, hpLeave: 0.5 }),
      hall({ floor: 2, row: 0, kind: 'Fight', hpLeave: 0.7 }),
      hall({ floor: 2, row: 4, kind: 'Boss', hpOut: 0.3, hpLeave: null, walkTicks: null }),
    ],
    loot: { 'relic:Whetstone': { offered: 2, taken: 1, equipped: 1, dropped: 0 } },
  });
  const lostF1 = run({
    seed: 2,
    ticks: 1 * 3600,
    endHall: '1.4.0 Boss',
    halls: [hall({ floor: 1, row: 0, kind: 'Fight', hpLeave: 0.7 }), hall({ floor: 1, row: 4, kind: 'Boss', outcome: 'wiped', hpOut: 0, hpLeave: null, walkTicks: null, deaths: 1 })],
    loot: { 'relic:Whetstone': { offered: 1, taken: 1, equipped: 0, dropped: 1 }, 'weapon:Halberd': { offered: 1, taken: 0, equipped: 0, dropped: 0 } },
  });
  const hung = run({ seed: 3, result: 'hang', ticks: 2 * 3600, halls: [hall({ floor: 1, row: 0, kind: 'Fight', outcome: 'hang', hpLeave: null, walkTicks: null })] });
  const a = aggregate([won, lostF1, hung]);

  it('counts Runs by result and takes the Run time spread in seconds', () => {
    expect(a.runs).toBe(3);
    expect([a.won, a.lost, a.hung, a.stopped]).toEqual([1, 1, 1, 0]);
    expect(a.winRate).toBeCloseTo(1 / 3);
    expect(a.runSeconds.median).toBe(120);
    expect(a.runSeconds.min).toBe(60);
    expect(a.runSeconds.max).toBe(180);
    expect(a.runSeconds.p90).toBeCloseTo(168);
    expect(a.wonSeconds.median).toBe(180);
    expect(a.hangs.fights).toBe(1);
  });

  it('gives each Floor its win rate (Boss cleared of Runs that entered) and HP carried', () => {
    expect(a.floors.map((f) => [f.entered, f.bossCleared, f.endedHere])).toEqual([
      [3, 1, 2],
      [1, 1, 0],
    ]);
    expect(a.floors[0]!.winRate).toBeCloseTo(1 / 3);
    expect(a.floors[1]!.winRate).toBe(1);
    expect(a.floors[0]!.medianHpAtBossClear).toBe(0.5);
    // Floor 1's Doors taken: 0.9, 0.5 (won), 0.7 (lost run).
    expect(a.floors[0]!.medianHpLeave).toBe(0.7);
  });

  it('groups Halls by kind, row, Floor and row, and each Boss', () => {
    expect(a.byKind.Fight!.fought).toBe(4);
    expect(a.byKind.Fight!.cleared).toBe(3);
    expect(a.byKind.Boss!.winRate).toBeCloseTo(2 / 3);
    expect(Object.keys(a.byRow)).toEqual(['0', '4']);
    expect(a.byRow['4']!.fought).toBe(3);
    expect(a.byFloorRow['1.4']!.cleared).toBe(1);
    expect(a.byFloorKind['1 Boss']!.winRate).toBe(0.5);
    expect(a.byFloorKind['2 Boss']!.winRate).toBe(1);
  });

  it('sums the loot over Runs and rates it by what was offered', () => {
    const whetstone = a.items.find((i) => i.key === 'relic:Whetstone')!;
    expect([whetstone.offered, whetstone.taken, whetstone.equipped, whetstone.dropped]).toEqual([3, 2, 1, 1]);
    expect(whetstone.takenRate).toBeCloseTo(2 / 3);
    expect(whetstone.equippedRate).toBeCloseTo(1 / 3);
    expect(a.items.find((i) => i.key === 'weapon:Halberd')!.takenRate).toBe(0);
  });

  it('formats a table with the headline and the loot', () => {
    const text = formatAggregate(a).join('\n');
    expect(text).toContain('won 1 (33%)');
    expect(text).toContain('| relic:Whetstone | 3 | 2 | 67% | 1 | 33% | 1 |');
    expect(text).toContain('| 1 Boss |');
  });

  it('copes with no Runs', () => {
    const none = aggregate([]);
    expect(none.runs).toBe(0);
    expect(none.winRate).toBeNaN();
    expect(none.floors).toEqual([]);
    expect(() => formatAggregate(none)).not.toThrow();
  });
});
