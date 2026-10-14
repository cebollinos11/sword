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
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

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
