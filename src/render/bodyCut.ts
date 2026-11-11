import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BladeTransform, JointName } from '../sim';
import type { Size, SkeletonTuning } from '../tuning';
import type { BodyModel } from './bodyModel';
import { BodyRig, type BodyBone } from './bodyRig';
import type { Pieces } from './dismember';
import { capOf, cutMesh, dropScraps, skinned, type CutPlan, type PieceMesh } from './meshCut';

/** The joint each bone of a Body model starts at and, for one that runs along a bone of the Skeleton, the joint it reaches. */
export const BONE_JOINTS: Record<BodyBone, readonly [JointName, JointName?]> = {
  hips: ['pelvis'],
  spine: ['pelvis', 'chest'],
  head: ['chest', 'head'],
  upperArm_L: ['leftShoulder', 'leftElbow'],
  forearm_L: ['leftElbow', 'leftHand'],
  hand_L: ['leftHand'],
  upperArm_R: ['rightShoulder', 'rightElbow'],
  forearm_R: ['rightElbow', 'rightHand'],
  hand_R: ['rightHand'],
  thigh_L: ['leftHip', 'leftKnee'],
  shin_L: ['leftKnee', 'leftAnkle'],
  foot_L: ['leftAnkle'],
  thigh_R: ['rightHip', 'rightKnee'],
  shin_R: ['rightKnee', 'rightAnkle'],
  foot_R: ['rightAnkle'],
};

/** The cut plane decides a vertex's piece within this many of the bone's girths of where it is cut. */
const REACH = 3;

/**
 * How a mesh skinned to the bones named `bones` is parted by a body in `pieces` (pure): each bone's piece is its first
 * joint's, and each severed bone of the Skeleton is the model's bone that runs along it. A bone the Skeleton does not
 * know stays with the pelvis.
 */
export function cutPlan(bones: readonly string[], pieces: Pieces): CutPlan {
  const joints = pieces.fellIn.joints;
  const cuts = pieces.severed.flatMap((s) => {
    const bone = bones.findIndex((name) => BONE_JOINTS[name as BodyBone]?.[0] === s.bone[0] && BONE_JOINTS[name as BodyBone]?.[1] === s.bone[1]);
    if (bone < 0) return [];
    const [a, b] = [joints[s.bone[0]], joints[s.bone[1]]];
    const along = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    // The plane's normal, turned toward the bone's far end.
    const toward = Math.sign(along.x * s.normal.x + along.y * s.normal.y + along.z * s.normal.z) || 1;
    const normal = { x: s.normal.x * toward, y: s.normal.y * toward, z: s.normal.z * toward };
    // The hips start where the spine does: a waist cut parts their vertices too.
    const beside = s.bone[0] === 'pelvis' ? [bones.indexOf('hips')].filter((i) => i >= 0) : [];
    return [{ bone, beside, at: s.at, normal, along: { x: along.x, y: along.y, z: along.z }, reach: s.girth * REACH, pieces: [pieces.piece[s.bone[0]], pieces.piece[s.bone[1]]] as const }];
  });
  return { pieceOfBone: bones.map((name) => pieces.piece[BONE_JOINTS[name as BodyBone]?.[0] ?? 'pelvis']), cuts, pieces: pieces.poses.length };
}

const identity = new THREE.Matrix4();

