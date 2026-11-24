/**
 * A Delver Floor's clutter (issue #169, render-only): heaps of rubble and bones in its Halls' corners and along their wall bases, cobwebs in
 * the upper corners of Halls and Passages, chains with shackles hanging from some walls, and cracked or missing floor tiles. Never in the
 * compiled map, collision, the Simulation or the Tuning Data hash: it is placed from the Floor's plan alone (`clutterOf`, pure and seeded by
 * the plan), so every peer draws the same.
 *
 * It keeps off the walking lines: only corners and wall bases, never a doorway, a Ramp, a gallery's Deck, a pit, a dais, round the Rest fire's
 * heal ring, the Treasure pedestals, the Stairs, the spawns or a Warband's post, nor on or within a metre of a Hall's lava, and in a Passage only along its walls. How much there is goes
 * by the Hall's kind: most in Empty and Fight Halls, little in the Entrance.
 *
 * Cheap to draw (`clutterModel`): at most four draw calls a Floor. Stones, bones and chains are merged by material (`MeshBuckets`, low-poly
 * shapes), and the cobwebs and floor cracks share one mesh in one unlit, fogged, see-through material that writes no depth (as the seam shade,
 * `seamShade.ts`). A cobweb's light is baked into its vertices from the flames near it, so the webs cost no light at all and still glow in a
 * sconce's light and fade into the dark between. A whole Floor stays under about 20 000 triangles. The player can turn it off on the in-game
 * menu (`clutterEnabled`).
 */
import * as THREE from 'three';
import { PROP_LOOKS, type MaterialLook } from '../mapEditor/look';
import type { Rect } from '../mapEditor/source';
import { surfaceHeight, surfacesAt } from '../sim';
import type { ArenaGeometry } from '../tuning';
import { PASSAGE_STOREY, type DelverHall, type DelverHallKind, type FloorPlan } from '../sim/delver/plan';
import { MeshBuckets } from './meshBuckets';
import { vary } from './mapProps';

/** Where the player's Clutter setting is remembered (absent: on). */
export const CLUTTER_STORAGE_KEY = 'sword.clutter';

