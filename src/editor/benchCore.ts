/**
 * The Big Battle bench's measurements (docs/plans/big-battle.md, Stage 0), with no DOM and no three.js, so they also
 * run under Node (benchCore.test.ts smoke-tests them at tiny sizes). The page (bench.ts) runs them at full size.
 *
 * - Fighters: N full Fighters, each driven by a Beginner AI Controller, in a melee on the Editor's flat Arena,
 *   stepped through `stepMatch`. `MAX_TEAM_SIZE` (4 a side) is only checked by `createMatch`, so the bench builds
 *   a 1 v 1 Match and swaps in an N-Fighter Duel and config (nothing in sim/ changes). Each Tick is also measured
 *   as the Rollback session runs it (a snapshot and every AI's `save()` after it), and every few Ticks a 15-Tick
 *   Rollback is timed: restore, `load()`, then 15 Ticks re-simulated with their snapshots and saves.
 * - Crowd: a throwaway prototype of Stage 1's Crowd step: Soldiers as struct-of-arrays, a spatial hash grid,
 *   separation, a per-Team flow field (BFS on a coarse grid), arrival at the nearest enemy, and fights rolled from a
 *   seeded generator held in the Crowd. 1/stagger of the Soldiers update each Tick. Also the cost of hashing the
 *   Crowd (`hashValue` over plain arrays, and a direct FNV over the typed arrays' bytes) and of a snapshot copy.
 *
 * Timing reads `performance.now()`: the bench measures the Simulation, it is not part of it.
 */
import { createInitialState, createMatch, hashValue, restore, snapshot, stepMatch, TICK_SECONDS, type Intent, type MatchState, type Placement, type Snapshot } from '../sim';
import { DEFAULT_STYLE, type TuningData } from '../tuning';
import { createAiController, type Controller } from '../controllers';

/** The plan's Rollback window (net/session.ts ROLLBACK_WINDOW), re-simulated in full by each timed Rollback. */
export const BENCH_ROLLBACK_TICKS = 15;

export interface Stats {
  readonly mean: number;
  readonly p99: number;
  readonly max: number;
  readonly samples: number;
}

