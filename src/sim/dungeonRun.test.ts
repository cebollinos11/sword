import { describe, expect, it } from 'vitest';
import { loadTuningData, type DungeonEncounter, type DungeonTuning, type TuningData } from '../tuning';
import { createAiController, lineupAis, lineupMatch, type Controller, type Lineup } from '../controllers';
import { arenaOf } from './arena';
import { floorGraph, runSeed, type FloorGraph } from './dungeon';
import { inDuel, updateDuel, DUEL_FIGHTING } from './duel';
import { atRestFire, enemyMaxHp, exitDoor, hallOf, hallRoster, inExitZone, restFire } from './hall';
import { hashValue } from './hash';
import { IDLE_INTENT, type Intent } from './intent';
import { createMatch, doorTicksNeeded, MAX_TEAM_SIZE, placeDrop, runHall, stepMatch, takenExit, type MatchEvent, type MatchOptions, type MatchState } from './match';
import { attack, hold, runScript, type Track } from './script';
import { holdInventory, type Inventory } from './inventory';
import { hallDrops, pickupVisibleTo, startPickups } from './pickups';
import { modsOf, NO_MODS, type Mods } from './mods';
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
    expect(m.run).toEqual({ floor: 1, floors: 3, row: 0, hall: 0, path: [{ floor: 1, row: 0, index: 0 }], phase: 'Fighting', doorTicks: graph[0]![0]!.exits.map(() => 0), rested: [], pickups: [], startTick: 0 });
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

  it('lineupAis gives Team 1 ordinary AIs in Duels and Hall AIs in a Gauntlet', () => {
    const lineup: Lineup = [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Hard' } },
    ];
    const duels = lineupAis(tuning, lineup);
    const gauntlet = lineupAis(tuning, lineup, 'Gauntlet');
    expect(duels[0]).toBeNull();
    expect(gauntlet[0]).toBeNull();
    // A Hall AI's memory names the Hall it last saw; an ordinary AI's does not.
    expect(duels[1]!.save!()).not.toHaveProperty('hall');
    expect(gauntlet[1]!.save!()).toHaveProperty('hall', '');
  });
});

describe('Dungeon Run: Mods at a Hall\'s start and on a clear', () => {
  const mods = (m: Partial<Mods>): Mods => ({ ...NO_MODS, ...m });
  /** Two Players, so Fighter 1 holds an inventory too. */
  const two = (options: Partial<MatchOptions> = {}, own = 2): MatchState => run({ humans: 2, players: [0, 1], ...options }, own);
  /** The Match with Player `i` carrying exactly these Relics (names), all equipped, as equips would have left it. */
  const armed = (m: MatchState, i: number, relics: readonly string[]): MatchState => ({
    ...m,
    duel: {
      ...m.duel,
      fighters: m.duel.fighters.map((f, k) => (k === i ? holdInventory(f, { ...f.inventory!, relics, equipped: relics.map((_, s) => s) }, tuning) : f)),
    },
  });

  it('a Hall starts each Player with the Mods of the Relics it has equipped, its max HP recomputed from them, and a fallen one back at `revive` of that max HP', () => {
    const m = armed(armed(two(), 0, ['Vital Charm', 'Dagger Bandolier', 'Whetstone']), 1, ['Vital Charm']);
    const next = advance(m, 0, [0], (_, i) => (i === 0 ? 50 : 0)).m;
    const [a, b] = next.duel.fighters;
    expect(a).toMatchObject({ maxHp: MAX * 1.2, hp: 50, daggers: tuning.dagger.count + 1 });
    expect(a!.mods).toEqual(mods({ maxHp: 0.2, daggers: 1, damage: 1.1 }));
    expect(b!.maxHp).toBe(MAX * 1.2);
    expect(b!.hp).toBe(revive * MAX * 1.2);
    // Fighters nobody gave Relics carry no Mods, and enemies are what their Encounter says.
    expect(next.duel.fighters.filter((f) => f.team === 1 && !f.benched).every((f) => !('mods' in f))).toBe(true);
  });

  it('an AI ally holds no inventory and no Mods, whatever it had', () => {
    const m = run({}, 3);
    expect(m.duel.fighters[1]).toMatchObject({ team: 0 });
    expect(m.duel.fighters.filter((f) => 'inventory' in f).map((f) => m.duel.fighters.indexOf(f))).toEqual([0]);
    const next = advance(m, 0, [0], (_, i) => (i === 0 ? 50 : 100)).m;
    expect(next.duel.fighters.filter((f) => f.team === 0 && ('inventory' in f || 'mods' in f)).length).toBe(1);
  });

  it('an unequipped max HP shrinks the max HP, and HP above it with it, at the next Hall\'s start', () => {
    let m = armed(run({}, 1), 0, ['Vital Charm']);
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: MAX * 1.2 } : f)) } };
    const off = armed(m, 0, []);
    expect(off.duel.fighters[0]).toMatchObject({ maxHp: MAX, hp: MAX });
    expect('mods' in off.duel.fighters[0]!).toBe(false);
    expect(advance(off, 0, [0], (f) => f.hp).m.duel.fighters[0]).toMatchObject({ maxHp: MAX, hp: MAX });
  });

  it('after a Boss every Fighter is at full HP of its Mods\' max HP, a fallen one too', () => {
    const m = armed(run({ start: { floor: 1, row: 4 } }), 0, ['Vital Charm']);
    expect(m.duel.hall).toMatchObject({ row: 4, kind: 'Boss' });
    const next = advance(m, 0, [0], (_, i) => (i === 0 ? 30 : 0)).m;
    expect(next.duel.hall).toMatchObject({ floor: 2, row: 0 });
    expect(next.duel.fighters[0]).toMatchObject({ maxHp: MAX * 1.2, hp: MAX * 1.2 });
    expect(next.duel.fighters[1]).toMatchObject({ maxHp: MAX, hp: MAX });
  });

  it('a Clear heals each living Team 0 Fighter by healOnClear of its max HP, never above it, and nobody else', () => {
    let m = armed(armed(two({}, 3), 0, ['Victory Wreath']), 1, ['Victory Wreath', 'Vital Charm']);
    m = withHp(m, (_, i) => [40, 110, 0, 0, 0, 0][i] ?? 0);
    const cleared = clear(m, (_, i) => [40, 110, 0][i]!);
    expect(cleared.events).toContainEqual({ type: 'HallCleared', floor: 1, row: 0, index: 0, kind: 'Fight' });
    const hps = cleared.m.duel.fighters.slice(0, 3).map((f) => f.hp);
    // 40 + 15 % of 100; 110 + 15 % of 120 capped at 120; an AI ally that fell stays down.
    expect(hps[0]).toBeCloseTo(40 + 0.15 * MAX, 9);
    expect(hps[1]).toBe(MAX * 1.2);
    expect(hps[2]).toBe(0);
    expect(cleared.m.duel.fighters[2]!.death).toBeDefined();
    // It heals once: the next Tick of the Cleared Hall changes nothing.
    expect(stepMatch(cleared.m, idle(cleared.m), tuning).duel.fighters[0]!.hp).toBeCloseTo(40 + 0.15 * MAX, 9);
    // With no Mods a Clear heals nothing.
    expect(clear(run({}, 1), () => 40).m.duel.fighters[0]!.hp).toBe(40);
  });

  it('a Treasure or Rest Hall is cleared at once and heals the same', () => {
    const graph = floorGraph(tuning.dungeon, runSeed(ARENA), 1, 'greybox');
    const restAt = graph[3]!.findIndex((h) => h.kind === 'Rest');
    let m = armed(run({ humans: 1, players: [0] }, 1), 0, ['Victory Wreath']);
    for (const exit of routeTo(graph, 3, restAt)) m = advance(m, exit, [0], (f) => Math.min(f.hp, 30)).m;
    expect(m.duel.hall).toMatchObject({ kind: 'Rest' });
    const hurt = withHp(m, () => 30);
    expect(stepMatch(hurt, idle(hurt), tuning).duel.fighters[0]!.hp).toBeCloseTo(30 + 0.15 * MAX, 9);
  });
});

