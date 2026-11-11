/**
 * The Blade Sweep: the volume the blade traces between two consecutive Ticks.
 * It is sampled as the straight paths of points spread along the blade (main
 * hand to tip), from last Tick's blade to this Tick's. A path that passes
 * within a capsule's radius of its axis is a contact.
 */
import { TICK_SECONDS } from './constants';
import type { BladeTransform } from './skeleton';
import { length, lerp, sub, type Vec3 } from './vec';

/** Most spacing (m) between points sampled along the blade: it must stay below the thinnest Hit Zone's diameter. */
const MAX_SAMPLE_SPACING = 0.075;

/** How many points are sampled along a blade `length` long (hilt and tip included), so spacing never exceeds MAX_SAMPLE_SPACING. */
export function bladeSamples(length: number): number {
  return Math.max(2, Math.ceil(length / MAX_SAMPLE_SPACING - 1e-9) + 1);
}

/** Anything a Blade Sweep can touch: all points within `radius` of the segment a→b (a Hit Zone, or a Blocking blade). */
export interface Capsule {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radius: number;
}

export interface SweepContact<C extends Capsule = Capsule> {
  readonly capsule: C;
  /** World-space contact point. */
  readonly point: Vec3;
  /** Speed of the blade at the contact point, m/s. */
  readonly bladeSpeed: number;
  /** Where along the blade the contact was: 0 at the hilt, 1 at the tip. */
  readonly along: number;
  /** When in the Tick the contact was: 0 at last Tick's blade, 1 at this Tick's. */
  readonly s: number;
}

/**
 * How far past a radius two boxes must be apart before `apart` says so (m). The boxes bound exact points, and the segment test's
 * own points are those to within rounding (a few units in the last place: 1e-13 m at the scale of an Arena), so with this
 * much to spare a pair `apart` rules out is one the segment test would find further apart than the radius. It is a
 * shortcut only: it can never rule out a pair the test would accept.
 */
const BOX_MARGIN = 1e-6;

/** An axis-aligned box around some points. */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** The box around both ends of two segments (a Blade Sweep's four corners: every sampled point's path lies within it). */
export function boxOf(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Box {
  return {
    minX: Math.min(a.x, b.x, c.x, d.x),
    minY: Math.min(a.y, b.y, c.y, d.y),
    minZ: Math.min(a.z, b.z, c.z, d.z),
    maxX: Math.max(a.x, b.x, c.x, d.x),
    maxY: Math.max(a.y, b.y, c.y, d.y),
    maxZ: Math.max(a.z, b.z, c.z, d.z),
  };
}

/** The box around every capsule's axis (their radii aside). */
export function boxOfCapsules(capsules: readonly Capsule[]): Box {
  const box: Box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const { a, b } of capsules) {
    box.minX = Math.min(box.minX, a.x, b.x);
    box.minY = Math.min(box.minY, a.y, b.y);
    box.minZ = Math.min(box.minZ, a.z, b.z);
    box.maxX = Math.max(box.maxX, a.x, b.x);
    box.maxY = Math.max(box.maxY, a.y, b.y);
    box.maxZ = Math.max(box.maxZ, a.z, b.z);
  }
  return box;
}

/**
 * Whether the two boxes are certainly more than `radius` apart (by `BOX_MARGIN` to spare) along some axis, so no point in one is
 * within `radius` of a point in the other. Any NaN compares false: never apart, and the full test decides.
 */
export function apart(a: Box, b: Box, radius: number): boolean {
  const pad = radius + BOX_MARGIN;
  return a.minX - b.maxX > pad || b.minX - a.maxX > pad || a.minY - b.maxY > pad || b.minY - a.maxY > pad || a.minZ - b.maxZ > pad || b.minZ - a.maxZ > pad;
}

/** Whether the segment a→b is certainly more than `radius` from everything in `box` (see `apart`). */
function segmentApart(box: Box, a: Vec3, b: Vec3, radius: number): boolean {
  const pad = radius + BOX_MARGIN;
  return (
    Math.min(a.x, b.x) - box.maxX > pad ||
    box.minX - Math.max(a.x, b.x) > pad ||
    Math.min(a.y, b.y) - box.maxY > pad ||
    box.minY - Math.max(a.y, b.y) > pad ||
    Math.min(a.z, b.z) - box.maxZ > pad ||
    box.minZ - Math.max(a.z, b.z) > pad
  );
}

