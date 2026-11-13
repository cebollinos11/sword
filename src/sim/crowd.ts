/**
 * The Crowd (docs/plans/big-battle.md, Stage 1): every Soldier of a Battle, as plain number arrays in `SimState.crowd`
 * (struct-of-arrays, so it hashes, snapshots and resyncs like the rest of the state), and the low-rate step that moves
 * and fights them.
 *
 * Each Tick updates only the Soldiers whose place in their army matches the Tick modulo `battle.crowd.stagger` (`crowdDue`), so every
 * Soldier steps once per stagger period and the cost per Tick is even. Beside it the Squads think and their anchors move (`stepSquads`,
 * docs/plans/battle-objectives.md Stage 1, ADR 0021). A Soldier's step:
 *  - looks round it through a spatial hash of the living Soldiers (rebuilt each Tick, scratch, never state): it is
 *    pushed apart from those closer than `separation`, and finds the nearest enemy within `sight`;
 *  - an enemy within `engageReach` is its target: it stands, faces it and rolls a blow from the Crowd's own seeded
 *    generator (`hitChance`, then damage uniform in `damage`). Every blow of a Tick lands together after the Tick's
 *    steps, so the order Soldiers step in never decides who strikes first. At 0 HP a Soldier dies and stops counting.
 *    (A Soldier of a Squad falling back breaks off and walks instead of fighting);
 *  - a Soldier of a Squad otherwise steers to its place in the Squad's Formation round the anchor, up to `squad.catchUp` times faster
 *    when out of place; only the front rank of a Squad in line (`squad.line.wide` places) walks at an enemy in sight, the rear holds;
 *  - a free agent (no Squad) with an enemy within sight but out of reach walks at it, arriving just inside reach, and with none in
 *    sight walks down its Team's flow field (a BFS over a coarse grid from every cell holding a living enemy), rebuilt from the
 *    Tick's positions whenever it is needed (scratch, so it is never state);
 *  - while its Team routs, it flees toward its own edge of the field and strikes no one;
 *  - on a hand-built map (docs/plans/battle-objectives.md, Stage 3a), a step that ends inside a wall or tower is pushed out of it;
 *  - on a hand-built map each Soldier stands on a Walk Surface (`surface`, Stage 4a). On a map of several levels it steps by the walk rule
 *    (`levels.ts`: walking within a step, dropping off open ledges, never jumping), sees, pushes and fights only Soldiers of its own level,
 *    and walks to its place on its Squad's level; on a one-level map its surface is the floor under it and moves nothing.
 * Round each Player's Fighter (Stage 4), its waiting enemies (in the Crowd, within `bubble.promote`, not engaged last step)
 * steer to the waiting ring (`ringSpots`): spots `ring.spacing` apart on rings from `ring.radius` out, the ones ahead of the
 * Player (its way of travel) filled first, so the ring closes in front of them. No step ends within `bubble.hold` of an enemy
 * full Fighter, and a Soldier in a moving Team-mate full Fighter's path (`ring.pathAhead` ahead, `ring.pathWidth` aside)
 * steps out of it. Steering only, never collision.
 * Objectives, Tickets and the Commanders (docs/plans/battle-objectives.md, Stage 2a; `objectives.ts`, `commander.ts`): every
 * `objectives.captureSeconds` the Soldiers and full Fighters inside each Objective are counted and its progress moves; every second the
 * Team with more Objectives drains the enemy's Tickets; a death costs 1 Ticket; each Team's Commander re-plans its Squads' Orders every
 * `commander.planSeconds`; a Squad wiped out respawns (`stepSquads`) into dead slots while its Team has Tickets.
 * A Team routs once its Tickets are gone and its living Soldiers fall below `rout.threshold` of the army, or, at the Battle's time limit, the
 * Team that is behind (`limitLoser`). Pure: never mutates its input.
 */
