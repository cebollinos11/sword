/**
 * Conversions between Pose Key channel values (Fighter-local, degrees) and
 * the world-space position/orientation of an Editor gizmo. The gizmo is
 * described by two world axes: `forward` (the blade, or the chest's facing)
 * and `up` (the blade's back, opposite its cutting edge). Pure math, no
 * three.js, so it is unit-tested; the Editor turns the axes into quaternions.
 */
import { rotateEuler, rotateX, rotateY, type Placement, type Vec3 } from '../sim';
import type { TorsoTarget } from '../tuning';

const DEG = 180 / Math.PI;

/** A Fighter-local direction in the world (local +x is the Fighter's right). */
export function dirToWorld(v: Vec3, at: Placement): Vec3 {
  const c = Math.cos(at.facing);
  const s = Math.sin(at.facing);
  return { x: -v.x * c + v.z * s, y: v.y, z: v.x * s + v.z * c };
}

/** A world direction in the Fighter-local frame (the mapping is its own inverse: a reflection). */
export function dirToLocal(v: Vec3, at: Placement): Vec3 {
  return dirToWorld(v, at);
}

export function localToWorld(v: Vec3, at: Placement): Vec3 {
  const d = dirToWorld(v, at);
  return { x: d.x + at.position.x, y: d.y, z: d.z + at.position.z };
}

export function worldToLocal(v: Vec3, at: Placement): Vec3 {
  return dirToLocal({ x: v.x - at.position.x, y: v.y, z: v.z - at.position.z }, at);
}

export interface GizmoAxes {
  readonly forward: Vec3;
  readonly up: Vec3;
}

/** `angle` plus whole turns, as close as possible to `near`. */
function unwrap(angle: number, near: number): number {
  return angle + 360 * Math.round((near - angle) / 360);
}

/** World gizmo axes for a sword hand rotation (Euler degrees, roll z then pitch x then yaw y). */
export function handGizmoAxes(rotation: Vec3, at: Placement): GizmoAxes {
  return {
    forward: dirToWorld(rotateEuler({ x: 0, y: 0, z: 1 }, rotation), at),
    up: dirToWorld(rotateEuler({ x: 0, y: 1, z: 0 }, rotation), at),
  };
}

/**
 * The sword hand rotation for gizmo axes. Of the equivalent Euler solutions
 * it returns the one nearest `near` (the value being edited), so dragging
 * never flips a Pose Key onto angles that would interpolate the long way round.
 */
export function handRotationFromGizmo(forward: Vec3, up: Vec3, at: Placement, near: Vec3): Vec3 {
  const f = dirToLocal(forward, at);
  const u = dirToLocal(up, at);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -f.y))) * DEG;
  const yaw = Math.atan2(f.x, f.z) * DEG;
  // Undo yaw then pitch; what is left of `up` is the roll about the blade.
  const r = rotateX(rotateY(u, -yaw), -pitch);
  const roll = Math.atan2(-r.x, r.y) * DEG;
  const candidates: Vec3[] = [
    { x: pitch, y: yaw, z: roll },
    { x: 180 - pitch, y: yaw + 180, z: roll + 180 },
  ].map((c) => ({ x: unwrap(c.x, near.x), y: unwrap(c.y, near.y), z: unwrap(c.z, near.z) }));
  const dist = (c: Vec3) => Math.abs(c.x - near.x) + Math.abs(c.y - near.y) + Math.abs(c.z - near.z);
  return dist(candidates[1]!) < dist(candidates[0]!) ? candidates[1]! : candidates[0]!;
}

/** World gizmo axes for a torso twist/lean (the spine: lean about x, then twist about y). */
export function torsoGizmoAxes(torso: TorsoTarget, at: Placement): GizmoAxes {
  const spine = (v: Vec3) => rotateY(rotateX(v, torso.lean), torso.twist);
  return { forward: dirToWorld(spine({ x: 0, y: 0, z: 1 }), at), up: dirToWorld(spine({ x: 0, y: 1, z: 0 }), at) };
}

/** Torso twist/lean from the chest gizmo's forward axis (any roll is dropped: the spine cannot roll). */
export function torsoFromGizmo(forward: Vec3, at: Placement, near: TorsoTarget): TorsoTarget {
  const f = dirToLocal(forward, at);
  return {
    twist: unwrap(Math.atan2(f.x, f.z) * DEG, near.twist),
    lean: Math.asin(Math.max(-1, Math.min(1, -f.y))) * DEG,
  };
}
