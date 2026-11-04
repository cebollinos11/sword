/**
 * Squads and Formations (docs/plans/battle-objectives.md, Stage 1; ADR 0021): a Battle's Soldiers are deployed in fixed groups, each
 * moving in a Formation round an anchor. Squad state is plain data beside the Crowd (`CrowdState.squads`, and each Soldier's `squad`
 * and `place`), hashed, snapshotted and rolled back with it.
 *
 * - The anchor: a point and a heading per Squad. It turns at `squad.turnRate` toward its aim and walks at `squad.speed` of a
 *   Soldier's pace, every Tick (a few dozen of them). Soldiers steer to their place in the Formation round it (`stepCrowd`).
 * - The Formation, chosen by the situation (never by order): a **line** facing the enemy once an enemy Soldier is within
 *   `squad.engage` and no wall of the map stands between them (the first `line.wide` places are the front rank that fights), a **column** on the march, **loose** when the
 *   Squad is down to `squad.looseBelow` of its strength or falling back.
 * - The brain steps every `squad.brainSeconds` (2 Hz), each Squad on its own Tick (staggered by its place in its own army, so the
 *   k-th Squads of the two armies think together). It reads the Tick's Soldiers and the other Team's Squads as they stood, never
 *   as the other brain left them this Tick, so neither army thinks a step ahead. Its Order is what
 *   the Commander (Stage 2a, `commander.ts`) gives them: march to an Objective by its destination field and stand there (attack or
 *   defend), or stand at a spawn awaiting Orders.
 * - A Squad's rear rank steps up into gaps: its living Soldiers whose place is past its living count take the lowest free places.
 * - Morale: a Squad down to `squad.moraleThreshold` of `squad.size` falls back toward its Team's Base (loose; its Soldiers break off
 *   their fights and walk, see `stepCrowd`). Within `squad.mergeRange` of the Base it merges into the nearest other Squad of its Team that
 *   is that close to it and has room (at most `squad.mergeMax` living Soldiers): remnants gather at the Base and join. Back above
 *   `squad.looseBelow` (merged remnants) it rallies and marches out again.
 * - A Squad with no living Soldier, wiped out or merged away, is empty. `tickets.respawnSeconds` after the brain first sees it empty, while
 *   its Team has Tickets, it respawns whole at the spawn its Order names (its Base, or an Objective its Team owns that no enemy is on):
 *   up to `squad.size` of its Team's dead Soldiers (not promoted ones) are given back to it, at full HP, in column round the spawn.
 *
 * - On a map of several levels (Stage 4a), the anchor stands on a Walk Surface (`SquadState.surface`) and walks by the Soldiers' walk rule
 *   (`levels.ts`); a Squad's places, its spot at an Objective and the enemies it is in contact with are those of its own level.
 *
 * Pure: nothing here mutates its input, and nothing reads anything but the state and the Tuning Data.
 */
import { deployLayout, squadSizes, type BattleTuning } from '../tuning';
import { secondsToTicks, TICK_SECONDS } from './constants';
import type { CrowdFighter, CrowdState } from './crowd';
import { groundOf, inBlock, pushOutOfBlocks, soldierHeight } from './battlefield';
import { clearanceAt, clearanceBelow, inSight, steerToward, type BattleMap, type DestinationFields } from './destinations';
import { onSurface } from './arena';
import { sameLevel, trace, walkTo } from './levels';
import { respawnTicks } from './objectives';

export const COLUMN = 0;
export const LINE = 1;
export const LOOSE = 2;

/**
 * A Squad's Order, given by its Team's Commander (`commander.ts`): ATTACK an Objective the Team does not own, DEFEND one it does,
 * RESPAWN (an empty Squad waits to respawn at the spawn its `target` names; a Squad just respawned awaits Orders). A Squad down to
 * its morale threshold falls back (`SquadState.fall`), whatever its Order: FALL is how the debug view names that.
 */
export const ATTACK = 0;
export const DEFEND = 1;
export const RESPAWN = 2;
export const FALL = 3;

/** The Squads as struct-of-arrays: entry q of each array is Squad q. Team 0's Squads come first, then Team 1's. */
export interface SquadState {
  readonly team: readonly number[];
  /** The anchor (x, z) and its heading: yaw in radians, 0 facing +z. */
  readonly x: readonly number[];
  readonly z: readonly number[];
  readonly heading: readonly number[];
  /** The heading the anchor turns toward, and the pace (m/s) along its heading. */
  readonly aim: readonly number[];
  readonly speed: readonly number[];
  /** The Formation: COLUMN, LINE or LOOSE. */
  readonly shape: readonly number[];
  /** Its living Soldiers (promoted ones included) at its last brain step. */
  readonly living: readonly number[];
  /** 1 while it falls back toward its Base, else 0. */
  readonly fall: readonly number[];
  /** Its Order's kind (ATTACK, DEFEND or RESPAWN), and its destination: an Objective's index, or for RESPAWN a spawn (an Objective, or `objectives + team` for the Team's Base). */
  readonly order: readonly number[];
  readonly target: readonly number[];
  /** The Tick the Order was given: the Commander holds it at least `commander.holdSeconds` from then. */
  readonly since: readonly number[];
  /** The Tick an empty Squad respawns at (once its Team has Tickets), or -1 while it is not empty. */
  readonly respawnAt: readonly number[];
  /** The Walk Surface its anchor stands on (Stage 4a; an index into the map's `walk`), or -1 on the open field. */
  readonly surface: readonly number[];
}