/** Mean, 99th percentile and max of a set of millisecond samples. */
export function stats(samples: readonly number[]): Stats {
  if (samples.length === 0) return { mean: 0, p99: 0, max: 0, samples: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return { mean, p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!, max: sorted[sorted.length - 1]!, samples: sorted.length };
}

/** Two Teams of n/2 in ranks of five, 1.2 m apart, the front ranks 3 m apart across the Arena centre, facing each other. */
export function meleePlacements(n: number): { placements: Placement[]; teams: number[] } {
  const placements: Placement[] = [];
  const teams: number[] = [];
  const perTeam = [Math.ceil(n / 2), Math.floor(n / 2)];
  for (const team of [0, 1]) {
    for (let k = 0; k < perTeam[team]!; k++) {
      const rank = Math.floor(k / 5);
      const file = k % 5;
      const side = team === 0 ? -1 : 1;
      placements.push({ position: { x: (file - 2) * 1.2, z: side * (1.5 + rank * 1.2) }, facing: team === 0 ? 0 : Math.PI });
      teams.push(team);
    }
  }
  return { placements, teams };
}

/** A Match of one Duel between n Fighters (bypassing MAX_TEAM_SIZE by building the Duel directly) and its n Beginner AIs. */
export function meleeMatch(tuning: TuningData, n: number, seed = 1): { match: MatchState; ais: Controller[] } {
  const { placements, teams } = meleePlacements(n);
  const base = createMatch(tuning, { bestOf: 99, seed, arena: tuning.arena.editor });
  const weapons = teams.map(() => base.config.weapons[0]!);
  const duel = createInitialState(tuning, seed, placements, weapons, teams, tuning.arena.editor);
  const match: MatchState = { ...base, config: { ...base.config, teams, weapons }, duel };
  const ais = teams.map(() => createAiController(tuning, 'Beginner', DEFAULT_STYLE));
  return { match, ais };
}

export interface FighterBench {
  readonly n: number;
  /** Intents + `stepMatch`, per Tick. */
  readonly tick: Stats;
  /** The AI Controllers' share of `tick`: every Fighter's `intent()`. */
  readonly ai: Stats;
  /** A Tick as the Rollback session runs it: Intents + `stepMatch` + a snapshot + every AI's `save()`. */
  readonly onlineTick: Stats;
  /** One 15-Tick Rollback: restore + `load()` + 15 online Ticks. */
  readonly rollback: Stats;
  /** `hashValue` of the whole MatchState (the host's periodic checksum). */
  readonly hash: Stats;
  /** Fighters still standing at the end (a melee thins out, which makes later Ticks cheaper). */
  readonly alive: number;
  /** Every timed Rollback re-simulated to the hash it had the first time. */
  readonly deterministic: boolean;
}

/** Run an n-Fighter melee for `ticks` Ticks, timing every Tick, and a 15-Tick Rollback every `rollbackEvery` Ticks. */
export function benchFighters(tuning: TuningData, n: number, ticks: number, rollbackEvery = 10, now: () => number = () => performance.now()): FighterBench {
  let { match, ais } = meleeMatch(tuning, n);
  const tickMs: number[] = [];
  const aiMs: number[] = [];
  const onlineMs: number[] = [];
  const rollbackMs: number[] = [];
  const hashMs: number[] = [];
  /** The last ROLLBACK_TICKS + 1 states' snapshots and AI memories, by Tick. */
  const history = new Map<number, { snap: Snapshot<MatchState>; memory: unknown[] }>();
  const intentsOf = (m: MatchState): Intent[] => ais.map((c, i) => c.intent(m.duel, i));
  const save = () => ais.map((c) => c.save?.());
  history.set(match.tick, { snap: snapshot(match), memory: save() });
  let deterministic = true;

  for (let k = 0; k < ticks; k++) {
    let t0 = now();
    const intents = intentsOf(match);
    aiMs.push(now() - t0);
    const next = stepMatch(match, intents, tuning);
    const t1 = now();
    const snap = snapshot(next);
    const memory = save();
    const t2 = now();
    tickMs.push(t1 - t0);
    onlineMs.push(t2 - t0);
    match = next;
    history.set(match.tick, { snap, memory });
    history.delete(match.tick - BENCH_ROLLBACK_TICKS - 1);

    if (k % rollbackEvery === 0) {
      t0 = now();
      const h = hashValue(match);
      hashMs.push(now() - t0);
      const from = history.get(match.tick - BENCH_ROLLBACK_TICKS);
      if (from) {
        t0 = now();
        let m = restore(from.snap);
        ais.forEach((c, i) => c.load?.(from.memory[i]));
        for (let r = 0; r < BENCH_ROLLBACK_TICKS; r++) {
          m = stepMatch(m, intentsOf(m), tuning);
          snapshot(m);
          save();
        }
        rollbackMs.push(now() - t0);
        if (hashValue(m) !== h) deterministic = false;
      }
    }
  }
  const alive = match.duel.fighters.filter((f) => !f.death).length;
  return { n, tick: stats(tickMs), ai: stats(aiMs), onlineTick: stats(onlineMs), rollback: stats(rollbackMs), hash: stats(hashMs), alive, deterministic };
}

// ---------------------------------------------------------------- Crowd prototype

export interface CrowdParams {
  /** Soldiers per Team. */
  readonly perTeam: number;
  /** A Soldier updates every `stagger` Ticks, 1/stagger of them each Tick. */
  readonly stagger: number;
  readonly fieldSize: number;
  readonly walkSpeed: number;
  readonly hp: number;
  readonly damage: readonly [number, number];
  /** Chance a Soldier lands its blow on a Crowd step while engaged. */
  readonly hitChance: number;
  readonly engageReach: number;
  readonly separation: number;
  readonly sight: number;
  readonly flowCell: number;
  /** Each Team's flow field is rebuilt every this many Ticks, the two Teams half a period apart. */
  readonly flowTicks: number;
}

export const DEFAULT_CROWD: CrowdParams = {
  perTeam: 200,
  stagger: 6,
  fieldSize: 200,
  walkSpeed: 2.5,
  hp: 100,
  damage: [8, 20],
  hitChance: 0.35,
  engageReach: 1.6,
  separation: 0.9,
  sight: 12,
  flowCell: 4,
  flowTicks: 60,
};

/** The Crowd as struct-of-arrays, plus its grids. Only the arrays named in CROWD_FIELDS are state; the grids are scratch. */
export interface Crowd {
  readonly params: CrowdParams;
  readonly count: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly vx: Float64Array;
  readonly vz: Float64Array;
  readonly heading: Float64Array;
  readonly hp: Float64Array;
  readonly team: Int32Array;
  readonly target: Int32Array;
  readonly timer: Int32Array;
  readonly alive: Int32Array;
  /** The generator's state (mulberry32, as sim/rng.ts). */
  readonly rng: Uint32Array;
  /** Per Team: each flow cell's BFS distance to the nearest cell holding a living enemy. */
  readonly flow: readonly [Int32Array, Int32Array];
  // Spatial hash (rebuilt each Tick by counting sort).
  readonly cellSize: number;
  readonly cells: number;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  readonly queue: Int32Array;
}

export const CROWD_FIELDS = ['x', 'z', 'vx', 'vz', 'heading', 'hp', 'team', 'target', 'timer', 'alive', 'rng'] as const;

/** Two armies in ranks of 20, 1.5 m apart, 80 m apart across the field centre. */
export function createCrowd(params: CrowdParams = DEFAULT_CROWD, seed = 1): Crowd {
  const count = params.perTeam * 2;
  const flowSide = Math.ceil(params.fieldSize / params.flowCell);
  const cellSize = Math.max(params.engageReach, params.separation) * 2;
  const side = Math.ceil(params.fieldSize / cellSize);
  const crowd: Crowd = {
    params,
    count,
    x: new Float64Array(count),
    z: new Float64Array(count),
    vx: new Float64Array(count),
    vz: new Float64Array(count),
    heading: new Float64Array(count),
    hp: new Float64Array(count),
    team: new Int32Array(count),
    target: new Int32Array(count).fill(-1),
    timer: new Int32Array(count),
    alive: new Int32Array(count).fill(1),
    rng: new Uint32Array([seed >>> 0]),
    flow: [new Int32Array(flowSide * flowSide), new Int32Array(flowSide * flowSide)],
    cellSize,
    cells: side,
    cellStart: new Int32Array(side * side + 1),
    cellItems: new Int32Array(count),
    queue: new Int32Array(flowSide * flowSide),
  };
  for (let i = 0; i < count; i++) {
    const team = i < params.perTeam ? 0 : 1;
    const k = team === 0 ? i : i - params.perTeam;
    crowd.team[i] = team;
    crowd.x[i] = ((k % 20) - 9.5) * 1.5;
    crowd.z[i] = (team === 0 ? -1 : 1) * (40 + Math.floor(k / 20) * 1.5);
    crowd.heading[i] = team === 0 ? 0 : Math.PI;
    crowd.hp[i] = params.hp;
  }
  rebuildFlow(crowd, 0);
  rebuildFlow(crowd, 1);
  return crowd;
}

function random(crowd: Crowd): number {
  const s = (crowd.rng[0]! + 0x6d2b79f5) >>> 0;
  crowd.rng[0] = s;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const half = (crowd: Crowd) => crowd.params.fieldSize / 2;
function cellOf(crowd: Crowd, x: number, z: number): number {
  const cx = Math.min(crowd.cells - 1, Math.max(0, Math.floor((x + half(crowd)) / crowd.cellSize)));
  const cz = Math.min(crowd.cells - 1, Math.max(0, Math.floor((z + half(crowd)) / crowd.cellSize)));
  return cz * crowd.cells + cx;
}

function rebuildGrid(crowd: Crowd): void {
  const { cellStart, cellItems } = crowd;
  cellStart.fill(0);
  for (let i = 0; i < crowd.count; i++) if (crowd.alive[i]) cellStart[cellOf(crowd, crowd.x[i]!, crowd.z[i]!) + 1]!++;
  for (let c = 1; c < cellStart.length; c++) cellStart[c]! += cellStart[c - 1]!;
  const fill = cellStart.slice(0, -1);
  for (let i = 0; i < crowd.count; i++) if (crowd.alive[i]) cellItems[fill[cellOf(crowd, crowd.x[i]!, crowd.z[i]!)]!++] = i;
}

/** Team `team`'s flow field: BFS distance (in flow cells) from every cell holding a living enemy. */
function rebuildFlow(crowd: Crowd, team: number): void {
  const { flowCell, fieldSize } = crowd.params;
  const side = Math.ceil(fieldSize / flowCell);
  const field = crowd.flow[team as 0 | 1];
  const queue = crowd.queue;
  field.fill(-1);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < crowd.count; i++) {
    if (!crowd.alive[i] || crowd.team[i] === team) continue;
    const cx = Math.min(side - 1, Math.max(0, Math.floor((crowd.x[i]! + fieldSize / 2) / flowCell)));
    const cz = Math.min(side - 1, Math.max(0, Math.floor((crowd.z[i]! + fieldSize / 2) / flowCell)));
    const c = cz * side + cx;
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

/** The direction down Team `team`'s flow field from (x, z), as a unit vector, or [0, 0] at a minimum. */
function flowDirection(crowd: Crowd, team: number, x: number, z: number): [number, number] {
  const { flowCell, fieldSize } = crowd.params;
  const side = Math.ceil(fieldSize / flowCell);
  const field = crowd.flow[team as 0 | 1];
  const cx = Math.min(side - 1, Math.max(0, Math.floor((x + fieldSize / 2) / flowCell)));
  const cz = Math.min(side - 1, Math.max(0, Math.floor((z + fieldSize / 2) / flowCell)));
  const at = (ix: number, iz: number) => (ix < 0 || iz < 0 || ix >= side || iz >= side ? Infinity : field[iz * side + ix]! < 0 ? Infinity : field[iz * side + ix]!);
  const gx = at(cx - 1, cz) - at(cx + 1, cz);
  const gz = at(cx, cz - 1) - at(cx, cz + 1);
  const fx = Number.isFinite(gx) ? gx : at(cx + 1, cz) < at(cx - 1, cz) ? 1 : at(cx - 1, cz) < at(cx + 1, cz) ? -1 : 0;
  const fz = Number.isFinite(gz) ? gz : at(cx, cz + 1) < at(cx, cz - 1) ? 1 : at(cx, cz - 1) < at(cx, cz + 1) ? -1 : 0;
  const len = Math.hypot(fx, fz);
  return len > 0 ? [fx / len, fz / len] : [0, 0];
}

/** Step the Crowd one Tick: the grid, the flow fields due this Tick, and every Soldier whose index matches the Tick modulo the stagger. */
export function stepCrowd(crowd: Crowd, tick: number): void {
  const p = crowd.params;
  rebuildGrid(crowd);
  if (tick % p.flowTicks === 0) rebuildFlow(crowd, 0);
  if (tick % p.flowTicks === Math.floor(p.flowTicks / 2)) rebuildFlow(crowd, 1);
  const dt = p.stagger * TICK_SECONDS;
  const reach = Math.ceil(p.sight / crowd.cellSize);
  const sep2 = p.separation * p.separation;
  const sight2 = p.sight * p.sight;
  const { x, z, vx, vz, team, alive, hp, target, heading } = crowd;

  for (let i = tick % p.stagger; i < crowd.count; i += p.stagger) {
    if (!alive[i]) continue;
    const xi = x[i]!;
    const zi = z[i]!;
    const own = team[i]!;
    const cx = Math.min(crowd.cells - 1, Math.max(0, Math.floor((xi + half(crowd)) / crowd.cellSize)));
    const cz = Math.min(crowd.cells - 1, Math.max(0, Math.floor((zi + half(crowd)) / crowd.cellSize)));
    // Separation from the 3 × 3 neighbouring cells, and the nearest enemy within sight (rings outward until found).
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
      // A ring further out can only hold enemies further than this one.
      if (best >= 0 && (r * crowd.cellSize) ** 2 > bestD) break;
    }
    target[i] = best;
    let wx: number;
    let wz: number;
    if (best >= 0) {
      const d = Math.sqrt(bestD);
      if (d <= p.engageReach) {
        // Engaged: stand and trade blows.
        wx = wz = 0;
        if (random(crowd) < p.hitChance) {
          hp[best] = hp[best]! - (p.damage[0] + random(crowd) * (p.damage[1] - p.damage[0]));
          if (hp[best]! <= 0) alive[best] = 0;
        }
      } else {
        wx = (x[best]! - xi) / d;
        wz = (z[best]! - zi) / d;
      }
    } else [wx, wz] = flowDirection(crowd, own, xi, zi);
    let mx = wx * p.walkSpeed + sx / dt;
    let mz = wz * p.walkSpeed + sz / dt;
    const speed = Math.hypot(mx, mz);
    if (speed > p.walkSpeed) (mx *= p.walkSpeed / speed), (mz *= p.walkSpeed / speed);
    vx[i] = mx;
    vz[i] = mz;
    x[i] = xi + mx * dt;
    z[i] = zi + mz * dt;
    if (wx !== 0 || wz !== 0) heading[i] = Math.atan2(wx, wz);
    crowd.timer[i] = tick;
  }
}

/** Living Soldiers per Team. */
export function crowdAlive(crowd: Crowd): [number, number] {
  const out: [number, number] = [0, 0];
  for (let i = 0; i < crowd.count; i++) if (crowd.alive[i]) out[crowd.team[i] as 0 | 1]++;
  return out;
}

/** The Crowd's state as plain arrays, as it would sit in a SimState for `hashValue` and `snapshot`. */
export function crowdPlain(crowd: Crowd): Record<string, number[]> {
  return Object.fromEntries(CROWD_FIELDS.map((k) => [k, Array.from(crowd[k])]));
}

/** FNV-1a 32-bit straight over the typed arrays' bytes: a fast path `hashValue` could take for the Crowd. */
export function hashCrowdBytes(crowd: Crowd): string {
  let h = 0x811c9dc5;
  for (const k of CROWD_FIELDS) {
    const bytes = new Uint8Array(crowd[k].buffer);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A snapshot of the Crowd's state: one typed-array copy per field. */
export function snapshotCrowd(crowd: Crowd): ArrayBufferView[] {
  return CROWD_FIELDS.map((k) => crowd[k].slice());
}

export interface CrowdBench {
  readonly stagger: number;
  readonly soldiers: number;
  /** One Crowd Tick (grid, flow fields due, 1/stagger of the Soldiers). */
  readonly step: Stats;
  /** `hashValue` of the Crowd as plain arrays (what today's checksum would do). */
  readonly hashPlain: Stats;
  /** FNV over the typed arrays' bytes. */
  readonly hashBytes: Stats;
  /** A snapshot of the typed arrays. */
  readonly snapshotTyped: Stats;
  /** `snapshot()` (deep copy) of the Crowd as plain arrays. */
  readonly snapshotPlain: Stats;
  readonly alive: [number, number];
  /** Two runs from the same seed ended with the same byte hash. */
  readonly deterministic: boolean;
}

/** Run the Crowd for `ticks` Ticks, timing every Tick, and the hash and snapshot costs every `sampleEvery` Ticks. */
export function benchCrowd(params: CrowdParams, ticks: number, sampleEvery = 30, now: () => number = () => performance.now()): CrowdBench {
  const crowd = createCrowd(params);
  const stepMs: number[] = [];
  const hashPlainMs: number[] = [];
  const hashBytesMs: number[] = [];
  const snapTypedMs: number[] = [];
  const snapPlainMs: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    let t0 = now();
    stepCrowd(crowd, t);
    stepMs.push(now() - t0);
    if (t % sampleEvery === 0) {
      t0 = now();
      const plain = crowdPlain(crowd);
      hashValue(plain);
      hashPlainMs.push(now() - t0);
      t0 = now();
      hashCrowdBytes(crowd);
      hashBytesMs.push(now() - t0);
      t0 = now();
      snapshotCrowd(crowd);
      snapTypedMs.push(now() - t0);
      t0 = now();
      snapshot({ tick: t, crowd: plain });
      snapPlainMs.push(now() - t0);
    }
  }
  const again = createCrowd(params);
  for (let t = 1; t <= ticks; t++) stepCrowd(again, t);
  return {
    stagger: params.stagger,
    soldiers: crowd.count,
    step: stats(stepMs),
    hashPlain: stats(hashPlainMs),
    hashBytes: stats(hashBytesMs),
    snapshotTyped: stats(snapTypedMs),
    snapshotPlain: stats(snapPlainMs),
    alive: crowdAlive(crowd),
    deterministic: hashCrowdBytes(again) === hashCrowdBytes(crowd),
  };
}
