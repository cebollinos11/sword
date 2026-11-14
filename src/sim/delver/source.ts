/**
 * A Delver Floor as a Map Source (docs/plans/delver.md, Stage 1): the plan's Halls and Passages written as Brushes, so that
 * `compileMap` and the Map Editor take a Floor as they take any Battle map. The Map Source format does not change: the Delver
 * markers stay in the `FloorPlan`, and the source carries them only for the eye (Objective D at the Entrance, E at the Stairs,
 * and render-only props). The Simulation never reads a marker back from a map file.
 *
 * Pure: whole and half metres only, every list in the plan's fixed order.
 */
import { enclosureTop, type Brush, type Doors, type MapMaterial, type MapSource, type Side, type SourceProp } from '../../mapEditor/source';
import { HALL_STOREY, type DelverHallKind, type FloorPlan } from './plan';

/** A Floor's Battle map name: `delver<floor>s<seed>`, within `MAX_MAP_NAME`. */
export const floorName = (seed: number, floor: number): string => `delver${floor}s${seed >>> 0}`;

/** Whether `name` is a Floor's Battle map name, one `floorName` makes. */
export const isFloorName = (name: string): boolean => /^delver[1-9]\d*s\d+$/.test(name);

/** How each kind of Hall is drawn (render-only). */
const HALL_MATERIAL: Readonly<Record<DelverHallKind, MapMaterial>> = {
  Entrance: 'plaster',
  Stairs: 'glow',
  Boss: 'glow',
  Rest: 'brick',
  Treasure: 'tile',
  Fight: 'dungeon',
  Empty: 'basalt',
};

/** The side a sloped Passage's Ramp rises toward (its `b` end), and the sides it is railed along. */
const RISES: Readonly<Record<'x' | 'z', Side>> = { x: 'e', z: 'n' };
const FALLS: Readonly<Record<'x' | 'z', Side>> = { x: 'w', z: 's' };
const LONG_SIDES: Readonly<Record<'x' | 'z', readonly Side[]>> = { x: ['n', 's'], z: ['e', 'w'] };

/**
 * The Floor's Map Source on a field `fieldSize` m across (the Battle's): the abyss under everything, an Enclosure for each Hall and each
 * Passage, a Deck and a Ramp for each gallery, a Ramp along each sloped Passage, and the markers for the eye. Levels stand at every height a
 * Brush does; an Enclosure names its `top` only when its roof is not the next level up. A Floor with a gallery asks for shortcut jump Links.
 */
export function floorSource(plan: FloorPlan, fieldSize: number): MapSource {
  const half = fieldSize / 2;
  const abyss: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -half, z0: -half, x1: half, z1: half }, y: -8, hazard: 'abyss' };
  // A Passage stands at its lower door's height, roofed over its higher door; both ends open when flat, only the low end when sloped (the
  // Hall at the high end cuts its own door at that height). The doors of a Passage through a gallery's wall are the Deck's, flat.
  const spans = plan.passages.map((p) => {
    const lo = Math.min(p.ya, p.yb);
    const hi = Math.max(p.ya, p.yb);
    const width = p.axis === 'x' ? p.rect.z1 - p.rect.z0 : p.rect.x1 - p.rect.x0;
    const aEnd: Side = p.axis === 'x' ? 'w' : 's';
    const bEnd: Side = p.axis === 'x' ? 'e' : 'n';
    const doors: Doors = p.ya === p.yb ? { [aEnd]: width, [bEnd]: width } : { [p.ya < p.yb ? aEnd : bEnd]: width };
    return { p, lo, hi, top: hi + HALL_STOREY, doors };
  });
  const heights = new Set<number>([-8, 0, 4]);
  for (const h of plan.halls) {
    heights.add(h.y);
    heights.add(h.top);
    if (h.gallery) heights.add(h.gallery.y);
  }
  for (const sp of spans) {
    heights.add(sp.lo);
    heights.add(sp.top);
  }
  const levels = [...heights].sort((a, b) => a - b);
  const roof = (y: number, top: number): { top?: number } => (enclosureTop({ y }, levels) === top ? {} : { top });
  const halls: Brush[] = plan.halls.map((h) => ({ kind: 'enclosure', id: h.id, rect: h.rect, y: h.y, doors: h.doors, ...roof(h.y, h.top), material: HALL_MATERIAL[h.kind] }));
  const passages: Brush[] = spans.map(({ p, lo, top, doors }) => ({ kind: 'enclosure', id: p.id, rect: p.rect, y: lo, doors, ...roof(lo, top), material: 'stone' }));
  const galleries: Brush[] = plan.halls.flatMap((h): Brush[] => {
    const g = h.gallery;
    if (!g) return [];
    return [
      { kind: 'deck', id: `${h.id}-deck`, rect: g.deck, y: g.y, material: 'wood' },
      { kind: 'ramp', id: `${h.id}-ramp`, rect: g.ramp, lo: h.y, hi: g.y, up: g.up, rails: g.up === 'e' || g.up === 'w' ? ['n', 's'] : ['e', 'w'], material: 'stone' },
    ];
  });
  const slopes: Brush[] = spans.flatMap(({ p, lo, hi }): Brush[] =>
    lo === hi ? [] : [{ kind: 'ramp', id: `${p.id}-ramp`, rect: p.rect, lo, hi, up: p.yb > p.ya ? RISES[p.axis] : FALLS[p.axis], rails: LONG_SIDES[p.axis], material: 'stone' }],
  );

  const entrance = plan.halls[plan.entrance]!;
  const stairs = plan.halls[plan.stairs]!;
  const m = plan.markers;
  const props: SourceProp[] = [
    { id: 'entrance', kind: 'banner', x: entrance.cx, z: entrance.cz, y: entrance.y, turn: 0, team: 0 },
    ...m.fires.map((p, n): SourceProp => ({ id: `fire${n}`, kind: 'torch', x: p.x, z: p.z, y: p.y, turn: 0 })),
    ...m.posts.map((p, n): SourceProp => ({ id: `post${n}`, kind: 'banner', x: p.x, z: p.z, y: p.y, turn: 0, team: 1 })),
    ...m.pedestals.map((p, n): SourceProp => ({ id: `pedestal${n}`, kind: 'crate', x: p.x, z: p.z, y: p.y, turn: 0 })),
    ...(m.boss ? [{ id: 'boss', kind: 'banner', x: m.boss.x, z: m.boss.z, y: m.boss.y, turn: 0, team: 1 } as SourceProp] : []),
  ];

  return {
    version: 1,
    name: floorName(plan.seed, plan.floor),
    size: fieldSize,
    grid: { step: 0.5, cell: 2 },
    levels,
    brushes: [abyss, ...halls, ...passages, ...galleries, ...slopes],
    objectives: [
      { id: 'D', x: entrance.cx, z: entrance.cz, ...(entrance.y === 0 ? {} : { y: entrance.y }), weight: 1, owner: 0, spawn: true },
      { id: 'E', x: stairs.cx, z: stairs.cz, ...(stairs.y === 0 ? {} : { y: stairs.y }), weight: 1, owner: 1, spawn: true },
    ],
    bases: [
      { x: entrance.cx, z: entrance.cz },
      { x: stairs.cx, z: stairs.cz },
    ],
    front: 52,
    armySize: { standard: 50, max: 50 },
    look: { props },
    ...(plan.halls.some((h) => h.gallery) ? { shortcuts: true as const } : {}),
  };
}
