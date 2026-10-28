import { describe, expect, it } from 'vitest';
import { loadTuningData, type DungeonEncounter, type DungeonTuning, type TuningData } from '../tuning';
import { createAiController, lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { arenaOf } from './arena';
import { floorGraph, runSeed, type FloorGraph } from './dungeon';
import { inDuel, updateDuel, DUEL_FIGHTING } from './duel';
import { atRestFire, enemyMaxHp, exitDoor, hallOf, hallRoster, inExitZone, restFire } from './hall';
import { hashValue } from './hash';
import { IDLE_INTENT, type Intent } from './intent';
import { createMatch, doorTicksNeeded, MAX_TEAM_SIZE, runHall, stepMatch, takenExit, type MatchEvent, type MatchOptions, type MatchState } from './match';
import { attack, hold, runScript, type Track } from './script';
import { restore, snapshot } from './snapshot';
import type { FighterState, SimState } from './state';
import { createInitialState, duelPlacements, step } from './step';
import type { SimEvent } from './events';
import { secondsToTicks } from './constants';

const tuning = loadTuningData();
const ARENA = 'gen:greybox:4242';
const MAX = tuning.fighter.maxHp;
const { revive, restHeal } = tuning.dungeon;
const NEED = doorTicksNeeded(tuning);
const FADE = secondsToTicks(tuning.dungeon.hallFadeSeconds);

/** A Run: Team 0's `own` Fighters (the first `humans` of them Players), then the MAX_TEAM_SIZE Team 1 slots, on ARENA. */
const run = (options: Partial<MatchOptions> = {}, own = 2, t: TuningData = tuning): MatchState =>
  createMatch(t, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [...Array<number>(own).fill(0), ...Array<number>(MAX_TEAM_SIZE).fill(1)], ...options });

/** The Match with each Fighter in the Duel given HP `hp(f, i)` (0 fells it on the next Tick). */
const withHp = (m: MatchState, hp: (f: FighterState, i: number) => number): MatchState => ({
  ...m,
  duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (inDuel(f) ? { ...f, hp: hp(f, i) } : f)) },
});

const idle = (m: MatchState): Intent[] => m.duel.fighters.map(() => IDLE_INTENT);

/** The Match with Fighter `i` moved to (x, y, z). */
const placed = (m: MatchState, i: number, p: { x: number; y: number; z: number }): MatchState => ({
  ...m,
  duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: { x: p.x, z: p.z }, y: p.y } : f)) },
});

/** Four spots well inside exit `exit`'s zone of the current Hall's Arena (`exit` null: the middle of Team 1's spawns, away from every Door). */
function spots(m: MatchState, exit: number | null): { x: number; y: number; z: number }[] {
  const arena = arenaOf(tuning, m.arena);
  if (exit === null) {
    const fire = restFire(arena);
    return [-0.6, 0.6].flatMap((dx) => [-0.6, 0.6].map((dz) => ({ x: fire.x + dx, y: fire.y, z: fire.z + dz })));
  }
  const zone = arena.doors[exitDoor(exit)]!.zone;
  const c = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
  return [-0.6, 0.6].flatMap((dx) => [-0.6, 0.6].map((dz) => ({ x: c.x + dx, y: zone[0]!.y, z: c.z + dz })));
}

/** Step `ticks` Ticks with idle Intents, each Fighter of `at` held in the zone of its exit (a number) or away from every Door (null). */
function holdAt(m: MatchState, at: ReadonlyMap<number, number | null>, ticks: number): { m: MatchState; events: MatchEvent[] } {
  const events: MatchEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const hall = m.duelNumber;
    let n = 0;
    for (const [i, exit] of at) m = placed(m, i, spots(m, exit)[n++ % 4]!);
    m = stepMatch(m, idle(m), tuning);
    events.push(...m.events);
    if (m.duelNumber !== hall) break;
  }
  return { m, events };
}

const allAt = (fighters: readonly number[], exit: number | null) => new Map(fighters.map((i) => [i, exit] as const));

