/**
 * The Squad bench (docs/plans/battle-objectives.md, Stage 0), with no DOM and no three.js, so it also runs under Node
 * (benchCore.test.ts smoke-tests it at tiny sizes). It is benchCore's Crowd prototype with Squads on top, to see whether
 * 200 v 200 still fits the budget gate with them:
 *
 * - 32 Squad brains at 2 Hz, staggered: morale, the Formation by situation (column, line, loose) and the anchor's heading
 *   and speed, the anchor following a cached destination field and turning at a limited rate;
 * - the destination fields (12: five Objectives, two Bases, five spawn points) and the clearance, built once with the
 *   Walls and kept outside the state (`createSquadWorld`), as Stage 2a would cache them;
 * - Soldiers steering to their place in the Formation (up to 20% faster to catch up), the front rank of a line closing
 *   with the enemy, a Soldier whose place is inside a Wall falling back to the field;
 * - a push-out from a box of 24 Walls (a stub for Stage 3b).
 *
 * No Commander, merging or respawning: each Squad keeps its Soldiers and one destination. A brain's cost does not depend
 * on them, so the numbers stand. Timing reads `performance.now()`: the bench measures the Simulation, it is not part of it.
 */
import { TICK_SECONDS } from '../sim';
import { BENCH_ROLLBACK_TICKS, CROWD_FIELDS, createCrowd, DEFAULT_CROWD, half, random, rebuildGrid, stats, type Crowd, type CrowdParams, type Stats } from './benchCore';

export interface SquadParams extends CrowdParams {
  /** Soldiers in a Squad; the remainder of a Team folds into its last Squads. */
  readonly squadSize: number;
  /** A Squad's brain steps every this many Ticks (staggered by Squad index). */
  readonly brainTicks: number;
  readonly spacing: number;
  /** Radians a second an anchor may turn. */
  readonly turnRate: number;
  /** A Soldier out of place walks up to this many times faster. */
  readonly catchUp: number;
  /** Walls in the box the Soldiers are pushed out of. */
  readonly walls: number;
  /** Clearance (m) under which a Squad narrows to a column. */
  readonly narrow: number;
}

export const DEFAULT_SQUADS: SquadParams = { ...DEFAULT_CROWD, squadSize: 12, brainTicks: 30, spacing: 1.5, turnRate: 1.2, catchUp: 1.2, walls: 24, narrow: 6 };

const MAX_SLOTS = 16;
const COLUMN = 0;
const LINE = 1;
const LOOSE = 2;
/** The front rank of a line: the slots that fight. */
const LINE_WIDTH = 6;
/** The Bases' destination indices, one per Team. */
const BASE = 5;

/** The static, cached part of a map: Wall boxes, each destination's flow field, and each cell's clearance. */
export interface SquadWorld {
  readonly side: number;
  readonly cell: number;
  /** minX, minZ, maxX, maxZ per Wall. */
  readonly walls: Float64Array;
  readonly blocked: Uint8Array;
  /** Metres to the nearest blocked cell, per flow cell. */
  readonly clearance: Float32Array;
  /** One BFS distance field per destination (-1 for unreachable), in flow cells. */
  readonly fields: readonly Int32Array[];
  /** right, forward per Formation and slot. */
  readonly places: Float64Array;
}

/** Destinations: five Objectives across the centre, the two Bases (5 and 6), and five more spawn points. */
function destinationsFor(fieldSize: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 5; k++) out.push([(k - 2) * 28, 0]);
  out.push([0, -fieldSize * 0.42], [0, fieldSize * 0.42]);
  for (let k = 0; k < 5; k++) out.push([(k - 2) * 30, (k % 2 ? 1 : -1) * fieldSize * 0.3]);
  return out;
}

/** Two rows of Walls with gates across the field, then small blocks along the centre line. */
function wallBoxes(params: SquadParams): Float64Array {
  const boxes: number[] = [];
  const f = params.fieldSize;
  for (const z of [-f * 0.1, f * 0.1]) for (let k = 0; k < 7 && boxes.length < params.walls * 4; k++) boxes.push(-f * 0.42 + k * 28 - 10, z - 1, -f * 0.42 + k * 28 + 10, z + 1);
  for (let k = 0; boxes.length < params.walls * 4; k++) boxes.push(-f * 0.4 + k * 9 - 2, -2, -f * 0.4 + k * 9 + 2, 2);
  return Float64Array.from(boxes);
}

