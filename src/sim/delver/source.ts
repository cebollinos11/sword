/**
 * A Delver Floor as a Map Source (docs/plans/delver.md, Stage 1): the plan's Halls and Passages written as Brushes, so that
 * `compileMap` and the Map Editor take a Floor as they take any Battle map. The Map Source format does not change: the Delver
 * markers stay in the `FloorPlan`, and the source carries them only for the eye (Objective D at the Entrance, E at the Stairs,
 * and render-only props). The Simulation never reads a marker back from a map file.
 *
 * Pure: whole and half metres only, every list in the plan's fixed order.
 */
import type { Brush, MapMaterial, MapSource, SourceProp } from '../../mapEditor/source';
import type { DelverHallKind, FloorPlan } from './plan';

/** A Floor's Battle map name: `delver<floor>s<seed>`, within `MAX_MAP_NAME`. */
export const floorName = (seed: number, floor: number): string => `delver${floor}s${seed >>> 0}`;

/** How each kind of Hall is drawn (render-only). */
const HALL_MATERIAL: Readonly<Record<DelverHallKind, MapMaterial>> = {
  Entrance: 'plaster',
  Stairs: 'glow',
  Rest: 'brick',
  Treasure: 'tile',
  Fight: 'dungeon',
  Empty: 'basalt',
};

/** The Floor's Map Source on a field `fieldSize` m across (the Battle's): the abyss under everything, an Enclosure for each Hall and each Passage, and the markers for the eye. */
export function floorSource(plan: FloorPlan, fieldSize: number): MapSource {
  const half = fieldSize / 2;
  const abyss: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -half, z0: -half, x1: half, z1: half }, y: -8, hazard: 'abyss' };
  const halls: Brush[] = plan.halls.map((h) => ({ kind: 'enclosure', id: h.id, rect: h.rect, y: 0, doors: h.doors, material: HALL_MATERIAL[h.kind] }));
  const passages: Brush[] = plan.passages.map((p) => ({
    kind: 'enclosure',
    id: p.id,
    rect: p.rect,
    y: 0,
    doors: p.axis === 'x' ? { e: p.rect.z1 - p.rect.z0, w: p.rect.z1 - p.rect.z0 } : { n: p.rect.x1 - p.rect.x0, s: p.rect.x1 - p.rect.x0 },
    material: 'stone',
  }));

  const entrance = plan.halls[plan.entrance]!;
  const stairs = plan.halls[plan.stairs]!;
  const m = plan.markers;
  const props: SourceProp[] = [
    { id: 'entrance', kind: 'banner', x: entrance.cx, z: entrance.cz, y: 0, turn: 0, team: 0 },
    ...m.fires.map((p, n): SourceProp => ({ id: `fire${n}`, kind: 'torch', x: p.x, z: p.z, y: 0, turn: 0 })),
    ...m.posts.map((p, n): SourceProp => ({ id: `post${n}`, kind: 'banner', x: p.x, z: p.z, y: 0, turn: 0, team: 1 })),
    ...m.pedestals.map((p, n): SourceProp => ({ id: `pedestal${n}`, kind: 'crate', x: p.x, z: p.z, y: 0, turn: 0 })),
  ];

  return {
    version: 1,
    name: floorName(plan.seed, plan.floor),
    size: fieldSize,
    grid: { step: 0.5, cell: 2 },
    levels: [-8, 0, 4],
    brushes: [abyss, ...halls, ...passages],
    objectives: [
      { id: 'D', x: entrance.cx, z: entrance.cz, weight: 1, owner: 0, spawn: true },
      { id: 'E', x: stairs.cx, z: stairs.cz, weight: 1, owner: 1, spawn: true },
    ],
    bases: [
      { x: entrance.cx, z: entrance.cz },
      { x: stairs.cx, z: stairs.cz },
    ],
    front: 52,
    armySize: { standard: 50, max: 50 },
    look: { props },
  };
}
