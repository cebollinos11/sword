/**
 * The Floor map screen (docs/plans/dungeon.md, Stage 3), drawn in the DOM from `floorMapLayout`: an SVG for the edges and a
 * positioned element per Hall holding its kind's icon. Render only; it reads the Match and changes nothing in it.
 */
import { floorGraph, runHall, runKit, runSeed, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { hallIcon } from './icons';
import { floorMapLayout } from './floorMap';

export const FLOOR_MAP_CSS = `
.floor-map { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;
  background: #000b; color: #fff; pointer-events: auto; }
.floor-map[hidden] { display: none; }
.floor-map-title { font-size: 1.1rem; font-weight: 700; text-shadow: 0 1px 2px #000a; }
.floor-map-title span { opacity: 0.7; font-weight: 400; margin-left: 0.6rem; }
.floor-map-board { position: relative; width: min(22rem, 86vw); height: min(30rem, 62vh); }
.floor-map-edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.floor-map-edges line { stroke: #fff4; stroke-width: 2; vector-effect: non-scaling-stroke; }
.floor-map-edges line.visited { stroke: #ffd56a; stroke-width: 4; }
.floor-map-node { position: absolute; width: 3rem; height: 3rem; margin: -1.5rem 0 0 -1.5rem; padding: 0.35rem; box-sizing: border-box; border-radius: 50%;
  background: #1a1d24; border: 2px solid #fff3; opacity: 0.55; }
.floor-map-node.reachable { opacity: 0.9; border-color: #fff8; }
.floor-map-node.visited { opacity: 1; border-color: #ffd56a; background: #3a3320; }
.floor-map-node.current { opacity: 1; border-color: #6fd8ff; box-shadow: 0 0 0 3px #6fd8ff66, 0 0 14px #6fd8ffaa; transform: scale(1.15); }
.floor-map-hint { font-size: 0.8rem; opacity: 0.7; }
.hud-map { pointer-events: auto; position: absolute; left: calc(50% + 2rem); bottom: max(0.8rem, env(safe-area-inset-bottom)); width: 2.4rem; height: 2.4rem;
  border-radius: 50%; font-size: 1.1rem; color: #fff; background: #0007; border: 1px solid #fff6; cursor: pointer; opacity: 0.75; }
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

  setOpen(open: boolean): void {
    this.el.hidden = !open;
  }

  /** Redraw from the Match if it is open and what it shows changed. Outside a Run there is no map. */
  update(match: MatchState, tuning: TuningData): void {
    if (this.el.hidden) return;
    const run = match.run;
    if (!run) return;
    const at = { floor: run.floor, row: run.row, index: run.hall };
    const key = JSON.stringify([match.config.arena, run.floor, run.floors, run.path.length, at]);
    if (key === this.built) return;
    this.built = key;
    // `floorGraph` keeps what it built per (Run seed, Floor, Kit), so this does not rebuild it.
    const graph = floorGraph(tuning.dungeon, runSeed(match.config.arena), run.floor, runKit(tuning, match.config.arena));
    const layout = floorMapLayout(graph, run.path, runHall(run));
    this.title.replaceChildren(`Floor ${run.floor} / ${run.floors}`);
    const edges = document.createElementNS(SVG, 'svg');
    edges.setAttribute('class', 'floor-map-edges');
    edges.setAttribute('viewBox', '0 0 100 100');
    edges.setAttribute('preserveAspectRatio', 'none');
    const pos = (row: number, index: number) => layout.nodes.find((n) => n.row === row && n.index === index)!;
    for (const e of layout.edges) {
      const a = pos(e.from.row, e.from.index);
      const b = pos(e.to.row, e.to.index);
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', String(a.x * 100));
      line.setAttribute('y1', String(a.y * 100));
      line.setAttribute('x2', String(b.x * 100));
      line.setAttribute('y2', String(b.y * 100));
      if (e.visited) line.setAttribute('class', 'visited');
      edges.append(line);
    }
    const nodes = layout.nodes.map((n) => {
      const node = document.createElement('div');
      node.className = `floor-map-node ${n.kind.toLowerCase()}${n.visited ? ' visited' : ''}${n.current ? ' current' : ''}${n.reachable ? ' reachable' : ''}`;
      node.dataset.row = String(n.row);
      node.dataset.index = String(n.index);
      node.title = n.kind;
      node.style.left = `${n.x * 100}%`;
      node.style.top = `${n.y * 100}%`;
      node.innerHTML = hallIcon(n.kind);
      return node;
    });
    this.board.replaceChildren(edges, ...nodes);
  }
}
