/**
 * The Map Editor's top view (docs/plans/map-editor.md, Stage 1): the field seen from above on a 2D canvas, north (+z) up and east (+x)
 * right. It draws the fine grid (where it is wide enough to see) and the coarse grid (the destination fields' cell), each Brush by kind
 * in its level's colour (the level being edited solid, the others faded or hidden), the Objectives and Bases, and the selected Brush's
 * handles; and it turns the pointer into the session's operations: draw a Brush with the palette's tool, pick, move and resize with the
 * select tool, pan (right or middle drag, or a drag on empty ground) and zoom (the wheel). Over the Brushes it draws the live checks'
 * overlays (Stage 2, `overlays.ts`) for the floors shown: reachability (unreached floors flash), edges, clearance and the field's cell
 * centres. It only calls the session and reads the checks.
 *
 * Stage 3: the Battle's markers are picked and dragged with the select tool before any Brush (an Objective, a Base, either Team's front
 * line by its grips at the field's edges), and the Objective tool places a new Objective with a click. Each Objective is drawn with its capture circle and its `y`, each
 * front line across the field in its Team's colour.
 */
import type { LevelsTuning, ObjectivesTuning } from '../../tuning';
import type { ClearanceNode, MapChecks } from '../checks';
import { boundsOf, brushAt, brushLevels, FRONT_GRIP, handleAt, handlesOf, isSegment, markerAt, sameMarker, type Handle, type MapEditorSession, type Marker } from '../session';
import type { Brush, BrushKind, GroundPoint, MapSource, Rect } from '../source';
import { clearanceColour, EDGE_COLOURS, REACH_COLOURS, type Overlays } from './overlays';

/** The palette's tool: pick, move and resize Brushes and markers, draw a Brush of a kind, or place an Objective. */
export type Tool = 'select' | BrushKind | 'objective';

/** A level's colour, by its place among the levels from the lowest. */
const LEVEL_COLOURS = ['#4f7fbf', '#5fa05a', '#c9a44a', '#b8673f', '#9a5fb0', '#4aa6a6', '#c05f7a', '#8a8f4a'];
const HAZARD_COLOURS: Readonly<Record<string, string>> = { lava: '#ff5a1f', water: '#2f7fe0', abyss: '#0b0b10' };
/** How near (px) the pointer must come to a handle or a segment to take it. */
const REACH_PX = 7;
const HANDLE_PX = 5;
/** An Objective's and a Base's drawn size (px): a click this near takes it. */
const MARKER_PX = 10;
/** The Teams' colours (Team 0, Team 1), as the markers are drawn. */
const TEAM = ['#e0c040', '#4080e0'];
/** The width (px) the panel covers on the right, and the share of the height the list of checks may cover at the bottom. */
const PANEL_PX = 340;
const LIST_SHARE = 0.36;

