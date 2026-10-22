import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createAiController, lineupAis, lineupMatch, runMatch, type Controller, type Lineup } from '../controllers';
import { nextArenaName } from './arenaGen/named';
import { inDuel, updateDuel, DUEL_FIGHTING } from './duel';
import { enemyMaxHp, floorRoster, runSeed } from './gauntlet';
import { hashValue } from './hash';
import { IDLE_INTENT, type Intent } from './intent';
import { createMatch, stepMatch, type MatchEvent, type MatchOptions, type MatchState } from './match';
import { attack, hold, runScript, type Track } from './script';
import type { FighterState, SimState } from './state';
import { createInitialState, duelPlacements, step } from './step';
import type { SimEvent } from './events';

const tuning = loadTuningData();
const ARENA = 'gen:greybox:4242';
const { heal, revive } = tuning.gauntlet;
const MAX = tuning.fighter.maxHp;

/** A Run: Team 0's `own` Fighters, then the three Team 1 slots, on ARENA, with a short pause between Floors. */
const run = (options: Partial<MatchOptions> = {}, own = 2): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [...Array<number>(own).fill(0), 1, 1, 1], interDuelTicks: 10, ...options });

/** The Match with each Fighter's HP set by `hp(f, i)` (0 fells it on the next Tick). */
const withHp = (m: MatchState, hp: (f: FighterState, i: number) => number): MatchState => ({
  ...m,
  duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (inDuel(f) ? { ...f, hp: hp(f, i) } : f)) },
});

const idle = (m: MatchState): Intent[] => m.duel.fighters.map(() => IDLE_INTENT);

/** Step until `done` (at most `limit` Ticks), collecting every Match event on the way. */
function stepUntil(m: MatchState, done: (m: MatchState) => boolean, limit = 2000): { m: MatchState; events: MatchEvent[] } {
  const events: MatchEvent[] = [];
  for (let k = 0; k < limit && !done(m); k++) {
    m = stepMatch(m, idle(m), tuning);
    events.push(...m.events);
  }
  if (!done(m)) throw new Error('never happened');
  return { m, events };
}

/** Fell every enemy (Team 0's HP set by `own`) and step on to the next Floor's first Tick. */
function clearFloor(m: MatchState, own: (f: FighterState, i: number) => number = (f) => f.hp): MatchState {
  const floor = m.run!.floor;
  return stepUntil(withHp(m, (f, i) => (f.team === 1 ? 0 : own(f, i))), (n) => n.run!.floor > floor).m;
}

describe('Gauntlet Run: deterministic', { timeout: 60_000 }, () => {
  const lineup: Lineup = [0, 0, 0, 1, 1, 1].map((team) => ({ team, pilot: { kind: 'AI', difficulty: 'Hard' } }));
  const play = () => runMatch(tuning, run({ seed: 3, arena: 'gen:greybox:1', interDuelTicks: undefined }, 3), lineupAis(tuning, lineup, 'Gauntlet') as Controller[], 2000);

  it('gives the same hash at every Tick from the same options, across a Floor change', () => {
    const one = play();
    const two = play();
    expect(one.matches.map((m) => hashValue(m))).toEqual(two.matches.map((m) => hashValue(m)));
    // Three Hard allies clear Floor 1 (one Easy enemy) well inside the 2000 Ticks.
    expect(one.final.run!.floor).toBeGreaterThanOrEqual(2);
  });

  it('a Run seed gives the same Floor Arenas and enemies every time', () => {
    const arenas = (seed: number) => {
      let m = run({ arena: `gen:greybox:${seed}` });
      const names = [m.arena];
      for (let k = 0; k < 2; k++) names.push((m = clearFloor(m)).arena);
      return { names, enemies: m.duel.fighters.map((f) => [f.weapon, f.maxHp, f.benched ?? false]) };
    };
    const a = arenas(4242);
    expect(arenas(4242)).toEqual(a);
    expect(a.names).toEqual([ARENA, nextArenaName(ARENA), nextArenaName(nextArenaName(ARENA))]);
    for (let floor = 1; floor <= tuning.gauntlet.floors.length; floor++) {
      expect(floorRoster(tuning, { arena: ARENA, humans: 1 }, floor)).toEqual(floorRoster(tuning, { arena: ARENA, humans: 1 }, floor));
    }
    // The random Weapons depend on the Run seed: over a handful of seeds, Floor 2's picks are not all the same.
    const picks = new Set([1, 2, 3, 4, 5, 6].map((seed) => floorRoster(tuning, { arena: `gen:greybox:${seed}`, humans: 1 }, 2).map((e) => e?.weapon).join()));
    expect(picks.size).toBeGreaterThan(1);
    expect(runSeed(ARENA)).toBe(4242);
  });
});

