/**
 * The Map Editor's working Map Source (docs/plans/map-editor.md, Stage 1), as `EditorSession` is the Motion Editor's: the one source of
 * truth the top view, the Brush palette and the property panel all edit through. Kept free of three.js and the DOM, and unit-tested.
 *
 * Every edit makes a new Map Source and hands it to `parseMapSource` before it is kept, so the session never holds a source the parser
 * refuses (an edit that would is refused, with the parser's error, and changes nothing). Each edit is one step of undo; a drag (`beginDrag`
 * … `endDrag`) is one step however many moves it makes, each move measured from where the drag began so nothing creeps off the grid.
 *
 * Where the UI asks for a place, the session snaps it to the source's fine grid (`grid.step`) and keeps it inside the field. A new Brush
 * stands at the level being edited (`level`): a Floor, Deck, Hole, Hazard or Rail at it; a Platform or a Ramp rising from it to the level
 * above (on the top level, to it from the one below); a Wall from a metre under it to 3 m over it; a Block 3 m over it.
 *
 * Stage 3: the Battle's markers are edited here too. An Objective is placed, dragged, renamed and removed; one placed or dragged on a map of
 * several levels takes the level being edited as its `y` (it stands on the floor there nearest under that height, as the Battlefield stands
 * it, `groundNear`); the two Bases are dragged; the `front` is dragged by either Team's line (Team 0's at z = -front, Team 1's at +front).
 * A marker is selected apart from the Brushes (selecting one clears the other).
 *
 * Stage 5: the look, all render-only. A Brush's material is part of the Brush (`replaceBrush`); a prop is a marker like an Objective, placed at
 * the level being edited (`addProp`), dragged (taking the level being edited, once it moves), edited and removed; the sky is a setting (`setSky`).
 *
 * Stage 6, half-turn mirror mode (`mirror.ts`, `setMirror`): in a mirrored source a Brush, Objective or prop placed gets its twin (its half
 * turn), and twins are edited together, each edit one undo step: a move, a resize, a panel edit (the twin is made the edited part's half turn,
 * keeping its own id), a material, a delete or a duplicate of one does the same to the other, and they keep their places side by side in
 * the paint order. One placed on its own half turn (centred) is its own twin: a move leaves it where it is, a resize moves the opposite side
 * too. The Bases of a mirrored map move together. `unlink` turns a pair back into two free parts. Links act whether or not mirror mode is
 * on; mirror mode decides what new parts get, and how the map compiles and is checked.
 */
import { MAX_OBJECTIVES, type BattleTuning } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import type { RepoFile } from '../editor/session';
import { GENERATED_BATTLE_MAPS } from '../render/battleModels';
import { compileMap, list, mapFileText, MapCompileError, type CompileWarning } from './compile';
import { brushesTwin, inMirrorOrder, objectivesTwin, propsTwin, turnBrush, turnObjective, turnPoint, turnProp } from './mirror';
import { DOOR_WIDTH, enclosureTop, parseMapSource, MAP_SOURCE_VERSION, MAX_PROPS, RAIL, type BattleSky, type Brush, type BrushKind, type GroundPoint, type MapLook, type MapSource, type PropKind, type Rect, type Side, type SourceLobby, type SourceObjective, type SourceProp } from './source';

/** The most undo steps kept. */
const UNDO_DEPTH = 200;
/** How far over the level it stands at a new Wall rises, and a new Block's top (m). */
const NEW_HEIGHT = 3;

/** A grip on a Brush the top view drags to resize it: a corner or a side's middle of a rectangle, or an end of a segment. */
export type Handle = 'sw' | 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'a' | 'b';
const RECT_HANDLES: readonly Handle[] = ['sw', 's', 'se', 'e', 'ne', 'n', 'nw', 'w'];

/** A Brush drawn as a segment (Rail, Wall) rather than a rectangle. */
export type SegmentBrush = Extract<Brush, { a: GroundPoint }>;
export const isSegment = (b: Brush): b is SegmentBrush => b.kind === 'rail' || b.kind === 'wall';

/** A new map: the whole field's floor at 0, five Objectives and the Bases where a flat field takes them (as the Fort's settings). */
export function blankSource(name = 'newmap'): MapSource {
  return {
    version: MAP_SOURCE_VERSION,
    name,
    size: 200,
    grid: { step: 0.5, cell: 5 },
    levels: [0],
    brushes: [{ kind: 'floor', id: 'ground', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: 0 }],
    objectives: [
      { id: 'D', x: 0, z: -40, weight: 1, owner: -1, spawn: true },
      { id: 'A', x: -50, z: 0, weight: 1, owner: -1, spawn: false },
      { id: 'B', x: 0, z: 0, weight: 1.4, owner: -1, spawn: false },
      { id: 'C', x: 50, z: 0, weight: 1, owner: -1, spawn: false },
      { id: 'E', x: 0, z: 40, weight: 1, owner: -1, spawn: true },
    ],
    bases: [
      { x: 0, z: -88 },
      { x: 0, z: 88 },
    ],
    front: 52,
    armySize: { standard: 144, max: 144 },
    ticketsPerSoldier: 2.4,
  };
}

/** The levels a Brush is drawn at: its floor's, both of a Ramp's or an Enclosure's (its floor and its roof), and a Wall's or Block's floor (the highest level under its top, at or under a Wall's foot + 1 m). */
export function brushLevels(b: Brush, levels: readonly number[]): number[] {
  switch (b.kind) {
    case 'floor':
    case 'deck':
    case 'hole':
    case 'hazard':
    case 'rail':
      return [b.y];
    case 'platform':
      return [b.top];
    case 'enclosure': {
      const top = enclosureTop(b, levels);
      return top === null ? [b.y] : [b.y, top];
    }
    case 'ramp':
      return levels.filter((y) => y === b.lo || y === b.hi);
    case 'wall':
    case 'block': {
      const under = b.kind === 'wall' ? b.bottom + 1 : b.top;
      const below = levels.filter((y) => (b.kind === 'wall' ? y <= under : y < under));
      return [below.length > 0 ? below[below.length - 1]! : levels[0]!];
    }
  }
}

/** A Brush's rectangle on the ground: a segment's bounding box. */
export function boundsOf(b: Brush): Rect {
  if (!isSegment(b)) return b.rect;
  return { x0: Math.min(b.a.x, b.b.x), z0: Math.min(b.a.z, b.b.z), x1: Math.max(b.a.x, b.b.x), z1: Math.max(b.a.z, b.b.z) };
}

