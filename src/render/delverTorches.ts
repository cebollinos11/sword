/**
 * A Delver Floor's torchlight (render-only): wall sconces along its Halls' walls and its Passages', each a bracket, a cup and a flame, and
 * a few point lights that follow the camera from flame to flame. A Floor has hundreds of flames and a point light costs every pixel of every
 * surface, so only the `POOL` nearest the camera carry one at a time, the farthest fading out as the next nearest closes on it (no flame's
 * light ever pops), and each flickers. One more warm light (the lantern) rides just ahead of the camera, so the ground round the party
 * is never black between two sconces. Never in the compiled map, the Tuning Data hash or the Simulation.
 *
 * A Hall's sconces burn in its kind's colour: a cold blue at the Stairs (the way down, seen from the Passage), a blood red at the Boss, gold
 * over the Treasure, the plain warm flame elsewhere.
 */
import * as THREE from 'three';
import { PROP_LOOKS, type MaterialLook } from '../mapEditor/look';
import type { Rect } from '../mapEditor/source';
import { surfaceHeight, surfacesAt } from '../sim';
import type { ArenaGeometry } from '../tuning';
import type { DelverHall, DelverHallKind, FloorPlan } from '../sim/delver/plan';
import { MeshBuckets } from './meshBuckets';

/** A flame: where it burns (m) and its light's colour. */
export interface Flame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly colour: number;
}

/** A wall sconce: its flame, and the way it faces (a unit vector on the ground, out of its wall into the room). */
export interface Sconce extends Flame {
  readonly nx: number;
  readonly nz: number;
}

/** How high (m) a sconce's flame burns over the floor under it, and how far (m) from its wall. */
const FLAME_HEIGHT = 2.35;
const FLAME_OUT = 0.28;
/** The most metres between two sconces along a Hall's wall, and a Passage's; a wall shorter than `MIN_WALL` has none. */
const HALL_SPACING = 8;
const PASSAGE_SPACING = 9;
const MIN_WALL = 3;
/** No sconce within this (m) of a doorway's edge or a pillar. */
const CLEAR = 0.9;

const WARM = 0xffa050;
const FLAME_COLOUR: Readonly<Record<DelverHallKind, number>> = {
  Entrance: WARM,
  Fight: WARM,
  Empty: WARM,
  Rest: WARM,
  Treasure: 0xffd060,
  Boss: 0xff3020,
  Stairs: 0x6fa8ff,
};
const FLAME_LOOK: Readonly<Record<number, MaterialLook>> = {
  [WARM]: PROP_LOOKS.fire,
  0xffd060: { name: 'Map_FireGold', colour: 0xffe08a, emissive: { colour: 0xffc040, strength: 3 } },
  0xff3020: { name: 'Map_FireBlood', colour: 0xff5a40, emissive: { colour: 0xff2a10, strength: 3 } },
  0x6fa8ff: { name: 'Map_FireCold', colour: 0xa8d0ff, emissive: { colour: 0x5a9cff, strength: 3 } },
};

const inside = (r: Rect, x: number, z: number, pad = 0): boolean => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

/** The four sides of `r`: each the segment from (ax, az) to (bx, bz), with its inward normal. */
function sides(r: Rect): { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }[] {
  return [
    { ax: r.x0, az: r.z0, bx: r.x1, bz: r.z0, nx: 0, nz: 1 },
    { ax: r.x0, az: r.z1, bx: r.x1, bz: r.z1, nx: 0, nz: -1 },
    { ax: r.x0, az: r.z0, bx: r.x0, bz: r.z1, nx: 1, nz: 0 },
    { ax: r.x1, az: r.z0, bx: r.x1, bz: r.z1, nx: -1, nz: 0 },
  ];
}

/** What `sconcesOf` reads of a Floor plan: its Halls' kinds, floors, pillars and ceilings, and its Passages (a Duel room's is one Hall, no Passage). */
export interface SconcePlan {
  readonly halls: readonly Pick<DelverHall, 'kind' | 'rects' | 'pillars' | 'top'>[];
  readonly passages: FloorPlan['passages'];
}

/**
 * The sconces of Floor `plan` in `arena` (its compiled geometry): evenly along each wall of each Hall's floor (its outer walls and its solids'
 * faces, never a doorway, nor beside a pillar), then along the long walls of each straight piece of each Passage, on alternate sides. Each
 * stands over the highest floor under its Hall's roof (a gallery's Deck, a split's tier, a Ramp). Pure: the same plan gives the same sconces.
 */
