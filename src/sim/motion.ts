/**
 * Motion evaluation: sample a Motion's Pose Keys at a time, giving one target
 * per Skeleton channel. Each channel interpolates independently between the
 * Pose Keys that set it, eased by the later key's easing curve. Before its
 * first key a channel holds that key; after its last key it holds the last;
 * a channel no key sets stays at the rest pose.
 */
import { weaponMotion, type Ease, type FootPlant, type HandTarget, type Motion, type PoseKey, type SkeletonTuning, type TorsoTarget, type TuningData } from '../tuning';
import { secondsToTicks, TICK_RATE } from './constants';
import type { MotionPlayback } from './state';
import { lerp, type Vec3 } from './vec';

/** Every channel resolved: the targets IK solves the Skeleton to reach. */
export interface PoseTargets {
  readonly rightHand: HandTarget;
  readonly leftHand: { readonly position: Vec3 };
  readonly torso: TorsoTarget;
  readonly hip: Vec3;
  readonly leftFoot: FootPlant;
  readonly rightFoot: FootPlant;
}

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

const LERP: { readonly [C in keyof PoseTargets]: (a: PoseTargets[C], b: PoseTargets[C], t: number) => PoseTargets[C] } = {
  rightHand: (a: HandTarget, b: HandTarget, t: number): HandTarget => ({
    position: lerp(a.position, b.position, t),
    rotation: lerp(a.rotation, b.rotation, t),
  }),
  leftHand: (a: { position: Vec3 }, b: { position: Vec3 }, t: number) => ({ position: lerp(a.position, b.position, t) }),
  torso: (a: TorsoTarget, b: TorsoTarget, t: number): TorsoTarget => ({ twist: num(a.twist, b.twist, t), lean: num(a.lean, b.lean, t) }),
  hip: (a: Vec3, b: Vec3, t: number): Vec3 => lerp(a, b, t),
  leftFoot: (a: FootPlant, b: FootPlant, t: number): FootPlant => ({ x: num(a.x, b.x, t), z: num(a.z, b.z, t) }),
  rightFoot: (a: FootPlant, b: FootPlant, t: number): FootPlant => ({ x: num(a.x, b.x, t), z: num(a.z, b.z, t) }),
};

function sampleChannel<C extends keyof PoseTargets>(keys: readonly PoseKey[], channel: C, time: number, rest: PoseTargets[C]): PoseTargets[C] {
  let prev: PoseKey | undefined;
  for (const k of keys) {
    const v = k[channel] as PoseTargets[C] | undefined;
    if (v === undefined) continue;
    if (k.time >= time) {
      if (!prev || k.time === prev.time) return v;
      const u = (time - prev.time) / (k.time - prev.time);
      const lerpFn: (a: PoseTargets[C], b: PoseTargets[C], t: number) => PoseTargets[C] = LERP[channel];
      return lerpFn(prev[channel] as PoseTargets[C], v, ease(k.ease, u));
    }
    prev = k;
  }
  return prev ? (prev[channel] as PoseTargets[C]) : rest;
}

/** Seconds into the Motion at a Tick of playback: looping Motions wrap, others hold their end. */
export function motionTime(motion: Motion, tick: number): number {
  const t = tick / TICK_RATE;
  return motion.loop ? t % motion.duration : Math.min(t, motion.duration);
}

export function sampleMotion(motion: Motion, time: number, skeleton: SkeletonTuning): PoseTargets {
  const rest = restTargets(skeleton);
  const k = motion.poseKeys;
  return {
    rightHand: sampleChannel(k, 'rightHand', time, rest.rightHand),
    leftHand: sampleChannel(k, 'leftHand', time, rest.leftHand),
    torso: sampleChannel(k, 'torso', time, rest.torso),
    hip: sampleChannel(k, 'hip', time, rest.hip),
    leftFoot: sampleChannel(k, 'leftFoot', time, rest.leftFoot),
    rightFoot: sampleChannel(k, 'rightFoot', time, rest.rightFoot),
  };
}

/** The Pose targets of the named Motion, as `weapon` plays it, `tick` Ticks in (looping or holding its end as the Motion says). */
export function motionTargets(tuning: TuningData, weapon: string, name: string, tick: number): PoseTargets {
  const motion = weaponMotion(tuning, weapon, name);
  if (!motion) throw new Error(`Unknown Motion "${name}"`);
  return sampleMotion(motion, motionTime(motion, tick), tuning.skeleton);
}

/** Every channel of `a` interpolated toward `b` by `t` (0 = a, 1 = b). */
export function lerpTargets(a: PoseTargets, b: PoseTargets, t: number): PoseTargets {
  return {
    rightHand: LERP.rightHand(a.rightHand, b.rightHand, t),
    leftHand: LERP.leftHand(a.leftHand, b.leftHand, t),
    torso: LERP.torso(a.torso, b.torso, t),
    hip: LERP.hip(a.hip, b.hip, t),
    leftFoot: LERP.leftFoot(a.leftFoot, b.leftFoot, t),
    rightFoot: LERP.rightFoot(a.rightFoot, b.rightFoot, t),
  };
}

/** The Motion Blend in Ticks (Tuning Data `fighter.motionBlend`, seconds), at least one. */
const blendTicks = (tuning: TuningData): number => Math.max(1, secondsToTicks(tuning.fighter.motionBlend));

/**
 * The Pose targets of a playback (of `weapon`'s Motions), crossfading out of the pose it blends from:
 * a Motion that just took over eases in from where the last one left off.
 */
export function playbackTargets(tuning: TuningData, weapon: string, playback: MotionPlayback): PoseTargets {
  const targets = motionTargets(tuning, weapon, playback.name, playback.tick);
  const blend = playback.blend;
  if (!blend) return targets;
  return lerpTargets(blend.from, targets, ease('easeInOut', blend.tick / blendTicks(tuning)));
}

/**
 * The playback `next` as it follows `prev` one Tick later. A Motion that carries
 * on (same name, playhead not rewound) keeps blending out of its old pose until
 * the Motion Blend ends; one that takes over starts a fresh blend from the pose
 * `prev` was showing, so the Skeleton never jumps between Motions.
 */
export function followMotion(tuning: TuningData, weapon: string, prev: MotionPlayback, next: Omit<MotionPlayback, 'blend'>): MotionPlayback {
  const playback = { name: next.name, tick: next.tick };
  const carriesOn = next.name === prev.name && next.tick >= prev.tick;
  if (carriesOn && !prev.blend) return playback;
  const tick = carriesOn ? prev.blend!.tick + 1 : 1;
  if (tick >= blendTicks(tuning)) return playback;
  const from = carriesOn ? prev.blend!.from : playbackTargets(tuning, weapon, prev);
  return { ...playback, blend: { from, tick } };
}