/** Breadth-first fill from the cells already at 0, never entering a blocked cell. */
function fill(side: number, field: Int32Array, queue: Int32Array, blocked: Uint8Array | null): void {
  let head = 0;
  let tail = 0;
  for (let c = 0; c < field.length; c++) if (field[c] === 0) queue[tail++] = c;
  const open = (c: number) => field[c] === -1 && !(blocked && blocked[c]);
  while (head < tail) {
    const c = queue[head++]!;
    const cx = c % side;
    const cz = (c - cx) / side;
    const d = field[c]! + 1;
    if (cx > 0 && open(c - 1)) (field[c - 1] = d), (queue[tail++] = c - 1);
    if (cx < side - 1 && open(c + 1)) (field[c + 1] = d), (queue[tail++] = c + 1);
    if (cz > 0 && open(c - side)) (field[c - side] = d), (queue[tail++] = c - side);
    if (cz < side - 1 && open(c + side)) (field[c + side] = d), (queue[tail++] = c + side);
  }
}

/** Built once per map: this is the cost that leaves the Tick (and that a Rollback never pays). */
export function createSquadWorld(params: SquadParams): SquadWorld {
  const cell = params.flowCell;
  const side = Math.ceil(params.fieldSize / cell);
  const walls = wallBoxes(params);
  const blocked = new Uint8Array(side * side);
  const lo = (i: number) => -params.fieldSize / 2 + i * cell;
  for (let cz = 0; cz < side; cz++)
    for (let cx = 0; cx < side; cx++)
      for (let w = 0; w < walls.length; w += 4)
        if (lo(cx + 1) > walls[w]! && lo(cx) < walls[w + 2]! && lo(cz + 1) > walls[w + 1]! && lo(cz) < walls[w + 3]!) blocked[cz * side + cx] = 1;
  const queue = new Int32Array(side * side);
  const clear = new Int32Array(side * side).fill(-1);
  for (let c = 0; c < clear.length; c++) if (blocked[c]) clear[c] = 0;
  fill(side, clear, queue, null);
  const fields = destinationsFor(params.fieldSize).map(([x, z]) => {
    const field = new Int32Array(side * side).fill(-1);
    const cx = Math.min(side - 1, Math.max(0, Math.floor((x + params.fieldSize / 2) / cell)));
    const cz = Math.min(side - 1, Math.max(0, Math.floor((z + params.fieldSize / 2) / cell)));
    field[cz * side + cx] = 0;
    fill(side, field, queue, blocked);
    return field;
  });
  const places = new Float64Array(3 * MAX_SLOTS * 2);
  const sp = params.spacing;
  for (let s = 0; s < MAX_SLOTS; s++) {
    // Column: 3 wide, 4 deep. Line: 6 wide, 2 deep. Loose: a spiral.
    places.set([((s % 3) - 1) * sp, -(Math.floor(s / 3) - 1.5) * sp], (COLUMN * MAX_SLOTS + s) * 2);
    places.set([((s % LINE_WIDTH) - 2.5) * sp, -(Math.floor(s / LINE_WIDTH) - 0.5) * sp], (LINE * MAX_SLOTS + s) * 2);
    places.set([Math.sin(s * 2.4) * sp * Math.sqrt(s + 1) * 0.8, Math.cos(s * 2.4) * sp * Math.sqrt(s + 1) * 0.8], (LOOSE * MAX_SLOTS + s) * 2);
  }
  return { side, cell, walls, blocked, clearance: Float32Array.from(clear, (d) => d * cell), fields, places };
}

