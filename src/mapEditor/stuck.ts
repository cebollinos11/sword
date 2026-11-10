/**
 * The stuck measure (docs/plans/map-editor.md, Stage 4; the counter of docs/plans/battle-objectives.md, Stage 3b): where on a map Soldiers stand
 * out of their place longer than a few seconds. A Soldier steering to its place (living, in a Squad and the Crowd, not engaged, no enemy in
 * sight within `crowd.sight`, its Team not routed) is *out of place* while it is more than two places (`2 × squad.spacing`) from its place in
 * a row, and *stuck* while it has not closed on that place by `CLOSING` m in the last second. A stuck run counts once it passes `STUCK_AFTER`:
 * each sample after that adds its seconds to the cell the Soldier stands in (the heat map) and to the total. Sampled every `crowd.stagger`
 * Ticks, as the Crowd steps. A measure only, read from the Match and never written to it, so it cannot change an outcome; pure and
 * deterministic (the heat map is a function of the Battle). The test harness of Stage 3b (`squadsAmongWalls.test.ts`) keeps its own copy of the counter.
 */
import { battleMapOf, formationSpot, inSight, soldierHeight, squadNarrows, TICK_SECONDS, type MatchState } from '../sim';
import type { BattleTuning } from '../tuning';

/** Closing on the place by less than this (m) over the last second is not closing. */
export const CLOSING = 0.5;
/** A stuck run is counted once it is this long (s): a Soldier waiting its turn at a gate for a moment is not stuck. */
export const STUCK_AFTER = 3;
/** The heat map's cell (m). */
export const HEAT_CELL = 2;

export class StuckMeter {
  private readonly bm;
  private readonly every: number;
  /** Samples in the last second: a Soldier's distance a second ago is the one it logged this many samples back. */
  private readonly back: number;
  readonly side: number;
  /** Per cell of the heat map (row by row along z, from (-size/2, -size/2), `HEAT_CELL` m each): Soldier-seconds spent stuck there past `STUCK_AFTER`. */
  readonly heat: Float32Array;
  /** Per cell, the height (m) of the floor of the Soldier last counted stuck there (a cell may hold several levels), for drawing the heat on the right one. */
  readonly heatY: Float32Array;
  /** Soldier-seconds spent stuck past `STUCK_AFTER`, and the longest stuck run (s) of any Soldier. */
  private hot = -1;
  stuckSeconds = 0;
  longest = 0;
  /** Stuck runs that passed `STUCK_AFTER`. */
  runs = 0;
  private stuck: Float64Array | null = null;
  private past: Float64Array | null = null;
  private samples = 0;
  private lastTick = -1;
  private readonly spot: [number, number] = [0, 0];

  constructor(
    private readonly battle: BattleTuning,
    arena: string,
  ) {
    this.bm = battleMapOf(battle, arena);
    this.every = battle.crowd.stagger;
    this.back = Math.max(1, Math.round(1 / (this.every * TICK_SECONDS)));
    this.side = Math.ceil(this.bm.field.heights.size / HEAT_CELL);
    this.heat = new Float32Array(this.side * this.side);
    this.heatY = new Float32Array(this.side * this.side);
  }

  /** The heat map's cell holding (x, z). */
  cellOf(x: number, z: number): number {
    const half = this.bm.field.heights.size / 2;
    const c = Math.min(this.side - 1, Math.max(0, Math.floor((x + half) / HEAT_CELL)));
    const r = Math.min(this.side - 1, Math.max(0, Math.floor((z + half) / HEAT_CELL)));
    return r * this.side + c;
  }

  /** The cell with the most stuck time: its middle and its seconds; null while nothing is stuck. */
  hottest(): { x: number; z: number; seconds: number } | null {
    const best = this.hot;
    if (best < 0) return null;
    const half = this.bm.field.heights.size / 2;
    return { x: -half + ((best % this.side) + 0.5) * HEAT_CELL, z: -half + (Math.floor(best / this.side) + 0.5) * HEAT_CELL, seconds: this.heat[best]! };
  }

  /** Look at the Match after a Tick: every `crowd.stagger` Ticks, the Soldiers out of place. Call it after each `stepMatch`. */
  observe(match: MatchState): void {
    const c = match.duel.crowd;
    if (!c || match.tick % this.every !== 0 || match.tick === this.lastTick) return;
    this.lastTick = match.tick;
    const b = this.battle;
    const n = c.x.length;
    if (!this.stuck) {
      this.stuck = new Float64Array(n);
      this.past = new Float64Array(n * this.back).fill(Infinity);
    }
    const [stuck, past] = [this.stuck!, this.past!];
    const dt = this.every * TICK_SECONDS;
    const slot = this.samples++ % this.back;
    const narrow = squadNarrows(b, this.bm, c.squads);
    for (let i = 0; i < n; i++) {
      const q = c.squad[i]!;
      let off = c.alive[i]! > 0 && c.slot[i]! < 0 && q >= 0 && !c.rout && c.target[i]! < 0;
      let d = 0;
      if (off) {
        formationSpot(b, this.bm, c.squads, q, c.place[i]!, narrow[q]!, this.spot);
        d = Math.hypot(this.spot[0] - c.x[i]!, this.spot[1] - c.z[i]!);
        off = d > 2 * b.squad.spacing;
      }
      // An enemy in sight: it is in the fight (closing with it, or behind its own front rank), not out of place.
      for (let j = 0; off && j < n; j++)
        if (c.alive[j] && c.slot[j]! < 0 && c.team[j] !== c.team[i] && (c.x[j]! - c.x[i]!) ** 2 + (c.z[j]! - c.z[i]!) ** 2 <= b.crowd.sight ** 2 && inSight(this.bm.fields, c.x[i]!, c.z[i]!, c.x[j]!, c.z[j]!)) off = false;
      if (!off) {
        if (stuck[i]! > STUCK_AFTER) this.runs++;
        stuck[i] = 0;
        past.fill(Infinity, i * this.back, (i + 1) * this.back);
        continue;
      }
      const before = past[i * this.back + slot]!;
      past[i * this.back + slot] = d;
      // Stuck while it has not closed on its place by CLOSING over the last second; nothing known yet (the first second out of place) leaves the run as it was.
      if (before !== Infinity) stuck[i] = d > before - CLOSING ? stuck[i]! + dt : 0;
      this.longest = Math.max(this.longest, stuck[i]!);
      if (stuck[i]! > STUCK_AFTER) {
        const cell = this.cellOf(c.x[i]!, c.z[i]!);
        this.heat[cell]! += dt;
        this.heatY[cell] = soldierHeight(this.bm.field, c.surface[i]!, c.x[i]!, c.z[i]!);
        // The first cell to reach the most, as a scan in index order would find it.
        if (this.hot < 0 || this.heat[cell]! > this.heat[this.hot]! || (this.heat[cell]! === this.heat[this.hot]! && cell < this.hot)) this.hot = cell;
        this.stuckSeconds += dt;
      }
    }
  }
}
