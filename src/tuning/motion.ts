/**
 * Motion Tuning Data: a named sequence of Pose Keys (see CONTEXT.md).
 *
 * File format (one file per Motion, `data/motions/<name lowercased>.json`):
 *
 *   {
 *     "name": "Overhead",          // unique Motion name
 *     "duration": 1.1,             // seconds
 *     "loop": false,               // optional, default false
 *     "markers": { "windUpEnd": 0.35, "releaseEnd": 0.6 },  // optional named times (s)
 *     "poseKeys": [ PoseKey, ... ] // at least one, in time order
 *   }
 *
 * A channel written as "idle" (e.g. `"rightHand": "idle"`) is linked to the
 * guard: it takes that channel of the first Pose Key of the Idle Motion the
 * playing Weapon uses (its override, or the default), so changing an Idle
 * moves every Motion that starts or ends on guard with it.
 *
 * All positions are in the Fighter-local frame: x = the Fighter's right,
 * y = up, z = forward (facing), origin on the floor between the feet.
 * Angles are degrees. See NOTES.md for the per-channel meaning.
 */
import type { Vec3 } from '../sim/vec';
import { array, finiteNumber, nonEmptyString, positiveNumber, record, TuningDataError } from './validate';

export const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'] as const;
/** How a channel arrives at a Pose Key from the previous Pose Key that sets it. */
export type Ease = (typeof EASES)[number];

/** A foot plant on the floor (Fighter-local x/z). */
export interface FootPlant {
  readonly x: number;
  readonly z: number;
}

export interface HandTarget {
  readonly position: Vec3;
  /** Euler degrees: roll (z), then pitch (x), then yaw (y). Zero points the blade forward. */
  readonly rotation: Vec3;
}

export interface TorsoTarget {
  /** Yaw of the shoulders about the spine, degrees; positive turns toward the Fighter's right. */
  readonly twist: number;
  /** Pitch of the spine, degrees; positive leans forward. */
  readonly lean: number;
}

/** The whole body laid back, for lying down: tilted about the ground point under the pelvis, then lowered. */
export interface BodyTarget {
  /** Degrees the whole body tilts about the ground point under the pelvis; positive tilts it back (head toward -z). */
  readonly tilt: number;
  /** Metres everything is lowered after tilting. */
  readonly drop: number;
}

/**
 * A timed target for part of the Skeleton. Every channel is optional: a Pose
 * Key only constrains the channels it sets, and each channel interpolates
 * between the Pose Keys that set it.
 */
export interface PoseKey {
  readonly time: number;
  readonly ease: Ease;
  /** The sword hand. */
  readonly rightHand?: HandTarget;
  readonly leftHand?: { readonly position: Vec3 };
  readonly torso?: TorsoTarget;
  /** Pelvis position. */
  readonly hip?: Vec3;
  readonly leftFoot?: FootPlant;
  readonly rightFoot?: FootPlant;
  /** The right ankle (Fighter-local, y up). While set the Motion owns that foot: the Gait leaves it alone. */
  readonly kickFoot?: Vec3;
  /** Tilts and lowers the whole body; absent means upright. */
  readonly body?: BodyTarget;
  /**
   * Channels linked to the guard (written `"<channel>": "idle"`): each takes its value from the first Pose Key of
   * the playing Weapon's Idle, and the key holds no value of its own for it. Absent when none are linked.
   */
  readonly idle?: readonly PoseKeyChannel[];
}

export interface Motion {
  readonly name: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly markers: Readonly<Record<string, number>>;
  readonly poseKeys: readonly PoseKey[];
}

/** Pose Key channel names, in the order they are written to JSON. */
export const POSE_KEY_CHANNELS = ['rightHand', 'leftHand', 'torso', 'hip', 'leftFoot', 'rightFoot', 'kickFoot', 'body'] as const;
export type PoseKeyChannel = (typeof POSE_KEY_CHANNELS)[number];

function vec3(v: unknown, where: string): Vec3 {
  const o = record(v, where);
  return { x: finiteNumber(o, 'x', where), y: finiteNumber(o, 'y', where), z: finiteNumber(o, 'z', where) };
}

function foot(v: unknown, where: string): FootPlant {
  const o = record(v, where);
  return { x: finiteNumber(o, 'x', where), z: finiteNumber(o, 'z', where) };
}