/** The Squads as struct-of-arrays beside the Crowd. */
export interface SquadCrowd extends Crowd {
  readonly squadParams: SquadParams;
  readonly world: SquadWorld;
  readonly squadCount: number;
  /** Per Soldier: its Squad and its place in the Formation. */
  readonly squad: Int32Array;
  readonly slot: Int32Array;
  /** Per Squad: anchor, heading, anchor velocity, destination, Formation, living Soldiers. */
  readonly ax: Float64Array;
  readonly az: Float64Array;
  readonly ah: Float64Array;
  readonly avx: Float64Array;
  readonly avz: Float64Array;
  readonly dest: Int32Array;
  readonly shape: Int32Array;
  readonly living: Int32Array;
  /** Deployment (fixed here, not state): each Squad's Soldiers, MAX_SLOTS to a Squad, -1 for empty. */
  readonly members: Int32Array;
  readonly sizes: Int32Array;
}

export const SQUAD_FIELDS = [...CROWD_FIELDS, 'squad', 'slot', 'ax', 'az', 'ah', 'avx', 'avz', 'dest', 'shape', 'living'] as const;

const scratch = new Float64Array(2);

/** The Soldier's place offset (world x, z) for a Formation, slot and heading, into `scratch`. */
function placeOffset(world: SquadWorld, shape: number, slot: number, heading: number): void {
  const i = (shape * MAX_SLOTS + Math.min(slot, MAX_SLOTS - 1)) * 2;
  const r = world.places[i]!;
  const f = world.places[i + 1]!;
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  scratch[0] = r * c + f * s;
  scratch[1] = -r * s + f * c;
}

function cellIndex(world: SquadWorld, size: number, x: number, z: number): number {
  const cx = Math.min(world.side - 1, Math.max(0, Math.floor((x + size / 2) / world.cell)));
  const cz = Math.min(world.side - 1, Math.max(0, Math.floor((z + size / 2) / world.cell)));
  return cz * world.side + cx;
}

/** Down destination `dest`'s field from (x, z), as a unit vector into `scratch`; [0, 0] at the destination or off the field. */
function fieldDirection(crowd: SquadCrowd, dest: number, x: number, z: number): void {
  const w = crowd.world;
  const size = crowd.params.fieldSize;
  const field = w.fields[dest]!;
  const cx = Math.min(w.side - 1, Math.max(0, Math.floor((x + size / 2) / w.cell)));
  const cz = Math.min(w.side - 1, Math.max(0, Math.floor((z + size / 2) / w.cell)));
  const here = field[cz * w.side + cx]!;
  let best = here < 0 ? Infinity : here;
  let bx = 0;
  let bz = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gz = cz + dz;
      if ((dx === 0 && dz === 0) || gx < 0 || gz < 0 || gx >= w.side || gz >= w.side) continue;
      const d = field[gz * w.side + gx]!;
      if (d >= 0 && d < best) (best = d), (bx = dx), (bz = dz);
    }
  const len = Math.hypot(bx, bz);
  scratch[0] = len > 0 ? bx / len : 0;
  scratch[1] = len > 0 ? bz / len : 0;
}

/** (x, z) pushed out of any Wall box (grown by r) into `scratch`. */
function pushOut(world: SquadWorld, x: number, z: number, r: number): void {
  const { walls } = world;
  for (let w = 0; w < walls.length; w += 4) {
    const x0 = walls[w]! - r;
    const z0 = walls[w + 1]! - r;
    const x1 = walls[w + 2]! + r;
    const z1 = walls[w + 3]! + r;
    if (x <= x0 || x >= x1 || z <= z0 || z >= z1) continue;
    const m = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    if (m === x - x0) x = x0;
    else if (m === x1 - x) x = x1;
    else if (m === z - z0) z = z0;
    else z = z1;
  }
  scratch[0] = x;
  scratch[1] = z;
}

