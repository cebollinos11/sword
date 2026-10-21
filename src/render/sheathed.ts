/**
 * Where a Sheathed Fighter's Weapon is drawn: in its slot on the body (Weapon `sheathe`), not in the hand. Render-only (ADR 0017): the
 * Simulation never reads it. The slot rides the pelvis (hip) or the chest (back), turning with the hips or the shoulders.
 */
import { rotateEuler, type BladeTransform, type SkeletonPose, type Vec3 } from '../sim';
import type { WeaponTuning } from '../tuning';

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/**
 * The Weapon in its slot on `pose`: the slot joint (the pelvis for the hip, the chest for the back) plus `sheathe.offset`, turned by
 * `sheathe.rotation`, both in that joint's frame (x right, y up, z forward, as a Pose Key: the hip's frame lies across the hips, the
 * back's across the shoulders, both standing up along the spine).
 */
export function sheathedBlade(pose: SkeletonPose, weapon: WeaponTuning): BladeTransform {
  const j = pose.joints;
  const { slot, offset, rotation } = weapon.sheathe;
  const across = unit(slot === 'hip' ? sub(j.rightHip, j.leftHip) : sub(j.rightShoulder, j.leftShoulder));
  const spine = sub(j.chest, j.pelvis);
  const along = spine.x * across.x + spine.y * across.y + spine.z * across.z;
  const up = unit({ x: spine.x - across.x * along, y: spine.y - across.y * along, z: spine.z - across.z * along });
  // The world is right-handed and the Fighter's frame mirrored into it (src/sim/skeleton.ts), so forward is up × right.
  const forward = { x: up.y * across.z - up.z * across.y, y: up.z * across.x - up.x * across.z, z: up.x * across.y - up.y * across.x };
  const toWorld = (v: Vec3): Vec3 => ({
    x: across.x * v.x + up.x * v.y + forward.x * v.z,
    y: across.y * v.x + up.y * v.y + forward.y * v.z,
    z: across.z * v.x + up.z * v.y + forward.z * v.z,
  });
  const origin = slot === 'hip' ? j.pelvis : j.chest;
  const o = toWorld(offset);
  const hilt = { x: origin.x + o.x, y: origin.y + o.y, z: origin.z + o.z };
  const axis = toWorld(rotateEuler({ x: 0, y: 0, z: 1 }, rotation));
  const tip = { x: hilt.x + axis.x * weapon.length, y: hilt.y + axis.y * weapon.length, z: hilt.z + axis.z * weapon.length };
  return { hilt, tip, edge: toWorld(rotateEuler({ x: 0, y: -1, z: 0 }, rotation)) };
}