interface Gesture {
  readonly kind: 'draw' | 'move' | 'resize' | 'pan' | 'marker';
  readonly start: GroundPoint;
  readonly screen: { x: number; y: number };
  readonly id?: string;
  readonly handle?: Handle;
  readonly marker?: Marker;
  readonly view?: { cx: number; cz: number };
}

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
  private flashing = false;
  /** False while the 3D view covers it: nothing is drawn, nor flashes. */
  shown = true;
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
      this.hover(null);
    });
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.frame(this.session.source);
  }

  /** Fit the whole field in the view, left of the panel and above the list of checks (so Team 0's Base and front line are in reach). */
  frame(source: MapSource): void {
    const w = Math.max(200, (this.canvas.clientWidth || 800) - PANEL_PX);
    const h = this.canvas.clientHeight || 600;
    const open = h * (1 - LIST_SHARE);
    const scale = (0.94 * Math.min(w, open)) / source.size;
    this.view = { cx: PANEL_PX / 2 / scale, cz: -(h / 2 - open / 2) / scale, scale };
    this.redraw();
  }

  /** Fit `rect` (an issue's Brushes) in the view, left of the panel and above the list of checks (`LIST_SHARE` of the height), with room round it. */
  frameRect(rect: Rect): void {
    const w = Math.max(200, (this.canvas.clientWidth || 800) - PANEL_PX);
    const h = this.canvas.clientHeight || 600;
    const open = h * (1 - LIST_SHARE);
    const span = Math.max(8, rect.x1 - rect.x0, rect.z1 - rect.z0) * 1.4;
    const scale = Math.min(200, Math.min(w, open) / span);
    this.view = { cx: (rect.x0 + rect.x1) / 2 + PANEL_PX / 2 / scale, cz: (rect.z0 + rect.z1) / 2 - (h / 2 - open / 2) / scale, scale };
    this.redraw();
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
    return { x: this.view.cx + (sx - r.left - r.width / 2) / this.view.scale, z: this.view.cz - (sy - r.top - r.height / 2) / this.view.scale };
  }

  private sx(x: number): number {
    return this.canvas.clientWidth / 2 + (x - this.view.cx) * this.view.scale;
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
    if (e.button !== 0) {
      this.gesture = pan;
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
    const marker = markerAt(s.source, p.x, p.z, MARKER_PX / this.view.scale, this.reach());
    if (marker) {
      s.selectMarker(marker);
      s.beginDrag();
      this.gesture = { kind: 'marker', start: p, screen, marker };
      this.changed();
      this.redraw();
      return;
    }
    const picked = brushAt(s.source, p.x, p.z, s.level, this.reach()) ?? (s.showAll ? brushAt(s.source, p.x, p.z, null, this.reach()) : null);
    if (!picked) {
      s.select(null);
      s.selectMarker(null);
      this.changed();
      this.gesture = pan;
      this.redraw();
      return;
    }
    s.select(picked.id);
    s.beginDrag();
    this.gesture = { kind: 'move', start: p, screen, id: picked.id };
    this.changed();
    this.redraw();
  }

  private move(e: PointerEvent): void {
    const p = this.toGround(e.clientX, e.clientY);
    this.pointer = p;
    this.hover({ x: this.session.snap(p.x), z: this.session.snap(p.z) });
    const g = this.gesture;
    if (!g) {
      this.redraw();
      return;
    }
    if (g.kind === 'pan') {
      this.view.cx = g.view!.cx - (e.clientX - g.screen.x) / this.view.scale;
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
    if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'marker') {
      this.session.endDrag();
      this.changed();
    } else if (g.kind === 'draw') {
      const p = this.toGround(e.clientX, e.clientY);
      const tool = this.tool();
      if (tool !== 'select' && tool !== 'objective') this.edit(() => this.session.addBrush(tool, g.start, p));
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
    const half = source.size / 2;
    ctx.fillStyle = '#262a32';
    ctx.fillRect(this.sx(-half), this.sy(half), source.size * this.view.scale, source.size * this.view.scale);

    for (const b of source.brushes) this.drawBrush(b, source);
    this.drawOverlays();
    this.drawGrid(source);
    this.drawMarkers(source);

    const sel = session.selection;
    for (const id of this.flagged) {
      const b = source.brushes.find((x) => x.id === id);
      if (b) this.outline(b, '#ff3b3b', 3);
    }
    if (sel) {
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
    ctx.fillText('N (+z) ↑', this.sx(0) + 4, this.sy(half) + 14);
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
    }
    if (w > 40 && h > 16) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '11px system-ui, sans-serif';
      const label = b.id === source.brushes[0]?.id && w > this.canvas.clientWidth ? '' : `${b.id}${heightLabel(b)}`;
      ctx.fillText(label, x + 4, y + 13, w - 8);
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
      ctx.fillText(`Team ${team} front (${team === 0 ? -source.front : source.front})`, this.sx(-half) + 6, y + (team === 0 ? 14 : -5));
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
      if (isPicked({ kind: 'objective', id: o.id })) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, MARKER_PX + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = '#111';
      ctx.fillText(o.id, x, y + 0.5);
      if (o.y !== undefined) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(`y ${o.y}`, x, y + MARKER_PX + 8);
        ctx.font = 'bold 12px system-ui, sans-serif';
      }
    }
    source.bases.forEach((b, t) => {
      const x = this.sx(b.x);
      const y = this.sy(b.z);
      ctx.fillStyle = TEAM[t]!;
      ctx.fillRect(x - 8, y - 8, 16, 16);
      if (isPicked({ kind: 'base', team: t as 0 | 1 })) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x - 11, y - 11, 22, 22);
      }
      ctx.fillStyle = '#111';
      ctx.fillText(String(t), x, y + 0.5);
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
    default:
      return ` @${b.y}`;
  }
}