describe('Gauntlet Run: Floor change', { timeout: 30_000 }, () => {
  it('Floor 1 fields the Floor\'s one enemy and Benches the other two slots', () => {
    const m = run();
    expect(m.run).toEqual({ floor: 1, floors: tuning.gauntlet.floors.length, cleared: 0, startTick: 0 });
    expect(m.duel.floor).toBe(1);
    const [, , e0, e1, e2] = m.duel.fighters;
    expect(inDuel(e0!)).toBe(true);
    expect(e0!.hp).toBe(MAX);
    for (const f of [e1!, e2!]) expect(f).toMatchObject({ hp: 0, benched: true });
    expect(e1!.death).toBeUndefined();
  });

  it('moves to the next seed, carries HP with the heal, revives the fallen, refills daggers and Benches unused slots', () => {
    let m = run();
    // Fighter 0 has used two daggers and is hurt; Fighter 1 falls on the Tick the last enemy does.
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, daggers: 1 } : f)) } };
    m = withHp(m, (_, i) => (i === 0 ? 50 : 0));
    m = stepMatch(m, idle(m), tuning);
    expect(m.duel.duel).toMatchObject({ status: 'Over', winner: 0 });
    expect(m.duel.fighters[1]!.death).toBeDefined();
    expect(m.run!.cleared).toBe(1);
    expect(m.status.status).toBe('InProgress');
    expect(m.nextDuelTick).toBe(m.tick + 10);

    const { m: next, events } = stepUntil(m, (n) => n.run!.floor === 2);
    expect(events).toContainEqual({ type: 'DuelStart', duelNumber: 2 });
    expect(next.arena).toBe(nextArenaName(ARENA));
    expect(next.duel.arena).toBe(next.arena);
    expect(next.duel.floor).toBe(2);
    expect(next.duel.tick).toBe(0);
    const [a, b, ...enemies] = next.duel.fighters;
    expect(a!.hp).toBe(50 + heal * MAX);
    expect(b!.hp).toBe(revive * MAX);
    expect(b!.death).toBeUndefined();
    expect([a!.daggers, b!.daggers]).toEqual([tuning.dagger.count, tuning.dagger.count]);
    expect([a!.sheathed, b!.sheathed]).toEqual([false, false]);
    // Floor 2 lists two enemies: the third slot is Benched.
    const roster = floorRoster(tuning, next.config, 2);
    expect(enemies.map((f) => f.benched === true)).toEqual([false, false, true]);
    expect(enemies.slice(0, 2).map((f) => [f.weapon, f.hp, f.maxHp])).toEqual(roster.slice(0, 2).map((e) => [e!.weapon, e!.maxHp, e!.maxHp]));
    // The generator carries on: the next Floor is not a replay of the last one's draws.
    expect(next.duel.rng).not.toEqual(createMatch(tuning, { bestOf: 1, seed: 7 }).duel.rng);
  });

  it('never heals past max HP', () => {
    const next = clearFloor(run(), () => MAX - 1);
    expect(next.duel.fighters.slice(0, 2).map((f) => f.hp)).toEqual([MAX, MAX]);
  });
});

