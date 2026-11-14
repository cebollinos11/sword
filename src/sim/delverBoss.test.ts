import { describe, expect, it } from 'vitest';
import { secondsToTicks } from './constants';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import { isBossFloor } from './delver/troops';
import { bossesBeaten, gateOpen } from './delverRun';
import { hashValue } from './hash';
import { restore, snapshot } from './snapshot';
import { runSeed } from './dungeon';
import { treasurePickups } from './delverLoot';
import { createMatch, doorTicksNeeded, MAX_TEAM_SIZE, stepMatch, type MatchOptions, type MatchState } from './match';
import { IDLE_INTENT } from './intent';
import { BOSS } from './warband';
import type { FighterState } from './state';
import { flatFloors } from './delver/flat.testdata';

const base = flatFloors(loadTuningData());
/** Two tiers of one Floor each, each with its Boss (the Tuning Data's own), and the Boss Warband alone on its Floor: Floor 1 and the last Floor 2 are Boss Floors. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 2, floorsPerTier: 1, postFill: 0, patrolFill: 0 } };
const ARENA = 'gen:greybox:4242';
const MAX = tuning.fighter.maxHp;
const NEED = doorTicksNeeded(tuning);

const delver = (options: Partial<MatchOptions> = {}): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)], ...options });
const planOf = (m: MatchState) => floorOf(tuning, m.arena)!.plan;
const bossOf = (m: MatchState): number => m.duel.crowd!.warbands!.rank.indexOf(BOSS);
const withFighters = (m: MatchState, edit: (f: FighterState, i: number) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map(edit) } });
const fell = (f: FighterState): FighterState => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } });
const tick = (m: MatchState): MatchState => stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), tuning);
const centre = (m: MatchState) => {
  const { zone } = planOf(m).markers.stairs;
  return { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
};
/** `m` with the Boss Warband's every Soldier dead. */
const slain = (m: MatchState): MatchState => {
  const c = m.duel.crowd!;
  const q = bossOf(m);
  const dead = (a: readonly number[]) => a.map((v, s) => (c.squad[s] === q ? 0 : v));
  return { ...m, duel: { ...m.duel, crowd: { ...c, alive: dead(c.alive), hp: dead(c.hp) } } };
};
/** The Player (Fighter 0) standing at the Stairs' centre. */
const atStairs = (m: MatchState): MatchState => {
  const c = centre(m);
  return withFighters(m, (f, i) => (i === 0 ? { ...f, position: { x: c.x, z: c.z }, y: 0 } : f));
};
const times = (m: MatchState, n: number): MatchState => {
  for (let k = 0; k < n; k++) m = tick(m);
  return m;
};

describe('a Boss Floor of a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();

  it('is a Boss Floor with a Boss Warband, and its gate shut', () => {
    expect(isBossFloor(tuning.delver, 1)).toBe(true);
    expect(planOf(m).halls[planOf(m).stairs]!.kind).toBe('Boss');
    expect(bossOf(m)).toBeGreaterThanOrEqual(0);
    expect(gateOpen(planOf(m), m.duel.crowd!, [])).toBe(false);
  });

  it('keeps its Stairs from counting while the Boss Warband lives, then opens them and heals and revives the party when it is wiped', () => {
    let r = atStairs(m);
    r = times(r, NEED + 2);
    expect(r.delver!.stairsTicks).toBe(0);
    expect(r.delver!.phase).toBe('Exploring');
    expect(r.events.some((e) => e.type === 'StairsTaken')).toBe(false);

    // Fighter 1 hurt, Fighter 2 fallen: the wipe heals the first and revives the second in full at the Stairs.
    r = withFighters(r, (f, i) => (i === 1 ? { ...f, hp: 10 } : i === 2 ? fell(f) : f));
    r = withFighters(r, (f, i) => (i === 0 ? { ...f, hp: MAX / 2 } : f));
    const q = bossOf(r);
    r = tick(slain(r));
    expect(r.delver!.wiped).toContain(q);
    expect(r.events).toContainEqual({ type: 'BossBeaten', floor: 1 });
    expect(r.events).toContainEqual({ type: 'Rested', fighter: 0, healed: expect.any(Number) });
    expect(r.events).toContainEqual({ type: 'Rested', fighter: 1, healed: expect.any(Number) });
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 2, fire: -1 });
    expect(r.events.filter((e) => e.type === 'Rested')).toHaveLength(2);
    for (const i of [0, 1, 2]) expect(r.duel.fighters[i]!.hp, `hp ${i}`).toBe(r.duel.fighters[i]!.maxHp);
    const c = centre(r);
    const back = r.duel.fighters[2]!;
    expect(back.death).toBeUndefined();
    expect(Math.hypot(back.position.x - c.x, back.position.z - c.z)).toBeLessThan(3);
    expect(gateOpen(planOf(r), r.duel.crowd!, r.delver!.wiped)).toBe(true);

    // The gate is open: the Stairs count and take the party down.
    r = times(r, NEED + 1);
    expect(r.delver!.phase).toBe('Descending');
    expect(r.nextDuelTick).not.toBeNull();
    expect(r.score[0]).toBe(1);
  });

  it('wipes the Boss Warband once: no second heal on the next Tick', () => {
    const r = tick(slain(atStairs(m)));
    const again = tick(withFighters(r, (f, i) => (i === 0 ? { ...f, hp: 10 } : f)));
    expect(again.events.some((e) => e.type === 'BossBeaten')).toBe(false);
    expect(again.duel.fighters[0]!.hp).toBe(10);
  });
});

