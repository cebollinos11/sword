import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createInitialState, duelPlacements, fighterPose, type JointName, type Vec3 } from '../sim';
import { loadTuningData } from '../tuning';
import { BODY_BONES, BodyRig, restJoints, type BodyBone } from './bodyRig';

const tuning = loadTuningData();
const rest = restJoints(tuning.skeleton);

/** Each bone: its parent, the joint it starts at, and the joint its far end reaches. */
const LAYOUT: Record<BodyBone, [BodyBone | null, JointName, JointName]> = {
  hips: [null, 'pelvis', 'pelvis'],
  spine: ['hips', 'pelvis', 'chest'],
  head: ['spine', 'chest', 'head'],
  upperArm_L: ['spine', 'leftShoulder', 'leftElbow'],
  forearm_L: ['upperArm_L', 'leftElbow', 'leftHand'],
  hand_L: ['forearm_L', 'leftHand', 'leftHand'],
  upperArm_R: ['spine', 'rightShoulder', 'rightElbow'],
  forearm_R: ['upperArm_R', 'rightElbow', 'rightHand'],
  hand_R: ['forearm_R', 'rightHand', 'rightHand'],
  thigh_L: ['hips', 'leftHip', 'leftKnee'],
  shin_L: ['thigh_L', 'leftKnee', 'leftAnkle'],
  foot_L: ['shin_L', 'leftAnkle', 'leftToe'],
  thigh_R: ['hips', 'rightHip', 'rightKnee'],
  shin_R: ['thigh_R', 'rightKnee', 'rightAnkle'],
  foot_R: ['shin_R', 'rightAnkle', 'rightToe'],
};

/** A stand-in for a loaded model: bones at the rest joints, each turned its own arbitrary way (as an exporter might). */
function model(): THREE.Object3D {
  const root = new THREE.Group();
  const bones = new Map<BodyBone, THREE.Bone>();
  BODY_BONES.forEach((name, i) => {
    const bone = new THREE.Bone();
    bone.name = name;
    const parent = LAYOUT[name][0];
    (parent ? bones.get(parent)! : root).add(bone);
    root.updateMatrixWorld(true);
    const at = rest[LAYOUT[name][1]];
    const world = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, at.y, at.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(i * 0.3, i * 0.7, -i * 0.2)),
      new THREE.Vector3(1, 1, 1),
    );
    bone.matrix.copy(bone.parent!.matrixWorld).invert().multiply(world);
    bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    bones.set(name, bone);
  });
  root.updateMatrixWorld(true);
  return root;
}

const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** Where each bone's far end goes, carried in its own local frame from the rest pose. */
function posedEnds(joints: Record<JointName, Vec3>): Map<BodyBone, { start: THREE.Vector3; end: THREE.Vector3 }> {
  const root = model();
  const ends = new Map<BodyBone, THREE.Vector3>();
  for (const name of BODY_BONES) ends.set(name, root.getObjectByName(name)!.worldToLocal(v(rest[LAYOUT[name][2]])));
  new BodyRig(root, tuning.skeleton).pose(joints);
  const out = new Map<BodyBone, { start: THREE.Vector3; end: THREE.Vector3 }>();
  for (const name of BODY_BONES) {
    const bone = root.getObjectByName(name)!;
    out.set(name, { start: bone.getWorldPosition(new THREE.Vector3()), end: bone.localToWorld(ends.get(name)!.clone()) });
  }
  return out;
}

describe('Body rig', () => {
  it('leaves a model in its rest pose when the Skeleton is in the rest pose', () => {
    const root = model();
    const before = BODY_BONES.map((n) => root.getObjectByName(n)!.matrixWorld.clone());
    new BodyRig(root, tuning.skeleton).pose(rest);
    BODY_BONES.forEach((n, i) => {
      const after = root.getObjectByName(n)!.matrixWorld.elements;
      after.forEach((e, k) => expect(e).toBeCloseTo(before[i]!.elements[k]!, 6));
    });
  });

  it.each([0, 1])('puts every bone on its joints in a solved pose (Fighter %i)', (i) => {
    const fighter = createInitialState(tuning, 1, duelPlacements(2)).fighters[i]!;
    const joints = fighterPose(fighter, tuning).joints;
    for (const [name, { start, end }] of posedEnds(joints)) {
      const [, from, to] = LAYOUT[name];
      expect(start.distanceTo(v(joints[from])), `${name} start`).toBeLessThan(1e-6);
      if (from !== to) expect(end.distanceTo(v(joints[to])), `${name} end`).toBeLessThan(1e-6);
    }
  });

  it('turns the torso with the shoulders, so a twist reaches the model', () => {
    const twist = (p: Vec3): Vec3 => ({ x: p.x * Math.cos(0.5) + p.z * Math.sin(0.5), y: p.y, z: -p.x * Math.sin(0.5) + p.z * Math.cos(0.5) });
    const joints = { ...rest };
    for (const j of ['chest', 'head', 'leftShoulder', 'leftElbow', 'leftHand', 'rightShoulder', 'rightElbow', 'rightHand'] as const) {
      joints[j] = twist(rest[j]);
    }
    const root = model();
    const spine = root.getObjectByName('spine')!;
    const frontOfChest = spine.worldToLocal(new THREE.Vector3(0, rest.chest.y - 0.1, 0.1));
    new BodyRig(root, tuning.skeleton).pose(joints);
    const moved = spine.localToWorld(frontOfChest);
    const expected = twist({ x: 0, y: rest.chest.y - 0.1, z: 0.1 });
    expect(moved.distanceTo(v(expected))).toBeLessThan(1e-6);
  });
});