/** Two armies of Squads in column, a row of Squads a side, 80 m apart across the centre, each Squad bound for one of the five Objectives. */
export function createSquadCrowd(params: SquadParams = DEFAULT_SQUADS, seed = 1): SquadCrowd {
  const base = createCrowd(params, seed);
  const world = createSquadWorld(params);
  const perTeamSquads = Math.max(1, Math.floor(params.perTeam / params.squadSize));
  const squadCount = perTeamSquads * 2;
  const crowd: SquadCrowd = {
    ...base,
    squadParams: params,
    world,
    squadCount,
    squad: new Int32Array(base.count),
    slot: new Int32Array(base.count),
    ax: new Float64Array(squadCount),
    az: new Float64Array(squadCount),
    ah: new Float64Array(squadCount),
    avx: new Float64Array(squadCount),
    avz: new Float64Array(squadCount),
    dest: new Int32Array(squadCount),
    shape: new Int32Array(squadCount).fill(COLUMN),
    living: new Int32Array(squadCount),
    members: new Int32Array(squadCount * MAX_SLOTS).fill(-1),
    sizes: new Int32Array(squadCount),
  };
  for (let team = 0; team < 2; team++) {
    // The remainder folds into the last Squads, one Soldier each.
    const extra = params.perTeam - perTeamSquads * params.squadSize;
    let next = team * params.perTeam;
    for (let sq = 0; sq < perTeamSquads; sq++) {
      const q = team * perTeamSquads + sq;
      const size = params.squadSize + (sq >= perTeamSquads - extra ? 1 : 0);
      for (let s = 0; s < size; s++, next++) {
        crowd.squad[next] = q;
        crowd.slot[next] = s;
        crowd.members[q * MAX_SLOTS + s] = next;
      }
      crowd.sizes[q] = size;
      crowd.ax[q] = (sq - (perTeamSquads - 1) / 2) * 8;
      crowd.az[q] = (team === 0 ? -1 : 1) * 40;
      crowd.ah[q] = team === 0 ? 0 : Math.PI;
      crowd.dest[q] = sq % 5;
      crowd.living[q] = crowd.sizes[q]!;
    }
  }
  for (let i = 0; i < crowd.count; i++) {
    const q = crowd.squad[i]!;
    placeOffset(world, COLUMN, crowd.slot[i]!, crowd.ah[q]!);
    crowd.x[i] = crowd.ax[q]! + scratch[0]!;
    crowd.z[i] = crowd.az[q]! + scratch[1]!;
    crowd.heading[i] = crowd.ah[q]!;
  }
  return crowd;
}

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** The Squad brains due this Tick: 2 Hz each, staggered by index. Morale, Formation, and the anchor's heading and speed. */
export function squadBrains(crowd: SquadCrowd, tick: number): void {
  const p = crowd.squadParams;
  const dtBrain = p.brainTicks * TICK_SECONDS;
  const { x, z, alive, target } = crowd;
  for (let q = tick % p.brainTicks; q < crowd.squadCount; q += p.brainTicks) {
    const n = crowd.sizes[q]!;
    let living = 0;
    let contact = 0;
    let cx = 0;
    let cz = 0;
    let enemy = -1;
    let enemyD = Infinity;
    for (let k = 0; k < n; k++) {
      const j = crowd.members[q * MAX_SLOTS + k]!;
      if (!alive[j]) continue;
      living++;
      cx += x[j]!;
      cz += z[j]!;
      const t = target[j]!;
      if (t >= 0) {
        contact++;
        const d = (x[t]! - x[j]!) ** 2 + (z[t]! - z[j]!) ** 2;
        if (d < enemyD) (enemyD = d), (enemy = t);
      }
    }
    crowd.living[q] = living;
    if (living === 0) {
      crowd.avx[q] = crowd.avz[q] = 0;
      continue;
    }
    cx /= living;
    cz /= living;
    const team = q < crowd.squadCount / 2 ? 0 : 1;
    // Morale: under 30%, fall back to this Team's Base.
    const dest = living * 10 < n * 3 ? BASE + team : crowd.dest[q]!;
    const narrow = crowd.world.clearance[cellIndex(crowd.world, p.fieldSize, crowd.ax[q]!, crowd.az[q]!)]! < p.narrow;
    crowd.shape[q] = contact > 0 ? LINE : narrow ? COLUMN : living * 2 < n ? LOOSE : COLUMN;
    let dx: number;
    let dz: number;
    if (contact > 0 && enemy >= 0) {
      const l = Math.sqrt(enemyD) || 1;
      dx = (x[enemy]! - cx) / l;
      dz = (z[enemy]! - cz) / l;
    } else {
      fieldDirection(crowd, dest, crowd.ax[q]!, crowd.az[q]!);
      dx = scratch[0]!;
      dz = scratch[1]!;
    }
    // The anchor halts in contact, at its destination, and while the Squad lags more than 6 m behind it.
    let speed = contact > 0 || (dx === 0 && dz === 0) ? 0 : p.walkSpeed * 0.8;
    if (Math.hypot(cx - crowd.ax[q]!, cz - crowd.az[q]!) > 6) speed = 0;
    if (dx !== 0 || dz !== 0) {
      const limit = p.turnRate * dtBrain;
      crowd.ah[q] = crowd.ah[q]! + Math.max(-limit, Math.min(limit, wrap(Math.atan2(dx, dz) - crowd.ah[q]!)));
    }
    crowd.avx[q] = Math.sin(crowd.ah[q]!) * speed;
    crowd.avz[q] = Math.cos(crowd.ah[q]!) * speed;
  }
}

