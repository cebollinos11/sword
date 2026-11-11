/**
 * The Map Editor's top view (docs/plans/map-editor.md, Stage 1): the field seen from above on a 2D canvas, north (+z) up and east (+x) to
 * the left. That is the way the game shows a Battle (the Battle's minimap, and the third-person camera looking along +z), so a map drawn here
 * is the map seen when it is played (decided in Stage 4; Stages 1 to 3 drew east on the right, which is the field seen from below). It draws
 * the fine grid (where it is wide enough to see) and the coarse grid (the destination fields' cell), each Brush by kind
 * in its level's colour (the level being edited solid, the others faded or hidden), the Objectives and Bases, and the selected Brush's
 * handles; and it turns the pointer into the session's operations: draw a Brush with the palette's tool, pick, move and resize with the
 * select tool, pan (right or middle drag, or a drag on empty ground) and zoom (the wheel). Over the Brushes it draws the live checks'
 * overlays (Stage 2, `overlays.ts`) for the floors shown: reachability (unreached floors flash), edges, clearance and the field's cell
 * centres. It only calls the session and reads the checks.
 *
 * Stage 3: the Battle's markers are picked and dragged with the select tool before any Brush (an Objective, a Base, either Team's front
 * line by its grips at the field's edges), and the Objective tool places a new Objective with a click. Each Objective is drawn with its capture circle and its `y`, each
 * front line across the field in its Team's colour.
 *
 * Stage 5: each prop is drawn as a small mark of its kind (a tree green, a torch orange…) and picked and dragged as a marker; the prop tool
 * places one of the kind `propKind` with a click, at the level being edited. Each Brush that names a material shows it in its label.
 *
 * Stage 6: in mirror mode the field's centre is marked (the half turn's), and the twin of the selected Brush, Objective or prop is outlined
 * dashed in cyan, so the part an edit also changes is in sight.
 *
 * The quick edits: a right click (a right press let go where it was pressed; a right drag still pans) asks `onContext` for the menu of what
 * lies there; Space held makes a left drag pan; in the select tool the Brush or marker a click would take is outlined under the pointer and
 * the cursor says what a drag does; a click again on the selected Brush, without moving, takes the next one under it (`brushesAt`); an
 * Alt-drag on a Brush moves a copy of it; a double click on a Brush drawn faded edits its level.
 */
import type { LevelsTuning, ObjectivesTuning } from '../../tuning';
import type { ClearanceNode, MapChecks } from '../checks';
import { boundsOf, brushesAt, brushLevels, FRONT_GRIP, handleAt, handlesOf, isSegment, markerAt, propsOf, sameMarker, type Handle, type MapEditorSession, type Marker } from '../session';
import type { Brush, BrushKind, GroundPoint, MapSource, PropKind, Rect } from '../source';
import { clearanceColour, EDGE_COLOURS, REACH_COLOURS, type Overlays } from './overlays';

/** The palette's tool: pick, move and resize Brushes and markers, draw a Brush of a kind, or place an Objective or a prop. */
export type Tool = 'select' | BrushKind | 'objective' | 'prop';

/** How a prop is marked in the top view: its colour and a letter. */
const PROP_MARKS: Readonly<Record<PropKind, { readonly colour: string; readonly letter: string }>> = {
  tree: { colour: '#3f9a3a', letter: 'T' },
  rubble: { colour: '#9a948a', letter: 'R' },
  banner: { colour: '#d04a4a', letter: 'B' },
  crate: { colour: '#b0844c', letter: 'C' },
  torch: { colour: '#ff9a30', letter: 'F' },
};
/** A prop's drawn size (px). */
const PROP_PX = 6;

/** A level's colour, by its place among the levels from the lowest. */
const LEVEL_COLOURS = ['#4f7fbf', '#5fa05a', '#c9a44a', '#b8673f', '#9a5fb0', '#4aa6a6', '#c05f7a', '#8a8f4a'];
const HAZARD_COLOURS: Readonly<Record<string, string>> = { lava: '#ff5a1f', water: '#2f7fe0', abyss: '#0b0b10' };
/** How near (px) the pointer must come to a handle or a segment to take it. */
const REACH_PX = 7;
const HANDLE_PX = 5;
/** An Objective's and a Base's drawn size (px): a click this near takes it. */
const MARKER_PX = 10;
/** The outline of the selected part's twin (Stage 6). */
const TWIN = '#5ee0ff';

/** The Teams' colours (Team 0, Team 1), as the markers are drawn. */
const TEAM = ['#e0c040', '#4080e0'];
/** The width (px) the panel covers on the right, and the share of the height the list of checks may cover at the bottom. */
export const PANEL_PX = 340;
const LIST_SHARE = 0.36;

