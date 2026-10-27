import * as THREE from 'three';
import { arenaOf, BONES, fighterPose, JOINT_NAMES, TICK_SECONDS, type BladeTransform, type JointName, type SimState, type SkeletonPose, type Vec3 } from '../sim';
import { sizedTuning, weaponByName, type Size, type TuningData, type WeaponTuning } from '../tuning';
import { defaultBody, loadBodyModel, type Body, type BodyModel } from './bodyModel';
import { ragdollPose } from './ragdoll';
import { sheathedBlade } from './sheathed';
import { bladeSteel } from './steel';

export const FIGHTER_COLOURS = [0xc0392b, 0x2e86c1];

/** Each team's colours: red for team 0, blue for team 1, a different shade for each teammate (the first is FIGHTER_COLOURS'). */
export const TEAM_COLOURS: readonly (readonly number[])[] = [
  [0xc0392b, 0xe67e5c, 0x7b241c, 0xd35400],
  [0x2e86c1, 0x76c3ee, 0x1b4f72, 0x16a085],
];

/** The colour of a team's `k`-th Fighter (in Fighter order). */
export function teamColour(team: number, k: number): number {
  const shades = TEAM_COLOURS[team] ?? FIGHTER_COLOURS;
  return shades[k % shades.length]!;
}

/** Every Fighter's colour: its team's, shaded by its place among its teammates. */
export function fighterColours(teams: readonly number[]): number[] {
  return teams.map((team, i) => teamColour(team, teams.slice(0, i).filter((t) => t === team).length));
}

const UP = new THREE.Vector3(0, 1, 0);
const STANDARD: Size = { height: 1, thick: 1 };
/** Radius (m) of a joint's sphere on the bare Skeleton. */
const JOINT_RADIUS = 0.055;

/** Bone thickness (radius, metres) by bone; anything unlisted is a limb. */
function boneRadius(a: JointName, b: JointName): number {
  if (a === 'pelvis' && b === 'chest') return 0.13;
  if (a === 'chest' && b === 'head') return 0.045;
  if (b === 'leftToe' || b === 'rightToe') return 0.04;
  return 0.05;
}

/**
 * A Fighter drawn as its Body: the bare Skeleton from primitives (one
 * flat-shaded colour, a cylinder per bone, a sphere per joint), or a skinned
 * model whose bones follow the Skeleton, shown in place of the primitives once
 * it has loaded. Its Weapon is drawn to the Weapon's dimensions (a sword:
 * blade, crossguard, grip and pommel; a polearm: shaft, axe blade, spike and
 * back hook over the Head; a hammer: shaft and a rectangular head across the tip). It only reads poses.
 */
export class FighterView {
  readonly root = new THREE.Group();
  private readonly skeleton = new THREE.Group();
  private model: BodyModel | undefined;
  private readonly bones: { mesh: THREE.Mesh; a: JointName; b: JointName }[] = [];
  private readonly joints = new Map<JointName, THREE.Mesh>();
  private readonly head: THREE.Mesh;
  private readonly headRadius: number;
  private readonly sword: SwordMeshes;
  private readonly polearm: PolearmMeshes;
  private readonly hammer: HammerMeshes;

