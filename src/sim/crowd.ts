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
 * Round each Player's Fighter (Stage 4), its waiting enemies (in the Crowd, within `bubble.promote`, not engaged last step)
 * steer to the waiting ring (`ringSpots`): spots `ring.spacing` apart on rings from `ring.radius` out, the ones ahead of the
 * Player (its way of travel) filled first, so the ring closes in front of them. No step ends within `bubble.hold` of an enemy
 * full Fighter, and a Soldier in a moving Team-mate full Fighter's path (`ring.pathAhead` ahead, `ring.pathWidth` aside)
 * steps out of it. Steering only, never collision.
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
  /**
   * The Fighter Pool slot it is promoted into (docs/plans/big-battle.md, Stage 3), or -1 while it is in the Crowd. A promoted Soldier
   * leaves the Crowd step: it does not step, is not seen or struck by other Soldiers, and its other entries keep what they held at its
   * Promotion until its Demotion writes them back (`alive` and `hp` drop to 0 at once if its Fighter falls).
   */
  readonly slot: readonly number[];
  /** The Crowd's own seeded generator, apart from the Duel's (`SimState.rng`), so the Crowd never shifts the Fighters' draws. */
  readonly rng: RngState;
  /** The Team that routed, once one has; null until then. */
  readonly rout: Rout | null;
  /** Each Player's record (docs/plans/big-battle.md, Stage 5), by Player slot (the first slots of the Fighter Pool): none in an AI-vs-AI war. */
  readonly players: readonly BattlePlayer[];
}

/**
 * A Player of a Battle, in its Pool slot (docs/plans/big-battle.md, Stage 5). A Player whose Fighter falls takes over the
 * nearest living ally Soldier (`stepBubbles`): that Soldier is its Fighter from then on (its `slot` is the Player's slot).
 */
export interface BattlePlayer {
  /** The Soldier the Player's Fighter is, once it has taken one over; -1 while it is still its own chosen Fighter. */
  readonly soldier: number;
  /** Soldiers it has taken over. */
  readonly taken: number;
  /** Enemy full Fighters it has felled (the blow that took their last HP was its). */
  readonly kills: number;
  /** The Pool slot its own chosen Fighter lies in once it has taken over a Soldier (to the Battle's end), or -1. */
  readonly corpse: number;
}

/** A Player's record at the start of a Battle. */
export const FRESH_PLAYER: BattlePlayer = { soldier: -1, taken: 0, kills: 0, corpse: -1 };

/**
 * Whether Soldier `i` steps on Tick `tick`: once every `stagger` Ticks, 1/stagger of the Soldiers each Tick. It goes by the
 * Soldier's place in its own army (`i` modulo `armySize`), so each Soldier steps on the same Tick as its opposite number in
 * the other army: neither army is ever a step ahead of the other.
 */
export const crowdDue = (i: number, tick: number, stagger: number, armySize: number): boolean => (i % armySize) % stagger === tick % stagger;

/**
 * The Crowd at the start of a Battle: each army of `armySize` in ranks of `deploy.perRank` (`deploy.file` apart, ranks
 * `deploy.rank` apart), its front rank `deploy.front` from the centre: Team 0 at -z facing +z, Team 1 at +z facing -z, the
 * two armies a half turn of each other. Every Soldier at `crowd.hp`. `players`: how many Players the Battle has (each a fresh record).
 */
