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
 */
import type { BattleTuning } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import type { RepoFile } from '../editor/session';
import { compileMap, list, mapFileText, type CompileWarning } from './compile';
import { parseMapSource, MAP_SOURCE_VERSION, RAIL, type Brush, type BrushKind, type GroundPoint, type MapSource, type Rect, type Side } from './source';

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

/** The levels a Brush is drawn at: its floor's, both of a Ramp's, and a Wall's or Block's floor (the highest level under its top, at or under a Wall's foot + 1 m). */
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
  const body = [list('bases', s.bases), list('objectives', s.objectives), list('brushes', s.brushes)];
  return `{\n${[...head, ...body].join(',\n')}\n}\n`;
}

/** What Save writes: the Map Source and the map it compiles to, side by side in `data/battlemaps/`, and what the compiler noticed. */
export interface MapFiles {
  readonly source: RepoFile;
  readonly map: RepoFile;
  readonly warnings: readonly CompileWarning[];
}

/** The settings of a Map Source the editor changes apart from its Brushes and levels. */
export type MapSettings = Partial<Pick<MapSource, 'name' | 'objectives' | 'bases' | 'front' | 'armySize' | 'ticketsPerSoldier' | 'lobby'>>;

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
  }

  /** `v` on the fine grid, inside the field. */
  snap(v: number): number {
    const { step } = this.current.grid;
    const half = this.current.size / 2;
    return Math.max(-half, Math.min(half, Math.round(v / step) * step));
  }

  /** A Brush id not yet taken: `<kind><n>`, the lowest n from 1. */
  freshId(kind: BrushKind): string {
    const taken = new Set(this.current.brushes.map((b) => b.id));
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
    this.apply({ ...this.current, brushes: [...this.current.brushes, brush] });
    this.selected = id;
    return brush;
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

  private withBrush(k: number, brush: Brush, base: MapSource = this.current): MapSource {
    return { ...base, brushes: base.brushes.map((b, i) => (i === k ? brush : b)) };
  }

  /**
   * Replace the Brush `id` with `brush` (the property panel's edit; it may rename it, and the selection follows). A Ramp's rails keep only
   * its long sides, so turning it keeps it valid. Throws TuningDataError, changing nothing, where the parser refuses the result.
   */
  replaceBrush(id: string, brush: Brush): void {
    const k = this.indexOf(id);
    const b: Brush = brush.kind === 'ramp' ? { ...brush, rails: brush.rails.filter((s) => rampLongSides(brush.up).includes(s)) } : brush;
    const selected = this.selected === id;
    // Nothing changed (a panel writing back what it shows): no edit, no undo step.
    if (JSON.stringify(b) === JSON.stringify(this.current.brushes[k])) return;
    this.apply(this.withBrush(k, b));
    if (selected) this.selected = b.id;
  }

  deleteBrush(id: string): void {
    const k = this.indexOf(id);
    this.apply({ ...this.current, brushes: this.current.brushes.filter((_, i) => i !== k) });
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
    const copy = { ...shifted(b, dx, 0), id: this.freshId(b.kind) } as Brush;
    const brushes = [...this.current.brushes];
    brushes.splice(k + 1, 0, copy);
    this.apply({ ...this.current, brushes });
    this.selected = copy.id;
    return copy;
  }

  /** Move the Brush `id` `delta` places in paint order (later paints over earlier); clamped to the list. */
  reorder(id: string, delta: number): void {
    const k = this.indexOf(id);
    const to = Math.max(0, Math.min(this.current.brushes.length - 1, k + delta));
    if (to === k) return;
    const brushes = [...this.current.brushes];
    const [b] = brushes.splice(k, 1);
    brushes.splice(to, 0, b!);
    this.apply({ ...this.current, brushes });
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
    if (JSON.stringify(brush) === JSON.stringify(base.brushes[k])) {
      this.current = base;
      return;
    }
    this.apply(this.withBrush(k, brush, base));
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
        const other = handle === 'a' ? b.b : b.a;
        if (other.x === sx && other.z === sz) return;
        this.dragTo(base, k, { ...b, [handle]: { x: sx, z: sz } });
        return;
      }
      if (handle === 'a' || handle === 'b') return;
      const { step } = base.grid;
      let { x0, z0, x1, z1 } = b.rect;
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

  /** Change the map's settings (name, Objectives, Bases, `front`, army size, Tickets, Lobby card). Throws TuningDataError, changing nothing, where the parser refuses them. */
  setSettings(settings: MapSettings): void {
    const next = { ...this.current, ...settings };
    if (sourceFileText(next) === sourceFileText(this.current)) return;
    this.apply(next);
  }

  /**
   * What Save writes: the source and the map it compiles to for `battle`, as `data/battlemaps/<name>.source.json` and `<name>.json`.
   * Throws MapCompileError (naming the Brushes) where the source does not compile, so a map the game refuses is never written.
   */
  files(battle: Pick<BattleTuning, 'field' | 'deploy' | 'squad' | 'levels'>): MapFiles {
    const { map, warnings } = compileMap(this.current, battle);
    const name = this.current.name;
    return {
      source: { fileName: `${name}.source.json`, path: `data/battlemaps/${name}.source.json`, text: sourceFileText(this.current) },
      map: { fileName: `${name}.json`, path: `data/battlemaps/${name}.json`, text: mapFileText(map) },
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