describe('the last Boss of a Delver Run', { timeout: 60_000 }, () => {
  const m = delver({ delverStart: 2 });

  it('does not win at its wipe: BossBeaten heals and revives at the Stairs, the Run goes on', () => {
    let r = withFighters(atStairs(m), (f, i) => (i === 1 ? { ...f, hp: 10 } : i === 2 ? fell(f) : f));
    r = tick(slain(r));
    expect(r.events).toContainEqual({ type: 'BossBeaten', floor: 2 });
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 2, fire: -1 });
    expect(r.events.some((e) => e.type === 'RunEnd')).toBe(false);
    expect(r.status.status).toBe('InProgress');
    expect(r.duel.duel.status).toBe('Fighting');
    for (const i of [0, 1, 2]) expect(r.duel.fighters[i]!.hp).toBe(r.duel.fighters[i]!.maxHp);
    expect(r.duel.fighters[2]!.death).toBeUndefined();
    expect(r.delver!.phase).toBe('Exploring');
  });

  it('is a Victory when the party takes the last Stairs for doorSeconds: a RunEnd with the Bosses beaten, no fade', () => {
    let r = tick(slain(atStairs(m)));
    expect(r.status.status).toBe('InProgress');
    for (let k = 0; k < NEED + 2 && r.status.status === 'InProgress'; k++) r = tick(r);
    expect(r.status).toEqual({ status: 'Over', winner: 0, tick: r.tick });
    expect(r.events).toContainEqual({ type: 'RunEnd', winner: 0, cleared: 2, floors: 2, halls: 0, bosses: 2, warbands: 1 });
    expect(r.score).toEqual([2, 0]);
    expect(r.events.some((e) => e.type === 'StairsTaken')).toBe(false);
    expect(r.duel.duel).toEqual({ status: 'Over', winner: 0, tick: r.duel.tick });
    expect(r.duel.events).toContainEqual({ type: 'DuelEnd', winner: 0 });
    expect(r.nextDuelTick).toBeNull();
    const after = tick(r);
    expect(after.status).toEqual(r.status);
    expect(after.events).toEqual([]);
  });

  it('is not a Victory while the Boss lives, even with the party standing in the Stairs', () => {
    const r = times(atStairs(m), NEED + 2);
    expect(r.status.status).toBe('InProgress');
    expect(r.delver!.stairsTicks).toBe(0);
  });
});

describe('RunEnd.bosses', { timeout: 60_000 }, () => {
  const defeat = (m: MatchState) => tick(withFighters(m, (f) => (f.team === 0 ? fell(f) : f)));

  it('is carried by a Defeat: the Boss Floors before it', () => {
    expect(defeat(delver()).events).toContainEqual({ type: 'RunEnd', winner: 1, cleared: 0, floors: 2, halls: 0, bosses: 0, warbands: 0 });
    expect(defeat(delver({ delverStart: 2 })).events).toContainEqual({ type: 'RunEnd', winner: 1, cleared: 1, floors: 2, halls: 0, bosses: 1, warbands: 0 });
  });

  it('counts the current Floor\'s Boss too once it is wiped (a Defeat after the wipe)', () => {
    const r = tick(slain(atStairs(delver())));
    const lost = defeat(r);
    expect(lost.events).toContainEqual({ type: 'RunEnd', winner: 1, cleared: 0, floors: 2, halls: 0, bosses: 1, warbands: 1 });
  });

  it('counts the Warbands beaten over every Floor: the earlier Floors\' carried in `beaten`', () => {
    const FADE = Math.max(1, secondsToTicks(tuning.dungeon.hallFadeSeconds));
    let r = tick(slain(atStairs(delver())));
    expect(r.delver!.beaten).toBe(0);
    r = times(r, NEED + 1);
    expect(r.delver!.phase).toBe('Descending');
    r = times(r, FADE + 1);
    expect(r.delver!.floor).toBe(2);
    expect(r.delver!).toMatchObject({ beaten: 1, wiped: [] });
    expect(defeat(r).events).toContainEqual({ type: 'RunEnd', winner: 1, cleared: 1, floors: 2, halls: 0, bosses: 1, warbands: 1 });
    r = tick(slain(atStairs(r)));
    expect(defeat(r).events).toContainEqual({ type: 'RunEnd', winner: 1, cleared: 1, floors: 2, halls: 0, bosses: 2, warbands: 2 });
  });

  it('is a pure count: Boss Floors before the Floor, plus the current one when wiped', () => {
    const m1 = delver();
    const q = bossOf(m1);
    const crowd = m1.duel.crowd!;
    expect(bossesBeaten(tuning.delver, { floor: 1, wiped: [] }, crowd)).toBe(0);
    expect(bossesBeaten(tuning.delver, { floor: 1, wiped: [q] }, crowd)).toBe(1);
    expect(bossesBeaten(tuning.delver, { floor: 2, wiped: [] }, crowd)).toBe(1);
    expect(bossesBeaten(tuning.delver, { floor: 2, wiped: [q] }, crowd)).toBe(2);
    const plain: TuningData['delver'] = { ...tuning.delver, warbands: tuning.delver.warbands.map(({ boss: _b, ...tier }) => tier) };
    expect(bossesBeaten(plain, { floor: 2, wiped: [q] }, crowd)).toBe(0);
  });

  it('gateOpen is true on a Floor that is not a Boss Floor', () => {
    const plain: TuningData = { ...tuning, delver: { ...tuning.delver, warbands: tuning.delver.warbands.map(({ boss: _b, ...tier }) => tier) } };
    const p = createMatch(plain, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 1, 1, 1, 1] });
    const plan = floorOf(plain, p.arena)!.plan;
    expect(plan.halls[plan.stairs]!.kind).toBe('Stairs');
    expect(gateOpen(plan, p.duel.crowd!, [])).toBe(true);
    const b = delver();
    expect(gateOpen(planOf(b), b.duel.crowd!, [bossOf(b)])).toBe(true);
    expect(gateOpen(planOf(b), b.duel.crowd!, [])).toBe(false);
  });
});

