/**
 * A Battlefield drawn (docs/plans/big-battle.md, Stage 2): its heightfield as a grassy terrain mesh, under the sky dome
 * at dusk, with a low warm sun and a long haze for an open field. The mesh's triangles inside the field are exactly the
 * Walk Surfaces' (each grid cell split along the same diagonal), so what stands on the ground stands on what is drawn;
 * beyond the field the ground runs on at the edge's height out into the haze. Render-only.
 */
import * as THREE from 'three';
import { battlefieldHeight, type Heightfield } from '../sim';
import { sky, type SkyLook } from './sky';

/** The haze: its colour (also the sky's horizon and the background), where it starts and where nothing shows through (m). */
const HAZE = 0x9a93a0;
const HAZE_NEAR = 70;
const HAZE_FAR = 320;
/** A dusky sky over the field, sinking into the haze. */
const BATTLE_SKY: SkyLook = {
  deep: 0x22305e,
  glow: 0xc27a62,
  highlight: 0xffd6a0,
  horizon: HAZE,
};
/** How far beyond the field's edge (m) the ground runs on, in a few long strips. */
const BEYOND = [40, 120, 400];
const GRASS = new THREE.Color(0x5f7f42);
const DRY = new THREE.Color(0x8a8a4e);

/** Grid lines along one axis: every heightfield sample across the field, then the strips beyond it on either side. */
function lines(hf: Heightfield): number[] {
  const half = hf.size / 2;
  const inside = Array.from({ length: hf.side }, (_, k) => -half + k * hf.cell);
  return [...BEYOND.map((b) => -half - b).reverse(), ...inside, ...BEYOND.map((b) => half + b)];
}

/** A cheap fixed noise in [0, 1) for a vertex (render-only, so not the Simulation's generator). */
const speckle = (x: number, z: number): number => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** The Battlefield's ground as a mesh: `battlefieldHeight` at every grid corner, each cell two triangles split as the Walk Surfaces are. */
export function terrainMesh(hf: Heightfield): THREE.Mesh {
  const xs = lines(hf);
  const side = xs.length;
  const positions = new Float32Array(side * side * 3);
  const colours = new Float32Array(side * side * 3);
  const colour = new THREE.Color();
  for (let r = 0; r < side; r++)
    for (let c = 0; c < side; c++) {
      const k = r * side + c;
      const x = xs[c]!;
      const z = xs[r]!;
      const y = battlefieldHeight(hf, x, z);
      positions.set([x, y, z], 3 * k);
      // Drier on the hilltops, a little speckled.
      colour
        .copy(GRASS)
        .lerp(DRY, Math.min(1, Math.max(0, 0.35 + y * 0.15)))
        .multiplyScalar(0.88 + 0.16 * speckle(x, z));
      colours.set([colour.r, colour.g, colour.b], 3 * k);
    }
  const index: number[] = [];
  for (let r = 0; r < side - 1; r++)
    for (let c = 0; c < side - 1; c++) {
      const a = r * side + c;
      // (c, r), (c + 1, r), (c + 1, r + 1) and (c, r), (c + 1, r + 1), (c, r + 1), wound to face up.
      index.push(a, a + side + 1, a + 1, a, a + side, a + side + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'terrain';
  return mesh;
}

/** A Battlefield's setting: the sky, the light, the terrain, and the haze (background and fog). */
export function battlefieldSetting(hf: Heightfield): {
  root: THREE.Group;
  background: THREE.Color;
  fog: THREE.Fog;
} {
  const root = new THREE.Group();
  root.add(sky(BATTLE_SKY));
  root.add(new THREE.HemisphereLight(0xd4dcff, 0x4b5631, 1.15));
  const sun = new THREE.DirectionalLight(0xffd6a6, 1.7);
  sun.position.set(60, 45, -80);
  root.add(sun);
  root.add(terrainMesh(hf));
  return {
    root,
    background: new THREE.Color(HAZE),
    fog: new THREE.Fog(HAZE, HAZE_NEAR, HAZE_FAR),
  };
}