function geometryOf(piece: PieceMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(piece.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(piece.normal, 3));
  if (piece.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(piece.uv, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(piece.skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(piece.skinWeight, 4));
  geometry.setIndex(new THREE.BufferAttribute(piece.index, 1));
  return geometry;
}

/**
 * A skinned Body in pieces (Dismemberment): its model's meshes cut once (`meshCut.ts`), as they stood in the pose the
 * Fighter fell in, each piece on its own copy of the model's bones with flesh over its cut ends. A piece's vertices are
 * kept where they stood in that pose and bound to the bones as they stood then, so on the Death's Tick the pieces make
 * up exactly the whole body, and from then on each follows its own pose of the Death Ragdoll (`piecePoses`).
 */
export class BodyCut {
  /** Holds every piece; it stands in for the model's own root while the body is in pieces. */
  readonly root = new THREE.Group();
  private readonly rigs: BodyRig[] = [];
  private readonly owned: { dispose(): void }[] = [];

  /**
   * Cut `model` (of a Fighter of `size`, built for the Skeleton `built`) into `pieces`, their cut ends closed in `flesh`. It poses
   * the model's own rig in the pose the Fighter fell in, and leaves it so.
   */
  constructor(model: BodyModel, built: SkeletonTuning, pieces: Pieces, size: Size, flesh: THREE.Material) {
    model.rig.pose(pieces.fellIn.joints, pieces.fellIn.blade, size);
    const meshes: THREE.SkinnedMesh[] = [];
    model.root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) meshes.push(o);
    });
    // Every bone the meshes are skinned to, by name: one numbering for all of them (and the flesh).
    const names: string[] = [];
    const bones = new Map<string, THREE.Bone>();
    for (const mesh of meshes) {
      for (const bone of mesh.skeleton.bones) {
        if (bones.has(bone.name)) continue;
        bones.set(bone.name, bone);
        names.push(bone.name);
      }
    }
    const plan = cutPlan(names, pieces);
    const cut = meshes.map((mesh) => {
      mesh.skeleton.update();
      const g = mesh.geometry;
      const number = mesh.skeleton.bones.map((b) => names.indexOf(b.name));
      const skinIndex = Array.from(g.getAttribute('skinIndex').array as ArrayLike<number>, (i) => number[i] ?? 0);
      // Each bone's matrix as the shader applies it (bind matrix, bone, back out of the bind), in world space, under the shared numbering.
      const matrices = new Float32Array(16 * names.length);
      const m = new THREE.Matrix4();
      mesh.skeleton.bones.forEach((_, i) => {
        m.fromArray(mesh.skeleton.boneMatrices!, 16 * i).multiply(mesh.bindMatrix).premultiply(mesh.bindMatrixInverse).premultiply(mesh.matrixWorld);
        m.toArray(matrices, 16 * number[i]!);
      });
      const source = { position: g.getAttribute('position').array, normal: g.getAttribute('normal').array, skinIndex, skinWeight: g.getAttribute('skinWeight').array };
      return cutMesh({ ...skinned(source, matrices), uv: g.getAttribute('uv')?.array, skinIndex, skinWeight: source.skinWeight, index: g.index!.array }, plan);
    });
    // The bones as they stand now, in the pose the Fighter fell in: what every piece is bound to.
    const inverses = names.map((name) => bones.get(name)!.matrixWorld.clone().invert());
    for (let p = 0; p < plan.pieces; p++) {
      const parts = dropScraps(cut.map((c) => c[p]!), plan, p);
      const copy = clone(model.root);
      copy.visible = true;
      const skeleton = new THREE.Skeleton(names.map((name) => copy.getObjectByName(name) as THREE.Bone), inverses);
      this.owned.push(skeleton);
      const copies: THREE.SkinnedMesh[] = [];
      copy.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) copies.push(o);
      });
      const bind = (mesh: THREE.SkinnedMesh, piece: PieceMesh) => {
        mesh.geometry = geometryOf(piece);
        this.owned.push(mesh.geometry);
        mesh.bind(skeleton, identity);
      };
      copies.forEach((mesh, i) => {
        const piece = parts[i]!;
        // Nothing of this mesh in this piece.
        if (piece.index.length === 0) mesh.removeFromParent();
        else bind(mesh, piece);
      });
      const cap = capOf(parts, plan, p);
      if (cap) {
        const mesh = new THREE.SkinnedMesh(undefined, flesh);
        mesh.frustumCulled = false;
        copy.add(mesh);
        bind(mesh, cap);
      }
      this.rigs.push(new BodyRig(copy, built, model.rig));
      this.root.add(copy);
    }
  }

  /** Put every piece where its own pose of the Death Ragdoll in `pieces` has it (`blade`: the fall's Weapon, which a hand still on it grips). */
  pose(pieces: Pieces, blade: BladeTransform, size: Size): void {
    this.rigs.forEach((rig, p) => rig.pose((pieces.poses[p] ?? pieces.poses[0]!).joints, blade, size));
  }

  /** Free the pieces' geometry (their materials are the model's and the view's). */
  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