/** The golden angle (radians), which spreads places round an Objective's centre. */
const GOLDEN = 2.399963229728653;
/** How many more places in an Objective's circle a Squad tries on a map when its own has no room for its Formation (`orderSpot`). */
const SPOT_TRIES = 6;
/** How far out (share of the radius) those other places reach: inside the circle, so the Squad still counts there. */
const SPOT_REACH = 0.85;

/**
 * Squad `q`'s (of `per` in its army) own place at destination `target` (an Objective's index, or `objectives + team` for a Base) as a world
 * point: a place in the Objective's circle, spread by the Squad's place in its army (the golden angle) and turned half a turn for Team 1 as the
 * armies are, so Squads on one Objective, or respawning at one, do not stack; at a Base, a row across it. On a map, a place without room for a
 * column (`narrow.room` from the walls past its outer files: a wall across a gatehouse's circle) gives way to the first of the Squad's own
 * further places that has (Stage 3b): its share of a denser spiral over the circle (every `per`-th place from its own), so two Squads never
 * share one; to the roomiest of them when none has. On a map of several levels (Stage 4a) a place counts only where a Soldier walks to it
 * from the destination's centre without dropping (on its level: never off a keep's edge onto the ground below), and its Walk Surface is
 * returned; -1 on any other map.
 */
export function orderSpot(map: BattleMap, target: number, q: number, per: number, battle: BattleTuning, out: [number, number]): number {
  const { objectives, bases } = map.field;
  const k = q % per;
  const sign = q < per ? 1 : -1;
  const layered = map.field.layered;
  if (target >= objectives.length) {
    const base = bases[target - objectives.length]!;
    // A row across the Base, as wide as the Squads' columns need but never past the field's edges, Team 1's turned half a turn like the rest.
    const gap = Math.min(battle.squad.column.wide * battle.squad.spacing * 1.5, (battle.field.size - 8) / per);
    out[0] = base.x + sign * (k - (per - 1) / 2) * gap;
    out[1] = base.z;
    if (!layered) return -1;
    const home = map.field.baseSurfaces[target - objectives.length]!;
    const on = trace(map.field.arena, battle.levels, home, base.x, base.z, out[0], out[1], false);
    return on >= 0 ? on : groundOf(battle, map.field, out[0], out[1], soldierHeight(map.field, home, base.x, base.z));
  }
  const o = objectives[target]!;
  const reach = 0.7 * o.radius * Math.sqrt((k + 0.5) / per);
  out[0] = o.x + sign * Math.sin(k * GOLDEN) * reach;
  out[1] = o.z + sign * Math.cos(k * GOLDEN) * reach;
  if (!map.fields.clearance) return -1;
  const home = layered ? map.field.objectiveSurfaces[target]! : -1;
  /** The Walk Surface a place stands on, walked to from the Objective's centre (-1: none on its level); -1 on a one-level map. */
  const on = (x: number, z: number) => (layered ? trace(map.field.arena, battle.levels, home, o.x, o.z, x, z, false) : -1);
  const room = (x: number, z: number, at: number) => (layered && at < 0 ? -Infinity : clearanceAt(map.fields, x, z, at));
  const need = battle.squad.narrow.room + ((battle.squad.column.wide - 1) / 2) * battle.squad.spacing;
  let bs = on(out[0], out[1]);
  let best = room(out[0], out[1], bs);
  if (best >= need) return bs;
  let bx = out[0];
  let bz = out[1];
  for (let t = 1; t <= SPOT_TRIES; t++) {
    const j = k + t * per;
    const r = SPOT_REACH * o.radius * Math.sqrt((j + 0.5) / (per * (SPOT_TRIES + 1)));
    const x = o.x + sign * Math.sin(j * GOLDEN) * r;
    const z = o.z + sign * Math.cos(j * GOLDEN) * r;
    const at = on(x, z);
    const clear = room(x, z, at);
    if (clear > best) [best, bx, bz, bs] = [clear, x, z, at];
    if (clear >= need) break;
  }
  // The centre, never inside a block (nor off its level), if even the roomiest is.
  const blocked = inBlock(map.field, bx, bz) || best === -Infinity;
  out[0] = blocked ? o.x : bx;
  out[1] = blocked ? o.z : bz;
  return blocked ? home : bs;
}

/** Squads in each army. */
export const squadsPerTeam = (battle: BattleTuning): number => squadSizes(battle.armySize, battle.squad.size).length;