/** Fell every enemy (Team 0's HP set by `own`) and step once: the Hall is Cleared. */
function clear(m: MatchState, own: (f: FighterState, i: number) => number = (f) => f.hp): { m: MatchState; events: MatchEvent[] } {
  const next = stepMatch(withHp(m, (f, i) => (f.team === 1 ? 0 : own(f, i))), idle(m), tuning);
  return { m: next, events: [...next.events] };
}

/** Clear the Hall if need be, then hold `who` (default the Players' Fighters) at exit `exit` until the next Hall's first Tick. */
function advance(m: MatchState, exit = 0, who: readonly number[] = m.config.players!, own?: (f: FighterState, i: number) => number): { m: MatchState; events: MatchEvent[] } {
  const events: MatchEvent[] = [];
  if (m.run!.phase === 'Fighting') {
    const c = clear(m, own);
    m = c.m;
    events.push(...c.events);
  }
  const held = holdAt(m, allAt(who, exit), NEED + FADE + 5);
  events.push(...held.events);
  if (held.m.duelNumber === m.duelNumber) throw new Error('never left the Hall');
  return { m: held.m, events };
}

/** The exits that take the party from row 0's Hall to Hall `index` of row `row` of a Floor graph (a first-found route). */
function routeTo(graph: FloorGraph, row: number, index: number): number[] {
  const search = (r: number, i: number): number[] | null => {
    if (r === row) return i === index ? [] : null;
    for (const [k, j] of graph[r]![i]!.exits.entries()) {
      const rest = search(r + 1, j);
      if (rest) return [k, ...rest];
    }
    return null;
  };
  return search(0, 0)!;
}

const runEnd = (events: readonly MatchEvent[]) => events.filter((e) => e.type === 'RunEnd');

describe('Dungeon Run: the first Hall', () => {
  it('starts in Floor 1\'s entrance Fight Hall, on its Arena, Team 0 at Door 0\'s spawns and Team 1 from its Encounter', () => {
    const m = run();
    const graph = floorGraph(tuning.dungeon, 4242, 1, 'greybox');
    expect(m.run).toEqual({ floor: 1, floors: 3, row: 0, hall: 0, path: [{ floor: 1, row: 0, index: 0 }], phase: 'Fighting', doorTicks: graph[0]![0]!.exits.map(() => 0), rested: [], startTick: 0 });
    expect(m.arena).toBe(graph[0]![0]!.arena);
    expect(m.duel.arena).toBe(m.arena);
    expect(m.config.arena).toBe(ARENA);
    expect(m.config.players).toEqual([0]);
    expect(m.duel.hall).toEqual({ floor: 1, row: 0, index: 0, kind: 'Fight', phase: 'Fighting' });
    const door0 = arenaOf(tuning, m.arena).doors[0]!.spawns;
    expect(m.duel.fighters.slice(0, 2).map((f) => [f.position.x, f.position.z])).toEqual(door0.slice(0, 2).map((s) => [s.position.x, s.position.z]));
    const roster = hallRoster(tuning, m.config, runHall(m.run!));
    const enemies = m.duel.fighters.slice(2);
    expect(enemies.map((f) => f.benched === true)).toEqual(roster.map((e) => e === null));
    for (const [k, e] of roster.entries()) if (e) expect([enemies[k]!.weapon, enemies[k]!.hp, enemies[k]!.maxHp]).toEqual([e.weapon, e.maxHp, e.maxHp]);
  });

  it('scales enemy max HP by the humans and the Hall\'s row: maxHp × hpScale × (1 + perPlayerHp × (humans − 1)) × (1 + depthHp × row)', () => {
    const { perPlayerHp, depthHp } = tuning.dungeon;
    expect(enemyMaxHp(tuning, 2, 3, 4)).toBeCloseTo(MAX * 2 * (1 + perPlayerHp * 2) * (1 + depthHp * 4));
    expect(enemyMaxHp(tuning, 1, 1, 0)).toBe(MAX);
    // A Hall of row 2 of a two-human Run: every enemy at its Encounter's hpScale times both factors.
    const m = run({ humans: 2, players: [0, 1] });
    const at = { floor: 1, row: 2, index: 0 };
    const encounter = hallOf(tuning, ARENA, at).encounter;
    const roster = hallRoster(tuning, m.config, at);
    for (const [k, e] of (encounter?.enemies ?? []).entries())
      if (roster[k]) expect(roster[k]!.maxHp).toBeCloseTo(MAX * e.hpScale * (1 + perPlayerHp) * (1 + depthHp * 2));
  });

  it('createMatch refuses a Run with no humans, more humans than Team 0 holds, Players off Team 0, a Rematch, or the wrong teams', () => {
    expect(() => run({ humans: 0 })).toThrow(/humans/);
    expect(() => run({ humans: 3 })).toThrow(/humans/);
    expect(() => run({ players: [2] })).toThrow(/players/);
    expect(() => run({ humans: 2, players: [1, 0] })).toThrow(/players/);
    expect(() => run({ rematchTicks: 100 })).toThrow(/Rematch/);
    expect(() => run({ teams: [0, 1, 1, 1] })).toThrow(/Team 1 slots/);
  });
});

