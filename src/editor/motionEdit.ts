/**
 * Pose Key editing operations on a Motion draft (see `EditorSession`). Pure
 * data in, data out: no three.js or DOM, so the timeline, the gizmos and the
 * fields all share these and they are unit-tested. Every operation keeps the
 * draft's Pose Keys in time order; the draft still has to pass `commit()`
 * (parseMotion) before it becomes live.
 */
import { channelValue, sampleMotion, type PoseTargets } from '../sim';
import { POSE_KEY_CHANNELS, type PoseKey, type PoseKeyChannel, type SkeletonTuning } from '../tuning';
import type { MotionDraft } from './session';

type PoseKeyDraft = MotionDraft['poseKeys'][number];

/** Pose Key times are authored in hundredths of a second. */
export const TIME_STEP = 0.01;

/** Round to the authoring step and clamp into the Motion. */
export function snapTime(time: number, duration: number): number {
  const t = Math.round(time / TIME_STEP) * TIME_STEP;
  return Math.min(Math.max(+t.toFixed(4), 0), duration);
}

/**
 * The value a Motion's channel has at `time` (what a new Pose Key there would hold), its channels linked to the
 * guard taking `guard`'s values (the previewed Weapon's, see `guardKey`).
 */
export function channelValueAt<C extends PoseKeyChannel>(
  d: MotionDraft,
  channel: C,
  time: number,
  skeleton: SkeletonTuning,
  guard?: PoseKey,
): NonNullable<PoseTargets[C]> {
  return structuredClone(channelValue(sampleMotion(d, time, skeleton, guard), channel, skeleton));
}

/** Whether Pose Key `index` links `channel` to the guard. */
export const isLinked = (d: MotionDraft, index: number, channel: PoseKeyChannel): boolean => d.poseKeys[index]?.idle?.includes(channel) ?? false;

/** Stop Pose Key `index` linking `channel` to the guard (it then holds no value for it unless one is set after). */
function unlink(key: PoseKeyDraft, channel: PoseKeyChannel): void {
  if (!key.idle?.includes(channel)) return;
  key.idle = key.idle.filter((c) => c !== channel);
  if (key.idle.length === 0) delete key.idle;
}

function insertIndex(d: MotionDraft, time: number): number {
  let i = 0;
  while (i < d.poseKeys.length && d.poseKeys[i]!.time <= time) i++;
  return i;
}

/**
 * Move Pose Key `index` to `time` (snapped and clamped). If it passes a
 * neighbour it moves in the list; ties keep it on the side it came from.
 * Returns its new index.
 */
export function retimePoseKey(d: MotionDraft, index: number, time: number): number {
  const key = d.poseKeys[index];
  if (!key) throw new RangeError(`No Pose Key ${index}`);
  const t = snapTime(time, d.duration);
  const later = t >= key.time;
  d.poseKeys.splice(index, 1);
  key.time = t;
  let i = 0;
  if (later) i = insertIndex(d, t);
  else while (i < d.poseKeys.length && d.poseKeys[i]!.time < t) i++;
  d.poseKeys.splice(i, 0, key);
  return i;
}

/** Delete Pose Key `index`. A Motion must keep at least one Pose Key. */
export function removePoseKey(d: MotionDraft, index: number): void {
  if (!d.poseKeys[index]) throw new RangeError(`No Pose Key ${index}`);
  if (d.poseKeys.length <= 1) throw new RangeError('A Motion needs at least one Pose Key');
  d.poseKeys.splice(index, 1);
}

/**
 * Make Pose Key `index` set `channel` to its own value (to the pose the Motion has at that key's time, the
 * guard's if it was linked to it, unless it already sets it) or stop setting it. Either way it is no longer linked.
 */
export function setChannel(d: MotionDraft, index: number, channel: PoseKeyChannel, on: boolean, skeleton: SkeletonTuning, guard?: PoseKey): void {
  const key = d.poseKeys[index];
  if (!key) throw new RangeError(`No Pose Key ${index}`);
  const values = key as Record<PoseKeyChannel, unknown>;
  if (on && values[channel] === undefined) values[channel] = channelValueAt(d, channel, key.time, skeleton, guard);
  if (!on) delete values[channel];
  unlink(key, channel);
}

/** Link `channel` of Pose Key `index` to the guard (dropping any value of its own), or unlink it, keeping the guard's value as its own. */
export function linkChannel(d: MotionDraft, index: number, channel: PoseKeyChannel, linked: boolean, skeleton: SkeletonTuning, guard?: PoseKey): void {
  const key = d.poseKeys[index];
  if (!key) throw new RangeError(`No Pose Key ${index}`);
  if (!linked) {
    if (isLinked(d, index, channel)) setChannel(d, index, channel, true, skeleton, guard);
    return;
  }
  delete (key as Record<PoseKeyChannel, unknown>)[channel];
  key.idle = POSE_KEY_CHANNELS.filter((c) => c === channel || key.idle?.includes(c));
}

/**
 * Scale the Motion's timeline so it lasts `seconds`: the duration, every
 * Pose Key's time and every marker move by the same factor, snapped to the
 * authoring step. Poses and easing curves are untouched, and snapping never
 * reorders Pose Keys (it is monotonic).
 */
export function scaleMotion(d: MotionDraft, seconds: number): void {
  if (!(seconds > 0)) throw new RangeError(`A Motion needs a positive length, got ${seconds}`);
  const total = Math.max(TIME_STEP, +(Math.round(seconds / TIME_STEP) * TIME_STEP).toFixed(4));
  const factor = total / d.duration;
  const scaled = (t: number) => Math.min(+(Math.round((t * factor) / TIME_STEP) * TIME_STEP).toFixed(4), total);
  for (const name of Object.keys(d.markers)) d.markers[name] = scaled(d.markers[name]!);
  for (const key of d.poseKeys) key.time = scaled(key.time);
  d.duration = total;
}

/**
 * Add a Pose Key at `time` holding the pose the Motion has there, for every
 * channel some Pose Key already sets (or links to the guard). It takes the easing curve of the
 * segment it splits. Returns the new key's index.
 */
export function addPoseKey(d: MotionDraft, time: number, skeleton: SkeletonTuning, guard?: PoseKey): number {
  const t = snapTime(time, d.duration);
  const sampled = sampleMotion(d, t, skeleton, guard);
  const i = insertIndex(d, t);
  const key: PoseKeyDraft = { time: t, ease: d.poseKeys[i]?.ease ?? 'linear' };
  for (const c of POSE_KEY_CHANNELS) {
    if (d.poseKeys.some((k) => k[c] !== undefined || k.idle?.includes(c))) (key as Record<PoseKeyChannel, unknown>)[c] = structuredClone(channelValue(sampled, c, skeleton));
  }
  d.poseKeys.splice(i, 0, key);
  return i;
}
