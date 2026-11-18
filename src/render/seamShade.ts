/**
 * Soft dark shading where Walls meet floor and ceiling (issue #171): a cheap fake ambient occlusion for a Map Editor map's model
 * (`mapModel.ts`), so a Delver Floor's Halls and Passages stop reading as flat boxes. At every inner corner a Wall's face makes with a floor
 * (its base) or a ceiling (its top: an Enclosure's roof, a Deck's underside), an L of thin strips lies on both surfaces, black fading from
 * `STRENGTH` at the seam to clear `REACH` out (vertex alpha). Every Wall drawn gets it (an Enclosure's sides, faces, Rails, Walls) and each
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
      const face = (t: number): Vec2 => ({ x: w.a.x + dx * t + (nx * w.thick) / 2, z: w.a.z + dz * t + (nz * w.thick) / 2 });
      for (let n = 0; n < pieces; n++) {
        const [f0, f1] = [face(n / pieces), face((n + 1) / pieces)];
        const mid = face((n + 0.5) / pieces);
        const [px, pz] = [mid.x + nx * PROBE, mid.z + nz * PROBE];
        for (const i of surfacesAt(arena, px, pz)) {
          if (skip(i)) continue;
          const y = surfaceHeight(arena, i, px, pz);
          const under = ceiling(i);
          /** The surface's height at (x, z), `under` below it (its slab's underside). */
          const at = (x: number, z: number, under: number) => surfaceHeight(arena, i, x, z) - under;
          /** How far out (shares of `REACH`) the surface runs from this piece's middle, up to all of it. */
          const room = (): number => {
            for (const share of [1, 0.6, 0.3]) {
              const [x, z] = [mid.x + nx * REACH * share * 0.95, mid.z + nz * REACH * share * 0.95];
              if (surfacesAt(arena, x, z).includes(i)) return share;
            }
            return 0.15;
          };
          // A floor the Wall rises from: shaded on the floor out from the face, and up the face.
          if (under !== 0 && y > w.bottom + EPS && y < w.top - EPS) {
            const reach = room();
            const p = { x: f0.x, y: at(f0.x, f0.z, 0), z: f0.z };
            const q = { x: f1.x, y: at(f1.x, f1.z, 0), z: f1.z };
            strip(p, q, (s, share) => {
              const [x, z] = [s.x + nx * REACH * share, s.z + nz * REACH * share];
              return { x, y: at(x, z, 0) + LIFT, z };
            }, reach);
            const up = Math.min(1, (w.top - Math.max(p.y, q.y)) / REACH);
            strip(p, q, (s, share) => ({ x: s.x + nx * LIFT, y: s.y + REACH * share, z: s.z + nz * LIFT }), up);
          }
          // A ceiling the Wall reaches: a roof's underside (the Walk Surface itself), or a Deck's slab's (under it).
          if (under === null) continue;
          const c = y - under;
          if (c <= w.bottom + EPS || c > w.top + EPS) continue;
          const reach = room();
          const p = { x: f0.x, y: at(f0.x, f0.z, under), z: f0.z };
          const q = { x: f1.x, y: at(f1.x, f1.z, under), z: f1.z };
          strip(p, q, (s, share) => {
            const [x, z] = [s.x + nx * REACH * share, s.z + nz * REACH * share];
            return { x, y: at(x, z, under) - LIFT, z };
          }, reach);
          const down = Math.min(1, (Math.min(p.y, q.y) - w.bottom) / REACH);
          strip(p, q, (s, share) => ({ x: s.x + nx * LIFT, y: s.y - REACH * share, z: s.z + nz * LIFT }), down);
        }
      }
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  const mesh = new THREE.Mesh(geometry, seamShadeMaterial());
  mesh.name = SEAM_SHADE;
  return mesh;
}