function poseKey(raw: unknown, where: string, duration: number): PoseKey {
  const o = { ...record(raw, where) };
  const time = finiteNumber(o, 'time', where);
  if (time < 0 || time > duration) {
    throw new TuningDataError(`${where}.time must be within 0..duration (${duration}), got ${time}`);
  }
  const ease = o.ease ?? 'linear';
  if (typeof ease !== 'string' || !(EASES as readonly string[]).includes(ease)) {
    throw new TuningDataError(`${where}.ease must be one of ${EASES.join(', ')}, got ${JSON.stringify(o.ease)}`);
  }
  const key: { -readonly [K in keyof PoseKey]: PoseKey[K] } = { time, ease: ease as Ease };
  const idle = idleLinks(o, where);
  for (const c of idle) delete o[c];
  if (idle.length > 0) key.idle = idle;
  if (o.rightHand !== undefined) {
    const h = record(o.rightHand, `${where}.rightHand`);
    key.rightHand = {
      position: vec3(h.position, `${where}.rightHand.position`),
      rotation: vec3(h.rotation, `${where}.rightHand.rotation`),
    };
  }
  if (o.leftHand !== undefined) {
    const h = record(o.leftHand, `${where}.leftHand`);
    key.leftHand = { position: vec3(h.position, `${where}.leftHand.position`) };
  }
  if (o.torso !== undefined) {
    const t = record(o.torso, `${where}.torso`);
    key.torso = { twist: finiteNumber(t, 'twist', `${where}.torso`), lean: finiteNumber(t, 'lean', `${where}.torso`) };
  }
  if (o.hip !== undefined) key.hip = vec3(o.hip, `${where}.hip`);
  if (o.leftFoot !== undefined) key.leftFoot = foot(o.leftFoot, `${where}.leftFoot`);
  if (o.rightFoot !== undefined) key.rightFoot = foot(o.rightFoot, `${where}.rightFoot`);
  if (o.kickFoot !== undefined) key.kickFoot = vec3(o.kickFoot, `${where}.kickFoot`);
  if (o.body !== undefined) {
    const b = record(o.body, `${where}.body`);
    key.body = { tilt: finiteNumber(b, 'tilt', `${where}.body`), drop: finiteNumber(b, 'drop', `${where}.body`) };
  }
  return key;
}

/**
 * The channels a raw Pose Key links to the guard, in channel order: those written `"idle"` in a file, or listed in
 * `idle` (a Motion already parsed, e.g. an Editor draft, where a linked channel holds no value).
 */
function idleLinks(o: Record<string, unknown>, where: string): PoseKeyChannel[] {
  let listed: readonly unknown[] = [];
  if (o.idle !== undefined) {
    listed = array(o.idle, `${where}.idle`);
    for (const c of listed) {
      if (!(POSE_KEY_CHANNELS as readonly unknown[]).includes(c)) throw new TuningDataError(`${where}.idle: ${JSON.stringify(c)} is not a Pose Key channel`);
    }
  }
  return POSE_KEY_CHANNELS.filter((c) => o[c] === 'idle' || listed.includes(c));
}

/** Validate one raw (parsed JSON) Motion. Throws TuningDataError naming the offending path. */
export function parseMotion(raw: unknown, where = 'motion'): Motion {
  const o = record(raw, where);
  const name = nonEmptyString(o, 'name', where);
  const at = `motions/${name}`;
  const duration = positiveNumber(o, 'duration', at);
  if (o.loop !== undefined && typeof o.loop !== 'boolean') {
    throw new TuningDataError(`${at}.loop must be true or false, got ${JSON.stringify(o.loop)}`);
  }
  const markers: Record<string, number> = {};
  if (o.markers !== undefined) {
    const m = record(o.markers, `${at}.markers`);
    for (const k of Object.keys(m)) {
      const v = finiteNumber(m, k, `${at}.markers`);
      if (v < 0 || v > duration) {
        throw new TuningDataError(`${at}.markers.${k} must be within 0..duration (${duration}), got ${v}`);
      }
      markers[k] = v;
    }
  }
  const rawKeys = array(o.poseKeys, `${at}.poseKeys`);
  if (rawKeys.length === 0) throw new TuningDataError(`${at}.poseKeys must hold at least one Pose Key`);
  const poseKeys = rawKeys.map((k, i) => poseKey(k, `${at}.poseKeys[${i}]`, duration));
  for (let i = 1; i < poseKeys.length; i++) {
    if (poseKeys[i]!.time < poseKeys[i - 1]!.time) {
      throw new TuningDataError(`${at}.poseKeys[${i}] is out of time order (${poseKeys[i]!.time} < ${poseKeys[i - 1]!.time})`);
    }
  }
  return { name, duration, loop: o.loop === true, markers, poseKeys };
}

/** The repo file a Motion lives in, under `data/motions/`. */
export function motionFileName(name: string): string {
  return `${name.toLowerCase()}.json`;
}

/** Whether any Pose Key of `m` links a channel to the guard. */
export const linksIdle = (m: Motion): boolean => m.poseKeys.some((k) => k.idle !== undefined);

/** Stable, diff-friendly JSON for a Motion file (2-space indent, trailing newline). */
export function serializeMotion(m: Motion): string {
  const out: Record<string, unknown> = { name: m.name, duration: m.duration, loop: m.loop };
  if (Object.keys(m.markers).length > 0) out.markers = m.markers;
  out.poseKeys = m.poseKeys.map((k) => {
    const o: Record<string, unknown> = { time: k.time, ease: k.ease };
    for (const c of POSE_KEY_CHANNELS) {
      if (k.idle?.includes(c)) o[c] = 'idle';
      else if (k[c] !== undefined) o[c] = k[c];
    }
    return o;
  });
  return `${JSON.stringify(out, null, 2)}\n`;
}
