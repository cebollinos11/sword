/**
 * Soft dark shading where Walls meet floor and ceiling (issue #171): a cheap fake ambient occlusion for a Map Editor map's model
 * (`mapModel.ts`), so a Delver Floor's Halls and Passages stop reading as flat boxes. At every inner corner a Wall's face makes with a floor
 * (its base) or a ceiling (its top: an Enclosure's roof, a Deck's underside), an L of thin strips lies on both surfaces, black fading from
 * `STRENGTH` at the seam to clear `REACH` out (vertex alpha); and where two Walls meet in a corner that folds into the room, a strip up each, fading
 * out from the corner the same way. Every Wall drawn gets it (an Enclosure's sides, faces, Rails, Walls) and each
 * Block's four sides (a Hall's pillars and solids). A doorway is open, so it has none.
 *
 * All of it is one mesh (`SEAM_SHADE`) in one transparent, unlit, fogged material that writes no depth and is pulled a little towards the
 * eye (`seamShadeMaterial`): one draw call per Floor. Render-only.
 */
import * as THREE from 'three';
import { surfaceHeight, surfacesAt, type Vec2 } from '../sim';
import type { ArenaGeometry } from '../tuning';

/** The shade's mesh's (and material's) name, which the game finds it by once the model is loaded (`stage.ts` `prepared`). */
export const SEAM_SHADE = 'Map_SeamShade';
/** How far (m) the shade reaches out from a seam over each surface. */
export const REACH = 0.5;
/** How dark the shade is at the seam (0–1, its black's alpha). */
const STRENGTH = 0.75;
/** The gradient across a strip: its rows at these shares of `REACH`, each this share of `STRENGTH` (an ease-out, so it fades softly). */
const ROWS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.3, 0.5],
  [1, 0],
];
/** A strip lies this far (m) off the surface it shades, so the two never share a plane (the polygon offset does the rest). */
const LIFT = 0.004;
/** A Wall's face is walked in pieces this long (m): each is shaded over the floors found just off its middle. */
const PIECE = 0.25;
/** How far (m) off a face the floors beside it are looked for. */
const PROBE = 0.1;
/** Heights this close (m) are one. */
const EPS = 0.05;

/** One box of a Wall as drawn: its line's ends, its heights, and how thick it is about its line (0 for a Block's side, which is its face). */
export interface ShadedWall {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly bottom: number;
  readonly top: number;
  readonly thick: number;
  /** A Block's side: the Block's middle, so only the face away from it (the one seen) is shaded. */
  readonly centre?: Vec2;
}

/** One face of a Wall as drawn: its ends, its heights, and the way out of it (unit). */
interface Face {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly bottom: number;
  readonly top: number;
  readonly nx: number;
  readonly nz: number;
}

