/**
 * The Floor map screen's layout and key (docs/plans/dungeon.md, Stage 3): pure and render only. It reads the Floor graph
 * (`floorGraph`) and the Run's path and builds positions and marks; `floorMapView.ts` draws them.
 */
import { FLOOR_ROWS, type FloorGraph, type HallKind, type HallRef } from '../sim';

/** The key that shows or hides the map, by `KeyboardEvent.code`. */
export const MAP_KEY = 'KeyM';

/** What a key press asks of the map: toggle it, close it (Escape, while open), or nothing (null). */
export function mapKeyAction(code: string, open: boolean): 'toggle' | 'close' | null {
  if (code === MAP_KEY) return 'toggle';
  return code === 'Escape' && open ? 'close' : null;
}

/** One Hall on the map. `x` and `y` are in 0 to 1, y down: the entrance row at the bottom, the Boss at the top. */
export interface MapNode {
  readonly row: number;
  readonly index: number;
  readonly kind: HallKind;
  readonly x: number;
  readonly y: number;
  /** The party has entered it (the current Hall too). */
  readonly visited: boolean;
  /** The party is in it. */
  readonly current: boolean;
  /** The party can still get to it from the current Hall by walking through Doors. */
  readonly reachable: boolean;
}

/** One exit Door's way between two Halls of the Floor. */
export interface MapEdge {
  readonly from: { readonly row: number; readonly index: number };
  readonly to: { readonly row: number; readonly index: number };
  /** The party walked it. */
  readonly visited: boolean;
}

export interface FloorMapLayout {
  readonly floor: number;
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
}

/** The most Halls a row holds, which sets the spacing: a full row spans the map's width less a margin. */
const MAX_ROW = 3;
const SPREAD = 0.3;

/**
 * Floor `at.floor`'s map: every Hall of `graph` once, each row's Halls centred and spaced evenly in index order, the rows evenly
 * from the entrance (bottom) up to the Boss, and each exit an edge (the Boss's Door to the next Floor is not drawn). `path` is the
 * Run's (`RunState.path`, any Floor); only the entries of this Floor are marked. Reachable: not the current Hall, and a walk of
 * exits from it leads there.
 */
export function floorMapLayout(graph: FloorGraph, path: readonly HallRef[], at: HallRef): FloorMapLayout {
  const here = path.filter((p) => p.floor === at.floor);
  const key = (row: number, index: number) => row * MAX_ROW + index;
  const visited = new Set(here.map((p) => key(p.row, p.index)));
  const walked = new Set(here.slice(1).map((p, i) => `${key(here[i]!.row, here[i]!.index)}>${key(p.row, p.index)}`));
  const reachable = new Set<number>();
  const open = [key(at.row, at.index)];
  while (open.length) {
    const k = open.pop()!;
    const row = Math.floor(k / MAX_ROW);
    if (row >= FLOOR_ROWS - 1) continue;
    for (const j of graph[row]?.[k % MAX_ROW]?.exits ?? []) {
      const next = key(row + 1, j);
      if (!reachable.has(next)) {
        reachable.add(next);
        open.push(next);
      }
    }
  }
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  graph.forEach((halls, row) => {
    halls.forEach((hall, index) => {
      const k = key(row, index);
      nodes.push({
        row,
        index,
        kind: hall.kind,
        x: 0.5 + (index - (halls.length - 1) / 2) * SPREAD,
        y: 1 - row / (graph.length - 1),
        visited: visited.has(k),
        current: row === at.row && index === at.index,
        reachable: reachable.has(k),
      });
      if (row < graph.length - 1) for (const j of hall.exits) edges.push({ from: { row, index }, to: { row: row + 1, index: j }, visited: walked.has(`${k}>${key(row + 1, j)}`) });
    });
  });
  return { floor: at.floor, nodes, edges };
}