describe('Dungeon Run: the inventory, and equip and drop as Intent fields', () => {
  const [W0, W1, W2] = Object.keys(tuning.weapons) as [string, string, string];
  /** The Match with Player `i` holding `inv` (its Weapon wielded, its equipped Relics' Mods folded), as a Hall would have left it. */
  const stocked = (m: MatchState, i: number, inv: Partial<Inventory>): MatchState => ({
    ...m,
    duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? holdInventory(f, { ...f.inventory!, ...inv }, tuning) : f)) },
  });
  /** A Cleared Hall with Player 0 holding three Weapons (the first wielded) and these Relics, none equipped. */
  const loaded = (relics: readonly string[] = ['Whetstone', 'Vital Charm', 'Iron Plate', 'Dagger Bandolier']): MatchState =>
    clear(stocked(run({}, 1), 0, { weapons: [W0, W1, W2], relics, weapon: 0, equipped: [] })).m;
  /** One Tick of `m` with Fighter 0's Intent given `intent` (everybody else idle). */
  const act = (m: MatchState, intent: Partial<Intent>): MatchState => stepMatch(m, idle(m).map((i, k) => (k === 0 ? { ...i, ...intent } : i)), tuning);
  const me = (m: MatchState): FighterState => m.duel.fighters[0]!;
  const dropsOf = (m: MatchState) => m.events.filter((e) => e.type === 'ItemDropped');

  it('a Player starts with the Weapon the Lineup chose and nothing else; AI allies, enemies and every Duel hold nothing', () => {
    const m = run({ weapons: [W1, W2] }, 2);
    expect(me(m).inventory).toEqual({ weapons: [W1], relics: [], weapon: 0, equipped: [] });
    expect(me(m).weapon).toBe(W1);
    expect(m.duel.fighters.slice(1).every((f) => !('inventory' in f) && !('mods' in f))).toBe(true);
    const duels = createMatch(tuning, { bestOf: 3, seed: 1 });
    expect(JSON.stringify(duels.duel.fighters)).not.toContain('inventory');
  });

  it('is refused while an enemy lives: nothing changes, and nothing is dropped', () => {
    const m = stocked(run({}, 1), 0, { weapons: [W0, W1], relics: ['Whetstone'], weapon: 0, equipped: [] });
    expect(m.run!.phase).toBe('Fighting');
    for (const intent of [{ equip: { kind: 'weapon', slot: 1 } }, { equip: { kind: 'relic', slot: 0 } }, { drop: { kind: 'weapon', slot: 1 } }, { drop: { kind: 'relic', slot: 0 } }] as const) {
      const next = act(m, intent);
      expect(next.run!.phase).toBe('Fighting');
      expect(me(next).inventory).toEqual(me(m).inventory);
      expect(me(next).weapon).toBe(W0);
      expect(dropsOf(next)).toEqual([]);
    }
  });

  it('is refused mid-Action, in the air, once the party is Leaving, and for a fallen Fighter', () => {
    const m = loaded();
    // Mid-Action: a Kick winding up.
    const kicking = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === 0 ? { ...f, action: { kind: 'Kick', phase: 'Wind-up', landed: false } as const } : f)) } };
    expect(me(act(kicking, { equip: { kind: 'weapon', slot: 1 } })).weapon).toBe(W0);
    expect(me(act(kicking, { equip: { kind: 'relic', slot: 0 } })).inventory!.equipped).toEqual([]);
    expect(dropsOf(act(kicking, { drop: { kind: 'relic', slot: 0 } }))).toEqual([]);
    expect(me(act(kicking, { drop: { kind: 'relic', slot: 0 } })).inventory!.relics).toHaveLength(4);
    // In the air.
    const jumping = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === 0 ? { ...f, air: { vx: 0, vz: 0, vy: 1, peakY: f.y, ticks: 1, jumped: true } } : f)) } };
    expect(me(act(jumping, { equip: { kind: 'relic', slot: 0 } })).inventory!.equipped).toEqual([]);
    // Leaving: the Door was taken.
    const leaving = holdAt(m, allAt([0], 0), NEED).m;
    expect(leaving.run!.phase).toBe('Leaving');
    expect(me(act(leaving, { equip: { kind: 'weapon', slot: 1 } })).weapon).toBe(W0);
    // Fallen: it keeps what it held, and cannot change it.
    const fell = stepMatch(withHp(m, (f, i) => (i === 0 ? 0 : f.hp)), idle(m), tuning);
    expect(me(fell).death).toBeDefined();
    expect(me(act(fell, { equip: { kind: 'weapon', slot: 1 } })).weapon).toBe(W0);
    expect(me(fell).inventory).toEqual(me(m).inventory);
  });

  it('a Cleared Hall takes an equip on the Tick it is cleared, and a Hall with no Encounter on its first', () => {
    const m = stocked(run({}, 1), 0, { weapons: [W0, W1], relics: [], weapon: 0, equipped: [] });
    const fell = stepMatch(withHp(m, (f) => (f.team === 1 ? 0 : f.hp)), idle(m).map((i, k) => (k === 0 ? { ...i, equip: { kind: 'weapon', slot: 1 } } : i)), tuning);
    expect(fell.run!.phase).toBe('Cleared');
    expect(me(fell)).toMatchObject({ weapon: W1, inventory: { weapon: 1 } });
    const graph = floorGraph(tuning.dungeon, runSeed(ARENA), 1, 'greybox');
    const restAt = graph[3]!.findIndex((h) => h.kind === 'Rest');
    let r = run({ humans: 1, players: [0] }, 1);
    for (const exit of routeTo(graph, 3, restAt)) r = advance(r, exit).m;
    expect(r.duel.hall).toMatchObject({ kind: 'Rest', phase: 'Fighting' });
    const swapped = act(stocked(r, 0, { weapons: [W0, W1], weapon: 0 }), { equip: { kind: 'weapon', slot: 1 } });
    expect(me(swapped).weapon).toBe(W1);
  });

  it('equipping a Relic changes its number, and unequipping restores it', () => {
    let m = loaded();
    const before = me(m);
    expect('mods' in before).toBe(false);
    m = act(m, { equip: { kind: 'relic', slot: 0 } });
    expect(me(m).inventory!.equipped).toEqual([0]);
    expect(me(m).mods).toEqual({ ...NO_MODS, damage: 1.1 });
    m = act(m, { equip: { kind: 'relic', slot: 1 } });
    expect(me(m)).toMatchObject({ maxHp: MAX * 1.2, hp: before.hp });
    m = act(m, { equip: { kind: 'relic', slot: 3 } });
    expect(me(m).mods).toEqual({ ...NO_MODS, damage: 1.1, maxHp: 0.2, daggers: 1 });
    expect(me(m).daggers).toBe(tuning.dagger.count + 1);
    // Three are equipped, and the Iron Plate in slot 2 does not fit.
    expect(me(act(m, { equip: { kind: 'relic', slot: 2 } })).inventory!.equipped).toEqual([0, 1, 3]);
    // Taking each off restores what it changed, and with none equipped Mods are absent again.
    for (const slot of [0, 1, 3]) m = act(m, { equip: { kind: 'relic', slot } });
    expect(me(m).inventory!.equipped).toEqual([]);
    expect('mods' in me(m)).toBe(false);
    expect(me(m)).toMatchObject({ maxHp: MAX, hp: before.hp, daggers: tuning.dagger.count });
  });

  it('refuses a slot with no item, a Weapon already wielded, and a malformed slot', () => {
    const m = loaded();
    for (const intent of [
      { equip: { kind: 'relic', slot: 4 } },
      { equip: { kind: 'relic', slot: -1 } },
      { equip: { kind: 'relic', slot: 0.5 } },
      { equip: { kind: 'weapon', slot: 3 } },
      { equip: { kind: 'weapon', slot: 0 } },
      { drop: { kind: 'weapon', slot: 0 } },
      { drop: { kind: 'weapon', slot: 3 } },
      { drop: { kind: 'relic', slot: 9 } },
    ] as const) {
      const next = act(m, intent);
      expect(me(next).inventory, JSON.stringify(intent)).toEqual(me(m).inventory);
      expect(me(next).weapon).toBe(W0);
      expect(dropsOf(next)).toEqual([]);
    }
  });

  it("a Weapon swap in a Cleared Hall: the next Hall's Duel uses the new Weapon, and the inventory comes along", () => {
    let m = loaded();
    const tip = me(m).blade.tip;
    m = act(m, { equip: { kind: 'weapon', slot: 2 } });
    expect(me(m)).toMatchObject({ weapon: W2, inventory: { weapon: 2 } });
    // The pose follows the Weapon at once.
    expect(me(m).blade.tip).not.toEqual(tip);
    const next = advance(m, 0).m;
    expect(next.duelNumber).toBe(m.duelNumber + 1);
    expect(me(next)).toMatchObject({ weapon: W2, inventory: { weapons: [W0, W1, W2], weapon: 2 } });
  });

  it('a Relic equipped carries its Mods into the next Hall, derived again from the inventory', () => {
    const next = advance(act(loaded(), { equip: { kind: 'relic', slot: 1 } }), 0).m;
    expect(me(next)).toMatchObject({ maxHp: MAX * 1.2, inventory: { equipped: [1] }, mods: { maxHp: 0.2 } });
    expect(me(next).hp).toBe(MAX);
  });

  it('a drop removes the item, reports it where the Fighter stands, and hands it to the one seam', () => {
    const m = act(loaded(), { equip: { kind: 'relic', slot: 1 } });
    const at = { x: me(m).position.x, y: me(m).y, z: me(m).position.z };
    // Dropping the Whetstone in slot 0 closes the slots up: the equipped Vital Charm is slot 0 now.
    const dropped = act(m, { drop: { kind: 'relic', slot: 0 } });
    expect(dropped.events).toContainEqual({ type: 'ItemDropped', fighter: 0, kind: 'relic', item: 'Whetstone', at });
    expect(me(dropped).inventory).toEqual({ weapons: [W0, W1, W2], relics: ['Vital Charm', 'Iron Plate', 'Dagger Bandolier'], weapon: 0, equipped: [0] });
    expect(me(dropped).maxHp).toBe(MAX * 1.2);
    // Dropping an equipped Relic takes it off.
    const off = act(dropped, { drop: { kind: 'relic', slot: 0 } });
    expect(off.events).toContainEqual({ type: 'ItemDropped', fighter: 0, kind: 'relic', item: 'Vital Charm', at });
    expect(me(off)).toMatchObject({ maxHp: MAX, inventory: { equipped: [] } });
    expect('mods' in me(off)).toBe(false);
    // A carried Weapon below the wielded one closes up, and the wielded one stays wielded.
    const wielded = act(act(m, { equip: { kind: 'weapon', slot: 2 } }), { drop: { kind: 'weapon', slot: 0 } });
    expect(wielded.events).toContainEqual({ type: 'ItemDropped', fighter: 0, kind: 'weapon', item: W0, at });
    expect(me(wielded)).toMatchObject({ weapon: W2, inventory: { weapons: [W1, W2], weapon: 1 } });
    // `placeDrop` is the seam: a shared pickup at the feet (the Hall's own drop is pickup 0), which `by` bars the dropper from taking back at once.
    const shared = { id: m.run!.pickups.length, owner: null, kind: 'relic', item: 'Whetstone', at, taken: false, by: 0 };
    expect(placeDrop(m.run!, { fighter: 0, kind: 'relic', item: 'Whetstone', at })).toEqual({ ...m.run, pickups: [...m.run!.pickups, shared] });
    expect(dropped.run).toEqual({ ...m.run, pickups: [...m.run!.pickups, shared] });
  });

  it('an equip and a drop in one Intent: the equip first', () => {
    const next = act(loaded(), { equip: { kind: 'relic', slot: 0 }, drop: { kind: 'relic', slot: 0 } });
    expect(me(next).inventory).toMatchObject({ relics: ['Vital Charm', 'Iron Plate', 'Dagger Bandolier'], equipped: [] });
    expect('mods' in me(next)).toBe(false);
  });

  it('a Fighter that falls keeps its inventory, and has it back, revived, in the next Hall', () => {
    let m = stocked(run({ humans: 2, players: [0, 1] }, 2), 1, { weapons: [W0, W2], relics: ['Vital Charm'], weapon: 1, equipped: [0] });
    expect(m.duel.fighters[1]).toMatchObject({ weapon: W2, maxHp: MAX * 1.2 });
    m = clear(m, (f, i) => (i === 1 ? 0 : f.hp)).m;
    const fallen = m.duel.fighters[1]!;
    expect(fallen.death).toBeDefined();
    expect(fallen.inventory).toEqual({ weapons: [W0, W2], relics: ['Vital Charm'], weapon: 1, equipped: [0] });
    const next = advance(m, 0, [0]).m;
    expect(next.duel.fighters[1]).toMatchObject({
      weapon: W2,
      maxHp: MAX * 1.2,
      hp: revive * MAX * 1.2,
      inventory: { weapons: [W0, W2], relics: ['Vital Charm'], weapon: 1, equipped: [0] },
    });
    expect(next.duel.fighters[1]!.death).toBeUndefined();
  });

  it('Rollback over an equip re-simulates to the same state', () => {
    const base = loaded();
    const script = (t: number): Intent[] =>
      idle(base).map((i, k) => {
        if (k !== 0) return i;
        if (t === 3) return { ...i, equip: { kind: 'relic', slot: 1 } };
        if (t === 6) return { ...i, equip: { kind: 'weapon', slot: 1 } };
        return t === 8 ? { ...i, drop: { kind: 'relic', slot: 0 } } : i;
      });
    const play = (from: MatchState, t0: number, to: number): MatchState => {
      let m = from;
      for (let t = t0; t < to; t++) m = stepMatch(m, script(t), tuning);
      return m;
    };
    const early = play(base, 0, 2);
    const snap = snapshot(early);
    const live = play(early, 2, 12);
    expect(me(live).inventory).toEqual({ weapons: [W0, W1, W2], relics: ['Vital Charm', 'Iron Plate', 'Dagger Bandolier'], weapon: 1, equipped: [0] });
    // The snapshot is independent of everything simulated after it, and re-simulating from it gives the same state bit for bit.
    expect(me(restore(snap)).inventory).toEqual(me(early).inventory);
    expect(hashValue(play(restore(snap), 2, 12))).toBe(hashValue(live));
    expect(hashValue(live)).not.toBe(hashValue(play(restore(snap), 2, 3)));
  });
});