/**
 * The first contact of the Blade Sweep from `from` to `to` with any capsule, or
 * null, sampling `samples` points along the blade (see `bladeSamples`). "First"
 * is the earliest point in the Tick; ties go to the deepest.
 *
 * Capsules whose box is clear of the sweep's are skipped before any segment test (`apart`: exact, they could not have
 * touched), and the rest are tested in their order, so the contact is the one testing every capsule finds.
 */
export function sweepContact<C extends Capsule>(from: BladeTransform, to: BladeTransform, capsules: readonly C[], samples: number, sweepBox: Box = boxOf(from.hilt, from.tip, to.hilt, to.tip)): SweepContact<C> | null {
  let near: C[] | null = null;
  for (let k = 0; k < capsules.length; k++) {
    const capsule = capsules[k]!;
    if (segmentApart(sweepBox, capsule.a, capsule.b, capsule.radius)) {
      near ??= capsules.slice(0, k);
    } else if (near) near.push(capsule);
  }
  const tested: readonly C[] = near ?? capsules;
  if (tested.length === 0) return null;
  const fh = from.hilt;
  const ft = from.tip;
  const th = to.hilt;
  const tt = to.tip;
  let bestS = 0;
  let bestDepth = 0;
  let bestU = 0;
  let bestCapsule: C | null = null;
  let b0x = 0, b0y = 0, b0z = 0, b1x = 0, b1y = 0, b1z = 0;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    // p0 = lerp(from.hilt, from.tip, u), p1 = lerp(to.hilt, to.tip, u)
    const p0x = fh.x + (ft.x - fh.x) * u;
    const p0y = fh.y + (ft.y - fh.y) * u;
    const p0z = fh.z + (ft.z - fh.z) * u;
    const p1x = th.x + (tt.x - th.x) * u;
    const p1y = th.y + (tt.y - th.y) * u;
    const p1z = th.z + (tt.z - th.z) * u;
    for (let k = 0; k < tested.length; k++) {
      const capsule = tested[k]!;
      segmentSegment(p0x, p0y, p0z, p1x, p1y, p1z, capsule.a, capsule.b);
      const distance = closestDistance;
      if (distance > capsule.radius) continue;
      const s = closestS;
      const depth = capsule.radius - distance;
      if (bestCapsule && (s > bestS || (s === bestS && depth <= bestDepth))) continue;
      bestCapsule = capsule;
      bestS = s;
      bestDepth = depth;
      bestU = u;
      b0x = p0x; b0y = p0y; b0z = p0z; b1x = p1x; b1y = p1y; b1z = p1z;
    }
  }
  if (!bestCapsule) return null;
  const p0 = { x: b0x, y: b0y, z: b0z };
  const p1 = { x: b1x, y: b1y, z: b1z };
  return { capsule: bestCapsule, point: lerp(p0, p1, bestS), bladeSpeed: length(sub(p1, p0)) / TICK_SECONDS, along: bestU, s: bestS };
}

/** `segmentSegment`'s result: the parameter along p0→p1 and the distance between the closest points. Rewritten by every call. */
let closestS = 0;
let closestDistance = 0;

/**
 * Closest points between segments p0→p1 and q0→q1 (Ericson, Real-Time
 * Collision Detection 5.1.9). `s` is the parameter along p0→p1.
 */
export function closestSegmentSegment(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): { s: number; distance: number } {
  segmentSegment(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, q0, q1);
  return { s: closestS, distance: closestDistance };
}

/** `closestSegmentSegment` on plain numbers, its result left in `closestS` and `closestDistance`: no vector is made. */
function segmentSegment(p0x: number, p0y: number, p0z: number, p1x: number, p1y: number, p1z: number, q0: Vec3, q1: Vec3): void {
  const d1x = p1x - p0x;
  const d1y = p1y - p0y;
  const d1z = p1z - p0z;
  const d2x = q1.x - q0.x;
  const d2y = q1.y - q0.y;
  const d2z = q1.z - q0.z;
  const rx = p0x - q0.x;
  const ry = p0y - q0.y;
  const rz = p0z - q0.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-12;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  // (p0 + d1 s) - (q0 + d2 t)
  const x = p0x + d1x * s - (q0.x + d2x * t);
  const y = p0y + d1y * s - (q0.y + d2y * t);
  const z = p0z + d1z * s - (q0.z + d2z * t);
  closestS = s;
  closestDistance = Math.sqrt(x * x + y * y + z * z);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
