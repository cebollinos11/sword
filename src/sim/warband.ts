/**
 * Warbands (docs/plans/delver.md, Stage 3): the Squads of a Delver Run's Floor, which guard a post or patrol a loop, chase a party Fighter they
 * see and return home. This file holds their state and modes; they are deployed by `deployWarbands` (`sim/delver/warbands.ts`).
 */
import type { BattleTuning, DelverTuning } from '../tuning';
import { groundOf, soldierHeight } from './battlefield';
import { secondsToTicks } from './constants';
import { walkDistance, walkField, type CrowdFighter, type CrowdState, type SquadBrain } from './crowd';
import { clearanceAt, inSight, steerToward, type BattleMap, type DestinationFields } from './destinations';
import type { WarbandHomes } from './delver/warbands';
import { brainTicks, closeRanks, COLUMN, LINE, LOOSE, squadNarrows, walkAnchors, type SquadState, type SquadStep } from './squad';

/** A Warband's mode: holding its post, walking its loop, following a party Fighter it saw, or walking home. */
export const GUARD = 0;
export const PATROL = 1;
export const CHASE = 2;
export const RETURN = 3;

/** A Warband's rank (docs/plans/delver.md, Stage 4): a plain guard or patrol, an elite guard (its Soldiers wear Relics) or the Boss Warband. */
export const PLAIN = 0;
export const ELITE = 1;
export const BOSS = 2;

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
  /** A patrol's waypoint (an index into its loop's points) it walks to or returns to; a guard's wander leg: 0 its post, k its wander spot k - 1. */
  readonly leg: readonly number[];
  /** The party Fighter (Pool slot) it chases, or -1. */
  readonly chased: readonly number[];
  /** The Tick it last saw `chased`, or -1. */
  readonly seen: readonly number[];
  /** The Soldiers it deployed with (its morale counts from this). */
  readonly size: readonly number[];
  /** Its template's index in its tier's guard or patrol pool (rank PLAIN), elite pool (ELITE) or its Boss's guard pool (BOSS). */
  readonly encounter: readonly number[];
  /** PLAIN, ELITE or BOSS. */
  readonly rank: readonly number[];
}

// ------------------------------------------------------------------ the brain

/** The most wander spots round a post: a guard's `leg` is 0 at its post, k on its way to or at spot k - 1. */
export const WANDER_SPOTS = 16;
/** A wander spot keeps this far (m) from a Wall or pillar (the fields' clearance), so a guard's column fits round it. */
const WANDER_CLEAR = 1.5;
/** The longest walk (m) from a post to a wander spot: the straight line times this, plus WANDER_SLACK. A spot behind a Wall is longer. */
const WANDER_DETOUR = 1.3;
const WANDER_SLACK = 2;
/** How far (m) a wander spot is drawn in toward its post at each try, from the wander radius in. */
const WANDER_STEP = 0.5;

type Post = WarbandHomes['posts'][number];
type Spot = { readonly x: number; readonly z: number } | null;

/** Each post's wander spots, for one map and radius. Derived from the plan and the map, never state. */
const wanderKept = new WeakMap<Post, { readonly map: BattleMap; readonly radius: number; readonly spots: readonly Spot[]; readonly fit: readonly number[] }>();

/**
 * The wander spots round `post` (WANDER_SPOTS of them, null where none fits) and the indices of those that fit, ascending. Spot k < 8 lies on
 * the way k * 45 degrees from the post as far out as fits, up to `radius`; spot k + 8 halfway to it. A spot fits on its Hall's dry floor
 * (`post.dry`), on the post's own level, `WANDER_CLEAR` from any Wall or pillar, a walk from the post hardly longer than the straight line (no
 * spot behind a Wall), out of sight of every Entrance spawn, and farther than `arrive` from the post (else it would be no stroll). None at
 * radius 0 or for the Boss post (no dry floor).
 */