/** The shade's material: black from the vertex alpha, unlit, fogged, writing no depth, pulled towards the eye so it never fights the surface it lies on. */
export function seamShadeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    name: SEAM_SHADE,
    color: 0x000000,
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
 * The shade along `walls` in `arena` (the compiled map's): one mesh, or null when no Wall meets a floor or a ceiling. `skip(i)` says a Walk
 * Surface is no floor to shade (deadly ground: lava, water, the abyss). `ceiling(i)` says how far (m) under Walk Surface `i` a ceiling is
 * drawn, or null for none: a roof's underside is the surface itself (0), a Deck's slab's lies under it (`DECK_SLAB`). A roof is no floor.
 */
export function seamShade(arena: ArenaGeometry, walls: readonly ShadedWall[], skip: (i: number) => boolean, ceiling: (i: number) => number | null): THREE.Mesh | null {
  const positions: number[] = [];
  const colours: number[] = [];
  const vertex = (p: THREE.Vector3Like, alpha: number) => {
    positions.push(p.x, p.y, p.z);
    colours.push(0, 0, 0, alpha);
  };
  /** A strip from the seam `p`–`q` out along `out(point, share)` (where a seam's point is at that share of `REACH`), in its rows. */
  const strip = (p: THREE.Vector3Like, q: THREE.Vector3Like, out: (s: THREE.Vector3Like, share: number) => THREE.Vector3Like, reach: number) => {
    for (let r = 0; r + 1 < ROWS.length; r++) {
      const [s0, a0] = ROWS[r]!;
      const [s1, a1] = ROWS[r + 1]!;
      // A strip cut short (a low Wall, a narrow ledge) fades over what it has.
      const [t0, t1] = [Math.min(s0, reach), Math.min(s1, reach)];
      if (t1 - t0 < 1e-6) break;
      const alpha = (t: number) => STRENGTH * (a0 + ((a1 - a0) * (t - s0)) / (s1 - s0));
      const [p0, q0, q1, p1] = [out(p, t0), out(q, t0), out(q, t1), out(p, t1)];
      const [b0, b1] = [alpha(t0), alpha(t1)];
      for (const [v, a] of [[p0, b0], [q0, b0], [q1, b1], [p0, b0], [q1, b1], [p1, b1]] as const) vertex(v, a);
    }
  };

  const faces: Face[] = [];
  for (const w of walls) {
    const dx = w.b.x - w.a.x;
    const dz = w.b.z - w.a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const pieces = Math.max(1, Math.round(len / PIECE));
    for (const side of [1, -1] as const) {
      // Out of this face, into the space beside it.
      const nx = (-dz / len) * side;
      const nz = (dx / len) * side;
      // A Block's face inside it is never seen.
      if (w.centre && nx * ((w.a.x + w.b.x) / 2 - w.centre.x) + nz * ((w.a.z + w.b.z) / 2 - w.centre.z) < 0) continue;
      const off = (p: Vec2): Vec2 => ({ x: p.x + (nx * w.thick) / 2, z: p.z + (nz * w.thick) / 2 });
      faces.push({ a: off(w.a), b: off(w.b), bottom: w.bottom, top: w.top, nx, nz });
      const face = (t: number): Vec2 => ({ x: w.a.x + dx * t + (nx * w.thick) / 2, z: w.a.z + dz * t + (nz * w.thick) / 2 });
      /** The surface's height at (x, z), `under` below it (its slab's underside). */
      const at = (i: number, x: number, z: number, under: number) => surfaceHeight(arena, i, x, z) - under;
      /** The strips over pieces `from` to `to` of surface `i`'s floor (`under` null) or ceiling (`under` m under it), reaching `reach` out. */
      const emit = (i: number, under: number | null, from: number, to: number, reach: number) => {
        const [f0, f1] = [face(from / pieces), face(to / pieces)];
        const u = under ?? 0;
        const p = { x: f0.x, y: at(i, f0.x, f0.z, u), z: f0.z };
        const q = { x: f1.x, y: at(i, f1.x, f1.z, u), z: f1.z };
        const lift = under === null ? LIFT : -LIFT;
        strip(p, q, (s, share) => {
          const [x, z] = [s.x + nx * REACH * share, s.z + nz * REACH * share];
          return { x, y: at(i, x, z, u) + lift, z };
        }, reach);
        // Up the face from a floor, down it from a ceiling.
        const along = under === null ? Math.min(1, (w.top - Math.max(p.y, q.y)) / REACH) : Math.min(1, (Math.min(p.y, q.y) - w.bottom) / REACH);
        const dir = under === null ? 1 : -1;
        strip(p, q, (s, share) => ({ x: s.x + nx * LIFT, y: s.y + dir * REACH * share, z: s.z + nz * LIFT }), along);
      };
      // Pieces alike side by side (the same flat floor or ceiling, reaching as far) are drawn as one run.
      type Run = { i: number; under: number | null; from: number; to: number; reach: number; flat: boolean };
      let open = new Map<string, Run>();
      for (let n = 0; n < pieces; n++) {
        const [f0, f1] = [face(n / pieces), face((n + 1) / pieces)];
        const mid = face((n + 0.5) / pieces);
        const [px, pz] = [mid.x + nx * PROBE, mid.z + nz * PROBE];
        const next = new Map<string, Run>();
        const add = (i: number, under: number | null, reach: number) => {
          const key = `${i}:${under}`;
          const flat = Math.abs(at(i, f0.x, f0.z, 0) - at(i, f1.x, f1.z, 0)) < 1e-6;
          const run = open.get(key);
          if (run && run.to === n && run.flat && flat && run.reach === reach) {
            run.to = n + 1;
            next.set(key, run);
            open.delete(key);
          } else next.set(key, { i, under, from: n, to: n + 1, reach, flat });
        };
        for (const i of surfacesAt(arena, px, pz)) {
          if (skip(i)) continue;
          const y = surfaceHeight(arena, i, px, pz);
          const under = ceiling(i);
          /** How far out (shares of `REACH`) the surface runs from this piece's middle, up to all of it. */
          const room = (): number => {
            for (const share of [1, 0.6, 0.3]) {
              const [x, z] = [mid.x + nx * REACH * share * 0.95, mid.z + nz * REACH * share * 0.95];
              if (surfacesAt(arena, x, z).includes(i)) return share;
            }
            return 0.15;
          };
          // A floor the Wall rises from: shaded on the floor out from the face, and up the face.
          if (under !== 0 && y > w.bottom + EPS && y < w.top - EPS) add(i, null, room());
          // A ceiling the Wall reaches: a roof's underside (the Walk Surface itself), or a Deck's slab's (under it).
          if (under === null) continue;
          const c = y - under;
          if (c > w.bottom + EPS && c <= w.top + EPS) add(i, under, room());
        }
        for (const r of open.values()) emit(r.i, r.under, r.from, r.to, r.reach);
        open = next;
      }
      for (const r of open.values()) emit(r.i, r.under, r.from, r.to, r.reach);
    }
  }
  // The inner corners where two faces meet square, a fold into the room (a Hall's corner, a Wall ending on another, a solid notch): a strip
  // up each face, out from the corner, over the heights both stand. A corner that juts out (a doorway's jamb, a pillar's edge) has none.
  const corners = new Map<string, { x: number; z: number; f: Face; g: Face; bottom: number; top: number }>();
  for (const f of faces)
    for (const g of faces) {
      if (Math.abs(f.nx * g.nx + f.nz * g.nz) > 0.01) continue;
      // Where the two faces' lines cross: on f's line, at g's.
      const along = { x: -f.nz, z: f.nx };
      const t = (along.x * (g.a.x - f.a.x) + along.z * (g.a.z - f.a.z)) / (along.x * along.x + along.z * along.z);
      const c = { x: f.a.x + along.x * t, z: f.a.z + along.z * t };
      if (Math.abs(g.nx * (c.x - g.a.x) + g.nz * (c.z - g.a.z)) > 1e-3 || Math.abs(f.nx * (c.x - f.a.x) + f.nz * (c.z - f.a.z)) > 1e-3) continue;
      /** How far `h` runs from the corner along (dx, dz): its nearest and farthest ends. */
      const span = (h: Face, dx: number, dz: number): [number, number] => {
        const [p, q] = [dx * (h.a.x - c.x) + dz * (h.a.z - c.z), dx * (h.b.x - c.x) + dz * (h.b.z - c.z)];
        return [Math.min(p, q), Math.max(p, q)];
      };
      // g runs from the corner out of f, and f from the corner out of g (each reaching the corner): the fold is into both.
      const [g0, g1] = span(g, f.nx, f.nz);
      const [f0, f1] = span(f, g.nx, g.nz);
      if (g0 > EPS || g1 < PROBE || f0 > EPS || f1 < PROBE) continue;
      const bottom = Math.max(f.bottom, g.bottom);
      const top = Math.min(f.top, g.top);
      if (top - bottom < EPS) continue;
      // A Wall drawn in bands by height meets its neighbour once, over all of them.
      const key = `${c.x.toFixed(2)},${c.z.toFixed(2)},${f.nx.toFixed(2)},${f.nz.toFixed(2)},${g.nx.toFixed(2)},${g.nz.toFixed(2)}`;
      const had = corners.get(key);
      corners.set(key, had ? { ...had, bottom: Math.min(had.bottom, bottom), top: Math.max(had.top, top) } : { ...c, f, g, bottom, top });
    }
  for (const { x, z, f, g, bottom: foot, top: head } of corners.values()) {
    // From the lowest floor in the corner to the highest ceiling over it, within the Walls: none where no floor lies (outside the rooms).
    const [px, pz] = [x + (f.nx + g.nx) * PROBE, z + (f.nz + g.nz) * PROBE];
    const floors: number[] = [];
    const ceilings: number[] = [];
    for (const i of surfacesAt(arena, px, pz)) {
      if (skip(i)) continue;
      const y = surfaceHeight(arena, i, px, pz);
      const under = ceiling(i);
      if (under !== 0 && y > foot - EPS && y < head - EPS) floors.push(y);
      if (under !== null && y - under > foot + EPS && y - under < head + EPS) ceilings.push(y - under);
    }
    if (floors.length === 0) continue;
    const bottom = Math.min(...floors);
    const top = ceilings.length > 0 ? Math.max(...ceilings) : head;
    if (top - bottom < EPS) continue;
    // Up f, out from the corner along g's way out (the room's side of f), only as far as f runs.
    const reach = Math.min(1, (Math.max(g.nx * (f.a.x - x) + g.nz * (f.a.z - z), g.nx * (f.b.x - x) + g.nz * (f.b.z - z))) / REACH);
    strip({ x, y: bottom, z }, { x, y: top, z }, (s, share) => ({ x: s.x + g.nx * REACH * share + f.nx * LIFT, y: s.y, z: s.z + g.nz * REACH * share + f.nz * LIFT }), reach);
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  const mesh = new THREE.Mesh(geometry, seamShadeMaterial());
  mesh.name = SEAM_SHADE;
  return mesh;
}
