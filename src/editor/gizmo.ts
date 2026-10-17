/**
 * 3D gizmos for the selected Pose Key: a handle per Skeleton target (sword
 * hand, left hand, torso, hip, feet) and a three.js TransformControls on the
 * chosen one. Dragging writes the target back into the Motion draft (turning
 * the channel on for that Pose Key if it was only inherited) and calls
 * `onEdit`, which commits it so the live preview follows the drag.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Placement, SkeletonPose, Vec3 } from '../sim';
import type { PoseKeyChannel, SkeletonTuning } from '../tuning';
import { handGizmoAxes, handRotationFromGizmo, localToWorld, torsoFromGizmo, torsoGizmoAxes, worldToLocal, type GizmoAxes } from './gizmoMath';
import { channelValueAt, setChannel } from './motionEdit';
import type { MotionDraft } from './session';

export const GIZMO_TARGETS = ['swordHand', 'swordAngle', 'leftHand', 'torso', 'hip', 'leftFoot', 'rightFoot', 'kickFoot'] as const;
export type GizmoTarget = (typeof GIZMO_TARGETS)[number];

export const GIZMO_LABELS: Record<GizmoTarget, string> = {
  swordHand: 'sword hand (move)',
  swordAngle: 'sword angle (rotate)',
  leftHand: 'left hand',
  torso: 'torso (twist/lean)',
  hip: 'hip',
  leftFoot: 'left foot',
  rightFoot: 'right foot',
  kickFoot: 'kick foot (right ankle)',
};

const CHANNEL: Record<GizmoTarget, PoseKeyChannel> = {
  swordHand: 'rightHand',
  swordAngle: 'rightHand',
  leftHand: 'leftHand',
  torso: 'torso',
  hip: 'hip',
  leftFoot: 'leftFoot',
  rightFoot: 'rightFoot',
  kickFoot: 'kickFoot',
};

/** Targets with a clickable handle (the sword angle shares the sword hand's). */
const HANDLE_TARGETS: GizmoTarget[] = ['swordHand', 'leftHand', 'torso', 'hip', 'leftFoot', 'rightFoot', 'kickFoot'];
const SET_COLOUR = new THREE.Color(0xffd60a);
const INHERITED_COLOUR = new THREE.Color(0x8e8e93);
const ACTIVE_COLOUR = new THREE.Color(0x30d158);

const round = (v: number, step: number) => Math.round(v / step) * step;
const roundVec = (v: Vec3, step: number): Vec3 => ({ x: +round(v.x, step).toFixed(4), y: +round(v.y, step).toFixed(4), z: +round(v.z, step).toFixed(4) });

export interface GizmoContext {
  draft: MotionDraft;
  /** Index of the selected Pose Key. */
  key: number;
  /** The previewed pose at that key's time (for the chest position). */
  pose: SkeletonPose;
}

export class PoseGizmo {
  readonly root = new THREE.Group();
  readonly controls: TransformControls;
  private readonly proxy = new THREE.Object3D();
  private readonly handles = new Map<GizmoTarget, THREE.Mesh>();
  private ctx: GizmoContext | undefined;
  target: GizmoTarget = 'swordHand';
  dragging = false;