/** Where a Brush's handles stand: a rectangle's corners and sides' middles (south-west first, round anticlockwise), a segment's two ends. */
export function handlesOf(b: Brush): { readonly handle: Handle; readonly x: number; readonly z: number }[] {
  if (isSegment(b)) return [{ handle: 'a', ...b.a }, { handle: 'b', ...b.b }];
  const { x0, z0, x1, z1 } = b.rect;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const at: Record<string, [number, number]> = { sw: [x0, z0], s: [mx, z0], se: [x1, z0], e: [x1, mz], ne: [x1, z1], n: [mx, z1], nw: [x0, z1], w: [x0, mz] };
  return RECT_HANDLES.map((handle) => ({ handle, x: at[handle]![0], z: at[handle]![1] }));
}

/** How far (m) the point (x, z) lies from the segment a-b. */
function segmentDistance(a: GroundPoint, b: GroundPoint, x: number, z: number): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
  return Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
}

/**
 * The Brush the point (x, z) picks: the last in paint order (the one drawn on top) whose rectangle holds it, or whose segment lies within
 * `reach` (m), among those drawn at `level` (every Brush when null). Segments are picked before rectangles, as they are drawn over them.
 */
export function brushAt(source: MapSource, x: number, z: number, level: number | null, reach: number): Brush | null {
  const shown = source.brushes.filter((b) => level === null || brushLevels(b, source.levels).includes(level));
  for (let k = shown.length - 1; k >= 0; k--) {
    const b = shown[k]!;
    if (isSegment(b) && segmentDistance(b.a, b.b, x, z) <= reach) return b;
  }
  for (let k = shown.length - 1; k >= 0; k--) {
    const b = shown[k]!;
    if (!isSegment(b) && x >= b.rect.x0 && x <= b.rect.x1 && z >= b.rect.z0 && z <= b.rect.z1) return b;
  }
  return null;
}

/** The handle of `b` within `reach` (m) of (x, z), the nearest when several are. */
export function handleAt(b: Brush, x: number, z: number, reach: number): Handle | null {
  let best: Handle | null = null;
  let bestD = reach;
  for (const h of handlesOf(b)) {
    const d = Math.max(Math.abs(h.x - x), Math.abs(h.z - z));
    if (d <= bestD) [best, bestD] = [h.handle, d];
  }
  return best;
}

/** A Ramp's long sides (those that may carry a rail): across its slope. */
export const rampLongSides = (up: Side): readonly Side[] => (up === 'n' || up === 's' ? ['e', 'w'] : ['n', 's']);

/**
 * A marker the top view picks and drags: an Objective (by id), a Team's Base, a Team's front line (z = -front for Team 0, +front for Team 1),
 * or a prop (by id, Stage 5: render-only, but placed and dragged as the markers are).
 */
export type Marker =
  | { readonly kind: 'objective'; readonly id: string }
  | { readonly kind: 'base'; readonly team: 0 | 1 }
  | { readonly kind: 'front'; readonly team: 0 | 1 }
  | { readonly kind: 'prop'; readonly id: string };

/** Whether `a` and `b` are the same marker. */
export const sameMarker = (a: Marker | null, b: Marker | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    (a.kind === 'objective' || a.kind === 'prop' ? a.id === (b as { id: string }).id : a.team === (b as { team: 0 | 1 }).team));

/** The map's props (none when it has no `look`). */
export const propsOf = (source: MapSource): readonly SourceProp[] => source.look?.props ?? [];

/** `source` with its look made `look`: a part left empty is taken away, and the block itself when nothing is left. */
function withLook(source: MapSource, look: MapLook): MapSource {
  const { look: _old, ...rest } = source;
  const next: MapLook = { ...(look.sky !== undefined ? { sky: look.sky } : {}), ...(look.props !== undefined && look.props.length > 0 ? { props: look.props } : {}) };
  return next.sky === undefined && next.props === undefined ? rest : { ...rest, look: next };
}

/** How far in from each of the field's edges (m) a front line's grip reaches: a front line is picked there, so the Brushes along it stay pickable. */
export const FRONT_GRIP = 6;

/**
 * The marker the point (x, z) picks within `reach` (m): an Objective (the last in the list on a tie, as it is drawn on top), else a Base,
 * else a prop (the last on a tie), else a front line by its grip at either end (within FRONT_GRIP of the field's edge, `lineReach` of the line).
 */
export function markerAt(source: MapSource, x: number, z: number, reach: number, lineReach = reach): Marker | null {
  const near = (p: GroundPoint) => Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= reach;
  for (let k = source.objectives.length - 1; k >= 0; k--) if (near(source.objectives[k]!)) return { kind: 'objective', id: source.objectives[k]!.id };
  for (const team of [0, 1] as const) if (near(source.bases[team])) return { kind: 'base', team };
  const props = propsOf(source);
  for (let k = props.length - 1; k >= 0; k--) if (near(props[k]!)) return { kind: 'prop', id: props[k]!.id };
  const half = source.size / 2;
  if (Math.abs(x) > half + lineReach || Math.abs(x) < half - FRONT_GRIP) return null;
  for (const team of [0, 1] as const) if (Math.abs(z - (team === 0 ? -source.front : source.front)) <= lineReach) return { kind: 'front', team };
  return null;
}

/** An Objective id not yet taken: the first free letter from A, then `O<n>`. */
export function freshObjectiveId(objectives: readonly SourceObjective[]): string {
  const taken = new Set(objectives.map((o) => o.id));
  for (let c = 65; c <= 90; c++) if (!taken.has(String.fromCharCode(c))) return String.fromCharCode(c);
  let n = 1;
  while (taken.has(`O${n}`)) n++;
  return `O${n}`;
}

/**
 * A Map Source as `data/battlemaps/<map>.source.json` writes it: its settings, then one Brush, Objective and Base a line, so a small
 * edit gives a small diff. `parseMapSource` reads it back as the same source; the same source always gives the same text.
 */
export function sourceFileText(source: MapSource): string {
  const s = parseMapSource(source);
  const line = (v: unknown) => JSON.stringify(v);
  const head = [
    `  "version": ${line(s.version)}`,
    `  "name": ${line(s.name)}`,
    `  "size": ${line(s.size)}`,
    `  "grid": ${line(s.grid)}`,
    `  "levels": ${line(s.levels)}`,
    `  "front": ${line(s.front)}`,
    `  "armySize": ${line(s.armySize)}`,
  ];
  if (s.ticketsPerSoldier !== undefined) head.push(`  "ticketsPerSoldier": ${line(s.ticketsPerSoldier)}`);
  if (s.lobby !== undefined) head.push(`  "lobby": ${line(s.lobby)}`);
  // Mirror mode (Stage 6), after the settings, so a map with none writes what Stage 5 wrote.
  if (s.mirror) head.push(`  "mirror": true`);
  const body = [list('bases', s.bases), list('objectives', s.objectives), list('brushes', s.brushes)];
  // The look (Stage 5): its sky, then its props one a line, last, so a map with none writes what Stage 4 wrote.
  if (s.look !== undefined) {
    const parts: string[] = [];
    if (s.look.sky !== undefined) parts.push(`    "sky": ${line(s.look.sky)}`);
    if (s.look.props !== undefined) parts.push(`    "props": [\n${s.look.props.map((p) => `      ${line(p)}`).join(',\n')}\n    ]`);
    body.push(`  "look": {\n${parts.join(',\n')}\n  }`);
  }
  return `{\n${[...head, ...body].join(',\n')}\n}\n`;
}

