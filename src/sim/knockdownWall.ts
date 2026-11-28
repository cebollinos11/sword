/**
 * A knocked-down Fighter propped up by a Wall behind it. A Knockdown lays the body flat on its back, reaching about a body's
 * length behind its feet; with a Wall closer than that, the body sits up against it instead of lying through it. How far it
 * sits up (`MotionPlayback.wall`, 0 lying flat to 1 sitting slumped against the Wall) follows the room behind it, measured
 * along the way it lies, and blends the Knockdown and Get-up Motions toward their Wall variants. It is simulation, not
 * drawing: the pose it gives is the one the Hit Zones are built on, so the body that is hit is the body that is seen.
 */
import type { ArenaGeometry, SkeletonTuning, TuningData } from '../tuning';
import { GET_UP_MOTION, KNOCKDOWN_MOTION } from './actions';
import { wallHit } from './arena';
import { TICK_SECONDS } from './constants';
import type { FighterState } from './state';

/** How far behind its feet the seated Wall pose reaches (m, the standard body): the back of the head and shoulders. */
export const SEATED_REACH = 0.25;
/** Room (m) kept between the Wall and the body's farthest point, as the blend between lying and sitting only roughly follows a straight line. */
export const WALL_CLEARANCE = 0.08;
/** How long (s) the body takes to sit all the way up against a Wall it meets, and to lie all the way back once the Wall is gone. */
export const PROP_UP_SECONDS = 0.1;
export const LIE_BACK_SECONDS = 0.5;
/** The heights (m above the feet, the standard body) and sideways offsets (m, either side of the spine) the room behind is measured at. */
const PROBE_HEIGHTS = [0.25, 0.8] as const;
const PROBE_SIDE = 0.18;

/** How far behind its feet a body lying flat reaches: legs, spine, neck and head laid end to end. */
export const lyingReach = (s: SkeletonTuning): number => s.pelvisHeight + s.spine + s.neck + 2 * s.headRadius;

/**
 * The room (m) behind a Fighter standing at its position and facing: the distance to the nearest Wall behind it, measured from its
 * feet straight back (the way a Knockdown lays it), at the hips' and the shoulders' height and either side of the spine; `reach` when
 * none is that close.
 */
export function roomBehind(f: Pick<FighterState, 'position' | 'facing' | 'y'>, reach: number, height: number, arena: ArenaGeometry): number {
  const bx = -Math.sin(f.facing);
  const bz = -Math.cos(f.facing);
  // Sideways (the Fighter's right): perpendicular to the way it lies.
  const sx = -bz;
  const sz = bx;
  let room = reach;
  for (const h of PROBE_HEIGHTS) {
    const y = f.y + h * height;
    for (const side of [-PROBE_SIDE, 0, PROBE_SIDE]) {
      const ox = f.position.x + sx * side * height;
      const oz = f.position.z + sz * side * height;
      const hit = wallHit({ x: ox, y, z: oz }, { x: ox + bx * reach, y, z: oz + bz * reach }, arena);
      if (hit) room = Math.min(room, hit.t * reach);
    }
  }
  return room;
}

/** How far a body needs propping up (0 to 1) with `room` behind its feet: 0 with room to lie flat, 1 with only room to sit. */
export function wallLean(room: number, tuning: TuningData): number {
  const flat = lyingReach(tuning.size?.skeleton ?? tuning.skeleton);
  const seated = SEATED_REACH * (tuning.size?.height ?? 1);
  const lean = (flat - (room - WALL_CLEARANCE)) / (flat - seated);
  return Math.min(1, Math.max(0, lean));
}

/**
 * `f` (this Tick's Fighter at its settled position) with its Knockdown propped up by any Wall behind it: falling or down, its
 * `wall` moves toward the lean the room behind asks for (quickly up, slowly back down); getting up, it keeps the lean it lay with,
 * so the Get-up rises from the pose it lay in. `before` is last Tick's Fighter, whose lean it carries on from. Any other Action
 * carries none. `tuning` is the Fighter's own (its Size's).
 */
export function propAgainstWall(before: FighterState, f: FighterState, arena: ArenaGeometry, tuning: TuningData): FighterState {
  const a = f.action;
  const named = f.motion.name === KNOCKDOWN_MOTION || f.motion.name === GET_UP_MOTION;
  const was = before.action.kind === 'Knockdown' ? (before.motion.wall ?? 0) : 0;
  let wall = 0;
  if (a.kind === 'Knockdown' && named) {
    if (a.phase === 'Rising') wall = was;
    else {
      const height = tuning.size?.height ?? 1;
      const reach = lyingReach(tuning.size?.skeleton ?? tuning.skeleton) + WALL_CLEARANCE;
      const want = wallLean(roomBehind(f, reach, height, arena), tuning);
      const rate = TICK_SECONDS / (want > was ? PROP_UP_SECONDS : LIE_BACK_SECONDS);
      wall = want > was ? Math.min(want, was + rate) : Math.max(want, was - rate);
    }
  }
  if (wall === (f.motion.wall ?? 0)) return f;
  if (wall > 0) return { ...f, motion: { ...f.motion, wall } };
  const { wall: _gone, ...motion } = f.motion;
  return { ...f, motion };
}