  constructor(
    camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    private readonly skeleton: SkeletonTuning,
    private readonly at: Placement,
    /** `channelAdded`: the drag turned the channel on for this Pose Key (field layout changed). */
    private readonly onEdit: (channelAdded: boolean) => void,
    private readonly onTargetPicked: (t: GizmoTarget) => void,
  ) {
    this.controls = new TransformControls(camera, canvas);
    this.controls.setSize(0.7);
    this.root.add(this.proxy, this.controls.getHelper());
    const geo = new THREE.SphereGeometry(0.035, 12, 8);
    for (const t of HANDLE_TARGETS) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: INHERITED_COLOUR, depthTest: false, transparent: true, opacity: 0.9 }));
      m.renderOrder = 10;
      m.userData.target = t;
      this.handles.set(t, m);
      this.root.add(m);
    }
    this.controls.addEventListener('dragging-changed', (e) => (this.dragging = e.value as boolean));
    this.controls.addEventListener('objectChange', () => this.writeBack());
    this.installPicking(camera);
    this.setContext(undefined);
  }

  /** Show the gizmo for a Pose Key (or hide everything when no key is selected). */
  setContext(ctx: GizmoContext | undefined): void {
    this.ctx = ctx;
    const visible = ctx !== undefined;
    for (const h of this.handles.values()) h.visible = visible;
    this.controls.enabled = visible;
    this.controls.getHelper().visible = visible;
    if (visible) this.controls.attach(this.proxy);
    else this.controls.detach();
    this.sync();
  }

  /** Follow the previewed pose (the chest moves with the torso and hip). */
  setPose(pose: SkeletonPose): void {
    if (this.ctx) this.ctx.pose = pose;
    this.sync();
  }

  setTarget(t: GizmoTarget): void {
    this.target = t;
    this.sync();
  }

  /** Move the handles and the gizmo to the draft's current values (skipped mid-drag). */
  sync(): void {
    const ctx = this.ctx;
    if (!ctx || this.dragging) return;
    const key = ctx.draft.poseKeys[ctx.key];
    if (!key) return;
    for (const [t, h] of this.handles) {
      h.position.copy(this.worldPosition(t, ctx));
      const set = key[CHANNEL[t]] !== undefined;
      const active = t === this.target || (t === 'swordHand' && this.target === 'swordAngle');
      (h.material as THREE.MeshBasicMaterial).color.copy(active ? ACTIVE_COLOUR : set ? SET_COLOUR : INHERITED_COLOUR);
    }
    const rotate = this.target === 'swordAngle' || this.target === 'torso';
    this.controls.setMode(rotate ? 'rotate' : 'translate');
    this.controls.setSpace(rotate ? 'local' : 'world');
    const foot = this.target === 'leftFoot' || this.target === 'rightFoot';
    this.controls.showY = !foot;
    this.proxy.position.copy(this.worldPosition(this.target, ctx));
    if (this.target === 'swordAngle') this.setAxes(handGizmoAxes(this.value(ctx, 'rightHand').rotation, this.at));
    else if (this.target === 'torso') this.setAxes(torsoGizmoAxes(this.value(ctx, 'torso'), this.at));
    else this.proxy.quaternion.identity();
    this.proxy.updateMatrixWorld();
  }

  /** The channel's value on the selected key, or what it inherits there. */
  private value<C extends PoseKeyChannel>(ctx: GizmoContext, c: C) {
    const key = ctx.draft.poseKeys[ctx.key]!;
    return (key[c] as ReturnType<typeof channelValueAt<C>> | undefined) ?? channelValueAt(ctx.draft, c, key.time, this.skeleton);
  }

  private worldPosition(t: GizmoTarget, ctx: GizmoContext): THREE.Vector3 {
    let p: Vec3;
    switch (t) {
      case 'swordHand':
      case 'swordAngle':
        p = localToWorld(this.value(ctx, 'rightHand').position, this.at);
        break;
      case 'leftHand':
        p = localToWorld(this.value(ctx, 'leftHand').position, this.at);
        break;
      case 'torso':
        p = ctx.pose.joints.chest;
        break;
      case 'hip':
        p = localToWorld(this.value(ctx, 'hip'), this.at);
        break;
      case 'leftFoot':
      case 'rightFoot': {
        const f = this.value(ctx, t);
        p = localToWorld({ x: f.x, y: this.skeleton.ankleHeight, z: f.z }, this.at);
        break;
      }
      case 'kickFoot':
        p = localToWorld(this.value(ctx, 'kickFoot'), this.at);
        break;
    }
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  private setAxes(a: GizmoAxes): void {
    const z = new THREE.Vector3(a.forward.x, a.forward.y, a.forward.z);
    const y = new THREE.Vector3(a.up.x, a.up.y, a.up.z);
    const x = new THREE.Vector3().crossVectors(y, z);
    this.proxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  private writeBack(): void {
    const ctx = this.ctx;
    if (!ctx || !this.dragging) return;
    const channel = CHANNEL[this.target];
    const key = ctx.draft.poseKeys[ctx.key]!;
    const added = key[channel] === undefined;
    setChannel(ctx.draft, ctx.key, channel, true, this.skeleton);
    const pos = worldToLocal({ x: this.proxy.position.x, y: this.proxy.position.y, z: this.proxy.position.z }, this.at);
    const axis = (v: THREE.Vector3): Vec3 => {
      const w = v.applyQuaternion(this.proxy.quaternion);
      return { x: w.x, y: w.y, z: w.z };
    };
    switch (this.target) {
      case 'swordHand':
        Object.assign(key.rightHand!.position, roundVec(pos, 0.001));
        break;
      case 'swordAngle':
        Object.assign(
          key.rightHand!.rotation,
          roundVec(handRotationFromGizmo(axis(new THREE.Vector3(0, 0, 1)), axis(new THREE.Vector3(0, 1, 0)), this.at, key.rightHand!.rotation), 0.1),
        );
        break;
      case 'leftHand':
        Object.assign(key.leftHand!.position, roundVec(pos, 0.001));
        break;
      case 'torso': {
        const t = torsoFromGizmo(axis(new THREE.Vector3(0, 0, 1)), this.at, key.torso!);
        Object.assign(key.torso!, { twist: +round(t.twist, 0.1).toFixed(1), lean: +round(t.lean, 0.1).toFixed(1) });
        break;
      }
      case 'hip':
        Object.assign(key.hip!, roundVec(pos, 0.001));
        break;
      case 'leftFoot':
      case 'rightFoot': {
        const r = roundVec(pos, 0.001);
        Object.assign(key[this.target]!, { x: r.x, z: r.z });
        break;
      }
      case 'kickFoot':
        Object.assign(key.kickFoot!, roundVec(pos, 0.001));
        break;
    }
    this.onEdit(added);
  }

  /** Clicking a handle picks that target (when not clicking the gizmo itself). */
  private installPicking(camera: THREE.Camera): void {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.ctx || this.dragging || this.controls.axis !== null) return;
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([...this.handles.values()], false)[0];
      if (!hit) return;
      const t = hit.object.userData.target as GizmoTarget;
      // Clicking the sword hand again toggles between moving and rotating it.
      const next = t === 'swordHand' && this.target === 'swordHand' ? 'swordAngle' : t;
      this.setTarget(next);
      this.onTargetPicked(next);
    });
  }
}