/** Whether Squad `q` (of `perTeam` in each army) thinks on `tick`: by its place in its own army, once every `brainTicks`. */
export const squadDue = (q: number, tick: number, perTeam: number, brainTicks: number): boolean => (q % perTeam) % brainTicks === tick % brainTicks;

/** Ticks between a Squad's brain steps (`squad.brainSeconds`, at least 1). */
export const brainTicks = (battle: BattleTuning): number => Math.max(1, secondsToTicks(battle.squad.brainSeconds));

/**
 * Where place `place` of a Formation stands from the anchor, as a world offset (x, z) into `out`, for an anchor heading `heading`.
 * The column and the line fill rows from the front (the first row is ahead of the anchor), centred on the Squad's nominal depth;
 * the loose Formation fills a spiral. A Formation narrowed to `narrow` files (`formationNarrow`, more than 0) fills rows that wide
 * whatever its shape, centred on the depth of its `living` Soldiers.
 */
export function placeOffset(battle: BattleTuning, shape: number, place: number, heading: number, out: [number, number], narrow = 0, living = battle.squad.size): void {
  const { spacing, size, column, line, loose } = battle.squad;
  let r: number;
  let f: number;
  if (narrow > 0) {
    r = ((place % narrow) - (narrow - 1) / 2) * spacing;
    f = ((Math.ceil(Math.max(1, living) / narrow) - 1) / 2 - Math.floor(place / narrow)) * spacing;
  } else if (shape === LOOSE) {
    const reach = spacing * loose.spread * Math.sqrt(place + 1);
    r = Math.sin(place * 2.4) * reach;
    f = Math.cos(place * 2.4) * reach;
  } else {
    const wide = shape === LINE ? line.wide : column.wide;
    r = ((place % wide) - (wide - 1) / 2) * spacing;
    f = ((Math.ceil(size / wide) - 1) / 2 - Math.floor(place / wide)) * spacing;
  }
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  out[0] = r * c + f * s;
  out[1] = -r * s + f * c;
}

/**
 * How many files a Squad's Formation narrows to where its anchor stands at (x, z) facing `heading` (docs/plans/battle-objectives.md,
 * Stage 3b): as many as the least clearance ahead holds, sampled every `spacing` from its anchor to `narrow.ahead` past it, keeping
 * `narrow.room` from the walls on each side. 0 when its own Formation fits (it does not narrow), and
 * always on the open field. A column or a line narrows to fewer files than its own; a loose Formation wider than the room, to rows.
 * At least 1.
 */
export function formationNarrow(battle: BattleTuning, fields: DestinationFields, shape: number, living: number, x: number, z: number, heading: number, surface = -1): number {
  if (!fields.clearance) return 0;
  const { spacing, column, line, loose, narrow } = battle.squad;
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  let least = Infinity;
  for (let d = 0; d <= narrow.ahead + 1e-9; d += spacing) least = Math.min(least, clearanceAt(fields, x + s * d, z + c * d, surface));
  const fit = Math.max(1, Math.floor((2 * (least - narrow.room)) / spacing) + 1);
  if (shape === LOOSE) return spacing * loose.spread * Math.sqrt(Math.max(1, living)) + narrow.room <= least ? 0 : fit;
  return fit < (shape === LINE ? line.wide : column.wide) ? fit : 0;
}

/** Each Squad's narrowing (`formationNarrow`) where its anchor stands: scratch, a function of the Squads' state, never state itself. */
export function squadNarrows(battle: BattleTuning, map: BattleMap, squads: SquadState): number[] {
  const out = new Array<number>(squads.team.length).fill(0);
  if (!map.fields.clearance) return out;
  for (let q = 0; q < out.length; q++) out[q] = formationNarrow(battle, map.fields, squads.shape[q]!, squads.living[q]!, squads.x[q]!, squads.z[q]!, squads.heading[q]!, squads.surface[q]);
  return out;
}

/**
 * How many points of the line from a Squad's anchor out to a Soldier's place are tried, from the place inward, before the anchor itself:
 * where a place a Soldier cannot walk to from the anchor moves in to (`formationSpot`), and the points a Soldier walled off from its place
 * walks to on the way (`stepCrowd`).
 */
export const SPOKE_POINTS = 4;

/**
 * Where place `place` of Squad `q` stands, as a world point into `out`: its place in the Formation (`placeOffset`) round the anchor,
 * narrowed to `narrow` files (`squadNarrows`). On a map, a place a Soldier could not walk to from the anchor (inside a block, or past one, or
 * nearer one than a Soldier's half `separation`) moves in toward the anchor, along its own line, until it can (the anchor itself, at the
 * last, which is always clear). On a map of several levels (Stage 4a) it must also be walked to from the anchor without dropping (so a place
 * past the edge of a bridge moves in onto the bridge), and its Walk Surface is returned; -1 on any other map.
 */
