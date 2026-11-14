/**
 * The Battle's minimap (docs/plans/big-battle.md, Stage 5): a top-down map of the Battlefield in a corner, render only.
 * Each living Soldier is a dot in its army's colour (a full Fighter at its Fighter's place), a routed army's dimmed, and
 * the Player is an arrow pointing the way their Fighter faces. The map is turned so the Player's army stands at the
 * bottom and the enemy at the top, as the Player first sees them: for Team 0, up is +z and +x is to the left (the way the
 * third-person camera shows it, looking along +z); for Team 1, turned half a turn (the camera looks along -z).
 *
 * Stage 2b of docs/plans/battle-objectives.md adds the Objectives (a ring in the Owner's colour, filled toward whoever is
 * winning it, with its letter) and each living Squad as a small arrow at its anchor, pointing the way it faces; the Player's own
 * army's Squads also draw a thin line to the Objective they are ordered to.
 *
 * Online (Stage 7), every other Player in the Battle has an arrow too, in their army's colour with a white outline
 * (`playerMarkers`): a Player who took over a Soldier looks like every other Soldier on the field, and not on the map.
 */
import { ATTACK, inDuel, RESPAWN, type MapObjective, type SimState } from '../sim';
import type { BattleTuning } from '../tuning';
import { objectiveLetter } from './objectiveMarks';
import { delverMapMarks, type DelverMapStatus } from './delverMapMarks';
import { isRevealed } from '../sim/delver/reveal';
import type { FloorPlan } from '../sim/delver/plan';
import type { FighterState } from '../sim';

