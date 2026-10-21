/**
 * Motion evaluation: sample a Motion's Pose Keys at a time, giving one target
 * per Skeleton channel. Each channel interpolates independently between the
 * Pose Keys that set it, eased by the later key's easing curve. Before its
 * first key a channel holds that key; after its last key it holds the last;
 * the hands of a key whose path is `arc` arrive along an arc about the chest;
 * a channel no key sets stays at the rest pose. A channel a key links to the
 * guard ("idle") takes the guard's value there.
 */
import { guardKey, weaponMotion, type BodyTarget, type Ease, type FootPlant, type HandTarget, type Motion, type PoseKey, type SkeletonTuning, type TorsoTarget, type TuningData, type WeaponTempo } from '../tuning';
import { secondsToTicks, TICK_RATE } from './constants';
import type { MotionPlayback } from './state';
import { authoredSeconds, motionTempo } from './tempo';
import { arcLerp, lerp, vec3, type Vec3 } from './vec';

/** Every channel resolved: the targets IK solves the Skeleton to reach. */
export interface PoseTargets {
  readonly rightHand: HandTarget;
  readonly leftHand: { readonly position: Vec3 };
  readonly torso: TorsoTarget;
  readonly hip: Vec3;
  readonly leftFoot: FootPlant;
  readonly rightFoot: FootPlant;
  /** The right ankle (Fighter-local, y up) while the Motion owns that foot (a Kick); absent when the Gait has it. */
  readonly kickFoot?: Vec3;
  /** The whole body tilted back and lowered (lying down); absent means upright. */
  readonly body?: BodyTarget;
}

/** The value of a channel that is set (never undefined). */
type Value<C extends keyof PoseTargets> = NonNullable<PoseTargets[C]>;

const NO_BODY: BodyTarget = { tilt: 0, drop: 0 };

export function restTargets(s: SkeletonTuning): PoseTargets {
  return {
    rightHand: { position: { x: 0.25, y: 0.9, z: 0.1 }, rotation: { x: 45, y: 0, z: 0 } },
    leftHand: { position: { x: -0.25, y: 0.9, z: 0.05 } },
    torso: { twist: 0, lean: 0 },
    hip: { x: 0, y: s.pelvisHeight, z: 0 },
    leftFoot: { x: -s.hipWidth / 2, z: 0 },
    rightFoot: { x: s.hipWidth / 2, z: 0 },
  };
}

export function ease(kind: Ease, u: number): number {
  switch (kind) {
    case 'linear':
      return u;
    case 'easeIn':
      return u * u;
    case 'easeOut':
      return 1 - (1 - u) * (1 - u);
    case 'easeInOut':
      return u * u * (3 - 2 * u);
    case 'step':
      return u < 1 ? 0 : 1;
  }
}

const num = (a: number, b: number, t: number) => a + (b - a) * t;

const LERP: { readonly [C in keyof PoseTargets]-?: (a: Value<C>, b: Value<C>, t: number) => Value<C> } = {
  rightHand: (a: HandTarget, b: HandTarget, t: number): HandTarget => ({
    position: lerp(a.position, b.position, t),
    rotation: lerp(a.rotation, b.rotation, t),
  }),
  leftHand: (a: { position: Vec3 }, b: { position: Vec3 }, t: number) => ({ position: lerp(a.position, b.position, t) }),
  torso: (a: TorsoTarget, b: TorsoTarget, t: number): TorsoTarget => ({ twist: num(a.twist, b.twist, t), lean: num(a.lean, b.lean, t) }),
  hip: (a: Vec3, b: Vec3, t: number): Vec3 => lerp(a, b, t),
  leftFoot: (a: FootPlant, b: FootPlant, t: number): FootPlant => ({ x: num(a.x, b.x, t), z: num(a.z, b.z, t) }),
  rightFoot: (a: FootPlant, b: FootPlant, t: number): FootPlant => ({ x: num(a.x, b.x, t), z: num(a.z, b.z, t) }),
  kickFoot: (a: Vec3, b: Vec3, t: number): Vec3 => lerp(a, b, t),
  body: (a: BodyTarget, b: BodyTarget, t: number): BodyTarget => ({ tilt: num(a.tilt, b.tilt, t), drop: num(a.drop, b.drop, t) }),
};

/** The hand channels, which a Pose Key's `path` bends. */
const HANDS: readonly (keyof PoseTargets)[] = ['rightHand', 'leftHand'];

