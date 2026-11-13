/**
 * Warbands (docs/plans/delver.md, Stage 3): the Squads of a Delver Run's Floor, which guard a post or patrol a loop, chase a party Fighter they
 * see and return home. This file holds their state and modes; they are deployed by `deployWarbands` (`sim/delver/warbands.ts`).
 */
import type { BattleTuning, DelverTuning } from '../tuning';
import { groundOf, soldierHeight } from './battlefield';
import { secondsToTicks } from './constants';
import type { CrowdFighter, CrowdState, SquadBrain } from './crowd';
import { fieldDistance, fieldToward, inSight, oneField, steerToward, type BattleMap, type DestinationFields } from './destinations';
import type { WarbandHomes } from './delver/warbands';
import { brainTicks, closeRanks, COLUMN, LINE, LOOSE, squadNarrows, walkAnchors, type SquadState, type SquadStep } from './squad';

/** A Warband's mode: holding its post, walking its loop, following a party Fighter it saw, or walking home. */
export const GUARD = 0;
export const PATROL = 1;
export const CHASE = 2;
export const RETURN = 3;

/**
 * The Warbands' brains as struct-of-arrays (plain data, hashed and snapshotted with the Match): entry q is Squad q of the Floor's Crowd
 * (`CrowdState.warbands`). A Warband's home is its post (`plan.markers.posts[post]`) for a guard, its loop's point `leg` for a patrol.
 */
export interface WarbandState {
  /** GUARD, PATROL, CHASE or RETURN. */
  readonly mode: readonly number[];
  /** Its post (an index into `plan.markers.posts`), or -1 for a patrol. */
  readonly post: readonly number[];
  /** Its loop (an index into `plan.markers.patrols`), or -1 for a guard. */
  readonly patrol: readonly number[];
  /** A patrol's waypoint (an index into its loop's points) it walks to or returns to; 0 for a guard. */
  readonly leg: readonly number[];
  /** The party Fighter (Pool slot) it chases, or -1. */
  readonly chased: readonly number[];
  /** The Tick it last saw `chased`, or -1. */
  readonly seen: readonly number[];
  /** The Soldiers it deployed with (its morale counts from this). */
  readonly size: readonly number[];
  /** Its template's index in its tier's guard or patrol pool. */
  readonly encounter: readonly number[];
}

// ------------------------------------------------------------------ the brain

/** Two path lengths (m) closer than this are a tie: equal paths summed in another order differ in their last bits. */
const TIE = 1e-9;

/** `oneField(f, field)`, kept: a field is the one destination of exactly one `DestinationFields`, so the object is made once. Derived, never state. */
const lone = new WeakMap<Float64Array, DestinationFields>();
function leading(f: DestinationFields, field: Float64Array): DestinationFields {
  let one = lone.get(field);
  if (!one || one.cell !== f.cell || one.side !== f.side) lone.set(field, (one = oneField(f, field)));
  return one;
}

/**
 * The Warband brain a Floor's Crowd steps its Squads with (docs/plans/delver.md, Stage 3): `stepWarbands` bound to the Floor's `homes`
 * (derived from its plan, never state) and the Tuning Data's `delver` rules.
 */
export function warbandBrain(homes: WarbandHomes, rules: DelverTuning): SquadBrain {
  return (crowd, tick, battle, map, fighters) => stepWarbands(crowd, tick, battle, map, fighters, homes, rules);
}

/**
 * The Floor's Warbands one Tick on (docs/plans/delver.md, Stage 3; `tick` is the Tick being stepped): the Warbands due (Warband q thinks on the
 * Ticks where `q` and `tick` agree modulo `brainTicks`) think from the Soldiers and `fighters` as they stood at the start of the Tick, then every
 * anchor turns and walks (`walkAnchors`). `fighters` are the full Fighters in play; those of Team 0 are the party, `slot` being their Pool slot.
 *  - A Warband with none living is wiped: it stands and never thinks again (nothing respawns on a Floor). It is `broken` below
 *    `squad.moraleThreshold` of the Soldiers it deployed with (`WarbandState.size`).
 *  - A Warband whose Soldiers lag (`squad.lag`) regroups first: its anchor is put where its nearest in-Crowd Soldier stands, on that Soldier's Walk Surface.
 *  - It sees a party Fighter when one of its living Soldiers has it within `sight` flat, on its level and in sight past the Floor's Walls.
 *  - GUARD holds its post (walks back to it when away, facing its guard facing there); PATROL walks its loop, the leg advancing at each point.
 *    Either, not broken, that sees the party CHASES the nearest it sees (to its anchor). A broken PATROL becomes a GUARD at its point.
 *  - CHASE follows its Fighter by that Fighter's field, halting `closeIn` short of it in a LINE. A broken Warband RETURNS falling back (`fall`, LOOSE).
 *    It keeps its Fighter while it sees it, takes the nearest it sees if it loses it, and RETURNS after `forgetSeconds` unseen, once its walk from
 *    home passes the Leash, or when no one is left to chase. A patrol's home is its nearest point by walking.
 *  - RETURN is deaf: it walks home and, within `arrive` of it, GUARDS (a guard, or a broken patrol) or PATROLS again.
 * Pure. The result carries `lead` (the one field each anchor follows, derived from the state again each Tick).
 */