/** Every anchor moves every Tick (a few dozen of them), pushed out of the Walls. */
export function moveAnchors(crowd: SquadCrowd): void {
  for (let q = 0; q < crowd.squadCount; q++) {
    if (crowd.avx[q] === 0 && crowd.avz[q] === 0) continue;
    pushOut(crowd.world, crowd.ax[q]! + crowd.avx[q]! * TICK_SECONDS, crowd.az[q]! + crowd.avz[q]! * TICK_SECONDS, 1);
    crowd.ax[q] = scratch[0]!;
    crowd.az[q] = scratch[1]!;
  }
}

/** The Soldiers due this Tick: the Crowd's neighbour scan, then fight, or steer to the place in the Formation, and push out of Walls. */
export function stepSquadSoldiers(crowd: SquadCrowd, tick: number): void {
  const p = crowd.squadParams;
  rebuildGrid(crowd);
  const dt = p.stagger * TICK_SECONDS;
  const reach = Math.ceil(p.sight / crowd.cellSize);
  const sep2 = p.separation * p.separation;
  const sight2 = p.sight * p.sight;
  const { x, z, vx, vz, team, alive, hp, target, heading } = crowd;
  const world = crowd.world;
  const maxSpeed = p.walkSpeed * p.catchUp;

  for (let i = tick % p.stagger; i < crowd.count; i += p.stagger) {
    if (!alive[i]) continue;
    const xi = x[i]!;
    const zi = z[i]!;
    const own = team[i]!;
    const cx = Math.min(crowd.cells - 1, Math.max(0, Math.floor((xi + half(crowd)) / crowd.cellSize)));
    const cz = Math.min(crowd.cells - 1, Math.max(0, Math.floor((zi + half(crowd)) / crowd.cellSize)));
    let sx = 0;
    let sz = 0;
    let best = -1;
    let bestD = sight2;
    for (let r = 0; r <= reach; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= crowd.cells || gz >= crowd.cells) continue;
          const c = gz * crowd.cells + gx;
          for (let k = crowd.cellStart[c]!; k < crowd.cellStart[c + 1]!; k++) {
            const j = crowd.cellItems[k]!;
            if (j === i) continue;
            const ox = xi - x[j]!;
            const oz = zi - z[j]!;
            const d2 = ox * ox + oz * oz;
            if (r <= 1 && d2 < sep2 && d2 > 1e-9) {
              const d = Math.sqrt(d2);
              sx += (ox / d) * (p.separation - d);
              sz += (oz / d) * (p.separation - d);
            }
            if (team[j] !== own && d2 < bestD) {
              bestD = d2;
              best = j;
            }
          }
        }
      }
      if (best >= 0 && (r * crowd.cellSize) ** 2 > bestD) break;
    }
    target[i] = best;
    const q = crowd.squad[i]!;
    let wx = 0;
    let wz = 0;
    let speed = p.walkSpeed;
    const d = Math.sqrt(bestD);
    if (best >= 0 && d <= p.engageReach) {
      // Engaged: stand and trade blows.
      if (random(crowd) < p.hitChance) {
        hp[best] = hp[best]! - (p.damage[0] + random(crowd) * (p.damage[1] - p.damage[0]));
        if (hp[best]! <= 0) alive[best] = 0;
      }
    } else if (best >= 0 && crowd.shape[q] === LINE && crowd.slot[i]! < LINE_WIDTH) {
      // The front rank of a line closes with the enemy; the rear rank holds its place below.
      wx = (x[best]! - xi) / d;
      wz = (z[best]! - zi) / d;
    } else {
      placeOffset(world, crowd.shape[q]!, crowd.slot[i]!, crowd.ah[q]!);
      const px = crowd.ax[q]! + scratch[0]!;
      const pz = crowd.az[q]! + scratch[1]!;
      if (world.blocked[cellIndex(world, p.fieldSize, px, pz)]) {
        // Its place is inside a Wall: fall back to the field.
        fieldDirection(crowd, crowd.dest[q]!, xi, zi);
        wx = scratch[0]!;
        wz = scratch[1]!;
      } else {
        const ox = px - xi;
        const oz = pz - zi;
        const od = Math.hypot(ox, oz);
        if (od > 0.2) {
          wx = ox / od;
          wz = oz / od;
          speed = od > p.spacing ? maxSpeed : p.walkSpeed * Math.min(1, od / p.spacing);
        }
      }
    }
    let mx = wx * speed + sx / dt;
    let mz = wz * speed + sz / dt;
    const s = Math.hypot(mx, mz);
    if (s > maxSpeed) (mx *= maxSpeed / s), (mz *= maxSpeed / s);
    vx[i] = mx;
    vz[i] = mz;
    pushOut(world, xi + mx * dt, zi + mz * dt, 0.4);
    x[i] = scratch[0]!;
    z[i] = scratch[1]!;
    if (wx !== 0 || wz !== 0) heading[i] = Math.atan2(wx, wz);
    crowd.timer[i] = tick;
  }
}

