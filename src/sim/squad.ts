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
 * Pure: nothing here mutates its input, and nothing reads anything but the state and the Tuning Data.
 */
import { deployLayout, squadSizes, type BattleTuning } from '../tuning';
import { secondsToTicks, TICK_SECONDS } from './constants';
import type { CrowdFighter, CrowdState } from './crowd';
import { inBlock, pushOutOfBlocks } from './battlefield';
import { inSight, steerToward, type BattleMap } from './destinations';
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
}

/** How many times nearer the centre a place in an Objective's circle is tried when it falls inside a map's block, before the centre itself. */
const SPOT_TRIES = 4;

/**
 * Squad `q`'s (of `per` in its army) own place at destination `target` (an Objective's index, or `objectives + team` for a Base) as a world
 * point: a place in the Objective's circle, spread by the Squad's place in its army (the golden angle) and turned half a turn for Team 1 as the
 * armies are, so Squads on one Objective, or respawning at one, do not stack; at a Base, a row across it. A place inside a map's block (a
 * wall across a gatehouse's circle) moves in toward the centre, along its own line, until it is clear.
 */
export function orderSpot(map: BattleMap, target: number, q: number, per: number, battle: BattleTuning, out: [number, number]): void {
  const { objectives, bases } = map.field;
  const k = q % per;
  const sign = q < per ? 1 : -1;
  if (target >= objectives.length) {
    const base = bases[target - objectives.length]!;
    // A row across the Base, as wide as the Squads' columns need but never past the field's edges, Team 1's turned half a turn like the rest.
    const gap = Math.min(battle.squad.column.wide * battle.squad.spacing * 1.5, (battle.field.size - 8) / per);
    out[0] = base.x + sign * (k - (per - 1) / 2) * gap;
    out[1] = base.z;
    return;
  }
  const o = objectives[target]!;
  const angle = k * 2.399963229728653;
  const reach = 0.7 * o.radius * Math.sqrt((k + 0.5) / per);
  for (let t = 0; t <= SPOT_TRIES; t++) {
    const r = (reach * (SPOT_TRIES - t)) / SPOT_TRIES;
    out[0] = o.x + sign * Math.sin(angle) * r;
    out[1] = o.z + sign * Math.cos(angle) * r;
    if (!inBlock(map.field, out[0], out[1])) return;
  }
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
 * the loose Formation fills a spiral.
 */
export function placeOffset(battle: BattleTuning, shape: number, place: number, heading: number, out: [number, number]): void {
  const { spacing, size, column, line, loose } = battle.squad;
  let r: number;
  let f: number;
  if (shape === LOOSE) {
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
  };
  return { squads, squad, place, x, z, team, heading };
}

/** A Soldier a Squad's respawn gave back: where it stands now, facing which way. It is at full HP, engaged with no one. */
export interface Spawned {
  readonly i: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/** What a Squad step changes: the Squads, which Squad and place each Soldier has (the same arrays when nothing moved), and the Soldiers respawned. */
export interface SquadStep {
  readonly squads: SquadState;
  readonly squad: readonly number[];
  readonly place: readonly number[];
  readonly spawned: readonly Spawned[];
}

const wrap = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * The Squads one Tick on (`tick` is the Tick being stepped): the brains due think (see the file's header), then every anchor
 * turns and walks. Once a Team has routed nothing steps: the Soldiers flee and the Squads stand.
 */
export function stepSquads(crowd: CrowdState, tick: number, battle: BattleTuning, map: BattleMap, fighters: readonly CrowdFighter[] = []): SquadStep {
  const old = crowd.squads;
  if (crowd.rout) return { squads: old, squad: crowd.squad, place: crowd.place, spawned: [] };
  const p = battle.squad;
  const walk = battle.crowd.walkSpeed;
  const m = old.team.length;
  const per = m / 2;
  const n = crowd.x.length;
  const ticks = brainTicks(battle);
  const x = old.x.slice();
  const z = old.z.slice();
  const heading = old.heading.slice();

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
  /** Enemy Soldiers and Fighters of Team `own` standing inside Objective `at`'s circle (as they stood at the start of the Tick). */
  const enemiesIn = (own: number, at: number): number => {
    const site = objectives[at]!;
    let enemies = 0;
    for (let i = 0; i < n; i++)
      if (crowd.alive[i] && crowd.team[i] !== own && crowd.slot[i]! < 0 && (crowd.x[i]! - site.x) ** 2 + (crowd.z[i]! - site.z) ** 2 <= site.radius * site.radius) enemies++;
    for (const f of fighters) if (f.team !== own && (f.x - site.x) ** 2 + (f.z - site.z) ** 2 <= site.radius * site.radius) enemies++;
    return enemies;
  };
  /** Where Team `team`'s broken Squads may rally, found on first need: the spawns it owns with no enemy on them, then its Base (a destination index, as an Order's target). */
  const rallies: (number[] | undefined)[] = [];
  const rallyPoints = (team: number): number[] => {
    if (rallies[team]) return rallies[team]!;
    const found: number[] = [];
    for (let j = 0; j < objectives.length; j++) {
      // In the Team's own order (reversed for Team 1), so a tie in distance goes to the mirrored place for each.
      const k = team === 0 ? j : objectives.length - 1 - j;
      if (objectives[k]!.spawn && crowd.objectives.owner[k] === team && enemiesIn(team, k) === 0) found.push(k);
    }
    found.push(objectives.length + team);
    return (rallies[team] = found);
  };

  if (due.length > 0) {
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
            if (!objectives[at]!.spawn || crowd.objectives.owner[at] !== own || enemiesIn(own, at) > 0) at = base;
          }
          const slots: number[] = [];
          for (let i = own * battle.armySize; i < (own + 1) * battle.armySize && slots.length < p.size; i++)
            if (!crowd.alive[i] && crowd.slot[i]! < 0 && !claimed.has(i)) slots.push(i);
          if (slots.length === 0) return;
          orderSpot(map, at, q, per, battle, spot);
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
            spawned.push({ i, x: out[0], z: out[1], heading: facing });
          });
          x[q] = spot[0];
          z[q] = spot[1];
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
        let rally = rallyPoints(own)[0]!;
        let rallyD = Infinity;
        for (const k of rallyPoints(own)) {
          const at = k < objectives.length ? objectives[k]! : map.field.bases[k - objectives.length]!;
          const d2 = (at.x - old.x[q]!) ** 2 + (at.z - old.z[q]!) ** 2;
          if (d2 < rallyD) [rally, rallyD] = [k, d2];
        }
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
        nextAim[q] = Math.atan2(dx, dz);
        nextSpeed[q] = toRally > 2 * p.spacing ? walk : 0;
        return;
      }

      // The nearest enemy Soldier to this Squad's Soldiers (as they stood): within `engage` it is in contact, and the Squad turns to it.
      let near = -1;
      let nearD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!crowd.alive[i] || crowd.slot[i]! >= 0 || crowd.team[i] === own) continue;
        const d2 = (crowd.x[i]! - cx) ** 2 + (crowd.z[i]! - cz) ** 2;
        if (d2 < nearD) [near, nearD] = [i, d2];
      }
      // An enemy behind a map's wall is not contact (it cannot be reached through the wall): when the nearest is hidden, the nearest one
      // within `engage` that can be seen is, if any (the lower index on a tie). On the open field every enemy is in sight.
      if (near >= 0 && nearD <= p.engage * p.engage && !inSight(map.fields, cx, cz, crowd.x[near]!, crowd.z[near]!)) {
        let seen = -1;
        let seenD = p.engage * p.engage;
        for (let i = 0; i < n; i++) {
          if (!crowd.alive[i] || crowd.slot[i]! >= 0 || crowd.team[i] === own) continue;
          const d2 = (crowd.x[i]! - cx) ** 2 + (crowd.z[i]! - cz) ** 2;
          if (d2 <= seenD && (seen < 0 || d2 < seenD) && inSight(map.fields, cx, cz, crowd.x[i]!, crowd.z[i]!)) [seen, seenD] = [i, d2];
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
      orderSpot(map, old.target[q]!, q, per, battle, spot);
      if (Math.hypot(spot[0] - old.x[q]!, spot[1] - old.z[q]!) <= 2 * p.spacing) {
        nextAim[q] = own === 0 ? 0 : Math.PI;
        return;
      }
      nextAim[q] = steerToward(map.fields, old.target[q]!, old.x[q]!, old.z[q]!, spot[0], spot[1], own);
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

  // Every anchor turns toward its aim and walks, on the field and out of a map's blocks.
  const turn = p.turnRate * TICK_SECONDS;
  const pushed: [number, number] = [0, 0];
  for (let q = 0; q < m; q++) {
    const diff = wrap(aim[q]! - heading[q]!);
    if (diff !== 0) heading[q] = heading[q]! + Math.max(-turn, Math.min(turn, diff));
    if (speed[q]! === 0) continue;
    x[q] = Math.max(-half, Math.min(half, x[q]! + Math.sin(heading[q]!) * speed[q]! * TICK_SECONDS));
    z[q] = Math.max(-half, Math.min(half, z[q]! + Math.cos(heading[q]!) * speed[q]! * TICK_SECONDS));
    if (pushOutOfBlocks(map.field, x[q]!, z[q]!, battle.crowd.separation / 2, old.team[q]!, pushed)) [x[q], z[q]] = pushed;
  }
  return { squads: { team: old.team, x, z, heading, aim, speed, shape, living, fall, order, target: old.target, since: old.since, respawnAt }, squad, place, spawned };
}