import { clampSize, maxEngageReach, startingTickets, troopBodies, type BattleTuning, type Size, type TroopTuning } from '../tuning';
import { onSurface } from './arena';
import { battleArenaName, groundOf, pushOutOfBlocks, soldierHeight } from './battlefield';
import { planOrders } from './commander';
import { TICK_SECONDS } from './constants';
import { battleMapOf, clearanceBelow, descend, inSight, toward, type BattleMap } from './destinations';
import { captureTicks, createObjectives, drainDue, drainTickets, limitLoser, limitTicks, planTicks, stepObjectives, type ObjectiveState } from './objectives';
import { sameLevel, trace, walkTo } from './levels';
import { createRng, nextFloat, type RngState } from './rng';
import { deploySquads, formationSpot, LINE, SPOKE_POINTS, stepSquads, type SquadState } from './squad';
import type { WarbandState } from './warband';

/** A Team's Rout: which Team broke, and on which Tick. */
export interface Rout {
  readonly team: number;
  readonly tick: number;
}

/**
 * A Battle's Soldiers as struct-of-arrays: entry i of each array is Soldier i. Team 0's Soldiers come first, then Team 1's.
 * A Soldier's height is never stored: it stands on its Walk Surface (`surface`), on the open field on the heightfield (`soldierHeight`).
 */
export interface CrowdState {
  readonly x: readonly number[];
  readonly z: readonly number[];
  /**
   * The Walk Surface it stands on (docs/plans/battle-objectives.md, Stage 4a; an index into the map's `walk`), which its height follows; -1 on
   * the open field, whose ground is the heightfield. A promoted Soldier's is where it stood, until its Demotion writes back its Fighter's.
   */
  readonly surface: readonly number[];
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
  /**
   * Its Size (docs/plans/big-battle.md): a height and a thickness, each a multiple of the standard body (`soldierSizes`), fixed for the
   * Battle. A promoted Soldier's Fighter has it; its impostor is drawn stretched to it. Soldiers fighting in the Crowd ignore it.
   */
  readonly sizeHeight: readonly number[];
  readonly sizeThick: readonly number[];
  /**
   * Its Troop (an index into `battle.troops`, `soldierTroops`), fixed for the Battle: its HP, blows and reach in the Crowd, and a promoted
   * Fighter's Weapon, AI difficulty and Mods. A Soldier a Squad respawns into its slot is of the same Troop.
   */
  readonly troop: readonly number[];
  /** Which of its Troop's Bodies it is drawn as (an index into the Troop's `bodies`). Render-only, fixed for the Battle. */
  readonly look: readonly number[];
  /** The Squad (index into `squads`) it belongs to (docs/plans/battle-objectives.md, Stage 1), or -1 for a free agent (a Soldier a Player took over). */
  readonly squad: readonly number[];
  /** Its place in its Squad's Formation (0 is the front-left of the first row); meaningless for a free agent. */
  readonly place: readonly number[];
  /** The Squads: anchors, Formations, morale and Orders (`stepSquads`, `planOrders`). */
  readonly squads: SquadState;
  /** The Objectives' progress and Owners, entry k being map Objective k (`stepObjectives`). */
  readonly objectives: ObjectiveState;
  /** Each Team's Tickets: [Team 0, Team 1]. A death costs 1, being out-held drains them, at 0 a Team respawns no Squads. */
  readonly tickets: readonly number[];
  /** The Crowd's own seeded generator, apart from the Duel's (`SimState.rng`), so the Crowd never shifts the Fighters' draws. */
  readonly rng: RngState;
  /** The Team that routed, once one has; null until then. */
  readonly rout: Rout | null;
  /** Each Player's record (docs/plans/big-battle.md, Stage 5), by Player slot (the first slots of the Fighter Pool): none in an AI-vs-AI war. */
  readonly players: readonly BattlePlayer[];
  /**
   * Each Soldier's max HP (docs/plans/delver.md, Stage 3), which its promoted Fighter takes; present only on a Delver Run's Floor, where a
   * Warband's template and tier scale it. Absent: the Soldier's Troop's `hp`.
   */
  readonly maxHp?: readonly number[];
  /** The Warbands' brains, entry q for Squad q; present only on a Delver Run's Floor, where Squads are Warbands. Absent in a Battle. */
  readonly warbands?: WarbandState;
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
  /**
   * While it lies fallen, from `battle.takeover.pickSeconds` after its fall: the Soldier it will take over at `takeover.seconds`
   * (the view flies to it meanwhile). Absent otherwise.
   */
  readonly next?: number;
  /**
   * The Troop (an index into `battle.troops`) it chose to come back as when it falls (Intent `troop`): the Soldier it takes over is the one of that
   * Troop nearest a spawn, or of any Troop while none of it is left. Absent: whichever ally is nearest a spawn. Kept from one fall to the next.
   */
  readonly troop?: number;
  /**
   * Set once the Player has left an online Battle (docs/plans/big-battle.md, Stage 6; `takeOverFighter`): an AI drives its Fighter from
   * then on, as an ally of its Team. It has no Bubble, takes over no Soldier when it falls, and counts no more kills. Absent while it plays.
   */
  readonly away?: true;
}

