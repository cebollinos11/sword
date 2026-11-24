/**
 * A Delver Floor as a Map Source (docs/plans/delver.md, Stage 1): the plan's Halls and Passages written as Brushes, so that
 * `compileMap` and the Map Editor take a Floor as they take any Battle map. The Map Source format does not change: the Delver
 * markers stay in the `FloorPlan`, and the source carries them only for the eye (Objective D at the Entrance, E at the Stairs,
 * and render-only props). The Simulation never reads a marker back from a map file.
 *
 * Pure: whole and half metres only, every list in the plan's fixed order.
 */
import { enclosureTop, type BlockBrush, type Brush, type Doors, type MapMaterial, type MapSource, type Side, type SourceProp } from '../../mapEditor/source';
import { hallBase, PASSAGE_STOREY, type DelverHall, type DelverHallKind, type DelverPassage, type FloorPlan } from './plan';

/** A Floor's Battle map name: `delver<floor>s<seed>`, within `MAX_MAP_NAME`. */
export const floorName = (seed: number, floor: number): string => `delver${floor}s${seed >>> 0}`;

/** The Brush id of piece `k` (from 0, in order from `a`) of Passage `p`: the Passage's own id when it has one piece, else `<id>-<k>`. */
/** The id of Hall `hall`'s solid `n` and pillar `n` as Blocks (the Brush ids `floorSource` writes). */
export const solidId = (hall: Pick<DelverHall, 'id'>, n: number): string => `${hall.id}-solid${n}`;
export const pillarId = (hall: Pick<DelverHall, 'id'>, n: number): string => `${hall.id}-pillar${n}`;
export const pieceId = (p: Pick<DelverPassage, 'id' | 'pieces'>, k: number): string => (p.pieces.length === 1 ? p.id : `${p.id}-${k}`);

/** The Brush id of Hall `hall`'s step `n` (a split's, a pit's, a dais's, an Uphill's or a Spiral's Ramp, from 0 in the feature's order). */
export const stepId = (hall: Pick<DelverHall, 'id'>, n: number): string => `${hall.id}-step${n}`;

/** The Brush id of a Spiral's landing `n` (Stage 7f, from 0 in climbing order), and of an Uphill's high landing. */
export const landingId = (hall: Pick<DelverHall, 'id'>, n: number): string => `${hall.id}-landing${n}`;
export const highId = (hall: Pick<DelverHall, 'id'>): string => `${hall.id}-high`;

/** The Brush ids of Hall `hall`'s lava rect `n` (Stage 7d): the Hole in its floor and the lava Hazard under it. */
export const holeId = (hall: Pick<DelverHall, 'id'>, n: number): string => `${hall.id}-hole${n}`;
export const lavaId = (hall: Pick<DelverHall, 'id'>, n: number): string => `${hall.id}-lava${n}`;

/** The heights a drawn room's Brush stands at (Stage 7g), which the source's `levels` must hold. */
function brushHeights(b: Brush): number[] {
  switch (b.kind) {
    case 'platform':
      return [b.top];
    case 'ramp':
      return [b.lo, b.hi];
    case 'rail':
    case 'hole':
    case 'hazard':
    case 'floor':
    case 'deck':
    case 'enclosure':
      return [b.y];
    default:
      return [];
  }
}

/** Whether `name` is a Floor's Battle map name, one `floorName` makes. */
export const isFloorName = (name: string): boolean => /^delver[1-9]\d*s\d+$/.test(name);

/** How each kind of Hall is drawn (render-only). */
const HALL_MATERIAL: Readonly<Record<DelverHallKind, MapMaterial>> = {
  Entrance: 'plaster',
  Stairs: 'cobble',
  Boss: 'bloodstone',
  Rest: 'brick',
  Treasure: 'marble',
  Fight: 'dungeon',
  Empty: 'basalt',
};

/** The sides a sloped leg's Ramp is railed along, across its axis. */
const LONG_SIDES: Readonly<Record<'x' | 'z', readonly Side[]>> = { x: ['n', 's'], z: ['e', 'w'] };

/**
 * The Floor's Map Source on a field `fieldSize` m across (the Battle's): the abyss under everything, an Enclosure for each Hall and each
 * piece of each Passage (a turning Passage has several: its legs and corners), a Deck (and a Deck for each wall it wraps onto) and a Ramp for each gallery, then (Stage 7c) each Hall's feature (a split's main tier, a pit's rims, a dais, an Uphill's high landing or a Spiral's landings (Stage 7f), then its step Ramps), then (Stage 7d) each lava Hall's lava (for each lava rect, a Hole in the Hall's floor and then a lava Hazard `LAVA_DEPTH` under it, so every lava edge is an open ledge), a Ramp along each sloped leg, then (Stage 7b) each Hall's
 * Blocks (its solids, which cut its shape out of its rect, and then its pillars), each from the Hall's floor to its ceiling, and the markers for the eye. A Hall with no solid or pillar writes no Block. Levels stand at every height a
 * Brush does; an Enclosure names its `top` only when its roof is not the next level up. A Floor with a gallery or a feature asks for shortcut jump Links. A Hall's Enclosure stands at `hallBase` (a split's lowest tier).
 */