/**
 * What Save writes: the Map Source and the map it compiles to, side by side in `data/battlemaps/`, where its model goes (Stage 5: made and
 * exported by the UI, `render/mapModel.ts`, as `public/models/arenas/battle_<map>.glb`), and what the compiler noticed.
 */
export interface MapFiles {
  readonly source: RepoFile;
  readonly map: RepoFile;
  readonly model: Omit<RepoFile, 'text'>;
  readonly warnings: readonly CompileWarning[];
}

/** The settings of a Map Source the editor changes apart from its Brushes and levels. */
export type MapSettings = Partial<Pick<MapSource, 'name' | 'grid' | 'objectives' | 'bases' | 'front' | 'armySize' | 'ticketsPerSoldier' | 'lobby'>>;

/** The index in `items` of item k's twin: -1 for none, k itself where it is its own. */
function twinOf(items: readonly { readonly id: string; readonly twin?: string }[], k: number): number {
  const t = items[k]!.twin;
  return t === undefined ? -1 : items.findIndex((v) => v.id === t);
}

/** `v` with no `twin` (a free part), or with `twin` set to `id`. */
function linkedTo<T extends { readonly twin?: string }>(v: T, id: string | undefined): T {
  const { twin: _old, ...rest } = v;
  return (id === undefined ? rest : { ...rest, twin: id }) as T;
}

/**
 * `items` with item k's twin made its half turn (`turn`), keeping the twin's own id and naming item k's (which an edit may have renamed);
 * an item that is its own twin is linked to its own id again. Items with no twin are left as they are.
 */
function withTwinOf<T extends { readonly id: string; readonly twin?: string }>(items: readonly T[], k: number, turn: (v: T) => T, before: readonly T[] = items): T[] {
  const v = items[k]!;
  // The twin as the list stood before the edit: a rename of item k leaves its twin naming the old id.
  const t = twinOf(before, k);
  if (t < 0) return [...items];
  if (t === k) return items.map((x, i) => (i === k ? linkedTo(x, x.id) : x));
  return items.map((x, i) => (i === t ? linkedTo({ ...turn(v), id: items[t]!.id }, v.id) : x));
}

/** The pair's place in a mirrored list: item k is the second of its pair when its twin comes before it. */
/** Each free item of `items` linked to the first free one that is its half turn (`twins`), or to itself where it is its own. */
function linkAll<T extends { readonly id: string; readonly twin?: string }>(items: readonly T[], twins: (a: T, b: T) => boolean): T[] {
  const out = [...items];
  out.forEach((v, k) => {
    if (v.twin !== undefined) return;
    if (twins(v, v)) {
      out[k] = linkedTo(v, v.id);
      return;
    }
    const m = out.findIndex((w, i) => i !== k && w.twin === undefined && twins(v, w));
    if (m < 0) return;
    out[k] = linkedTo(v, out[m]!.id);
    out[m] = linkedTo(out[m]!, v.id);
  });
  return out;
}

const isSecond = (items: readonly { readonly id: string; readonly twin?: string }[], k: number): boolean => {
  const t = twinOf(items, k);
  return t >= 0 && t < k;
};

export class MapEditorSession {
  private current: MapSource;
  private readonly undoStack: MapSource[] = [];
  private readonly redoStack: MapSource[] = [];
  /** The source as last saved or opened, to tell whether there are unsaved edits. */
  private saved: MapSource;
  /** The source when the drag in progress began, or null. */
  private dragBase: MapSource | null = null;
  /** The selected Brush's id, or null. */
  selected: string | null = null;
  /** The selected Battle marker, or null (never both it and a Brush). */
  marker: Marker | null = null;
  /** The level (a height of `source.levels`) new Brushes stand at and the top view edits. */
  level: number;
  /** Whether the top view shows and picks the Brushes of every level, or only those of `level`. */
  showAll = true;

  constructor(source: MapSource = blankSource()) {
    this.current = parseMapSource(source);
    this.saved = this.current;
    this.level = this.current.levels[0]!;
  }

  get source(): MapSource {
    return this.current;
  }

  /** The selected Brush, or null. */
  get selection(): Brush | null {
    return this.selected === null ? null : (this.current.brushes.find((b) => b.id === this.selected) ?? null);
  }

  /** Select the Brush `id` (null: none); an id the source has not is no selection. */
  select(id: string | null): void {
    this.selected = id !== null && this.current.brushes.some((b) => b.id === id) ? id : null;
    if (this.selected !== null) this.marker = null;
  }

  /** Select the marker `m` (null: none), clearing the Brush selection; an Objective the source has not is no selection. */
  selectMarker(m: Marker | null): void {
    this.marker = m && this.hasMarker(m, this.current) ? m : null;
    if (this.marker !== null) this.selected = null;
  }

  private hasMarker(m: Marker, s: MapSource): boolean {
    if (m.kind === 'prop') return propsOf(s).some((p) => p.id === m.id);
    return m.kind !== 'objective' || s.objectives.some((o) => o.id === m.id);
  }

  /** The selected prop, or null. */
  get prop(): SourceProp | null {
    const m = this.marker;
    return m?.kind === 'prop' ? (propsOf(this.current).find((p) => p.id === m.id) ?? null) : null;
  }

  /** Whether the source differs from the one last saved or opened (worked out once per source). */
  get dirty(): boolean {
    if (this.dirtyOf?.source !== this.current || this.dirtyOf.saved !== this.saved)
      this.dirtyOf = { source: this.current, saved: this.saved, dirty: this.current !== this.saved && sourceFileText(this.current) !== sourceFileText(this.saved) };
    return this.dirtyOf.dirty;
  }
  private dirtyOf: { source: MapSource; saved: MapSource; dirty: boolean } | null = null;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Start over on `source` (a parsed or raw Map Source: New, Open), with no undo history. Throws TuningDataError for a source the parser refuses. */
  open(source: unknown): void {
    const s = parseMapSource(source);
    this.current = s;
    this.saved = s;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.dragBase = null;
    this.selected = null;
    this.marker = null;
    this.level = s.levels.includes(this.level) ? this.level : s.levels[0]!;
  }

  /** Note that the current source has been saved. */
  markSaved(): void {
    this.saved = this.current;
  }