/** How many metres a Delver minimap shows from its centre (the local Fighter) to its edge. */
export const DELVER_MINIMAP_RADIUS = 24;

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

  /** Draw the map's `sites` (its Objectives), `state`'s armies and Squads, the other Players' arrows and Fighter `me` (the Player's slot) as a white arrow while it stands. */
  draw(state: SimState, me: number, sites: readonly MapObjective[] = []): void {
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
    for (let k = 0; k < sites.length; k++) this.objective(sites[k]!, crowd.objectives.owner[k]!, crowd.objectives.progress[k]!, size, turned);
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
    this.squads(state, me, sites, size, turned);
    for (const m of playerMarkers(state, me)) this.arrow(minimapPoint(m.position.x, m.position.z, size, px, turned), minimapHeading(m.facing, turned), css(this.battle.soldier.colours[m.team]!), '#fff', 0.8);
    const f = state.fighters[me];
    if (!f || !inDuel(f)) return;
    this.arrow(minimapPoint(f.position.x, f.position.z, size, px, turned), minimapHeading(f.facing, turned), '#fff', '#000', 1);
  }

  /**
   * A Delver Run's minimap (docs/plans/delver.md, Stage 5): the revealed Halls and Passages of `plan` as floor shapes in a window of
   * DELVER_MINIMAP_RADIUS metres round Fighter `me` (turned as the Battle's: up is +z, +x to the left), then the markers of the revealed Halls,
   * the promoted enemies in the window, the party's arrows and `me` white. Unrevealed space draws nothing.
   */
  drawDelver(plan: FloorPlan, revealed: readonly number[], fighters: readonly FighterState[], me: number, status: DelverMapStatus): void {
    const { ctx, px } = this;
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = 'rgba(12, 10, 18, 0.82)';
    ctx.fillRect(0, 0, px, px);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeRect(0.5, 0.5, px - 1, px - 1);
    const f = fighters[me];
    // Without a living Fighter to follow, the map rests on the Entrance Hall.
    const home = plan.halls[plan.entrance]!;
    const centre = f && inDuel(f) ? { x: f.position.x, z: f.position.z } : { x: home.cx, z: home.cz };
    const scale = px / (2 * DELVER_MINIMAP_RADIUS);
    const at = (x: number, z: number) => ({ x: px / 2 - (x - centre.x) * scale, y: px / 2 - (z - centre.z) * scale });
    const fill = (rect: FloorPlan['halls'][number]['rect'], colour: string) => {
      const a = at(rect.x1, rect.z1);
      const b = at(rect.x0, rect.z0);
      ctx.fillStyle = colour;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    };
    plan.passages.forEach((p, i) => isRevealed(revealed, plan.halls.length + i) && p.pieces.forEach((piece) => fill(piece.rect, '#3a3454')));
    plan.halls.forEach((h, i) => isRevealed(revealed, i) && fill(h.rect, '#4a4468'));
    for (const m of delverMapMarks(plan, revealed, status, me)) {
      const p = at(m.x, m.z);
      const r = Math.max(3, px / 40);
      ctx.beginPath();
      if (m.type === 'stairs') {
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.fillStyle = m.open ? '#ffd56a' : '#7a3a30';
      } else if (m.type === 'fire') {
        ctx.arc(p.x, p.y, m.spent ? r * 0.65 : r * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = m.spent ? '#8a6a52' : '#ff9a2a';
      } else if (m.type === 'treasure') {
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.fillStyle = m.lying ? '#ffd56a' : 'rgba(168, 154, 106, 0.5)';
      } else {
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4a3a';
      }
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    const dot = Math.max(2, px / 70);
    ctx.fillStyle = css(this.battle.soldier.colours[1]!);
    fighters.forEach((e) => {
      if (e.team === 0 || !inDuel(e)) return;
      const p = at(e.position.x, e.position.z);
      if (p.x < 0 || p.y < 0 || p.x > px || p.y > px) return;
      ctx.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot);
    });
    fighters.forEach((a, i) => {
      if (a.team !== 0 || !inDuel(a) || a.hp <= 0) return;
      const p = at(a.position.x, a.position.z);
      this.arrow(p, minimapHeading(a.facing), i === me ? '#fff' : '#6fd8ff', '#000', i === me ? 1 : 0.7);
    });
  }

  /** An Objective: a faint disc, a ring in the Owner's colour (grey for none), an arc inside it filled toward the Team winning it, and its letter. */
  private objective(site: MapObjective, owner: number, progress: number, size: number, turned: boolean): void {
    const { ctx, px } = this;
    const at = minimapPoint(site.x, site.z, size, px, turned);
    const r = (site.radius / size) * px;
    const colour = (team: number) => (team >= 0 ? css(this.battle.soldier.colours[team]!) : '#d8d2c4');
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colour(owner);
    ctx.stroke();
    if (progress !== 0) {
      ctx.beginPath();
      ctx.arc(at.x, at.y, r * 0.7, -Math.PI / 2, -Math.PI / 2 + Math.min(1, Math.abs(progress)) * Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colour(progress > 0 ? 0 : 1);
      ctx.stroke();
    }
    ctx.font = `bold ${Math.max(8, px / 16)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(objectiveLetter(site), at.x, at.y + 0.5);
  }

  /** Each living Squad as an arrow at its anchor, in its army's colour; its own army's with a line to the Objective it is sent to. */
  private squads(state: SimState, me: number, sites: readonly MapObjective[], size: number, turned: boolean): void {
    const { ctx, px } = this;
    const s = state.crowd!.squads;
    const mine = state.fighters[me]?.team ?? 0;
    const routed = state.crowd!.rout?.team;
    for (let q = 0; q < s.team.length; q++) {
      if (s.living[q] === 0 || routed === s.team[q]) continue;
      const at = minimapPoint(s.x[q]!, s.z[q]!, size, px, turned);
      const colour = css(this.battle.soldier.colours[s.team[q]!]!);
      const target = s.target[q]!;
      if (s.team[q] === mine && !s.fall[q] && s.order[q]! !== RESPAWN && target < sites.length) {
        const to = minimapPoint(sites[target]!.x, sites[target]!.z, size, px, turned);
        ctx.beginPath();
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(to.x, to.y);
        ctx.lineWidth = 0.75;
        ctx.strokeStyle = s.order[q] === ATTACK ? 'rgba(255, 90, 70, 0.45)' : 'rgba(110, 230, 120, 0.45)';
        ctx.stroke();
      }
      this.arrow(at, minimapHeading(s.heading[q]!, turned), s.fall[q] ? 'rgba(255, 255, 255, 0.5)' : colour, 'rgba(0, 0, 0, 0.8)', 0.5);
    }
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
