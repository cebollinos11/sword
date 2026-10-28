import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf } from './arena';
import { FLOOR_ROWS, floorGraph } from './dungeon';
import { inDuel } from './duel';
import { exitDoor, hallOf, hallRoster, runPathTo, type HallRef } from './hall';
import { IDLE_INTENT } from './intent';
import { createMatch, doorTicksNeeded, MAX_TEAM_SIZE, runHall, stepMatch, type MatchOptions, type MatchState } from './match';
import { secondsToTicks } from './constants';

const tuning = loadTuningData();
const ARENA = 'gen:greybox:4242';
const LEAVE = doorTicksNeeded(tuning) + secondsToTicks(tuning.dungeon.hallFadeSeconds) + 5;

const run = (options: Partial<MatchOptions> = {}): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)], ...options });

/** Walk the Run on to the next Hall through exit `exit`: every enemy felled (Team 0 at full HP), the Player held in the exit's zone. */
function walk(m: MatchState, exit: number): MatchState {
  const full = (s: MatchState): MatchState => ({
    ...s,
    duel: { ...s.duel, fighters: s.duel.fighters.map((f) => (inDuel(f) ? { ...f, hp: f.team === 1 ? 0 : f.maxHp } : f)) },
  });
  if (m.run!.phase === 'Fighting') m = stepMatch(full(m), m.duel.fighters.map(() => IDLE_INTENT), tuning);
  const hall = m.duelNumber;
  for (let k = 0; k < LEAVE && m.duelNumber === hall; k++) {
    const zone = arenaOf(tuning, m.arena).doors[exitDoor(exit)]!.zone;
    const c = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    const fighters = m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: c, y: zone[0]!.y } : f));
    m = stepMatch({ ...m, duel: { ...m.duel, fighters } }, m.duel.fighters.map(() => IDLE_INTENT), tuning);
  }
  if (m.duelNumber === hall) throw new Error('never left the Hall');
  return m;
}

/** The parts of a Hall's Duel a dev start must match: its Arena, its Hall, and every Fighter's Weapon, HP and spawn. */
const hallDuelOf = (m: MatchState) => ({
  arena: m.arena,
  hall: m.duel.hall,
  encounter: hallOf(tuning, m.config.arena, runHall(m.run!)).encounter,
  fighters: m.duel.fighters.map((f) => ({ weapon: f.weapon, hp: f.hp, maxHp: f.maxHp, benched: f.benched === true, position: f.position, y: f.y })),
});

describe('Dev start: a Run that starts at a chosen Floor and row', () => {
  it('follows the lowest-index exits, across Bosses to the next Floor', () => {
    const path = runPathTo(tuning, ARENA, { floor: 2, row: 3 });
    expect(path).toHaveLength(FLOOR_ROWS + 4);
    expect(path[0]).toEqual({ floor: 1, row: 0, index: 0 });
    expect(path.at(-1)!.floor).toBe(2);
    expect(path.at(-1)!.row).toBe(3);
    for (const [k, at] of path.slice(1).entries()) {
      const before = path[k]!;
      expect(hallOf(tuning, ARENA, before).exits[0]).toBe(at.index);
    }
  });

  it('builds the same Hall Duel as walking there along that path would (same Arena, Encounter, enemy max HP)', () => {
    for (const start of [{ floor: 1, row: 2 }, { floor: 1, row: FLOOR_ROWS - 1 }, { floor: 2, row: 1 }, { floor: 3, row: FLOOR_ROWS - 1 }]) {
      let walked = run();
      while (walked.run!.floor !== start.floor || walked.run!.row !== start.row) walked = walk(walked, 0);
      const dev = run({ start });
      expect(hallDuelOf(dev)).toEqual(hallDuelOf(walked));
      expect(dev.run).toEqual({ ...walked.run!, startTick: 0 });
      expect(dev.duelNumber).toBe(walked.duelNumber);
      expect(dev.score).toEqual(walked.score);
      expect(dev.events).toEqual([{ type: 'DuelStart', duelNumber: walked.duelNumber }]);
      const roster = hallRoster(tuning, dev.config, runHall(dev.run!));
      expect(dev.duel.fighters.slice(2).map((f) => (f.benched ? null : f.maxHp))).toEqual(roster.map((e) => e?.maxHp ?? null));
    }
  });

  it('starts at a given Hall of the row, reached by the lowest-index route', () => {
    const graph = floorGraph(tuning.dungeon, 4242, 1, 'greybox');
    const index = graph[2]!.length - 1;
    const dev = run({ start: { floor: 1, row: 2, index } });
    const at: HallRef = { floor: 1, row: 2, index };
    expect(runHall(dev.run!)).toEqual(at);
    expect(dev.arena).toBe(graph[2]![index]!.arena);
    expect(dev.run!.path[1]!.index).toBe(graph[0]![0]!.exits.find((i) => graph[1]![i]!.exits.includes(index)));
    let walked = run();
    for (const step of dev.run!.path.slice(1)) {
      walked = walk(walked, hallOf(tuning, ARENA, runHall(walked.run!)).exits.indexOf(step.index));
    }
    expect(hallDuelOf(dev)).toEqual(hallDuelOf(walked));
  });

  it('starts at the first Hall without a start, and refuses one outside the Dungeon or in Duels', () => {
    expect(run({ start: { floor: 1, row: 0 } })).toEqual(run());
    expect(() => run({ start: { floor: 0, row: 0 } })).toThrow(RangeError);
    expect(() => run({ start: { floor: 4, row: 0 } })).toThrow(RangeError);
    expect(() => run({ start: { floor: 1, row: FLOOR_ROWS } })).toThrow(RangeError);
    expect(() => run({ start: { floor: 1, row: 1, index: 9 } })).toThrow(RangeError);
    expect(() => createMatch(tuning, { bestOf: 1, start: { floor: 1, row: 1 } })).toThrow(RangeError);
  });
});