export function formationSpot(battle: BattleTuning, map: BattleMap, squads: SquadState, q: number, place: number, narrow: number, out: [number, number]): number {
  placeOffset(battle, squads.shape[q]!, place, squads.heading[q]!, out, narrow, squads.living[q]);
  const ox = out[0];
  const oz = out[1];
  const ax = squads.x[q]!;
  const az = squads.z[q]!;
  out[0] = ax + ox;
  out[1] = az + oz;
  const body = battle.crowd.separation / 2;
  if (map.field.layered) {
    const from = squads.surface[q]!;
    // No block can stand across a line shorter than the anchor's clearance (less a body's half width): then only the Walk Surface is traced.
    const sure = Math.hypot(ox, oz) + body < clearanceBelow(map.fields, ax, az, from);
    for (let t = SPOKE_POINTS; t > 0; t--) {
      const x = ax + (ox * t) / SPOKE_POINTS;
      const z = az + (oz * t) / SPOKE_POINTS;
      const on = !sure && map.field.blocks.length > 0 && !inSight(map.fields, ax, az, x, z, body) ? -1 : trace(map.field.arena, battle.levels, from, ax, az, x, z, false);
      if (on < 0) continue;
      out[0] = x;
      out[1] = z;
      return on;
    }
    out[0] = ax;
    out[1] = az;
    return from;
  }
  if (map.field.blocks.length === 0) return -1;
  if (Math.hypot(ox, oz) + body < clearanceBelow(map.fields, ax, az)) return -1;
  for (let t = SPOKE_POINTS - 1; t >= 0 && !inSight(map.fields, ax, az, out[0], out[1], body); t--) {
    out[0] = ax + (ox * t) / SPOKE_POINTS;
    out[1] = az + (oz * t) / SPOKE_POINTS;
  }
  return -1;
}

/** Enemy Soldiers (in the Crowd) and full Fighters of Team `own` standing inside Objective `at`'s circle. */
function enemiesIn(crowd: CrowdState, map: BattleMap, fighters: readonly CrowdFighter[], own: number, at: number): number {
  const site = map.field.objectives[at]!;
  const n = crowd.x.length;
  let enemies = 0;
  for (let i = 0; i < n; i++)
    if (crowd.alive[i] && crowd.team[i] !== own && crowd.slot[i]! < 0 && (crowd.x[i]! - site.x) ** 2 + (crowd.z[i]! - site.z) ** 2 <= site.radius * site.radius) enemies++;
  for (const f of fighters) if (f.team !== own && (f.x - site.x) ** 2 + (f.z - site.z) ** 2 <= site.radius * site.radius) enemies++;
  return enemies;
}

/** Where Team `team`'s broken Squads may rally: the spawns it owns with no enemy on them, then its Base (destination indices, as an Order's target). */
function rallyPoints(crowd: CrowdState, map: BattleMap, fighters: readonly CrowdFighter[], team: number): number[] {
  const objectives = map.field.objectives;
  const found: number[] = [];
  for (let j = 0; j < objectives.length; j++) {
    // In the Team's own order (reversed for Team 1), so a tie in distance goes to the mirrored place for each.
    const k = team === 0 ? j : objectives.length - 1 - j;
    if (objectives[k]!.spawn && crowd.objectives.owner[k] === team && enemiesIn(crowd, map, fighters, team, k) === 0) found.push(k);
  }
  found.push(objectives.length + team);
  return found;
}

/** The nearest of `rallies` (`rallyPoints`) to (x, z), the first on a tie. */
function nearestRally(map: BattleMap, rallies: readonly number[], x: number, z: number): number {
  const objectives = map.field.objectives;
  let rally = rallies[0]!;
  let rallyD = Infinity;
  for (const k of rallies) {
    const at = k < objectives.length ? objectives[k]! : map.field.bases[k - objectives.length]!;
    const d2 = (at.x - x) ** 2 + (at.z - z) ** 2;
    if (d2 < rallyD) [rally, rallyD] = [k, d2];
  }
  return rally;
}

/** The Squads and Soldiers at the start of a Battle, as `createCrowd` deploys them. */
export interface Deployment {
  readonly squads: SquadState;
  /** Per Soldier (Team 0's first): its Squad and place, and where it stands facing which way. */
  readonly squad: number[];
  readonly place: number[];
  readonly x: number[];
  readonly z: number[];
  readonly team: number[];
  readonly heading: number[];
}

/**
 * Both armies deployed in Squads: each Team's Squads in ranks of `deployLayout().perRank` side by side, each in column, the front
 * rank's first row `front` (the map's, `deploy.front` on the open field) from the centre. Team 0 at -z facing +z, Team 1 at +z facing -z,
 * mirrors of each other.
 */