function wanderSpots(battle: BattleTuning, map: BattleMap, homes: WarbandHomes, post: Post, rules: DelverTuning): { readonly spots: readonly Spot[]; readonly fit: readonly number[] } {
  const radius = rules.wander.radius;
  const got = wanderKept.get(post);
  if (got && got.map === map && got.radius === radius) return got;
  const spots: Spot[] = new Array<Spot>(WANDER_SPOTS).fill(null);
  if (radius > rules.arrive && post.dry.length > 0) {
    const fromPost = walkField(battle, map, post.x, post.z, post.y);
    const fits = (x: number, z: number): boolean => {
      if (!post.dry.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) return false;
      const s = groundOf(battle, map.field, x, z, post.y);
      if (Math.abs(soldierHeight(map.field, s, x, z) - post.y) > 0.05) return false;
      if (clearanceAt(map.fields, x, z, s) < WANDER_CLEAR) return false;
      if (walkDistance(fromPost, x, z, s) > Math.hypot(x - post.x, z - post.z) * WANDER_DETOUR + WANDER_SLACK) return false;
      return !homes.spawns.some((sp) => inSight(map.fields, sp.x, sp.z, x, z, 0, sp.y, post.y));
    };
    for (let k = 0; k < 8; k++) {
      const dx = Math.sin((k * Math.PI) / 4);
      const dz = Math.cos((k * Math.PI) / 4);
      for (let d = radius; d > rules.arrive; d -= WANDER_STEP) {
        if (!fits(post.x + d * dx, post.z + d * dz)) continue;
        spots[k] = { x: post.x + d * dx, z: post.z + d * dz };
        if (d / 2 > rules.arrive && fits(post.x + (d / 2) * dx, post.z + (d / 2) * dz)) spots[k + 8] = { x: post.x + (d / 2) * dx, z: post.z + (d / 2) * dz };
        break;
      }
    }
  }
  const fit = spots.flatMap((p, k) => (p ? [k] : []));
  const kept = { map, radius, spots, fit };
  wanderKept.set(post, kept);
  return kept;
}

/** A whole number from (a, b, c), well mixed, in [0, 2^32): the seeded-looking picks of the wander, from state alone. */
function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Where guard Warband q (of post `post`) means to stand in the wander's period holding `tick`: 0 its post, k wander spot k - 1. Each guard's
 * periods (`wander.seconds`) start at its own offset, so guards never pick together; in each, it keeps to its post `wander.stay` of the time,
 * else goes to one of its fit spots. A function of the Tick, the Warband and the plan: no state but the leg it is walking.
 */
function wanderLeg(q: number, post: number, tick: number, fit: readonly number[], rules: DelverTuning): number {
  if (fit.length === 0) return 0;
  const period = Math.max(1, secondsToTicks(rules.wander.seconds));
  const phase = Math.floor((tick + Math.floor(((q * 0.6180339887) % 1) * period)) / period);
  if (mix(q, post, phase) / 2 ** 32 < rules.wander.stay) return 0;
  return fit[mix(phase, q, post + 7919) % fit.length]! + 1;
}