describe('Gauntlet Run: the end', { timeout: 60_000 }, () => {
  const runEnd = (events: readonly MatchEvent[]) => events.filter((e) => e.type === 'RunEnd');

  it('is lost when Team 0 is wiped out', () => {
    const m = clearFloor(run());
    const over = stepMatch(withHp(m, (f) => (f.team === 0 ? 0 : f.hp)), idle(m), tuning);
    expect(over.status).toMatchObject({ status: 'Over', winner: 1 });
    expect(runEnd(over.events)).toEqual([{ type: 'RunEnd', winner: 1, cleared: 1, floors: 7 }]);
    expect(over.nextDuelTick).toBeNull();
    // Nothing comes after: no next Floor, no Rematch.
    const later = stepUntil(over, (n) => n.tick >= over.tick + 400, 401).m;
    expect(later.run!.floor).toBe(2);
    expect(later.duelNumber).toBe(2);
  });

  it('is lost on a draw: the last of both Teams falling on the same Tick', () => {
    const m = run();
    const over = stepMatch(withHp(m, () => 0), idle(m), tuning);
    expect(over.duel.duel).toMatchObject({ status: 'Over', winner: null });
    expect(over.status).toMatchObject({ status: 'Over', winner: 1 });
    expect(runEnd(over.events)).toEqual([{ type: 'RunEnd', winner: 1, cleared: 0, floors: 7 }]);
  });

  it('is won by clearing the last Floor, the boss', () => {
    let m = run();
    for (let floor = 1; floor < 7; floor++) m = clearFloor(m);
    expect(m.run!.floor).toBe(7);
    expect(m.arena).toBe(Array.from({ length: 6 }).reduce<string>((name) => nextArenaName(name), ARENA));
    // The boss: a Hard Sledge Hammer at three times the HP, and a Normal Arming Sword.
    const [, , boss, add, benched] = m.duel.fighters;
    expect([boss!.weapon, boss!.maxHp, boss!.hp]).toEqual(['Sledge Hammer', 3 * MAX, 3 * MAX]);
    expect([add!.weapon, add!.maxHp]).toEqual(['Arming Sword', MAX]);
    expect(benched!.benched).toBe(true);
    const over = stepMatch(withHp(m, (f) => (f.team === 1 ? 0 : f.hp)), idle(m), tuning);
    expect(over.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(runEnd(over.events)).toEqual([{ type: 'RunEnd', winner: 0, cleared: 7, floors: 7 }]);
    expect(over.nextDuelTick).toBeNull();
  });
});

describe('Gauntlet Run: enemy HP scales with the number of humans', () => {
  const { perPlayerHp } = tuning.gauntlet;
  const player = (player: 0 | 1 | 2) => ({ team: 0, pilot: { kind: 'Player', player } }) as const;
  const ally = { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } } as const;
  const enemy = { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } } as const;
  const runOf = (lineup: Lineup) => createMatch(tuning, lineupMatch(tuning, lineup, ['Arming Sword', 'Arming Sword', 'Arming Sword'], { format: 'Gauntlet', bestOf: 1, arena: ARENA }));

  it.each([
    [1, [player(0), ally, ally]],
    [2, [player(0), player(1), ally]],
    [3, [player(0), player(1), player(2)]],
  ] as const)('with %i human(s), each enemy has maxHp × hpScale × (1 + perPlayerHp × (humans − 1))', (humans, own) => {
    const m = runOf([...own, enemy, enemy, enemy]);
    expect(m.config.humans).toBe(humans);
    const scale = 1 + perPlayerHp * (humans - 1);
    const e = m.duel.fighters[3]!;
    expect([e.maxHp, e.hp]).toEqual([MAX * scale, MAX * scale]);
    // Team 0 is never scaled.
    expect(m.duel.fighters.slice(0, 3).map((f) => f.maxHp)).toEqual([MAX, MAX, MAX]);
    // The boss's hpScale multiplies with it.
    expect(floorRoster(tuning, m.config, 7)[0]!.maxHp).toBe(MAX * 3 * scale);
    expect(enemyMaxHp(tuning, 3, humans)).toBe(MAX * 3 * scale);
  });

  it('AI allies do not change it', () => {
    const solo = runOf([player(0), enemy, enemy, enemy]);
    const withAllies = runOf([player(0), ally, ally, enemy, enemy, enemy]);
    expect(withAllies.config.humans).toBe(1);
    expect(withAllies.duel.fighters[3]!.maxHp).toBe(solo.duel.fighters[1]!.maxHp);
    expect(solo.duel.fighters[1]!.maxHp).toBe(MAX);
  });

  it('is fixed for the Run: Floor 2 still scales with the humans the Run started with', () => {
    const m = clearFloor(runOf([player(0), player(1), enemy, enemy, enemy]));
    expect(m.duel.fighters[2]!.maxHp).toBe(MAX * (1 + perPlayerHp));
  });

  it('createMatch refuses a Run with no humans, more humans than Team 0 holds, a Rematch, or the wrong teams', () => {
    expect(() => run({ humans: 0 })).toThrow(/humans/);
    expect(() => run({ humans: 3 })).toThrow(/humans/);
    expect(() => run({ rematchTicks: 100 })).toThrow(/Rematch/);
    expect(() => run({ teams: [0, 1, 1] })).toThrow(/Team 1 slots/);
    expect(() => run({ teams: [0, 1, 0, 1, 1] })).toThrow(/Team 1 slots/);
  });
});