export function stepWarbands(crowd: CrowdState, tick: number, battle: BattleTuning, map: BattleMap, fighters: readonly CrowdFighter[], homes: WarbandHomes, rules: DelverTuning): SquadStep & { readonly warbands: WarbandState } {
  const old = crowd.squads;
  const w = crowd.warbands!;
  const p = battle.squad;
  const m = old.team.length;
  const n = crowd.x.length;
  const ticks = brainTicks(battle);
  const field = map.field;
  const fields = map.fields;
  const lv = battle.levels;
  const forget = secondsToTicks(rules.forgetSeconds);

  const x = old.x.slice();
  const z = old.z.slice();
  const heading = old.heading.slice();
  const surface = old.surface.slice();
  const aim = old.aim.slice();
  const speed = old.speed.slice();
  const shape = old.shape.slice();
  const living = old.living.slice();
  const fall = old.fall.slice();
  const mode = w.mode.slice();
  const leg = w.leg.slice();
  const chased = w.chased.slice();
  const seen = w.seen.slice();
  let place = crowd.place;
  const editPlace = () => (place === crowd.place ? (place = crowd.place.slice()) : place) as number[];

  // The party: the full Fighters of Team 0, each with its Pool slot (its place in the list when the Run names none).
  const party: { f: CrowdFighter; slot: number }[] = [];
  fighters.forEach((f, j) => {
    if (f.team === 0) party.push({ f, slot: f.slot ?? j });
  });
  const partyOf = (slot: number): CrowdFighter | undefined => party.find((e) => e.slot === slot)?.f;

  /** Where Warband q calls home: its post, or its loop's point `leg`. */
  const homeOf = (q: number): { x: number; z: number } => (w.post[q]! >= 0 ? homes.posts[w.post[q]!]! : homes.patrols[w.patrol[q]!]![leg[q]!]!);
  /** The kept field to a point on the floor (never a roof), and the point's Walk Surface. */
  const fieldAt = (px: number, pz: number) => {
    const on = groundOf(battle, field, px, pz, 0);
    return { dest: leading(fields, fieldToward(fields, px, pz, on)), on };
  };

  // The Warbands due, in Squad order, and each one's Soldiers by index.
  const due: number[] = [];
  for (let q = tick % ticks; q < m; q += ticks) due.push(q);
  if (due.length > 0) {
    const slotOf = new Int32Array(m).fill(-1);
    due.forEach((q, d) => (slotOf[q] = d));
    const members: number[][] = due.map(() => []);
    for (let i = 0; i < n; i++) {
      const d = crowd.squad[i]! >= 0 ? slotOf[crowd.squad[i]!]! : -1;
      if (d >= 0) members[d]!.push(i);
    }

    due.forEach((q, d) => {
      let ax = old.x[q]!;
      let az = old.z[q]!;
      let as = old.surface[q]!;
      let alive = 0;
      let inCrowd = 0;
      let cx = 0;
      let cz = 0;
      for (const i of members[d]!) {
        if (!crowd.alive[i]) continue;
        alive++;
        if (crowd.slot[i]! >= 0) continue;
        inCrowd++;
        cx += crowd.x[i]!;
        cz += crowd.z[i]!;
      }
      living[q] = alive;
      speed[q] = 0;
      if (alive === 0) return;
      if (inCrowd > 0) {
        cx /= inCrowd;
        cz /= inCrowd;
      } else {
        cx = ax;
        cz = az;
      }
      closeRanks(members[d]!, crowd, alive, editPlace);
      const broken = alive < p.moraleThreshold * w.size[q]!;
      const lagging = inCrowd === 0 || Math.hypot(cx - ax, cz - az) > p.lag;
      if (lagging && inCrowd > 0) {
        // Regroup: a Warband whose Soldiers lag has its anchor put back where the in-Crowd Soldier nearest it stands (the lower index on a tie), on
        // that Soldier's Walk Surface, so it never leaves them behind a Wall. It still does not walk this step.
        let best = -1;
        let bestD = Infinity;
        for (const i of members[d]!) {
          if (!crowd.alive[i] || crowd.slot[i]! >= 0) continue;
          const d2 = (crowd.x[i]! - ax) ** 2 + (crowd.z[i]! - az) ** 2;
          if (d2 < bestD) [best, bestD] = [i, d2];
        }
        [ax, az, as] = [crowd.x[best]!, crowd.z[best]!, crowd.surface[best]!];
        [x[q], z[q], surface[q]] = [ax, az, as];
      }
      const walk = battle.crowd.walkSpeed;
      const team = old.team[q]!;
      const ay = soldierHeight(field, as, ax, az);

      /** The party Fighters this Warband sees, by `party` index. */
      const sees = (): number[] => {
        const out: number[] = [];
        const sight2 = rules.sight * rules.sight;
        party.forEach(({ f }, e) => {
          const fy = f.y ?? NaN;
          for (const i of members[d]!) {
            if (!crowd.alive[i]) continue;
            let sx: number;
            let sz: number;
            let sy: number;
            if (crowd.slot[i]! >= 0) {
              const g = fighters.find((h) => h.slot === crowd.slot[i]);
              if (!g) continue;
              [sx, sz, sy] = [g.x, g.z, g.y ?? NaN];
            } else {
              [sx, sz] = [crowd.x[i]!, crowd.z[i]!];
              sy = soldierHeight(field, crowd.surface[i]!, sx, sz);
            }
            if ((f.x - sx) ** 2 + (f.z - sz) ** 2 > sight2 || (sy === sy && fy === fy && Math.abs(sy - fy) >= lv.height)) continue;
            if (inSight(fields, sx, sz, f.x, f.z, 0, sy, fy)) {
              out.push(e);
              break;
            }
          }
        });
        return out;
      };
      /** The nearest of `list` (party indices) to the anchor, flat, the lower slot on a tie. */
      const nearest = (list: readonly number[]): number => {
        let best = -1;
        let bestD = Infinity;
        for (const e of list) {
          const d2 = (party[e]!.f.x - ax) ** 2 + (party[e]!.f.z - az) ** 2;
          if (d2 < bestD || (d2 === bestD && party[e]!.slot < party[best]!.slot)) [best, bestD] = [e, d2];
        }
        return best;
      };
      /** Whether the anchor stands within `arrive` of (hx, hz), flat and on its level. */
      const arrived = (hx: number, hz: number, hs: number): boolean => Math.hypot(hx - ax, hz - az) <= rules.arrive && Math.abs(soldierHeight(field, hs, hx, hz) - ay) < lv.height;
      /** The anchor walks on toward (hx, hz) by the field `dest`, at the Squad's pace unless its Soldiers lag. */
      const walkTo = (dest: DestinationFields, hx: number, hz: number, hs: number, pace: number): void => {
        aim[q] = steerToward(dest, 0, ax, az, hx, hz, team, as, hs);
        speed[q] = lagging ? 0 : pace;
      };
      /** Back to its loop (a patrol) or its post, or its quarry gone: CHASE ends in RETURN. A patrol rejoins its loop at the nearest point by walking. */
      const giveUp = (): void => {
        mode[q] = RETURN;
        chased[q] = -1;
        seen[q] = -1;
        if (w.patrol[q]! >= 0) {
          const [near] = nearestPoint(q);
          if (near >= 0) leg[q] = near;
        }
      };
      /** A patrol's nearest point of its loop by walking from its anchor (the lower index on a tie), and that walk; -1 and Infinity where none is reached. */
      const nearestPoint = (r: number): [number, number] => {
        let best = -1;
        let bestD = Infinity;
        homes.patrols[w.patrol[r]!]!.forEach((pt, k) => {
          const to = fieldAt(pt.x, pt.z);
          const dist = fieldDistance(to.dest, 0, ax, az, as);
          if (dist >= 0 && dist < bestD - TIE) [best, bestD] = [k, dist];
        });
        return [best, bestD];
      };

      // GUARD and PATROL: a Warband that is not broken and sees the party chases the nearest it sees.
      if (mode[q] === GUARD || mode[q] === PATROL) {
        const hit = broken ? [] : sees();
        if (hit.length > 0) {
          mode[q] = CHASE;
          chased[q] = party[nearest(hit)]!.slot;
          seen[q] = tick;
        } else if (mode[q] === PATROL && broken) mode[q] = GUARD;
      }

      if (mode[q] === GUARD) {
        const home = homeOf(q);
        const to = fieldAt(home.x, home.z);
        shape[q] = fall[q] ? LOOSE : COLUMN;
        if (arrived(home.x, home.z, to.on)) {
          // At home it stands, facing the post's guard facing (a broken patrol's remnant keeps the facing it has).
          if (w.post[q]! >= 0) aim[q] = homes.posts[w.post[q]!]!.facing;
        } else walkTo(to.dest, home.x, home.z, to.on, walk * p.speed);
      } else if (mode[q] === PATROL) {
        const points = homes.patrols[w.patrol[q]!]!;
        let target = points[leg[q]!]!;
        let to = fieldAt(target.x, target.z);
        if (arrived(target.x, target.z, to.on)) {
          leg[q] = (leg[q]! + 1) % points.length;
          target = points[leg[q]!]!;
          to = fieldAt(target.x, target.z);
        }
        shape[q] = fall[q] ? LOOSE : COLUMN;
        walkTo(to.dest, target.x, target.z, to.on, walk * p.speed);
      }

      if (mode[q] === CHASE) {
        if (broken) {
          giveUp();
          fall[q] = 1;
        } else {
          const hit = sees();
          const quarry = party.findIndex((e) => e.slot === chased[q]);
          if (quarry < 0) {
            // Its Fighter has fallen (or left): the nearest it sees, else home.
            if (hit.length > 0) {
              chased[q] = party[nearest(hit)]!.slot;
              seen[q] = tick;
            } else giveUp();
          } else if (hit.includes(quarry)) seen[q] = tick;
          else if (hit.length > 0) {
            chased[q] = party[nearest(hit)]!.slot;
            seen[q] = tick;
          }
          if (mode[q] === CHASE) {
            // Forgotten, or past the Leash (its walk from home, from its nearest loop point for a patrol; unreached counts as past).
            let far: number;
            if (w.patrol[q]! >= 0) far = nearestPoint(q)[1];
            else {
              const home = homeOf(q);
              const dist = fieldDistance(fieldAt(home.x, home.z).dest, 0, ax, az, as);
              far = dist < 0 ? Infinity : dist;
            }
            if (tick - seen[q]! >= forget || far > rules.leash) giveUp();
          }
          if (mode[q] === CHASE) {
            const f = partyOf(chased[q]!)!;
            const dest = leading(fields, fieldToward(fields, f.x, f.z, groundOf(battle, field, f.x, f.z, f.y ?? 0)));
            const dist = fieldDistance(dest, 0, ax, az, as);
            if (dist >= 0 && dist <= rules.closeIn) {
              // Close enough: it halts, facing its quarry, in a line.
              aim[q] = Math.atan2(f.x - ax, f.z - az);
              shape[q] = LINE;
            } else {
              shape[q] = COLUMN;
              walkTo(dest, f.x, f.z, groundOf(battle, field, f.x, f.z, f.y ?? 0), walk * rules.chaseSpeed);
            }
          }
        }
      }

      if (mode[q] === RETURN) {
        // Deaf: it walks home, loose while it falls back, and guards or patrols again within `arrive` of it.
        const home = homeOf(q);
        const to = fieldAt(home.x, home.z);
        if (arrived(home.x, home.z, to.on)) {
          fall[q] = 0;
          mode[q] = w.post[q]! >= 0 || broken ? GUARD : PATROL;
          shape[q] = COLUMN;
          if (w.post[q]! >= 0) aim[q] = homes.posts[w.post[q]!]!.facing;
        } else {
          shape[q] = fall[q] ? LOOSE : COLUMN;
          walkTo(to.dest, home.x, home.z, to.on, walk * p.speed);
        }
      }
    });
  }

  walkAnchors(battle, map, old.team, x, z, heading, surface, aim, speed);

  // The field each anchor follows, derived from the state again every Tick: the home field while it stands (null once wiped).
  const lead = Array.from({ length: m }, (_, q): DestinationFields | null => {
    if (living[q] === 0) return null;
    if (mode[q] === PATROL) {
      const pt = homes.patrols[w.patrol[q]!]![leg[q]!]!;
      return fieldAt(pt.x, pt.z).dest;
    }
    if (mode[q] === CHASE) {
      const f = partyOf(chased[q]!);
      if (f) return leading(fields, fieldToward(fields, f.x, f.z, groundOf(battle, field, f.x, f.z, f.y ?? 0)));
    }
    const home = w.post[q]! >= 0 ? homes.posts[w.post[q]!]! : homes.patrols[w.patrol[q]!]![leg[q]!]!;
    return fieldAt(home.x, home.z).dest;
  });

  const squads: SquadState = { ...old, x, z, heading, aim, speed, shape, living, fall, surface };
  return { squads, squad: crowd.squad, place, spawned: [], narrow: squadNarrows(battle, map, squads), lead, warbands: { ...w, mode, leg, chased, seen } };
}