/** The chest at rest: what an `arc` path swings the hands round (the point `solveSkeleton` aims about, too). */
const chest = (s: SkeletonTuning): Vec3 => vec3(0, s.pelvisHeight + s.spine, 0);

/** The value Pose Key `k` gives `channel`: its own, the guard's where it links the channel to it, or undefined if it sets neither. */
function keyValue<C extends keyof PoseTargets>(k: PoseKey, channel: C, guard: PoseKey | undefined): PoseTargets[C] | undefined {
  const own = k.idle?.includes(channel) ? guard : k;
  return own?.[channel] as PoseTargets[C] | undefined;
}

function sampleChannel<C extends keyof PoseTargets>(
  keys: readonly PoseKey[],
  channel: C,
  time: number,
  rest: PoseTargets[C],
  guard: PoseKey | undefined,
  skeleton: SkeletonTuning,
): PoseTargets[C] {
  let prev: PoseTargets[C] | undefined;
  let prevTime = 0;
  for (const k of keys) {
    const v = keyValue(k, channel, guard);
    if (v === undefined) continue;
    if (k.time >= time) {
      if (prev === undefined || k.time === prevTime) return v;
      const u = (time - prevTime) / (k.time - prevTime);
      const lerpFn = LERP[channel] as unknown as (a: PoseTargets[C], b: PoseTargets[C], t: number) => PoseTargets[C];
      const t = ease(k.ease, u);
      const value = lerpFn(prev, v, t);
      if (k.path !== 'arc' || !HANDS.includes(channel)) return value;
      const [a, b] = [prev, v] as unknown as [{ position: Vec3 }, { position: Vec3 }];
      return { ...value, position: arcLerp(a.position, b.position, chest(skeleton), t) };
    }
    prev = v;
    prevTime = k.time;
  }
  return prev ?? rest;
}

/** Authored seconds into the Motion at a Tick of playback (played at `tempo`, if any): looping Motions wrap, others hold their end. */
export function motionTime(motion: Motion, tick: number, tempo?: WeaponTempo): number {
  const t = tick / TICK_RATE;
  if (motion.loop) return t % motion.duration;
  return Math.min(tempo ? authoredSeconds(motion, tempo, t) : t, motion.duration);
}

/** The Pose targets of `motion` at `time`, its channels linked to the guard taking `guard`'s values (see `guardKey`; without one they count as unset). */
export function sampleMotion(motion: Motion, time: number, skeleton: SkeletonTuning, guard?: PoseKey): PoseTargets {
  const rest = restTargets(skeleton);
  const k = motion.poseKeys;
  return {
    rightHand: sampleChannel(k, 'rightHand', time, rest.rightHand, guard, skeleton),
    leftHand: sampleChannel(k, 'leftHand', time, rest.leftHand, guard, skeleton),
    torso: sampleChannel(k, 'torso', time, rest.torso, guard, skeleton),
    hip: sampleChannel(k, 'hip', time, rest.hip, guard, skeleton),
    leftFoot: sampleChannel(k, 'leftFoot', time, rest.leftFoot, guard, skeleton),
    rightFoot: sampleChannel(k, 'rightFoot', time, rest.rightFoot, guard, skeleton),
    ...optionalChannels(sampleChannel(k, 'kickFoot', time, undefined, guard, skeleton), sampleChannel(k, 'body', time, undefined, guard, skeleton)),
  };
}

/** The optional channels as an object holding only those that are set, so a Motion without them yields the same targets as before. */
function optionalChannels(kickFoot: Vec3 | undefined, body: BodyTarget | undefined): Pick<PoseTargets, 'kickFoot' | 'body'> {
  return { ...(kickFoot && { kickFoot }), ...(body && { body }) };
}

/** The ankle of a planted right foot at `foot`: what `kickFoot` holds when the Motion lets the foot stand. */
const plantedAnkle = (foot: FootPlant, ankleHeight: number): Vec3 => ({ x: foot.x, y: ankleHeight, z: foot.z });

/** The value of `channel` in `targets`, or what an unset one stands for (the planted right ankle for `kickFoot`, upright for `body`). */
export function channelValue<C extends keyof PoseTargets>(targets: PoseTargets, channel: C, s: SkeletonTuning): Value<C> {
  const v = targets[channel];
  if (v !== undefined) return v as Value<C>;
  return (channel === 'kickFoot' ? plantedAnkle(targets.rightFoot, s.ankleHeight) : NO_BODY) as Value<C>;
}

/**
 * The Pose targets of the named Motion, as `weapon` plays it (at its Tempo, from its guard), `tick` Ticks in
 * (looping or holding its end as the Motion says).
 */
