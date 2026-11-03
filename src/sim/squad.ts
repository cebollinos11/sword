/**
 * Squads and Formations (docs/plans/battle-objectives.md, Stage 1; ADR 0021): a Battle's Soldiers are deployed in fixed groups, each
 * moving in a Formation round an anchor. Squad state is plain data beside the Crowd (`CrowdState.squads`, and each Soldier's `squad`
 * and `place`), hashed, snapshotted and rolled back with it.
 *
 * - The anchor: a point and a heading per Squad. It turns at `squad.turnRate` toward its aim and walks at `squad.speed` of a
 *   Soldier's pace, every Tick (a few dozen of them). Soldiers steer to their place in the Formation round it (`stepCrowd`).
 * - The Formation, chosen by the situation (never by order): a **line** facing the enemy once an enemy Soldier is within
 *   `squad.engage` (the first `line.wide` places are the front rank that fights), a **column** on the march, **loose** when the
 *   Squad is down to `squad.looseBelow` of its strength or falling back.
 * - The brain steps every `squad.brainSeconds` (2 Hz), each Squad on its own Tick (staggered by its place in its own army, so the
 *   k-th Squads of the two armies think together). It reads the Tick's Soldiers and the other Team's Squads as they stood, never
 *   as the other brain left them this Tick, so neither army thinks a step ahead. Its Order, until a Commander gives others
 *   (Stage 2a), is to attack the enemy army: the nearest living enemy Squad.
 * - A Squad's rear rank steps up into gaps: its living Soldiers whose place is past its living count take the lowest free places.
 * - Morale: a Squad down to `squad.moraleThreshold` of `squad.size` falls back toward its Team's Base (loose; its Soldiers break off
 *   their fights and walk, see `stepCrowd`). Within `squad.mergeRange` of the Base it merges into the nearest other Squad of its Team that
 *   is that close to it and has room (at most `squad.mergeMax` living Soldiers): remnants gather at the Base and join. Back above
 *   `squad.looseBelow` (merged remnants) it rallies and marches out again. A Squad with no living Soldier, wiped out or merged away,
 *   is simply empty (Stage 2a respawns it).
 *
 * Pure: nothing here mutates its input, and nothing reads anything but the state and the Tuning Data.
 */
import { deployLayout, squadSizes, type BattleTuning } from '../tuning';
import { secondsToTicks, TICK_SECONDS } from './constants';
import type { CrowdState } from './crowd';

export const COLUMN = 0;
export const LINE = 1;
export const LOOSE = 2;

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
 * rank's first row `deploy.front` from the centre. Team 0 at -z facing +z, Team 1 at +z facing -z, mirrors of each other.
 */
export function deploySquads(battle: BattleTuning): Deployment {
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
      const lz = -(battle.deploy.front + ((layout.rows - 1) / 2) * spacing + rank * layout.deepest * spacing);
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
  };
  return { squads, squad, place, x, z, team, heading };
}

/** What a Squad step changes: the Squads, and which Squad and place each Soldier has (the same arrays when nothing moved). */
export interface SquadStep {
  readonly squads: SquadState;
  readonly squad: readonly number[];
  readonly place: readonly number[];
}

const wrap = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/**
 * The Squads one Tick on (`tick` is the Tick being stepped): the brains due think (see the file's header), then every anchor
 * turns and walks. Once a Team has routed nothing steps: the Soldiers flee and the Squads stand.
 */
export function stepSquads(crowd: CrowdState, tick: number, battle: BattleTuning): SquadStep {
  const old = crowd.squads;
  if (crowd.rout) return { squads: old, squad: crowd.squad, place: crowd.place };
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
  let squad = crowd.squad;
  let place = crowd.place;

  if (due.length > 0) {
    const nextAim = old.aim.slice();
    const nextSpeed = old.speed.slice();
    const nextShape = old.shape.slice();
    const nextLiving = old.living.slice();
    const nextFall = old.fall.slice();
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
      if (alive === 0) return;
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
        const bz = own === 0 ? -p.baseDistance : p.baseDistance;
        const dx = 0 - old.x[q]!;
        const dz = bz - old.z[q]!;
        const toBase = Math.hypot(dx, dz);
        // At the Base, another Squad of the Team close by with room: merge into it (nearest first; the lower Squad on a tie).
        let into = -1;
        let intoD = p.mergeRange * p.mergeRange;
        for (let r = own * per; toBase <= p.mergeRange && r < (own + 1) * per; r++) {
          // A Squad that thinks later this Tick would recount without its new Soldiers: it cannot be merged into yet.
          if (r === q || slotOf[r]! > d || nextLiving[r]! === 0 || nextLiving[r]! + alive > p.mergeMax) continue;
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
        nextSpeed[q] = toBase > 2 * p.spacing ? walk : 0;
        return;
      }

      // Attack the enemy army: the nearest living enemy Squad (as it stood), and the nearest enemy Soldier to this Squad's Soldiers.
      let near = -1;
      let nearD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!crowd.alive[i] || crowd.slot[i]! >= 0 || crowd.team[i] === own) continue;
        const d2 = (crowd.x[i]! - cx) ** 2 + (crowd.z[i]! - cz) ** 2;
        if (d2 < nearD) [near, nearD] = [i, d2];
      }
      let foe = -1;
      let foeD = Infinity;
      for (let r = (1 - own) * per; r < (2 - own) * per; r++) {
        if (old.living[r]! === 0) continue;
        const d2 = (old.x[r]! - old.x[q]!) ** 2 + (old.z[r]! - old.z[q]!) ** 2;
        if (d2 < foeD) [foe, foeD] = [r, d2];
      }
      const inContact = near >= 0 && nearD <= p.engage * p.engage;
      nextShape[q] = inContact ? LINE : alive < p.looseBelow * p.size ? LOOSE : COLUMN;
      if (inContact) nextAim[q] = Math.atan2(crowd.x[near]! - old.x[q]!, crowd.z[near]! - old.z[q]!);
      else if (foe >= 0) nextAim[q] = Math.atan2(old.x[foe]! - old.x[q]!, old.z[foe]! - old.z[q]!);
      else if (near >= 0) nextAim[q] = Math.atan2(crowd.x[near]! - old.x[q]!, crowd.z[near]! - old.z[q]!);
      else return;
      // It walks while its Soldiers keep up and none is engaged; in contact it halts once a Soldier of it fights.
      const lagging = inCrowd === 0 || Math.hypot(cx - old.x[q]!, cz - old.z[q]!) > p.lag;
      nextSpeed[q] = lagging || (inContact && contact > 0) ? 0 : walk * p.speed;
    });
    aim = nextAim;
    speed = nextSpeed;
    shape = nextShape;
    living = nextLiving;
    fall = nextFall;
    if (edit.squad) squad = edit.squad;
    if (edit.place) place = edit.place;
  }

  // Every anchor turns toward its aim and walks.
  const half = battle.field.size / 2 - 2;
  const turn = p.turnRate * TICK_SECONDS;
  for (let q = 0; q < m; q++) {
    const diff = wrap(aim[q]! - heading[q]!);
    if (diff !== 0) heading[q] = heading[q]! + Math.max(-turn, Math.min(turn, diff));
    if (speed[q]! === 0) continue;
    x[q] = Math.max(-half, Math.min(half, x[q]! + Math.sin(heading[q]!) * speed[q]! * TICK_SECONDS));
    z[q] = Math.max(-half, Math.min(half, z[q]! + Math.cos(heading[q]!) * speed[q]! * TICK_SECONDS));
  }
  return { squads: { team: old.team, x, z, heading, aim, speed, shape, living, fall }, squad, place };
}