describe('A Benched Fighter is out of the Duel', () => {
  /** Fighter 0 (Team 0) faces Fighter 1 (Team 1) `distance` apart on the Editor's flat Arena; Fighter 2 (Team 1) stands far off, so the Duel goes on. */
  function scene(distance: number, benched: boolean): SimState {
    const s = createInitialState(tuning, 1, [...duelPlacements(distance), { position: { x: 6, z: 6 }, facing: 0 }], [], [0, 1, 1]);
    return benched ? { ...s, fighters: s.fighters.map((f, i) => (i === 1 ? { ...f, hp: 0, benched: true as const } : f)) } : s;
  }
  /** Run Fighter 0's Track in both scenes: the control (an ordinary enemy) and with Fighter 1 Benched. */
  function both(distance: number, track: Track, ticks = 150) {
    const play = (benched: boolean) => {
      const initial = scene(distance, benched);
      return { initial, ...runScript(tuning, initial, [track, [], []], ticks) };
    };
    return { control: play(false), benched: play(true) };
  }
  const on1 = (events: readonly SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type && 'defender' in e && e.defender === 1);
  /** The Benched Fighter never changed: the very same object every Tick. */
  const untouched = (r: ReturnType<typeof both>['benched']) => r.states.every((s) => s.fighters[1] === r.initial.fighters[1]);

  it('is not hit by a Blade Sweep', () => {
    const { control, benched } = both(1.3, attack('Overhead'));
    expect(on1(control.events, 'Hit').length).toBe(1);
    expect(on1(benched.events, 'Hit')).toEqual([]);
    expect(untouched(benched)).toBe(true);
  });

  it('is not reached by a Kick', () => {
    const { control, benched } = both(1.0, hold(1, { kick: true }));
    expect(on1(control.events, 'KickLanded').length).toBe(1);
    expect(on1(benched.events, 'KickLanded')).toEqual([]);
    expect(untouched(benched)).toBe(true);
  });

  it('is not hit by a Throwing Dagger', () => {
    const { control, benched } = both(4, hold(1, { throw: true }), 200);
    expect(on1(control.events, 'DaggerHit').length).toBe(1);
    expect(on1(benched.events, 'DaggerHit')).toEqual([]);
    expect(untouched(benched)).toBe(true);
  });

  it('blocks no body: walking into it, a Fighter goes on as if it were not there', () => {
    const walkIn = hold(90, { move: { x: 0, z: 1 } });
    const { control, benched } = both(1.2, walkIn, 90);
    const alone = runScript(tuning, createInitialState(tuning, 1, [duelPlacements(1.2)[0]!, { position: { x: 6, z: 6 }, facing: 0 }], [], [0, 1]), [walkIn, []], 90);
    expect(benched.final.fighters[0]!.position).toEqual(alone.final.fighters[0]!.position);
    expect(control.final.fighters[0]!.position).not.toEqual(alone.final.fighters[0]!.position);
    expect(untouched(benched)).toBe(true);
  });

  it('is no AI target: an AI whose only enemy is Benched does nothing', () => {
    const lone = (benched: boolean) => {
      const s = createInitialState(tuning, 1, duelPlacements(3), [], [0, 1]);
      let state: SimState = benched ? { ...s, fighters: [s.fighters[0]!, { ...s.fighters[1]!, hp: 0, benched: true }] } : s;
      const ai = createAiController(tuning, 'Hard');
      const intents: Intent[] = [];
      for (let k = 0; k < 120; k++) {
        const intent = ai.intent(state, 0);
        intents.push(intent);
        state = step(state, [intent, IDLE_INTENT], tuning);
      }
      return { intents, state };
    };
    const control = lone(false);
    expect(control.intents.some((i) => hashValue(i) !== hashValue(IDLE_INTENT))).toBe(true);
    const benched = lone(true);
    expect(benched.intents.every((i) => hashValue(i) === hashValue(IDLE_INTENT))).toBe(true);
    // ...and the Duel goes on: the Benched slot has not fallen.
    expect(benched.state.duel.status).toBe('Fighting');
  });

  it('is not counted by the Duel\'s end: neither standing nor fallen', () => {
    const [a, b, c] = scene(2, true).fighters;
    const fell: FighterState = { ...c!, hp: 0, death: { tick: 5, cause: 'Hit', blow: null } };
    const emitted: SimEvent[] = [];
    const emit = (e: SimEvent) => void emitted.push(e);
    // Team 1's only fielded Fighter standing: the Duel goes on.
    expect(updateDuel(DUEL_FIGHTING, [a!, b!, c!], 5, emit)).toBe(DUEL_FIGHTING);
    // It falls: Team 0 wins, the Benched slot standing for nobody.
    expect(updateDuel(DUEL_FIGHTING, [a!, b!, fell], 5, emit)).toEqual({ status: 'Over', winner: 0, tick: 5 });
    expect(emitted).toEqual([{ type: 'DuelEnd', winner: 0 }]);
  });

  it('does not fall: stepping never gives it a Death, whatever its 0 HP', () => {
    const s = scene(2, true);
    const after = step(s, [], tuning);
    expect(after.fighters[1]).toBe(s.fighters[1]);
    expect(after.events.filter((e) => e.type === 'Death')).toEqual([]);
  });
});

