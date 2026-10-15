/**
 * The Blade Sweep: the volume the blade traces between two consecutive Ticks.
 * It is sampled as the straight paths of points spread along the blade (main
 * hand to tip), from last Tick's blade to this Tick's. A path that passes
 * within a capsule's radius of its axis is a contact.
 */
import { TICK_SECONDS } from './constants';
import type { BladeTransform } from './skeleton';
import { add, dot, length, lerp, scale, sub, type Vec3 } from './vec';

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
}

/**
 * The first contact of the Blade Sweep from `from` to `to` with any capsule, or
 * null, sampling `samples` points along the blade (see `bladeSamples`). "First"
 * is the earliest point in the Tick; ties go to the deepest.
 */
export function sweepContact<C extends Capsule>(from: BladeTransform, to: BladeTransform, capsules: readonly C[], samples: number): SweepContact<C> | null {
  let best: { s: number; depth: number; contact: SweepContact<C> } | null = null;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const p0 = lerp(from.hilt, from.tip, u);
    const p1 = lerp(to.hilt, to.tip, u);
    for (const capsule of capsules) {
      const { s, distance } = closestSegmentSegment(p0, p1, capsule.a, capsule.b);
      if (distance > capsule.radius) continue;
      const depth = capsule.radius - distance;
      if (best && (s > best.s || (s === best.s && depth <= best.depth))) continue;
      const point = lerp(p0, p1, s);
      best = { s, depth, contact: { capsule, point, bladeSpeed: length(sub(p1, p0)) / TICK_SECONDS, along: u } };
    }
  }
  return best?.contact ?? null;
}

/**
 * Closest points between segments p0→p1 and q0→q1 (Ericson, Real-Time
 * Collision Detection 5.1.9). `s` is the parameter along p0→p1.
 */
function closestSegmentSegment(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): { s: number; distance: number } {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
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
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
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
  const cp = add(p0, scale(d1, s));
  const cq = add(q0, scale(d2, t));
  return { s, distance: length(sub(cp, cq)) };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