/** Draws of the generator summed for one bell-curve sample (Irwin–Hall): their sum less half of them has mean 0 and spread 1. */
const BELL_DRAWS = 12;

/**
 * Each Soldier's Size for a Battle of `seed` (`n` Soldiers, `armySize` an army): height and thickness apart, each on a bell curve round
 * the standard body with `battle.soldier.sizeSpread` spread, cut to the allowed range and snapped to its step (`clampSize`). Soldier `i`
 * takes the Size of its place in its army (`i` modulo `armySize`), so the two armies field the same bodies and neither is the bigger.
 * A Troop's `height` and `width` ranges cut its Soldiers' parts first, so they apply even with no spread (a Troop with height [1.4, 1.4] is always giant).
 * A sum of the Simulation's own generator's draws (no Math.random, no transcendental function), so every peer draws the same.
 */
export function soldierSizes(battle: BattleTuning, seed: number, n: number): { readonly height: number[]; readonly thick: number[] } {
  const spread = battle.soldier.sizeSpread;
  const army = battle.armySize;
  const height = new Array<number>(n).fill(1);
  const thick = new Array<number>(n).fill(1);
  const ranged = battle.troops.some((t) => t.height !== undefined || t.width !== undefined);
  if (spread <= 0 && !ranged) return { height, thick };
  const troopOfPlace = ranged ? soldierTroops(battle, seed, n).troop : [];
  let rng = createRng(seed ^ 0x2c1b3c6d);
  const bell = (): number => {
    let sum = 0;
    for (let d = 0; d < BELL_DRAWS; d++) {
      const [v, next] = nextFloat(rng);
      rng = next;
      sum += v;
    }
    return 1 + spread * (sum - BELL_DRAWS / 2);
  };
  // A Troop's `height` and `width` ranges cut its Soldiers' Sizes (places and Troops are both by place in the army).
  const within = (v: number, range: readonly [number, number] | undefined): number => (range ? Math.min(range[1], Math.max(range[0], v)) : v);
  const ofPlace: Size[] = Array.from({ length: Math.min(army, n) }, (_, k) => {
    const troop = ranged ? battle.troops[troopOfPlace[k] ?? 0] : undefined;
    return clampSize({ height: within(bell(), troop?.height), thick: within(bell(), troop?.width) });
  });
  for (let i = 0; i < n; i++) {
    const s = ofPlace[i % army]!;
    height[i] = s.height;
    thick[i] = s.thick;
  }
  return { height, thick };
}

/**
 * Each Soldier's Troop and look (which of the Troop's Bodies) for a Battle of `seed`: the Troop drawn by weight (`battle.troops`), the look
 * evenly among its Bodies. Like Sizes, Soldier `i` takes those of its place in its army, so the two armies field the same Troops.
 * The Simulation's own generator, so every peer draws the same.
 */
