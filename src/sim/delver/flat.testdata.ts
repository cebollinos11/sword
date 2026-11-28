/**
 * Tests only: Tuning Data whose Floors are flat (docs/plans/delver.md, Stage 6): no Hall levels and no galleries, so a Floor's plan is
 * Stage 5's plus the new fields (every `y` 0) and its compiled map is byte for byte Stage 5's. Delver tests whose expectations are about a
 * flat Floor run on it.
 */
import type { TuningData } from '../../tuning';

/** `tuning` with 1 or 2 Rest Halls on every Floor (no `delver.restEvery`), as before the campfires went to the even Floors. */
export function everyFloorRests(tuning: TuningData): TuningData {
  const { restEvery: _, ...delver } = tuning.delver;
  return { ...tuning, delver: { ...delver, floor: { ...delver.floor, rests: [1, 2] } } };
}

/** `tuning` without `delver.tierRooms` (issue #135): every Floor of every tier has `delver.floor.rooms` Halls, as before it. With `everyFloorRests`. */
export function fullFloors(tuning: TuningData): TuningData {
  const { tierRooms: _, ...delver } = everyFloorRests(tuning).delver;
  return { ...tuning, delver };
}

/** `tuning` without `delver.floor.routeHalls` and `patrolsInLine`: patrols only on loops clear of the in-line Halls, as before the out-and-back routes, so a Floor is the one before them byte for byte. */
export function noRoutes(tuning: TuningData): TuningData {
  const { routeHalls: _, patrolsInLine: __, ...floor } = tuning.delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor } };
}

/** `tuning` with `delver.floor.setPieces.weights.room` 0 and no drawn rooms (docs/plans/delver.md, Stage 7g), the rest unchanged: no room is picked, so a Floor is 7f's byte for byte whatever room files are committed. */
export function noRooms(tuning: TuningData): TuningData {
  const f = noRoutes(tuning).delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, setPieces: { ...f.setPieces, weights: { ...f.setPieces.weights, room: 0 } }, drawnRooms: [] } } };
}

/** `tuning` with `delver.floor.setPieces.percent` [0] (docs/plans/delver.md, Stage 7f), the rest unchanged: no Hall is rolled for a set piece and no pick is made, so a Floor's plan, source and map are 7d's byte for byte. */
export function noSetPieces(tuning: TuningData): TuningData {
  const f = noRooms(tuning).delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, setPieces: { ...f.setPieces, percent: [0] } } } };
}

/** `tuning` with `delver.floor.lava.percent` [0] (docs/plans/delver.md, Stage 7d) and no set pieces (`noSetPieces`), the rest unchanged: no Hall takes lava and no pick is made, so a Floor's plan, source and map are 7c's byte for byte. It does not apply `fullFloors`. */
export function noLava(tuning: TuningData): TuningData {
  const f = noSetPieces(tuning).delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, lava: { ...f.lava, percent: [0] } } } };
}

/** `tuning` with `delver.floor.levels` { max 0, min 1, changePercent 0, galleryPercent 0 }. */
export function flatFloors(tuning: TuningData): TuningData {
  // Stage 7c's splits, pits and daises (and its gallery knobs) go too: a flat Floor has no raised or sunk floor.
  tuning = flatHalls(tuning);
  return { ...tuning, delver: { ...tuning.delver, floor: { ...tuning.delver.floor, levels: { max: 0, min: 1, changePercent: 0, galleryPercent: 0 } } } };
}

/**
 * `tuning` with the Stage 7c knobs off, lava off (`noLava`) and every Floor full length (`fullFloors`) (`galleries.wrapPercent` 0, `galleries.stairPercent` 0, `features.percent` 0 and `features.daisPercent` 0), the rest unchanged: no gallery wraps, none is picked as a stairwell and no Hall takes a split, a pit or a dais, so a Floor's plan, source and map are 7b's byte for byte.
 */
export function flatHalls(tuning: TuningData): TuningData {
  // Every Floor full length too (`fullFloors`), so 7b's pins hold on every Floor.
  tuning = fullFloors(tuning);
  tuning = noLava(tuning);
  const f = tuning.delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, galleries: { ...f.galleries, wrapPercent: 0, stairPercent: 0 }, features: { ...f.features, percent: 0, daisPercent: 0 } } } };
}

/** `tuning` with Stage 6's lattice and the Stage 7a, 7b and 7c knobs off: cols 7, rows 6, rooms 22, gaps [22, 24, 26, 28], halfSize [5, 11], `turnPercent` 0 and no great halls. `flatFloors(flatRooms(t))` is Stage 5's flat Floor. */
export function flatRooms(tuning: TuningData): TuningData {
  const t = flatHalls(tuning);
  return {
    ...t,
    delver: {
      ...t.delver,
      floor: { ...t.delver.floor, cols: 7, rows: 6, rooms: 22, gaps: [22, 24, 26, 28], halfSize: [5, 11], turnPercent: 0, great: { count: [0, 0], half: [12, 16] }, shapes: { ...t.delver.floor.shapes, percent: 0 }, pillars: { ...t.delver.floor.pillars, percent: 0 } },
    },
  };
}

/** `flatHalls(tuning)` with `delver.floor.shapes.percent` and `pillars.percent` 0 (the weights unchanged): every Hall a rect, no gallery wraps, and the plan is 7a's plus the new fields. */
export function plainHalls(tuning: TuningData): TuningData {
  const t = flatHalls(tuning);
  const f = t.delver.floor;
  return { ...t, delver: { ...t.delver, floor: { ...f, shapes: { ...f.shapes, percent: 0 }, pillars: { ...f.pillars, percent: 0 } } } };
}