export function floorSource(plan: FloorPlan, fieldSize: number): MapSource {
  const half = fieldSize / 2;
  const abyss: Brush = { kind: 'hazard', id: 'abyss', rect: { x0: -half, z0: -half, x1: half, z1: half }, y: -8, hazard: 'abyss' };
  // Each piece of a Passage (a leg or a corner) stands at its lower side's height, roofed over its higher; both its sides open when it is flat, only
  // the low one when it is sloped (the Hall or corner at the high end cuts its own door at that height). The doors of a Passage through a gallery's
  // wall are the Deck's, flat. A one-piece Passage keeps its id; piece k (from 0, in order from `a`) of a turning one is `<id>-<k>`.
  const spans = plan.passages.flatMap((p) =>
    p.pieces.map((q, k) => {
      const lo = Math.min(q.y0, q.y1);
      const hi = Math.max(q.y0, q.y1);
      const width = q.axis === 'x' ? q.rect.z1 - q.rect.z0 : q.rect.x1 - q.rect.x0;
      const doors: Doors = q.y0 === q.y1 ? { [q.from]: width, [q.to]: width } : { [q.y0 < q.y1 ? q.from : q.to]: width };
      return { q, id: pieceId(p, k), lo, hi, top: hi + PASSAGE_STOREY, doors };
    }),
  );
  const heights = new Set<number>([-8, 0, 4]);
  for (const h of plan.halls) {
    heights.add(hallBase(h));
    heights.add(h.y);
    heights.add(h.top);
    if (h.gallery) heights.add(h.gallery.y);
    const f = h.feature;
    if (f?.kind === 'split') for (const t of f.tiers) heights.add(t.y);
    else if (f?.kind === 'pit') heights.add(f.rim);
    else if (f?.kind === 'dais') heights.add(f.y);
    else if (f?.kind === 'spiral') for (const l of f.landings) heights.add(l.y);
    else if (f?.kind === 'room') for (const b of f.brushes) for (const y of brushHeights(b)) heights.add(y);
    if (h.lava) heights.add(h.lava.y);
  }
  for (const sp of spans) {
    heights.add(sp.lo);
    heights.add(sp.top);
  }
  const levels = [...heights].sort((a, b) => a - b);
  const roof = (y: number, top: number): { top?: number } => (enclosureTop({ y }, levels) === top ? {} : { top });
  const halls: Brush[] = plan.halls.map((h) => ({ kind: 'enclosure', id: h.id, rect: h.rect, y: hallBase(h), doors: h.doors, ...roof(hallBase(h), h.top), material: HALL_MATERIAL[h.kind] }));
  const passages: Brush[] = spans.map(({ q, id, lo, top, doors }) => ({ kind: 'enclosure', id, rect: q.rect, y: lo, doors, ...roof(lo, top), material: 'stone' }));
  const galleries: Brush[] = plan.halls.flatMap((h): Brush[] => {
    const g = h.gallery;
    if (!g) return [];
    return [
      { kind: 'deck', id: `${h.id}-deck`, rect: g.deck, y: g.y, material: 'wood' },
      ...(g.wrap?.decks ?? []).map((rect, n): Brush => ({ kind: 'deck', id: `${h.id}-deck${n + 1}`, rect, y: g.y, material: 'wood' })),
      { kind: 'ramp', id: `${h.id}-ramp`, rect: g.ramp, lo: h.y, hi: g.y, up: g.up, rails: g.up === 'e' || g.up === 'w' ? ['n', 's'] : ['e', 'w'], material: 'stone' },
    ];
  });
  // Each Hall's feature (Stage 7c) in index order: a split's main tier, a pit's four rims or a dais, then its steps (`<hall>-step<n>`, Ramps on the lower floor).
  const features: Brush[] = plan.halls.flatMap((h): Brush[] => {
    const f = h.feature;
    if (!f) return [];
    const steps = f.steps.map((s, n): Brush => ({ kind: 'ramp', id: stepId(h, n), rect: s.rect, lo: s.lo, hi: s.hi, up: s.up, rails: s.rails, material: 'stone' }));
    if (f.kind === 'split') {
      const main = f.tiers.find((t) => t.level === h.level)!;
      return [{ kind: 'platform', id: `${h.id}-tier`, rect: main.rect, top: h.y, material: HALL_MATERIAL[h.kind] }, ...steps];
    }
    if (f.kind === 'pit') return [...f.rims.map((rect, n): Brush => ({ kind: 'platform', id: `${h.id}-rim${n}`, rect, top: f.rim, material: HALL_MATERIAL[h.kind] })), ...steps];
    // Stage 7f. An Uphill: its high landing, then its Ramp from the Enclosure's floor (the low landing) up to it.
    if (f.kind === 'uphill') return [{ kind: 'platform', id: highId(h), rect: f.high, top: h.y, material: HALL_MATERIAL[h.kind] }, ...steps];
    // A Spiral: its landings, each but the last written over the next Ramp's rect too (the Ramp continues its strip at its width), so that Ramp, whose foot
    // stands above the well, is solid down to the well; then its Ramps.
    // Stage 7g: a drawn room's pieces, as the plan placed them (its lava's Holes and Hazards among them, in the room's order).
    if (f.kind === 'room') return [...f.brushes];
    if (f.kind === 'spiral') {
      const under = (n: number) => {
        const a = f.landings[n]!.rect;
        const b = f.steps[n + 1]?.rect;
        return b ? { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) } : a;
      };
      return [...f.landings.map((l, n): Brush => ({ kind: 'platform', id: landingId(h, n), rect: under(n), top: l.y, material: 'stone' })), ...steps];
    }
    return [{ kind: 'platform', id: `${h.id}-dais`, rect: f.rect, top: f.y, material: 'stone' }, ...steps];
  });
  // Each lava Hall's lava (Stage 7d) in index order: for each rect n, a Hole in the Hall's floor (`<hall>-hole<n>`, at the Hall's height, which takes the floor away from the Enclosure
  // and the Brushes before it) and then the lava Hazard under it (`<hall>-lava<n>`). Soldiers never drop that far, so no field joins the lava; a Fighter over the edge dies in it.
  const lava: Brush[] = plan.halls.flatMap((h): Brush[] =>
    (h.lava?.kind === 'room' ? [] : h.lava?.rects ?? []).flatMap((rect, n): Brush[] => [
      { kind: 'hole', id: holeId(h, n), rect, y: h.y },
      { kind: 'hazard', id: lavaId(h, n), rect, y: h.lava!.y, hazard: 'lava' },
    ]),
  );
  const slopes: Brush[] = spans.flatMap(({ q, id, lo, hi }): Brush[] =>
    lo === hi ? [] : [{ kind: 'ramp', id: `${id}-ramp`, rect: q.rect, lo, hi, up: q.y1 > q.y0 ? q.to : q.from, rails: LONG_SIDES[q.axis], material: 'stone' }],
  );
  // Each Hall in order: its solids (in its material), then its pillars (stone). Each Block's `top` is the Hall's ceiling, which the compiler's Block-in-an-Enclosure rule asks.
  const blocks: BlockBrush[] = plan.halls.flatMap((h): BlockBrush[] => [
    ...h.solids.map((rect, n): BlockBrush => ({ kind: 'block', id: solidId(h, n), rect, top: h.top, material: HALL_MATERIAL[h.kind] })),
    ...h.pillars.map((rect, n): BlockBrush => ({ kind: 'block', id: pillarId(h, n), rect, top: h.top, material: 'stone' })),
  ]);

  // Team 0's front rank (z = -front) may not run through a Block (the Battle map's own check). A Floor's Battle never deploys from it, so it is moved off any Block it
  // would cross: the first of 52, 51, 53, 50, ... that crosses none (52, as always, with no Block across it).
  // A drawn room's Blocks (Stage 7g) are among its pieces, so they count too.
  const allBlocks = [...blocks, ...features.filter((b): b is BlockBrush => b.kind === 'block')];
  const crosses = (front: number) => allBlocks.some((b) => b.rect.z0 < -front && b.rect.z1 > -front);
  let front = 52;
  for (let d = 1; crosses(front); d++) front = 52 + (d % 2 === 1 ? -(d + 1) >> 1 : d >> 1);

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
    brushes: [abyss, ...halls, ...passages, ...galleries, ...features, ...lava, ...slopes, ...blocks],
    objectives: [
      { id: 'D', x: entrance.cx, z: entrance.cz, ...(entrance.y === 0 ? {} : { y: entrance.y }), weight: 1, owner: 0, spawn: true },
      { id: 'E', x: stairs.cx, z: stairs.cz, ...(stairs.y === 0 ? {} : { y: stairs.y }), weight: 1, owner: 1, spawn: true },
    ],
    bases: [
      { x: entrance.cx, z: entrance.cz },
      { x: stairs.cx, z: stairs.cz },
    ],
    front,
    armySize: { standard: 50, max: 50 },
    look: { sky: 'crypt', props },
    ...(plan.halls.some((h) => h.gallery || h.feature) ? { shortcuts: true as const } : {}),
  };
}
