/**
 * The Map Source (docs/plans/map-editor.md, Stage 0): the editable description of a Battle map, saved beside the compiled map as
 * `data/battlemaps/<map>.source.json`. It is what the Map Editor edits and the Map Compiler (`compile.ts`) turns into an ordinary
 * `BattleMapTuning`; it is not Tuning Data (never loaded by `loadTuningData`, nor hashed).
 *
 * A source is a list of Brushes on a grid, in order (a later Brush paints over an earlier one), and the Battle's markers and settings:
 *  - **Floor**: a rectangle of floor at a height (the ground is one).
 *  - **Deck**: a raised floor over open space below (a bridge): the floor under it stays.
 *  - **Platform**: a solid box from the ground to its top: its top is floor, the floor under it is cut out, Walls stand on its faces.
 *  - **Ramp**: a rectangle sloped from `lo` to `hi`, rising toward its `up` side; the floor under it is cut out; optional rails on its sides.
 *  - **Hole**: takes away the floor at one level (`y`) that the Brushes before it laid there; a Hole at a Platform's top takes the Platform
 *    away there (a doorway, a corridor cut into it).
 *  - **Hazard**: deadly floor (`lava`, `water` or `abyss`) at a height, in place of the floor the Brushes before it laid at that height.
 *  - **Rail** and **Wall**: a segment with a bottom and a top (a Rail stands `height` over the floor `y`).
 *  - **Block**: the one-level solid box of `blocks` (a wall or a tower Soldiers are pushed out of); never under a Deck.
 *
 * Stage 5, the look (render-only: none of it reaches the compiled map, nor the Tuning Data hash): each Brush that lays a floor or stands a
 * Wall may name a `material` from the Map Editor's palette (`MAP_MATERIALS`; absent, its kind's own, `look.ts`), and the optional `look`
 * block names the map's sky and light (`sky`, one of the Battle looks, `BATTLE_SKIES`) and places its props (trees, rubble, banners, crates,
 * torches). A source with neither is a Stage 4 source, and compiles to the same bytes.
 *
 * Stage 6, half-turn mirror mode (`mirror.ts`): `mirror: true` marks a map meant to be its own half turn (ADR 0022). Its Brushes, Objectives
 * and props may each carry a `twin`, the id of their half turn's (their own id where they are their own half turn), linked both ways; the
 * Bases of a mirrored map are each other's twins. The compiler orders a mirrored map's Objectives and Blocks so that k mirrors n - 1 - k,
 * and the checks say where it is not its own half turn. A source with no `mirror` and no `twin` compiles to the same bytes as before.
 *
 * Every coordinate snaps to the grid's whole step (`grid.step`), so the compiled Walk Surfaces' corners are exact and neighbours share
 * edges exactly; every height a Brush stands at is one of the source's `levels`. Directions are the compass of the maps: north is +z
 * (toward Team 1), east +x.
 */
import { checkSites, MAX_MAP_NAME, parseMapLobby, type BattleMapLobby } from '../tuning/battle';
import { array, finiteNumber, nonEmptyString, positiveNumber, record, TuningDataError } from '../tuning/validate';

/** The format this module reads and writes; a source of another version is refused. */
export const MAP_SOURCE_VERSION = 1;

/** A side of a rectangle, or a direction on the ground: north (+z), east (+x), south (-z), west (-x). */
export type Side = 'n' | 'e' | 's' | 'w';
export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/** An axis-aligned rectangle on the grid, x from x0 to x1 and z from z0 to z1 (x0 < x1, z0 < z1). */
export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** A point on the ground (x, z). */
export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export type HazardKind = 'lava' | 'water' | 'abyss';

/** The palette a Brush's `material` comes from (Stage 5, render-only): how its floors, faces and rails are drawn in the map's model (`look.ts`). */
export const MAP_MATERIALS = ['stone', 'brick', 'basalt', 'dungeon', 'cobble', 'plaster', 'tile', 'wood', 'grass', 'dirt', 'sand', 'metal', 'glow'] as const;
export type MapMaterial = (typeof MAP_MATERIALS)[number];

/** The sky and light a map is drawn under (Stage 5, render-only): one of the Stage's existing looks, for a Battlefield (`stage.ts`). */
export const BATTLE_SKIES = ['dusk', 'mystic', 'sunset', 'fog', 'snow', 'ember'] as const;
export type BattleSky = (typeof BATTLE_SKIES)[number];