export function sconcesOf(plan: SconcePlan, arena: ArenaGeometry): Sconce[] {
  const pieces = plan.passages.flatMap((p) => p.pieces.map((q) => q.rect));
  const out: Sconce[] = [];
  const floorUnder = (x: number, z: number, below: number): number | null => {
    const ys = surfacesAt(arena, x, z)
      .map((j) => surfaceHeight(arena, j, x, z))
      .filter((y) => y <= below + 0.05);
    return ys.length > 0 ? Math.max(...ys) : null;
  };
  const place = (x: number, z: number, nx: number, nz: number, below: number, colour: number) => {
    const fx = x + nx * FLAME_OUT;
    const fz = z + nz * FLAME_OUT;
    const y = floorUnder(fx, fz, below);
    if (y !== null) out.push({ x: fx, y: y + FLAME_HEIGHT, z: fz, nx, nz, colour });
  };
  const along = (s: ReturnType<typeof sides>[number], spacing: number, ok: (x: number, z: number) => boolean, put: (x: number, z: number) => void) => {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (len < MIN_WALL) return;
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = s.ax + (s.bx - s.ax) * t;
      const z = s.az + (s.bz - s.az) * t;
      if (ok(x, z)) put(x, z);
    }
  };

  for (const h of plan.halls) {
    const colour = FLAME_COLOUR[h.kind];
    for (const r of h.rects) {
      for (const s of sides(r)) {
        // A wall, not the seam with another of the Hall's floor rects, nor a doorway (a Passage piece just outside), nor beside a pillar.
        const ok = (x: number, z: number) => {
          const ox = x - s.nx * 0.3;
          const oz = z - s.nz * 0.3;
          const tx = s.nz !== 0 ? 1 : 0;
          const tz = s.nx !== 0 ? 1 : 0;
          for (const d of [-CLEAR, 0, CLEAR]) {
            const px = ox + tx * d;
            const pz = oz + tz * d;
            if (h.rects.some((o) => o !== r && inside(o, px, pz))) return false;
            if (pieces.some((p) => inside(p, px, pz))) return false;
          }
          return !h.pillars.some((p) => inside(p, x + s.nx, z + s.nz, CLEAR));
        };
        along(s, HALL_SPACING, ok, (x, z) => place(x, z, s.nx, s.nz, h.top - 0.5, colour));
      }
    }
  }

  plan.passages.forEach((p, i) => {
    p.pieces.forEach((q, k) => {
      if (q.corner) return;
      // The long sides, across the piece's axis: one of them, turn about along the Passage.
      const long = sides(q.rect).filter((s) => (q.axis === 'x' ? s.nx === 0 : s.nz === 0));
      const s = long[(i + k) % 2]!;
      const top = Math.max(q.y0, q.y1) + 0.5;
      along(s, PASSAGE_SPACING, () => true, (x, z) => place(x, z, s.nx, s.nz, top, WARM));
    });
  });
  return out;
}

/** The sconces' meshes, one per material: an iron bracket out of the wall, a cup, and the flame in its colour. */
export function sconceMeshes(sconces: readonly Sconce[]): THREE.Mesh[] {
  const buckets = new MeshBuckets();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cup = new THREE.CylinderGeometry(0.13, 0.07, 0.16, 7);
  const flame = new THREE.OctahedronGeometry(1, 0);
  for (const s of sconces) {
    const turn = Math.atan2(s.nx, s.nz);
    const frame = new THREE.Matrix4().makeTranslation(s.x, s.y, s.z).multiply(new THREE.Matrix4().makeRotationY(turn));
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      frame.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
    // A plate on the wall, an arm out to the cup, the cup, and the flame standing in it.
    buckets.geometry(PROP_LOOKS.pole, box, part(0, -0.3, -FLAME_OUT + 0.03, 0.16, 0.36, 0.05));
    buckets.geometry(PROP_LOOKS.pole, box, part(0, -0.28, -FLAME_OUT / 2, 0.05, 0.05, FLAME_OUT));
    buckets.geometry(PROP_LOOKS.pole, cup, part(0, -0.2, 0, 1, 1, 1));
    buckets.geometry(FLAME_LOOK[s.colour] ?? PROP_LOOKS.fire, flame, part(0, 0.02, 0, 0.11, 0.24, 0.11));
  }
  box.dispose();
  cup.dispose();
  flame.dispose();
  return buckets.meshes();
}

/** How many flames carry a light at once, and each one's brightness (candela) and reach (m). */
const POOL = 8;
const FLAME_INTENSITY = 7;
const FLAME_REACH = 12;
/** Over how many metres the farthest lit flame fades out as the next nearest closes on it. */
const FADE = 2.5;
/** The lantern: its colour, brightness, reach, and how far (m) ahead of the camera, and above, it rides. */
const LANTERN = { colour: 0xffc890, intensity: 3, reach: 10, ahead: 3.2, up: 0.4 } as const;

