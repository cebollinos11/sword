/**
 * A Delver Floor's lava glow (docs/plans/delver.md, Stage 7d, render-only): the lava is drawn emissive (`HAZARD_LOOKS.lava`), and each lava
 * Hall also lights its trench and the Walls round it, from a warm point light 1 m over the middle of its largest lava rect. A Floor may hold
 * many lava Halls and a point light costs every pixel of every surface, so only `POOL` lights exist, moved each frame to the lava points
 * nearest the camera (as `delverTorches` moves its flames), the farthest fading out as the next nearest closes on it and each fading in
 * over the last metres of its reach, so no light ever pops. The number of lights never changes, so moving them never recompiles a shader.
 * Never in the compiled map, the Tuning Data hash or the Simulation.
 */
import * as THREE from 'three';
import type { DelverLava } from '../sim/delver/plan';

/** A lava light's point (m): over the middle of a lava Hall's largest lava rect. */
export interface LavaPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The colour of the lava's glow (as the chamber's `LIGHT_lava`, `stage.ts`), and of its rects on the minimap and the Floor Map. */
export const LAVA_LIGHT_COLOUR = 0xff5a18;
export const LAVA_MAP_COLOUR = '#d8561c';

/** How high (m) over the lava a light hangs. */
const LIGHT_OVER = 1;

/**
 * The lava light points of Floor `plan`: one for each lava Hall, 1 m over the centre of its largest lava rect (the first on a tie), at the
 * lava's height + 1. Pure: the same plan gives the same points; none for a Floor with no lava.
 */
export function lavaPointsOf(plan: { readonly halls: readonly { readonly lava?: Pick<DelverLava, 'rects' | 'y'> }[] }): LavaPoint[] {
  const out: LavaPoint[] = [];
  for (const h of plan.halls) {
    if (!h.lava || h.lava.rects.length === 0) continue;
    let best = h.lava.rects[0]!;
    const area = (r: typeof best) => (r.x1 - r.x0) * (r.z1 - r.z0);
    for (const r of h.lava.rects) if (area(r) > area(best)) best = r;
    out.push({ x: (best.x0 + best.x1) / 2, y: h.lava.y + LIGHT_OVER, z: (best.z0 + best.z1) / 2 });
  }
  return out;
}

/** How many lava lights there are, each one's brightness (candela) and reach (m), and its falloff (the 4 m trench is small: it stays warm to its rim). */
export const LAVA_POOL = 2;
export const LAVA_INTENSITY = 55;
export const LAVA_REACH = 20;
const LAVA_DECAY = 1.6;
/** A light is lit within this many metres of the camera, fading in over the last `FADE`, and as the next nearest closes on it. */
const NEAR = 30;
const FADE = 4;

/** A slow, shallow flicker in [1 - depth, 1] for light `i` at time `t` (s): lava breathes rather than flickers. */
const breathe = (i: number, t: number, depth = 0.15): number => 1 - depth * (0.5 + 0.25 * Math.sin(t * 1.7 + i * 2.3) + 0.25 * Math.sin(t * 3.1 + i * 0.7));

/** The lights that follow the camera over a Floor's lava: `LAVA_POOL` point lights on the lava points nearest it, dark when none is near or the Floor has no lava. */
export class LavaLights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  /** The point each light is on (-1 for none). */
  private readonly on = new Int32Array(LAVA_POOL).fill(-1);

  constructor(private readonly points: readonly LavaPoint[]) {
    this.group.name = 'delverLavaLights';
    for (let k = 0; k < LAVA_POOL; k++) {
      const light = new THREE.PointLight(LAVA_LIGHT_COLOUR, 0, LAVA_REACH, LAVA_DECAY);
      this.lights.push(light);
      this.group.add(light);
    }
  }

  get lavaLights(): readonly THREE.PointLight[] {
    return this.lights;
  }

  /** Light the lava points nearest `camera` at time `seconds`. */
  update(camera: THREE.Camera, seconds: number): void {
    const c = camera.position;
    const p = this.points;
    const dist = p.map((q) => Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z));
    const order = dist.map((_, i) => i).sort((a, b) => dist[a]! - dist[b]!);
    const next = order.length > LAVA_POOL ? dist[order[LAVA_POOL]!]! : Infinity;
    const nearest = order.slice(0, LAVA_POOL);
    // Each light stays on its point while that is among the nearest; the rest take the nearest points left over.
    const taken = new Set<number>();
    this.lights.forEach((_, k) => {
      const i = this.on[k]!;
      if (i >= 0 && nearest.includes(i)) taken.add(i);
      else this.on[k] = -1;
    });
    let n = 0;
    this.lights.forEach((_, k) => {
      if (this.on[k]! >= 0) return;
      while (n < nearest.length && taken.has(nearest[n]!)) n++;
      if (n < nearest.length) {
        this.on[k] = nearest[n]!;
        taken.add(nearest[n]!);
      }
    });
    this.lights.forEach((light, k) => {
      const i = this.on[k]!;
      if (i < 0) {
        light.intensity = 0;
        return;
      }
      const q = p[i]!;
      const fade = Math.max(0, Math.min(1, (next - dist[i]!) / FADE, (NEAR - dist[i]!) / FADE));
      light.position.set(q.x, q.y, q.z);
      light.intensity = LAVA_INTENSITY * fade * breathe(i, seconds);
    });
  }
}
