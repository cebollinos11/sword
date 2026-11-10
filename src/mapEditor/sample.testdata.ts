/**
 * Map Sources for the Map Compiler's tests (docs/plans/map-editor.md, Stage 0), written by hand as the Map Editor will save them. None is a
 * shipped map: no Battle is fought on them but in tests.
 *
 *  - `sampleSource`: Stage 0's sample. A keep (a Platform 4 m up, x -12 to 12, z -8 to 8) with B on it, a railed Ramp up its south face and
 *    one up its north face, a bridge (a Deck 4 m up) running east off the keep over a lava pit (8 m down) to a dead end at x 44, C on the
 *    bridge's end, and five Objectives.
 *  - `dressedSampleSource`: Stage 0's sample dressed (Stage 5): a material on each Brush, props (trees, rubble, banners, crates, torches)
 *    and a sky. It compiles to the very same map as the sample.
 *  - `withBrushes`: a 200 m field source of the given Brushes (`GROUND` is the whole field's floor), with five Objectives and the Bases
 *    where a flat field takes them, to build a test's source from.
 */
import type { Brush, FloorBrush, MapMaterial, MapSource, SourceObjective, SourceProp } from './source';

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

/** The materials the dressed sample's Brushes are drawn in. */
const DRESSED: Readonly<Record<string, MapMaterial>> = { ground: 'grass', keep: 'brick', rampS: 'cobble', rampN: 'cobble', bridge: 'wood', bridgeRailS: 'metal', bridgeRailN: 'metal' };

/** Stage 0's sample dressed: its Brushes in materials, trees and rubble about the field, banners and torches on the keep, crates by the bridge, a mystic sky. */
export function dressedSampleSource(): MapSource {
  const plain = sampleSource();
  const props: SourceProp[] = [
    ...[-60, -40, 60, 75].flatMap((x, k) => [
      { id: `tree${2 * k + 1}`, kind: 'tree' as const, x, z: -25 + 10 * k, y: 0, turn: 0 },
      { id: `tree${2 * k + 2}`, kind: 'tree' as const, x: -x, z: 30 - 8 * k, y: 0, turn: 90 },
    ]),
    { id: 'rubble1', kind: 'rubble', x: 16, z: -16, y: 0, turn: 30 },
    { id: 'rubble2', kind: 'rubble', x: -18, z: 14, y: 0, turn: 0 },
    { id: 'banner1', kind: 'banner', x: -10, z: -6, y: 4, turn: 180, team: 0 },
    { id: 'banner2', kind: 'banner', x: -10, z: 6, y: 4, turn: 0, team: 1 },
    { id: 'banner3', kind: 'banner', x: 10, z: -6, y: 4, turn: 180 },
    ...[-11, 11].flatMap((x, k) => [
      { id: `torch${2 * k + 1}`, kind: 'torch' as const, x, z: -7, y: 4, turn: 0 },
      { id: `torch${2 * k + 2}`, kind: 'torch' as const, x, z: 7, y: 4, turn: 0 },
    ]),
    { id: 'crate1', kind: 'crate', x: 46, z: -2, y: 0, turn: 15 },
    { id: 'crate2', kind: 'crate', x: 48, z: 1.5, y: 0, turn: 45 },
  ];
  return {
    ...plain,
    brushes: plain.brushes.map((b) => (DRESSED[b.id] ? { ...b, material: DRESSED[b.id] } : b)),
    look: { sky: 'mystic', props },
  };
}

/**
 * A source the size of the City (about 650 Walk Surfaces and 500 Walls compiled, against `city.json`'s 634 and 280), to time the live
 * checks on (docs/plans/map-editor.md, Stage 2): 63 buildings (Platforms 4 m up, 10 m square) in a 9 by 7 grid 20 m apart, each with a
 * railed Ramp up its south face and a notch cut into its north side, and a railed bridge (a Deck) east to the next one.
 */
export function citySizedSource(): MapSource {
  const brushes: Brush[] = [GROUND];
  for (let r = -3; r <= 3; r++)
    for (let c = -4; c <= 4; c++) {
      const x = c * 20;
      const z = r * 20;
      const id = `${c + 4}x${r + 3}`;
      brushes.push({ kind: 'platform', id: `house${id}`, rect: { x0: x - 5, z0: z - 5, x1: x + 5, z1: z + 5 }, top: 4 });
      brushes.push({ kind: 'ramp', id: `stair${id}`, rect: { x0: x - 2, z0: z - 13, x1: x + 2, z1: z - 5 }, lo: 0, hi: 4, up: 'n', rails: ['e', 'w'] });
      brushes.push({ kind: 'hole', id: `notch${id}`, rect: { x0: x - 1.5, z0: z + 2, x1: x + 1.5, z1: z + 5 }, y: 4 });
      if (c === 4) continue;
      brushes.push({ kind: 'deck', id: `bridge${id}`, rect: { x0: x + 5, z0: z + 2, x1: x + 15, z1: z + 4.5 }, y: 4 });
      brushes.push({ kind: 'rail', id: `railS${id}`, a: { x: x + 5, z: z + 2 }, b: { x: x + 15, z: z + 2 }, y: 4, height: 1 });
      brushes.push({ kind: 'rail', id: `railN${id}`, a: { x: x + 5, z: z + 4.5 }, b: { x: x + 15, z: z + 4.5 }, y: 4, height: 1 });
    }
  return withBrushes(brushes, [0, 4], { name: 'citysized' });
}
