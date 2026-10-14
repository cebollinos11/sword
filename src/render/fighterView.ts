import * as THREE from 'three';
import { BONES, JOINT_NAMES, type BladeTransform, type JointName, type SkeletonPose, type Vec3 } from '../sim';
import type { TuningData } from '../tuning';

export const FIGHTER_COLOURS = [0xc0392b, 0x2e86c1];

const UP = new THREE.Vector3(0, 1, 0);

/** Bone thickness (radius, metres) by bone; anything unlisted is a limb. */
function boneRadius(a: JointName, b: JointName): number {
  if (a === 'pelvis' && b === 'chest') return 0.13;
  if (a === 'chest' && b === 'head') return 0.045;
  if (b === 'leftToe' || b === 'rightToe') return 0.04;
  return 0.05;
}

/**
 * A Fighter drawn from primitives: one flat-shaded colour, a cylinder per
 * Skeleton bone, a sphere per joint and a box blade. It only reads poses.
 */
export class FighterView {
  readonly root = new THREE.Group();
  private readonly bones: { mesh: THREE.Mesh; a: JointName; b: JointName }[] = [];
  private readonly joints = new Map<JointName, THREE.Mesh>();
  private readonly head: THREE.Mesh;
  private readonly blade: THREE.Mesh;
  private readonly crossguard: THREE.Mesh;

  constructor(colour: number, tuning: TuningData) {
    const body = new THREE.MeshLambertMaterial({ color: colour, flatShading: true });
    const steel = new THREE.MeshLambertMaterial({ color: 0xd0d4d8, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, flatShading: true });
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
    const sphere = new THREE.SphereGeometry(1, 10, 8);

    for (const [a, b] of BONES) {
      const mesh = new THREE.Mesh(cylinder, body);
      mesh.userData.radius = boneRadius(a, b);
      this.bones.push({ mesh, a, b });
      this.root.add(mesh);
    }
    for (const name of JOINT_NAMES) {
      if (name === 'head' || name === 'chest' || name === 'pelvis') continue;
      const mesh = new THREE.Mesh(sphere, body);
      mesh.scale.setScalar(0.055);
      this.joints.set(name, mesh);
      this.root.add(mesh);
    }
    this.head = new THREE.Mesh(sphere, body);
    this.head.scale.setScalar(tuning.skeleton.headRadius);
    this.root.add(this.head);

    this.blade = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
    this.crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.03), dark);
    this.root.add(this.blade, this.crossguard);
  }

  update(pose: SkeletonPose): void {
    const p = pose.joints;
    for (const { mesh, a, b } of this.bones) placeCylinder(mesh, p[a], p[b], mesh.userData.radius as number);
    for (const [name, mesh] of this.joints) mesh.position.set(p[name].x, p[name].y, p[name].z);
    this.head.position.set(p.head.x, p.head.y, p.head.z);
    placeBlade(this.blade, this.crossguard, pose.blade);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function placeCylinder(mesh: THREE.Mesh, a: Vec3, b: Vec3, radius: number): void {
  tmpA.set(a.x, a.y, a.z);
  tmpB.set(b.x, b.y, b.z);
  const len = tmpA.distanceTo(tmpB);
  mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  mesh.scale.set(radius, Math.max(len, 1e-4), radius);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, tmpB.sub(tmpA).divideScalar(len));
}

const basis = new THREE.Matrix4();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();

function placeBlade(blade: THREE.Mesh, crossguard: THREE.Mesh, b: BladeTransform): void {
  yAxis.set(b.tip.x - b.hilt.x, b.tip.y - b.hilt.y, b.tip.z - b.hilt.z);
  const len = yAxis.length();
  yAxis.divideScalar(len || 1);
  zAxis.set(b.edge.x, b.edge.y, b.edge.z); // the edge leads: blade width runs along it
  xAxis.crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  basis.makeBasis(xAxis, yAxis, zAxis);
  for (const m of [blade, crossguard]) m.quaternion.setFromRotationMatrix(basis);
  blade.scale.set(0.012, len, 0.045);
  blade.position.set((b.hilt.x + b.tip.x) / 2, (b.hilt.y + b.tip.y) / 2, (b.hilt.z + b.tip.z) / 2);
  crossguard.position.set(b.hilt.x, b.hilt.y, b.hilt.z).addScaledVector(yAxis, 0.08);
  crossguard.scale.set(1, 1, 1);
  crossguard.rotateY(Math.PI / 2);
}

/** Interpolate two solved poses (render-only smoothing between Ticks). */
export function lerpPose(a: SkeletonPose, b: SkeletonPose, t: number): SkeletonPose {
  const l = (u: Vec3, v: Vec3): Vec3 => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t, z: u.z + (v.z - u.z) * t });
  const joints = {} as Record<JointName, Vec3>;
  for (const n of JOINT_NAMES) joints[n] = l(a.joints[n], b.joints[n]);
  return { joints, blade: { hilt: l(a.blade.hilt, b.blade.hilt), tip: l(a.blade.tip, b.blade.tip), edge: l(a.blade.edge, b.blade.edge) } };
}