export function createCrowd(battle: BattleTuning, seed: number, players = 0): CrowdState {
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
    slot: new Array<number>(n).fill(-1),
    rng: createRng(seed ^ 0x5bd1e995),
    rout: null,
    players: new Array<BattlePlayer>(players).fill(FRESH_PLAYER),
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

/** Whether Soldier `i` is in the Crowd's fight: living, and not promoted to a full Fighter. */
const inCrowd = (crowd: Pick<CrowdState, 'alive' | 'slot'>, i: number): boolean => crowd.alive[i] === 1 && crowd.slot[i]! < 0;

function fillGrid(grid: Grid, crowd: CrowdState, half: number): void {
  const { x, z } = crowd;
  const { start, items, cell, side } = grid;
  start.fill(0);
  const at = (i: number) => cellIndex(z[i]!, half, cell, side) * side + cellIndex(x[i]!, half, cell, side);
  for (let i = 0; i < x.length; i++) if (inCrowd(crowd, i)) start[at(i) + 1]!++;
  for (let c = 1; c < start.length; c++) start[c]! += start[c - 1]!;
  const fill = start.slice(0, -1);
  for (let i = 0; i < x.length; i++) if (inCrowd(crowd, i)) items[fill[at(i)]!++] = i;
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
    if (!inCrowd(crowd, i) || crowd.team[i] === own) continue;
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
 * A full Fighter as the Crowd sees it (`stepCrowd`): where it stands, its Team, and its way of travel. A Soldier never fights
 * one: an enemy keeps out of its reach, a Team-mate out of its path.
 */
export interface CrowdFighter {
  readonly x: number;
  readonly z: number;
  readonly team: number;
  /** Its way of travel this Tick, a unit vector; 0, 0 (or absent) standing. */
  readonly dx?: number;
  readonly dz?: number;
  /** Present on a Player's Fighter, the centre of a Bubble: the yaw its waiting ring closes toward (its way of travel, or its facing standing). */
  readonly ahead?: number;
}

/**
 * The waiting ring's spots round a Player's Fighter at (x, z), as many as `count`, in the order they fill: on rings from
 * `ring.radius` out, `ring.spacing` apart (between spots and between rings), each ring's spot straight `ahead` first, then
 * alternately to its right and left, then the next ring out. As flat x, z pairs.
 */
export function ringSpots(battle: BattleTuning, x: number, z: number, ahead: number, count: number): number[] {
  const { radius, spacing } = battle.ring;
  const out: number[] = [];
  for (let r = radius; out.length < 2 * count; r += spacing) {
    const n = Math.max(1, Math.floor((2 * Math.PI * r) / spacing));
    const step = (2 * Math.PI) / n;
    for (let j = 0; j < n && out.length < 2 * count; j++) {
      const a = ahead + (j % 2 === 1 ? (j + 1) / 2 : -j / 2) * step;
      out.push(x + Math.sin(a) * r, z + Math.cos(a) * r);
    }
  }
  return out;
}

/** The furthest round its Player (radians) a waiting Soldier heads for at once: a spot further round it walks to round them. */
const RING_DETOUR = Math.PI / 4;

/** The most times a step is put back out of the enemy full Fighters' holds (see `stepCrowd`): enough for a few close together. */
const HOLD_PASSES = 4;

/** Each Soldier's waiting-ring spot this Tick (x, z) and the `fighters` entry it rings (-1 for none): scratch, never state. */
let spotScratch = new Float64Array(0);
let ringOf = new Int32Array(0);

/**
 * Hands out the waiting ring's spots round each Player's Fighter in `fighters` (those with `ahead`, in order) to its waiting
 * enemies: Soldiers in the Crowd, living, of a Team that has not routed, not engaged on their last step, within
 * `bubble.promote` of it and not given a spot by an earlier one, the `ring.waiting` nearest it at most. Each spot in fill order (`ringSpots`) goes to the nearest
 * waiting enemy not yet given one (the lower index on a tie). Whether any Soldier has a spot.
 */
function fillRings(crowd: CrowdState, battle: BattleTuning, fighters: readonly CrowdFighter[]): boolean {
  const n = crowd.x.length;
  if (ringOf.length < n) {
    spotScratch = new Float64Array(2 * n);
    ringOf = new Int32Array(n);
  }
  ringOf.fill(-1, 0, n);
  let any = false;
  const reach2 = battle.bubble.promote ** 2;
  fighters.forEach((f, b) => {
    if (f.ahead === undefined) return;
    const waiting: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!inCrowd(crowd, i) || crowd.team[i] === f.team || crowd.rout?.team === crowd.team[i] || crowd.target[i]! >= 0 || ringOf[i]! >= 0) continue;
      if ((crowd.x[i]! - f.x) ** 2 + (crowd.z[i]! - f.z) ** 2 <= reach2) waiting.push(i);
    }
    if (waiting.length === 0) return;
    // Only the `ring.waiting` nearest wait (the lower index on a tie); the others fight on in the Crowd.
    if (waiting.length > battle.ring.waiting) {
      const d2 = (i: number) => (crowd.x[i]! - f.x) ** 2 + (crowd.z[i]! - f.z) ** 2;
      waiting.sort((a, b) => d2(a) - d2(b) || a - b);
      waiting.length = battle.ring.waiting;
    }
    if (waiting.length === 0) return;
    any = true;
    const spots = ringSpots(battle, f.x, f.z, f.ahead, waiting.length);
    for (let p = 0; p < waiting.length; p++) {
      const sx = spots[2 * p]!;
      const sz = spots[2 * p + 1]!;
      let best = -1;
      let bestD = Infinity;
      for (const i of waiting) {
        if (ringOf[i]! >= 0) continue;
        const d = (crowd.x[i]! - sx) ** 2 + (crowd.z[i]! - sz) ** 2;
        if (d < bestD) [best, bestD] = [i, d];
      }
      ringOf[best] = b;
      spotScratch[2 * best] = sx;
      spotScratch[2 * best + 1] = sz;
    }
  });
  return any;
}

