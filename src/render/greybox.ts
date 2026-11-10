import * as THREE from 'three';
import type { ArenaGeometry } from '../tuning';
import { walkFans } from './colliderView';
import { applyTriplanar } from './triplanar';

/** Floors are tinted from the first colour (lowest) to the second (GREYBOX_TOP metres up and higher), so levels read at a glance. */
const LOW_TINT = new THREE.Color(0x8fa3b8);
const HIGH_TINT = new THREE.Color(0xd9a066);
const GREYBOX_TOP = 6;
const ABYSS_COLOR = 0x0b0b10;
const WALL_COLOR = 0x9a9a9a;
/** How thick (m) a Wall is drawn. */
const WALL_THICKNESS = 0.12;
const BACKGROUND = 0x2a2d33;
/** The grid texture covers this many metres: a faint line every metre, a strong one every 3 m (a greybox cell). */
const GRID_METRES = 3;
const GRID_PIXELS_PER_METRE = 32;

/** A Generated Arena (named `gen:*`) is drawn as a greybox when its Kit has no model (or its Layout is not known). */
export const isGreybox = (name: string): boolean => name.startsWith('gen:');

/** The grid tile: white, a faint line every metre and a strong one along its own edges (multiplied into the floor's tint). */
function gridTexture(): THREE.DataTexture {
  const size = GRID_METRES * GRID_PIXELS_PER_METRE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const edge = x < 2 || y < 2;
      const metre = x % GRID_PIXELS_PER_METRE === 0 || y % GRID_PIXELS_PER_METRE === 0;
      const v = edge ? 120 : metre ? 200 : 255;
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function fanMesh(name: string, positions: number[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  return m;
}

/** The floors: tinted by each vertex's height, with the grid laid on in world metres (u, v follow x, z). */
function floors(arena: ArenaGeometry, textured = false): THREE.Mesh {
  const positions = walkFans(
    arena.walk.filter((s) => !s.abyss && !(textured && (s.lava || s.water))),
    0.01,
  );
  // A Battle map's floor takes the triplanar stone in place of the metre grid (the grid is for judging a Generated Arena's dimensions).
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, ...(textured ? {} : { map: gridTexture() }), side: THREE.DoubleSide });
  if (textured) applyTriplanar(material, 'stone');
  const mesh = fanMesh('greybox-walk', positions, material);
  const colors: number[] = [];
  const uvs: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
    c.copy(LOW_TINT).lerp(HIGH_TINT, Math.min(1, Math.max(0, y / GREYBOX_TOP)));
    colors.push(c.r, c.g, c.b);
    uvs.push(x / GRID_METRES, z / GRID_METRES);
  }
  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return mesh;
}

/** Each Wall as a thin box from its bottom to its top, centred on its line. */
function walls(arena: ArenaGeometry, textured = false): THREE.Mesh {
  const positions: number[] = [];
  for (const w of arena.walls) {
    const dx = w.b.x - w.a.x;
    const dz = w.b.z - w.a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (WALL_THICKNESS / 2);
    const nz = (dx / len) * (WALL_THICKNESS / 2);
    // Corners: 0-3 at the bottom, 4-7 at the top; a then b, on either side of the line.
    const corner = (k: number): [number, number, number] => {
      const end = k & 1 ? w.b : w.a;
      const side = k & 2 ? 1 : -1;
      return [end.x + side * nx, k & 4 ? w.top : w.bottom, end.z + side * nz];
    };
    const faces = [
      [0, 1, 5, 4],
      [3, 2, 6, 7],
      [2, 0, 4, 6],
      [1, 3, 7, 5],
      [4, 5, 7, 6],
      [2, 3, 1, 0],
    ];
    for (const [a, b, c, d] of faces) for (const k of [a, b, c, a, c, d]) positions.push(...corner(k!));
  }
  const material = new THREE.MeshLambertMaterial({ color: WALL_COLOR, flatShading: true, side: THREE.DoubleSide });
  if (textured) applyTriplanar(material, 'stone');
  return fanMesh('greybox-walls', positions, material);
}

/** The Arena's Abyss, drawn dark, if it has one (shared with a Kit's look). */
export function abyss(arena: ArenaGeometry): THREE.Mesh | undefined {
  const surfaces = arena.walk.filter((s) => s.abyss);
  return surfaces.length > 0 ? fanMesh('greybox-abyss', walkFans(surfaces), new THREE.MeshLambertMaterial({ color: ABYSS_COLOR, side: THREE.DoubleSide })) : undefined;
}

/**
 * The look of an Arena with no model, built in the Arena Lab (a Generated Arena): Walk Surfaces tinted by height under a
 * metre grid, a dark Abyss, and Walls as thin grey boxes, under a plain grey sky. Render-only.
 */
export function greybox(arena: ArenaGeometry): { root: THREE.Group; background: THREE.Color; fog: THREE.Fog } {
  const root = new THREE.Group();
  root.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 12, -4);
  root.add(sun);
  root.add(floors(arena));
  const pit = abyss(arena);
  if (pit) root.add(pit);
  if (arena.walls.length > 0) root.add(walls(arena));
  return { root, background: new THREE.Color(BACKGROUND), fog: new THREE.Fog(BACKGROUND, 40, 120) };
}

/** Lava glows, water is a flat blue: a Battle map's hazards, drawn over the floor they lie on. */
const LAVA_COLOR = 0xff5a1f;
const WATER_COLOR = 0x2f7fe0;

/**
 * A hand-built Battle map with no model (docs/plans/map-editor.md, Stage 4: a map from the Map Editor, until it has one), drawn from its
 * Walk Surfaces and Walls: floors tinted by height under the triplanar stone, Walls as thin triplanar boxes, lava and water coloured, the
 * Abyss dark. Only the map itself: the sky and light are the Battlefield's (`battlefieldSetting`). Render-only.
 */
export function battleGreybox(arena: ArenaGeometry): THREE.Group {
  const root = new THREE.Group();
  root.add(floors(arena, true));
  for (const [kind, color] of [['lava', LAVA_COLOR], ['water', WATER_COLOR]] as const) {
    const surfaces = arena.walk.filter((s) => s[kind]);
    if (surfaces.length === 0) continue;
    const material = new THREE.MeshLambertMaterial({ color, emissive: kind === 'lava' ? color : 0, emissiveIntensity: 0.6, side: THREE.DoubleSide });
    root.add(fanMesh(`greybox-${kind}`, walkFans(surfaces, 0.01), material));
  }
  const pit = abyss(arena);
  if (pit) root.add(pit);
  if (arena.walls.length > 0) root.add(walls(arena, true));
  return root;
}