export function soldierTroops(battle: BattleTuning, seed: number, n: number): { readonly troop: number[]; readonly look: number[] } {
  const troops = battle.troops;
  const army = battle.armySize;
  const troop = new Array<number>(n).fill(0);
  const look = new Array<number>(n).fill(0);
  const total = troops.reduce((sum, t) => sum + t.weight, 0);
  let rng = createRng(seed ^ 0x7f4a7c15);
  const draw = (): number => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };
  const places = Math.min(army, n);
  const ofPlace: [number, number][] = [];
  for (let k = 0; k < places; k++) {
    let pick = draw() * total;
    let t = 0;
    while (t < troops.length - 1 && pick >= troops[t]!.weight) pick -= troops[t++]!.weight;
    const bodies = Math.max(troops[t]!.bodies.length, ...(troops[t]!.teamBodies ?? []).map((l) => l.length));
    ofPlace.push([t, Math.min(bodies - 1, Math.floor(draw() * bodies))]);
  }
  for (let i = 0; i < n; i++) [troop[i], look[i]] = ofPlace[i % army]!;
  return { troop, look };
}

/** Soldier `i`'s Troop (the first, the generic soldier, for a Crowd that names none). */
export function troopOf(battle: BattleTuning, crowd: Pick<CrowdState, 'troop'>, i: number): TroopTuning {
  return battle.troops[crowd.troop[i] ?? 0] ?? battle.troops[0]!;
}

/** The Body Soldier `i` is drawn as: its look among its Troop's Bodies for its Team (`troopBodies`). */
export function soldierBody(battle: BattleTuning, crowd: Pick<CrowdState, 'troop' | 'look' | 'team'>, i: number): string {
  const team = crowd.team[i] ?? 0;
  const bodies = troopBodies(troopOf(battle, crowd, i), team);
  return bodies[(crowd.look[i] ?? 0) % bodies.length] ?? bodies[0]!;
}

