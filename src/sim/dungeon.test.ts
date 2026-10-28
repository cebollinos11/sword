import { describe, expect, it } from 'vitest';
import { loadTuningData, parseDungeon, type DungeonTuning } from '../tuning';
import { ARENA_SEED_RANGE } from './arenaGen/named';
import { floorGraph, hallEncounter, type FloorGraph } from './dungeon';

const tuning = loadTuningData();
const dungeon = tuning.dungeon;
const KIT = 'greybox';
const NAME = /^gen:greybox:(\d+):d(\d)$/;

/** Every Hall of `graph` reached from row 1 by its exits (as [row, index] keys). */
function reached(graph: FloorGraph): Set<string> {
  const seen = new Set(['0,0']);
  for (let r = 0; r < graph.length - 1; r++)
    graph[r]!.forEach((hall, i) => {
      if (seen.has(`${r},${i}`)) for (const e of hall.exits) seen.add(`${r + 1},${e}`);
    });
  return seen;
}

/** Every Hall of `graph` the Boss is reached from (as [row, index] keys). */
function reachesBoss(graph: FloorGraph): Set<string> {
  const last = graph.length - 1;
  const seen = new Set([`${last},0`]);
  for (let r = last - 1; r >= 0; r--)
    graph[r]!.forEach((hall, i) => {
      if (hall.exits.some((e) => seen.has(`${r + 1},${e}`))) seen.add(`${r},${i}`);
    });
  return seen;
}

/** Checks one Floor graph against the plan's shape; returns nothing, throws (via expect) on a breach. */
function checkGraph(d: DungeonTuning, graph: FloorGraph, floor: number): void {
  const f = d.floors[floor - 1]!;
  expect(graph.map((row) => row.length)).toEqual([1, ...f.rows, 1]);
  expect(graph[0]![0]!.kind).toBe('Fight');
  expect(graph[4]![0]!.kind).toBe('Boss');
  expect(graph[1]!.some((h) => h.kind === 'Elite')).toBe(false);
  expect(graph[3]!.filter((h) => h.kind === 'Rest').length).toBe(1);
  for (const r of [1, 2, 3]) for (const h of graph[r]!) expect(h.kind === 'Rest' ? r === 3 : ['Fight', 'Elite', 'Treasure'].includes(h.kind)).toBe(true);
  const total = graph.flat().length;
  expect(reached(graph).size).toBe(total);
  expect(reachesBoss(graph).size).toBe(total);
  graph.forEach((row, r) =>
    row.forEach((hall) => {
      const last = r === graph.length - 1;
      if (!last) {
        expect(hall.exits.length).toBeGreaterThanOrEqual(1);
        expect(hall.exits.length).toBeLessThanOrEqual(3);
        expect([...hall.exits].sort((a, b) => a - b)).toEqual(hall.exits);
        expect(new Set(hall.exits).size).toBe(hall.exits.length);
        for (const e of hall.exits) expect(e >= 0 && e < graph[r + 1]!.length).toBe(true);
      } else {
        // The Boss leads down to the next Floor's row 1; the last Floor's Boss leads nowhere.
        expect(hall.exits).toEqual(floor < d.floors.length ? [0] : []);
      }
      const m = NAME.exec(hall.arena);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThan(ARENA_SEED_RANGE);
      expect(Number(m![2])).toBe(hall.exits.length + 1);
      if (hall.kind === 'Fight') expect(f.encounters.Fight).toContain(hall.encounter);
      else if (hall.kind === 'Elite') expect(f.encounters.Elite).toContain(hall.encounter);
      else if (hall.kind === 'Boss') expect(hall.encounter).toBe(f.boss);
      else expect(hall.encounter).toBeNull();
    }),
  );
}

