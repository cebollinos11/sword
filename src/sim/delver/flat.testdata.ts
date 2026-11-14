/**
 * Tests only: Tuning Data whose Floors are flat (docs/plans/delver.md, Stage 6): no Hall levels and no galleries, so a Floor's plan is
 * Stage 5's plus the new fields (every `y` 0) and its compiled map is byte for byte Stage 5's. Delver tests whose expectations are about a
 * flat Floor run on it.
 */
import type { TuningData } from '../../tuning';

/** `tuning` with `delver.floor.levels` { max 0, min 1, changePercent 0, galleryPercent 0 }. */
export function flatFloors(tuning: TuningData): TuningData {
  return { ...tuning, delver: { ...tuning.delver, floor: { ...tuning.delver.floor, levels: { max: 0, min: 1, changePercent: 0, galleryPercent: 0 } } } };
}

/**
 * `tuning` with the Stage 7c knobs off (for now: `galleries.wrapPercent` 0 and `galleries.stairPercent` 0; the splits, pits and daises join them in
 * the later tasks), the rest unchanged: no gallery wraps and none is picked as a stairwell, so a Floor's plan, source and map are 7b's byte for byte.
 */
export function flatHalls(tuning: TuningData): TuningData {
  const f = tuning.delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, galleries: { ...f.galleries, wrapPercent: 0, stairPercent: 0 } } } };
}

/**
 * `tuning` with the shipped Stage 7c values (the galleries' `wrapPercent` 40, `uPercent` 30 and `stairPercent` 60; the other kinds join them in the
 * later tasks). The shipped data has them off until the switch; the 7c tests run on this and it goes when the switch does.
 */
export function rooms7c(tuning: TuningData): TuningData {
  const f = tuning.delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, galleries: { wrapPercent: 40, uPercent: 30, stairPercent: 60 } } } };
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