export function deploySquads(battle: BattleTuning, front = battle.deploy.front): Deployment {
  const layout = deployLayout(battle);
  const { spacing, column } = battle.squad;
  const per = layout.sizes.length;
  const squad: number[] = [];
  const place: number[] = [];
  const x: number[] = [];
  const z: number[] = [];
  const team: number[] = [];
  const heading: number[] = [];
  const anchors = { x: [] as number[], z: [] as number[], heading: [] as number[], team: [] as number[] };
  const out: [number, number] = [0, 0];
  for (const t of [0, 1]) {
    const turn = t === 0 ? 0 : Math.PI;
    for (let k = 0; k < per; k++) {
      const rank = Math.floor(k / layout.perRank);
      const inRank = Math.min(layout.perRank, per - rank * layout.perRank);
      const lx = (k - rank * layout.perRank - (inRank - 1) / 2) * column.wide * spacing;
      const lz = -(front + ((layout.rows - 1) / 2) * spacing + rank * layout.deepest * spacing);
      const q = t * per + k;
      anchors.x.push(t === 0 ? lx : -lx);
      anchors.z.push(t === 0 ? lz : -lz);
      anchors.heading.push(turn);
      anchors.team.push(t);
      for (let s = 0; s < layout.sizes[k]!; s++) {
        placeOffset(battle, COLUMN, s, turn, out);
        squad.push(q);
        place.push(s);
        x.push(anchors.x[q]! + out[0]);
        z.push(anchors.z[q]! + out[1]);
        team.push(t);
        heading.push(turn);
      }
    }
  }
  const m = 2 * per;
  const zeros = () => new Array<number>(m).fill(0);
  const squads: SquadState = {
    team: anchors.team,
    x: anchors.x,
    z: anchors.z,
    heading: anchors.heading,
    aim: anchors.heading.slice(),
    speed: zeros(),
    shape: new Array<number>(m).fill(COLUMN),
    living: anchors.team.map((_, q) => layout.sizes[q % per]!),
    fall: zeros(),
    // Awaiting Orders: the Commander's first plan gives them (`createCrowd`).
    order: new Array<number>(m).fill(RESPAWN),
    target: zeros(),
    since: zeros(),
    respawnAt: new Array<number>(m).fill(-1),
    // On a Battle map, `createCrowd` stands each anchor on its Walk Surface.
    surface: new Array<number>(m).fill(-1),
  };
  return { squads, squad, place, x, z, team, heading };
}

/** A Soldier a Squad's respawn gave back: where it stands now (on which Walk Surface, -1 on the open field), facing which way. It is at full HP, engaged with no one. */
export interface Spawned {
  readonly i: number;
  readonly x: number;
  readonly z: number;
  readonly surface: number;
  readonly heading: number;
}

/**
 * What a Squad step changes: the Squads, which Squad and place each Soldier has (the same arrays when nothing moved), and the Soldiers
 * respawned; and, scratch for the Tick's Soldier steps, how many files each Squad's Formation narrows to where its anchor now stands
 * (`squadNarrows`).
 */
export interface SquadStep {
  readonly squads: SquadState;
  readonly squad: readonly number[];
  readonly place: readonly number[];
  readonly spawned: readonly Spawned[];
  readonly narrow: readonly number[];
}

/** Each Soldier's height as the brains read it, on a map of several levels (scratch, never state). */
let levelScratch = new Float64Array(0);