describe('Dungeon Run: pickups', () => {
  const [W0, W1] = Object.keys(tuning.weapons) as [string, string];
  const two = { humans: 2, players: [0, 1] };
  const pickupsOf = (m: MatchState) => m.run!.pickups;
  const takenEvents = (m: MatchState) => m.events.filter((e) => e.type === 'ItemTaken');
  const takers = (m: MatchState) => takenEvents(m).map((e) => (e as { fighter: number }).fighter);
  const inv = (m: MatchState, i: number) => m.duel.fighters[i]!.inventory!;
  /** `m` with Fighter `i` standing on pickup `id`. */
  const onPickup = (m: MatchState, i: number, id: number): MatchState => placed(m, i, pickupsOf(m)[id]!.at);
  /** `m` with Fighter `i` far from every pickup (at Door 0's zone). */
  const away = (m: MatchState, i: number): MatchState => placed(m, i, spots(m, 0)[i]!);
  const tick = (m: MatchState): MatchState => stepMatch(m, idle(m), tuning);
  const stocked = (m: MatchState, i: number, patch: Partial<Inventory>): MatchState => ({
    ...m,
    duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, inventory: { ...f.inventory!, ...patch } } : f)) },
  });
  /** `m` with pickup `id` made into `patch`. */
  const edited = (m: MatchState, id: number, patch: object): MatchState => ({ ...m, run: { ...m.run!, pickups: pickupsOf(m).map((p) => (p.id === id ? { ...p, ...patch } : p)) } });
  /** The Run's first Hall with every enemy fallen, the Players at the Door. */
  const cleared = (own = 2, options: Partial<MatchOptions> = two): MatchState => {
    let m = clear(run(options, own)).m;
    for (let i = 0; i < Math.min(own, 2); i++) m = away(m, i);
    return m;
  };
  /** A Run starting in the first Hall of kind `kind` found in the Floor graphs (Floors in order). */
  const startIn = (kind: 'Treasure' | 'Boss', options: Partial<MatchOptions> = two, own = 2): MatchState => {
    for (let floor = 1; floor <= tuning.dungeon.floors.length; floor++) {
      const graph = floorGraph(tuning.dungeon, runSeed(options.arena ?? ARENA), floor, 'greybox');
      for (const [row, halls] of graph.entries()) {
        const index = halls.findIndex((h) => h.kind === kind);
        if (index >= 0) return run({ ...options, start: { floor, row, index } }, own);
      }
    }
    throw new Error(`no ${kind} Hall`);
  };
  /** A Run starting at the Boss of Floor `floor`. */
  const bossOf = (floor: number, options: Partial<MatchOptions> = two, own = 2): MatchState => run({ ...options, start: { floor, row: 4 } }, own);

  it('a cleared Fight Hall drops one item per Player, each its own, on Team 1\'s spawn cell; nothing before it is cleared', () => {
    const m = run(two);
    expect(pickupsOf(m)).toEqual([]);
    expect(pickupsOf(tick(m))).toEqual([]);
    const c = clear(m).m;
    const spawns = arenaOf(tuning, c.arena).spawns.filter((s) => s.team === 1).map((s) => s.position);
    expect(pickupsOf(c)).toHaveLength(2);
    for (const [i, p] of pickupsOf(c).entries()) {
      expect(p).toMatchObject({ id: i, owner: i, taken: false });
      expect(['weapon', 'relic']).toContain(p.kind);
      expect(p.kind === 'weapon' ? Object.keys(tuning.weapons) : tuning.relics.map((r) => r.name)).toContain(p.item);
      expect(spawns).toContainEqual(p.at);
    }
    // Only on the Tick the Hall is cleared: later Ticks add nothing.
    expect(pickupsOf(tick(away(away(c, 0), 1)))).toEqual(pickupsOf(c));
    expect(c.events.map((e) => e.type)).toContain('HallCleared');
  });

  it('a Boss Hall drops two items per Player, on two different spots', () => {
    const m = clear(bossOf(1, { humans: 3, players: [0, 1, 2] }, 3)).m;
    const mine = pickupsOf(m).filter((p) => p.owner === 1);
    expect(pickupsOf(m)).toHaveLength(6);
    expect(mine).toHaveLength(2);
    expect(mine[0]!.at).not.toEqual(mine[1]!.at);
    expect(mine.every((p) => !p.taken)).toBe(true);
  });

  it('a Run seed gives the same pickups every time, another seed others; mostly Relics, sometimes a Weapon', () => {
    const items = (arena: string): string[] =>
      [1, 2, 3].flatMap((floor) => pickupsOf(clear(bossOf(floor, { ...two, arena })).m).map((p) => `${p.owner}:${p.kind}:${p.item}`));
    expect(items(ARENA)).toEqual(items(ARENA));
    const seeds = [100, 101, 102, 103, 104, 105, 200, 201, 202, 203, 204, 205];
    const all = seeds.map((seed) => items(`gen:greybox:${seed}`));
    expect(new Set([...all.map((a) => a.join()), items(ARENA).join()]).size).toBeGreaterThan(8);
    const kinds = all.flat().map((s) => s.split(':')[1]);
    expect(kinds.filter((k) => k === 'relic').length).toBeGreaterThan(kinds.filter((k) => k === 'weapon').length);
    expect(kinds).toContain('weapon');
    // A Player's two drops from one Boss are different items.
    for (const a of all) expect(new Set(a.slice(0, 4)).size).toBe(4);
  });

  it('a replay of the clear and the take hashes the same', () => {
    const play = (m: MatchState): MatchState => tick(onPickup(tick(m), 0, 0));
    const c = cleared();
    expect(hashValue(play(c))).toBe(hashValue(play(c)));
  });

  it('an owned pickup is taken only by its owner: standing on it, the item joins its inventory, and the event says who', () => {
    const c = cleared();
    const p = pickupsOf(c)[0]!;
    expect(p.owner).toBe(0);
    const list = (m: MatchState) => (p.kind === 'weapon' ? inv(m, 0).weapons : inv(m, 0).relics);
    // Player 1 on Player 0's pickup (Player 1's own lies on the same spot, so it takes that, and only that).
    const wrong = tick(onPickup(c, 1, 0));
    expect(pickupsOf(wrong).map((q) => q.taken)).toEqual([false, true]);
    expect(takenEvents(wrong)).toEqual([{ type: 'ItemTaken', fighter: 1, id: 1, kind: pickupsOf(c)[1]!.kind, item: pickupsOf(c)[1]!.item }]);
    // With no pickup of its own there, Player 1 takes nothing at all.
    const alone = { ...c, run: { ...c.run!, pickups: [pickupsOf(c)[0]!] } };
    expect(takenEvents(tick(onPickup(alone, 1, 0)))).toEqual([]);
    expect(inv(tick(onPickup(alone, 1, 0)), 1)).toEqual(inv(c, 1));
    // Player 0 on it: taken.
    const right = tick(onPickup(wrong, 0, 0));
    expect(pickupsOf(right)[0]!.taken).toBe(true);
    expect(takenEvents(right)).toEqual([{ type: 'ItemTaken', fighter: 0, id: 0, kind: p.kind, item: p.item }]);
    expect(list(right)).toEqual([...list(c), p.item]);
    // Taking equips and wields nothing.
    expect(inv(right, 0)).toMatchObject({ weapon: 0, equipped: [] });
    // Taken, it is not taken again.
    expect(takenEvents(tick(onPickup(right, 0, 0)))).toEqual([]);
    expect(list(tick(onPickup(right, 0, 0)))).toEqual(list(right));
  });

  it('only standing on it takes it: near it, and above it, do not', () => {
    const c = cleared();
    const { at } = pickupsOf(c)[0]!;
    expect(takenEvents(tick(placed(c, 0, { x: at.x + 0.4, y: at.y, z: at.z })))).toHaveLength(1);
    expect(takenEvents(tick(placed(c, 0, { x: at.x + 0.6, y: at.y, z: at.z })))).toEqual([]);
    expect(takenEvents(tick(placed(c, 0, { x: at.x, y: at.y + 3, z: at.z })))).toEqual([]);
  });

  it('is taken in a Cleared Hall only: not while an enemy lives, not once the party is Leaving', () => {
    const c = cleared();
    const fighting = { ...run(two), run: { ...run(two).run!, pickups: [pickupsOf(c)[0]!] } };
    expect(fighting.run!.phase).toBe('Fighting');
    expect(takenEvents(tick(onPickup(fighting, 0, 0)))).toEqual([]);
    const leaving = holdAt(c, allAt([0, 1], 0), NEED).m;
    expect(leaving.run!.phase).toBe('Leaving');
    expect(takenEvents(tick(onPickup(leaving, 0, 0)))).toEqual([]);
  });

  it('a fallen Player takes nothing', () => {
    const c = cleared();
    const fell = stepMatch(withHp(c, (f, i) => (i === 0 ? 0 : f.hp)), idle(c), tuning);
    expect(fell.duel.fighters[0]!.death).toBeDefined();
    expect(takenEvents(tick(onPickup(fell, 0, 0)))).toEqual([]);
  });

  it('a shared drop is taken by any Player, but its dropper only after stepping off it', () => {
    let m = away(stocked(cleared(), 0, { weapons: [W0, W1], relics: ['Whetstone'], weapon: 0, equipped: [] }), 0);
    const feet = { x: m.duel.fighters[0]!.position.x, y: m.duel.fighters[0]!.y, z: m.duel.fighters[0]!.position.z };
    // The Player drops its carried Weapon at its feet.
    m = stepMatch(m, idle(m).map((i, k) => (k === 0 ? { ...i, drop: { kind: 'weapon', slot: 1 } } : i)), tuning);
    const id = pickupsOf(m).findIndex((p) => p.owner === null);
    expect(pickupsOf(m)[id]).toEqual({ id, owner: null, kind: 'weapon', item: W1, at: feet, taken: false, by: 0 });
    expect(inv(m, 0).weapons).toEqual([W0]);
    // Standing on it, the dropper does not take it back, Tick after Tick.
    for (let k = 0; k < 3; k++) m = tick(m);
    expect(pickupsOf(m)[id]!.taken).toBe(false);
    expect(inv(m, 0).weapons).toEqual([W0]);
    // Player 1 takes it, as any Player may.
    const taken = tick(onPickup(m, 1, id));
    expect(takenEvents(taken)).toEqual([{ type: 'ItemTaken', fighter: 1, id, kind: 'weapon', item: W1 }]);
    expect(inv(taken, 1).weapons).toEqual([...inv(m, 1).weapons, W1]);
    // Otherwise the dropper steps off it (its `by` is spent), and takes it back by stepping on again.
    const off = tick(placed(m, 0, { x: feet.x + 2, y: feet.y, z: feet.z }));
    expect(pickupsOf(off)[id]).not.toHaveProperty('by');
    expect(inv(tick(placed(off, 0, feet)), 0).weapons).toEqual([W0, W1]);
  });

  it('two Players on one shared pickup: the lower Fighter takes it; its dropper never, while on it', () => {
    const m = cleared();
    const shared = { ...m, run: { ...m.run!, pickups: [{ id: 0, owner: null, kind: 'weapon' as const, item: W1, at: pickupsOf(m)[0]!.at, taken: false }] } };
    expect(takers(tick(onPickup(onPickup(shared, 1, 0), 0, 0)))).toEqual([0]);
    const dropped = edited(shared, 0, { by: 0 });
    expect(takers(tick(onPickup(onPickup(dropped, 1, 0), 0, 0)))).toEqual([1]);
  });

  it('a full inventory leaves the pickup lying, and it is taken once there is room', () => {
    // Player 0's pickup 0 a Weapon, and its three Weapon slots full.
    const m = stocked(edited(cleared(), 0, { kind: 'weapon', item: W1 }), 0, { weapons: [W0, W0, W0], weapon: 0 });
    const full = tick(onPickup(m, 0, 0));
    expect(pickupsOf(full)[0]!.taken).toBe(false);
    expect(takenEvents(full)).toEqual([]);
    expect(inv(full, 0).weapons).toEqual([W0, W0, W0]);
    // The two lists are full separately: a Relic still fits.
    expect(inv(tick(onPickup(edited(m, 0, { kind: 'relic', item: 'Whetstone' }), 0, 0)), 0).relics).toEqual(['Whetstone']);
    // Room made by a drop (the dropped Weapon lies 0.5 m or more from the pickup), then back on the pickup.
    const room = stepMatch(away(full, 0), idle(full).map((i, k) => (k === 0 ? { ...i, drop: { kind: 'weapon', slot: 2 } } : i)), tuning);
    const taken = tick(onPickup(room, 0, 0));
    expect(pickupsOf(taken)[0]!.taken).toBe(true);
    expect(inv(taken, 0).weapons).toEqual([W0, W0, W1]);
    // Relics: a full list refuses one too.
    const six = Array.from({ length: tuning.dungeon.inventory.relics }, () => 'Whetstone');
    const stuffed = stocked(edited(m, 0, { kind: 'relic', item: 'Iron Plate' }), 0, { relics: six });
    expect(pickupsOf(tick(onPickup(stuffed, 0, 0)))[0]!.taken).toBe(false);
  });

  it('an AI ally standing on any pickup takes nothing, owned or shared, even one that holds an inventory', () => {
    // Fighter 0 is the only Player; Fighter 1 is an AI ally, which holds no inventory.
    const c = cleared(2, { humans: 1, players: [0] });
    expect(pickupsOf(c).map((p) => p.owner)).toEqual([0]);
    expect(c.duel.fighters[1]!.inventory).toBeUndefined();
    const shared = { ...c, run: { ...c.run!, pickups: [...pickupsOf(c), { id: 1, owner: null, kind: 'weapon' as const, item: W1, at: pickupsOf(c)[0]!.at, taken: false }] } };
    for (const id of [0, 1]) {
      const next = tick(onPickup(shared, 1, id));
      expect(takenEvents(next)).toEqual([]);
      expect(pickupsOf(next).every((p) => !p.taken)).toBe(true);
    }
    // Even with an inventory in its hands (it never has one), it is not a Player.
    const armed = { ...shared, duel: { ...shared.duel, fighters: shared.duel.fighters.map((f, i) => (i === 1 ? { ...f, inventory: { weapons: [W0], relics: [], weapon: 0, equipped: [] } } : f)) } };
    const next = tick(onPickup(armed, 1, 1));
    expect(takenEvents(next)).toEqual([]);
    expect(next.duel.fighters[1]!.inventory!.weapons).toEqual([W0]);
  });

  it('the Ally AI decides from the Duel, which holds no pickups: lying or not, the same Intent', () => {
    const lineup: Lineup = [0, 0, 1, 1, 1, 1].map((team, i) => ({ team, pilot: team === 0 && i === 0 ? { kind: 'Player', player: 1 } : { kind: 'AI', difficulty: team === 0 ? 'Hard' : 'Floor' } }));
    const ais = lineupAis(tuning, lineup, 'Gauntlet', { arena: ARENA }) as (Controller | null)[];
    const c = cleared(2, { humans: 1, players: [0] });
    const bare = { ...c, run: { ...c.run!, pickups: [] } };
    expect(pickupsOf(c).length).toBeGreaterThan(0);
    expect(JSON.stringify(c.duel)).not.toContain('pickups');
    expect(ais[1]!.intent(c.duel, 1)).toEqual(ais[1]!.intent(bare.duel, 1));
  });

  it('a Treasure Hall has three pedestals per Player from its first Tick, one group each, on three different spots', () => {
    const m = startIn('Treasure');
    expect(m.duel.hall).toMatchObject({ kind: 'Treasure', phase: 'Fighting' });
    expect(pickupsOf(m)).toHaveLength(6);
    for (const player of [0, 1]) {
      const mine = pickupsOf(m).filter((p) => p.owner === player);
      expect(mine.map((p) => p.group)).toEqual([mine[0]!.id, mine[0]!.id, mine[0]!.id]);
      expect(new Set(mine.map((p) => `${p.at.x},${p.at.z}`)).size).toBe(3);
      expect(new Set(mine.map((p) => `${p.kind}:${p.item}`)).size).toBe(3);
    }
    // Both Players' copies lie on the same three spots.
    expect(pickupsOf(m).filter((p) => p.owner === 0).map((p) => p.at)).toEqual(pickupsOf(m).filter((p) => p.owner === 1).map((p) => p.at));
    // The Hall clears at once and drops nothing more.
    const next = tick(m);
    expect(next.run!.phase).toBe('Cleared');
    expect(pickupsOf(next)).toEqual(pickupsOf(m));
  });

  it('a Treasure Hall gives each Player one of three: taking one closes the other two, for that Player only', () => {
    let m = tick(startIn('Treasure'));
    const [a, b] = pickupsOf(m).filter((p) => p.owner === 0);
    const before = inv(m, 0);
    m = tick(onPickup(m, 0, b!.id));
    expect(takenEvents(m)).toEqual([{ type: 'ItemTaken', fighter: 0, id: b!.id, kind: b!.kind, item: b!.item }]);
    expect(pickupsOf(m).filter((p) => p.owner === 0).map((p) => p.taken)).toEqual([true, true, true]);
    expect(pickupsOf(m).filter((p) => p.owner === 1).map((p) => p.taken)).toEqual([false, false, false]);
    // Standing on another of the three takes nothing more.
    const again = tick(onPickup(m, 0, a!.id));
    expect(takenEvents(again)).toEqual([]);
    const count = (i: Inventory) => i.weapons.length + i.relics.length;
    expect(count(inv(again, 0))).toBe(count(before) + 1);
    // Player 1 still has its three, and takes one of them.
    const mineToo = pickupsOf(again).find((p) => p.owner === 1)!;
    const second = tick(onPickup(again, 1, mineToo.id));
    expect(takenEvents(second)).toHaveLength(1);
    expect(pickupsOf(second).filter((p) => p.owner === 1).every((p) => p.taken)).toBe(true);
  });

  it('a Treasure Hall with a full inventory leaves all three lying', () => {
    let m = tick(startIn('Treasure'));
    m = stocked(m, 0, { weapons: [W0, W0, W0], relics: Array.from({ length: tuning.dungeon.inventory.relics }, () => 'Whetstone') });
    for (const p of pickupsOf(m).filter((q) => q.owner === 0)) {
      const next = tick(onPickup(m, 0, p.id));
      expect(takenEvents(next)).toEqual([]);
      expect(pickupsOf(next).filter((q) => q.owner === 0).map((q) => q.taken)).toEqual([false, false, false]);
    }
  });

  it('pickups are gone after a Hall change; the next Hall has its own (a Treasure Hall its pedestals, any other none)', () => {
    const c = cleared();
    expect(pickupsOf(c).length).toBeGreaterThan(0);
    const next = advance(c, 0).m;
    expect(next.duelNumber).toBe(c.duelNumber + 1);
    expect(pickupsOf(next).every((p) => next.duel.hall!.kind === 'Treasure' && p.group !== undefined && p.owner !== null && !p.taken)).toBe(true);
    expect(pickupsOf(next).length).toBe(next.duel.hall!.kind === 'Treasure' ? 6 : 0);
    // The Treasure Hall's own pedestals do not follow the party out, taken or not; ids start from 0 again.
    const treasure = tick(startIn('Treasure'));
    const out = advance(treasure, 0).m;
    expect(pickupsOf(out).every((p) => out.duel.hall!.kind === 'Treasure' && p.group !== undefined)).toBe(true);
    expect(pickupsOf(out)).not.toEqual(pickupsOf(treasure));
    // A drop left lying goes with the Hall: dropped here, never in the next.
    const dropped = stepMatch(away(stocked(c, 0, { weapons: [W0, W1], weapon: 0 }), 0), idle(c).map((i, k) => (k === 0 ? { ...i, drop: { kind: 'weapon', slot: 1 } } : i)), tuning);
    expect(pickupsOf(dropped).some((p) => p.owner === null)).toBe(true);
    expect(pickupsOf(advance(dropped, 0).m).some((p) => p.owner === null)).toBe(false);
  });

  it('what a Player took stays in its inventory across a Hall change', () => {
    const took = tick(onPickup(cleared(), 0, 0));
    const item = pickupsOf(took)[0]!;
    expect(inv(took, 0)[item.kind === 'weapon' ? 'weapons' : 'relics']).toContain(item.item);
    const next = advance(away(took, 0), 0).m;
    expect(next.duel.fighters[0]!.inventory).toEqual(inv(took, 0));
  });

  it('Rollback over a pickup re-simulates to the same state', () => {
    const base = cleared();
    const { at } = pickupsOf(base)[0]!;
    // Player 0 walks onto its pickup (a placement at Tick 4), takes it, drops a Weapon at Tick 7 (refused if it holds one only), steps off at Tick 9.
    const script = (m: MatchState, t: number): MatchState => (t === 4 ? placed(m, 0, at) : t === 9 ? away(m, 0) : m);
    const play = (from: MatchState, t0: number, to: number): MatchState => {
      let m = from;
      for (let t = t0; t < to; t++) m = stepMatch(script(m, t), idle(m).map((i, k) => (k === 0 && t === 7 ? { ...i, drop: { kind: 'relic', slot: 0 } } : i)), tuning);
      return m;
    };
    const early = play(base, 0, 3);
    const snap = snapshot(early);
    const live = play(early, 3, 14);
    expect(pickupsOf(live)[0]!.taken).toBe(true);
    expect(hashValue(restore(snap))).toBe(hashValue(early));
    expect(hashValue(play(restore(snap), 3, 14))).toBe(hashValue(live));
    expect(hashValue(live)).not.toBe(hashValue(play(restore(snap), 3, 4)));
    // A snapshot taken after the take re-simulates to the same state too.
    const mid = play(base, 0, 6);
    expect(pickupsOf(mid)[0]!.taken).toBe(true);
    expect(hashValue(play(restore(snapshot(mid)), 6, 14))).toBe(hashValue(live));
  });

  it('an Elite Hall drops its tuned count per Player plus the Relic its Encounter carries, a Rest Hall nothing', () => {
    // The first Run seed whose Floors hold an Elite Hall, and the Rest Hall of the same Run.
    const where = (kind: string, arena: string) => {
      for (let floor = 1; floor <= 3; floor++) {
        const graph = floorGraph(tuning.dungeon, runSeed(arena), floor, 'greybox');
        for (const [row, halls] of graph.entries()) {
          const index = halls.findIndex((h) => h.kind === kind);
          if (index >= 0) return { at: { floor, row, index }, hall: halls[index]! };
        }
      }
      return null;
    };
    const arena = Array.from({ length: 50 }, (_, k) => `gen:greybox:${4242 + k}`).find((a) => where('Elite', a))!;
    const config = { ...run(two).config, arena };
    const elite = where('Elite', arena)!;
    expect(hallDrops(tuning, config, elite.at, elite.hall, 0).map((p) => p.owner)).toEqual([0, 0, 1, 1]);
    const generous: TuningData = { ...tuning, dungeon: { ...tuning.dungeon, loot: { ...tuning.dungeon.loot, drops: { Fight: 1, Elite: 2, Boss: 2 } } } };
    const drops = hallDrops(generous, config, elite.at, elite.hall, 0);
    expect(drops.map((p) => [p.id, p.owner])).toEqual([[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 1]]);
    expect(hallDrops(generous, config, elite.at, elite.hall, 5).map((p) => p.id)).toEqual([5, 6, 7, 8, 9, 10]);
    const rest = where('Rest', arena)!;
    expect(hallDrops(generous, config, rest.at, rest.hall, 0)).toEqual([]);
    expect(startPickups(generous, config, rest.at, rest.hall)).toEqual([]);
  });

  it('pickupVisibleTo: a Player sees its own and the shared ones, not another\'s, and nothing taken', () => {
    const p = (owner: number | null, taken = false) => ({ owner, taken });
    expect(pickupVisibleTo(p(0), 0)).toBe(true);
    expect(pickupVisibleTo(p(0), 1)).toBe(false);
    expect(pickupVisibleTo(p(null), 1)).toBe(true);
    expect(pickupVisibleTo(p(null, true), 1)).toBe(false);
    expect(pickupVisibleTo(p(0, true), 0)).toBe(false);
  });

  it('Duels are untouched: no Run, no pickups', () => {
    const duels = createMatch(tuning, { bestOf: 3, seed: 1 });
    expect(duels.run).toBeNull();
    expect(JSON.stringify(duels)).not.toContain('pickups');
  });
});