describe('floorGraph: a Floor of Halls from the Run seed', () => {
  it('is deterministic per seed, and differs between seeds', () => {
    expect(floorGraph(dungeon, 1234, 1, KIT)).toEqual(floorGraph(dungeon, 1234, 1, KIT));
    const graphs = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(floorGraph(dungeon, s, 1, KIT))));
    expect(graphs.size).toBeGreaterThan(15);
    // Floors of one Run differ too.
    expect(floorGraph(dungeon, 1234, 1, KIT)).not.toEqual(floorGraph(dungeon, 1234, 2, KIT));
  });

  it('has 5 rows with the Tuning Data widths, kinds by row, and every Hall reachable', () => {
    for (let floor = 1; floor <= dungeon.floors.length; floor++) checkGraph(dungeon, floorGraph(dungeon, 77, floor, KIT), floor);
  });

  it('names each Arena after its Doors: exits plus the entrance, d1 for the last Boss, d2 for the others', () => {
    const last = dungeon.floors.length;
    expect(floorGraph(dungeon, 5, last, KIT)[4]![0]!.arena).toMatch(/:d1$/);
    expect(floorGraph(dungeon, 5, 1, KIT)[4]![0]!.arena).toMatch(/:d2$/);
    const entrance = floorGraph(dungeon, 5, 1, KIT)[0]![0]!;
    expect(entrance.exits).toEqual(dungeon.floors[0]!.rows[0] === 2 ? [0, 1] : [0, 1, 2]);
    expect(entrance.arena).toMatch(new RegExp(`:d${entrance.exits.length + 1}$`));
    expect(floorGraph(dungeon, 5, 1, 'stone')[0]![0]!.arena).toMatch(/^gen:stone:\d+:d\d$/);
  });

  it('throws on a Floor the Dungeon lacks', () => {
    expect(() => floorGraph(dungeon, 1, 0, KIT)).toThrow(RangeError);
    expect(() => floorGraph(dungeon, 1, dungeon.floors.length + 1, KIT)).toThrow(RangeError);
  });

  it('honours the weights: a Floor weighted only for Fights holds only Fights, a Rest and the Boss', () => {
    const only = parseDungeon(
      { ...JSON.parse(JSON.stringify(dungeon)), floors: [{ ...JSON.parse(JSON.stringify(dungeon.floors[0])), rows: [3, 3, 3], weights: { Fight: 1 } }] },
      Object.keys(tuning.weapons),
      Object.keys(tuning.ai.difficulties),
      Object.keys(tuning.ai.styles),
    );
    for (let seed = 0; seed < 50; seed++) {
      const kinds = floorGraph(only, seed, 1, KIT).flat().map((h) => h.kind);
      expect(kinds.filter((k) => k === 'Fight').length).toBe(9);
      expect(kinds.filter((k) => k !== 'Fight').sort()).toEqual(['Boss', 'Rest']);
    }
  });

  it('picks Encounters from the pool for the kind, avoiding repeats within a Floor where it can', () => {
    for (let seed = 0; seed < 200; seed++)
      for (let floor = 1; floor <= dungeon.floors.length; floor++) {
        const graph = floorGraph(dungeon, seed, floor, KIT);
        const pools = dungeon.floors[floor - 1]!.encounters;
        for (const kind of ['Fight', 'Elite'] as const) {
          const picked = graph.flat().filter((h) => h.kind === kind).map((h) => pools[kind].indexOf(h.encounter!));
          const most = Math.max(0, ...pools[kind].map((_, i) => picked.filter((p) => p === i).length));
          expect(most).toBe(Math.ceil(picked.length / pools[kind].length));
        }
        graph.forEach((row, r) => row.forEach((hall, i) => expect(hallEncounter(dungeon, seed, floor, r, i)).toBe(hall.encounter)));
      }
  });

  it('soak: every seed gives a Floor graph of the plan shape on every Floor', () => {
    const exitCounts = new Map<number, number>();
    const kinds = new Map<string, number>();
    for (let seed = 0; seed < 1000; seed++)
      for (let floor = 1; floor <= dungeon.floors.length; floor++) {
        const graph = floorGraph(dungeon, seed * 7919, floor, KIT);
        checkGraph(dungeon, graph, floor);
        for (const h of graph.slice(1, 4).flat()) {
          exitCounts.set(h.exits.length, (exitCounts.get(h.exits.length) ?? 0) + 1);
          kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
        }
      }
    // Most Halls give a choice of route, and every weighted kind turns up.
    expect(exitCounts.get(2)! + (exitCounts.get(3) ?? 0)).toBeGreaterThan(exitCounts.get(1)!);
    expect(kinds.get('Fight')!).toBeGreaterThan(kinds.get('Elite')!);
    expect(kinds.get('Elite')!).toBeGreaterThan(0);
    expect(kinds.get('Treasure')!).toBeGreaterThan(0);
  });
});