/** One Tick of the Squad Crowd: the brains due, the anchors, then the Soldiers due. */
export function stepSquadCrowd(crowd: SquadCrowd, tick: number): void {
  squadBrains(crowd, tick);
  moveAnchors(crowd);
  stepSquadSoldiers(crowd, tick);
}

/** The state's arrays copied, in SQUAD_FIELDS order. */
export function snapshotSquadCrowd(crowd: SquadCrowd): ArrayBufferView[] {
  return SQUAD_FIELDS.map((k) => crowd[k].slice());
}

/** Copy a snapshot back into the live arrays. */
export function restoreSquadCrowd(crowd: SquadCrowd, snap: readonly ArrayBufferView[]): void {
  SQUAD_FIELDS.forEach((k, n) => (crowd[k] as Float64Array).set(snap[n] as Float64Array));
}

/** FNV-1a 32-bit over the state arrays' bytes. */
export function hashSquadBytes(crowd: SquadCrowd): string {
  let h = 0x811c9dc5;
  for (const k of SQUAD_FIELDS) {
    const bytes = new Uint8Array(crowd[k].buffer);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Soldiers standing inside a Wall box (should be none after a push-out). */
export function insideWalls(crowd: SquadCrowd): number {
  const w = crowd.world.walls;
  let n = 0;
  for (let i = 0; i < crowd.count; i++) {
    if (!crowd.alive[i]) continue;
    for (let k = 0; k < w.length; k += 4) if (crowd.x[i]! > w[k]! + 0.05 && crowd.x[i]! < w[k + 2]! - 0.05 && crowd.z[i]! > w[k + 1]! + 0.05 && crowd.z[i]! < w[k + 3]! - 0.05) n++;
  }
  return n;
}

export interface SquadBench {
  readonly soldiers: number;
  readonly squads: number;
  /** Building the destination fields, clearance and Walls once (not a per-Tick cost). */
  readonly buildMs: number;
  readonly fields: number;
  /** One Tick of `stepSquadCrowd`: all of it, and its three parts. */
  readonly step: Stats;
  readonly brains: Stats;
  readonly anchors: Stats;
  readonly soldiersStep: Stats;
  /** A Tick as the Rollback session runs it: the step and a snapshot. */
  readonly onlineTick: Stats;
  /** `step` on Ticks with under 2% of the living Soldiers in sight of an enemy (the march) and over 20% (the melee). */
  readonly stepMarch: Stats;
  readonly stepMelee: Stats;
  /** One 15-Tick Rollback (restore, then 15 Ticks re-simulated with their snapshots), by the same phases. */
  readonly rollbackMarch: Stats;
  readonly rollbackMelee: Stats;
  /** Every timed Rollback landed on the hash it had the first time. */
  readonly deterministic: boolean;
  /** Squad-Ticks spent in each Formation: column, line, loose. */
  readonly formations: [number, number, number];
  readonly alive: [number, number];
  /** The most Soldiers found inside a Wall box at once, sampled every 20 Ticks. */
  readonly insideWalls: number;
}

/** Run the Squad Crowd for `ticks` Ticks, timing each part, and a 15-Tick Rollback every `rollbackEvery` Ticks. */
export function benchSquads(params: SquadParams, ticks: number, rollbackEvery = 10, now: () => number = () => performance.now()): SquadBench {
  const built = now();
  const crowd = createSquadCrowd(params);
  const buildMs = now() - built;
  const stepMs: number[] = [];
  const brainMs: number[] = [];
  const anchorMs: number[] = [];
  const soldierMs: number[] = [];
  const onlineMs: number[] = [];
  const marchStep: number[] = [];
  const meleeStep: number[] = [];
  const marchRollback: number[] = [];
  const meleeRollback: number[] = [];
  const history = new Map<number, ArrayBufferView[]>([[0, snapshotSquadCrowd(crowd)]]);
  const formations: [number, number, number] = [0, 0, 0];
  let deterministic = true;
  let inside = 0;
  const contactShare = () => {
    let living = 0;
    let fighting = 0;
    for (let i = 0; i < crowd.count; i++)
      if (crowd.alive[i]) {
        living++;
        if (crowd.target[i]! >= 0) fighting++;
      }
    return living === 0 ? 0 : fighting / living;
  };

  for (let t = 1; t <= ticks; t++) {
    const t0 = now();
    squadBrains(crowd, t);
    const t1 = now();
    moveAnchors(crowd);
    const t2 = now();
    stepSquadSoldiers(crowd, t);
    const t3 = now();
    const snap = snapshotSquadCrowd(crowd);
    const t4 = now();
    brainMs.push(t1 - t0);
    anchorMs.push(t2 - t1);
    soldierMs.push(t3 - t2);
    stepMs.push(t3 - t0);
    onlineMs.push(t4 - t0);
    history.set(t, snap);
    history.delete(t - BENCH_ROLLBACK_TICKS - 1);
    const share = contactShare();
    if (share < 0.02) marchStep.push(t3 - t0);
    else if (share > 0.2) meleeStep.push(t3 - t0);
    for (let q = 0; q < crowd.squadCount; q++) formations[crowd.shape[q]!]!++;
    if (t % 20 === 0) inside = Math.max(inside, insideWalls(crowd));

    if (t % rollbackEvery === 0 && history.has(t - BENCH_ROLLBACK_TICKS)) {
      const want = hashSquadBytes(crowd);
      const r0 = now();
      restoreSquadCrowd(crowd, history.get(t - BENCH_ROLLBACK_TICKS)!);
      for (let k = t - BENCH_ROLLBACK_TICKS + 1; k <= t; k++) {
        stepSquadCrowd(crowd, k);
        snapshotSquadCrowd(crowd);
      }
      const spent = now() - r0;
      if (share < 0.02) marchRollback.push(spent);
      else if (share > 0.2) meleeRollback.push(spent);
      if (hashSquadBytes(crowd) !== want) deterministic = false;
    }
  }
  const alive: [number, number] = [0, 0];
  for (let i = 0; i < crowd.count; i++) if (crowd.alive[i]) alive[crowd.team[i] as 0 | 1]++;
  return {
    soldiers: crowd.count,
    squads: crowd.squadCount,
    buildMs,
    fields: crowd.world.fields.length,
    step: stats(stepMs),
    brains: stats(brainMs),
    anchors: stats(anchorMs),
    soldiersStep: stats(soldierMs),
    onlineTick: stats(onlineMs),
    stepMarch: stats(marchStep),
    stepMelee: stats(meleeStep),
    rollbackMarch: stats(marchRollback),
    rollbackMelee: stats(meleeRollback),
    deterministic,
    formations,
    alive,
    insideWalls: inside,
  };
}
