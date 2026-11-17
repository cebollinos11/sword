/**
 * The Floor Map screen (docs/plans/delver.md, Stage 5), drawn in the DOM from `delverMapLayout`: one pixel-art canvas of the revealed Halls and
 * Passages inked on parchment (issue #162), the special Halls' names and the party's arrows. Render only; it reads the Match and changes nothing in it.
 */
import type { MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { floorOf } from '../sim/delver';
import { delverMapLayout, delverMapStatus, viewReveal, type DelverMapLayout } from './floorMap';
import { markLabel } from '../render/delverMapMarks';
import { ALLY, INK, INK_FADED, ME, paintArrow, paintPlan, paintStub, paintText, paperSheet } from '../render/parchment';

export const FLOOR_MAP_CSS = `
/* z-index: over the HUD's buttons (menu, map, Items), so a tap anywhere closes it. The board's margin keeps the nodes off the title and hint. */
.floor-map { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;
  background: #0d0a14ee; color: #fff; pointer-events: auto; z-index: 5; }
.floor-map[hidden] { display: none; }
.floor-map-title { font-family: var(--font-display); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; text-shadow: var(--px) var(--px) 0 #000; }
.floor-map-title span { opacity: 0.7; font-weight: 400; margin-left: 0.6rem; }
.floor-map-board { position: relative; }
/* The board is pixel art (issue #162): a small canvas of DELVER_MAP_PIXELS square, shown scaled up, unsmoothed. */
.floor-map-board.delver { width: min(30rem, 88vw, 64vh); height: auto; aspect-ratio: 1; margin: 1.2rem 0; border: calc(var(--px) * 2) solid #000; box-shadow: 0 0 0 var(--px) #c09c64; }
.floor-map-board.delver canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.floor-map-hint { font-size: 1.2rem; opacity: 0.7; }
.hud-map { pointer-events: auto; position: absolute; left: calc(50% + 2rem); bottom: max(0.8rem, env(safe-area-inset-bottom)); width: 2.4rem; height: 2.4rem; font-size: 1.4rem; color: #fff; background: var(--panel-2); border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2); cursor: pointer; opacity: 0.85; }
.hud-map[hidden] { display: none; }
@media (pointer: fine) { .hud-map { display: none; } }
`;


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

/** How many pixels the Floor Map's board is painted at, before it is scaled up to the screen. */
export const DELVER_MAP_PIXELS = 240;

/**
 * A Delver Floor's layout painted as pixel art on parchment (`parchment.ts`), DELVER_MAP_PIXELS square: the unexplored doorways' stubs, the
 * Passages and Halls in ink, the special Halls' names (`markLabel`), then the party's arrows, big, the local one red and last.
 */
function drawDelverMap(layout: DelverMapLayout, tier: number): HTMLCanvasElement {
  const n = DELVER_MAP_PIXELS;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  canvas.dataset.tier = String(tier);
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(paperSheet(n), 0, 0);
  const px = (r: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: r.x0 * n, y0: r.y0 * n, x1: r.x1 * n, y1: r.y1 * n });
  for (const d of layout.doors) paintStub(g, px(d), d.edge);
  paintPlan(
    g,
    layout.rects.filter((r) => !r.hall).map(px),
    layout.rects.filter((r) => r.hall).map((r) => ({ ...px(r), ...(r.kind === undefined ? {} : { kind: r.kind }) })),
  );
  for (const m of layout.marks) {
    const { text, faded } = markLabel(m);
    paintText(g, text, m.bx * n, m.by * n, 2, faded ? INK_FADED : INK, true);
  }
  if (layout.rects.length === 0) paintText(g, 'Nothing explored yet', n / 2, n / 2, 2, INK_FADED);
  for (const a of [...layout.arrows].sort((p, q) => Number(p.me) - Number(q.me))) paintArrow(g, a.bx * n, a.by * n, a.dx, a.dy, a.me ? 10 : 7.5, a.me ? ME : ALLY, INK);
  return canvas;
}
