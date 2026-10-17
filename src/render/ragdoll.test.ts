import { describe, expect, it } from 'vitest';
import { duelPlacements, fighterPose, createInitialState, type Death, type SkeletonPose, type Vec3 } from '../sim';
import { loadTuningData, weaponByName } from '../tuning';
import { ragdollPose } from './ragdoll';

const tuning = loadTuningData();
const fighter = createInitialState(tuning, 1, duelPlacements(2)).fighters[1]!; // at +z, facing -z
const pose = fighterPose(fighter, tuning);
const weapon = weaponByName(tuning, fighter.weapon);
/** An Overhead from the opponent, standing at -z. */
const death: Death = { tick: 10, cause: 'Hit', blow: { point: pose.joints.chest, bladeSpeed: 10, direction: 'Overhead', from: { x: 0, z: -1 } } };

const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lowest = (p: SkeletonPose) => Math.min(...Object.values(p.joints).map((j) => j.y), p.blade.tip.y, p.blade.hilt.y);

describe('Death Ragdoll', () => {
  it('starts from the pose the Fighter fell in', () => {
    expect(ragdollPose(pose, death, 0, weapon, tuning)).toEqual(pose);
  });

  it('is deterministic', () => {
    expect(ragdollPose(pose, death, 1.3, weapon, tuning)).toEqual(ragdollPose(pose, death, 1.3, weapon, tuning));
  });

  it('collapses onto the floor, knocked away from the attacker, and lies still', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    expect(lying.joints.head.y).toBeLessThan(0.3);
    expect(lying.joints.chest.y).toBeLessThan(0.3);
    expect(lowest(lying)).toBeGreaterThan(0);
    expect(lying.joints.head.z).toBeGreaterThan(pose.joints.head.z);
    expect(ragdollPose(pose, death, 10, weapon, tuning)).toEqual(ragdollPose(pose, death, 20, weapon, tuning));
  });

  it('keeps the bones whole', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    for (const [a, b] of [
      ['pelvis', 'chest'],
      ['leftHip', 'leftKnee'],
      ['rightElbow', 'rightHand'],
    ] as const)
      expect(d(lying.joints[a], lying.joints[b])).toBeCloseTo(d(pose.joints[a], pose.joints[b]), 1);
  });

  it('lets go of the Weapon, which keeps its length and falls on its own', () => {
    const lying = ragdollPose(pose, death, 3, weapon, tuning);
    expect(d(lying.blade.hilt, lying.blade.tip)).toBeCloseTo(d(pose.blade.hilt, pose.blade.tip), 1);
    expect(d(lying.blade.hilt, lying.joints.rightHand)).toBeGreaterThan(0.15);
    expect(Math.max(lying.blade.hilt.y, lying.blade.tip.y)).toBeLessThan(0.2);
  });
});