/** Soldier `i`'s Size, or undefined for the standard body. */
export function soldierSize(crowd: Pick<CrowdState, 'sizeHeight' | 'sizeThick'>, i: number): Size | undefined {
  const height = crowd.sizeHeight[i] ?? 1;
  const thick = crowd.sizeThick[i] ?? 1;
  return height === 1 && thick === 1 ? undefined : { height, thick };
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
 * The Crowd at the start of a Battle: each army of `armySize` deployed in Squads (`deploySquads`), each in column, the front
 * rank the map's `front` from the centre: Team 0 at -z facing +z, Team 1 at +z facing -z, the two armies a half turn of each other.
 * Every Soldier at its Troop's HP, each Team with its starting Tickets, the Objectives with their Owners at the map's `arena` (default `battle:<seed>`),
 * and each Squad with its Commander's first Orders. `players`: how many Players the Battle has (each a fresh record).
 */
export function createCrowd(battle: BattleTuning, seed: number, players = 0, arena: string = battleArenaName(seed)): CrowdState {
  const map = battleMapOf(battle, arena);
  const deployed = deploySquads(battle, map.field.front);
  const { x, z, team, heading, squad, place } = deployed;
  const n = x.length;
  const zeros = () => new Array<number>(n).fill(0);
  // On a hand-built map, every Soldier and anchor stands on the highest Walk Surface under it (a map deploys its armies on open ground).
  const ground = (px: number, pz: number) => groundOf(battle, map.field, px, pz);
  const { height: sizeHeight, thick: sizeThick } = soldierSizes(battle, seed, n);
  const sizes = { sizeHeight, sizeThick };
  const { troop, look } = soldierTroops(battle, seed, n);
  const squads = { ...deployed.squads, surface: deployed.squads.x.map((ax, q) => ground(ax, deployed.squads.z[q]!)) };
  const crowd: CrowdState = {
    x,
    z,
    surface: x.map((px, i) => ground(px, z[i]!)),
    vx: zeros(),
    vz: zeros(),
    heading,
    hp: troop.map((t) => battle.troops[t]!.hp),
    team,
    target: new Array<number>(n).fill(-1),
    engage: zeros(),
    alive: new Array<number>(n).fill(1),
    slot: new Array<number>(n).fill(-1),
    ...sizes,
    troop,
    look,
    squad,
    place,
    squads,
    objectives: createObjectives(map.field.objectives),
    tickets: [startingTickets(battle), startingTickets(battle)],
    rng: createRng(seed ^ 0x5bd1e995),
    rout: null,
    players: new Array<BattlePlayer>(players).fill(FRESH_PLAYER),
  };
  return { ...crowd, squads: planOrders(crowd, 0, battle, map) };
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
let ysScratch = new Float64Array(0);
/** The ways (unit vectors, x then z) to the neighbours a Soldier overlaps this step. */
const crowded = new Float64Array(2 * 32);

function gridFor(battle: BattleTuning, n: number): Grid {
  const cell = Math.max(maxEngageReach(battle), battle.crowd.separation) * 2;
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
  /** Its feet's height (Stage 4a): on a map of several levels, Soldiers of another level neither keep from it nor wait for it. Absent: any level. */
  readonly y?: number;
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

/** Whether full Fighter `f` stands on another level from Soldier `i` (feet `height` or more apart), where levels matter (`ys`, each Soldier's height). */
const apart = (f: CrowdFighter, ys: Float64Array | null, i: number, height: number): boolean => ys !== null && f.y !== undefined && Math.abs(f.y - ys[i]!) >= height;

/**
 * Whether a Soldier on Walk Surface `s` at (x, z) walks straight to (px, pz): no wall of the map within its body of the line, and on a map of
 * several levels onto Walk Surface `on`'s level there without dropping (`trace`).
 */
function walksTo(battle: BattleTuning, map: BattleMap, s: number, x: number, z: number, px: number, pz: number, on: number): boolean {
  if (!inSight(map.fields, x, z, px, pz, battle.crowd.separation / 2)) return false;
  if (!map.field.layered) return true;
  const to = trace(map.field.arena, battle.levels, s, x, z, px, pz, false);
  return to >= 0 && on >= 0 && sameLevel(map.field.arena, battle.levels, to, on, px, pz);
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
 * waiting enemy not yet given one (the lower index on a tie). With `ys` (each Soldier's height, on a map of several levels), only those no
 * further above or below its Player than Promotion reaches (`levels.promote`) wait. Whether any Soldier has a spot.
 */
function fillRings(crowd: CrowdState, battle: BattleTuning, fighters: readonly CrowdFighter[], ys: Float64Array | null): boolean {
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
      if ((crowd.x[i]! - f.x) ** 2 + (crowd.z[i]! - f.z) ** 2 > reach2) continue;
      if (ys === null || f.y === undefined || Math.abs(ys[i]! - f.y) <= battle.levels.promote) waiting.push(i);
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
 * aside, by at most a stride, out of it. `map`: the Battlefield's Objectives and destination fields (static; the default is the field of seed 1,
 * which `stepBattle` replaces with the Battle's own). Pure.
 */
export function stepCrowd(crowd: CrowdState, tick: number, battle: BattleTuning, fighters: readonly CrowdFighter[] = [], map: BattleMap = battleMapOf(battle, battleArenaName(1))): CrowdState {
  const p = battle.crowd;
  const n = crowd.x.length;
  const half = battle.field.size / 2;
  const edge = half - p.separation / 2;
  const dt = p.stagger * TICK_SECONDS;
  const stride = p.walkSpeed * dt;
  const sep2 = p.separation * p.separation;
  const sight2 = p.sight * p.sight;
  const troops = battle.troops;
  const troopOfI = (i: number): TroopTuning => troops[crowd.troop[i] ?? 0] ?? troops[0]!;
  const stepped = stepSquads(crowd, tick, battle, map, fighters);
  const { squads, squad, place, narrow } = stepped;
  const walled = map.field.blocks.length > 0;
  const field = map.field;
  // On a map of several levels (Stage 4a), Soldiers step by the walk rule, and see, push and fight only their own level.
  const layered = field.layered;
  const lv = battle.levels;
  const offset: [number, number] = [0, 0];
  const pushed: [number, number] = [0, 0];
  const stood: [number, number] = [0, 0];
  const x = crowd.x.slice();
  const z = crowd.z.slice();
  const vx = crowd.vx.slice();
  const vz = crowd.vz.slice();
  const heading = crowd.heading.slice();
  const target = crowd.target.slice();
  const engage = crowd.engage.slice();
  const { team, slot } = crowd;
  // Written only on a hand-built map (the open field's are all -1).
  const surface = field.heights.walk ? crowd.surface.slice() : (crowd.surface as number[]);
  // Soldiers a Squad respawned this Tick stand at their spawn from now on, at full HP; the Tick's steps and blows do not see them.
  let alive = crowd.alive;
  let hp = crowd.hp;
  if (stepped.spawned.length > 0) {
    alive = alive.slice();
    hp = hp.slice();
    for (const s of stepped.spawned) {
      x[s.i] = s.x;
      z[s.i] = s.z;
      vx[s.i] = 0;
      vz[s.i] = 0;
      heading[s.i] = s.heading;
      target[s.i] = -1;
      engage[s.i] = 0;
      (alive as number[])[s.i] = 1;
      (hp as number[])[s.i] = troopOfI(s.i).hp;
      if (field.heights.walk) surface[s.i] = s.surface;
    }
  }
  // Each Soldier's height as it stood, where levels matter (scratch).
  if (ysScratch.length < n) ysScratch = new Float64Array(n);
  const ys = layered ? ysScratch : null;
  if (ys) for (let i = 0; i < n; i++) ys[i] = soldierHeight(field, crowd.surface[i]!, crowd.x[i]!, crowd.z[i]!);
  const hold = battle.bubble.hold;
  const { pathAhead, pathWidth } = battle.ring;
  const ringed = fighters.length > 0 && fillRings(crowd, battle, fighters, ys);
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
    const sq = squad[i]!;
    const fleeing = crowd.rout?.team === own;
    // Its Troop's blows and reach.
    const tr = troopOfI(i);
    const reach2 = tr.engageReach * tr.engageReach;
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
            // Another level (above on the bridge, below in the tunnel): neither pushed apart from nor seen.
            if (ys && Math.abs(ys[i]! - ys[j]!) >= lv.height) continue;
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
    // Whether this step may drop off a ledge (Stage 4a): only one that follows a destination field (whose joins drop) or has no place to keep
    // (a free agent, a fleeing Soldier); a crowd's push never shoves a Soldier off a deck.
    let mayDrop = sq < 0 || fleeing;
    const ring = ringed && !fleeing && ringOf[i]! >= 0 && !(best >= 0 && bestD <= reach2) ? fighters[ringOf[i]!]! : null;
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
    } else if (best >= 0 && bestD <= reach2 && !(sq >= 0 && squads.fall[sq])) {
      // Engaged: stand, face it and trade blows (any Soldier of a Squad does, a rear rank rarely; a Squad falling back breaks off).
      face = Math.atan2(crowd.x[best]! - xi, crowd.z[best]! - zi);
      engage[i] = target[i] === best ? engage[i]! + 1 : 1;
      target[i] = best;
      if (draw() < tr.hitChance) {
        damage[best] = damage[best]! + tr.damage[0] + draw() * (tr.damage[1] - tr.damage[0]);
        struck = true;
      }
    } else if (sq >= 0 && !(best >= 0 && squads.shape[sq] === LINE && place[i]! < (narrow[sq] || battle.squad.line.wide) && (!(walled || layered) || Math.sqrt(bestD) < clearanceBelow(map.fields, xi, zi, crowd.surface[i]) || inSight(map.fields, xi, zi, crowd.x[best]!, crowd.z[best]!, 0, ys === null ? NaN : ys[i]!, ys === null ? NaN : ys[best]!)))) {
      // A Squad's Soldier steers to its place in the Formation round the anchor (narrowed through a pass), up to `catchUp` times faster
      // when out of place; only the front rank of a line closes with an enemy in sight (below, never one behind a wall), the rear rank
      // holds its places.
      target[i] = -1;
      engage[i] = 0;
      const placeOn = formationSpot(battle, map, squads, sq, place[i]!, narrow[sq]!, offset);
      let [tx, tz] = offset;
      let way: number | null = null;
      // Walking to a point on the way to its place, not to its place.
      let aside = false;
      const si = crowd.surface[i]!;
      // On a map (Stage 3b), a Soldier that cannot walk straight to its place (a wall across the line, or too near it for its body; on a map
      // of several levels, a ledge or the foot of higher ground, or its place on another level) walks to the furthest point it can of the
      // line from its anchor out to its place (clear all the way by `formationSpot`, so from there on it walks straight), and round by the
      // destination field that leads past its anchor when it can reach none of it.
      // Its clearance spares the tests only for a place on its own level.
      if (
        (walled || layered) &&
        Math.hypot(tx - xi, tz - zi) + p.separation / 2 >= (!layered || sameLevel(field.arena, lv, si, placeOn, tx, tz) ? clearanceBelow(map.fields, xi, zi, si) : -Infinity) &&
        !walksTo(battle, map, si, xi, zi, tx, tz, placeOn)
      ) {
        const ax = squads.x[sq]!;
        const az = squads.z[sq]!;
        const ox = tx - ax;
        const oz = tz - az;
        let reached = false;
        for (let t = SPOKE_POINTS - 1; t >= 0 && !reached; t--) {
          tx = ax + (ox * t) / SPOKE_POINTS;
          tz = az + (oz * t) / SPOKE_POINTS;
          reached = walksTo(battle, map, si, xi, zi, tx, tz, layered ? trace(field.arena, lv, squads.surface[sq]!, ax, az, tx, tz, false) : -1);
        }
        aside = true;
        if (!reached) {
          // Never at a cell centre on a wall's face when there is another way down; down the field as it is when there is not.
          const d = toward(map.fields, xi, zi, ax, az, own, si, squads.surface[sq]);
          if (d >= 0) way = descend(map.fields, d, xi, zi, own, p.separation / 2, si) ?? descend(map.fields, d, xi, zi, own, 0, si);
        }
      }
      if (way !== null) {
        mayDrop = true;
        wx = Math.sin(way) * battle.squad.catchUp;
        wz = Math.cos(way) * battle.squad.catchUp;
      } else {
        const ox = tx - xi;
        const oz = tz - zi;
        const d = Math.hypot(ox, oz);
        if (d > 1e-9) {
          const pace = Math.min(d > battle.squad.spacing ? battle.squad.catchUp : 1, d / stride);
          wx = (ox / d) * pace;
          wz = (oz / d) * pace;
        }
        // In its place it faces where the Squad does; out of it, the way it walks.
        if (d < battle.squad.spacing / 2 && !aside) face = squads.heading[sq]!;
      }
    } else if (best >= 0) {
      // In sight: walk at it, arriving just inside reach.
      const d = Math.sqrt(bestD);
      const tx = (crowd.x[best]! - xi) / (d || 1);
      const tz = (crowd.z[best]! - zi) / (d || 1);
      face = Math.atan2(tx, tz);
      target[i] = -1;
      engage[i] = 0;
      const pace = Math.min(1, (d - tr.engageReach * 0.9) / stride);
      wx = tx * pace;
      wz = tz * pace;
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
      if (f.team !== own || (fx === 0 && fz === 0) || apart(f, ys, i, lv.height)) continue;
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
        if (f.team === own || apart(f, ys, i, lv.height)) continue;
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
    // Out of a map's walls and towers, sliding along one it walked into (docs/plans/battle-objectives.md, Stages 3a and 3b).
    if (pushOutOfBlocks(map.field, nx, nz, p.separation / 2, own, pushed, xi, zi)) [nx, nz] = pushed;
    // Onto the Walk Surface it walks (or drops) onto, stopped (sliding) where it cannot (Stage 4a); on one level, the floor under it.
    if (layered) {
      surface[i] = walkTo(field.arena, lv, crowd.surface[i]!, xi, zi, nx, nz, stood, mayDrop);
      [nx, nz] = stood;
    } else if (field.heights.walk && (surface[i]! < 0 || !onSurface(field.arena, surface[i]!, nx, nz))) {
      const on = groundOf(battle, field, nx, nz);
      if (on >= 0) surface[i] = on;
    }
    vx[i] = (nx - xi) / dt;
    vz[i] = (nz - zi) / dt;
    x[i] = nx;
    z[i] = nz;
    if (face !== null) heading[i] = face;
    else if (wx !== 0 || wz !== 0) heading[i] = Math.atan2(wx, wz);
  }

  let living = alive;
  let tickets = crowd.tickets;
  if (struck) {
    const nextHp = hp.slice();
    const nextAlive = alive.slice();
    const lost = [0, 0];
    for (let j = 0; j < n; j++) {
      if (damage[j]! <= 0) continue;
      nextHp[j] = Math.max(0, nextHp[j]! - damage[j]!);
      if (nextHp[j] === 0) {
        nextAlive[j] = 0;
        target[j] = -1;
        engage[j] = 0;
        vx[j] = 0;
        vz[j] = 0;
        lost[team[j]!]!++;
      }
    }
    hp = nextHp;
    living = nextAlive;
    // Every death costs its Team a Ticket.
    tickets = [Math.max(0, tickets[0]! - lost[0]!), Math.max(0, tickets[1]! - lost[1]!)];
  }

  let rout = crowd.rout;
  let objectives = crowd.objectives;
  let ordered = squads;
  if (!rout) {
    // Capture: the Soldiers in the Crowd and the full Fighters (a Player's counting more) inside each Objective.
    const sites = map.field.objectives;
    if (tick % captureTicks(battle) === 0) {
      const inside: [number[], number[]] = [sites.map(() => 0), sites.map(() => 0)];
      sites.forEach((site, k) => {
        const r2 = site.radius * site.radius;
        // Where there are levels, only those on the Objective's own level (not in the tunnel under a keep) count.
        const sy = layered ? soldierHeight(field, field.objectiveSurfaces[k]!, site.x, site.z) : 0;
        const level = (y: number) => Math.abs(y - sy) < lv.height;
        for (let i = 0; i < n; i++) if (living[i] && slot[i]! < 0 && (x[i]! - site.x) ** 2 + (z[i]! - site.z) ** 2 <= r2 && (!layered || level(soldierHeight(field, surface[i]!, x[i]!, z[i]!)))) inside[team[i]!]![k]!++;
        for (const f of fighters) if ((f.x - site.x) ** 2 + (f.z - site.z) ** 2 <= r2 && (!layered || f.y === undefined || level(f.y))) inside[f.team]![k]! += f.ahead !== undefined ? battle.objectives.playerCount : 1;
      });
      objectives = stepObjectives(objectives, inside, battle);
    }
    if (drainDue(tick)) tickets = drainTickets(tickets, objectives, battle);
    // Each Commander re-plans its Squads' Orders from the Soldiers and Objectives as they stood at the start of the Tick and the Squads as this Tick's brains left them.
    if (tick % planTicks(battle) === 0) ordered = planOrders({ ...crowd, squad, place, squads }, tick, battle, map, fighters);

    const left: [number, number] = [0, 0];
    for (let i = 0; i < n; i++) if (living[i]) left[team[i] as 0 | 1]++;
    // A Team routs once its Tickets are gone and its Soldiers have fallen below the threshold.
    const broken = [tickets[0]! <= 0 && routs(battle, left[0]), tickets[1]! <= 0 && routs(battle, left[1])];
    if (broken[0] || broken[1]) {
      const routed = broken[0] && broken[1] ? (left[0] === left[1] ? (draw() < 0.5 ? 0 : 1) : left[0] < left[1] ? 0 : 1) : broken[0] ? 0 : 1;
      rout = { team: routed, tick };
    } else if (tick >= limitTicks(battle)) rout = { team: limitLoser(tickets, objectives, draw), tick };
  }

  return { x, z, surface, vx, vz, heading, hp, team, target, engage, alive: living, slot, sizeHeight: crowd.sizeHeight, sizeThick: crowd.sizeThick, troop: crowd.troop, look: crowd.look, squad, place, squads: ordered, objectives, tickets, rng, rout, players: crowd.players };
}