/** What a prop is (Stage 5, render-only): drawn from a small set of models (`render/mapProps.ts`); a torch carries a light. */
export const PROP_KINDS = ['tree', 'rubble', 'banner', 'crate', 'torch'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** The most props a map holds. */
export const MAX_PROPS = 500;

/**
 * A prop: a render-only object standing at (x, z) on the floor nearest under the height `y` (the level it was placed at, as an Objective's
 * `y` names its floor), turned `turn` degrees about the vertical (anticlockwise seen from
 * above, from facing north), a banner in a Team's colour (`team`) or plain. It never reaches the compiled map: Soldiers and Fighters walk through it.
 */
export interface SourceProp {
  /** Unique among the props, letters, digits and `-`. */
  readonly id: string;
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly turn: number;
  readonly team?: 0 | 1;
  /** Stage 6: its twin's id (its own where it is its own half turn). */
  readonly twin?: string;
}

/** The map's look apart from its Brushes' materials (Stage 5, render-only): each part absent for the Battlefield's own. */
export interface MapLook {
  readonly sky?: BattleSky;
  readonly props?: readonly SourceProp[];
}

interface BrushBase {
  /** Unique in the source, letters, digits and `-`; the compiled map's ids are made from it (`WALK_<id>_<n>`, `WALL_<id>_<side><n>`, `BLOCK_<id>`). */
  readonly id: string;
  /** How it is drawn (render-only; absent, its kind's own). Never on a Hole or a Hazard, which are drawn by what they are. */
  readonly material?: MapMaterial;
  /** Stage 6: its twin's id, a Brush of its kind that is its half turn (its own where it is its own half turn); absent, it is free. */
  readonly twin?: string;
}
export interface FloorBrush extends BrushBase {
  readonly kind: 'floor';
  readonly rect: Rect;
  readonly y: number;
}
export interface DeckBrush extends BrushBase {
  readonly kind: 'deck';
  readonly rect: Rect;
  readonly y: number;
}
export interface PlatformBrush extends BrushBase {
  readonly kind: 'platform';
  readonly rect: Rect;
  readonly top: number;
}
export interface RampBrush extends BrushBase {
  readonly kind: 'ramp';
  readonly rect: Rect;
  readonly lo: number;
  readonly hi: number;
  /** The side its high end lies along. */
  readonly up: Side;
  /** Its long sides that carry a rail (from below its foot to `RAIL` over its top); the others get a stepped skirt. */
  readonly rails: readonly Side[];
}
export interface HoleBrush extends BrushBase {
  readonly kind: 'hole';
  readonly rect: Rect;
  readonly y: number;
}
export interface HazardBrush extends BrushBase {
  readonly kind: 'hazard';
  readonly rect: Rect;
  readonly y: number;
  readonly hazard: HazardKind;
}
export interface RailBrush extends BrushBase {
  readonly kind: 'rail';
  readonly a: GroundPoint;
  readonly b: GroundPoint;
  /** The floor it stands on. */
  readonly y: number;
  /** How high it stands over that floor (m). */
  readonly height: number;
}
export interface WallBrush extends BrushBase {
  readonly kind: 'wall';
  readonly a: GroundPoint;
  readonly b: GroundPoint;
  readonly bottom: number;
  readonly top: number;
}
export interface BlockBrush extends BrushBase {
  readonly kind: 'block';
  readonly rect: Rect;
  readonly top: number;
}

export type Brush = FloorBrush | DeckBrush | PlatformBrush | RampBrush | HoleBrush | HazardBrush | RailBrush | WallBrush | BlockBrush;
export type BrushKind = Brush['kind'];
export const BRUSH_KINDS: readonly BrushKind[] = ['floor', 'deck', 'platform', 'ramp', 'hole', 'hazard', 'rail', 'wall', 'block'];

/** A Rail's height over its floor when the source leaves it out (m), and a Ramp's rail over its top. */
export const RAIL = 1;

/** An Objective as the source places it: as the map file's (`ObjectiveSite`), its `y` naming its level when set. */
export interface SourceObjective {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly weight: number;
  readonly owner: -1 | 0 | 1;
  readonly spawn: boolean;
  readonly y?: number;
  /** Stage 6: its twin's id (its own where it is its own half turn). */
  readonly twin?: string;
}

/** The map's card in the Lobby's map picker (Stage 3): the compiled map's `lobby`, render-only text, each part absent for the Lobby's own. */
export type SourceLobby = BattleMapLobby;

export interface MapSource {
  readonly version: number;
  /** The map's name: lower-case letters and digits, as `battle.maps` requires. */
  readonly name: string;
  /** The side of the square field (m): the Battle's `field.size`. */
  readonly size: number;
  /** `step`: the fine grid every coordinate snaps to (m); `cell`: the coarse grid drawn over it (the destination fields' cell, m). */
  readonly grid: { readonly step: number; readonly cell: number };
  /** The heights Brushes stand at, ascending. */
  readonly levels: readonly number[];
  /** In paint order: a later Brush paints over an earlier one. */
  readonly brushes: readonly Brush[];
  readonly objectives: readonly SourceObjective[];
  /** Each Team's Base: [Team 0, Team 1]. */
  readonly bases: readonly [GroundPoint, GroundPoint];
  readonly front: number;
  readonly armySize: { readonly standard: number; readonly max: number };
  readonly ticketsPerSoldier?: number;
  readonly lobby?: SourceLobby;
  /** Stage 5: the sky and the props (render-only). */
  readonly look?: MapLook;
  /** Stage 6: the map is meant to be its own half turn (mirror mode): the Bases are twins, and the compiler and checks mirror it. */
  readonly mirror?: true;
}

/** Brush ids: letters, digits and `-`. No `_`, which the compiled ids put between a Brush's id and the rest, so none can collide. */
const ID = /^[A-Za-z0-9-]+$/;

/** Whether `v` lies on the grid of `step` (a whole number of steps from 0). */
export const onGrid = (v: number, step: number): boolean => Number.isInteger(v / step);

function gridNumber(o: Record<string, unknown>, key: string, where: string, step: number, half: number): number {
  const v = finiteNumber(o, key, where);
  if (!onGrid(v, step)) throw new TuningDataError(`${where}.${key} (${v}) must lie on the ${step} m grid`);
  if (Math.abs(v) > half) throw new TuningDataError(`${where}.${key} (${v}) must lie inside the field (±${half})`);
  return v;
}

function parseRect(raw: unknown, where: string, step: number, half: number): Rect {
  const o = record(raw, where);
  const rect = { x0: gridNumber(o, 'x0', where, step, half), z0: gridNumber(o, 'z0', where, step, half), x1: gridNumber(o, 'x1', where, step, half), z1: gridNumber(o, 'z1', where, step, half) };
  if (rect.x1 <= rect.x0 || rect.z1 <= rect.z0) throw new TuningDataError(`${where}: x1 must lie beyond x0 and z1 beyond z0`);
  return rect;
}

function parsePoint(raw: unknown, where: string, step: number, half: number): GroundPoint {
  const o = record(raw, where);
  return { x: gridNumber(o, 'x', where, step, half), z: gridNumber(o, 'z', where, step, half) };
}

function side(v: unknown, where: string): Side {
  if (typeof v !== 'string' || !(SIDES as readonly string[]).includes(v)) throw new TuningDataError(`${where} must be one of ${SIDES.join(', ')}, got ${JSON.stringify(v)}`);
  return v as Side;
}

/** A Brush with its `material`, if the source names one (render-only: the compiler never reads it). */
function parseBrush(raw: unknown, where: string, step: number, half: number, level: (v: number, at: string) => number): Brush {
  const shape = parseShape(raw, where, step, half, level);
  const m = (raw as Record<string, unknown>).material;
  let brush = shape;
  if (m !== undefined) {
    const at = `${where} (${shape.id}).material`;
    if (shape.kind === 'hole' || shape.kind === 'hazard') throw new TuningDataError(`${at}: a ${shape.kind === 'hole' ? 'Hole' : 'Hazard'} has no material of its own`);
    if (typeof m !== 'string' || !(MAP_MATERIALS as readonly string[]).includes(m)) throw new TuningDataError(`${at} must be one of ${MAP_MATERIALS.join(', ')}, got ${JSON.stringify(m)}`);
    brush = { ...shape, material: m as MapMaterial };
  }
  return withTwin(brush, raw, `${where} (${shape.id})`);
}

/** `v` with the `twin` the raw part names, if any (Stage 6; that it names a part that names it back is checked over the whole list, `checkTwins`). */
function withTwin<T extends { readonly id: string }>(v: T, raw: unknown, where: string): T {
  const t = (raw as Record<string, unknown>).twin;
  if (t === undefined) return v;
  if (typeof t !== 'string' || t === '') throw new TuningDataError(`${where}.twin must be the id of its twin, got ${JSON.stringify(t)}`);
  return { ...v, twin: t };
}

/** Every `twin` in `items` names one of them of the same kind that names it back (or itself). */
function checkTwins(items: readonly { readonly id: string; readonly twin?: string; readonly kind?: string }[], where: string, what: string): void {
  const byId = new Map(items.map((v) => [v.id, v]));
  items.forEach((v, i) => {
    if (v.twin === undefined) return;
    const t = byId.get(v.twin);
    const at = `${where}[${i}] (${v.id}).twin`;
    if (!t) throw new TuningDataError(`${at} names "${v.twin}", but no ${what} is`);
    if (t.kind !== v.kind) throw new TuningDataError(`${at} names "${v.twin}", a ${t.kind}: a twin is of its own kind (${v.kind})`);
    if (t.twin !== v.id) throw new TuningDataError(`${at} names "${v.twin}", whose twin is ${t.twin === undefined ? 'none' : `"${t.twin}"`}: twins name each other`);
  });
}

function parseShape(raw: unknown, where: string, step: number, half: number, level: (v: number, at: string) => number): Brush {
  const o = record(raw, where);
  const id = nonEmptyString(o, 'id', where);
  if (!ID.test(id)) throw new TuningDataError(`${where}.id "${id}" may hold only letters, digits and -`);
  const at = `${where} (${id})`;
  const rect = () => parseRect(o.rect, `${at}.rect`, step, half);
  const lv = (key: string) => level(finiteNumber(o, key, at), `${at}.${key}`);
  switch (o.kind) {
    case 'floor':
    case 'deck':
    case 'hole':
      return { kind: o.kind, id, rect: rect(), y: lv('y') };
    case 'platform':
    case 'block': {
      const top = o.kind === 'platform' ? lv('top') : positiveNumber(o, 'top', at);
      return { kind: o.kind, id, rect: rect(), top };
    }
    case 'hazard': {
      if (o.hazard !== 'lava' && o.hazard !== 'water' && o.hazard !== 'abyss') throw new TuningDataError(`${at}.hazard must be lava, water or abyss, got ${JSON.stringify(o.hazard)}`);
      return { kind: 'hazard', id, rect: rect(), y: lv('y'), hazard: o.hazard };
    }
    case 'ramp': {
      const lo = lv('lo');
      const hi = lv('hi');
      if (hi <= lo) throw new TuningDataError(`${at}.hi must be above its lo`);
      const up = side(o.up, `${at}.up`);
      const rails = array(o.rails ?? [], `${at}.rails`).map((r, k) => side(r, `${at}.rails[${k}]`));
      const along = up === 'n' || up === 's' ? ['e', 'w'] : ['n', 's'];
      rails.forEach((r, k) => {
        if (!along.includes(r)) throw new TuningDataError(`${at}.rails[${k}] (${r}) must be a long side of the ramp (${along.join(' or ')})`);
      });
      return { kind: 'ramp', id, rect: rect(), lo, hi, up, rails: SIDES.filter((s) => rails.includes(s)) };
    }
    case 'rail':
    case 'wall': {
      const a = parsePoint(o.a, `${at}.a`, step, half);
      const b = parsePoint(o.b, `${at}.b`, step, half);
      if (a.x === b.x && a.z === b.z) throw new TuningDataError(`${at}: a and b must be different points`);
      if (o.kind === 'rail') return { kind: 'rail', id, a, b, y: lv('y'), height: o.height === undefined ? RAIL : positiveNumber(o, 'height', at) };
      const bottom = finiteNumber(o, 'bottom', at);
      const top = finiteNumber(o, 'top', at);
      if (top <= bottom) throw new TuningDataError(`${at}.top must be above its bottom`);
      return { kind: 'wall', id, a, b, bottom, top };
    }
    default:
      throw new TuningDataError(`${at}.kind must be one of ${BRUSH_KINDS.join(', ')}, got ${JSON.stringify(o.kind)}`);
  }
}

function parseObjective(raw: unknown, where: string, half: number): SourceObjective {
  const o = record(raw, where);
  const id = nonEmptyString(o, 'id', where);
  const x = finiteNumber(o, 'x', where);
  const z = finiteNumber(o, 'z', where);
  if (Math.abs(x) >= half || Math.abs(z) >= half) throw new TuningDataError(`${where} (${id}) must lie inside the field`);
  if (o.owner !== -1 && o.owner !== 0 && o.owner !== 1) throw new TuningDataError(`${where}.owner must be -1 (none), 0 or 1, got ${JSON.stringify(o.owner)}`);
  if (typeof o.spawn !== 'boolean') throw new TuningDataError(`${where}.spawn must be true or false`);
  const site: SourceObjective = { id, x, z, weight: positiveNumber(o, 'weight', where), owner: o.owner, spawn: o.spawn };
  return withTwin(o.y === undefined ? site : { ...site, y: finiteNumber(o, 'y', where) }, raw, where);
}

function parseProp(raw: unknown, where: string, step: number, half: number): SourceProp {
  const o = record(raw, where);
  const id = nonEmptyString(o, 'id', where);
  if (!ID.test(id)) throw new TuningDataError(`${where}.id "${id}" may hold only letters, digits and -`);
  const at = `${where} (${id})`;
  if (typeof o.kind !== 'string' || !(PROP_KINDS as readonly string[]).includes(o.kind)) throw new TuningDataError(`${at}.kind must be one of ${PROP_KINDS.join(', ')}, got ${JSON.stringify(o.kind)}`);
  const kind = o.kind as PropKind;
  const turn = finiteNumber(o, 'turn', at);
  if (turn < 0 || turn >= 360) throw new TuningDataError(`${at}.turn (${turn}) must be at least 0 and under 360 degrees`);
  const prop: SourceProp = { id, kind, x: gridNumber(o, 'x', at, step, half), z: gridNumber(o, 'z', at, step, half), y: finiteNumber(o, 'y', at), turn };
  if (o.team === undefined) return withTwin(prop, raw, at);
  if (kind !== 'banner') throw new TuningDataError(`${at}.team: only a banner is in a Team's colour`);
  if (o.team !== 0 && o.team !== 1) throw new TuningDataError(`${at}.team must be 0 or 1, got ${JSON.stringify(o.team)}`);
  return withTwin({ ...prop, team: o.team }, raw, at);
}

/** The `look` block: its sky and props, each absent when the source leaves it out (and the block itself when both are). */
function parseLook(raw: unknown, step: number, half: number): MapLook | undefined {
  if (raw === undefined) return undefined;
  const o = record(raw, 'source.look');
  let look: MapLook = {};
  if (o.sky !== undefined) {
    if (typeof o.sky !== 'string' || !(BATTLE_SKIES as readonly string[]).includes(o.sky)) throw new TuningDataError(`source.look.sky must be one of ${BATTLE_SKIES.join(', ')}, got ${JSON.stringify(o.sky)}`);
    look = { sky: o.sky as BattleSky };
  }
  if (o.props !== undefined) {
    const props = array(o.props, 'source.look.props').map((p, i) => parseProp(p, `source.look.props[${i}]`, step, half));
    if (props.length > MAX_PROPS) throw new TuningDataError(`source.look.props holds at most ${MAX_PROPS} props, this one ${props.length}`);
    const ids = new Set<string>();
    props.forEach((p, i) => {
      if (ids.has(p.id)) throw new TuningDataError(`source.look.props[${i}]: another prop is already "${p.id}"`);
      ids.add(p.id);
    });
    checkTwins(props, 'source.look.props', 'prop');
    if (props.length > 0) look = { ...look, props };
  }
  return look.sky === undefined && look.props === undefined ? undefined : look;
}

/**
 * Validate a raw Map Source (a parsed `.source.json`). Throws TuningDataError naming the path (and the Brush's id). Accepts its own
 * output, so a parsed source parses again.
 */
export function parseMapSource(raw: unknown): MapSource {
  const r = record(raw, 'source');
  if (r.version !== MAP_SOURCE_VERSION) throw new TuningDataError(`source.version must be ${MAP_SOURCE_VERSION}, got ${JSON.stringify(r.version)}`);
  const name = nonEmptyString(r, 'name', 'source');
  if (!/^[a-z][a-z0-9]*$/.test(name) || name.length > MAX_MAP_NAME) throw new TuningDataError(`source.name "${name}" must be lower-case letters and digits, starting with a letter, at most ${MAX_MAP_NAME}`);
  const size = positiveNumber(r, 'size', 'source');
  const g = record(r.grid, 'source.grid');
  const step = positiveNumber(g, 'step', 'source.grid');
  // A step of whole quarter metres keeps every coordinate exact in binary, so neighbours share their edges to the bit.
  if (!Number.isInteger(step * 4)) throw new TuningDataError(`source.grid.step (${step}) must be a whole number of quarter metres`);
  if (!onGrid(size / 2, step)) throw new TuningDataError(`source.grid.step (${step}) must divide half the field (${size / 2})`);
  const grid = { step, cell: positiveNumber(g, 'cell', 'source.grid') };
  const levels = array(r.levels, 'source.levels').map((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TuningDataError(`source.levels[${i}] must be a number`);
    return v;
  });
  if (levels.length === 0) throw new TuningDataError('source.levels must hold at least one height');
  levels.forEach((v, i) => {
    if (i > 0 && v <= levels[i - 1]!) throw new TuningDataError('source.levels must be ascending, each height once');
  });
  const level = (v: number, at: string) => {
    if (!levels.includes(v)) throw new TuningDataError(`${at} (${v}) must be one of the source's levels (${levels.join(', ')})`);
    return v;
  };
  const half = size / 2;
  const brushes = array(r.brushes, 'source.brushes').map((b, i) => parseBrush(b, `source.brushes[${i}]`, step, half, level));
  const ids = new Set<string>();
  brushes.forEach((b, i) => {
    if (ids.has(b.id)) throw new TuningDataError(`source.brushes[${i}]: another Brush is already "${b.id}"`);
    ids.add(b.id);
  });
  checkTwins(brushes, 'source.brushes', 'Brush');
  const objectives = array(r.objectives, 'source.objectives').map((o, i) => parseObjective(o, `source.objectives[${i}]`, half));
  // The game's own rule for a map's Objectives (`parseBattleMap`), so the editor refuses the edit rather than Save the map.
  checkSites(objectives, 'source.objectives');
  checkTwins(objectives, 'source.objectives', 'Objective');
  const bases = array(r.bases, 'source.bases');
  if (bases.length !== 2) throw new TuningDataError("source.bases must hold Team 0's Base and Team 1's");
  const basePoint = (v: unknown, at: string): GroundPoint => {
    const o = record(v, at);
    const p = { x: finiteNumber(o, 'x', at), z: finiteNumber(o, 'z', at) };
    if (Math.abs(p.x) >= half || Math.abs(p.z) >= half) throw new TuningDataError(`${at} must lie inside the field`);
    return p;
  };
  const army = record(r.armySize, 'source.armySize');
  const source: MapSource = {
    version: MAP_SOURCE_VERSION,
    name,
    size,
    grid,
    levels,
    brushes,
    objectives,
    bases: [basePoint(bases[0], 'source.bases[0]'), basePoint(bases[1], 'source.bases[1]')],
    front: positiveNumber(r, 'front', 'source'),
    armySize: { standard: positiveNumber(army, 'standard', 'source.armySize'), max: positiveNumber(army, 'max', 'source.armySize') },
    ...(r.ticketsPerSoldier === undefined ? {} : { ticketsPerSoldier: positiveNumber(r, 'ticketsPerSoldier', 'source') }),
  };
  const lobby = parseMapLobby(r.lobby, 'source.lobby');
  const look = parseLook(r.look, step, half);
  if (r.mirror !== undefined && r.mirror !== true) throw new TuningDataError(`source.mirror must be true (a map meant to be its own half turn) or left out, got ${JSON.stringify(r.mirror)}`);
  return { ...source, ...(lobby ? { lobby } : {}), ...(look ? { look } : {}), ...(r.mirror ? { mirror: true as const } : {}) };
}