describe('Dungeon Run: Hall flow', { timeout: 60_000 }, () => {
  it('a cleared Hall stays in play: HallCleared, the Duel goes on and Team 0 still moves', () => {
    const { m, events } = clear(run());
    expect(events).toContainEqual({ type: 'HallCleared', floor: 1, row: 0, index: 0, kind: 'Fight' });
    expect(m.run!.phase).toBe('Cleared');
    expect(m.duel.hall!.phase).toBe('Cleared');
    expect(m.duel.duel.status).toBe('Fighting');
    expect([m.status.status, m.nextDuelTick]).toEqual(['InProgress', null]);
    let n = m;
    const walk: Intent = { ...IDLE_INTENT, move: { x: 0, z: 1 } };
    for (let k = 0; k < 30; k++) n = stepMatch(n, n.duel.fighters.map((_, i) => (i === 0 ? walk : IDLE_INTENT)), tuning);
    expect(n.duel.fighters[0]!.position).not.toEqual(m.duel.fighters[0]!.position);
    expect(n.run!.phase).toBe('Cleared');
  });

  it('standing at a Door for doorSeconds takes it: after the fade, the Hall behind it on its Arena', () => {
    const start = clear(run({ humans: 2, players: [0, 1] })).m;
    const graph = floorGraph(tuning.dungeon, runSeed(ARENA), 1, 'greybox');
    const exit = graph[0]![0]!.exits.length - 1;
    const before = holdAt(start, allAt([0, 1], exit), NEED - 1);
    expect(before.m.run!.doorTicks[exit]).toBe(NEED - 1);
    expect(before.m.run!.phase).toBe('Cleared');
    const taken = holdAt(before.m, allAt([0, 1], exit), 1);
    const to = { floor: 1, row: 1, index: graph[0]![0]!.exits[exit]! };
    expect(taken.events).toContainEqual({ type: 'DoorTaken', exit, to });
    expect(taken.m.run!.phase).toBe('Leaving');
    expect(takenExit(taken.m.run!, tuning)).toBe(exit);
    expect(taken.m.nextDuelTick).toBe(taken.m.tick + FADE);
    // The fade: the Duel goes on, nothing counts, then the next Hall.
    const next = holdAt(taken.m, new Map(), FADE);
    expect(next.events).toContainEqual({ type: 'DuelStart', duelNumber: 2 });
    expect(next.m.run).toMatchObject({ floor: 1, row: 1, hall: to.index, phase: 'Fighting', path: [{ floor: 1, row: 0, index: 0 }, to] });
    expect(next.m.arena).toBe(graph[1]![to.index]!.arena);
    expect(next.m.duel).toMatchObject({ arena: next.m.arena, tick: 0, hall: { ...to, kind: graph[1]![to.index]!.kind, phase: 'Fighting' } });
    expect(next.m.nextDuelTick).toBeNull();
  });

  it('one Player out of the zone resets the count', () => {
    const start = clear(run({ humans: 2, players: [0, 1] })).m;
    const most = holdAt(start, allAt([0, 1], 0), NEED - 5).m;
    expect(most.run!.doorTicks[0]).toBe(NEED - 5);
    const out = holdAt(most, new Map([[0, 0], [1, null]]), 1).m;
    expect(out.run!.doorTicks[0]).toBe(0);
    expect(out.run!.phase).toBe('Cleared');
  });

  it('an AI ally never counts: alone at a Door it takes nothing; the Player alone there does', () => {
    // Fighter 0 the Player, Fighter 1 an AI ally.
    const start = clear(run()).m;
    const ally = holdAt(start, new Map([[0, null], [1, 0]]), NEED + 5).m;
    expect(ally.run!.doorTicks[0]).toBe(0);
    expect(ally.run!.phase).toBe('Cleared');
    const player = holdAt(start, new Map([[0, 0], [1, null]]), NEED);
    expect(player.m.run!.phase).toBe('Leaving');
  });

  it('a fallen Player need not stand there; with no Player left, the AI allies lead', () => {
    const fell = clear(run({ humans: 2, players: [0, 1] }, 3), (f, i) => (i === 1 ? 0 : f.hp)).m;
    expect(fell.duel.fighters[1]!.death).toBeDefined();
    expect(holdAt(fell, allAt([0], 0), NEED).m.run!.phase).toBe('Leaving');
    const alone = clear(run({}, 2), (f, i) => (i === 0 ? 0 : f.hp)).m;
    expect(alone.status.status).toBe('InProgress');
    expect(holdAt(alone, allAt([1], 0), NEED).m.run!.phase).toBe('Leaving');
  });

  it('carries HP into the next Hall, brings a fallen teammate back at revive of max HP, and refills daggers', () => {
    let m = run({ humans: 2, players: [0, 1] });
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, daggers: 1 } : f)) } };
    const next = advance(m, 0, [0], (_, i) => (i === 0 ? 50 : 0)).m;
    const [a, b] = next.duel.fighters;
    expect(a!.hp).toBe(50);
    expect(b!.hp).toBe(revive * MAX);
    expect(b!.death).toBeUndefined();
    expect([a!.daggers, b!.daggers]).toEqual([tuning.dagger.count, tuning.dagger.count]);
    // The generator carries on from Hall to Hall.
    expect(next.duel.rng).not.toEqual(run().duel.rng);
  });

  it('a Rest Hall is cleared at once, and its fire heals each Player once, never an AI ally', () => {
    const graph = floorGraph(tuning.dungeon, runSeed(ARENA), 1, 'greybox');
    const restAt = graph[3]!.findIndex((h) => h.kind === 'Rest');
    let m = run({ humans: 2, players: [0, 2] }, 3);
    for (const exit of routeTo(graph, 3, restAt)) m = advance(m, exit).m;
    expect(m.duel.hall).toMatchObject({ row: 3, index: restAt, kind: 'Rest' });
    expect(m.duel.fighters.slice(3).every((f) => f.benched)).toBe(true);
    const hurt = withHp(m, () => 40);
    const first = stepMatch(hurt, idle(hurt), tuning);
    expect(first.events).toContainEqual({ type: 'HallCleared', floor: 1, row: 3, index: restAt, kind: 'Rest' });
    // All three at the fire, a while.
    const fire = holdAt(first, allAt([0, 1, 2], null), 30);
    expect(atRestFire(arenaOf(tuning, fire.m.arena), fire.m.duel.fighters[0]!)).toBe(true);
    expect(fire.events.filter((e) => e.type === 'Rested')).toEqual([
      { type: 'Rested', fighter: 0, healed: restHeal * MAX },
      { type: 'Rested', fighter: 2, healed: restHeal * MAX },
    ]);
    expect(fire.m.duel.fighters.slice(0, 3).map((f) => f.hp)).toEqual([40 + restHeal * MAX, 40, 40 + restHeal * MAX]);
    expect(fire.m.run!.rested).toEqual([0, 2]);
    // The rested go on with what they have: the next Hall starts with it.
    expect(advance(fire.m, 0).m.duel.fighters[0]!.hp).toBe(40 + restHeal * MAX);
  });

  it('a Treasure or Rest Hall stands empty: every Team 1 slot Benched', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const graph = floorGraph(tuning.dungeon, seed, 1, 'greybox');
      for (const [row, halls] of graph.entries())
        for (const [index, hall] of halls.entries())
          if (hall.kind === 'Treasure' || hall.kind === 'Rest') expect(hallRoster(tuning, { arena: `gen:greybox:${seed}`, humans: 1 }, { floor: 1, row, index })).toEqual([null, null, null, null]);
    }
  });

  it('the Boss Hall leads to the next Floor\'s entrance, everyone at full HP, the fallen too', () => {
    const graph = floorGraph(tuning.dungeon, runSeed(ARENA), 1, 'greybox');
    let m = run({}, 2);
    for (const exit of routeTo(graph, 4, 0)) m = advance(m, exit).m;
    expect(m.duel.hall).toMatchObject({ floor: 1, row: 4, kind: 'Boss' });
    const { m: next, events } = advance(m, 0, [0], (_, i) => (i === 0 ? 10 : 0));
    expect(events).toContainEqual({ type: 'HallCleared', floor: 1, row: 4, index: 0, kind: 'Boss' });
    expect(next.run).toMatchObject({ floor: 2, row: 0, hall: 0, phase: 'Fighting' });
    expect(next.run!.path).toHaveLength(6);
    expect(next.arena).toBe(floorGraph(tuning.dungeon, runSeed(ARENA), 2, 'greybox')[0]![0]!.arena);
    expect(next.duel.fighters.slice(0, 2).map((f) => f.hp)).toEqual([MAX, MAX]);
  });
});