interface Gesture {
  readonly kind: 'draw' | 'move' | 'resize' | 'pan' | 'marker';
  readonly start: GroundPoint;
  readonly screen: { x: number; y: number };
  readonly id?: string;
  readonly handle?: Handle;
  readonly marker?: Marker;
  readonly view?: { cx: number; cz: number };
  /** The pointer button that began it. */
  readonly button?: number;
  /** A move: whether its Brush was already selected when it was pressed (a still click then steps down the Brushes under it). */
  readonly reselect?: boolean;
}

/** How far (px) a press may wander and still be a click (a right click opens the menu; a click again steps down the Brushes). */
const CLICK_PX = 4;
const HANDLE_CURSORS: Readonly<Record<Handle, string>> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', a: 'move', b: 'move' };

export class TopView {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  /** The ground point at the canvas's centre, and pixels (CSS) a metre. */
  private view = { cx: 0, cz: 0, scale: 4 };
  private gesture: Gesture | null = null;
  private pointer: GroundPoint | null = null;
  private queued = false;
  /** Brushes the last compile refused, or the check picked from the list, outlined in red. */
  flagged: readonly string[] = [];
  /** The live checks of the source (Stage 2), the overlays switched on, and the destination fields' clearance once built. */
  checks: MapChecks | null = null;
  overlays: Overlays | null = null;
  clearance: readonly ClearanceNode[] | null = null;
  levels: LevelsTuning | null = null;
  /** The Battle's capture circles, to draw each Objective's. */
  objectiveRadii: Pick<ObjectivesTuning, 'radius' | 'spawnRadius'> | null = null;
  /** The kind of prop the prop tool places. */
  propKind: PropKind = 'tree';
  private flashing = false;
  /** False while the 3D view covers it: nothing is drawn, nor flashes. */
  shown = true;
  /** How much of the canvas's right side (px) the panel covers, which framing leaves clear (none when the 3D view sits beside it, in split). */
  panelPx = PANEL_PX;
  /** Held (Space): a left drag pans whatever the tool. */
  panHeld = false;
  /** A right click on the view, with the ground point under it (not snapped) and the screen point to open the menu at. */
  onContext: ((at: GroundPoint, clientX: number, clientY: number) => void) | null = null;
  /** The Brush or marker a click would take, outlined under the pointer (the select tool). */
  private hovered: { readonly brush?: string; readonly marker?: Marker } | null = null;
  /** Each Walk Surface's lowest and highest point, and their order from the lowest top, for the checks they were worked out for. */
  private spans: { readonly of: MapChecks; readonly span: readonly { lo: number; hi: number }[]; readonly order: readonly number[] } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly session: MapEditorSession,
    private readonly tool: () => Tool,
    /** Called after every edit the view makes (and with the error when the session refuses one). */
    private readonly changed: (error?: string) => void,
    /** Called as the pointer moves, with the ground point under it (snapped). */
    private readonly hover: (at: GroundPoint | null) => void,
  ) {
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair;touch-action:none';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.fit()).observe(this.canvas);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', () => this.cancel());
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.hovered = null;
      this.hover(null);
      this.redraw();
    });
    this.canvas.addEventListener('dblclick', (e) => this.double(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.frame(this.session.source);
  }

  /** Fit the whole field in the view, left of the panel and above the list of checks (so Team 0's Base and front line are in reach). */
  frame(source: MapSource): void {
    const w = Math.max(200, (this.canvas.clientWidth || 800) - this.panelPx);
    const h = this.canvas.clientHeight || 600;
    const open = h * (1 - LIST_SHARE);
    const scale = (0.94 * Math.min(w, open)) / source.size;
    this.view = { cx: -this.panelPx / 2 / scale, cz: -(h / 2 - open / 2) / scale, scale };
    this.redraw();
  }

  /** Fit `rect` (an issue's Brushes) in the view, left of the panel and above the list of checks (`LIST_SHARE` of the height), with room round it. */
  frameRect(rect: Rect): void {
    const w = Math.max(200, (this.canvas.clientWidth || 800) - this.panelPx);
    const h = this.canvas.clientHeight || 600;
    const open = h * (1 - LIST_SHARE);
    const span = Math.max(8, rect.x1 - rect.x0, rect.z1 - rect.z0) * 1.4;
    const scale = Math.min(200, Math.min(w, open) / span);
    this.view = { cx: (rect.x0 + rect.x1) / 2 - this.panelPx / 2 / scale, cz: (rect.z0 + rect.z1) / 2 - (h / 2 - open / 2) / scale, scale };
    this.redraw();
  }

  /** The ground point under the pointer (not snapped), or null when it is off the view. */
  get pointerAt(): GroundPoint | null {
    return this.pointer;
  }

  /** The Brushes a click at (x, z) picks from, top first: those at the level being edited, else (all levels shown) any level's. */
  pickStack(x: number, z: number): Brush[] {
    const s = this.session;
    const here = brushesAt(s.source, x, z, s.level, this.reach());
    if (here.length > 0 || !s.showAll) return here;
    return brushesAt(s.source, x, z, null, this.reach());
  }

  /** The marker a click at (x, z) takes, if one is there. */
  markerUnder(x: number, z: number): Marker | null {
    return markerAt(this.session.source, x, z, MARKER_PX / this.view.scale, this.reach());
  }

  /** Draw again at the next frame. */
  redraw(): void {
    if (this.queued || !this.shown) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
      // Unreached floors flash: keep drawing while any are shown.
      if (this.flashing) this.redraw();
    });
  }

  private fit(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.redraw();
  }

  private toGround(sx: number, sy: number): GroundPoint {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.view.cx - (sx - r.left - r.width / 2) / this.view.scale, z: this.view.cz - (sy - r.top - r.height / 2) / this.view.scale };
  }

  /** The x a world x is drawn at on the canvas as it is drawn on, which is mirrored (see `draw`): the screen's is `canvas.clientWidth` less this. */
  private sx(x: number): number {
    return this.canvas.clientWidth / 2 + (x - this.view.cx) * this.view.scale;
  }

  /** Text on the mirrored canvas, the right way round: its left edge (or its middle, as `textAlign` says) at the screen point (dx, dy) from where (wx, wy) is drawn. */
  private text(s: string, wx: number, wy: number, dx = 0, dy = 0, max?: number): void {
    const { ctx, canvas } = this;
    const dpr = canvas.width / (canvas.clientWidth || 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (max === undefined) ctx.fillText(s, canvas.clientWidth - wx + dx, wy + dy);
    else ctx.fillText(s, canvas.clientWidth - wx + dx, wy + dy, max);
    ctx.restore();
  }
  private sy(z: number): number {
    return this.canvas.clientHeight / 2 - (z - this.view.cz) * this.view.scale;
  }

  private reach(): number {
    return REACH_PX / this.view.scale;
  }

  /** Run a session edit, reporting a refusal rather than throwing. */
  private edit(f: () => void): void {
    try {
      f();
      this.changed();
    } catch (e) {
      this.changed(e instanceof Error ? e.message : String(e));
    }
    this.redraw();
  }

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toGround(e.clientX, e.clientY);
    const screen = { x: e.clientX, y: e.clientY };
    const pan: Gesture = { kind: 'pan', start: p, screen, view: { cx: this.view.cx, cz: this.view.cz } };
    if (e.button !== 0 || this.panHeld) {
      this.gesture = { ...pan, button: e.button };
      return;
    }
    const tool = this.tool();
    const s = this.session;
    if (tool === 'objective') {
      this.gesture = null;
      // On an Objective already there, the click selects it; off the field, it places nothing.
      const there = markerAt(s.source, p.x, p.z, MARKER_PX / this.view.scale, 0);
      const half = s.source.size / 2;
      if (there?.kind === 'objective') {
        s.selectMarker(there);
        this.changed();
      } else if (Math.abs(p.x) >= half || Math.abs(p.z) >= half) this.changed('Place an Objective on the field');
      else this.edit(() => s.addObjective(p));
      this.redraw();
      return;
    }
    if (tool === 'prop') {
      this.gesture = null;
      // On a prop already there, the click selects it; off the field, it places nothing.
      const there = markerAt(s.source, p.x, p.z, PROP_PX / this.view.scale, 0);
      const half = s.source.size / 2;
      if (there?.kind === 'prop') {
        s.selectMarker(there);
        this.changed();
      } else if (Math.abs(p.x) >= half || Math.abs(p.z) >= half) this.changed('Place a prop on the field');
      else this.edit(() => s.addProp(this.propKind, p));
      this.redraw();
      return;
    }
    if (tool !== 'select') {
      this.gesture = { kind: 'draw', start: p, screen };
      return;
    }
    const sel = s.selection;
    const handle = sel ? handleAt(sel, p.x, p.z, this.reach()) : null;
    if (sel && handle) {
      s.beginDrag();
      this.gesture = { kind: 'resize', start: p, screen, id: sel.id, handle };
      return;
    }
    // The markers are drawn over the Brushes, so they are picked first.
    const marker = this.markerUnder(p.x, p.z);
    if (marker) {
      s.selectMarker(marker);
      s.beginDrag();
      this.gesture = { kind: 'marker', start: p, screen, marker };
      this.changed();
      this.redraw();
      return;
    }
    // The selected Brush keeps the press when it is under it (one picked from under another stays the one dragged).
    const stack = this.pickStack(p.x, p.z);
    const picked = stack.find((b) => b.id === s.selected) ?? stack[0] ?? null;
    if (!picked) {
      s.select(null);
      s.selectMarker(null);
      this.changed();
      this.gesture = pan;
      this.redraw();
      return;
    }
    const reselect = s.selected === picked.id;
    s.select(picked.id);
    // A Brush that is its own twin stays centred (Stage 6): a drag on it pans, as one on the ground did before.
    if (picked.twin === picked.id && !e.altKey) {
      this.gesture = { ...pan, button: 0, id: picked.id, reselect };
      this.changed();
      this.redraw();
      return;
    }
    // Alt: drag a copy of it away, leaving it where it is (the copy is one undo step, the drag another).
    let id = picked.id;
    if (e.altKey) {
      try {
        id = s.duplicateBrush(picked.id, true).id;
      } catch (err) {
        this.changed(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    s.beginDrag();
    this.gesture = { kind: 'move', start: p, screen, id, reselect: reselect && !e.altKey };
    this.changed();
    this.redraw();
  }

  private move(e: PointerEvent): void {
    const p = this.toGround(e.clientX, e.clientY);
    this.pointer = p;
    this.hover({ x: this.session.snap(p.x), z: this.session.snap(p.z) });
    const g = this.gesture;
    if (!g) {
      this.updateHover(p, e.altKey);
      this.redraw();
      return;
    }
    if (g.kind === 'pan') {
      this.view.cx = g.view!.cx + (e.clientX - g.screen.x) / this.view.scale;
      this.view.cz = g.view!.cz + (e.clientY - g.screen.y) / this.view.scale;
    } else if (g.kind === 'move') {
      this.edit(() => this.session.moveBrush(g.id!, p.x - g.start.x, p.z - g.start.z));
    } else if (g.kind === 'resize') {
      this.edit(() => this.session.resizeBrush(g.id!, g.handle!, p.x, p.z));
    } else if (g.kind === 'marker') {
      this.edit(() => this.session.moveMarker(g.marker!, p.x - g.start.x, p.z - g.start.z));
    }
    this.redraw();
  }

  private up(e: PointerEvent): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const still = Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) <= CLICK_PX;
    if (g.kind === 'pan' && g.button === 2 && still) {
      this.onContext?.(this.toGround(e.clientX, e.clientY), e.clientX, e.clientY);
    } else if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'marker' || (g.kind === 'pan' && g.reselect !== undefined)) {
      if (g.kind !== 'pan') this.session.endDrag();
      // A click again on the selected Brush, without moving it: the next Brush under the pointer.
      if (still && g.reselect && g.id !== undefined) {
        const stack = this.pickStack(g.start.x, g.start.z);
        const k = stack.findIndex((b) => b.id === g.id);
        if (stack.length > 1 && k >= 0) this.session.select(stack[(k + 1) % stack.length]!.id);
      }
      this.changed();
    } else if (g.kind === 'draw') {
      const p = this.toGround(e.clientX, e.clientY);
      const tool = this.tool();
      if (tool !== 'select' && tool !== 'objective' && tool !== 'prop') this.edit(() => this.session.addBrush(tool, g.start, p));
    }
    this.redraw();
  }

  /** The browser took the pointer away: end a drag where it stands, and draw nothing. */
  private cancel(): void {
    const g = this.gesture;
    this.gesture = null;
    if (g?.kind === 'move' || g?.kind === 'resize' || g?.kind === 'marker') {
      this.session.endDrag();
      this.changed();
    }
    this.redraw();
  }

  /** A double click on a Brush shown faded (another level's): select it and edit its level. */
  private double(e: MouseEvent): void {
    if (this.tool() !== 'select') return;
    const p = this.toGround(e.clientX, e.clientY);
    const s = this.session;
    // Only another level's Brushes are under it (the level being edited's are picked first): the top one of them.
    const b = this.pickStack(p.x, p.z)[0];
    if (!b) return;
    const levels = brushLevels(b, s.source.levels);
    if (levels.includes(s.level)) return;
    s.select(b.id);
    s.level = levels[0]!;
    this.changed();
    this.redraw();
  }

  /** The select tool's hover: what a press would take, outlined, and the cursor for what a drag does. */
  private updateHover(p: GroundPoint, alt: boolean): void {
    const tool = this.tool();
    if (this.panHeld) {
      this.canvas.style.cursor = 'grab';
      this.hovered = null;
      return;
    }
    if (tool !== 'select') {
      this.canvas.style.cursor = 'crosshair';
      this.hovered = null;
      return;
    }
    const s = this.session;
    const sel = s.selection;
    const handle = sel ? handleAt(sel, p.x, p.z, this.reach()) : null;
    if (sel && handle) {
      this.canvas.style.cursor = HANDLE_CURSORS[handle];
      this.hovered = null;
      return;
    }
    const marker = this.markerUnder(p.x, p.z);
    if (marker) {
      this.canvas.style.cursor = marker.kind === 'front' ? 'ns-resize' : 'move';
      this.hovered = { marker };
      return;
    }
    const stack = this.pickStack(p.x, p.z);
    const b = stack.find((x) => x.id === s.selected) ?? stack[0];
    this.hovered = b ? { brush: b.id } : null;
    this.canvas.style.cursor = !b ? 'grab' : alt ? 'copy' : b.twin === b.id ? 'pointer' : 'move';
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const before = this.toGround(e.clientX, e.clientY);
    const size = this.session.source.size;
    const min = (0.2 * Math.min(this.canvas.clientWidth, this.canvas.clientHeight)) / size;
    this.view.scale = Math.max(min, Math.min(200, this.view.scale * Math.exp(-e.deltaY * 0.0015)));
    const after = this.toGround(e.clientX, e.clientY);
    this.view.cx += before.x - after.x;
    this.view.cz += before.z - after.z;
    this.redraw();
  }

  private draw(): void {
    const { ctx, canvas, session } = this;
    const source = session.source;
    const dpr = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1e24';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    // The world is drawn mirrored left to right (east is on the left, as the game's minimap shows it): its x runs toward the screen's left.
    ctx.setTransform(-dpr, 0, 0, dpr, canvas.width, 0);
    const half = source.size / 2;
    ctx.fillStyle = '#262a32';
    ctx.fillRect(this.sx(-half), this.sy(half), source.size * this.view.scale, source.size * this.view.scale);

    for (const b of source.brushes) this.drawBrush(b, source);
    this.drawOverlays();
    this.drawGrid(source);
    this.drawMarkers(source);

    const sel = session.selection;
    const hb = this.hovered?.brush;
    if (hb !== undefined && hb !== sel?.id && !this.gesture) {
      const b = source.brushes.find((x) => x.id === hb);
      if (b) {
        ctx.globalAlpha = 0.8;
        this.outline(b, '#ffffff', 1.5);
        ctx.globalAlpha = 1;
      }
    }
    for (const id of this.flagged) {
      const b = source.brushes.find((x) => x.id === id);
      if (b) this.outline(b, '#ff3b3b', 3);
    }
    if (sel) {
      // Its twin (Stage 6), dashed: the Brush an edit of this one changes too.
      const twin = sel.twin !== undefined && sel.twin !== sel.id ? source.brushes.find((x) => x.id === sel.twin) : undefined;
      if (twin) {
        ctx.setLineDash([6, 4]);
        this.outline(twin, TWIN, 2);
        ctx.setLineDash([]);
      }
      this.outline(sel, '#ffe14d', 2);
      ctx.fillStyle = '#ffe14d';
      for (const h of handlesOf(sel)) ctx.fillRect(this.sx(h.x) - HANDLE_PX, this.sy(h.z) - HANDLE_PX, 2 * HANDLE_PX, 2 * HANDLE_PX);
    }
    // The Brush being drawn.
    const g = this.gesture;
    if (g?.kind === 'draw' && this.pointer) {
      const a = { x: session.snap(g.start.x), z: session.snap(g.start.z) };
      const b = { x: session.snap(this.pointer.x), z: session.snap(this.pointer.z) };
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (this.tool() === 'rail' || this.tool() === 'wall') {
        ctx.moveTo(this.sx(a.x), this.sy(a.z));
        ctx.lineTo(this.sx(b.x), this.sy(b.z));
      } else {
        ctx.rect(this.sx(Math.min(a.x, b.x)), this.sy(Math.max(a.z, b.z)), Math.abs(b.x - a.x) * this.view.scale, Math.abs(b.z - a.z) * this.view.scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Whether a floor between heights `lo` and `hi` is shown: every one with all levels shown, else those at the level being edited. */
  private shownAt(lo: number, hi: number): boolean {
    if (this.session.showAll) return true;
    const y = this.session.level;
    const near = this.levels?.stepUp ?? 0.35;
    return lo - near <= y && y <= hi + near;
  }

  private polygon(points: readonly { x: number; z: number }[]): void {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, k) => (k === 0 ? ctx.moveTo(this.sx(p.x), this.sy(p.z)) : ctx.lineTo(this.sx(p.x), this.sy(p.z))));
    ctx.closePath();
  }

  /** The live checks' overlays that are switched on, for the floors shown, lower floors first. */
  private drawOverlays(): void {
    const { ctx } = this;
    const checks = this.checks;
    const on = this.overlays;
    this.flashing = false;
    const draft = checks?.draft;
    if (!checks || !on || !draft) return;
    const walk = draft.map.walk;
    if (this.spans?.of !== checks) {
      const span = walk.map((w) => {
        const ys = w.points.map((p) => p.y);
        return { lo: Math.min(...ys), hi: Math.max(...ys) };
      });
      this.spans = { of: checks, span, order: walk.map((_, i) => i).sort((a, b) => span[a]!.hi - span[b]!.hi || a - b) };
    }
    const { span, order } = this.spans;
    if (on.reach) {
      const pulse = 0.3 + 0.3 * Math.sin(performance.now() / 160);
      for (const i of order) {
        const r = checks.reach[i]!;
        if (r === 'deadly' || !this.shownAt(span[i]!.lo, span[i]!.hi)) continue;
        const lost = r !== 'reached';
        this.flashing ||= lost;
        ctx.globalAlpha = lost ? 0.25 + pulse : 0.16;
        ctx.fillStyle = REACH_COLOURS[r];
        this.polygon(walk[i]!.points);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (on.clearance && this.clearance) {
      const half = (checks.centres.cell / 2) * 0.84 * this.view.scale;
      const nodes = this.clearance.filter((n) => this.shownAt(n.y, n.y)).sort((a, b) => a.y - b.y);
      ctx.globalAlpha = 0.55;
      for (const n of nodes) {
        ctx.fillStyle = clearanceColour(n);
        ctx.fillRect(this.sx(n.x) - half, this.sy(n.z) - half, 2 * half, 2 * half);
      }
      ctx.globalAlpha = 1;
    }
    if (on.edges) {
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (const e of checks.edges) {
        if (!on.edgeKinds[e.kind] || !this.shownAt(span[e.surface]!.lo, span[e.surface]!.hi)) continue;
        ctx.strokeStyle = EDGE_COLOURS[e.kind];
        ctx.beginPath();
        ctx.moveTo(this.sx(e.a.x), this.sy(e.a.z));
        ctx.lineTo(this.sx(e.b.x), this.sy(e.b.z));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    if (on.centres) {
      const { cell, layered, hits } = checks.centres;
      const half = checks.source.size / 2;
      // Every centre as a faint dot where they are far enough apart to see, the ones a Wall cuts off in red.
      if (cell * this.view.scale >= 6) {
        ctx.fillStyle = layered ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)';
        for (let z = -Math.floor(half / cell) * cell; z <= half; z += cell)
          for (let x = -Math.floor(half / cell) * cell; x <= half; x += cell) ctx.fillRect(this.sx(x) - 1, this.sy(z) - 1, 2, 2);
      }
      ctx.fillStyle = '#ff3b3b';
      for (const h of hits) {
        if (!this.shownAt(h.y, h.y)) continue;
        ctx.beginPath();
        ctx.arc(this.sx(h.x), this.sy(h.z), 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  private drawGrid(source: MapSource): void {
    const { ctx } = this;
    const half = source.size / 2;
    const line = (every: number, style: string) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = Math.round(source.size / every);
      for (let k = 0; k <= n; k++) {
        const v = -half + k * every;
        ctx.moveTo(Math.round(this.sx(v)) + 0.5, this.sy(half));
        ctx.lineTo(Math.round(this.sx(v)) + 0.5, this.sy(-half));
        ctx.moveTo(this.sx(-half), Math.round(this.sy(v)) + 0.5);
        ctx.lineTo(this.sx(half), Math.round(this.sy(v)) + 0.5);
      }
      ctx.stroke();
    };
    if (source.grid.step * this.view.scale >= 6) line(source.grid.step, 'rgba(255,255,255,0.05)');
    line(source.grid.cell, 'rgba(255,255,255,0.12)');
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(this.sx(0), this.sy(half));
    ctx.lineTo(this.sx(0), this.sy(-half));
    ctx.moveTo(this.sx(-half), this.sy(0));
    ctx.lineTo(this.sx(half), this.sy(0));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(this.sx(-half), this.sy(half), source.size * this.view.scale, source.size * this.view.scale);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px system-ui, sans-serif';
    this.text('N (+z) ↑   E (+x) ←', this.sx(0), this.sy(half), 4, 14);
  }

  /** How strongly the Brush is drawn: 1 at the level being edited, faded at the others (or hidden when only that level is shown). */
  private alphaOf(b: Brush, source: MapSource): number {
    if (brushLevels(b, source.levels).includes(this.session.level)) return 1;
    return this.session.showAll ? 0.28 : 0;
  }

  private colourOf(b: Brush, source: MapSource): string {
    if (b.kind === 'hazard') return HAZARD_COLOURS[b.hazard]!;
    const y = b.kind === 'ramp' ? b.hi : brushLevels(b, source.levels)[0]!;
    return LEVEL_COLOURS[source.levels.indexOf(y) % LEVEL_COLOURS.length]!;
  }

  private drawBrush(b: Brush, source: MapSource): void {
    const alpha = this.alphaOf(b, source);
    if (alpha === 0) return;
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    const colour = this.colourOf(b, source);
    if (isSegment(b)) {
      ctx.strokeStyle = b.kind === 'wall' ? '#e8e8e8' : colour;
      ctx.lineWidth = b.kind === 'wall' ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(this.sx(b.a.x), this.sy(b.a.z));
      ctx.lineTo(this.sx(b.b.x), this.sy(b.b.z));
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    const { x0, z0, x1, z1 } = b.rect;
    const x = this.sx(x0);
    const y = this.sy(z1);
    const w = (x1 - x0) * this.view.scale;
    const h = (z1 - z0) * this.view.scale;
    ctx.fillStyle = b.kind === 'hole' ? 'rgba(10,10,12,0.7)' : b.kind === 'block' ? '#8a8a8a' : colour;
    ctx.globalAlpha = alpha * (b.kind === 'floor' && b.id === source.brushes[0]?.id ? 0.55 : 0.85);
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = b.kind === 'platform' || b.kind === 'block' ? 3 : 1;
    ctx.setLineDash(b.kind === 'deck' || b.kind === 'hole' ? [5, 4] : []);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    if (b.kind === 'deck') {
      // Hatched: there is open space under it.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.beginPath();
      for (let d = -h; d < w; d += 10) {
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (b.kind === 'hole' || b.kind === 'block') {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h);
      ctx.stroke();
    } else if (b.kind === 'ramp') {
      // Chevrons pointing up the slope.
      const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[b.up] as [number, number];
      const cx = x + w / 2;
      const cy = y + h / 2;
      const len = Math.min(w, h) * 0.3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      for (const off of [-0.6, 0, 0.6]) {
        const ox = cx + dx * off * Math.max(w, h) * 0.3;
        const oy = cy + dy * off * Math.max(w, h) * 0.3;
        ctx.beginPath();
        ctx.moveTo(ox - dx * len * 0.5 - dy * len, oy - dy * len * 0.5 + dx * len);
        ctx.lineTo(ox + dx * len * 0.5, oy + dy * len * 0.5);
        ctx.lineTo(ox - dx * len * 0.5 + dy * len, oy - dy * len * 0.5 - dx * len);
        ctx.stroke();
      }
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = 2.5;
      for (const side of b.rails) {
        ctx.beginPath();
        if (side === 'e' || side === 'w') {
          const sx = side === 'e' ? x + w : x;
          ctx.moveTo(sx, y);
          ctx.lineTo(sx, y + h);
        } else {
          const sy = side === 'n' ? y : y + h;
          ctx.moveTo(x, sy);
          ctx.lineTo(x + w, sy);
        }
        ctx.stroke();
      }
    } else if (b.kind === 'enclosure') {
      // Its Walls, white and thick, broken where each doorway is (centred along its side).
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 4;
      const s = this.view.scale;
      const line = (ax: number, ay: number, bx: number, by: number) => {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      };
      ctx.beginPath();
      for (const side of ['n', 'e', 's', 'w'] as const) {
        const along = side === 'n' || side === 's';
        const len = along ? w : h;
        const door = Math.min(len, (b.doors[side] ?? 0) * s);
        const gap0 = (len - door) / 2;
        const gap1 = (len + door) / 2;
        const sy = side === 'n' ? y : y + h;
        const sx = side === 'e' ? x + w : x;
        for (const [p0, p1] of door > 0 ? [[0, gap0], [gap1, len]] : [[0, len]]) {
          if (p1! - p0! <= 0) continue;
          if (along) line(x + p0!, sy, x + p1!, sy);
          else line(sx, y + p0!, sx, y + p1!);
        }
      }
      ctx.stroke();
    }
    if (w > 40 && h > 16) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '11px system-ui, sans-serif';
      const label = b.id === source.brushes[0]?.id && w > this.canvas.clientWidth ? '' : `${b.id}${heightLabel(b)}${b.material ? ` · ${b.material}` : ''}`;
      this.text(label, x, y, 4 - w, 13, w - 8);
    }
    ctx.globalAlpha = 1;
  }

  private outline(b: Brush, colour: string, width: number): void {
    const { ctx } = this;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (isSegment(b)) {
      ctx.moveTo(this.sx(b.a.x), this.sy(b.a.z));
      ctx.lineTo(this.sx(b.b.x), this.sy(b.b.z));
    } else {
      const r = boundsOf(b);
      ctx.rect(this.sx(r.x0), this.sy(r.z1), (r.x1 - r.x0) * this.view.scale, (r.z1 - r.z0) * this.view.scale);
    }
    ctx.stroke();
  }

  /**
   * The markers: each Team's front line across the field (its army's front rank deploys there), each Objective (its letter in a circle
   * ringed by its starting Owner, thicker for a spawn, its capture circle round it and its `y` under it) and the two Bases; the selected
   * one ringed in yellow.
   */
  private drawMarkers(source: MapSource): void {
    const { ctx } = this;
    const half = source.size / 2;
    const picked = this.session.marker;
    const isPicked = (m: Marker) => sameMarker(picked, m);
    // The twin of the picked Objective or prop (Stage 6), ringed dashed in cyan, and the Bases' each other's in a mirrored map.
    const twinOf = (m: Marker): boolean => {
      if (!picked || picked.kind !== m.kind) return false;
      if (m.kind === 'base') return source.mirror === true && picked.kind === 'base' && picked.team !== m.team;
      if (m.kind !== 'objective' && m.kind !== 'prop') return false;
      const list: readonly { id: string; twin?: string }[] = m.kind === 'objective' ? source.objectives : propsOf(source);
      const p = list.find((v) => v.id === (picked as { id: string }).id);
      return p !== undefined && p.twin !== p.id && p.twin === m.id;
    };
    const twinRing = (x: number, y: number, r: number) => {
      ctx.strokeStyle = TWIN;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (source.mirror) {
      // The centre the map turns about.
      const cx = this.sx(0);
      const cy = this.sy(0);
      ctx.strokeStyle = TWIN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy);
      ctx.lineTo(cx + 9, cy);
      ctx.moveTo(cx, cy - 9);
      ctx.lineTo(cx, cy + 9);
      ctx.stroke();
      twinRing(cx, cy, 6);
    }
    ctx.font = 'bold 12px system-ui, sans-serif';
    ([0, 1] as const).forEach((team) => {
      const y = this.sy(team === 0 ? -source.front : source.front);
      const on = isPicked({ kind: 'front', team });
      ctx.strokeStyle = on ? '#ffe14d' : TEAM[team]!;
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(this.sx(-half), y);
      ctx.lineTo(this.sx(half), y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Its grips at the field's edges, where it is picked (FRONT_GRIP).
      ctx.fillStyle = on ? '#ffe14d' : TEAM[team]!;
      const grip = FRONT_GRIP * this.view.scale;
      ctx.fillRect(this.sx(-half), y - 3, grip, 6);
      ctx.fillRect(this.sx(half) - grip, y - 3, grip, 6);
      this.text(`Team ${team} front (${team === 0 ? -source.front : source.front})`, this.sx(half), y, 6, team === 0 ? 14 : -5);
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const radii = this.objectiveRadii;
    for (const o of source.objectives) {
      const x = this.sx(o.x);
      const y = this.sy(o.z);
      if (radii) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, (o.spawn ? radii.spawnRadius : radii.radius) * this.view.scale, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, MARKER_PX, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = o.owner < 0 ? '#555' : TEAM[o.owner]!;
      ctx.lineWidth = o.spawn ? 3 : 1.5;
      ctx.stroke();
      if (twinOf({ kind: 'objective', id: o.id })) twinRing(x, y, MARKER_PX + 4);
      if (isPicked({ kind: 'objective', id: o.id })) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, MARKER_PX + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = '#111';
      this.text(o.id, x, y, 0, 0.5);
      if (o.y !== undefined) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '10px system-ui, sans-serif';
        this.text(`y ${o.y}`, x, y, 0, MARKER_PX + 8);
        ctx.font = 'bold 12px system-ui, sans-serif';
      }
    }
    // The props: a small mark of each one's kind, faded off the level being edited; the selected one ringed.
    for (const p of propsOf(source)) {
      const x = this.sx(p.x);
      const y = this.sy(p.z);
      const mark = PROP_MARKS[p.kind];
      ctx.globalAlpha = p.y === this.session.level ? 1 : 0.45;
      ctx.fillStyle = mark.colour;
      ctx.beginPath();
      ctx.arc(x, y, PROP_PX, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = 'bold 8px system-ui, sans-serif';
      ctx.fillStyle = '#111';
      this.text(mark.letter, x, y, 0, 0.5);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.globalAlpha = 1;
      if (twinOf({ kind: 'prop', id: p.id })) twinRing(x, y, PROP_PX + 3);
      if (isPicked({ kind: 'prop', id: p.id })) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, PROP_PX + 3, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    source.bases.forEach((b, t) => {
      const x = this.sx(b.x);
      const y = this.sy(b.z);
      ctx.fillStyle = TEAM[t]!;
      ctx.fillRect(x - 8, y - 8, 16, 16);
      if (twinOf({ kind: 'base', team: t as 0 | 1 })) twinRing(x, y, 13);
      if (isPicked({ kind: 'base', team: t as 0 | 1 })) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x - 11, y - 11, 22, 22);
      }
      ctx.fillStyle = '#111';
      this.text(String(t), x, y, 0, 0.5);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

/** A Brush's heights as its label shows them. */
function heightLabel(b: Brush): string {
  switch (b.kind) {
    case 'ramp':
      return ` ${b.lo}→${b.hi}`;
    case 'platform':
    case 'block':
      return ` ▲${b.top}`;
    case 'rail':
    case 'wall':
      return '';
    case 'enclosure':
      return ` ⌂@${b.y}`;
    default:
      return ` @${b.y}`;
  }
}
