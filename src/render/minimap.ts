/**
 * The Battle's minimap (docs/plans/big-battle.md, Stage 5): a top-down map of the Battlefield in a corner, render only.
 * Each living Soldier is a dot in its army's colour (a full Fighter at its Fighter's place), a routed army's dimmed, and
 * the Player is an arrow pointing the way their Fighter faces. The map is turned so the Player's army stands at the
 * bottom and the enemy at the top, as the Player first sees them: for Team 0, up is +z and +x is to the left (the way the
 * third-person camera shows it, looking along +z); for Team 1, turned half a turn (the camera looks along -z).
 *
 * Online (Stage 7), every other Player in the Battle has an arrow too, in their army's colour with a white outline
 * (`playerMarkers`): a Player who took over a Soldier looks like every other Soldier on the field, and not on the map.
 */
import { inDuel, type SimState } from '../sim';
import type { BattleTuning } from '../tuning';

/**
 * Where world (x, z) lies on a map `px` pixels square of a field `size` metres square: pixels from the map's top-left.
 * `turned`: the map half a turn round (for a Player of Team 1, whose army starts at +z).
 */
export function minimapPoint(x: number, z: number, size: number, px: number, turned = false): { x: number; y: number } {
  return turned ? { x: (0.5 + x / size) * px, y: (0.5 + z / size) * px } : { x: (0.5 - x / size) * px, y: (0.5 - z / size) * px };
}

/** The way a Fighter facing `yaw` points on the map, as a unit vector in map pixels (y down). */
export function minimapHeading(yaw: number, turned = false): { x: number; y: number } {
  return turned ? { x: Math.sin(yaw), y: Math.cos(yaw) } : { x: -Math.sin(yaw), y: -Math.cos(yaw) };
}

/** A Player other than the local one, still fighting: what the minimap and the name tags mark. */
export interface PlayerMarker {
  readonly fighter: number;
  readonly team: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly facing: number;
}

/**
 * The Players besides Fighter `me` that are marked: those whose Fighter (their own, or the Soldier they took over, which
 * takes their slot) stands in the Battle. Not the one who has fallen and waits to take over, and not one who left: its
 * Fighter is an AI's now, a Fighter of its army like any other, and the HUD has already said it left.
 */
export function playerMarkers(state: SimState, me: number): PlayerMarker[] {
  const out: PlayerMarker[] = [];
  state.crowd?.players.forEach((record, k) => {
    const f = state.fighters[k];
    if (k === me || record.away || !f || !inDuel(f)) return;
    out.push({ fighter: k, team: f.team, position: { x: f.position.x, y: f.y, z: f.position.z }, facing: f.facing });
  });
  return out;
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

  /** Draw `state`'s armies, the other Players' arrows and Fighter `me` (the Player's slot) as a white arrow while it stands. */
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
    const turned = state.fighters[me]?.team === 1;
    const dot = Math.max(1.5, px / 110);
    for (const team of [0, 1]) {
      ctx.fillStyle = css(this.battle.soldier.colours[team]!);
      ctx.globalAlpha = crowd.rout?.team === team ? 0.45 : 1;
      for (let s = 0; s < crowd.x.length; s++) {
        if (!crowd.alive[s] || crowd.team[s] !== team) continue;
        const k = crowd.slot[s]!;
        const f = k >= 0 ? state.fighters[k] : undefined;
        const at = minimapPoint(f ? f.position.x : crowd.x[s]!, f ? f.position.z : crowd.z[s]!, size, px, turned);
        ctx.fillRect(at.x - dot / 2, at.y - dot / 2, dot, dot);
      }
    }
    ctx.globalAlpha = 1;
    for (const m of playerMarkers(state, me)) this.arrow(minimapPoint(m.position.x, m.position.z, size, px, turned), minimapHeading(m.facing, turned), css(this.battle.soldier.colours[m.team]!), '#fff', 0.8);
    const f = state.fighters[me];
    if (!f || !inDuel(f)) return;
    this.arrow(minimapPoint(f.position.x, f.position.z, size, px, turned), minimapHeading(f.facing, turned), '#fff', '#000', 1);
  }

  /** An arrow at `at` pointing along `d`, `scale` of the Player's own size. */
  private arrow(at: { x: number; y: number }, d: { x: number; y: number }, fill: string, outline: string, scale: number): void {
    const { ctx, px } = this;
    const r = Math.max(5, px / 28) * scale;
    ctx.beginPath();
    ctx.moveTo(at.x + d.x * r, at.y + d.y * r);
    ctx.lineTo(at.x - d.x * r * 0.6 - d.y * r * 0.55, at.y - d.y * r * 0.6 + d.x * r * 0.55);
    ctx.lineTo(at.x - d.x * r * 0.25, at.y - d.y * r * 0.25);
    ctx.lineTo(at.x - d.x * r * 0.6 + d.y * r * 0.55, at.y - d.y * r * 0.6 - d.x * r * 0.55);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
}
