/**
 * The Crowd (docs/plans/big-battle.md, Stage 1): every Soldier of a Battle, as plain number arrays in `SimState.crowd`
 * (struct-of-arrays, so it hashes, snapshots and resyncs like the rest of the state), and the low-rate step that moves
 * and fights them.
 *
 * Each Tick updates only the Soldiers whose place in their army matches the Tick modulo `battle.crowd.stagger` (`crowdDue`), so every
 * Soldier steps once per stagger period and the cost per Tick is even. A Soldier's step:
 *  - looks round it through a spatial hash of the living Soldiers (rebuilt each Tick, scratch, never state): it is
 *    pushed apart from those closer than `separation`, and finds the nearest enemy within `sight`;
 *  - an enemy within `engageReach` is its target: it stands, faces it and rolls a blow from the Crowd's own seeded
 *    generator (`hitChance`, then damage uniform in `damage`). Every blow of a Tick lands together after the Tick's
 *    steps, so the order Soldiers step in never decides who strikes first. At 0 HP a Soldier dies and stops counting;
 *  - an enemy within sight but out of reach: it walks at it, arriving just inside reach;
 *  - none in sight: it walks down its Team's flow field (a BFS over a coarse grid from every cell holding a living
 *    enemy), rebuilt from the Tick's positions whenever a Soldier needs it (scratch, so it is never state);
 *  - while its Team routs, it flees toward its own edge of the field and strikes no one.
 * A Team routs once its living Soldiers fall below `rout.threshold` of the army. Pure: never mutates its input.
 */
import type { BattleTuning } from '../tuning';
import { TICK_SECONDS } from './constants';
import { createRng, nextFloat, type RngState } from './rng';

/** A Team's Rout: which Team broke, and on which Tick. */
export interface Rout {
  readonly team: number;
  readonly tick: number;
}

/**
 * A Battle's Soldiers as struct-of-arrays: entry i of each array is Soldier i. Team 0's Soldiers come first, then Team 1's.
 * A Soldier's height is never stored: it stands on the Battlefield's ground (`battlefieldHeight`).
 */
export interface CrowdState {
  readonly x: readonly number[];
  readonly z: readonly number[];
  /** Its velocity (m/s) over its last step. */
  readonly vx: readonly number[];
  readonly vz: readonly number[];
  /** Yaw in radians; 0 faces +z. */
  readonly heading: readonly number[];
  /** HP in a Fighter's units; 0 once dead. */
  readonly hp: readonly number[];
  readonly team: readonly number[];
  /** The enemy Soldier (index) it is engaged with, or -1. */
  readonly target: readonly number[];
  /** Its steps in a row engaged with `target` (0 while not engaged). */
  readonly engage: readonly number[];
  /** 1 while living, 0 once dead. */
  readonly alive: readonly number[];
  /** The Crowd's own seeded generator, apart from the Duel's (`SimState.rng`), so the Crowd never shifts the Fighters' draws. */
  readonly rng: RngState;
  /** The Team that routed, once one has; null until then. */
  readonly rout: Rout | null;
}

/**
 * Whether Soldier `i` steps on Tick `tick`: once every `stagger` Ticks, 1/stagger of the Soldiers each Tick. It goes by the
 * Soldier's place in its own army (`i` modulo `armySize`), so each Soldier steps on the same Tick as its opposite number in
 * the other army: neither army is ever a step ahead of the other.
 */
export const crowdDue = (i: number, tick: number, stagger: number, armySize: number): boolean => (i % armySize) % stagger === tick % stagger;

/**
 * The Crowd at the start of a Battle: each army of `armySize` in ranks of `deploy.perRank` (`deploy.file` apart, ranks
 * `deploy.rank` apart), its front rank `deploy.front` from the centre: Team 0 at -z facing +z, Team 1 at +z facing -z, the
 * two armies a half turn of each other. Every Soldier at `crowd.hp`.
 */
export function createCrowd(battle: BattleTuning, seed: number): CrowdState {
  const { armySize, deploy } = battle;
  const x: number[] = [];
  const z: number[] = [];
  const team: number[] = [];
  const heading: number[] = [];
  for (const t of [0, 1])
    for (let k = 0; k < armySize; k++) {
      const rank = Math.floor(k / deploy.perRank);
      const inRank = Math.min(deploy.perRank, armySize - rank * deploy.perRank);
      const lx = (k - rank * deploy.perRank - (inRank - 1) / 2) * deploy.file;
      const lz = -(deploy.front + rank * deploy.rank);
      x.push(t === 0 ? lx : -lx);
      z.push(t === 0 ? lz : -lz);
      team.push(t);
      heading.push(t === 0 ? 0 : Math.PI);
    }
  const n = x.length;
  const zeros = () => new Array<number>(n).fill(0);
  return {
    x,
    z,
    vx: zeros(),
    vz: zeros(),
    heading,
    hp: new Array<number>(n).fill(battle.crowd.hp),
    team,
    target: new Array<number>(n).fill(-1),
    engage: zeros(),
    alive: new Array<number>(n).fill(1),
    rng: createRng(seed ^ 0x5bd1e995),
    rout: null,
  };
}

