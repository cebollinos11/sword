import * as THREE from 'three';
import type { BladeTransform, JointName, Vec3 } from '../sim';
import type { SkeletonTuning } from '../tuning';

/**
 * Drives a skinned Body model's bones from a solved Skeleton. The model's
 * bones run between the Skeleton's joints (art/build_female.py), so each bone
 * is placed at its joint and turned by however far its frame (its direction
 * plus a second axis that fixes its roll) has turned from the rest pose.
 */
export const BODY_BONES = [
  'hips',
  'spine',
  'head',
  'upperArm_L',
  'forearm_L',
  'hand_L',
  'upperArm_R',
  'forearm_R',
  'hand_R',
  'thigh_L',
  'shin_L',
  'foot_L',
  'thigh_R',
  'shin_R',
  'foot_R',
] as const;
export type BodyBone = (typeof BODY_BONES)[number];

type Joints = Readonly<Record<JointName, Vec3>>;

/** A bone's placement: where it starts and how it is turned (from the world axes). */
export interface BoneFrame {
  readonly origin: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
}

/** Toe reach in front of the ankle, as in src/sim/skeleton.ts. */
const TOE_LENGTH = 0.14;

/** How far (m) the middle of the hand is from the wrist, along it: where the models' mitt hands close on a grip. */
const FIST = 0.03;
/** A hand within this far (m) of the Weapon's axis has hold of it; it closes on it fully within GRIP_FULL. */
const GRIP_REACH = 0.05;
const GRIP_FULL = 0.01;

/**
 * The Skeleton in the models' rest pose: legs straight, arms straight out to
 * the sides, facing +z with the left side on +x (the game's facing 0).
 */
export function restJoints(s: SkeletonTuning): Record<JointName, Vec3> {
  const hipY = s.ankleHeight + s.shin + s.thigh;
  const chestY = hipY + s.spine;
  const shoulder = s.shoulderWidth / 2;
  const hip = s.hipWidth / 2;
  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  return {
    pelvis: v(0, hipY, 0),
    chest: v(0, chestY, 0),
    head: v(0, chestY + s.neck + s.headRadius, 0),
    leftShoulder: v(shoulder, chestY, 0),
    leftElbow: v(shoulder + s.upperArm, chestY, 0),
    leftHand: v(shoulder + s.upperArm + s.forearm, chestY, 0),
    rightShoulder: v(-shoulder, chestY, 0),
    rightElbow: v(-shoulder - s.upperArm, chestY, 0),
    rightHand: v(-shoulder - s.upperArm - s.forearm, chestY, 0),
    leftHip: v(hip, hipY, 0),
    leftKnee: v(hip, hipY - s.thigh, 0),
    leftAnkle: v(hip, s.ankleHeight, 0),
    leftToe: v(hip, 0, TOE_LENGTH),
    rightHip: v(-hip, hipY, 0),
    rightKnee: v(-hip, hipY - s.thigh, 0),
    rightAnkle: v(-hip, s.ankleHeight, 0),
    rightToe: v(-hip, 0, TOE_LENGTH),
  };
}

const vec = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const between = (a: Vec3, b: Vec3) => vec(b).sub(vec(a));
const basis = new THREE.Matrix4();

/** The rotation taking x to `along` and y toward `toward` (made perpendicular to it). */
function frame(along: THREE.Vector3, toward: THREE.Vector3): THREE.Quaternion {
  const x = along.clone().normalize();
  const y = toward.clone().addScaledVector(x, -toward.dot(x));
  if (y.lengthSq() < 1e-12) y.set(0, 1, 0).addScaledVector(x, -x.y);
  if (y.lengthSq() < 1e-12) y.set(0, 0, 1).addScaledVector(x, -x.z);
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(x, y, z));
}

/**
 * How a hand holding the Weapon is turned and placed: the Skeleton's hand joint is where the grip passes, so the fist
 * (not the wrist) goes there, its fingers wrapped round the grip square to the Weapon and its thumb toward the tip.
 * Null when the hand is not on the Weapon (a Throw's off hand, a sheathed Weapon) or it runs along the forearm.
 */
function gripFrame(side: 'L' | 'R', elbow: Vec3, hand: Vec3, blade: BladeTransform): { frame: BoneFrame; hold: number } | null {
  const axis = between(blade.hilt, blade.tip).normalize();
  const fromHilt = between(blade.hilt, hand);
  const offAxis = fromHilt.clone().addScaledVector(axis, -fromHilt.dot(axis)).length();
  const hold = THREE.MathUtils.clamp((GRIP_REACH - offAxis) / (GRIP_REACH - GRIP_FULL), 0, 1);
  if (hold === 0) return null;
  const forearm = between(elbow, hand).normalize();
  const fingers = forearm.clone().addScaledVector(axis, -forearm.dot(axis));
  if (fingers.lengthSq() < 1e-6) return null;
  fingers.normalize();
  // The models' hands, palm down with arms out (their rest pose), have the thumb along the bone frame's +y on the right
  // and -y on the left (see boneFrames' rest roll), so that axis is turned to point up the Weapon.
  const rotation = frame(fingers, side === 'R' ? axis : axis.clone().negate());
  return { frame: { origin: vec(hand).addScaledVector(fingers, -FIST), rotation }, hold };
}

