import { describe, expect, it } from 'vitest';
import { floorGraph, FLOOR_ROWS, runKit } from '../sim';
import { loadTuningData } from '../tuning';
import { floorMapLayout, MAP_KEY, mapKeyAction } from './floorMap';

const tuning = loadTuningData();
const kit = runKit(tuning, `gen:${Object.keys(tuning.kits)[0]}:1:d2`);
const graph = (seed: number, floor = 1) => floorGraph(tuning.dungeon, seed, floor, kit);
const at = { floor: 1, row: 0, index: 0 };

describe('floorMapLayout', () => {
  it('puts every Hall once, in its row, and every exit as an edge', () => {
    for (const seed of [1, 2, 3, 77]) {
      const g = graph(seed);
      const layout = floorMapLayout(g, [at], at);
      expect(layout.nodes).toHaveLength(g.reduce((n, row) => n + row.length, 0));
      for (const [row, halls] of g.entries()) {
        const nodes = layout.nodes.filter((n) => n.row === row);
        expect(nodes.map((n) => n.index)).toEqual(halls.map((_, i) => i));
        expect(nodes.map((n) => n.kind)).toEqual(halls.map((h) => h.kind));
      }
      const exits = g.flatMap((row, r) => row.flatMap((h, i) => (r === FLOOR_ROWS - 1 ? [] : h.exits.map((j) => `${r}:${i}>${j}`))));
      expect(layout.edges.map((e) => `${e.from.row}:${e.from.index}>${e.to.index}`).sort()).toEqual(exits.sort());
    }
  });

  it('spaces rows evenly (the entrance at the bottom), centres each row and orders ties by index', () => {
    const layout = floorMapLayout(graph(5), [at], at);
    const ys = Array.from({ length: FLOOR_ROWS }, (_, r) => layout.nodes.find((n) => n.row === r)!.y);
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    const gaps = ys.slice(1).map((y, i) => ys[i]! - y);
    gaps.forEach((gap) => expect(gap).toBeCloseTo(gaps[0]!));
    for (let r = 0; r < FLOOR_ROWS; r++) {
      const xs = layout.nodes.filter((n) => n.row === r).map((n) => n.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect((xs[0]! + xs[xs.length - 1]!) / 2).toBeCloseTo(0.5);
    }
  });

  it('marks the path visited, the current Hall, and what is reachable from it', () => {
    const g = graph(9);
    const second = { floor: 1, row: 1, index: g[0]![0]!.exits[0]! };
    const layout = floorMapLayout(g, [at, second], second);
    const node = (r: number, i: number) => layout.nodes.find((n) => n.row === r && n.index === i)!;
    expect(node(0, 0)).toMatchObject({ visited: true, current: false, reachable: false });
    expect(node(1, second.index)).toMatchObject({ visited: true, current: true, reachable: false });
    for (const j of g[1]![second.index]!.exits) expect(node(2, j)).toMatchObject({ visited: false, current: false, reachable: true });
    expect(node(FLOOR_ROWS - 1, 0).reachable).toBe(true);
    expect(layout.nodes.filter((n) => n.visited)).toHaveLength(2);
    const walked = layout.edges.filter((e) => e.visited);
    expect(walked.map((e) => [e.from.row, e.from.index, e.to.row, e.to.index])).toEqual([[0, 0, 1, second.index]]);
  });

  it('lays out a graph of one row (or two) without dividing by zero, by the graph’s own rows', () => {
    const hall = (kind: 'Boss' | 'Fight', exits: number[] = []) => ({ ...graph(1)[0]![0]!, kind, exits });
    const one = floorMapLayout([[hall('Boss')]], [at], at);
    expect(one.nodes).toHaveLength(1);
    expect(Number.isFinite(one.nodes[0]!.y) && one.nodes[0]!.y >= 0 && one.nodes[0]!.y <= 1).toBe(true);
    expect(one.nodes[0]).toMatchObject({ x: 0.5, current: true });
    expect(one.edges).toEqual([]);
    const two = floorMapLayout([[hall('Fight', [0])], [hall('Boss')]], [at], at);
    expect(two.nodes.map((n) => n.y)).toEqual([1, 0]);
    expect(two.nodes.map((n) => n.reachable)).toEqual([false, true]);
    expect(two.edges).toHaveLength(1);
  });

  it('ignores path entries of other Floors', () => {
    const here = { floor: 2, row: 0, index: 0 };
    const layout = floorMapLayout(graph(9, 2), [at, here], here);
    expect(layout.nodes.filter((n) => n.visited)).toHaveLength(1);
    expect(layout.edges.some((e) => e.visited)).toBe(false);
  });

  it('is the same for the same seed', () => {
    expect(floorMapLayout(graph(4), [at], at)).toEqual(floorMapLayout(graph(4), [at], at));
  });
});

describe('mapKeyAction', () => {
  it('toggles on the map key and closes on Escape only while open', () => {
    expect(MAP_KEY).toBe('KeyM');
    expect(mapKeyAction('KeyM', false)).toBe('toggle');
    expect(mapKeyAction('KeyM', true)).toBe('toggle');
    expect(mapKeyAction('Escape', true)).toBe('close');
    expect(mapKeyAction('Escape', false)).toBeNull();
    expect(mapKeyAction('KeyW', true)).toBeNull();
  });
});
