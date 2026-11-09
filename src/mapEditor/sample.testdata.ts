/**
 * Map Sources for the Map Compiler's tests (docs/plans/map-editor.md, Stage 0), written by hand as the Map Editor will save them. None is a
 * shipped map: no Battle is fought on them but in tests.
 *
 *  - `sampleSource`: Stage 0's sample. A keep (a Platform 4 m up, x -12 to 12, z -8 to 8) with B on it, a railed Ramp up its south face and
 *    one up its north face, a bridge (a Deck 4 m up) running east off the keep over a lava pit (8 m down) to a dead end at x 44, C on the
 *    bridge's end, and five Objectives.
 *  - `withBrushes`: a 200 m field source of the given Brushes (`GROUND` is the whole field's floor), with five Objectives and the Bases
 *    where a flat field takes them, to build a test's source from.
 */
import type { Brush, FloorBrush, MapSource, SourceObjective } from './source';

const HALF = 100;

/** The whole field's floor at 0. */
export const GROUND: FloorBrush = { kind: 'floor', id: 'ground', rect: { x0: -HALF, z0: -HALF, x1: HALF, z1: HALF }, y: 0 };

/** Five Objectives in Battle order (D and E spawns, B weighing 1.4), all neutral. */
export const FIVE: readonly SourceObjective[] = [
  { id: 'D', x: 0, z: -40, weight: 1, owner: -1, spawn: true },
  { id: 'A', x: -50, z: 0, weight: 1, owner: -1, spawn: false },
  { id: 'B', x: 0, z: 0, weight: 1.4, owner: -1, spawn: false },
  { id: 'C', x: 50, z: 0, weight: 1, owner: -1, spawn: false },
  { id: 'E', x: 0, z: 40, weight: 1, owner: -1, spawn: true },
];

/** A source of `brushes` on the 200 m field, at `levels`; the rest as the Fort's. */
export function withBrushes(brushes: readonly Brush[], levels: readonly number[] = [0, 4], more: Partial<MapSource> = {}): MapSource {
  return {
    version: 1,
    name: 'test',
    size: 2 * HALF,
    grid: { step: 0.5, cell: 5 },
    levels,
    brushes,
    objectives: FIVE,
    bases: [
      { x: 0, z: -88 },
      { x: 0, z: 88 },
    ],
    front: 52,
    armySize: { standard: 144, max: 144 },
    ticketsPerSoldier: 2.4,
    ...more,
  };
}

/** Stage 0's sample: a keep, two ramps, a bridge over a lava pit, five Objectives. */
export const sampleSource = (): MapSource =>
  withBrushes(
    [
      GROUND,
      { kind: 'platform', id: 'keep', rect: { x0: -12, z0: -8, x1: 12, z1: 8 }, top: 4 },
      { kind: 'ramp', id: 'rampS', rect: { x0: -4, z0: -20, x1: 4, z1: -8 }, lo: 0, hi: 4, up: 'n', rails: ['e', 'w'] },
      { kind: 'ramp', id: 'rampN', rect: { x0: -4, z0: 8, x1: 4, z1: 20 }, lo: 0, hi: 4, up: 's', rails: ['e', 'w'] },
      { kind: 'hole', id: 'pit', rect: { x0: 20, z0: -12, x1: 36, z1: 12 }, y: 0 },
      { kind: 'hazard', id: 'lava', rect: { x0: 20, z0: -12, x1: 36, z1: 12 }, y: -8, hazard: 'lava' },
      { kind: 'deck', id: 'bridge', rect: { x0: 12, z0: -3, x1: 44, z1: 3 }, y: 4 },
      { kind: 'rail', id: 'bridgeRailS', a: { x: 12, z: -3 }, b: { x: 44, z: -3 }, y: 4, height: 1 },
      { kind: 'rail', id: 'bridgeRailN', a: { x: 12, z: 3 }, b: { x: 44, z: 3 }, y: 4, height: 1 },
    ],
    [-8, 0, 4],
    {
      name: 'sample',
      objectives: [
        { id: 'D', x: 0, z: -40, weight: 1, owner: -1, spawn: true },
        { id: 'A', x: -50, z: 0, weight: 1, owner: -1, spawn: false },
        { id: 'B', x: 0, z: 0, weight: 1.4, owner: -1, spawn: false },
        { id: 'C', x: 40, z: 0, weight: 1, owner: -1, spawn: false },
        { id: 'E', x: 0, z: 40, weight: 1, owner: -1, spawn: true },
      ],
    },
  );