/**
 * Every bone's frame for a solved Skeleton. Arms and legs take their roll from
 * the plane the IK bends them in (the same poles as src/sim/skeleton.ts), so a
 * straight limb keeps a steady roll; the hands follow the forearms, except one
 * holding `blade`, which grips it.
 */
export function boneFrames(j: Joints, blade?: BladeTransform): Record<BodyBone, BoneFrame> {
  const hipsLeft = between(j.rightHip, j.leftHip);
  const shoulderLeft = between(j.rightShoulder, j.leftShoulder).normalize();
  const spineUp = between(j.pelvis, j.chest).normalize();
  // A standing pelvis stays level however the spine leans; a fallen one (a Death Ragdoll) turns with the spine, so a body on its side keeps its legs' roll.
  const level = THREE.MathUtils.clamp((spineUp.y - 0.2) / 0.4, 0, 1);
  const up = spineUp.clone().lerp(new THREE.Vector3(0, 1, 0), level).normalize();
  const forward = new THREE.Vector3().crossVectors(hipsLeft, up).normalize();
  const chestForward = new THREE.Vector3().crossVectors(shoulderLeft, spineUp).normalize();

  const frames = {
    hips: { origin: vec(j.pelvis), rotation: frame(hipsLeft, up) },
    spine: { origin: vec(j.pelvis), rotation: frame(spineUp, shoulderLeft) },
    head: { origin: vec(j.chest), rotation: frame(between(j.chest, j.head), shoulderLeft) },
  } as Record<BodyBone, BoneFrame>;

  for (const [s, side, out] of [['L', 'left', 1], ['R', 'right', -1]] as const) {
    const shoulder = j[`${side}Shoulder`];
    const elbow = j[`${side}Elbow`];
    const hand = j[`${side}Hand`];
    const pole = shoulderLeft.clone().multiplyScalar(0.6 * out).sub(spineUp).addScaledVector(chestForward, -0.4);
    const hinge = new THREE.Vector3().crossVectors(between(shoulder, hand), pole);
    const forearm = frame(between(elbow, hand), hinge);
    frames[`upperArm_${s}`] = { origin: vec(shoulder), rotation: frame(between(shoulder, elbow), hinge) };
    frames[`forearm_${s}`] = { origin: vec(elbow), rotation: forearm };
    frames[`hand_${s}`] = { origin: vec(hand), rotation: forearm.clone() };
    const grip = blade && gripFrame(s, elbow, hand, blade);
    if (grip) {
      const f = frames[`hand_${s}`];
      f.origin.lerp(grip.frame.origin, grip.hold);
      f.rotation.slerp(grip.frame.rotation, grip.hold);
    }

    const hip = j[`${side}Hip`];
    const knee = j[`${side}Knee`];
    const ankle = j[`${side}Ankle`];
    const legHinge = new THREE.Vector3().crossVectors(between(hip, ankle), forward);
    frames[`thigh_${s}`] = { origin: vec(hip), rotation: frame(between(hip, knee), legHinge) };
    frames[`shin_${s}`] = { origin: vec(knee), rotation: frame(between(knee, ankle), legHinge) };
    frames[`foot_${s}`] = { origin: vec(ankle), rotation: frame(between(ankle, j[`${side}Toe`]), legHinge) };
  }
  return frames;
}

const desired = new THREE.Matrix4();
const parentInverse = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/** A loaded Body model's bones, posed from solved Skeletons. */
export class BodyRig {
  private readonly bones: { name: BodyBone; bone: THREE.Bone; turn: THREE.Quaternion }[];
  private readonly rest: Record<BodyBone, BoneFrame>;
  private readonly rotation = new THREE.Quaternion();

  /**
   * `model` is the model's scene in its bind pose, at the origin; `skeleton`
   * is the Skeleton's tuning the model was built for.
   */
  constructor(
    private readonly model: THREE.Object3D,
    skeleton: SkeletonTuning,
  ) {
    this.rest = boneFrames(restJoints(skeleton));
    model.updateMatrixWorld(true);
    const world = new THREE.Quaternion();
    this.bones = BODY_BONES.map((name) => {
      const bone = model.getObjectByName(name);
      if (!(bone instanceof THREE.Bone)) throw new Error(`Body model has no bone "${name}"`);
      bone.matrixWorld.decompose(new THREE.Vector3(), world, new THREE.Vector3());
      // The bone's own turn relative to its rest frame, kept as the frame moves.
      return { name, bone, turn: this.rest[name].rotation.clone().invert().multiply(world) };
    });
  }

  /** Put every bone where the solved Skeleton's joints are, the hands on `blade` gripping it. */
  pose(joints: Joints, blade?: BladeTransform): void {
    const frames = boneFrames(joints, blade);
    this.model.updateMatrixWorld(true);
    for (const { name, bone, turn } of this.bones) {
      const f = frames[name];
      this.rotation.copy(f.rotation).multiply(turn);
      desired.compose(f.origin, this.rotation, ONE);
      parentInverse.copy(bone.parent!.matrixWorld).invert();
      bone.matrix.multiplyMatrices(parentInverse, desired);
      bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      // Every bone's parent is a bone posed before it (or the static rig), so its world matrix is already `desired`: no walk down the children per bone.
      bone.matrixWorld.copy(desired);
    }
  }
}