/**
 * The Crowd one Tick on: the Soldiers due on `tick` (`crowdDue`) step, the Tick's blows land, and a Team below the Rout
 * threshold routs (the one with fewer left when both are; the generator picks on a tie). A Crowd that has routed only
 * steps on (the routed Team fleeing). A promoted Soldier (`slot`) neither steps nor is seen by the others. Round each
 * Player's Fighter in `fighters` (the full Fighters in play), its waiting enemies steer to their spots on the waiting ring
 * (`fillRings`), facing it, unless an enemy Soldier is in reach. No step ends within `bubble.hold` of an enemy in
 * `fighters`: a Soldier holds outside its sword reach, and one already inside steps back out to it. Before that, a step
 * that ends in a moving Team-mate's path (`ring.pathAhead` ahead of it, `ring.pathWidth` either side of its line) is moved
 * aside, by at most a stride, out of it. Pure.
 */
export function stepCrowd(crowd: CrowdState, tick: number, battle: BattleTuning, fighters: readonly CrowdFighter[] = []): CrowdState {
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
  const { team, alive, slot } = crowd;
  const hold = battle.bubble.hold;
  const { pathAhead, pathWidth } = battle.ring;
  const ringed = fighters.length > 0 && fillRings(crowd, battle, fighters);
  let rng = crowd.rng;
  const draw = () => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };

  const grid = gridFor(battle, n);
  fillGrid(grid, crowd, half);
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
    if (!inCrowd(crowd, i)) continue;
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
    const ring = ringed && !fleeing && ringOf[i]! >= 0 && !(best >= 0 && bestD <= p.engageReach * p.engageReach) ? fighters[ringOf[i]!]! : null;
    if (ring) {
      // Waiting for an Attack Slot: walk to its spot on the ring, arriving there, facing the Player's Fighter. A spot more
      // than RING_DETOUR round the Player from where it stands it walks to round them (toward a point that far round, at
      // the spot's distance), never across their reach.
      target[i] = -1;
      engage[i] = 0;
      let sx = spotScratch[2 * i]!;
      let sz = spotScratch[2 * i + 1]!;
      const bearing = Math.atan2(xi - ring.x, zi - ring.z);
      const turn = Math.atan2(Math.sin(Math.atan2(sx - ring.x, sz - ring.z) - bearing), Math.cos(Math.atan2(sx - ring.x, sz - ring.z) - bearing));
      if (Math.abs(turn) > RING_DETOUR) {
        const a = bearing + Math.sign(turn) * RING_DETOUR;
        const r = Math.hypot(sx - ring.x, sz - ring.z);
        sx = ring.x + Math.sin(a) * r;
        sz = ring.z + Math.cos(a) * r;
      }
      const ox = sx - xi;
      const oz = sz - zi;
      const d = Math.hypot(ox, oz);
      if (d > 1e-9) {
        const pace = Math.min(1, d / stride);
        wx = (ox / d) * pace;
        wz = (oz / d) * pace;
      }
      face = Math.atan2(ring.x - xi, ring.z - zi);
    } else if (fleeing) {
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
    let nx = xi + wx * stride + sx * cap;
    let nz = zi + wz * stride + sz * cap;
    // Out of every moving Team-mate full Fighter's path: aside from its line, by at most a stride.
    for (const f of fighters) {
      const fx = f.dx ?? 0;
      const fz = f.dz ?? 0;
      if (f.team !== own || (fx === 0 && fz === 0)) continue;
      const ox = nx - f.x;
      const oz = nz - f.z;
      const ahead = ox * fx + oz * fz;
      const off = fx * oz - fz * ox;
      if (ahead <= -pathWidth || ahead >= pathAhead || Math.abs(off) >= pathWidth) continue;
      // Away from the line on its own side (exactly on it: an even index to one side, an odd to the other).
      const side = off > 0 || (off === 0 && i % 2 === 0) ? 1 : -1;
      const by = Math.min(stride, pathWidth - Math.abs(off));
      nx -= fz * side * by;
      nz += fx * side * by;
    }
    // Out of every enemy full Fighter's reach: put back on the edge of its hold, away from it. Put out of one, it may land
    // in another's, so again until it lands in none (or HOLD_PASSES run out).
    for (let pass = 0, moved = true; moved && pass < HOLD_PASSES; pass++) {
      moved = false;
      for (const f of fighters) {
        if (f.team === own) continue;
        const ox = nx - f.x;
        const oz = nz - f.z;
        const d = Math.hypot(ox, oz);
        if (d >= hold) continue;
        moved = true;
        if (d > 1e-9) {
          nx = f.x + (ox / d) * hold;
          nz = f.z + (oz / d) * hold;
        } else {
          // Exactly on it: back the way its own army stands.
          nz = f.z + (own === 0 ? -hold : hold);
        }
      }
    }
    nx = Math.min(edge, Math.max(-edge, nx));
    nz = Math.min(edge, Math.max(-edge, nz));
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

  return { x, z, vx, vz, heading, hp, team, target, engage, alive: living, slot, rng, rout, players: crowd.players };
}
