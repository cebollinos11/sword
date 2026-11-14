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

/** `tuning` with Stage 6's lattice and the Stage 7a knobs off: cols 7, rows 6, rooms 22, gaps [22, 24, 26, 28], halfSize [5, 11], `turnPercent` 0 and no great halls. `flatFloors(flatRooms(t))` is Stage 5's flat Floor. */
export function flatRooms(tuning: TuningData): TuningData {
  return {
    ...tuning,
    delver: {
      ...tuning.delver,
      floor: { ...tuning.delver.floor, cols: 7, rows: 6, rooms: 22, gaps: [22, 24, 26, 28], halfSize: [5, 11], turnPercent: 0, great: { count: [0, 0], half: [12, 16] } },
    },
  };
}