/** A hand-built Dungeon: `floors` Floors of one Hall a row, every Hall one Fight against `enemy`. */
function straight(floors: number, enemy: DungeonEncounter = { enemies: [{ difficulty: 'Beginner', weapon: 'Arming Sword', hpScale: 1 }] }): TuningData {
  const floor = { rows: [1, 1, 1], weights: { Fight: 1, Elite: 0, Treasure: 0 }, encounters: { Fight: [enemy], Elite: [] }, boss: enemy };
  const dungeon: DungeonTuning = { ...tuning.dungeon, floors: Array.from({ length: floors }, () => floor) };
  return { ...tuning, dungeon };
}

describe('Dungeon Run: the end', { timeout: 60_000 }, () => {
  it('is a Defeat when Team 0 is wiped out, in any phase', () => {
    const m = run();
    const over = stepMatch(withHp(m, (f) => (f.team === 0 ? 0 : f.hp)), idle(m), tuning);
    expect(over.status).toMatchObject({ status: 'Over', winner: 1 });
    expect(runEnd(over.events)).toEqual([{ type: 'RunEnd', winner: 1, cleared: 0, floors: 3, halls: 0 }]);
    // A draw (the last of both Teams on one Tick) is a Defeat too, and so is a wipe after the Hall was cleared.
    expect(stepMatch(withHp(m, () => 0), idle(m), tuning).status).toMatchObject({ status: 'Over', winner: 1 });
    const cleared = clear(m).m;
    const later = stepMatch(withHp(cleared, () => 0), idle(cleared), tuning);
    expect(runEnd(later.events)).toEqual([{ type: 'RunEnd', winner: 1, cleared: 0, floors: 3, halls: 1 }]);
    // Nothing comes after: no next Hall, no Rematch, the Duel over.
    let n = over;
    for (let k = 0; k < 200; k++) n = stepMatch(n, idle(n), tuning);
    expect([n.duelNumber, n.run!.row, n.duel.duel.status]).toEqual([1, 0, 'Over']);
  });

  it('is a Victory when the last Floor\'s Boss falls', () => {
    const t = straight(1);
    let m = createMatch(t, { format: 'Gauntlet', bestOf: 1, arena: ARENA, teams: [0, 1, 1, 1, 1] });
    const step1 = (n: MatchState) => {
      const c = stepMatch(withHp(n, (f) => (f.team === 1 ? 0 : f.hp)), idle(n), t);
      let k = c;
      for (let j = 0; j < NEED + FADE + 5 && k.duelNumber === c.duelNumber; j++) {
        const zone = arenaOf(t, k.arena).doors[1]!.zone;
        k = placed(k, 0, { x: zone.reduce((s, p) => s + p.x, 0) / 4, y: zone[0]!.y, z: zone.reduce((s, p) => s + p.z, 0) / 4 });
        k = stepMatch(k, idle(k), t);
      }
      return k;
    };
    for (let row = 0; row < 4; row++) m = step1(m);
    expect(m.duel.hall).toMatchObject({ floor: 1, row: 4, kind: 'Boss' });
    const over = stepMatch(withHp(m, (f) => (f.team === 1 ? 0 : f.hp)), idle(m), t);
    expect(over.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(over.events).toContainEqual({ type: 'HallCleared', floor: 1, row: 4, index: 0, kind: 'Boss' });
    expect(runEnd(over.events)).toEqual([{ type: 'RunEnd', winner: 0, cleared: 1, floors: 1, halls: 5 }]);
    expect(over.duel.duel).toMatchObject({ status: 'Over', winner: 0 });
    expect(over.nextDuelTick).toBeNull();
  });

  it('a Dungeon of one Floor, one Hall a row, all Fights, plays like a v1 Run: a line of Duels, HP carried, the last one won', () => {
    const t = straight(1);
    const graph = floorGraph(t.dungeon, runSeed(ARENA), 1, 'greybox');
    expect(graph.map((row) => row.map((h) => [h.kind, h.exits]))).toEqual([[['Fight', [0]]], [['Fight', [0]]], [['Fight', [0]]], [['Fight', [0]]], [['Boss', []]]]);
    // Three Hard AI allies (a Player among them) against one Beginner a Hall: they walk to the Door themselves only with the
    // Hall AI, so here each cleared Hall's party is put in the Door's zone.
    const lineup: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, ...[0, 0].map(() => ({ team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } }) as const), ...[1, 1, 1, 1].map(() => ({ team: 1, pilot: { kind: 'AI', difficulty: 'Floor' } }) as const)];
    let m = createMatch(t, lineupMatch(t, lineup, ['Arming Sword'], { format: 'Gauntlet', bestOf: 1, seed: 5, arena: ARENA }));
    const ais = lineupAis(t, lineup, 'Gauntlet', { arena: ARENA });
    const hp: number[][] = [];
    for (let k = 0; k < 40_000 && m.status.status === 'InProgress'; k++) {
      if (m.run!.phase === 'Cleared') for (const i of [0, 1, 2]) if (inDuel(m.duel.fighters[i]!)) m = placed(m, i, spots(m, 0)[i]!);
      const before = m.duelNumber;
      m = stepMatch(m, m.duel.fighters.map((_, i) => ais[i]?.intent(m.duel, i) ?? IDLE_INTENT), t);
      if (m.duelNumber !== before) hp.push(m.duel.fighters.slice(0, 3).map((f) => f.hp));
    }
    expect(m.status).toMatchObject({ status: 'Over', winner: 0 });
    expect(m.run!.path.map((h) => h.row)).toEqual([0, 1, 2, 3, 4]);
    expect(hp).toHaveLength(4);
    // No heal between Halls: some Fighter carried a wound into a later Hall.
    expect(hp.flat().some((v) => v < MAX)).toBe(true);
  });
});