const wrap = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * The Squads one Tick on (`tick` is the Tick being stepped): the brains due think (see the file's header), then every anchor
 * turns and walks. Once a Team has routed nothing steps: the Soldiers flee and the Squads stand.
 */
export function stepSquads(crowd: CrowdState, tick: number, battle: BattleTuning, map: BattleMap, fighters: readonly CrowdFighter[] = []): SquadStep {
  const old = crowd.squads;
  if (crowd.rout) return { squads: old, squad: crowd.squad, place: crowd.place, spawned: [], narrow: squadNarrows(battle, map, old) };
  const p = battle.squad;
  const walk = battle.crowd.walkSpeed;
  const m = old.team.length;
  const per = m / 2;
  const n = crowd.x.length;
  const ticks = brainTicks(battle);
  const x = old.x.slice();
  const z = old.z.slice();
  const heading = old.heading.slice();
  const surface = old.surface.slice();
  const field = map.field;
  // On a map of several levels (Stage 4a), anchors walk by the walk rule, and a Squad sees and is in contact only with its own level.
  const layered = field.layered;
  const lv = battle.levels;

  // The brains due: Team 0's Squads by place in the army, then Team 1's.
  const due: number[] = [];
  for (const t of [0, 1]) for (let k = tick % ticks; k < per; k += ticks) due.push(t * per + k);
  let aim = old.aim;
  let speed = old.speed;
  let shape = old.shape;
  let living = old.living;
  let fall = old.fall;
  let order = old.order;
  let respawnAt = old.respawnAt;
  let squad = crowd.squad;
  let place = crowd.place;
  const spawned: Spawned[] = [];
  const half = battle.field.size / 2 - 2;
  const objectives = map.field.objectives;
  const spot: [number, number] = [0, 0];
  /** Where Team `team`'s broken Squads may rally (`rallyPoints`, from the Soldiers as they stood at the start of the Tick), found on first need. */
  const rallies: (number[] | undefined)[] = [];
  const rallyOf = (team: number): number[] => (rallies[team] ??= rallyPoints(crowd, map, fighters, team));
  /** Destination `d`'s Walk Surface (an Objective's, or `objectives + team` for a Base's). */
  const surfaceOf = (d: number): number => (d < objectives.length ? field.objectiveSurfaces[d]! : field.baseSurfaces[d - objectives.length]!);

  if (due.length > 0) {
    // Each Soldier's height as it stood, where levels matter.
    if (layered && levelScratch.length < n) levelScratch = new Float64Array(n);
    const ys = layered ? levelScratch : null;
    if (ys) for (let i = 0; i < n; i++) ys[i] = soldierHeight(field, crowd.surface[i]!, crowd.x[i]!, crowd.z[i]!);
    const nextAim = old.aim.slice();
    const nextSpeed = old.speed.slice();
    const nextShape = old.shape.slice();
    const nextLiving = old.living.slice();
    const nextFall = old.fall.slice();
    const nextRespawnAt = old.respawnAt.slice();
    const nextOrder = old.order.slice();
    const claimed = new Set<number>();
    // Squads that respawned this Tick: their Soldiers are still dead in `crowd`, so nothing merges into them until the next.
    const respawned = new Set<number>();
    const edit: { squad: number[] | null; place: number[] | null } = { squad: null, place: null };
    // Every Soldier of the Squads due, in index order.
    const slotOf = new Int32Array(m).fill(-1);
    due.forEach((q, d) => (slotOf[q] = d));
    const members: number[][] = due.map(() => []);
    for (let i = 0; i < n; i++) {
      const d = crowd.squad[i]! >= 0 ? slotOf[crowd.squad[i]!]! : -1;
      if (d >= 0) members[d]!.push(i);
    }
    const free = (r: number): Set<number> => {
      const taken = new Set<number>();
      for (let i = 0; i < n; i++) if (crowd.alive[i] && (edit.squad ?? crowd.squad)[i] === r) taken.add((edit.place ?? crowd.place)[i]!);
      return taken;
    };

    due.forEach((q, d) => {
      const own = old.team[q]!;
      let alive = 0;
      let inCrowd = 0;
      let contact = 0;
      let cx = 0;
      let cz = 0;
      for (const i of members[d]!) {
        if (!crowd.alive[i]) continue;
        alive++;
        if (crowd.slot[i]! >= 0) continue;
        inCrowd++;
        cx += crowd.x[i]!;
        cz += crowd.z[i]!;
        if (crowd.target[i]! >= 0) contact++;
      }
      nextLiving[q] = alive;
      nextSpeed[q] = 0;
      if (alive === 0) {
        if (old.respawnAt[q]! < 0) nextRespawnAt[q] = tick + respawnTicks(battle);
        else if (tick >= old.respawnAt[q]! && crowd.tickets[own]! > 0) {
          // Respawn whole at the spawn its Order names, or its Base when that is not one it may use now.
          const base = objectives.length + own;
          let at = old.order[q] === RESPAWN ? old.target[q]! : base;
          if (at < objectives.length) {
            if (!objectives[at]!.spawn || crowd.objectives.owner[at] !== own || enemiesIn(crowd, map, fighters, own, at) > 0) at = base;
          }
          const slots: number[] = [];
          for (let i = own * battle.armySize; i < (own + 1) * battle.armySize && slots.length < p.size; i++)
            if (!crowd.alive[i] && crowd.slot[i]! < 0 && !claimed.has(i)) slots.push(i);
          if (slots.length === 0) return;
          const spotOn = orderSpot(map, at, q, per, battle, spot);
          // The anchor stands on the spot's Walk Surface on a map of several levels, else on the floor under it.
          const anchorOn = layered ? spotOn : groundOf(battle, field, spot[0], spot[1]);
          const spotY = soldierHeight(field, anchorOn, spot[0], spot[1]);
          const facing = own === 0 ? 0 : Math.PI;
          const nextSquad = (edit.squad ??= crowd.squad.slice());
          const nextPlace = (edit.place ??= crowd.place.slice());
          const out: [number, number] = [0, 0];
          slots.forEach((i, s) => {
            placeOffset(battle, COLUMN, s, facing, out);
            claimed.add(i);
            nextSquad[i] = q;
            nextPlace[i] = s;
            // On the field, and out of a map's blocks.
            pushOutOfBlocks(map.field, Math.max(-half, Math.min(half, spot[0] + out[0])), Math.max(-half, Math.min(half, spot[1] + out[1])), battle.crowd.separation / 2, own, out);
            // On the spot's level where it walks there from the spot, else on the ground there nearest the spot's height.
            const on = layered && anchorOn >= 0 ? trace(field.arena, lv, anchorOn, spot[0], spot[1], out[0], out[1], false) : -1;
            spawned.push({ i, x: out[0], z: out[1], surface: on >= 0 ? on : groundOf(battle, field, out[0], out[1], spotY), heading: facing });
          });
          x[q] = spot[0];
          z[q] = spot[1];
          surface[q] = anchorOn;
          heading[q] = facing;
          nextAim[q] = facing;
          nextShape[q] = COLUMN;
          nextLiving[q] = slots.length;
          nextFall[q] = 0;
          nextRespawnAt[q] = -1;
          nextOrder[q] = RESPAWN;
          respawned.add(q);
        }
        return;
      }
      if (inCrowd > 0) {
        cx /= inCrowd;
        cz /= inCrowd;
      } else {
        cx = old.x[q]!;
        cz = old.z[q]!;
      }

      // The rear rank steps up: a living Soldier whose place is past the living count takes the lowest free place before it.
      if (members[d]!.some((i) => crowd.alive[i] && crowd.place[i]! >= alive)) {
        const nextPlace = (edit.place ??= crowd.place.slice());
        const taken = new Uint8Array(alive);
        for (const i of members[d]!) if (crowd.alive[i] && crowd.place[i]! < alive) taken[crowd.place[i]!] = 1;
        let lowest = 0;
        for (const i of members[d]!) {
          if (!crowd.alive[i] || crowd.place[i]! < alive) continue;
          while (lowest < alive && taken[lowest]) lowest++;
          if (lowest >= alive) break;
          nextPlace[i] = lowest;
          taken[lowest] = 1;
        }
      }

      // Morale: down to the threshold, fall back; back above `looseBelow` (merged remnants), rally.
      if (!nextFall[q] && alive < p.moraleThreshold * p.size) nextFall[q] = 1;
      else if (nextFall[q] && alive >= p.looseBelow * p.size) nextFall[q] = 0;

      if (nextFall[q]) {
        nextShape[q] = LOOSE;
        // It rallies at the nearest spawn its Team owns with no enemy on it, else at its Base.
        const rally = nearestRally(map, rallyOf(own), old.x[q]!, old.z[q]!);
        const rallyAt = rally < objectives.length ? objectives[rally]! : map.field.bases[rally - objectives.length]!;
        const dx = rallyAt.x - old.x[q]!;
        const dz = rallyAt.z - old.z[q]!;
        const toRally = Math.hypot(dx, dz);
        // At its rally point, another Squad of the Team close by with room: merge into it (nearest first; the lower Squad on a tie).
        let into = -1;
        let intoD = p.mergeRange * p.mergeRange;
        for (let r = own * per; toRally <= p.mergeRange && r < (own + 1) * per; r++) {
          // A Squad that thinks later this Tick would recount without its new Soldiers: it cannot be merged into yet.
          if (r === q || slotOf[r]! > d || respawned.has(r) || nextLiving[r]! === 0 || nextLiving[r]! + alive > p.mergeMax) continue;
          const d2 = (old.x[r]! - old.x[q]!) ** 2 + (old.z[r]! - old.z[q]!) ** 2;
          if (d2 < intoD) [into, intoD] = [r, d2];
        }
        if (into >= 0) {
          const nextSquad = (edit.squad ??= crowd.squad.slice());
          const nextPlace = (edit.place ??= crowd.place.slice());
          const taken = free(into);
          let lowest = 0;
          for (const i of members[d]!) {
            if (!crowd.alive[i]) continue;
            while (taken.has(lowest)) lowest++;
            nextSquad[i] = into;
            nextPlace[i] = lowest;
            taken.add(lowest);
          }
          nextLiving[into] = nextLiving[into]! + alive;
          nextLiving[q] = 0;
          nextFall[q] = 0;
          return;
        }
        // Straight at it when nothing blocks the way, else round a map's walls by its field (Stage 3b).
        nextAim[q] = steerToward(map.fields, rally, old.x[q]!, old.z[q]!, rallyAt.x, rallyAt.z, own, old.surface[q], surfaceOf(rally));
        nextSpeed[q] = toRally > 2 * p.spacing ? walk : 0;
        return;
      }

      // The nearest enemy Soldier to this Squad's Soldiers (as they stood), on its anchor's level: within `engage` it is in contact, and the
      // Squad turns to it.
      const ay = ys === null ? 0 : soldierHeight(field, old.surface[q]!, old.x[q]!, old.z[q]!);
      let near = -1;
      let nearD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!crowd.alive[i] || crowd.slot[i]! >= 0 || crowd.team[i] === own || (ys !== null && Math.abs(ys[i]! - ay) >= lv.height)) continue;
        const d2 = (crowd.x[i]! - cx) ** 2 + (crowd.z[i]! - cz) ** 2;
        if (d2 < nearD) [near, nearD] = [i, d2];
      }
      // An enemy behind a map's wall is not contact (it cannot be reached through the wall): when the nearest is hidden, the nearest one
      // within `engage` that can be seen is, if any (the lower index on a tie). On the open field every enemy is in sight.
      if (near >= 0 && nearD <= p.engage * p.engage && !inSight(map.fields, cx, cz, crowd.x[near]!, crowd.z[near]!, 0, ay, ys === null ? NaN : ys[near]!)) {
        let seen = -1;
        let seenD = p.engage * p.engage;
        for (let i = 0; i < n; i++) {
          if (!crowd.alive[i] || crowd.slot[i]! >= 0 || crowd.team[i] === own || (ys !== null && Math.abs(ys[i]! - ay) >= lv.height)) continue;
          const d2 = (crowd.x[i]! - cx) ** 2 + (crowd.z[i]! - cz) ** 2;
          if (d2 <= seenD && (seen < 0 || d2 < seenD) && inSight(map.fields, cx, cz, crowd.x[i]!, crowd.z[i]!, 0, ay, ys === null ? NaN : ys[i]!)) [seen, seenD] = [i, d2];
        }
        [near, nearD] = seen >= 0 ? [seen, seenD] : [-1, Infinity];
      }
      const inContact = near >= 0 && nearD <= p.engage * p.engage;
      nextShape[q] = inContact ? LINE : alive < p.looseBelow * p.size ? LOOSE : COLUMN;
      // It walks while its Soldiers keep up and none is engaged; in contact it halts once a Soldier of it fights.
      const lagging = inCrowd === 0 || Math.hypot(cx - old.x[q]!, cz - old.z[q]!) > p.lag;
      if (inContact) {
        nextAim[q] = Math.atan2(crowd.x[near]! - old.x[q]!, crowd.z[near]! - old.z[q]!);
        nextSpeed[q] = lagging || contact > 0 ? 0 : walk * p.speed;
        return;
      }
      // Otherwise it follows its Order: an Order to an Objective marches by that Objective's field to its place in the circle and stands
      // there facing the enemy's end; a Squad awaiting Orders (just respawned) stands.
      if (old.order[q] === RESPAWN || old.target[q]! >= objectives.length) return;
      const spotOn = orderSpot(map, old.target[q]!, q, per, battle, spot);
      // There: near its spot, and on its level (not in the tunnel under a spot on the bridge).
      if (Math.hypot(spot[0] - old.x[q]!, spot[1] - old.z[q]!) <= 2 * p.spacing && (!layered || spotOn < 0 || sameLevel(field.arena, lv, old.surface[q]!, spotOn, spot[0], spot[1]))) {
        nextAim[q] = own === 0 ? 0 : Math.PI;
        return;
      }
      nextAim[q] = steerToward(map.fields, old.target[q]!, old.x[q]!, old.z[q]!, spot[0], spot[1], own, old.surface[q], spotOn);
      nextSpeed[q] = lagging ? 0 : walk * p.speed;
    });
    // A Squad found empty (wiped out, or merged away just now) starts its wait to respawn.
    for (const q of due) if (nextLiving[q] === 0 && nextRespawnAt[q]! < 0) nextRespawnAt[q] = tick + respawnTicks(battle);
    aim = nextAim;
    speed = nextSpeed;
    order = nextOrder;
    respawnAt = nextRespawnAt;
    shape = nextShape;
    living = nextLiving;
    fall = nextFall;
    if (edit.squad) squad = edit.squad;
    if (edit.place) place = edit.place;
  }

  // Every anchor turns toward its aim and walks, on the field and out of a map's blocks (sliding along one it walks into).
  const turn = p.turnRate * TICK_SECONDS;
  const pushed: [number, number] = [0, 0];
  for (let q = 0; q < m; q++) {
    const diff = wrap(aim[q]! - heading[q]!);
    if (diff !== 0) heading[q] = heading[q]! + Math.max(-turn, Math.min(turn, diff));
    if (speed[q]! === 0) continue;
    const fromX = x[q]!;
    const fromZ = z[q]!;
    x[q] = Math.max(-half, Math.min(half, x[q]! + Math.sin(heading[q]!) * speed[q]! * TICK_SECONDS));
    z[q] = Math.max(-half, Math.min(half, z[q]! + Math.cos(heading[q]!) * speed[q]! * TICK_SECONDS));
    if (pushOutOfBlocks(map.field, x[q]!, z[q]!, battle.crowd.separation / 2, old.team[q]!, pushed, fromX, fromZ)) [x[q], z[q]] = pushed;
    // Onto the Walk Surface it walks onto (Stage 4a): by the walk rule where there are levels, else the floor under it.
    if (layered) {
      surface[q] = walkTo(field.arena, lv, surface[q]!, fromX, fromZ, x[q]!, z[q]!, pushed);
      [x[q], z[q]] = pushed;
    } else if (field.heights.walk && (surface[q]! < 0 || !onSurface(field.arena, surface[q]!, x[q]!, z[q]!))) {
      const on = groundOf(battle, field, x[q]!, z[q]!);
      if (on >= 0) surface[q] = on;
    }
  }
  const squads: SquadState = { team: old.team, x, z, heading, aim, speed, shape, living, fall, order, target: old.target, since: old.since, respawnAt, surface };
  return { squads, squad, place, spawned, narrow: squadNarrows(battle, map, squads) };
}
