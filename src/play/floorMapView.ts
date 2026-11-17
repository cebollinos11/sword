/**
 * The Floor Map screen (docs/plans/delver.md, Stage 5), drawn in the DOM from `delverMapLayout`: one SVG of the revealed Halls and Passages,
 * their marks and the party's arrows. Render only; it reads the Match and changes nothing in it.
 */
import type { MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { floorOf } from '../sim/delver';
import { delverMapLayout, delverMapStatus, viewReveal, type DelverMapLayout } from './floorMap';

export const FLOOR_MAP_CSS = `
/* z-index: over the HUD's buttons (menu, map, Items), so a tap anywhere closes it. The board's margin keeps the nodes off the title and hint. */
.floor-map { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;
  background: #0d0a14ee; color: #fff; pointer-events: auto; z-index: 5; }
.floor-map[hidden] { display: none; }
.floor-map-title { font-family: var(--font-display); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; text-shadow: var(--px) var(--px) 0 #000; }
.floor-map-title span { opacity: 0.7; font-weight: 400; margin-left: 0.6rem; }
.floor-map-board { position: relative; }
.floor-map-board.delver { width: min(30rem, 88vw, 64vh); height: auto; aspect-ratio: 1; margin: 1.2rem 0; background: #08060d; border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line); }
.floor-map-board.delver svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.floor-map-board.delver .map-hall { fill: #3a3350; stroke: #6d5f8c; stroke-width: 0.8; }
/* The second pass over a Hall's rects: filled, no stroke, so it covers the inner half of every outline (0.8 wide, so 0.4 shows) and a shaped Hall keeps one outline, on its outside. */
.floor-map-board.delver .map-hall.inner { stroke: none; }
.floor-map-board.delver .map-hall.rest { fill: #4a3524; }
.floor-map-board.delver .map-hall.treasure { fill: #4a4220; }
.floor-map-board.delver .map-hall.boss { fill: #4a2630; }
.floor-map-board.delver .map-hall.stairs { fill: #2a3a4a; }
.floor-map-board.delver .map-hall.entrance { fill: #2c4a3a; }
.floor-map-board.delver .map-passage { fill: #2a2540; stroke: #4a4166; stroke-width: 0.3; }
.floor-map-board.delver .map-door { stroke: none; }
.floor-map-board.delver .map-empty { fill: #7d7596; font-size: 3.2px; text-anchor: middle; }
.floor-map-hint { font-size: 1.2rem; opacity: 0.7; }
.hud-map { pointer-events: auto; position: absolute; left: calc(50% + 2rem); bottom: max(0.8rem, env(safe-area-inset-bottom)); width: 2.4rem; height: 2.4rem; font-size: 1.4rem; color: #fff; background: var(--panel-2); border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2); cursor: pointer; opacity: 0.85; }
.hud-map[hidden] { display: none; }
@media (pointer: fine) { .hud-map { display: none; } }
`;

const SVG = 'http://www.w3.org/2000/svg';

export class FloorMapView {
  readonly el = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly board = document.createElement('div');
  /** What the board was drawn for; it is redrawn when it changes. */
  private built = '';
  /** The local Player's Fighter (the white arrow of a Delver Run's map); -1 until `setMe`. */
  private me = -1;

  constructor() {
    this.el.id = 'floor-map';
    this.el.className = 'floor-map';
    this.el.hidden = true;
    this.title.className = 'floor-map-title';
    this.board.className = 'floor-map-board';
    const hint = document.createElement('div');
    hint.className = 'floor-map-hint';
    hint.textContent = 'M or tap to close';
    this.el.append(this.title, this.board, hint);
    this.el.addEventListener('click', () => this.onClose());
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Called when the player taps the screen, so closing goes through the same path as the key. */
  onClose: () => void = () => undefined;

  setMe(fighter: number): void {
    this.me = fighter;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
  }

  /** Redraw from the Match if it is open and what it shows changed. Outside a Run there is no map. */
  update(match: MatchState, tuning: TuningData): void {
    if (this.el.hidden) return;
    if (match.delver) this.updateDelver(match, tuning);
  }

  /** A Delver Run's Floor Map: the revealed Halls and Passages, the markers of the revealed Halls and the party. */
  private updateDelver(match: MatchState, tuning: TuningData): void {
    const run = match.delver!;
    const plan = floorOf(tuning, match.duel.arena)?.plan;
    if (!plan) return;
    const layout = delverMapLayout(plan, viewReveal(match, plan, this.me), match.duel.fighters, this.me, delverMapStatus(match, plan));
    const key = JSON.stringify([match.config.arena, run.floor, run.floors, layout]);
    if (key === this.built) return;
    this.built = key;
    const tier = Math.ceil(run.floor / tuning.delver.floorsPerTier);
    this.title.replaceChildren(`Floor ${run.floor} / ${run.floors}`);
    this.board.classList.add('delver');
    this.board.replaceChildren(drawDelverMap(layout, tier));
  }

  
}

/** The marker's glyph on the board (SVG, 0 to 100 units), at (x, y). */
function markGlyph(m: DelverMapLayout['marks'][number]): SVGElement {
  const x = m.bx * 100;
  const y = m.by * 100;
  const g = document.createElementNS(SVG, 'g');
  g.setAttribute('transform', `translate(${x} ${y})`);
  const shape = (tag: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    g.append(el);
  };
  if (m.type === 'stairs') {
    shape('rect', { x: '-2.2', y: '-2.2', width: '4.4', height: '4.4', fill: m.open ? '#ffd56a' : '#7a3a30', stroke: '#000', 'stroke-width': '0.5' });
    shape('text', { y: '1.3', 'text-anchor': 'middle', 'font-size': '3.6', fill: '#000' }, m.open ? '▼' : '✕');
  } else if (m.type === 'fire') {
    shape('circle', { r: m.spent ? '1.3' : '1.9', fill: m.spent ? '#8a6a52' : '#ff9a2a', stroke: '#000', 'stroke-width': '0.4' });
  } else if (m.type === 'treasure') {
    shape('rect', { x: '-1.6', y: '-1.6', width: '3.2', height: '3.2', transform: 'rotate(45)', fill: m.lying ? '#ffd56a' : 'none', stroke: m.lying ? '#000' : '#a89a6a', 'stroke-width': '0.5' });
  } else {
    shape('text', { y: '1.6', 'text-anchor': 'middle', 'font-size': '5', fill: '#ff6a5a', stroke: '#000', 'stroke-width': '0.3' }, '☠');
  }
  g.setAttribute('class', `map-mark ${m.type}`);
  return g;
}

/** A Delver Floor's layout as one SVG on a 100 × 100 board: the unexplored doorways' stubs, the Passages, then the Halls, the markers, then the party's arrows (the local one white, last). */
function drawDelverMap(layout: DelverMapLayout, tier: number): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.dataset.tier = String(tier);
  const rect = (r: DelverMapLayout['rects'][number], inner = false) => {
    const el = document.createElementNS(SVG, 'rect');
    el.setAttribute('x', String(r.x0 * 100));
    el.setAttribute('y', String(r.y0 * 100));
    el.setAttribute('width', String((r.x1 - r.x0) * 100));
    el.setAttribute('height', String((r.y1 - r.y0) * 100));
    el.setAttribute('class', r.hall ? `map-hall ${(r.kind ?? '').toLowerCase()}` : 'map-passage');
    if (inner) el.classList.add('inner');
    return el;
  };
  // An unexplored doorway: a stub of Passage fading from its Hall's edge into the dark, one gradient per board edge.
  const defs = document.createElementNS(SVG, 'defs');
  const ends = { top: [0, 0, 0, 1], bottom: [0, 1, 0, 0], left: [0, 0, 1, 0], right: [1, 0, 0, 0] } as const;
  for (const [edge, [ax, ay, bx, by]] of Object.entries(ends)) {
    const g = document.createElementNS(SVG, 'linearGradient');
    g.id = `map-door-${edge}`;
    for (const [k, v] of Object.entries({ x1: ax, y1: ay, x2: bx, y2: by })) g.setAttribute(k, String(v));
    for (const [offset, opacity] of [['0', '1'], ['1', '0']] as const) {
      const stop = document.createElementNS(SVG, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', '#6d5f8c');
      stop.setAttribute('stop-opacity', opacity);
      g.append(stop);
    }
    defs.append(g);
  }
  const door = (d: DelverMapLayout['doors'][number]) => {
    const el = document.createElementNS(SVG, 'rect');
    el.setAttribute('x', String(d.x0 * 100));
    el.setAttribute('y', String(d.y0 * 100));
    el.setAttribute('width', String((d.x1 - d.x0) * 100));
    el.setAttribute('height', String((d.y1 - d.y0) * 100));
    el.setAttribute('class', 'map-door');
    el.setAttribute('fill', `url(#map-door-${d.edge})`);
    return el;
  };
  svg.append(defs, ...layout.doors.map(door));
  // A shaped Hall has a rect per band: each is stroked, then each is drawn again over them filled with no stroke, so no line shows across its inside.
  const halls = layout.rects.filter((r) => r.hall);
  svg.append(...layout.rects.filter((r) => !r.hall).map((r) => rect(r)), ...halls.map((r) => rect(r)), ...halls.map((r) => rect(r, true)), ...layout.marks.map(markGlyph));
  if (layout.rects.length === 0) {
    const empty = document.createElementNS(SVG, 'text');
    empty.setAttribute('x', '50');
    empty.setAttribute('y', '50');
    empty.setAttribute('class', 'map-empty');
    empty.textContent = 'Nothing explored yet';
    svg.append(empty);
  }
  for (const a of [...layout.arrows].sort((p, q) => Number(p.me) - Number(q.me))) {
    const r = a.me ? 2.6 : 2;
    const poly = document.createElementNS(SVG, 'polygon');
    const pt = (fx: number, fy: number) => `${a.bx * 100 + fx},${a.by * 100 + fy}`;
    poly.setAttribute('points', [pt(a.dx * r, a.dy * r), pt(-a.dx * r * 0.6 - a.dy * r * 0.55, -a.dy * r * 0.6 + a.dx * r * 0.55), pt(-a.dx * r * 0.25, -a.dy * r * 0.25), pt(-a.dx * r * 0.6 + a.dy * r * 0.55, -a.dy * r * 0.6 - a.dx * r * 0.55)].join(' '));
    poly.setAttribute('fill', a.me ? '#ffffff' : '#6fd8ff');
    poly.setAttribute('stroke', '#000');
    poly.setAttribute('stroke-width', '0.5');
    svg.append(poly);
  }
  return svg;
}
