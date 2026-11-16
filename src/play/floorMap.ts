/**
 * The Floor Map screen's layout and key (docs/plans/delver.md, Stage 5): pure and render only. It reads the Floor's plan and its Reveal and
 * builds positions and marks; `floorMapView.ts` draws them.
 */
import { inDuel, traitorOf, type FighterState, type MatchState } from '../sim';
import { gateOpen } from '../sim/delverRun';
import { fullReveal, isRevealed } from '../sim/delver/reveal';
import type { FloorPlan } from '../sim/delver/plan';
import { delverMapMarks, type DelverMapMark, type DelverMapStatus } from '../render/delverMapMarks';
import { minimapHeading } from '../render/minimap';

/** The key that shows or hides the map, by `KeyboardEvent.code`. */
export const MAP_KEY = 'KeyM';

/** What a key press asks of the map: toggle it, close it (Escape, while open), or nothing (null). */
export function mapKeyAction(code: string, open: boolean): 'toggle' | 'close' | null {
  if (code === MAP_KEY) return 'toggle';
  return code === 'Escape' && open ? 'close' : null;
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
 * The Delver Floor Map (docs/plans/delver.md, Stage 5): only the Halls and Passages `revealed` holds (a Hall as each of its `rects`, so an L or a ring shows its shape and no solid or pillar; a Passage as each of its pieces' rects), scaled to fit a square board and centred
 * (`DELVER_MAP_MIN_SPAN` metres at the least), turned as the Battle's minimap is (up is +z, +x to the left: the way the camera looks at the
 * Floor's start, so the map is the world seen from above, not its mirror). With the markers of the revealed Halls (`delverMapMarks`) and an
 * arrow for each living Team 0 Fighter, Fighter `me` marked. Unrevealed space draws nothing. Pure; the Match is never changed.
 */
export function delverMapLayout(plan: FloorPlan, revealed: readonly number[], fighters: readonly FighterState[], me: number, status: DelverMapStatus): DelverMapLayout {
  const seen: { rect: FloorPlan['halls'][number]['rect']; hall: boolean; kind?: string }[] = [];
  plan.halls.forEach((h, i) => isRevealed(revealed, i) && h.rects.forEach((rect) => seen.push({ rect, hall: true, kind: h.kind })));
  plan.passages.forEach((p, i) => isRevealed(revealed, plan.halls.length + i) && p.pieces.forEach((piece) => seen.push({ rect: piece.rect, hall: false })));
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
    // The party's living Fighters, and a traitor's own (`me` on Team 1, docs/plans/delver.md, Stage 8a).
    if ((f.team !== 0 && i !== me) || !inDuel(f) || f.hp <= 0) return;
    const d = minimapHeading(f.facing);
    arrows.push({ fighter: i, me: i === me, bx: bx(f.position.x), by: by(f.position.z), dx: d.x, dy: d.y });
  });
  return { rects, marks, arrows };
}

/**
 * The Reveal the local view of a Delver Run shows Fighter `me`: the party's (`RunState.revealed`), or for a traitor (`me` in a traitor's slot,
 * docs/plans/delver.md, Stage 8a) the whole Floor, with no fog. Render only.
 */
export function viewReveal(match: MatchState, plan: FloorPlan, me: number): readonly number[] {
  return traitorOf(match.config, me) >= 0 ? fullReveal(plan) : match.delver!.revealed;
}

/** What a Delver Run's markers depend on, from its Match and the Floor's plan: whether the gate is open, the fires' use and the pickups lying. Pure. */
export function delverMapStatus(match: MatchState, plan: FloorPlan): DelverMapStatus {
  const run = match.delver!;
  return { gateOpen: match.duel.crowd ? gateOpen(plan, match.duel.crowd, run.wiped) : true, restUsed: run.restUsed, pickups: run.pickups };
}