describe('Duels are untouched', () => {
  it('a Duels Match has no Run, no Floor, no Benched slot, and every Fighter at fighter.maxHp', () => {
    const m = createMatch(tuning, { bestOf: 3, teams: [0, 0, 1], arena: ARENA });
    expect(m.config.format).toBe('Duels');
    expect(m.run).toBeNull();
    expect('floor' in m.duel).toBe(false);
    expect(m.duel.fighters.every((f) => f.maxHp === MAX && f.hp === MAX && !('benched' in f))).toBe(true);
    expect(m.config.interDuelTicks).toBe(Math.round(tuning.match.interDuelSeconds * 60));
    const after = stepMatch(m, idle(m), tuning);
    expect('floor' in after.duel).toBe(false);
  });

  it('lineupAis gives Team 1 ordinary AIs in Duels and Floor AIs in a Gauntlet', () => {
    const lineup: Lineup = [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Hard' } },
    ];
    const duels = lineupAis(tuning, lineup);
    const gauntlet = lineupAis(tuning, lineup, 'Gauntlet');
    expect(duels[0]).toBeNull();
    expect(gauntlet[0]).toBeNull();
    // A Floor AI's memory names the Floor it last saw; an ordinary AI's does not.
    expect(duels[1]!.save!()).not.toHaveProperty('floor');
    expect(gauntlet[1]!.save!()).toHaveProperty('floor', -1);
  });
});
