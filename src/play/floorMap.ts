/**
 * The Floor map screen's layout and key (docs/plans/dungeon.md, Stage 3): pure and render only. It reads the Floor graph
 * (`floorGraph`) and the Run's path and builds positions and marks; `floorMapView.ts` draws them.
 */
import { inDuel, type FighterState, type FloorGraph, type HallRef, type MatchState } from '../sim';
import { gateOpen } from '../sim/delverRun';
import { isRevealed } from '../sim/delver/reveal';
import type { FloorPlan } from '../sim/delver/plan';
import { delverMapMarks, type DelverMapMark, type DelverMapStatus } from '../render/delverMapMarks';
import { minimapHeading } from '../render/minimap';
import type { HallKind } from '../tuning';

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
    if (row >= graph.length - 1) continue;
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
        y: graph.length > 1 ? 1 - row / (graph.length - 1) : 0.5,
        visited: visited.has(k),
        current: row === at.row && index === at.index,
        reachable: reachable.has(k),
      });
      if (row < graph.length - 1) for (const j of hall.exits) edges.push({ from: { row, index }, to: { row: row + 1, index: j }, visited: walked.has(`${k}>${key(row + 1, j)}`) });
    });
  });
  return { floor: at.floor, nodes, edges };
}

/** One revealed Hall or Passage on the Delver Floor Map: a rect in 0 to 1 of a square board (y down). `hall` marks a Hall, `kind` its kind. */
export interface DelverMapRect {
  readonly hall: boolean;
  readonly kind?: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A marker of a revealed Hall, placed on the board. */
export type DelverMapPlaced = DelverMapMark & { readonly bx: number; readonly by: number };

/** A living party Fighter as an arrow on the board: `dx` and `dy` the unit heading (y down). */
export interface DelverMapArrow {
  readonly fighter: number;
  readonly me: boolean;
  readonly bx: number;
  readonly by: number;
  readonly dx: number;
  readonly dy: number;
}

export interface DelverMapLayout {
  readonly rects: readonly DelverMapRect[];
  readonly marks: readonly DelverMapPlaced[];
  readonly arrows: readonly DelverMapArrow[];
}

/** The fewest metres the board spans, so a Floor with one Hall revealed shows a small map that grows, not one Hall filling the board. */
export const DELVER_MAP_MIN_SPAN = 40;
/** The share of the board left empty round the map's edge. */
const BOARD_MARGIN = 0.06;

/**
 * The Delver Floor Map (docs/plans/delver.md, Stage 5): only the Halls and Passages `revealed` holds, scaled to fit a square board and centred
 * (`DELVER_MAP_MIN_SPAN` metres at the least), turned as the Battle's minimap is (up is +z, +x to the left: the way the camera looks at the
 * Floor's start, so the map is the world seen from above, not its mirror). With the markers of the revealed Halls (`delverMapMarks`) and an
 * arrow for each living Team 0 Fighter, Fighter `me` marked. Unrevealed space draws nothing. Pure; the Match is never changed.
 */
export function delverMapLayout(plan: FloorPlan, revealed: readonly number[], fighters: readonly FighterState[], me: number, status: DelverMapStatus): DelverMapLayout {
  const seen: { rect: FloorPlan['halls'][number]['rect']; hall: boolean; kind?: string }[] = [];
  plan.halls.forEach((h, i) => isRevealed(revealed, i) && seen.push({ rect: h.rect, hall: true, kind: h.kind }));
  plan.passages.forEach((p, i) => isRevealed(revealed, plan.halls.length + i) && seen.push({ rect: p.rect, hall: false }));
  if (seen.length === 0) return { rects: [], marks: [], arrows: [] };
  // The map's own axes: mx = -x, my = -z. Its bounds, then a scale and offset that centre them on the board.
  const x0 = Math.min(...seen.map((r) => -r.rect.x1));
  const x1 = Math.max(...seen.map((r) => -r.rect.x0));
  const y0 = Math.min(...seen.map((r) => -r.rect.z1));
  const y1 = Math.max(...seen.map((r) => -r.rect.z0));
  const span = Math.max(x1 - x0, y1 - y0, DELVER_MAP_MIN_SPAN);
  const scale = (1 - 2 * BOARD_MARGIN) / span;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const bx = (x: number) => 0.5 + (-x - cx) * scale;
  const by = (z: number) => 0.5 + (-z - cy) * scale;
  const rects = seen.map((r): DelverMapRect => ({ hall: r.hall, ...(r.kind === undefined ? {} : { kind: r.kind }), x0: bx(r.rect.x1), y0: by(r.rect.z1), x1: bx(r.rect.x0), y1: by(r.rect.z0) }));
  const marks = delverMapMarks(plan, revealed, status, me).map((m): DelverMapPlaced => ({ ...m, bx: bx(m.x), by: by(m.z) }));
  const arrows: DelverMapArrow[] = [];
  fighters.forEach((f, i) => {
    if (f.team !== 0 || !inDuel(f) || f.hp <= 0) return;
    const d = minimapHeading(f.facing);
    arrows.push({ fighter: i, me: i === me, bx: bx(f.position.x), by: by(f.position.z), dx: d.x, dy: d.y });
  });
  return { rects, marks, arrows };
}

/** What a Delver Run's markers depend on, from its Match and the Floor's plan: whether the gate is open, the fires' use and the pickups lying. Pure. */
export function delverMapStatus(match: MatchState, plan: FloorPlan): DelverMapStatus {
  const run = match.delver!;
  return { gateOpen: match.duel.crowd ? gateOpen(plan, match.duel.crowd, run.wiped) : true, restUsed: run.restUsed, pickups: run.pickups };
}