describe('Dungeon Run: deterministic, and Rollback across a Hall change', { timeout: 60_000 }, () => {
  /** A scripted Run: AI Intents for everyone, the Hall cleared at Tick 100, the party at exit 0 until the next Hall, then 200 more Ticks. */
  function play(): { states: MatchState[]; intents: Intent[][] } {
    const lineup: Lineup = [0, 0, 1, 1, 1, 1].map((team) => ({ team, pilot: team === 0 ? { kind: 'AI', difficulty: 'Hard' } : { kind: 'AI', difficulty: 'Floor' } }));
    const ais = lineupAis(tuning, lineup, 'Gauntlet', { arena: ARENA }) as Controller[];
    let m = run();
    const states = [m];
    const intents: Intent[][] = [];
    let changed = -1;
    for (let k = 0; k < 2000 && (changed < 0 || k < changed + 200); k++) {
      if (k === 100) m = withHp(m, (f) => (f.team === 1 ? 0 : f.hp));
      if (m.run!.phase === 'Cleared') for (const i of [0, 1]) m = placed(m, i, spots(m, 0)[i]!);
      const now = m;
      const these = now.duel.fighters.map((_, i) => ais[i]!.intent(now.duel, i));
      intents.push(these);
      m = stepMatch(m, these, tuning);
      states.push(m);
      if (changed < 0 && m.duelNumber === 2) changed = k;
    }
    return { states, intents };
  }

  it('gives the same hash at every Tick for the same Intents, across a Hall change', () => {
    const one = play();
    const two = play();
    expect(one.states.map((m) => hashValue(m))).toEqual(two.states.map((m) => hashValue(m)));
    expect(one.states.at(-1)!.duelNumber).toBe(2);
  });

  it('re-simulates to the same state from a snapshot taken before the Hall change', () => {
    const { states, intents } = play();
    const change = states.findIndex((m) => m.duelNumber === 2);
    // Snapshots from the fade (the Door taken, nothing put anywhere by the script any more), Rolled back and re-simulated
    // with the same Intents through the change and 200 Ticks of the next Hall.
    for (const back of [change - 1, change - Math.floor(FADE / 2), change - FADE]) {
      expect(states[back]!.run!.phase).toBe('Leaving');
      let m = restore(snapshot(states[back]!));
      for (let k = back; k < states.length - 1; k++) {
        m = stepMatch(m, intents[k]!, tuning);
        expect(hashValue(m)).toBe(hashValue(states[k + 1]!));
      }
    }
  });
});

