import { describe, expect, it } from 'vitest';
import { createMatch, IDLE_INTENT, MAX_TEAM_SIZE, stepMatch, type Intent, type MatchState } from '../sim';
import { loadTuningData, withWeapon, type TuningData } from '../tuning';
import { BOSS } from '../sim/warband';
import { MatchAnnouncer, type Milestone } from './announcer';

const base = loadTuningData();
// One Overhead decides a Duel (see the Match tests).
const tuning: TuningData = withWeapon(base, { damage: 10000 });

/** Fighter 0 taps Overheads from 1.3 m until the Match ends; returns every Match Tick. */
function playMatch(bestOf: number): MatchState[] {
  let match = createMatch(tuning, { arena: 'circle', bestOf, distance: 1.3, interDuelTicks: 30 });
  const states = [match];
  for (let t = 0; t < 5000 && match.status.status !== 'Over'; t++) {
    const tap: Intent = { ...IDLE_INTENT, attack: t % 2 === 0 };
    match = stepMatch(match, [tap, IDLE_INTENT], tuning);
    states.push(match);
  }
  return states;
}

function announce(states: readonly MatchState[]): Milestone[] {
  const announcer = new MatchAnnouncer();
  return states.flatMap((s) => announcer.update(s));
}

describe('Match announcements', () => {
  const states = playMatch(3);

  it('announces each Duel start, Duel end and the Match end, once each, in order', () => {
    expect(announce(states)).toEqual([
      { type: 'DuelStart', duelNumber: 1 },
      { type: 'DuelEnd', duelNumber: 1, winner: 0 },
      { type: 'DuelStart', duelNumber: 2 },
      { type: 'DuelEnd', duelNumber: 2, winner: 0 },
      { type: 'MatchEnd', winner: 0, score: [2, 0] },
    ]);
  });

  it('still announces everything when the Ticks carrying the events are skipped (a Rollback re-simulated them)', () => {
    // Only every 7th Tick is seen, so most event Ticks are never presented.
    const sparse = states.filter((_, i) => i % 7 === 0 || i === states.length - 1);
    expect(announce(sparse).map((m) => m.type)).toEqual(['DuelStart', 'DuelEnd', 'DuelStart', 'DuelEnd', 'MatchEnd']);
  });

  it('does not repeat an announcement when the same state is seen again', () => {
    const announcer = new MatchAnnouncer();
    const end = states[states.length - 1]!;
    expect(announcer.update(end).filter((m) => m.type === 'MatchEnd')).toHaveLength(1);
    expect(announcer.update(end)).toEqual([]);
  });
});

describe('Match announcements: a team battle', () => {
  it('announces the watched Fighter falling while its team fights on, once', () => {
    // 1 v 2: Fighter 0 fells one of the two; the other still stands.
    let match = createMatch(tuning, { arena: 'circle', bestOf: 1, teams: [0, 1, 1], distance: 1.3, spacing: 0.8 });
    const states = [match];
    const fallen = () => match.duel.fighters.findIndex((f) => f.death);
    for (let t = 0; t < 2000 && fallen() < 0; t++) {
      match = stepMatch(match, [{ ...IDLE_INTENT, attack: t % 2 === 0 }], tuning);
      states.push(match);
    }
    expect(match.duel.duel.status).toBe('Fighting');
    for (let t = 0; t < 30; t++) states.push((match = stepMatch(match, [], tuning)));
    const announcer = new MatchAnnouncer();
    const fell = states.flatMap((s) => announcer.update(s, fallen())).filter((m) => m.type === 'Fell');
    expect(fell).toEqual([{ type: 'Fell', duelNumber: 1 }]);
    const other = new MatchAnnouncer();
    expect(states.flatMap((s) => other.update(s, 0)).some((m) => m.type === 'Fell')).toBe(false);
  });
});

describe('Rematch announcements', () => {
  it('announces the rematch afresh: its Duels and its result', () => {
    let match = createMatch(tuning, { arena: 'circle', bestOf: 1, distance: 1.3, interDuelTicks: 30, rematchTicks: 30 });
    const states = [match];
    for (let t = 0; t < 5000 && !(match.matchNumber === 2 && match.status.status === 'Over'); t++) {
      const tap: Intent = { ...IDLE_INTENT, attack: t % 2 === 0 };
      match = stepMatch(match, [tap, IDLE_INTENT], tuning);
      states.push(match);
    }
    const once = [
      { type: 'DuelStart', duelNumber: 1 },
      { type: 'DuelEnd', duelNumber: 1, winner: 0 },
      { type: 'MatchEnd', winner: 0, score: [1, 0] },
    ];
    expect(announce(states)).toEqual([...once, ...once]);
  });
});

describe('Run announcements', () => {
  const plain = loadTuningData();
  /** A Run on gen:greybox:12, Team 0 one Fighter; its first Hall cleared on Tick 1, then 30 Ticks walked on. */
  function clearFirstHall(): MatchState[] {
    let m = createMatch(plain, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
    const states = [m];
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 ? { ...f, hp: 0 } : f)) } };
    for (let t = 0; t < 30; t++) states.push((m = stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), plain)));
    return states;
  }

  it('announces a Hall cleared once (its Duel goes on, so no Duel end), even when the Tick it happened on is skipped', () => {
    const states = clearFirstHall();
    expect(states.at(-1)!.run!.phase).toBe('Cleared');
    expect(states.at(-1)!.duel.duel.status).toBe('Fighting');
    const kind = states.at(-1)!.duel.hall!.kind;
    const expected = [
      { type: 'DuelStart', duelNumber: 1 },
      { type: 'HallCleared', duelNumber: 1, kind },
    ];
    expect(announce(states)).toEqual(expected);
    expect(announce(states.filter((_, i) => i === 0 || i % 7 === 3))).toEqual(expected);
  });

  it('announces the watched Fighter taking a Rest Hall’s fire, once', () => {
    const m = clearFirstHall().at(-1)!;
    const rested: MatchState = { ...m, run: { ...m.run!, rested: [0] } };
    const announcer = new MatchAnnouncer();
    announcer.update(m, 0);
    expect(announcer.update(rested, 0)).toEqual([{ type: 'Rested', duelNumber: 1 }]);
    expect(announcer.update(rested, 0)).toEqual([]);
    expect(new MatchAnnouncer().update(rested, 1).some((x) => x.type === 'Rested')).toBe(false);
  });
});