/** Two path lengths (m) closer than this are a tie: equal paths summed in another order differ in their last bits. */
const TIE = 1e-9;

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
 *  - It sees a party Fighter when one of its living Soldiers has it within `sight` flat, feet no more than `levels.promote` above or below, and in sight past the Floor's Walls.
 *  - GUARD holds its post: each `wander.seconds` it picks its post or a wander spot round it (`wanderLeg`, `wanderSpots`) and strolls there at
 *    `wander.pace`, facing its guard facing at the post and out from it at a spot. PATROL walks its loop, the leg advancing at each point.
 *    Either, not broken, that sees the party CHASES the nearest it sees (to its anchor). A broken PATROL becomes a GUARD at its point.
 *  - CHASE follows its Fighter by that Fighter's field, halting `closeIn` short of it in a LINE. A broken Warband RETURNS falling back (`fall`, LOOSE).
 *    It keeps its Fighter while it sees it, takes the nearest it sees if it loses it, and RETURNS after `forgetSeconds` unseen, once its walk from
 *    home passes the Leash, or when no one is left to chase. A patrol's home is its nearest point by walking.
 *  - RETURN is deaf: it walks home and, within `arrive` of it, GUARDS (a guard, or a broken patrol) or PATROLS again.
 * Pure. The result carries `lead` (the one field each anchor follows, derived from the state again each Tick); a Soldier that cannot walk to its
 * place descends it. While a Warband's Soldiers lag, its lead is the field to its anchor (its point, on its Walk Surface), so a Soldier cut off
 * from the rest (dropped off a Deck, left on another level) walks back to it and the Warband regroups; else its home's, its loop point's or its quarry's.
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
  const homeOf = (q: number): { x: number; y: number; z: number } => (w.post[q]! >= 0 ? homes.posts[w.post[q]!]! : homes.patrols[w.patrol[q]!]![leg[q]!]!);
  /** Where a guarding Warband q makes for: its post, or (`leg` k > 0) its wander spot k - 1; a broken patrol's remnant, its loop point. */
  const guardGoal = (q: number): { x: number; y: number; z: number } => {
    if (w.post[q]! < 0 || leg[q] === 0) return homeOf(q);
    const post = homes.posts[w.post[q]!]!;
    // A spot that does not fit (a resync's leg the plan has no spot for): its post.
    const spot = wanderSpots(battle, map, homes, post, rules).spots[leg[q]! - 1];
    return spot ? { x: spot.x, y: post.y, z: spot.z } : post;
  };
  /** The kept field to a point on the floor (never a roof), and the point's Walk Surface. */
  /** The home field and Walk Surface at (px, pz) on the floor at height py (a home's own `y`). */
  const fieldAt = (px: number, pz: number, py: number) => ({ dest: walkField(battle, map, px, pz, py), on: groundOf(battle, field, px, pz, py) });

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
      let seenNow: number[] | null = null;
      const sees = (): number[] => (seenNow ??= lookOut());
      const lookOut = (): number[] => {
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
            if ((f.x - sx) ** 2 + (f.z - sz) ** 2 > sight2 || (sy === sy && fy === fy && Math.abs(sy - fy) > lv.promote)) continue;
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
      let pointNow: [number, number] | null = null;
      const nearestPoint = (r: number): [number, number] => (pointNow ??= walkPoint(r));
      const walkPoint = (r: number): [number, number] => {
        let best = -1;
        let bestD = Infinity;
        homes.patrols[w.patrol[r]!]!.forEach((pt, k) => {
          const to = fieldAt(pt.x, pt.z, pt.y);
          const dist = walkDistance(to.dest, ax, az, as);
          if (dist < bestD - TIE) [best, bestD] = [k, dist];
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
        const k = w.post[q]!;
        // A guard wanders: it picks its post or one of its spots round it each period, and strolls there.
        if (k >= 0) leg[q] = wanderLeg(q, k, tick, wanderSpots(battle, map, homes, homes.posts[k]!, rules).fit, rules);
        const goal = guardGoal(q);
        const to = fieldAt(goal.x, goal.z, goal.y);
        shape[q] = fall[q] ? LOOSE : COLUMN;
        if (arrived(goal.x, goal.z, to.on)) {
          // At its post it stands, facing the post's guard facing; at a spot, facing out from the post (a broken patrol's remnant keeps the facing it has).
          if (k >= 0) {
            const post = homes.posts[k]!;
            aim[q] = leg[q] === 0 ? post.facing : Math.atan2(goal.x - post.x, goal.z - post.z);
          }
        } else walkTo(to.dest, goal.x, goal.z, to.on, walk * p.speed * (k >= 0 ? rules.wander.pace : 1));
      } else if (mode[q] === PATROL) {
        const points = homes.patrols[w.patrol[q]!]!;
        let target = points[leg[q]!]!;
        let to = fieldAt(target.x, target.z, target.y);
        if (arrived(target.x, target.z, to.on)) {
          leg[q] = (leg[q]! + 1) % points.length;
          target = points[leg[q]!]!;
          to = fieldAt(target.x, target.z, target.y);
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
              far = walkDistance(fieldAt(home.x, home.z, home.y).dest, ax, az, as);
            }
            if (tick - seen[q]! >= forget || far > rules.leash) giveUp();
          }
          if (mode[q] === CHASE) {
            const f = partyOf(chased[q]!)!;
            const dest = walkField(battle, map, f.x, f.z, f.y ?? 0);
            if (walkDistance(dest, ax, az, as) <= rules.closeIn) {
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
        const to = fieldAt(home.x, home.z, home.y);
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

  /** The field Warband q's anchor walks by, by its mode: its loop point's, its quarry's, else its home's (null once wiped). */
  const goalOf = (q: number): DestinationFields | null => {
    if (living[q] === 0) return null;
    if (mode[q] === PATROL) {
      const pt = homes.patrols[w.patrol[q]!]![leg[q]!]!;
      return fieldAt(pt.x, pt.z, pt.y).dest;
    }
    if (mode[q] === CHASE) {
      const f = partyOf(chased[q]!);
      if (f) return walkField(battle, map, f.x, f.z, f.y ?? 0);
    }
    const home = mode[q] === GUARD ? guardGoal(q) : homeOf(q);
    return fieldAt(home.x, home.z, home.y).dest;
  };

  // An anchor drops off a ledge only where the field it walks by leads down.
  walkAnchors(battle, map, old.team, x, z, heading, surface, aim, speed, goalOf);

  // The field each anchor follows, derived from the state again every Tick: the home field while it stands (null once wiped), found only for a Squad asked.
  const kept: (DestinationFields | null | undefined)[] = new Array(m);
  /** Each Squad's in-Crowd Soldiers' centre (x, z) and how many they are, from the Soldiers as they stood at the start of the Tick; found on first need. */
  let centres: Float64Array | null = null;
  const centreOf = (): Float64Array => {
    if (centres) return centres;
    const c = new Float64Array(m * 3);
    for (let i = 0; i < n; i++) {
      const sq = crowd.squad[i]!;
      if (sq < 0 || !crowd.alive[i] || crowd.slot[i]! >= 0) continue;
      c[sq * 3] = c[sq * 3]! + crowd.x[i]!;
      c[sq * 3 + 1] = c[sq * 3 + 1]! + crowd.z[i]!;
      c[sq * 3 + 2] = c[sq * 3 + 2]! + 1;
    }
    return (centres = c);
  };
  /** Whether Warband q's in-Crowd Soldiers, as they stood at the start of the Tick, lag its anchor as it stands now (`squad.lag`, the brain's regroup distance). */
  const lags = (q: number): boolean => {
    const c = centreOf();
    const k = c[q * 3 + 2]!;
    return k > 0 && Math.hypot(c[q * 3]! / k - x[q]!, c[q * 3 + 1]! / k - z[q]!) > p.lag;
  };
  const leadOf = (q: number): DestinationFields | null => {
    if (living[q] === 0) return null;
    // Its Soldiers lag: the field to its anchor, so one cut off walks back to the rest (a home's or a quarry's field would lead it on alone).
    if (lags(q)) return walkField(battle, map, x[q]!, z[q]!, soldierHeight(field, surface[q]!, x[q]!, z[q]!));
    return goalOf(q);
  };
  const lead = (q: number): DestinationFields | null => (kept[q] === undefined ? (kept[q] = leadOf(q)) : kept[q]!);

  const squads: SquadState = { ...old, x, z, heading, aim, speed, shape, living, fall, surface };
  return { squads, squad: crowd.squad, place, spawned: [], narrow: squadNarrows(battle, map, squads), lead, warbands: { ...w, mode, leg, chased, seen } };
}