describe('Dungeon Run: Door zones', () => {
  it('a Fighter at a zone\'s middle stands in it, one off to the side does not', () => {
    const m = run();
    const arena = arenaOf(tuning, m.arena);
    const at = spots(m, 0)[0]!;
    expect(inExitZone(arena, 0, { position: { x: at.x, z: at.z }, y: at.y })).toBe(true);
    expect(inExitZone(arena, 0, { position: { x: at.x, z: at.z }, y: at.y + 5 })).toBe(false);
    expect(inExitZone(arena, 0, { position: { x: at.x + 5, z: at.z + 5 }, y: at.y })).toBe(false);
    // The entrance (Door 0) is not an exit.
    const entrance = arena.doors[0]!.spawns[0]!.position;
    expect([0, 1, 2].some((exit) => inExitZone(arena, exit, { position: { x: entrance.x, z: entrance.z }, y: entrance.y }))).toBe(false);
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
    // In a Hall the Duel goes on once Team 1 has fallen, and ends only when Team 0 does.
    expect(updateDuel(DUEL_FIGHTING, [a!, b!, fell], 5, emit, true)).toBe(DUEL_FIGHTING);
    expect(updateDuel(DUEL_FIGHTING, [{ ...a!, hp: 0, death: { tick: 5, cause: 'Hit', blow: null } }, b!, c!], 5, emit, true)).toEqual({ status: 'Over', winner: 1, tick: 5 });
  });

  it('does not fall: stepping never gives it a Death, whatever its 0 HP', () => {
    const s = scene(2, true);
    const after = step(s, [], tuning);
    expect(after.fighters[1]).toBe(s.fighters[1]);
    expect(after.events.filter((e) => e.type === 'Death')).toEqual([]);
  });
});

describe('Duels are untouched', () => {
  it('a Duels Match has no Run, no Hall, no Benched slot, no players, and every Fighter at fighter.maxHp', () => {
    const m = createMatch(tuning, { bestOf: 3, teams: [0, 0, 1], arena: ARENA });
    expect(m.config.format).toBe('Duels');
    expect(m.run).toBeNull();
    expect('hall' in m.duel).toBe(false);
    expect('players' in m.config).toBe(false);
    expect(m.duel.fighters.every((f) => f.maxHp === MAX && f.hp === MAX && !('benched' in f))).toBe(true);
    expect(m.config.interDuelTicks).toBe(Math.round(tuning.match.interDuelSeconds * 60));
    const after = stepMatch(m, idle(m), tuning);
    expect('hall' in after.duel).toBe(false);
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
    // A Floor AI's memory names the Hall it last saw; an ordinary AI's does not.
    expect(duels[1]!.save!()).not.toHaveProperty('hall');
    expect(gauntlet[1]!.save!()).toHaveProperty('hall', '');
  });
});