/** Living Soldiers per Team: [Team 0, Team 1]. */
export function crowdAlive(crowd: CrowdState): [number, number] {
  const out: [number, number] = [0, 0];
  for (let i = 0; i < crowd.alive.length; i++) if (crowd.alive[i]) out[crowd.team[i] as 0 | 1]++;
  return out;
}

/** Whether a Team with `living` Soldiers left routs: below `rout.threshold` of the army, or none left at all. */
export const routs = (battle: BattleTuning, living: number): boolean => living === 0 || living < battle.rout.threshold * battle.armySize;

// ------------------------------------------------------------------ scratch (rebuilt every Tick, never state)

/** The spatial hash: living Soldiers bucketed by grid cell (counting sort). */
interface Grid {
  readonly cell: number;
  readonly side: number;
  readonly start: Int32Array;
  readonly items: Int32Array;
}

let gridScratch: Grid | null = null;
let flowScratch: [Int32Array, Int32Array] | null = null;
let queueScratch = new Int32Array(0);
let damageScratch = new Float64Array(0);
/** The ways (unit vectors, x then z) to the neighbours a Soldier overlaps this step. */
const crowded = new Float64Array(2 * 32);

function gridFor(battle: BattleTuning, n: number): Grid {
  const cell = Math.max(battle.crowd.engageReach, battle.crowd.separation) * 2;
  const side = Math.ceil(battle.field.size / cell);
  if (!gridScratch || gridScratch.cell !== cell || gridScratch.side !== side || gridScratch.items.length < n)
    gridScratch = { cell, side, start: new Int32Array(side * side + 1), items: new Int32Array(n) };
  return gridScratch;
}

const cellIndex = (v: number, half: number, cell: number, side: number): number => Math.min(side - 1, Math.max(0, Math.floor((v + half) / cell)));

/**
 * The flow grid's cell along one axis: `side` (even) cells of `cell` metres, centred on the field's centre, counted
 * outward from it on each side, so a point and its mirror through the centre always fall in mirrored cells (the two
 * armies, deployed as mirrors, see mirrored flow fields even when standing exactly on a cell edge).
 */
function flowIndex(v: number, cell: number, side: number): number {
  const mid = side / 2;
  return v >= 0 ? Math.min(side - 1, mid + Math.floor(v / cell)) : Math.max(0, mid - 1 - Math.floor(-v / cell));
}

/** The flow grid's cells along each side: even, enough to cover the field. */
const flowSideOf = (battle: BattleTuning): number => 2 * Math.ceil(battle.field.size / 2 / battle.crowd.flowCell);

function fillGrid(grid: Grid, x: readonly number[], z: readonly number[], alive: readonly number[], half: number): void {
  const { start, items, cell, side } = grid;
  start.fill(0);
  const at = (i: number) => cellIndex(z[i]!, half, cell, side) * side + cellIndex(x[i]!, half, cell, side);
  for (let i = 0; i < alive.length; i++) if (alive[i]) start[at(i) + 1]!++;
  for (let c = 1; c < start.length; c++) start[c]! += start[c - 1]!;
  const fill = start.slice(0, -1);
  for (let i = 0; i < alive.length; i++) if (alive[i]) items[fill[at(i)]!++] = i;
}

/** Team `own`'s flow field into `field`: BFS distance (in flow cells) from every cell holding a living enemy (-1: unreached). */
function fillFlow(field: Int32Array, side: number, own: number, crowd: CrowdState, battle: BattleTuning): void {
  const { flowCell } = battle.crowd;
  if (queueScratch.length < side * side) queueScratch = new Int32Array(side * side);
  const queue = queueScratch;
  field.fill(-1);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < crowd.alive.length; i++) {
    if (!crowd.alive[i] || crowd.team[i] === own) continue;
    const c = flowIndex(crowd.z[i]!, flowCell, side) * side + flowIndex(crowd.x[i]!, flowCell, side);
    if (field[c] === -1) {
      field[c] = 0;
      queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++]!;
    const cx = c % side;
    const cz = (c - cx) / side;
    const d = field[c]! + 1;
    if (cx > 0 && field[c - 1] === -1) (field[c - 1] = d), (queue[tail++] = c - 1);
    if (cx < side - 1 && field[c + 1] === -1) (field[c + 1] = d), (queue[tail++] = c + 1);
    if (cz > 0 && field[c - side] === -1) (field[c - side] = d), (queue[tail++] = c - side);
    if (cz < side - 1 && field[c + side] === -1) (field[c + side] = d), (queue[tail++] = c + side);
  }
}

