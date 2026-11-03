/**
 * The Battle's minimap (docs/plans/big-battle.md, Stage 5): a top-down map of the Battlefield in a corner, render only.
 * Each living Soldier is a dot in its army's colour (a full Fighter at its Fighter's place), a routed army's dimmed, and
 * the Player is an arrow pointing the way their Fighter faces. The map is turned so the Player's army stands at the
 * bottom and the enemy at the top, as the Player first sees them: up is +z, and +x is to the left (the way the
 * third-person camera shows it, looking along +z).
 */
import { inDuel, type SimState } from '../sim';
import type { BattleTuning } from '../tuning';

/** Where world (x, z) lies on a map `px` pixels square of a field `size` metres square: pixels from the map's top-left. */
export function minimapPoint(x: number, z: number, size: number, px: number): { x: number; y: number } {
  return { x: (0.5 - x / size) * px, y: (0.5 - z / size) * px };
}

/** The way a Fighter facing `yaw` points on the map, as a unit vector in map pixels (y down). */
export function minimapHeading(yaw: number): { x: number; y: number } {
  return { x: -Math.sin(yaw), y: -Math.cos(yaw) };
}

const css = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** The minimap: a canvas the caller places, redrawn from a Battle's state each frame. */
export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;

  /** `px`: the map's side in CSS pixels. */
  constructor(
    private readonly battle: BattleTuning,
    private readonly px = 180,
  ) {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = Math.round(px * ratio);
    this.canvas.style.width = this.canvas.style.height = `${px}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
  }

  /** Draw `state`'s armies, and Fighter `me` (the Player's slot) as an arrow while it stands. */
  draw(state: SimState, me: number): void {
    const { ctx, px } = this;
    const crowd = state.crowd;
    const size = this.battle.field.size;
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = 'rgba(28, 40, 22, 0.78)';
    ctx.fillRect(0, 0, px, px);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeRect(0.5, 0.5, px - 1, px - 1);
    if (!crowd) return;
    const dot = Math.max(1.5, px / 110);
    for (const team of [0, 1]) {
      ctx.fillStyle = css(this.battle.soldier.colours[team]!);
      ctx.globalAlpha = crowd.rout?.team === team ? 0.45 : 1;
      for (let s = 0; s < crowd.x.length; s++) {
        if (!crowd.alive[s] || crowd.team[s] !== team) continue;
        const k = crowd.slot[s]!;
        const f = k >= 0 ? state.fighters[k] : undefined;
        const at = minimapPoint(f ? f.position.x : crowd.x[s]!, f ? f.position.z : crowd.z[s]!, size, px);
        ctx.fillRect(at.x - dot / 2, at.y - dot / 2, dot, dot);
      }
    }
    ctx.globalAlpha = 1;
    const f = state.fighters[me];
    if (!f || !inDuel(f)) return;
    const at = minimapPoint(f.position.x, f.position.z, size, px);
    const d = minimapHeading(f.facing);
    const r = Math.max(5, px / 28);
    ctx.beginPath();
    ctx.moveTo(at.x + d.x * r, at.y + d.y * r);
    ctx.lineTo(at.x - d.x * r * 0.6 - d.y * r * 0.55, at.y - d.y * r * 0.6 + d.x * r * 0.55);
    ctx.lineTo(at.x - d.x * r * 0.25, at.y - d.y * r * 0.25);
    ctx.lineTo(at.x - d.x * r * 0.6 + d.y * r * 0.55, at.y - d.y * r * 0.6 - d.x * r * 0.55);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
}
