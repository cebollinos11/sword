/**
 * The `kickFoot` and `body` Pose Key channels: a Motion can own the right foot and tilt the whole
 * body. Without them nothing changes (bit for bit).
 */
import { describe, expect, it } from 'vitest';
import { defaultWeaponName, loadTuningData, parseMotion, weaponByName, weaponMotion, type Motion, type TuningData } from '../tuning';
import { arenaOf } from './arena';
import { updateGait } from './gait';
import { channelValue, lerpTargets, playbackTargets, sampleMotion } from './motion';
import { fighterPose } from './pose';
import { solveSkeleton } from './skeleton';
import { createInitialState, hashValue, motionPose, runDuel, wait, walk, type Placement, type Vec3 } from './index';

const tuning = loadTuningData();
const ORIGIN: Placement = { position: { x: 0, z: 0 }, facing: 0 };
const PLACEMENTS = [
  { position: { x: 0, z: 0 }, facing: 0 },
  { position: { x: 0, z: 6 }, facing: Math.PI },
];
const KICK: Vec3 = { x: 0.14, y: 0.5, z: 0.6 };

/** The Idle the default Weapon plays: its own override, or the shared one. */
const idleOf = (t: TuningData): Motion => weaponMotion(t, defaultWeaponName(t), 'Idle')!;

/** Tuning Data whose default Weapon's Idle has `channels` on its first Pose Key (and so, held, throughout). */
function withIdle(base: TuningData, channels: object): TuningData {
  const idle = idleOf(base);
  const motion: Motion = parseMotion({ ...idle, poseKeys: idle.poseKeys.map((k, i) => (i === 0 ? { ...k, ...channels } : k)) });
  const weapon = defaultWeaponName(base);
  return { ...base, motionOverrides: { ...base.motionOverrides, [weapon]: { ...base.motionOverrides[weapon], Idle: motion } } };
}

const kicking = withIdle(tuning, { kickFoot: KICK });
const lying = withIdle(tuning, { body: { tilt: 90, drop: 0 } });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

describe('kickFoot', () => {
  it('puts the right ankle at the target, with the toe along the shin', () => {
    const pose = motionPose(kicking, 'Idle', 0, ORIGIN);
    // Fighter-local +x is the Fighter's right, which is world -x when facing +z.
    expect(dist(pose.joints.rightAnkle, { x: -KICK.x, y: KICK.y, z: KICK.z })).toBeLessThan(1e-9);
    const shin = minus(pose.joints.rightAnkle, pose.joints.rightKnee);
    const toe = minus(pose.joints.rightToe, pose.joints.rightAnkle);
    const cos = (shin.x * toe.x + shin.y * toe.y + shin.z * toe.z) / (Math.hypot(shin.x, shin.y, shin.z) * Math.hypot(toe.x, toe.y, toe.z));
    expect(cos).toBeCloseTo(1, 9);
  });

  it('is sampled and blended like any channel, and absent when no key sets it', () => {
    const a = sampleMotion(idleOf(tuning), 0, tuning.skeleton);
    const b = sampleMotion(idleOf(kicking), 0, tuning.skeleton);
    expect(a).not.toHaveProperty('kickFoot');
    expect(sampleMotion(idleOf(kicking), 0.5, tuning.skeleton).kickFoot).toEqual(KICK);
    const ankle = tuning.skeleton.ankleHeight;
    expect(lerpTargets(a, b, 0.5, ankle).kickFoot!.y).toBeCloseTo((ankle + KICK.y) / 2, 9);
    expect(lerpTargets(a, b, 0, ankle)).not.toHaveProperty('kickFoot');
    expect(lerpTargets(b, a, 1, ankle)).not.toHaveProperty('kickFoot');
    expect(lerpTargets(b, a, 0.5, ankle).kickFoot).toBeDefined();
  });

  it('has an editor default: the planted right ankle, and upright', () => {
    const t = sampleMotion(idleOf(tuning), 0, tuning.skeleton);
    expect(channelValue(t, 'kickFoot', tuning.skeleton)).toEqual({ x: t.rightFoot.x, y: tuning.skeleton.ankleHeight, z: t.rightFoot.z });
    expect(channelValue(t, 'body', tuning.skeleton)).toEqual({ tilt: 0, drop: 0 });
  });

  it('is kept by the Gait: the right foot never steps, even while the body walks', () => {
    const run = runDuel(kicking, { placements: PLACEMENTS, a: walk(90, { x: 0, z: 1 }), b: wait(90), ticks: 90 });
    for (const s of run.states.slice(1)) {
      const f = s.fighters[0]!;
      const ankle = fighterPose(f, kicking).joints.rightAnkle;
      const c = Math.cos(f.facing);
      const sn = Math.sin(f.facing);
      const dx = ankle.x - f.position.x;
      const dz = ankle.z - f.position.z;
      expect(-dx * c + dz * sn).toBeCloseTo(KICK.x, 6);
      expect(dx * sn + dz * c).toBeCloseTo(KICK.z, 6);
      expect(ankle.y).toBeCloseTo(KICK.y, 6);
      expect(f.gait.right.step).toBeNull();
    }
    expect(run.events.some((e) => e.type === 'Step' && e.fighter === 0 && e.foot === 'right')).toBe(false);
    expect(run.events.some((e) => e.type === 'Step' && e.fighter === 0 && e.foot === 'left')).toBe(true);
  });

  it('re-plants the foot where it was left when the Motion lets go', () => {
    const state = createInitialState(kicking, 1, PLACEMENTS);
    const before = state.fighters[0]!;
    const arena = arenaOf(kicking, state.arena);
    const owned = updateGait(before, before, 0, kicking, arena, () => {});
    expect(owned.right.planted.z).toBeCloseTo(KICK.z, 9);
    const released = updateGait({ ...before, gait: owned }, before, 0, tuning, arena, () => {});
    // It glides home from where it was; it does not snap there.
    const moved = Math.hypot(released.right.planted.x - owned.right.planted.x, released.right.planted.z - owned.right.planted.z);
    expect(moved).toBeLessThanOrEqual(tuning.gait.strideThreshold + 1e-9);
    expect(released.right.planted.z).toBeGreaterThan(0.2);
  });
});