export function motionTargets(tuning: TuningData, weapon: string, name: string, tick: number): PoseTargets {
  const motion = weaponMotion(tuning, weapon, name);
  if (!motion) throw new Error(`Unknown Motion "${name}"`);
  return sampleMotion(motion, motionTime(motion, tick, motionTempo(tuning, weapon, name)), tuning.skeleton, guardKey(tuning, weapon));
}

/** The upper body: the channels a held Motion can freeze (the torso and both hands). */
export type UpperBody = Pick<PoseTargets, 'rightHand' | 'leftHand' | 'torso'>;

/** The upper body of `targets`, as they are. */
export const upperBody = (targets: PoseTargets): UpperBody => ({ rightHand: targets.rightHand, leftHand: targets.leftHand, torso: targets.torso });

/** `targets` with its upper body replaced by `hold`, where a hold is set; the rest (hips, feet) stays as the Motion has it. */
export function holdUpperBody(targets: PoseTargets, hold: UpperBody | undefined): PoseTargets {
  return hold ? { ...targets, ...hold } : targets;
}

/** Every channel of `a` interpolated toward `b` by `t` (0 = a, 1 = b). */
export function lerpTargets(a: PoseTargets, b: PoseTargets, t: number, ankleHeight: number): PoseTargets {
  // A foot the Motion owns on one side only is blended from/to the planted foot, and stays owned until the blend is done.
  const kickFoot =
    (t < 1 && a.kickFoot) || (t > 0 && b.kickFoot)
      ? LERP.kickFoot(a.kickFoot ?? plantedAnkle(a.rightFoot, ankleHeight), b.kickFoot ?? plantedAnkle(b.rightFoot, ankleHeight), t)
      : undefined;
  const body = a.body || b.body ? LERP.body(a.body ?? NO_BODY, b.body ?? NO_BODY, t) : undefined;
  return {
    rightHand: LERP.rightHand(a.rightHand, b.rightHand, t),
    leftHand: LERP.leftHand(a.leftHand, b.leftHand, t),
    torso: LERP.torso(a.torso, b.torso, t),
    hip: LERP.hip(a.hip, b.hip, t),
    leftFoot: LERP.leftFoot(a.leftFoot, b.leftFoot, t),
    rightFoot: LERP.rightFoot(a.rightFoot, b.rightFoot, t),
    ...optionalChannels(kickFoot, body),
  };
}

/** The Motion Blend in Ticks (Tuning Data `fighter.motionBlend`, seconds), at least one. */
export const motionBlendTicks = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.fighter.motionBlend));

/**
 * The Pose targets of a playback (of `weapon`'s Motions), crossfading out of the pose it blends from:
 * a Motion that just took over eases in from where the last one left off.
 */
export function playbackTargets(tuning: TuningData, weapon: string, playback: MotionPlayback): PoseTargets {
  const targets = holdUpperBody(motionTargets(tuning, weapon, playback.name, playback.tick), playback.hold);
  const blend = playback.blend;
  if (!blend) return targets;
  return lerpTargets(blend.from, targets, ease('easeInOut', blend.tick / (blend.ticks ?? motionBlendTicks(tuning))), tuning.skeleton.ankleHeight);
}

/**
 * The playback `next` as it follows `prev` one Tick later. A Motion that carries
 * on (same name, playhead not rewound) keeps blending out of its old pose until
 * the Motion Blend ends; one that takes over starts a fresh blend from the pose
 * `prev` was showing, so the Skeleton never jumps between Motions. `freshTicks`
 * forces a fresh blend of that length even where the Motion carries on.
 */
export function followMotion(
  tuning: TuningData,
  weapon: string,
  prev: MotionPlayback,
  next: Omit<MotionPlayback, 'blend'>,
  freshTicks?: number,
): MotionPlayback {
  const playback = { name: next.name, tick: next.tick, ...(next.hold && { hold: next.hold }) };
  const carriesOn = freshTicks === undefined && next.name === prev.name && next.tick >= prev.tick;
  if (carriesOn && !prev.blend) return playback;
  const tick = carriesOn ? prev.blend!.tick + 1 : 1;
  const ticks = freshTicks ?? (carriesOn ? prev.blend!.ticks : undefined);
  if (tick >= (ticks ?? motionBlendTicks(tuning))) return playback;
  const from = carriesOn ? prev.blend!.from : playbackTargets(tuning, weapon, prev);
  return { ...playback, blend: { from, tick, ...(ticks !== undefined && { ticks }) } };
}