let clutterOn = ((): boolean => {
  try {
    return localStorage.getItem(CLUTTER_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
})();

/** Whether a Delver Floor's clutter is drawn: the player's choice, on by default, set on the in-game menu and remembered. Render-only. */
export function clutterEnabled(): boolean {
  return clutterOn;
}

/** Sets (and remembers) whether the clutter is drawn, from the next frame on. */
export function setClutterEnabled(on: boolean): void {
  clutterOn = on;
  try {
    if (on) localStorage.removeItem(CLUTTER_STORAGE_KEY);
    else localStorage.setItem(CLUTTER_STORAGE_KEY, 'off');
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

interface P3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A heap of rubble (and maybe bones) on the floor at (x, y, z), `r` (m) across its middle, leaning into its wall or corner (`dx`, `dz`: the way out of it, unit). */
export interface Heap extends P3 {
  readonly r: number;
  readonly dx: number;
  readonly dz: number;
  /** How many bones lie on it, and whether a skull does. */
  readonly bones: number;
  readonly skull: boolean;
  /** Its own key: the stones' places are picked from it. */
  readonly id: string;
}

/** A chain hanging from a wall: its top (on the wall), the way out of the wall (unit), its links, and whether a shackle hangs at its end. */
export interface Chain extends P3 {
  readonly nx: number;
  readonly nz: number;
  readonly links: number;
  readonly shackle: boolean;
}

/** A cobweb: strands from its hub out to its anchors (on the walls and ceiling round it, in order round the hub), lit `light` (0 dark to 1 by a flame). */
export interface Web {
  readonly hub: P3;
  readonly anchors: readonly P3[];
  readonly light: number;
}

/** A crack in the floor at (x, y, z): a dark patch with cracks running out of it, or a missing tile (a dark sunken square), `size` (m) across. */
export interface Crack extends P3 {
  readonly size: number;
  readonly missing: boolean;
  readonly id: string;
}

export interface Clutter {
  readonly heaps: readonly Heap[];
  readonly chains: readonly Chain[];
  readonly webs: readonly Web[];
  readonly cracks: readonly Crack[];
}

/** What the clutter keeps clear of beyond the plan: the Rest fire's heal ring (`delver.fireRadius`), and the flames the cobwebs are lit by. */
export interface ClutterContext {
  readonly fireRadius: number;
  readonly flames?: readonly P3[];
}

/** How much clutter a Hall of each kind holds (a share of the full chances below). */
const DENSITY: Readonly<Record<DelverHallKind, number>> = {
  Entrance: 0.2,
  Fight: 1,
  Empty: 1,
  Rest: 0.5,
  Treasure: 0.45,
  Boss: 0.8,
  Stairs: 0.6,
};
/** A Passage's, as a Hall's. */
const PASSAGE_DENSITY = 0.8;

/** The chances at full density: a heap in a Hall's corner, a web in its upper corner, and per slot along a wall a heap at its base, a crack, a web along its top, a chain. */
const CHANCE = { cornerHeap: 0.7, cornerWeb: 0.65, baseHeap: 0.11, crack: 0.12, edgeWeb: 0.05, chain: 0.24 } as const;
/** The metres between slots along a Hall's wall, and a Passage's; a chain's slots are wider apart. */
const SLOT = 3;
const PASSAGE_SLOT = 3.5;
const CHAIN_SLOT = 6;
/** No clutter this near (m) a doorway (the Passage piece outside it), a pillar, the Stairs' zone, nor a Ramp, Deck, pit or dais. */
const DOOR_CLEAR = 2;
const PILLAR_CLEAR = 0.5;
const FEATURE_CLEAR = 0.6;
/** No clutter within these (m) of a Treasure pedestal, an Entrance spawn, a Warband's post, or the Boss; and this past a fire's heal ring. */
const PEDESTAL_CLEAR = 1.8;
const SPAWN_CLEAR = 1.2;
const POST_CLEAR = 1;
const BOSS_CLEAR = 2.5;
const FIRE_CLEAR = 0.8;
/** No chain within this (m) of a flame (a sconce's bracket). */
const FLAME_CLEAR = 2;
/** No clutter within this (m) of a Hall's lava (Stage 7d), nor a cobweb over it: a heap stands on floor, not on a Hole's rim, and a chain's foot never hangs over lava. */
const LAVA_CLEAR = 1;
/** Heights this close (m) are one floor. */
const EPS = 0.04;

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

/** A cobweb in the corner `c` (on the ceiling) where the walls run off along `a` and `b` (unit, on the ground), `s` (m) across. */
function cornerWeb(c: P3, a: { x: number; z: number }, b: { x: number; z: number }, s: number): Omit<Web, 'light'> {
  const p = (u: number, v: number, down: number): P3 => ({ x: c.x + a.x * u + b.x * v, y: c.y - down, z: c.z + a.z * u + b.z * v });
  return {
    hub: p(s * 0.3, s * 0.3, s * 0.3),
    // Round the hub: the ceiling's edge on wall a, the ceiling, its edge on wall b, down wall b, the corner's edge, up wall a.
    anchors: [p(s, 0, 0), p(s * 0.65, s * 0.65, 0), p(0, s, 0), p(0, s * 0.6, s * 0.6), p(0, 0, s), p(s * 0.6, 0, s * 0.6)],
  };
}

/** A cobweb along the top of a wall at `w` (on the ceiling's edge), the wall running along `t` and its room out along `n` (unit), `s` (m) across. */
function edgeWeb(w: P3, t: { x: number; z: number }, n: { x: number; z: number }, s: number): Omit<Web, 'light'> {
  const p = (u: number, v: number, down: number): P3 => ({ x: w.x + t.x * u + n.x * v, y: w.y - down, z: w.z + t.z * u + n.z * v });
  return {
    hub: p(0, s * 0.3, s * 0.3),
    anchors: [p(-s, 0, 0), p(0, s * 0.7, 0), p(s, 0, 0), p(s * 0.5, 0, s * 0.55), p(0, 0, s * 0.7), p(-s * 0.5, 0, s * 0.55)],
  };
}

/**
 * The clutter of Floor `plan` in `arena` (its compiled geometry). Pure and seeded by the plan: the same plan gives the same clutter. Each item
 * stands on the floor under it (a split's tier, a pit's rim) and only where that floor is flat round it, so never on a Ramp or over an edge.
 */
export function clutterOf(plan: FloorPlan, arena: ArenaGeometry, context: ClutterContext): Clutter {
  const heaps: Heap[] = [];
  const chains: Chain[] = [];
  const webs: Web[] = [];
  const cracks: Crack[] = [];
  const flames = context.flames ?? [];
  const pieces = plan.passages.flatMap((p) => p.pieces.map((q) => q.rect));
  const key = `${plan.seed}:${plan.floor}`;

  const heights = (x: number, z: number): number[] => surfacesAt(arena, x, z).map((j) => surfaceHeight(arena, j, x, z));
  /** The highest floor at (x, z) no higher than `below`, or null. */
  const floorAt = (x: number, z: number, below: number): number | null => {
    let best: number | null = null;
    for (const y of heights(x, z)) if (y <= below + EPS && (best === null || y > best)) best = y;
    return best;
  };
  /** The floor under a disc `r` across at (x, z): its height when the floor is the same height all round it, else null (a Ramp, an edge). */
  const flatFloor = (x: number, z: number, r: number, below: number): number | null => {
    const y = floorAt(x, z, below);
    if (y === null) return null;
    for (const [ox, oz] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const) {
      const yy = floorAt(x + ox, z + oz, y + 0.5);
      if (yy === null || Math.abs(yy - y) > EPS) return null;
    }
    return y;
  };
  /** The lowest surface more than a metre over `y` at (x, z) (the roof), or `fallback`. */
  const ceilingAt = (x: number, z: number, y: number, fallback: number): number => {
    let best = Infinity;
    for (const h of heights(x, z)) if (h > y + 1 && h < best) best = h;
    return Number.isFinite(best) ? best : fallback;
  };
  const lightAt = (p: P3): number => {
    let l = 0;
    for (const f of flames) {
      const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
      if (d < 9) l += (1 - d / 9) ** 2;
    }
    return Math.min(1, l);
  };
  const web = (w: Omit<Web, 'light'>) => webs.push({ ...w, light: lightAt(w.hub) });

  plan.halls.forEach((h, hi) => {
    const density = DENSITY[h.kind];
    const below = h.top - 0.5;
    const keep = keepOuts(h, hi, plan, context.fireRadius);
    /** Whether a disc `r` across at (x, z) is clear of everything it keeps off. */
    const clear = (x: number, z: number, r: number): boolean =>
      !pieces.some((p) => inside(p, x, z, DOOR_CLEAR + r)) &&
      !h.pillars.some((p) => inside(p, x, z, PILLAR_CLEAR + r)) &&
      !keep.rects.some((k) => inside(k.rect, x, z, k.pad + r)) &&
      !keep.discs.some((d) => Math.hypot(d.x - x, d.z - z) < d.r + r);

    h.rects.forEach((r, ri) => {
      const other = (x: number, z: number) => h.rects.some((o) => o !== r && inside(o, x, z)) || pieces.some((p) => inside(p, x, z));
      // Its corners: where two walls meet (not the seam with another of the Hall's floor rects, nor a doorway).
      [
        [r.x0, r.z0, 1, 1],
        [r.x1, r.z0, -1, 1],
        [r.x0, r.z1, 1, -1],
        [r.x1, r.z1, -1, -1],
      ].forEach(([cx, cz, dx, dz], ci) => {
        if (other(cx! - dx! * 0.3, cz! + dz! * 0.8) || other(cx! + dx! * 0.8, cz! - dz! * 0.3)) return;
        const v = (salt: number) => vary(`${key}:${h.id}:${ri}:c${ci}`, salt);
        const hx = cx! + dx! * 1;
        const hz = cz! + dz! * 1;
        const y = floorAt(hx, hz, below);
        if (v(1) < CHANCE.cornerHeap * density && clear(hx, hz, 0.9)) {
          const yy = flatFloor(hx, hz, 0.9, below);
          if (yy !== null) heaps.push({ x: hx, y: yy, z: hz, r: 0.95 + 0.5 * v(2), dx: dx! * Math.SQRT1_2, dz: dz! * Math.SQRT1_2, bones: v(3) < 0.5 ? 1 + Math.floor(v(4) * 2) : 0, skull: v(5) < 0.25, id: `${h.id}:${ri}:c${ci}` });
        }
        if (y !== null && v(6) < CHANCE.cornerWeb * density && !(h.lava?.rects ?? []).some((q) => inside(q, hx, hz, 0.5))) {
          const top = ceilingAt(hx, hz, y, h.top);
          web(cornerWeb({ x: cx!, y: top, z: cz! }, { x: dx!, z: 0 }, { x: 0, z: dz! }, 1.3 + 1.1 * v(7)));
        }
      });

      // Along its walls: heaps at their bases, cracks a little out from them, webs along their tops and chains hanging on them.
      for (const s of sides(r)) {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        const tx = (s.bx - s.ax) / len;
        const tz = (s.bz - s.az) / len;
        // The wall is a wall here: not the seam with another floor rect, nor a doorway, at the point and a little either side.
        const wall = (x: number, z: number) => {
          for (const d of [-1, 0, 1]) if (other(x - s.nx * 0.3 + tx * d, z - s.nz * 0.3 + tz * d)) return false;
          return true;
        };
        const slot = (t: number, salt: string, each: (x: number, z: number, v: (k: number) => number) => void) => {
          const x = s.ax + tx * t;
          const z = s.az + tz * t;
          if (wall(x, z)) each(x, z, (k) => vary(`${key}:${h.id}:${ri}:${s.nx},${s.nz}:${salt}${t}`, k));
        };
        for (let t = 1.5; t <= len - 1.5; t += SLOT) {
          slot(t, 's', (x, z, v) => {
            if (v(1) < CHANCE.baseHeap * density) {
              const r0 = 0.4 + 0.3 * v(2);
              const px = x + s.nx * (r0 + 0.12) + tx * (v(3) - 0.5);
              const pz = z + s.nz * (r0 + 0.12) + tz * (v(3) - 0.5);
              const y = clear(px, pz, r0) ? flatFloor(px, pz, r0, below) : null;
              if (y !== null) heaps.push({ x: px, y, z: pz, r: r0, dx: s.nx, dz: s.nz, bones: v(4) < 0.3 ? 1 : 0, skull: v(5) < 0.08, id: `${h.id}:${ri}:${s.nx},${s.nz}:${t}` });
            }
            if (v(6) < CHANCE.crack * density) {
              const size = 0.6 + 0.5 * v(7);
              const out = 0.6 + 1.6 * v(8);
              const px = x + s.nx * out + tx * (v(9) - 0.5) * 2;
              const pz = z + s.nz * out + tz * (v(9) - 0.5) * 2;
              const y = clear(px, pz, size * 0.6) ? flatFloor(px, pz, size * 0.6, below) : null;
              if (y !== null) cracks.push({ x: px, y, z: pz, size, missing: v(10) < 0.4, id: `${h.id}:${ri}:${s.nx},${s.nz}:${t}` });
            }
            if (v(11) < CHANCE.edgeWeb * density) {
              const y = floorAt(x + s.nx * 0.5, z + s.nz * 0.5, below);
              if (y !== null && clear(x + s.nx * 0.5, z + s.nz * 0.5, 0)) web(edgeWeb({ x, y: ceilingAt(x + s.nx * 0.3, z + s.nz * 0.3, y, h.top), z }, { x: tx, z: tz }, { x: s.nx, z: s.nz }, 0.8 + 0.6 * v(12)));
            }
          });
        }
        for (let t = CHAIN_SLOT / 2; t <= len - 2; t += CHAIN_SLOT) {
          slot(t, 'ch', (x, z, v) => {
            if (v(1) >= CHANCE.chain * density) return;
            const px = x + s.nx * 0.06;
            const pz = z + s.nz * 0.06;
            const y = floorAt(x + s.nx * 0.5, z + s.nz * 0.5, below);
            if (y === null || !clear(x + s.nx * 0.5, z + s.nz * 0.5, 0)) return;
            const top = Math.min(y + 3.5, ceilingAt(x + s.nx * 0.3, z + s.nz * 0.3, y, h.top) - 0.5);
            // Two chains side by side now and then, each a little longer or shorter.
            const pair = v(2) < 0.45;
            for (const off of pair ? [-0.3, 0.3] : [0]) {
              const cx = px + tx * off;
              const cz = pz + tz * off;
              if ((h.lava?.rects ?? []).some((q) => inside(q, cx + s.nx * 0.5, cz + s.nz * 0.5, LAVA_CLEAR))) continue;
              if (flames.some((f) => Math.hypot(f.x - cx, f.z - cz) < FLAME_CLEAR && Math.abs(f.y - top) < 2)) continue;
              chains.push({ x: cx, y: top, z: cz, nx: s.nx, nz: s.nz, links: 5 + Math.floor(v(off > 0 ? 3 : 4) * 4), shackle: v(5) < 0.7 });
            }
          });
        }
      }
    });
  });

  plan.passages.forEach((p) => {
    p.pieces.forEach((q, k) => {
      // A sloped leg is a Ramp: nothing on it.
      if (q.y0 !== q.y1) return;
      const below = q.y0 + 0.5;
      const v0 = (salt: string) => (n: number) => vary(`${key}:${p.id}:${k}:${salt}`, n);
      const roof = (x: number, z: number) => ceilingAt(x, z, q.y0, q.y0 + PASSAGE_STOREY);
      if (q.corner) {
        // Its walls are the two sides it is neither entered nor left by; they meet in the corner away from the legs it joins.
        const walls = (['n', 'e', 's', 'w'] as const).filter((sd) => sd !== q.from && sd !== q.to);
        const cx = walls.includes('e') ? q.rect.x1 : q.rect.x0;
        const cz = walls.includes('n') ? q.rect.z1 : q.rect.z0;
        const dx = cx === q.rect.x0 ? 1 : -1;
        const dz = cz === q.rect.z0 ? 1 : -1;
        const v = v0('c');
        if (v(1) < CHANCE.cornerWeb * PASSAGE_DENSITY * 1.4) web(cornerWeb({ x: cx, y: roof(cx + dx * 0.3, cz + dz * 0.3), z: cz }, { x: dx, z: 0 }, { x: 0, z: dz }, 0.8 + 0.5 * v(2)));
        if (v(3) < CHANCE.cornerHeap * PASSAGE_DENSITY) {
          const hx = cx + dx * 0.45;
          const hz = cz + dz * 0.45;
          const y = flatFloor(hx, hz, 0.35, below);
          if (y !== null) heaps.push({ x: hx, y, z: hz, r: 0.35, dx: dx * Math.SQRT1_2, dz: dz * Math.SQRT1_2, bones: v(4) < 0.3 ? 1 : 0, skull: false, id: `${p.id}:${k}:c` });
        }
        return;
      }
      // Along each long wall, clear of its ends (where it opens into a Hall or a corner).
      const long = sides(q.rect).filter((s) => (q.axis === 'x' ? s.nx === 0 : s.nz === 0));
      for (const s of long) {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        const tx = (s.bx - s.ax) / len;
        const tz = (s.bz - s.az) / len;
        for (let t = 1.5; t <= len - 1.5; t += PASSAGE_SLOT) {
          const v = v0(`${s.nx},${s.nz}:${t}`);
          const x = s.ax + tx * t;
          const z = s.az + tz * t;
          if (v(1) < CHANCE.baseHeap * PASSAGE_DENSITY * 1.5) {
            const r0 = 0.3 + 0.12 * v(2);
            const px = x + s.nx * (r0 + 0.1);
            const pz = z + s.nz * (r0 + 0.1);
            const y = flatFloor(px, pz, r0, below);
            if (y !== null) heaps.push({ x: px, y, z: pz, r: r0, dx: s.nx, dz: s.nz, bones: v(3) < 0.25 ? 1 : 0, skull: false, id: `${p.id}:${k}:${s.nx},${s.nz}:${t}` });
          }
          if (v(4) < CHANCE.crack * PASSAGE_DENSITY * 1.5) {
            const size = 0.45 + 0.25 * v(5);
            const px = x + s.nx * (0.35 + size / 2);
            const pz = z + s.nz * (0.35 + size / 2);
            const y = flatFloor(px, pz, size * 0.6, below);
            if (y !== null) cracks.push({ x: px, y, z: pz, size, missing: v(6) < 0.35, id: `${p.id}:${k}:${s.nx},${s.nz}:${t}` });
          }
          if (v(7) < CHANCE.edgeWeb * PASSAGE_DENSITY * 2) web(edgeWeb({ x, y: roof(x + s.nx * 0.3, z + s.nz * 0.3), z }, { x: tx, z: tz }, { x: s.nx, z: s.nz }, 0.6 + 0.4 * v(8)));
        }
      }
    });
  });
  return { heaps, chains, webs, cracks };
}

/** What a Hall's clutter keeps off: its Ramps, Decks, pit and dais (rects, each with its pad), and its markers (discs). */
function keepOuts(h: DelverHall, hi: number, plan: FloorPlan, fireRadius: number): { rects: { rect: Rect; pad: number }[]; discs: { x: number; z: number; r: number }[] } {
  const rects: { rect: Rect; pad: number }[] = [];
  const add = (rect: Rect, pad = FEATURE_CLEAR) => rects.push({ rect, pad });
  const g = h.gallery;
  if (g) {
    add(g.deck);
    add(g.ramp);
    for (const d of g.wrap?.decks ?? []) add(d);
  }
  const f = h.feature;
  if (f) {
    for (const s of f.steps) add(s.rect);
    if (f.kind === 'pit') add(f.pit);
    if (f.kind === 'dais') add(f.rect);
    // Stage 7g: a drawn room's Platforms and Blocks (its Ramps are its steps).
    if (f.kind === 'room') for (const b of f.brushes) if (b.kind === 'platform' || b.kind === 'block') add(b.rect);
  }
  // Lava (Stage 7d) is a Hole in the floor with the Hazard 4 m under it: nothing stands on or over it, nor within `LAVA_CLEAR` of it.
  for (const q of h.lava?.rects ?? []) add(q, LAVA_CLEAR);
  const m = plan.markers;
  if (m.stairs.hall === hi) add(m.stairs.zone, 1);
  const discs: { x: number; z: number; r: number }[] = [];
  const near = (ps: readonly { hall: number; x: number; z: number }[], r: number) => {
    for (const p of ps) if (p.hall === hi) discs.push({ x: p.x, z: p.z, r });
  };
  near(m.fires, fireRadius + FIRE_CLEAR);
  near(m.pedestals, PEDESTAL_CLEAR);
  near(m.spawns, SPAWN_CLEAR);
  near(m.posts, POST_CLEAR);
  if (m.boss) near([m.boss], BOSS_CLEAR);
  return { rects, discs };
}

/** The clutter's group's name, and its see-through mesh's (cobwebs and floor cracks), which the game finds them by. */
export const CLUTTER = 'delverClutter';
export const CLUTTER_SHADE = 'Map_ClutterShade';

const BONE: MaterialLook = { name: 'Map_Bone', colour: 0xcabfa0 };
/** How far (m) a crack lies over its floor, so the two never share a plane (the polygon offset does the rest). */
const LIFT = 0.006;
/** A cobweb's strands' width (m), and how see-through its strands and its sheet are. */
const STRAND = 0.035;
const STRAND_ALPHA = 0.55;
const SHEET_ALPHA = 0.16;
/** A cobweb's colour in the dark, and in a flame's light (linear RGB). */
const WEB_DARK = [0.2, 0.18, 0.16] as const;
const WEB_LIT = [0.85, 0.74, 0.58] as const;
/** A link's length (m) down its chain. */
const LINK = 0.15;

/** The see-through material of the cobwebs and floor cracks: the vertex colour and alpha, unlit, fogged, writing no depth, pulled towards the eye. */
export function clutterShadeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    name: CLUTTER_SHADE,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/**
 * The clutter's model: a group (`CLUTTER`) of at most four meshes, the stones (`Map_Rubble`, textured as rubble), the bones, the chains (iron)
 * and the cobwebs with the floor cracks (`CLUTTER_SHADE`).
 */
export function clutterModel(c: Clutter): THREE.Group {
  const group = new THREE.Group();
  group.name = CLUTTER;
  const buckets = new MeshBuckets();
  // Low-poly shapes, each read out once (`MeshBuckets.geometry`): a stone of 20 triangles, a chip of 8, a bone's shaft and knobs, a flat four-sided link (16).
  const shapes = {
    stone: new THREE.IcosahedronGeometry(1, 0),
    chip: new THREE.OctahedronGeometry(1, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    link: new THREE.TorusGeometry(1, 0.28, 2, 4),
    shackle: new THREE.TorusGeometry(1, 0.2, 2, 8),
  };
  const m4 = () => new THREE.Matrix4();
  const place = (x: number, y: number, z: number, turn: number, sx: number, sy: number, sz: number, tilt = 0) =>
    m4().makeTranslation(x, y, z).multiply(m4().makeRotationY(turn)).multiply(m4().makeRotationX(tilt)).multiply(m4().makeScale(sx, sy, sz));

  for (const h of c.heaps) {
    const v = (k: number) => vary(h.id, k);
    // The heap leans into its wall: its biggest stone just to the wall's side of its middle, the others in a fan round it toward the wall, and
    // a few chips spilt out into the room.
    const stones = h.r > 1.15 ? 4 : h.r > 0.9 ? 3 : 2;
    const chips = 2;
    const back = Math.atan2(-h.dz, -h.dx);
    for (let k = 0; k < stones + chips; k++) {
      const big = k < stones;
      let a: number;
      let d: number;
      let s: number;
      if (k === 0) {
        a = back;
        d = h.r * 0.25;
        s = h.r * (0.4 + 0.08 * v(50));
      } else if (big) {
        a = back + ((k - 1) / Math.max(1, stones - 2) - 0.5) * 2.6 + (v(10 + k) - 0.5) * 0.5;
        d = h.r * (0.4 + 0.35 * v(30 + k));
        s = h.r * (0.2 + 0.14 * v(50 + k));
      } else {
        a = back + Math.PI + (v(10 + k) - 0.5) * 2.8;
        d = h.r * (0.55 + 0.45 * v(30 + k));
        s = 0.07 + 0.08 * v(50 + k);
      }
      const x = h.x + Math.cos(a) * d;
      const z = h.z + Math.sin(a) * d;
      buckets.geometry(PROP_LOOKS.rubble, big ? shapes.stone : shapes.chip, place(x, h.y + s * 0.35, z, v(70 + k) * Math.PI, s, s * 0.62, s * (0.75 + 0.4 * v(90 + k))));
    }
    // Bones on the heap's near side, lying flat; a skull among them.
    for (let k = 0; k < h.bones; k++) {
      const a = v(110 + k) * Math.PI * 2;
      const x = h.x + h.dx * h.r * 0.5 + Math.cos(a) * h.r * 0.3;
      const z = h.z + h.dz * h.r * 0.5 + Math.sin(a) * h.r * 0.3;
      const turn = v(120 + k) * Math.PI;
      const len = 0.35 + 0.15 * v(130 + k);
      const frame = place(x, h.y + 0.04, z, turn, 1, 1, 1, (v(140 + k) - 0.5) * 0.3);
      buckets.geometry(BONE, shapes.box, frame.clone().multiply(m4().makeScale(0.04, 0.04, len)));
      for (const end of [-1, 1]) buckets.geometry(BONE, shapes.chip, frame.clone().multiply(m4().makeTranslation(0, 0, (end * len) / 2)).multiply(m4().makeScale(0.055, 0.045, 0.05)));
    }
    if (h.skull) {
      const x = h.x + h.dx * h.r * 0.6;
      const z = h.z + h.dz * h.r * 0.6;
      buckets.geometry(BONE, shapes.stone, place(x, h.y + 0.1, z, v(150) * Math.PI * 2, 0.12, 0.11, 0.14, -0.2));
    }
  }

  for (const ch of c.chains) {
    const turn = Math.atan2(ch.nx, ch.nz);
    // Each link a flat ring, turned a quarter to the one above it.
    for (let k = 0; k < ch.links; k++) {
      const y = ch.y - LINK * (k + 0.5);
      buckets.geometry(PROP_LOOKS.pole, shapes.link, place(ch.x, y, ch.z, turn + (k % 2 ? Math.PI / 2 : 0), 0.05, 0.085, 0.05));
    }
    // A ring on a plate at the top, and the shackle (an open cuff) at the end.
    buckets.geometry(PROP_LOOKS.pole, shapes.box, place(ch.x - ch.nx * 0.04, ch.y + 0.02, ch.z - ch.nz * 0.04, turn, 0.12, 0.12, 0.03));
    if (ch.shackle) {
      const y = ch.y - LINK * ch.links - 0.1;
      buckets.geometry(PROP_LOOKS.pole, shapes.shackle, place(ch.x, y, ch.z, turn + Math.PI / 2, 0.11, 0.11, 0.11, Math.PI / 2));
    }
  }
  for (const g of Object.values(shapes)) g.dispose();
  for (const mesh of buckets.meshes()) {
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  const shade = shadeOf(c);
  if (shade) group.add(shade);
  return group;
}

/** The cobwebs and floor cracks: one mesh of coloured, see-through triangles (null for none). */
function shadeOf(c: Clutter): THREE.Mesh | null {
  const positions: number[] = [];
  const colours: number[] = [];
  const vertex = (p: P3, r: number, g: number, b: number, a: number) => {
    positions.push(p.x, p.y, p.z);
    colours.push(r, g, b, a);
  };
  const tri = (p: P3, q: P3, s: P3, rgb: readonly number[], ap: number, aq = ap, as = ap) => {
    vertex(p, rgb[0]!, rgb[1]!, rgb[2]!, ap);
    vertex(q, rgb[0]!, rgb[1]!, rgb[2]!, aq);
    vertex(s, rgb[0]!, rgb[1]!, rgb[2]!, as);
  };
  const quad = (a: P3, b: P3, cc: P3, d: P3, rgb: readonly number[], aa: number, ab = aa, ac = aa, ad = aa) => {
    tri(a, b, cc, rgb, aa, ab, ac);
    tri(a, cc, d, rgb, aa, ac, ad);
  };
  const lerp = (p: P3, q: P3, t: number): P3 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });
  /** A strand from p to q, `w` wide across `n` (its plane's normal). */
  const strand = (p: P3, q: P3, n: P3, w: number, rgb: readonly number[], alpha: number) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    let sx = dy * n.z - dz * n.y;
    let sy = dz * n.x - dx * n.z;
    let sz = dx * n.y - dy * n.x;
    const l = Math.hypot(sx, sy, sz) || 1;
    sx = (sx / l) * (w / 2);
    sy = (sy / l) * (w / 2);
    sz = (sz / l) * (w / 2);
    quad({ x: p.x - sx, y: p.y - sy, z: p.z - sz }, { x: p.x + sx, y: p.y + sy, z: p.z + sz }, { x: q.x + sx, y: q.y + sy, z: q.z + sz }, { x: q.x - sx, y: q.y - sy, z: q.z - sz }, rgb, alpha);
  };

  for (const w of c.webs) {
    const rgb = WEB_DARK.map((d, k) => d + (WEB_LIT[k]! - d) * w.light);
    const a = w.anchors;
    // The web's plane, roughly: across the hub from its first anchor to the middle one.
    const u = { x: a[0]!.x - w.hub.x, y: a[0]!.y - w.hub.y, z: a[0]!.z - w.hub.z };
    const mid = a[Math.floor(a.length / 2)]!;
    const v = { x: mid.x - w.hub.x, y: mid.y - w.hub.y, z: mid.z - w.hub.z };
    const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    for (let k = 0; k < a.length; k++) {
      const p = a[k]!;
      const q = a[(k + 1) % a.length]!;
      // A faint sheet between the strands, the radial strand, and a ring of spiral strand (30 triangles a web).
      tri(w.hub, p, q, rgb, SHEET_ALPHA, SHEET_ALPHA * 0.4, SHEET_ALPHA * 0.4);
      strand(w.hub, p, n, STRAND, rgb, STRAND_ALPHA);
      strand(lerp(w.hub, p, 0.65), lerp(w.hub, q, 0.65), n, STRAND, rgb, STRAND_ALPHA * 0.8);
    }
  }

  const black = [0, 0, 0] as const;
  const up = { x: 0, y: 1, z: 0 };
  for (const cr of c.cracks) {
    const v = (k: number) => vary(cr.id, k);
    const y = cr.y + LIFT;
    const at = (x: number, z: number): P3 => ({ x: cr.x + x, y, z: cr.z + z });
    const half = cr.size / 2;
    if (cr.missing) {
      // A missing tile: a dark square, darkest along two inner edges (the hole's wall in shade), its edge fading softly out.
      const fringe = 0.07;
      const [a, b, cc, d] = [at(-half, -half), at(half, -half), at(half, half), at(-half, half)];
      quad(a, b, cc, d, black, 0.72);
      const out = (p: P3, sx: number, sz: number): P3 => ({ x: p.x + sx * fringe, y, z: p.z + sz * fringe });
      quad(a, b, out(b, 1, -1), out(a, -1, -1), black, 0.72, 0.72, 0, 0);
      quad(b, cc, out(cc, 1, 1), out(b, 1, -1), black, 0.72, 0.72, 0, 0);
      quad(cc, d, out(d, -1, 1), out(cc, 1, 1), black, 0.72, 0.72, 0, 0);
      quad(d, a, out(a, -1, -1), out(d, -1, 1), black, 0.72, 0.72, 0, 0);
      const lip = cr.size * 0.18;
      const flip = v(1) < 0.5 ? 1 : -1;
      quad(at(-half, flip * half), at(half, flip * half), at(half, flip * (half - lip)), at(-half, flip * (half - lip)), black, 0.25);
      quad(at(flip * half, -half), at(flip * half, half), at(flip * (half - lip), half), at(flip * (half - lip), -half), black, 0.25);
    } else {
      // A dark, ragged patch with cracks running out of it.
      const rim = Array.from({ length: 7 }, (_, k) => {
        const a = (k / 7) * Math.PI * 2;
        const r = half * (0.55 + 0.45 * v(10 + k));
        return at(Math.cos(a) * r, Math.sin(a) * r);
      });
      // Solid dark to halfway out, then fading to nothing at its ragged rim.
      const inner = rim.map((p) => ({ x: cr.x + (p.x - cr.x) * 0.5, y, z: cr.z + (p.z - cr.z) * 0.5 }));
      for (let k = 0; k < rim.length; k++) {
        const n = (k + 1) % rim.length;
        tri(at(0, 0), inner[k]!, inner[n]!, black, 0.7, 0.6, 0.6);
        quad(inner[k]!, rim[k]!, rim[n]!, inner[n]!, black, 0.6, 0, 0, 0.6);
      }
      for (let n = 0; n < 3; n++) {
        let a = v(20 + n) * Math.PI * 2;
        let p = at(Math.cos(a) * half * 0.2, Math.sin(a) * half * 0.2);
        for (let s = 0; s < 3; s++) {
          a += (v(30 + n * 3 + s) - 0.5) * 1.2;
          const l = half * (0.45 + 0.3 * v(40 + n * 3 + s));
          const q = { x: p.x + Math.cos(a) * l, y, z: p.z + Math.sin(a) * l };
          strand(p, q, up, 0.05 * (1 - s * 0.25), black, 0.85 - s * 0.15);
          p = q;
        }
      }
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  const mesh = new THREE.Mesh(geometry, clutterShadeMaterial());
  mesh.name = CLUTTER_SHADE;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