describe('body', () => {
  it('lays the joints near the ground at tilt 90', () => {
    const upright = motionPose(tuning, 'Idle', 0, ORIGIN);
    const flat = motionPose(lying, 'Idle', 0, ORIGIN);
    expect(upright.joints.head.y).toBeGreaterThan(1.4);
    for (const [name, p] of Object.entries(flat.joints)) expect(p.y, name).toBeLessThan(0.5);
    // Back is positive: the head ends up behind the pelvis.
    expect(flat.joints.head.z).toBeLessThan(flat.joints.pelvis.z - 0.5);
  });

  it('tilts the Weapon with the body and lowers everything by drop', () => {
    const upright = motionPose(tuning, 'Idle', 0, ORIGIN);
    const flat = motionPose(lying, 'Idle', 0, ORIGIN);
    expect(dist(flat.blade.tip, flat.blade.hilt)).toBeCloseTo(dist(upright.blade.tip, upright.blade.hilt), 9);
    const lowered = motionPose(withIdle(tuning, { body: { tilt: 90, drop: 0.1 } }), 'Idle', 0, ORIGIN);
    expect(flat.joints.head.y - lowered.joints.head.y).toBeCloseTo(0.1, 9);
    expect(flat.blade.tip.y - lowered.blade.tip.y).toBeCloseTo(0.1, 9);
  });

  it('tilts about a raised pivot: at the pelvis height, the pelvis stays where it was and the rest rolls about it', () => {
    const upright = motionPose(tuning, 'Idle', 0, ORIGIN);
    const hips = upright.joints.pelvis.y;
    const rolled = motionPose(withIdle(tuning, { body: { tilt: 90, drop: 0, pivot: hips } }), 'Idle', 0, ORIGIN);
    expect(dist(rolled.joints.pelvis, upright.joints.pelvis)).toBeLessThan(1e-9);
    expect(rolled.joints.head.y).toBeCloseTo(hips, 1);
    expect(rolled.joints.head.z).toBeLessThan(rolled.joints.pelvis.z - 0.5);
    // A pivot of 0 is the ground point, as when it is absent.
    expect(hashValue(motionPose(withIdle(tuning, { body: { tilt: 90, drop: 0, pivot: 0 } }), 'Idle', 0, ORIGIN))).toBe(hashValue(motionPose(lying, 'Idle', 0, ORIGIN)));
  });

  it('blends the pivot between keys, and leaves it out where no key sets one', () => {
    const ankle = tuning.skeleton.ankleHeight;
    const a = sampleMotion(idleOf(lying), 0, tuning.skeleton);
    const b = sampleMotion(idleOf(withIdle(tuning, { body: { tilt: 40, drop: 0.2, pivot: 0.4 } })), 0, tuning.skeleton);
    expect(lerpTargets(a, b, 0.5, ankle).body).toEqual({ tilt: 65, drop: 0.1, pivot: 0.2 });
    expect(lerpTargets(a, a, 0.5, ankle).body).not.toHaveProperty('pivot');
  });

  it('makes both feet follow the Motion in the Gait', () => {
    const run = runDuel(lying, { placements: PLACEMENTS, a: walk(40, { x: 0, z: 1 }), b: wait(40), ticks: 40 });
    expect(run.events.some((e) => e.type === 'Step' && e.fighter === 0)).toBe(false);
  });
});

describe('without the channels', () => {
  it('leaves the pose bit-identical', () => {
    const weapon = defaultWeaponName(tuning);
    const targets = playbackTargets(tuning, weapon, { name: 'Idle', tick: 7 });
    expect(targets).not.toHaveProperty('kickFoot');
    expect(targets).not.toHaveProperty('body');
    const a = solveSkeleton(targets, tuning.skeleton, weaponByName(tuning, weapon), ORIGIN);
    const b = solveSkeleton({ ...targets, body: { tilt: 0, drop: 0 } }, tuning.skeleton, weaponByName(tuning, weapon), ORIGIN);
    expect(hashValue(b)).toBe(hashValue(a));
  });
});