/** A smooth flicker in [1 - depth, 1] for flame `i` at time `t` (s): two slow waves and a quick one, out of step flame to flame. */
const flicker = (i: number, t: number, depth = 0.22): number => {
  const w = 0.5 * Math.sin(t * 7.1 + i * 1.7) + 0.3 * Math.sin(t * 13.3 + i * 4.1) + 0.2 * Math.sin(t * 23.9 + i * 0.9);
  return 1 - depth * (0.5 + 0.5 * w);
};

/**
 * The lights that follow the camera through a Floor: `POOL` point lights moved each frame to the flames nearest it, and the lantern. The
 * number of lights never changes, so moving them never recompiles a shader.
 */
export class TorchLights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  /** The flame each light is on (-1 for none). */
  private readonly on: Int32Array;
  private readonly lantern: THREE.PointLight;
  private readonly order: number[];
  private readonly dist: Float32Array;
  private readonly ahead = new THREE.Vector3();

  constructor(private readonly flames: readonly Flame[]) {
    this.group.name = 'delverTorchLights';
    for (let k = 0; k < POOL; k++) {
      const light = new THREE.PointLight(WARM, 0, FLAME_REACH, 1.4);
      this.lights.push(light);
      this.group.add(light);
    }
    this.lantern = new THREE.PointLight(LANTERN.colour, LANTERN.intensity, LANTERN.reach, 1.2);
    this.group.add(this.lantern);
    this.order = flames.map((_, i) => i);
    this.dist = new Float32Array(flames.length);
    this.on = new Int32Array(POOL).fill(-1);
  }

  /** The flames' lights (not the lantern), each kept on one flame while it is among the nearest. */
  get flameLights(): readonly THREE.PointLight[] {
    return this.lights;
  }

  /** Light the flames nearest `camera` (and move the lantern before it) at time `seconds`. */
  update(camera: THREE.Camera, seconds: number): void {
    const c = camera.position;
    camera.getWorldDirection(this.ahead);
    this.ahead.y = 0;
    if (this.ahead.lengthSq() > 1e-6) this.ahead.normalize();
    this.lantern.position.set(c.x + this.ahead.x * LANTERN.ahead, c.y + LANTERN.up, c.z + this.ahead.z * LANTERN.ahead);
    this.lantern.intensity = LANTERN.intensity * flicker(-1, seconds, 0.08);

    const f = this.flames;
    for (let i = 0; i < f.length; i++) this.dist[i] = (f[i]!.x - c.x) ** 2 + (f[i]!.y - c.y) ** 2 + (f[i]!.z - c.z) ** 2;
    // The order is kept frame to frame, so it is nearly sorted and an insertion sort is quick.
    const o = this.order;
    for (let a = 1; a < o.length; a++) {
      const v = o[a]!;
      const d = this.dist[v]!;
      let b = a - 1;
      while (b >= 0 && this.dist[o[b]!]! > d) {
        o[b + 1] = o[b]!;
        b--;
      }
      o[b + 1] = v;
    }
    const next = o.length > POOL ? Math.sqrt(this.dist[o[POOL]!]!) : Infinity;
    // Each light stays on its flame while that is among the nearest (it is the same light in the same place, frame to frame); the rest take
    // the nearest flames left over. A light only moves once its flame has faded out, so the dust and embers it lights (`Dustfall`) never jump.
    const nearest = o.slice(0, POOL);
    const taken = new Set<number>();
    for (let k = 0; k < this.lights.length; k++) {
      const i = this.on[k]!;
      if (i >= 0 && nearest.includes(i)) taken.add(i);
      else this.on[k] = -1;
    }
    let n = 0;
    for (let k = 0; k < this.lights.length; k++) {
      if (this.on[k]! >= 0) continue;
      while (n < nearest.length && taken.has(nearest[n]!)) n++;
      if (n < nearest.length) {
        this.on[k] = nearest[n]!;
        taken.add(nearest[n]!);
      }
    }
    this.lights.forEach((light, k) => {
      const i = this.on[k]!;
      if (i < 0) {
        light.intensity = 0;
        return;
      }
      const flame = f[i]!;
      const fade = Math.min(1, (next - Math.sqrt(this.dist[i]!)) / FADE);
      light.position.set(flame.x, flame.y + 0.15, flame.z);
      light.color.set(flame.colour);
      light.intensity = FLAME_INTENSITY * fade * flicker(i, seconds);
    });
  }
}