describe('delverStart', { timeout: 60_000 }, () => {
  it('starts the Run on that Floor: its Arena, Duel number, score, Floor and pedestals', () => {
    const six: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 5 } };
    const m = createMatch(six, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, delverStart: 3, teams: [0, 1, 1, 1, 1] });
    expect(m.config.delverStart).toBe(3);
    expect(m.arena).toBe(floorArenaName(runSeed(ARENA), 3));
    expect(m.duel.arena).toBe(m.arena);
    expect(m.duelNumber).toBe(3);
    expect(m.score).toEqual([2, 0]);
    expect(m.events).toEqual([{ type: 'DuelStart', duelNumber: 3 }]);
    expect(m.delver).toMatchObject({ floor: 3, floors: 5, phase: 'Exploring', wiped: [] });
    expect(m.duel.delver).toMatchObject({ floor: 3 });
    const plan = floorOf(six, m.arena)!.plan;
    expect(m.delver!.pickups).toEqual(treasurePickups(arenaTuning(six, m.arena), m.config, plan, runSeed(ARENA), 3, undefined));
  });

  it('refuses 0, a Floor past the last, a fraction, and a start without delver', () => {
    const opts = { format: 'Gauntlet' as const, bestOf: 1, arena: ARENA, teams: [0, 1, 1, 1, 1] };
    expect(() => createMatch(tuning, { ...opts, delver: true, delverStart: 0 })).toThrow(RangeError);
    expect(() => createMatch(tuning, { ...opts, delver: true, delverStart: 3 })).toThrow(RangeError);
    expect(() => createMatch(tuning, { ...opts, delver: true, delverStart: 1.5 })).toThrow(RangeError);
    expect(() => createMatch(tuning, { ...opts, delverStart: 1 })).toThrow(RangeError);
    expect(() => createMatch(tuning, { ...opts, delver: true, delverStart: 2 })).not.toThrow();
  });
});

describe('a Delver Run across its Boss\'s wipe', { timeout: 60_000 }, () => {
  const play = (from: MatchState, n: number): MatchState[] => {
    let m = from;
    const out = [m];
    for (let k = 0; k < n; k++) {
      m = stepMatch(m, m.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, move: { x: 1, z: 0 } } : IDLE_INTENT)), tuning);
      out.push(m);
    }
    return out;
  };
  const start = (): MatchState => withFighters(slain(delver()), (f, i) => (i === 2 ? fell(f) : f));

  it('gives the same hash every Tick, and re-simulates the same from a snapshot taken before the wipe', () => {
    const one = play(start(), 40);
    const two = play(start(), 40);
    expect(one.map((x) => hashValue(x))).toEqual(two.map((x) => hashValue(x)));
    expect(one[1]!.events).toContainEqual({ type: 'BossBeaten', floor: 1 });
    let r = restore(snapshot(one[0]!));
    for (let k = 0; k < 40; k++) {
      r = stepMatch(r, r.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, move: { x: 1, z: 0 } } : IDLE_INTENT)), tuning);
      expect(hashValue(r)).toBe(hashValue(one[k + 1]!));
    }
  });
});
