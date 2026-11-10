import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createInitialState, duelPlacements, fighterPose, type DeathBlow, type JointName } from '../sim';
import { loadTuningData, weaponByName } from '../tuning';
import { BodyCut, cutPlan } from './bodyCut';
import { BODY_BONES, BodyRig, restJoints, type BodyBone } from './bodyRig';
import { piecesOfFall, severing, type Pieces } from './dismember';
import { ragdollPose } from './ragdoll';

const tuning = loadTuningData();
const rest = restJoints(tuning.skeleton);
const fighter = createInitialState(tuning, 1, duelPlacements(2)).fighters[1]!;
/** Standing at +z, facing -z. */
const pose = fighterPose(fighter, tuning);
const weapon = weaponByName(tuning, fighter.weapon);
const STANDARD = { height: 1, thick: 1 };

/** A level swing through the waist, the blade going toward +x. */
const waist: DeathBlow = (() => {
  const y = (pose.joints.pelvis.y + pose.joints.chest.y) / 2;
  return { point: { x: -0.3, y, z: 1.05 }, bladeSpeed: tuning.fighter.dismember.speed, direction: 'Right', from: { x: 0, z: -1 }, cut: { hilt: { x: -0.3, y, z: 0.3 }, tip: { x: -0.3, y, z: 1.15 }, travel: { x: 1, y: 0, z: 0 } } };
})();

/** The body in pieces `seconds` after that blow felled it. */
function fallen(seconds: number): Pieces {
  const severed = severing(pose, waist, tuning).filter((s) => s.bone[0] === 'pelvis');
  const fall = ragdollPose(pose, { tick: 0, cause: 'Hit', blow: waist }, seconds, weapon, tuning, undefined, false, severed);
  return piecesOfFall(pose, fall, severed, tuning);
}

/** Each bone's parent and the joint it starts at. */
const LAYOUT: Record<BodyBone, [BodyBone | null, JointName]> = {
  hips: [null, 'pelvis'],
  spine: ['hips', 'pelvis'],
  head: ['spine', 'chest'],
  upperArm_L: ['spine', 'leftShoulder'],
  forearm_L: ['upperArm_L', 'leftElbow'],
  hand_L: ['forearm_L', 'leftHand'],
  upperArm_R: ['spine', 'rightShoulder'],
  forearm_R: ['upperArm_R', 'rightElbow'],
  hand_R: ['forearm_R', 'rightHand'],
  thigh_L: ['hips', 'leftHip'],
  shin_L: ['thigh_L', 'leftKnee'],
  foot_L: ['shin_L', 'leftAnkle'],
  thigh_R: ['hips', 'rightHip'],
  shin_R: ['thigh_R', 'rightKnee'],
  foot_R: ['shin_R', 'rightAnkle'],
};

/**
 * A stand-in for a loaded model: bones at the rest joints, and one skinned mesh, a square tube up the trunk from below
 * the pelvis to the head, on the hips below the pelvis, the spine above it and the head above the chest.
 */
function model(): { root: THREE.Object3D; rig: BodyRig } {
  const root = new THREE.Group();
  const bones: THREE.Bone[] = [];
  for (const name of BODY_BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const parent = LAYOUT[name][0];
    (parent ? bones[BODY_BONES.indexOf(parent)]! : root).add(bone);
    root.updateMatrixWorld(true);
    const at = rest[LAYOUT[name][1]];
    bone.position.copy(bone.parent!.worldToLocal(new THREE.Vector3(at.x, at.y, at.z)));
    bones.push(bone);
  }
  root.updateMatrixWorld(true);
  const position: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  const rings = 12;
  const [low, high] = [rest.pelvis.y - 0.15, rest.head.y];
  for (let r = 0; r <= rings; r++) {
    const y = low + ((high - low) * r) / rings;
    for (const [x, z] of [[0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1], [0.1, -0.1]] as const) {
      position.push(x, y, z);
      skinIndex.push(y < rest.pelvis.y ? 0 : y < rest.chest.y ? 1 : 2, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < 4; a++) {
      const [p, q] = [4 * r + a, 4 * r + ((a + 1) % 4)];
      index.push(p, q, p + 4, q, q + 4, p + 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  root.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));
  return { root, rig: new BodyRig(root, tuning.skeleton) };
}

/** Every vertex of every mesh under `root`, where its bones put it now. */
function drawn(root: THREE.Object3D): THREE.Vector3[][] {
  root.updateMatrixWorld(true);
  const meshes: THREE.Vector3[][] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.skeleton.update();
    meshes.push(Array.from({ length: o.geometry.getAttribute('position').count }, (_, v) => o.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(o.matrixWorld)));
  });
  return meshes;
}

