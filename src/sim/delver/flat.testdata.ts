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

/** `tuning` with Stage 6's lattice and the Stage 7a and 7b knobs off: cols 7, rows 6, rooms 22, gaps [22, 24, 26, 28], halfSize [5, 11], `turnPercent` 0 and no great halls. `flatFloors(flatRooms(t))` is Stage 5's flat Floor. */
export function flatRooms(tuning: TuningData): TuningData {
  return {
    ...tuning,
    delver: {
      ...tuning.delver,
      floor: { ...tuning.delver.floor, cols: 7, rows: 6, rooms: 22, gaps: [22, 24, 26, 28], halfSize: [5, 11], turnPercent: 0, great: { count: [0, 0], half: [12, 16] }, shapes: { ...tuning.delver.floor.shapes, percent: 0 }, pillars: { ...tuning.delver.floor.pillars, percent: 0 } },
    },
  };
}

/** `tuning` with `delver.floor.shapes.percent` and `pillars.percent` 0 (the weights unchanged): every Hall a rect, and the plan is 7a's plus the new fields. */
export function plainHalls(tuning: TuningData): TuningData {
  const f = tuning.delver.floor;
  return { ...tuning, delver: { ...tuning.delver, floor: { ...f, shapes: { ...f.shapes, percent: 0 }, pillars: { ...f.pillars, percent: 0 } } } };
}

/** `tuning` with the shipped Stage 7b values (Tasks 2 to 4 only, until the bundled data switches): shapes 50 % (L 3, T 2, cross 2, ring 2) and pillars 40 % (colonnade 1, grid 1). */
export function rooms7b(tuning: TuningData): TuningData {
  const f = tuning.delver.floor;
  return {
    ...tuning,
    delver: { ...tuning.delver, floor: { ...f, shapes: { percent: 50, weights: { L: 3, T: 2, cross: 2, ring: 2 } }, pillars: { percent: 40, weights: { colonnade: 1, grid: 1 } } } },
  };
}