  constructor(colour: number, tuning: TuningData, wears: Body = defaultBody()) {
    const body = new THREE.MeshLambertMaterial({ color: colour, flatShading: true });
    const steel = bladeSteel();
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a5230, flatShading: true });
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    const box = new THREE.BoxGeometry(1, 1, 1);

    for (const [a, b] of BONES) {
      const mesh = new THREE.Mesh(cylinder, body);
      mesh.userData.radius = boneRadius(a, b);
      this.bones.push({ mesh, a, b });
      this.skeleton.add(mesh);
    }
    for (const name of JOINT_NAMES) {
      if (name === 'head' || name === 'chest' || name === 'pelvis') continue;
      const mesh = new THREE.Mesh(sphere, body);
      mesh.scale.setScalar(JOINT_RADIUS);
      this.joints.set(name, mesh);
      this.skeleton.add(mesh);
    }
    this.head = new THREE.Mesh(sphere, body);
    this.headRadius = tuning.skeleton.headRadius;
    this.head.scale.setScalar(this.headRadius);
    this.skeleton.add(this.head);
    this.root.add(this.skeleton);
    if (wears !== 'skeleton') {
      // Until it loads (or if it cannot), the Fighter is drawn as its Skeleton.
      loadBodyModel(wears, colour, tuning.skeleton).then(
        (model) => {
          this.model = model;
          this.skeleton.visible = false;
          this.root.add(model.root);
        },
        (e: unknown) => console.error(`Could not load the ${wears} Body model`, e),
      );
    }

    this.sword = {
      group: new THREE.Group(),
      blade: new THREE.Mesh(box, steel),
      crossguard: new THREE.Mesh(box, dark),
      grip: new THREE.Mesh(cylinder, dark),
      pommel: new THREE.Mesh(sphere, steel),
    };
    this.sword.group.add(this.sword.blade, this.sword.crossguard, this.sword.grip, this.sword.pommel);
    this.polearm = {
      group: new THREE.Group(),
      shaft: new THREE.Mesh(cylinder, wood),
      axe: new THREE.Mesh(box, steel),
      hook: new THREE.Mesh(box, steel),
      spike: new THREE.Mesh(new THREE.ConeGeometry(1, 1, 8), steel),
    };
    this.polearm.group.add(this.polearm.shaft, this.polearm.axe, this.polearm.hook, this.polearm.spike);
    this.hammer = {
      group: new THREE.Group(),
      shaft: new THREE.Mesh(cylinder, wood),
      head: new THREE.Mesh(box, steel),
      collar: new THREE.Mesh(cylinder, dark),
    };
    this.hammer.group.add(this.hammer.shaft, this.hammer.head, this.hammer.collar);
    this.root.add(this.sword.group, this.polearm.group, this.hammer.group);
  }

  /** Draw the body (Skeleton or model) at all; off leaves only the Weapon, e.g. for a picture of it. */
  set bodyVisible(on: boolean) {
    this.skeleton.visible = on && !this.model;
    if (this.model) this.model.root.visible = on;
  }

  /**
   * Draw a solved pose, holding `weapon` (the Fighter's Weapon from Tuning Data, at the Fighter's Size when it has one), in a body
   * `size` tall and thick (default: the standard body): limbs, joints and the head are drawn that much thicker.
   */
  update(pose: SkeletonPose, weapon: WeaponTuning, size: Size = STANDARD): void {
    const p = pose.joints;
    for (const { mesh, a, b } of this.bones) placeCylinder(mesh, p[a], p[b], (mesh.userData.radius as number) * size.thick);
    for (const [name, mesh] of this.joints) {
      mesh.position.set(p[name].x, p[name].y, p[name].z);
      mesh.scale.setScalar(JOINT_RADIUS * size.thick);
    }
    this.head.position.set(p.head.x, p.head.y, p.head.z);
    this.head.scale.setScalar(this.headRadius * size.height);
    this.model?.rig.pose(p, size);
    this.sword.group.visible = weapon.look === 'sword';
    this.polearm.group.visible = weapon.look === 'polearm';
    this.hammer.group.visible = weapon.look === 'hammer';
    if (weapon.look === 'polearm') placePolearm(this.polearm, pose.blade, weapon);
    else if (weapon.look === 'hammer') placeHammer(this.hammer, pose.blade, weapon);
    else placeSword(this.sword, pose.blade, weapon);
  }
}

interface SwordMeshes {
  readonly group: THREE.Group;
  readonly blade: THREE.Mesh;
  readonly crossguard: THREE.Mesh;
  readonly grip: THREE.Mesh;
  readonly pommel: THREE.Mesh;
}

interface PolearmMeshes {
  readonly group: THREE.Group;
  readonly shaft: THREE.Mesh;
  readonly axe: THREE.Mesh;
  readonly hook: THREE.Mesh;
  readonly spike: THREE.Mesh;
}