/** The way down a flow field from (x, z), as a unit vector, or [0, 0] where it does not fall (no enemy anywhere). */
function flowDirection(field: Int32Array, side: number, x: number, z: number, battle: BattleTuning): [number, number] {
  const { flowCell } = battle.crowd;
  const cx = flowIndex(x, flowCell, side);
  const cz = flowIndex(z, flowCell, side);
  const at = (ix: number, iz: number) => (ix < 0 || iz < 0 || ix >= side || iz >= side || field[iz * side + ix]! < 0 ? Infinity : field[iz * side + ix]!);
  const gx = at(cx - 1, cz) - at(cx + 1, cz);
  const gz = at(cx, cz - 1) - at(cx, cz + 1);
  // At an edge (or next to an unreached cell) one side is Infinity: step toward the finite, lower one.
  const fx = Number.isFinite(gx) ? gx : at(cx + 1, cz) < at(cx - 1, cz) ? 1 : at(cx - 1, cz) < at(cx + 1, cz) ? -1 : 0;
  const fz = Number.isFinite(gz) ? gz : at(cx, cz + 1) < at(cx, cz - 1) ? 1 : at(cx, cz - 1) < at(cx, cz + 1) ? -1 : 0;
  const len = Math.hypot(fx, fz);
  return len > 0 ? [fx / len, fz / len] : [0, 0];
}

/**
 * The Crowd one Tick on: the Soldiers due on `tick` (`crowdDue`) step, the Tick's blows land, and a Team below the Rout
 * threshold routs (the one with fewer left when both are; the generator picks on a tie). A Crowd that has routed only
 * steps on (the routed Team fleeing). Pure.
 */
