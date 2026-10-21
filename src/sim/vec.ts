/** 3D vector (metres). y is up. Plain data so it hashes and snapshots exactly. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/**
 * From `a` to `b` round `pivot`: the direction from the pivot turns along a great circle while the distance from it
 * changes linearly, so the point sweeps an arc about the pivot instead of cutting the chord. Falls back to `lerp`
 * where the arc is undefined (an end on the pivot, or the ends in line with it).
 */
export function arcLerp(a: Vec3, b: Vec3, pivot: Vec3, t: number): Vec3 {
  const da = sub(a, pivot);
  const db = sub(b, pivot);
  const la = length(da);
  const lb = length(db);
  if (la < 1e-9 || lb < 1e-9) return lerp(a, b, t);
  const cos = Math.min(Math.max(dot(da, db) / (la * lb), -1), 1);
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  if (sin < 1e-6) return lerp(a, b, t);
  // Slerp of the unit directions, scaled to the interpolated distance.
  const wa = Math.sin((1 - t) * angle) / sin / la;
  const wb = Math.sin(t * angle) / sin / lb;
  const r = la + (lb - la) * t;
  return add(pivot, scale(add(scale(da, wa), scale(db, wb)), r));
}

export function normalize(a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : fallback;
}

const DEG = Math.PI / 180;

/** Rotate about the x axis (pitch). Angles in degrees. */
export function rotateX(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

/** Rotate about the y axis (yaw). Angles in degrees. */
export function rotateY(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Rotate about the z axis (roll). Angles in degrees. */
export function rotateZ(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

/** Euler rotation in degrees, applied roll (z), then pitch (x), then yaw (y). */
export function rotateEuler(v: Vec3, e: Vec3): Vec3 {
  return rotateY(rotateX(rotateZ(v, e.z), e.x), e.y);
}