  /** Validate `next` and make it the source; one undo step unless a drag is in progress (the drag is one step). */
  private apply(next: MapSource): void {
    const s = parseMapSource(next);
    if (this.dragBase === null) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.current = s;
    if (!s.levels.includes(this.level)) this.level = nearest(s.levels, this.level);
    if (this.selection === null) this.selected = null;
    if (this.marker && !this.hasMarker(this.marker, s)) this.marker = null;
  }

  /** Step back one edit; nothing while a drag is in progress (finish it first). */
  undo(): boolean {
    if (this.dragBase !== null) return false;
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.current);
    this.restore(prev);
    return true;
  }

  /** Step forward one undone edit; nothing while a drag is in progress. */
  redo(): boolean {
    if (this.dragBase !== null) return false;
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.current);
    this.restore(next);
    return true;
  }

  private restore(s: MapSource): void {
    this.dragBase = null;
    this.current = s;
    if (!s.levels.includes(this.level)) this.level = nearest(s.levels, this.level);
    if (this.selection === null) this.selected = null;
    if (this.marker && !this.hasMarker(this.marker, s)) this.marker = null;
  }

  /** `v` on the fine grid, inside the field. */
  snap(v: number): number {
    const { step } = this.current.grid;
    const half = this.current.size / 2;
    return Math.max(-half, Math.min(half, Math.round(v / step) * step));
  }

  /** A Brush id not yet taken: `<kind><n>`, the lowest n from 1. */
  freshId(kind: BrushKind, brushes: readonly Brush[] = this.current.brushes): string {
    const taken = new Set(brushes.map((b) => b.id));
    let n = 1;
    while (taken.has(`${kind}${n}`)) n++;
    return `${kind}${n}`;
  }

  /** The level above `level` (or, on the top level, `level` itself, with the one below as its foot): where a Platform or Ramp drawn on it reaches. */
  private rise(): { lo: number; hi: number } {
    const { levels } = this.current;
    const i = levels.indexOf(this.level);
    if (i + 1 < levels.length) return { lo: this.level, hi: levels[i + 1]! };
    if (i > 0) return { lo: levels[i - 1]!, hi: this.level };
    throw new TuningDataError('a Platform or a Ramp rises from one level to another: add a second level first');
  }

  /**
   * Draw a new Brush of `kind` from `from` to `to` (the corners of a rectangle, the ends of a segment), snapped to the grid, at the level
   * being edited; it is painted last and selected. A click (from = to) makes one coarse cell of it there (a segment one cell long, east).
   */
  addBrush(kind: BrushKind, from: GroundPoint, to: GroundPoint): Brush {
    const cell = this.current.grid.cell;
    const id = this.freshId(kind);
    const y = this.level;
    let brush: Brush;
    if (kind === 'rail' || kind === 'wall') {
      const a = { x: this.snap(from.x), z: this.snap(from.z) };
      let b = { x: this.snap(to.x), z: this.snap(to.z) };
      if (a.x === b.x && a.z === b.z) b = { x: this.snap(a.x + cell) === a.x ? this.snap(a.x - cell) : this.snap(a.x + cell), z: a.z };
      brush = kind === 'rail' ? { kind, id, a, b, y, height: RAIL } : { kind, id, a, b, bottom: y - 1, top: y + NEW_HEIGHT };
    } else {
      let rect = this.rectOf(from, to);
      if (rect.x0 === rect.x1 || rect.z0 === rect.z1) {
        // A click: the coarse cell under it.
        const cx = Math.floor(from.x / cell) * cell;
        const cz = Math.floor(from.z / cell) * cell;
        rect = this.rectOf({ x: cx, z: cz }, { x: cx + cell, z: cz + cell });
      }
      switch (kind) {
        case 'floor':
        case 'deck':
        case 'hole':
          brush = { kind, id, rect, y };
          break;
        case 'hazard':
          brush = { kind, id, rect, y, hazard: 'lava' };
          break;
        case 'platform':
          brush = { kind, id, rect, top: this.rise().hi };
          break;
        case 'enclosure': {
          if (enclosureTop({ y }, this.current.levels) === null) throw new TuningDataError(`an Enclosure's ceiling is the level above its floor: draw it on a lower level, or add a level above ${y} m`);
          // A doorway on every side, as wide as the side allows.
          const width = (len: number) => Math.min(DOOR_WIDTH, len);
          const ns = width(rect.x1 - rect.x0);
          const ew = width(rect.z1 - rect.z0);
          brush = { kind, id, rect, y, doors: { n: ns, e: ew, s: ns, w: ew } };
          break;
        }
        case 'block':
          // The Simulation stands a Block's Walls from -1 m to its top: its top is a height over 0.
          if (y + NEW_HEIGHT <= 0) throw new TuningDataError(`a Block's top is a height over 0 (its Walls stand from -1 m): draw it on a level over ${-NEW_HEIGHT} m, or draw a Platform`);
          brush = { kind, id, rect, top: y + NEW_HEIGHT };
          break;
        case 'ramp': {
          const { lo, hi } = this.rise();
          // It rises along its long side, north or east; both long sides railed.
          const up: Side = rect.z1 - rect.z0 >= rect.x1 - rect.x0 ? 'n' : 'e';
          brush = { kind, id, rect, lo, hi, up, rails: rampLongSides(up) };
          break;
        }
      }
    }
    this.apply({ ...this.current, brushes: [...this.current.brushes, ...this.withNewTwin(brush, this.current.brushes)] });
    this.select(id);
    return brush;
  }

  /**
   * A new Brush and, in mirror mode, its twin painted right after it: `[b, twin]` with each naming the other, or `[b]` linked to itself where
   * it is its own half turn. Outside mirror mode, `[b]` as it is. `taken`: the Brushes the twin's fresh id must not be.
   */
  private withNewTwin(b: Brush, taken: readonly Brush[]): Brush[] {
    if (!this.current.mirror) return [b];
    if (brushesTwin(b, b)) return [linkedTo(b, b.id)];
    const id = this.freshId(b.kind, [...taken, b]);
    return [linkedTo(b, id), linkedTo({ ...turnBrush(b), id }, b.id)];
  }

  private rectOf(p: GroundPoint, q: GroundPoint): Rect {
    const [x0, x1] = [this.snap(p.x), this.snap(q.x)].sort((a, b) => a - b) as [number, number];
    const [z0, z1] = [this.snap(p.z), this.snap(q.z)].sort((a, b) => a - b) as [number, number];
    return { x0, z0, x1, z1 };
  }

  private indexOf(id: string): number {
    const k = this.current.brushes.findIndex((b) => b.id === id);
    if (k < 0) throw new TuningDataError(`no Brush "${id}"`);
    return k;
  }

  /** `base` with its Brush k made `brush`, and its twin, if it has one, made that Brush's half turn (Stage 6). */
  private withBrush(k: number, brush: Brush, base: MapSource = this.current): MapSource {
    const brushes = base.brushes.map((b, i) => (i === k ? brush : b));
    return { ...base, brushes: withTwinOf(brushes, k, turnBrush, base.brushes) };
  }

  /**
   * Replace the Brush `id` with `brush` (the property panel's edit; it may rename it, and the selection follows). A Ramp's rails keep only
   * its long sides, so turning it keeps it valid. Throws TuningDataError, changing nothing, where the parser refuses the result.
   */
  replaceBrush(id: string, brush: Brush): void {
    const k = this.indexOf(id);
    const was = this.current.brushes[k]!;
    const shaped: Brush = brush.kind === 'ramp' ? { ...brush, rails: brush.rails.filter((s) => rampLongSides(brush.up).includes(s)) } : brush;
    // The panel edits the shape: the link stays the Brush's own (an own twin renamed names its new id).
    const b = linkedTo(shaped, was.twin === undefined ? undefined : was.twin === was.id ? shaped.id : was.twin);
    const selected = this.selected === id;
    // Nothing changed (a panel writing back what it shows): no edit, no undo step.
    if (JSON.stringify(b) === JSON.stringify(this.current.brushes[k])) return;
    this.apply(this.withBrush(k, b));
    if (selected) this.selected = b.id;
  }

  /** Take the Brush `id` away, and its twin with it. */
  deleteBrush(id: string): void {
    const k = this.indexOf(id);
    const t = twinOf(this.current.brushes, k);
    this.apply({ ...this.current, brushes: this.current.brushes.filter((_, i) => i !== k && i !== t) });
    if (this.selected === id) this.selected = null;
  }

  /** A copy of the Brush `id`, a coarse cell east (west at the field's east edge; in place where neither fits), painted right after it and selected. */
  duplicateBrush(id: string): Brush {
    const k = this.indexOf(id);
    const b = this.current.brushes[k]!;
    const cell = this.current.grid.cell;
    const r = boundsOf(b);
    const half = this.current.size / 2;
    const dx = r.x1 + cell <= half ? cell : r.x0 - cell >= -half ? -cell : 0;
    const copy = linkedTo({ ...shifted(b, dx, 0), id: this.freshId(b.kind) } as Brush, undefined);
    // A twin's copy gets a twin of its own (a centred Brush's copy too, once it is off the centre), painted right after the pair.
    const t = twinOf(this.current.brushes, k);
    const copies = t < 0 ? [copy] : this.twinned(copy);
    const brushes = [...this.current.brushes];
    brushes.splice(Math.max(k, t) + 1, 0, ...copies);
    this.apply({ ...this.current, brushes });
    this.select(copy.id);
    return copy;
  }

  /** `[b, twin]` (`b` linked to its half turn, a fresh id), or `[b]` linked to itself where it is its own half turn. */
  private twinned(b: Brush): Brush[] {
    if (brushesTwin(b, b)) return [linkedTo(b, b.id)];
    const id = this.freshId(b.kind, [...this.current.brushes, b]);
    return [linkedTo(b, id), linkedTo({ ...turnBrush(b), id }, b.id)];
  }

  /** Move the Brush `id` `delta` places in paint order (later paints over earlier); clamped to the list. */
  reorder(id: string, delta: number): void {
    const list = this.current.brushes;
    const k = this.indexOf(id);
    const t = twinOf(list, k);
    // A twin pair moves as one, side by side, and steps over another pair as one: so whatever a Brush paints over, its twin paints over
    // that one's twin (Stage 6). Outside pairs, this is a step past one Brush.
    const mine = t < 0 || t === k ? [k] : [Math.min(k, t), Math.max(k, t)];
    const rest = list.map((_, i) => i).filter((i) => !mine.includes(i));
    const units: number[][] = [];
    for (let u = 0; u < rest.length; u++) {
      const i = rest[u]!;
      const j = rest[u + 1];
      const tw = twinOf(list, i);
      if (j !== undefined && tw === j && tw !== i) {
        units.push([i, j]);
        u++;
      } else units.push([i]);
    }
    const at = units.filter((v) => v[0]! < mine[0]!).length;
    const to = Math.max(0, Math.min(units.length, at + delta));
    const order = [...units.slice(0, to).flat(), ...mine, ...units.slice(to).flat()];
    if (order.every((v, i) => v === i)) return;
    this.apply({ ...this.current, brushes: order.map((i) => list[i]!) });
  }

  /** Start a drag: the moves and resizes until `endDrag` are one undo step, each measured from the source as it is now. */
  beginDrag(): void {
    if (this.dragBase === null) this.dragBase = this.current;
  }

  /** End the drag: one undo step if it changed anything. */
  endDrag(): void {
    const base = this.dragBase;
    if (base === null) return;
    this.dragBase = null;
    if (base === this.current) return;
    this.undoStack.push(base);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Run `f` as a drag of its own when no drag is in progress, so a single move is one undo step. */
  private dragging(f: (base: MapSource) => void): void {
    const own = this.dragBase === null;
    if (own) this.beginDrag();
    try {
      f(this.dragBase!);
    } finally {
      if (own) this.endDrag();
    }
  }

  /** In a drag, make the source `base` with its Brush k replaced by `brush`: `base` itself when that is the Brush it had, so a drag back to where it began is no step. */
  private dragTo(base: MapSource, k: number, brush: Brush): void {
    this.dragToSource(base, this.withBrush(k, brush, base), JSON.stringify(brush) === JSON.stringify(base.brushes[k]));
  }

  /** In a drag, make the source `next` (made from `base`), or `base` itself when `same`. */
  private dragToSource(base: MapSource, next: MapSource, same: boolean): void {
    if (same) this.current = base;
    else this.apply(next);
  }

  /**
   * Move the Brush `id` by (dx, dz) from where it stood when the drag began, snapped to the grid and kept inside the field. Throws
   * TuningDataError, changing nothing, where the parser refuses the result.
   */
  moveBrush(id: string, dx: number, dz: number): void {
    this.dragging((base) => {
      const k = base.brushes.findIndex((b) => b.id === id);
      if (k < 0) throw new TuningDataError(`no Brush "${id}"`);
      const b = base.brushes[k]!;
      const r = boundsOf(b);
      const half = base.size / 2;
      const { step } = base.grid;
      // A Brush that is its own twin stays centred: it does not move (the UI shows why).
      if (b.twin === b.id) {
        if (dx !== 0 || dz !== 0) throw new TuningDataError(`${id} is its own twin, so it stays centred: resize it, or unlink it to move it`);
        return;
      }
      const sx = Math.max(-half - r.x0, Math.min(half - r.x1, Math.round(dx / step) * step));
      const sz = Math.max(-half - r.z0, Math.min(half - r.z1, Math.round(dz / step) * step));
      this.dragTo(base, k, shifted(b, sx, sz));
    });
  }

  /**
   * Drag the handle `handle` of the Brush `id` to (x, z), snapped: a rectangle's sides follow it (never closer than one grid step to the
   * side across), a segment's end goes there (never onto its other end). Throws TuningDataError, changing nothing, where the parser refuses it.
   */
  resizeBrush(id: string, handle: Handle, x: number, z: number): void {
    this.dragging((base) => {
      const k = base.brushes.findIndex((b) => b.id === id);
      if (k < 0) throw new TuningDataError(`no Brush "${id}"`);
      const b = base.brushes[k]!;
      const sx = this.snap(x);
      const sz = this.snap(z);
      if (isSegment(b)) {
        if (handle !== 'a' && handle !== 'b') return;
        const own = b.twin === b.id;
        const other = own ? turnPoint({ x: sx, z: sz }) : handle === 'a' ? b.b : b.a;
        if (other.x === sx && other.z === sz) return;
        // A segment that is its own twin keeps its ends each other's half turn.
        this.dragTo(base, k, own ? { ...b, [handle]: { x: sx, z: sz }, [handle === 'a' ? 'b' : 'a']: other } : { ...b, [handle]: { x: sx, z: sz } });
        return;
      }
      if (handle === 'a' || handle === 'b') return;
      const { step } = base.grid;
      let { x0, z0, x1, z1 } = b.rect;
      if (b.twin === b.id) {
        // A rectangle that is its own twin stays centred: the opposite side moves with the one dragged (at least two steps across).
        if (handle.includes('w')) x1 = -(x0 = Math.min(sx, -step));
        if (handle.includes('e')) x0 = -(x1 = Math.max(sx, step));
        if (handle.includes('s')) z1 = -(z0 = Math.min(sz, -step));
        if (handle.includes('n')) z0 = -(z1 = Math.max(sz, step));
        this.dragTo(base, k, { ...b, rect: { x0, z0, x1, z1 } });
        return;
      }
      if (handle.includes('w')) x0 = Math.min(sx, x1 - step);
      if (handle.includes('e')) x1 = Math.max(sx, x0 + step);
      if (handle.includes('s')) z0 = Math.min(sz, z1 - step);
      if (handle.includes('n')) z1 = Math.max(sz, z0 + step);
      this.dragTo(base, k, { ...b, rect: { x0, z0, x1, z1 } });
    });
  }

  /** Add the height `y` to the levels (kept ascending), and edit it. */
  addLevel(y: number): void {
    if (!Number.isFinite(y)) throw new TuningDataError('a level is a height in metres');
    if (this.current.levels.includes(y)) {
      this.level = y;
      return;
    }
    this.apply({ ...this.current, levels: [...this.current.levels, y].sort((a, b) => a - b) });
    this.level = y;
  }

  /** Take the height `y` out of the levels; refused while a Brush stands at it (the parser names it). */
  removeLevel(y: number): void {
    if (this.current.levels.length === 1) throw new TuningDataError('a map has at least one level');
    this.apply({ ...this.current, levels: this.current.levels.filter((l) => l !== y) });
  }

  /** Change the map's settings (name, grid, Objectives, Bases, `front`, army size, Tickets, Lobby card). Throws TuningDataError, changing nothing, where the parser refuses them. */
  setSettings(settings: MapSettings): void {
    let next = { ...this.current, ...settings };
    // A mirrored map's Bases are twins: the one the edit moved takes the other with it (Team 0's, when both moved).
    if (settings.bases && next.mirror) {
      const [b0, b1] = settings.bases;
      const moved0 = b0.x !== this.current.bases[0].x || b0.z !== this.current.bases[0].z;
      next = { ...next, bases: moved0 || !(b1.x !== this.current.bases[1].x || b1.z !== this.current.bases[1].z) ? [b0, turnPoint(b0)] : [turnPoint(b1), b1] };
    }
    this.replaceSettings(next);
  }

  /**
   * Turn mirror mode on or off (one undo step). On, every free Brush, Objective and prop whose half turn is on the map is linked to it (one
   * that is its own half turn to itself), each first to the first free one that matches, and Team 1's Base is put at the half turn of Team 0's.
   * Off, the links stay (`unlink` frees a pair); new parts are placed free, and the map compiles as an ordinary one.
   */
  setMirror(on: boolean): void {
    const s = this.current;
    if (!on) {
      const { mirror: _m, ...rest } = s;
      if (s.mirror) this.apply(rest);
      return;
    }
    if (s.mirror) return;
    const props = propsOf(s);
    // A prop on the centre is its own twin (as `addProp` places one), though turned it faces the other way.
    const look = props.length > 0 ? { ...s.look, props: linkAll(props, (a, b) => (a === b ? a.x === 0 && a.z === 0 : propsTwin(a, b))) } : s.look;
    this.apply({ ...s, brushes: linkAll(s.brushes, brushesTwin), objectives: linkAll(s.objectives, objectivesTwin), bases: [s.bases[0], turnPoint(s.bases[0])], ...(look ? { look } : {}), mirror: true });
  }

  /** Turn the twins of the Brush, Objective or prop `m` (a Brush by its id) back into free parts (one undo step); nothing for a free one. */
  unlink(m: string | Marker): void {
    const s = this.current;
    const free = <T extends { readonly id: string; readonly twin?: string }>(items: readonly T[], id: string, what: string): T[] => {
      const k = items.findIndex((v) => v.id === id);
      if (k < 0) throw new TuningDataError(`no ${what} "${id}"`);
      const t = twinOf(items, k);
      return items.map((v, i) => (i === k || i === t ? linkedTo(v, undefined) : v));
    };
    let next: MapSource;
    if (typeof m === 'string') next = { ...s, brushes: free(s.brushes, m, 'Brush') };
    else if (m.kind === 'objective') next = { ...s, objectives: free(s.objectives, m.id, 'Objective') };
    else if (m.kind === 'prop') next = withLook(s, { ...s.look, props: free(propsOf(s), m.id, 'prop') });
    else throw new TuningDataError("a mirrored map's Bases are always twins: turn mirror mode off to move them apart");
    if (sourceFileText(next) !== sourceFileText(s)) this.apply(next);
  }

  /** Make `next` the source (a settings edit): no step when it writes the same file. */
  private replaceSettings(next: MapSource): void {
    if (sourceFileText(next) === sourceFileText(this.current)) return;
    this.apply(next);
  }

  /** `v` snapped to the fine grid and kept strictly inside the field (a marker may not stand on its edge). */
  private inside(v: number): number {
    const { step } = this.current.grid;
    const half = this.current.size / 2;
    return Math.max(-half + step, Math.min(half - step, Math.round(v / step) * step));
  }

  /** An Objective put at (x, z), snapped, with the level being edited as its `y` on a map of several levels (none on a map of one). */
  private placed(o: SourceObjective, x: number, z: number, levels: readonly number[]): SourceObjective {
    const { y: _y, ...rest } = o;
    const at = { ...rest, x: this.inside(x), z: this.inside(z) };
    return levels.length > 1 ? { ...at, y: this.level } : at;
  }

  /**
   * Place a new Objective at (x, z), snapped, last in the Battle's order, neutral, not a spawn, weight 1, with the level being edited as
   * its `y` on a map of several levels; it is selected. Throws TuningDataError, changing nothing, past MAX_OBJECTIVES.
   */
  addObjective(at: GroundPoint): SourceObjective {
    const s = this.current;
    let o = this.placed({ id: freshObjectiveId(s.objectives), x: 0, z: 0, weight: 1, owner: -1, spawn: false }, at.x, at.z, s.levels);
    // In mirror mode its twin stands at its half turn (one on the centre is its own), and the pair takes the middle of the Battle's order.
    let added = [o];
    if (s.mirror) {
      if (objectivesTwin(o, o)) added = [(o = linkedTo(o, o.id))];
      else {
        const twin = { ...turnObjective(o), id: freshObjectiveId([...s.objectives, o]) };
        added = [(o = linkedTo(o, twin.id)), linkedTo(twin, o.id)];
      }
    }
    if (s.objectives.length + added.length > MAX_OBJECTIVES) throw new TuningDataError(`a map holds at most ${MAX_OBJECTIVES} Objectives`);
    const objectives = [...s.objectives, ...added];
    this.apply({ ...s, objectives: s.mirror ? inMirrorOrder(objectives) : objectives });
    this.selectMarker({ kind: 'objective', id: o.id });
    return o;
  }

  /** Take the Objective `id` away; refused (the parser's error) for a map's last. */
  removeObjective(id: string): void {
    const s = this.current;
    const k = s.objectives.findIndex((o) => o.id === id);
    if (k < 0) throw new TuningDataError(`no Objective "${id}"`);
    // Its twin goes with it.
    const t = twinOf(s.objectives, k);
    this.apply({ ...s, objectives: s.objectives.filter((_, i) => i !== k && i !== t) });
  }

  /** Move the Objective `id` `delta` places in the Battle's order (Objective k is the half turn of n - 1 - k); clamped to the list. */
  reorderObjective(id: string, delta: number): void {
    const list = [...this.current.objectives];
    let k = list.findIndex((o) => o.id === id);
    if (k < 0) throw new TuningDataError(`no Objective "${id}"`);
    // In mirror mode the order stays mirrored: moving the second of a pair moves the first the other way, and the pair keeps k and n - 1 - k.
    const mirrored = this.current.mirror === true;
    if (mirrored && isSecond(list, k)) [k, delta] = [twinOf(list, k), -delta];
    const to = Math.max(0, Math.min(list.length - 1, k + delta));
    if (to === k) return;
    const [o] = list.splice(k, 1);
    list.splice(to, 0, o!);
    const next = mirrored ? inMirrorOrder(list) : list;
    if (next.every((v, i) => v === this.current.objectives[i])) return;
    this.apply({ ...this.current, objectives: next });
  }

  /** Replace the Objective `id` with `o` (the panel's edit; it may rename it, and the selection follows). Throws TuningDataError, changing nothing, where the parser refuses it. */
  replaceObjective(id: string, o: SourceObjective): void {
    const s = this.current;
    const k = s.objectives.findIndex((x) => x.id === id);
    if (k < 0) throw new TuningDataError(`no Objective "${id}"`);
    // The panel edits the Objective: its link stays its own, and its twin is made its half turn.
    const was = s.objectives[k]!;
    const edited = linkedTo(o, was.twin === undefined ? undefined : was.twin === was.id ? o.id : was.twin);
    if (JSON.stringify(edited) === JSON.stringify(was)) return;
    const selected = this.marker?.kind === 'objective' && this.marker.id === id;
    this.apply({ ...s, objectives: withTwinOf(s.objectives.map((x, i) => (i === k ? edited : x)), k, turnObjective, s.objectives) });
    if (selected) this.marker = { kind: 'objective', id: o.id };
  }

  /**
   * Drag the marker `m` by (dx, dz) from where it stood when the drag began, snapped and kept inside the field: an Objective (taking the
   * level being edited as its `y` on a map of several levels, once it moves) or a Base to there, a front line along z (`front` at least a step, and
   * short of the field's edge). Throws TuningDataError, changing nothing, where the parser refuses the result.
   */
  moveMarker(m: Marker, dx: number, dz: number): void {
    this.dragging((base) => {
      // Picked and let go where it stood (a click: the pointer moved less than half a step), it keeps its place (and its y) as it was.
      const still = Math.abs(dx) < base.grid.step / 2 && Math.abs(dz) < base.grid.step / 2;
      if (m.kind === 'objective') {
        const k = base.objectives.findIndex((o) => o.id === m.id);
        if (k < 0) throw new TuningDataError(`no Objective "${m.id}"`);
        const o = base.objectives[k]!;
        // One that is its own twin stays on the centre (its panel sets its level); a twin follows at the half turn.
        if (!still && o.twin === o.id) throw new TuningDataError(`Objective ${o.id} is its own twin, so it stays on the centre: set its level in its folder, or unlink it to move it`);
        const moved = still ? o : this.placed(o, o.x + dx, o.z + dz, base.levels);
        const objectives = withTwinOf(base.objectives.map((x, i) => (i === k ? moved : x)), k, turnObjective, base.objectives);
        this.dragToSource(base, { ...base, objectives }, still || JSON.stringify(objectives) === JSON.stringify(base.objectives));
      } else if (m.kind === 'prop') {
        const props = propsOf(base);
        const k = props.findIndex((p) => p.id === m.id);
        if (k < 0) throw new TuningDataError(`no prop "${m.id}"`);
        const p = props[k]!;
        const own = p.twin === p.id;
        const moved = still ? p : { ...p, x: own ? p.x : this.inside(p.x + dx), z: own ? p.z : this.inside(p.z + dz), y: this.level };
        const next = withTwinOf(props.map((x, i) => (i === k ? moved : x)), k, turnProp, props);
        this.dragToSource(base, withLook(base, { ...base.look, props: next }), still || JSON.stringify(next) === JSON.stringify(props));
      } else if (m.kind === 'base') {
        const b = base.bases[m.team]!;
        const moved = { x: this.inside(b.x + dx), z: this.inside(b.z + dz) };
        // A mirrored map's Bases are twins: the other Team's follows at the half turn.
        const other = base.mirror ? turnPoint(moved) : base.bases[1 - m.team]!;
        const bases: MapSource['bases'] = m.team === 0 ? [moved, other] : [other, moved];
        this.dragToSource(base, { ...base, bases }, still || (bases[0].x === base.bases[0].x && bases[0].z === base.bases[0].z && bases[1].x === base.bases[1].x && bases[1].z === base.bases[1].z));
      } else {
        // Team 0's line is at z = -front: dragging it north brings it in. Team 1's at +front.
        const { step } = base.grid;
        const front = Math.max(step, Math.min(base.size / 2 - step, Math.round((base.front + (m.team === 0 ? -dz : dz)) / step) * step));
        this.dragToSource(base, { ...base, front }, still || front === base.front);
      }
    });
  }

  /** Change the Lobby card: each part given replaces the card's, an empty one takes it away (the Lobby's own then shows). */
  setLobby(parts: Partial<Record<keyof SourceLobby, string>>): void {
    const card: Record<string, string> = { ...this.current.lobby };
    for (const [k, v] of Object.entries(parts)) {
      if (v === undefined) continue;
      if (v.trim() === '') delete card[k];
      else card[k] = v;
    }
    const { lobby: _old, ...rest } = this.current;
    this.replaceSettings(Object.keys(card).length > 0 ? { ...rest, lobby: card } : rest);
  }

  /** Set the sky and light the map is drawn under (undefined: the Battlefield's own, dusk). Render-only. */
  setSky(sky: BattleSky | undefined): void {
    this.replaceSettings(withLook(this.current, { ...this.current.look, sky }));
  }

  /** A prop id not yet taken: `<kind><n>`, the lowest n from 1. */
  private freshPropId(kind: PropKind, more: readonly SourceProp[] = []): string {
    const taken = new Set([...propsOf(this.current), ...more].map((p) => p.id));
    let n = 1;
    while (taken.has(`${kind}${n}`)) n++;
    return `${kind}${n}`;
  }

  /**
   * Place a new prop of `kind` at (x, z), snapped and kept inside the field, standing on the level being edited, facing north; it is selected.
   * Throws TuningDataError, changing nothing, past MAX_PROPS.
   */
  addProp(kind: PropKind, at: GroundPoint): SourceProp {
    const props = propsOf(this.current);
    let p: SourceProp = { id: this.freshPropId(kind), kind, x: this.inside(at.x), z: this.inside(at.z), y: this.level, turn: 0 };
    // In mirror mode its twin stands at its half turn, facing the other way (one on the centre is its own).
    let added = [p];
    if (this.current.mirror) {
      const twin = { ...turnProp(p), id: this.freshPropId(kind, [p]) };
      added = p.x === 0 && p.z === 0 ? [(p = linkedTo(p, p.id))] : [(p = linkedTo(p, twin.id)), linkedTo(twin, p.id)];
    }
    if (props.length + added.length > MAX_PROPS) throw new TuningDataError(`a map holds at most ${MAX_PROPS} props`);
    this.apply(withLook(this.current, { ...this.current.look, props: [...props, ...added] }));
    this.selectMarker({ kind: 'prop', id: p.id });
    return p;
  }

  /** Take the prop `id` away. */
  removeProp(id: string): void {
    const props = propsOf(this.current);
    const k = props.findIndex((p) => p.id === id);
    if (k < 0) throw new TuningDataError(`no prop "${id}"`);
    const t = twinOf(props, k);
    this.apply(withLook(this.current, { ...this.current.look, props: props.filter((_, i) => i !== k && i !== t) }));
  }

  /** Replace the prop `id` with `p` (the panel's edit; it may rename it, and the selection follows). Throws TuningDataError, changing nothing, where the parser refuses it. */
  replaceProp(id: string, p: SourceProp): void {
    const props = propsOf(this.current);
    const k = props.findIndex((x) => x.id === id);
    if (k < 0) throw new TuningDataError(`no prop "${id}"`);
    const was = props[k]!;
    const edited = linkedTo(p, was.twin === undefined ? undefined : was.twin === was.id ? p.id : was.twin);
    if (JSON.stringify(edited) === JSON.stringify(was)) return;
    const selected = this.marker?.kind === 'prop' && this.marker.id === id;
    this.apply(withLook(this.current, { ...this.current.look, props: withTwinOf(props.map((x, i) => (i === k ? edited : x)), k, turnProp, props) }));
    if (selected) this.marker = { kind: 'prop', id: p.id };
  }

  /** Set or clear (undefined: the Battle's own) the Tickets a Soldier starts with. */
  setTickets(perSoldier: number | undefined): void {
    const { ticketsPerSoldier: _old, ...rest } = this.current;
    this.replaceSettings(perSoldier === undefined ? rest : { ...rest, ticketsPerSoldier: perSoldier });
  }

  /**
   * What Save writes: the source and the map it compiles to for `battle`, as `data/battlemaps/<name>.source.json` and `<name>.json`, and
   * where its model goes.
   * Throws MapCompileError (naming the Brushes) where the source does not compile, so a map the game refuses is never written, and where
   * it is named after a map a generator builds (Save would write over that map's files and its model).
   */
  files(battle: Pick<BattleTuning, 'field' | 'deploy' | 'squad' | 'levels'>): MapFiles {
    const name = this.current.name;
    if (GENERATED_BATTLE_MAPS.includes(name)) throw new MapCompileError(`"${name}" is a shipped map built in art/ (Save would write over its files and model): rename the map`);
    const { map, warnings } = compileMap(this.current, battle);
    return {
      source: { fileName: `${name}.source.json`, path: `data/battlemaps/${name}.source.json`, text: sourceFileText(this.current) },
      map: { fileName: `${name}.json`, path: `data/battlemaps/${name}.json`, text: mapFileText(map) },
      model: { fileName: `battle_${name}.glb`, path: `public/models/arenas/battle_${name}.glb` },
      warnings,
    };
  }
}

/** The height of `levels` nearest `y` (the lower on a tie). */
function nearest(levels: readonly number[], y: number): number {
  let best = levels[0]!;
  for (const l of levels) if (Math.abs(l - y) < Math.abs(best - y)) best = l;
  return best;
}

/** `b` moved by (dx, dz). */
function shifted(b: Brush, dx: number, dz: number): Brush {
  if (isSegment(b)) return { ...b, a: { x: b.a.x + dx, z: b.a.z + dz }, b: { x: b.b.x + dx, z: b.b.z + dz } };
  const { x0, z0, x1, z1 } = b.rect;
  return { ...b, rect: { x0: x0 + dx, z0: z0 + dz, x1: x1 + dx, z1: z1 + dz } };
}