describe('Rested and Fell are for the watched Fighter only', () => {
  const run = (): MatchState => createMatch(tuning, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, humans: 2, teams: [0, 0, 1, 1, 1, 1] });
  const kinds = (m: MatchState, me: number) => new MatchAnnouncer().update(m, me).map((e) => e.type);

  it('announces Rested on the peer whose Player rested, not the other', () => {
    const m = { ...run(), run: { ...run().run!, rested: [1] } };
    expect(kinds(m, 1)).toContain('Rested');
    expect(kinds(m, 0)).not.toContain('Rested');
  });

  it('announces Fell for the local Fighter only', () => {
    const m = run();
    const fallen = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 1 ? { ...f, hp: 0, death: { tick: 1 } as never } : f)) } };
    expect(kinds(fallen, 1)).toContain('Fell');
    expect(kinds(fallen, 0)).not.toContain('Fell');
  });
});

describe('a Delver Run’s announcements', () => {
  const run: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
  const start = () => createMatch(run, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const fighter0 = (m: MatchState, edit: (f: MatchState['duel']['fighters'][number]) => MatchState['duel']['fighters'][number]): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? edit(f) : f)) } });

  it('announces the Floor, the fall, the Revived and the Rested of each fire once, and the Floor again on the next', () => {
    const announcer = new MatchAnnouncer();
    const m = start();
    expect(announcer.update(m, 0)).toEqual([{ type: 'DuelStart', duelNumber: 1 }]);
    const fallen = fighter0(m, (f) => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } }));
    expect(announcer.update(fallen, 0)).toEqual([{ type: 'Fell', duelNumber: 1 }]);
    expect(announcer.update(fallen, 0)).toEqual([]);
    const back = { ...m, delver: { ...m.delver!, restUsed: [{ revived: true, healed: [0] }] } };
    expect(announcer.update(back, 0)).toEqual([{ type: 'Revived', duelNumber: 1 }, { type: 'Rested', duelNumber: 1 }]);
    expect(announcer.update(back, 0)).toEqual([]);
    // A second fire taken is announced too; another Player taking one is not.
    const second = { ...back, delver: { ...back.delver!, restUsed: [...back.delver!.restUsed, { revived: false, healed: [0, 1] }, { revived: false, healed: [1] }] } };
    expect(announcer.update(second, 0)).toEqual([{ type: 'Rested', duelNumber: 1 }]);
    // The next Floor starts afresh: its fires are untouched.
    const next = { ...m, duelNumber: 2, delver: { ...m.delver!, floor: 2 } };
    expect(announcer.update(next, 0)).toEqual([{ type: 'DuelStart', duelNumber: 2 }]);
  });
});

describe('a Boss Floor’s announcements', () => {
  const boss: TuningData = { ...base, delver: { ...base.delver, tiers: 2, floorsPerTier: 1, postFill: 0, patrolFill: 0 } };
  const m = createMatch(boss, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const q = m.duel.crowd!.warbands!.rank.indexOf(BOSS);
  const drop = (id: number, owner: number | null, over: object = {}) => ({ id, owner, kind: 'relic' as const, item: 'Whetstone', at: { x: 0, y: 0, z: 0 }, taken: false, ...over });

  it('announces the Boss beaten once, when the Boss Warband is wiped, and not before', () => {
    expect(q).toBeGreaterThanOrEqual(0);
    const announcer = new MatchAnnouncer();
    expect(announcer.update(m, 0)).toEqual([{ type: 'DuelStart', duelNumber: 1 }]);
    const other = { ...m, delver: { ...m.delver!, wiped: [q + 1] } };
    expect(announcer.update(other, 0)).toEqual([]);
    const beaten = { ...m, delver: { ...m.delver!, wiped: [q] } };
    expect(announcer.update(beaten, 0)).toEqual([{ type: 'BossBeaten', duelNumber: 1 }]);
    expect(announcer.update(beaten, 0)).toEqual([]);
  });

  it('announces loot dropped for the local Player only: its own wipe drops, not another Player’s, a shared inventory drop or a pedestal', () => {
    const announcer = new MatchAnnouncer();
    announcer.update(m, 0);
    const lying = (...more: ReturnType<typeof drop>[]) => ({ ...m, delver: { ...m.delver!, pickups: [...m.delver!.pickups, ...more] } });
    const n = m.delver!.pickups.length;
    expect(announcer.update(lying(drop(n, 1)), 0)).toEqual([]);
    expect(announcer.update(lying(drop(n, 1), drop(n + 1, null, { by: 0 })), 0)).toEqual([]);
    expect(announcer.update(lying(drop(n, 1), drop(n + 1, null, { by: 0 }), drop(n + 2, 0, { group: n + 2 })), 0)).toEqual([]);
    const mine = lying(drop(n, 1), drop(n + 1, 0), drop(n + 2, 0));
    expect(announcer.update(mine, 0)).toEqual([{ type: 'LootDropped', duelNumber: 1 }]);
    expect(announcer.update(mine, 0)).toEqual([]);
    expect(announcer.update(lying(), -1)).toEqual([]);
  });
});