interface HammerMeshes {
  readonly group: THREE.Group;
  readonly shaft: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly collar: THREE.Mesh;
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
const orientation = new THREE.Quaternion();
const hilt = new THREE.Vector3();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();

/** The Weapon's frame (y: hand → tip, z: the edge, which leads), into `hilt`, the axes and `orientation`; returns its length. */
function weaponFrame(b: BladeTransform): number {
  hilt.set(b.hilt.x, b.hilt.y, b.hilt.z);
  yAxis.set(b.tip.x - b.hilt.x, b.tip.y - b.hilt.y, b.tip.z - b.hilt.z);
  const len = yAxis.length();
  yAxis.divideScalar(len || 1);
  zAxis.set(b.edge.x, b.edge.y, b.edge.z);
  xAxis.crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  basis.makeBasis(xAxis, yAxis, zAxis);
  orientation.setFromRotationMatrix(basis);
  return len;
}

/** Place a mesh in the Weapon's frame: centred `along` the axis from the hand and `out` along the edge, scaled `size` (frame x, y, z). */
function placeInFrame(mesh: THREE.Mesh, along: number, out: number, size: readonly [number, number, number]): void {
  mesh.quaternion.copy(orientation);
  mesh.position.copy(hilt).addScaledVector(yAxis, along).addScaledVector(zAxis, out);
  mesh.scale.set(size[0], size[1], size[2]);
}

/** Where the crossguard sits, in front of the sword hand (m). */
const GUARD = 0.07;

function placeSword(m: SwordMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  const blade = Math.max(len - GUARD, 0.01);
  placeInFrame(m.blade, GUARD + blade / 2, 0, [0.012, blade, 0.045]);
  placeInFrame(m.crossguard, GUARD, 0, [0.03, 0.025, 0.18]);
  const grip = w.gripLength + GUARD;
  placeInFrame(m.grip, GUARD - grip / 2, 0, [0.016, grip, 0.016]);
  placeInFrame(m.pommel, -w.gripLength, 0, [0.028, 0.028, 0.028]);
}

function placePolearm(m: PolearmMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  const spike = Math.min(0.18, w.head * 0.5);
  const shaft = w.gripLength + len - spike;
  placeInFrame(m.shaft, -w.gripLength + shaft / 2, 0, [0.018, shaft, 0.018]);
  placeInFrame(m.spike, len - spike / 2, 0, [0.02, spike, 0.02]);
  // The axe blade leads on the edge side, below the spike; the hook juts out behind it.
  const axe = Math.max(w.head - spike, 0.05) * 0.8;
  const at = len - spike - axe / 2;
  placeInFrame(m.axe, at, 0.09, [0.01, axe, 0.16]);
  placeInFrame(m.hook, at, -0.06, [0.01, 0.04, 0.12]);
}

function placeHammer(m: HammerMeshes, b: BladeTransform, w: WeaponTuning): void {
  const len = weaponFrame(b);
  // The head is a steel block across the tip, its long side along the edge (the faces strike); the shaft runs into it.
  const head = Math.max(w.head, 0.05);
  placeInFrame(m.shaft, (len - w.gripLength) / 2, 0, [0.02, len + w.gripLength, 0.02]);
  placeInFrame(m.head, len - head / 2, 0, [head * 0.85, head, head * 2.4]);
  placeInFrame(m.collar, len - head - 0.04, 0, [0.026, 0.08, 0.026]);
}

/** Interpolate two solved poses (render-only smoothing between Ticks). */
export function lerpPose(a: SkeletonPose, b: SkeletonPose, t: number): SkeletonPose {
  const l = (u: Vec3, v: Vec3): Vec3 => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t, z: u.z + (v.z - u.z) * t });
  const joints = {} as Record<JointName, Vec3>;
  for (const n of JOINT_NAMES) joints[n] = l(a.joints[n], b.joints[n]);
  return { joints, blade: { hilt: l(a.blade.hilt, b.blade.hilt), tip: l(a.blade.tip, b.blade.tip), edge: l(a.blade.edge, b.blade.edge) } };
}

/**
 * The pose to draw for Fighter `i` a share `alpha` of the way from Tick `from` to Tick `to` (the same Duel):
 * its solved Skeletons interpolated, or once it has fallen, its Death Ragdoll at that moment. While it is Sheathed (as of `to`),
 * the Weapon is in its slot on the body, not in the hand (ADR 0017: only drawing moves it there).
 */
export function drawnPose(from: SimState, to: SimState, i: number, alpha: number, tuning: TuningData): SkeletonPose {
  const f = to.fighters[i]!;
  const sized = sizedTuning(tuning, f.size);
  const weapon = weaponByName(sized, f.weapon);
  if (f.death) {
    const ticks = from.tick + (to.tick - from.tick) * alpha - f.death.tick;
    return ragdollPose(fighterPose(f, tuning), f.death, ticks * TICK_SECONDS, weapon, sized, arenaOf(tuning, to.arena), f.sheathed);
  }
  const pose = lerpPose(fighterPose(from.fighters[i] ?? f, tuning), fighterPose(f, tuning), alpha);
  return f.sheathed ? { ...pose, blade: sheathedBlade(pose, weapon) } : pose;
}