export function stepCrowd(crowd: CrowdState, tick: number, battle: BattleTuning): CrowdState {
  const p = battle.crowd;
  const n = crowd.x.length;
  const half = battle.field.size / 2;
  const edge = half - p.separation / 2;
  const dt = p.stagger * TICK_SECONDS;
  const stride = p.walkSpeed * dt;
  const sep2 = p.separation * p.separation;
  const sight2 = p.sight * p.sight;
  const x = crowd.x.slice();
  const z = crowd.z.slice();
  const vx = crowd.vx.slice();
  const vz = crowd.vz.slice();
  const heading = crowd.heading.slice();
  const target = crowd.target.slice();
  const engage = crowd.engage.slice();
  const { team, alive } = crowd;
  let rng = crowd.rng;
  const draw = () => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };

  const grid = gridFor(battle, n);
  fillGrid(grid, crowd.x, crowd.z, alive, half);
  const reach = Math.ceil(p.sight / grid.cell);
  const flowSide = flowSideOf(battle);
  if (!flowScratch || flowScratch[0].length !== flowSide * flowSide) flowScratch = [new Int32Array(flowSide * flowSide), new Int32Array(flowSide * flowSide)];
  const flowBuilt = [false, false];
  if (damageScratch.length < n) damageScratch = new Float64Array(n);
  const damage = damageScratch;
  damage.fill(0, 0, n);
  let struck = false;

  const army = battle.armySize;
  // Team 0's due Soldiers, then Team 1's (`crowdDue`).
  for (let due = 0; due < 2 * Math.ceil(army / p.stagger); due++) {
    const k = (due % Math.ceil(army / p.stagger)) * p.stagger + (tick % p.stagger);
    if (k >= army) continue;
    const i = (due < Math.ceil(army / p.stagger) ? 0 : army) + k;
    if (!alive[i]) continue;
    const xi = x[i]!;
    const zi = z[i]!;
    const own = team[i]!;
    const fleeing = crowd.rout?.team === own;
    const gx0 = cellIndex(xi, half, grid.cell, grid.side);
    const gz0 = cellIndex(zi, half, grid.cell, grid.side);
    // Separation from the neighbouring cells, and the nearest enemy within sight (ring by ring outward until found).
    let sx = 0;
    let sz = 0;
    let best = -1;
    let bestD = sight2;
    let near = 0;
    const rings = fleeing ? 1 : reach;
    for (let r = 0; r <= rings; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = gx0 + dx;
          const gz = gz0 + dz;
          if (gx < 0 || gz < 0 || gx >= grid.side || gz >= grid.side) continue;
          const c = gz * grid.side + gx;
          for (let k = grid.start[c]!; k < grid.start[c + 1]!; k++) {
            const j = grid.items[k]!;
            if (j === i) continue;
            const ox = xi - crowd.x[j]!;
            const oz = zi - crowd.z[j]!;
            const d2 = ox * ox + oz * oz;
            if (r <= 1 && d2 < sep2) {
              if (d2 > 1e-12) {
                const d = Math.sqrt(d2);
                sx += (ox / d) * (p.separation - d);
                sz += (oz / d) * (p.separation - d);
                if (near < crowded.length / 2) {
                  crowded[2 * near] = -ox / d;
                  crowded[2 * near + 1] = -oz / d;
                  near++;
                }
              } else {
                // Exactly on top of each other: the lower index steps -x, the higher +x.
                sx += (j < i ? 1 : -1) * p.separation;
              }
            }
            if (!fleeing && team[j] !== own && (d2 < bestD || (d2 === bestD && j < best))) {
              bestD = d2;
              best = j;
            }
          }
        }
      // A ring further out holds only enemies further than one found already.
      if (best >= 0 && (r * grid.cell) ** 2 > bestD) break;
    }

    let wx = 0;
    let wz = 0;
    let face: number | null = null;
    if (fleeing) {
      wz = own === 0 ? -1 : 1;
      target[i] = -1;
      engage[i] = 0;
    } else if (best >= 0) {
      const d = Math.sqrt(bestD);
      const tx = (crowd.x[best]! - xi) / (d || 1);
      const tz = (crowd.z[best]! - zi) / (d || 1);
      face = Math.atan2(tx, tz);
      if (d <= p.engageReach) {
        // Engaged: stand, face it and trade blows.
        engage[i] = target[i] === best ? engage[i]! + 1 : 1;
        target[i] = best;
        if (draw() < p.hitChance) {
          damage[best] = damage[best]! + p.damage[0] + draw() * (p.damage[1] - p.damage[0]);
          struck = true;
        }
      } else {
        // In sight: walk at it, arriving just inside reach.
        target[i] = -1;
        engage[i] = 0;
        const pace = Math.min(1, (d - p.engageReach * 0.9) / stride);
        wx = tx * pace;
        wz = tz * pace;
      }
    } else {
      target[i] = -1;
      engage[i] = 0;
      if (!flowBuilt[own]) {
        fillFlow(flowScratch[own as 0 | 1], flowSide, own, crowd, battle);
        flowBuilt[own] = true;
      }
      [wx, wz] = flowDirection(flowScratch[own as 0 | 1], flowSide, xi, zi, battle);
    }

    // The walk, less any part of it into the neighbours it already crowds, then the push apart on top of it (at most
    // half the separation a step, so a crowd never jumps).
    for (let k = 0; k < near; k++) {
      const ux = crowded[2 * k]!;
      const uz = crowded[2 * k + 1]!;
      const into = wx * ux + wz * uz;
      if (into > 0) {
        wx -= into * ux;
        wz -= into * uz;
      }
    }
    const push = Math.hypot(sx, sz);
    const cap = push > p.separation / 2 ? p.separation / 2 / push : 1;
    const nx = Math.min(edge, Math.max(-edge, xi + wx * stride + sx * cap));
    const nz = Math.min(edge, Math.max(-edge, zi + wz * stride + sz * cap));
    vx[i] = (nx - xi) / dt;
    vz[i] = (nz - zi) / dt;
    x[i] = nx;
    z[i] = nz;
    if (face !== null) heading[i] = face;
    else if (wx !== 0 || wz !== 0) heading[i] = Math.atan2(wx, wz);
  }

  let hp = crowd.hp;
  let living = alive;
  if (struck) {
    const nextHp = hp.slice();
    const nextAlive = alive.slice();
    for (let j = 0; j < n; j++) {
      if (damage[j]! <= 0) continue;
      nextHp[j] = Math.max(0, nextHp[j]! - damage[j]!);
      if (nextHp[j] === 0) {
        nextAlive[j] = 0;
        target[j] = -1;
        engage[j] = 0;
        vx[j] = 0;
        vz[j] = 0;
      }
    }
    hp = nextHp;
    living = nextAlive;
  }

  let rout = crowd.rout;
  if (!rout) {
    const left: [number, number] = [0, 0];
    for (let i = 0; i < n; i++) if (living[i]) left[team[i] as 0 | 1]++;
    const broken = [routs(battle, left[0]), routs(battle, left[1])];
    if (broken[0] || broken[1]) {
      const routed = broken[0] && broken[1] ? (left[0] === left[1] ? (draw() < 0.5 ? 0 : 1) : left[0] < left[1] ? 0 : 1) : broken[0] ? 0 : 1;
      rout = { team: routed, tick };
    }
  }

  return { x, z, vx, vz, heading, hp, team, target, engage, alive: living, rng, rout };
}