describe('Dungeon Run: Elite enemies carry Relics', { timeout: 60_000 }, () => {
  const foe = (relics?: readonly string[], minTeam?: number) => ({
    difficulty: 'Beginner',
    weapon: 'Arming Sword',
    hpScale: 1,
    ...(relics ? { relics } : {}),
    ...(minTeam ? { minTeam } : {}),
  });
  /** A Dungeon whose Elite Hall's Encounter is `enemies`, and the first Elite Hall of Run ARENA's Floor 1. */
  function elites(enemies: DungeonEncounter['enemies'], drops = tuning.dungeon.loot.drops.Elite) {
    const fight: DungeonEncounter = { enemies: [foe()] };
    const floor = { rows: [3, 3, 3], weights: { Fight: 1, Elite: 1, Treasure: 0 }, encounters: { Fight: [fight], Elite: [{ enemies }] }, boss: fight };
    const t: TuningData = { ...tuning, dungeon: { ...tuning.dungeon, loot: { ...tuning.dungeon.loot, drops: { ...tuning.dungeon.loot.drops, Elite: drops } }, floors: [floor, floor, floor] } };
    const graph = floorGraph(t.dungeon, runSeed(ARENA), 1, 'greybox');
    for (const [row, halls] of graph.entries()) {
      const index = halls.findIndex((h) => h.kind === 'Elite');
      if (index >= 0) return { t, at: { floor: 1, row, index }, hall: halls[index]! };
    }
    throw new Error('no Elite Hall');
  }
  type Elites = ReturnType<typeof elites>;
  /** The Run, started in that Elite Hall with two Players and `own` Fighters on Team 0. */
  const inElite = (e: Elites, own = 2): MatchState => run({ humans: 2, players: [0, 1], start: { floor: e.at.floor, row: e.at.row, index: e.at.index } }, own, e.t);
  const cleared = (e: Elites, m: MatchState): MatchState => {
    const next = stepMatch(withHp(m, (f) => (f.team === 1 ? 0 : f.hp)), idle(m), e.t);
    expect(next.events).toContainEqual({ type: 'HallCleared', floor: 1, row: e.at.row, index: e.at.index, kind: 'Elite' });
    return next;
  };

  it('an Elite starts its Hall with the Mods of its Relics folded and its max HP from them; an enemy with none, and a Hall with none, are as before', () => {
    const e = elites([foe(['Heavy Gauntlet', 'Vital Charm']), foe(), foe(['Glass Cannon', 'Glass Cannon'])]);
    const m = inElite(e, 3);
    const [a, b, c] = m.duel.fighters.slice(3);
    const hp = enemyMaxHp(e.t, 1, 2, e.at.row);
    expect(a!.mods).toEqual({ ...NO_MODS, heavyDamage: 1.3, maxHp: 0.2 });
    expect([a!.maxHp, a!.hp]).toEqual([hp * 1.2, hp * 1.2]);
    expect(a!.inventory).toBeUndefined();
    expect(b!.mods).toBeUndefined();
    expect([b!.maxHp, b!.hp]).toEqual([hp, hp]);
    expect(c!.mods).toEqual({ ...NO_MODS, damage: 1.3 * 1.3, damageTaken: 1.25 * 1.25 });
    // The same Encounter without Relics holds the very same Fighters but for those.
    const bare = inElite(elites([foe(), foe(), foe()]), 3);
    expect(bare.duel.fighters.slice(3, 6).every((f) => !('mods' in f) && f.maxHp === hp)).toBe(true);
    expect(m.duel.fighters.slice(0, 3)).toEqual(bare.duel.fighters.slice(0, 3));
  });

  it('an Elite\'s Mods change its numbers: it deals more, or takes less', () => {
    const e = elites([foe(['Glass Cannon']), foe(['Iron Plate'])]);
    const f = inElite(e).duel.fighters.slice(2);
    expect(modsOf(f[0]!).damage).toBeGreaterThan(1);
    expect(modsOf(f[0]!).damageTaken).toBeGreaterThan(1);
    expect(modsOf(f[1]!).damage).toBe(1);
    expect(modsOf(f[1]!).damageTaken).toBeLessThan(1);
  });

  it('a beaten Elite Hall drops, for each Player, the Relic an Elite carried plus the tuned count more, its own to that Player, on Team 1\'s spawns', () => {
    const e = elites([foe(), foe(['Honed Daggers', 'Steel Boots'])]);
    const m = cleared(e, inElite(e));
    const drops = m.run!.pickups;
    expect(drops.map((p) => p.owner)).toEqual([0, 0, 1, 1]);
    expect(drops[0]).toMatchObject({ id: 0, kind: 'relic', item: 'Honed Daggers', owner: 0, taken: false });
    expect(drops[2]).toMatchObject({ id: 2, kind: 'relic', item: 'Honed Daggers', owner: 1, taken: false });
    // The carried Relic is not picked again for the same Player while others remain.
    for (const k of [1, 3]) expect([drops[k]!.kind, drops[k]!.item]).not.toEqual(['relic', 'Honed Daggers']);
    const spots = arenaOf(e.t, m.arena).spawns.filter((s) => s.team === 1).sort((x, y) => x.slot - y.slot);
    expect(drops.map((p) => [p.at.x, p.at.z])).toEqual([0, 1, 0, 1].map((k) => [spots[k]!.position.x, spots[k]!.position.z]));
    // With no extra item tuned, the Relic is all there is.
    const lone = elites([foe(['Whetstone'])], 0);
    expect(cleared(lone, inElite(lone)).run!.pickups.map((p) => [p.owner, p.item])).toEqual([[0, 'Whetstone'], [1, 'Whetstone']]);
  });

  it('with several Elites carrying Relics, the lowest slot\'s first Relic drops; a Benched or Relic-less enemy does not count', () => {
    const several = elites([foe(), foe(['Iron Plate', 'Whetstone']), foe(['Vital Charm'])], 0);
    expect(cleared(several, inElite(several, 3)).run!.pickups.map((p) => p.item)).toEqual(['Iron Plate', 'Iron Plate']);
    // The enemy in slot 0 sits out a party of two, so the next one in line carries the Relic that drops.
    const benched = elites([foe(['Buckler Rim'], 3), foe(['Victory Wreath']), foe(['Vital Charm'])], 0);
    expect(cleared(benched, inElite(benched, 2)).run!.pickups.map((p) => p.item)).toEqual(['Victory Wreath', 'Victory Wreath']);
    expect(cleared(benched, inElite(benched, 3)).run!.pickups.map((p) => p.item)).toEqual(['Buckler Rim', 'Buckler Rim']);
  });

  it('the drops are the same for the same seed; an Elite Hall with no Relics drops only its tuned count', () => {
    const e = elites([foe(['Whetstone']), foe()]);
    const a = cleared(e, inElite(e)).run!.pickups;
    expect(a).toHaveLength(4);
    expect(cleared(e, inElite(e)).run!.pickups).toEqual(a);
    expect(hallDrops(e.t, inElite(e).config, e.at, e.hall, 0)).toEqual(a);
    const bare = elites([foe(), foe()]);
    expect(cleared(bare, inElite(bare)).run!.pickups.map((p) => p.owner)).toEqual([0, 1]);
  });

  it('a Player takes the dropped Relic by standing on it, as any pickup', () => {
    const e = elites([foe(['Whetstone'])], 0);
    const m = cleared(e, inElite(e));
    const mine = m.run!.pickups.find((p) => p.owner === 0)!;
    const took = stepMatch(placed(m, 0, mine.at), idle(m), e.t);
    expect(took.duel.fighters[0]!.inventory!.relics).toEqual(['Whetstone']);
  });

  it('Rollback over an Elite Hall\'s clear re-simulates to the same state', () => {
    const e = elites([foe(['Whetstone']), foe()]);
    const m = inElite(e);
    const live = cleared(e, m);
    expect(hashValue(cleared(e, restore(snapshot(m))))).toBe(hashValue(live));
    expect(hashValue(restore(snapshot(live)))).toBe(hashValue(live));
  });
});