describe('cutPlan', () => {
  it('parts the bones as the Skeleton is parted, the severed bone cut toward its far end', () => {
    const pieces = fallen(0);
    const plan = cutPlan(BODY_BONES, pieces);
    expect(plan.pieces).toBe(2);
    expect(plan.cuts).toHaveLength(1);
    const [cut] = plan.cuts;
    expect(BODY_BONES[cut!.bone]).toBe('spine');
    expect(cut!.beside!.map((b) => BODY_BONES[b])).toEqual(['hips']);
    expect(cut!.pieces).toEqual([pieces.piece.pelvis, pieces.piece.chest]);
    expect(cut!.normal.y).toBeGreaterThan(0.9);
    expect(cut!.along.y).toBeGreaterThan(0.9);
    BODY_BONES.forEach((name, b) => expect(plan.pieceOfBone[b]).toBe(pieces.piece[LAYOUT[name][1]]));
    // A bone the Skeleton does not know stays with the pelvis.
    expect(cutPlan(['tail'], pieces).pieceOfBone).toEqual([0]);
  });
});

describe('BodyCut', () => {
  it('makes up the whole body on the Tick of the Death, then lets each piece follow its own pose', () => {
    const whole = model();
    const pieces = fallen(0);
    const flesh = new THREE.MeshBasicMaterial();
    const cut = new BodyCut(whole, tuning.skeleton, pieces, STANDARD, flesh);
    // The model itself, left in the pose it fell in: every vertex of the pieces that came from it is where it was.
    const before = drawn(whole.root)[0]!;
    expect(cut.root.children).toHaveLength(2);
    cut.pose(pieces, pose.blade, STANDARD);
    const meshes: THREE.SkinnedMesh[] = [];
    cut.root.traverse((o) => o instanceof THREE.SkinnedMesh && meshes.push(o));
    // Each piece: its part of the tube, and the flesh over its cut end.
    expect(meshes.map((m) => m.material === flesh)).toEqual([false, true, false, true]);
    const at = drawn(cut.root);
    meshes.forEach((mesh, m) => {
      const posed = mesh.geometry.getAttribute('position');
      at[m]!.forEach((p, v) => expect(p.distanceTo(new THREE.Vector3().fromBufferAttribute(posed, v))).toBeLessThan(1e-4));
    });
    const lowest = Math.min(...at[2]!.map((p) => p.y));
    for (const p of before) expect(at.flat().some((q) => q.distanceTo(p) < 1e-4)).toBe(true);

    // A second later the chest's piece has fallen away from where it was cut, and the hips' piece lies apart from it.
    const later = fallen(1);
    cut.pose(later, later.poses[0]!.blade, STANDARD);
    const after = drawn(cut.root);
    expect(Math.min(...after[2]!.map((p) => p.y))).toBeLessThan(lowest - 0.3);
    // Each piece moved as its own bones did: no vertex left behind with another piece (nothing stretches).
    for (const m of [0, 2]) {
      const span = (ps: THREE.Vector3[]) => Math.max(...ps.map((p) => p.distanceTo(ps[0]!)));
      expect(span(after[m]!)).toBeLessThan(span(at[m]!) + 0.05);
    }
    cut.dispose();
  });
});
