/**
 * Triplanar texturing for the Battle maps: their models and terrain have no UV maps, so a surface's texture is projected
 * along the three world axes and blended by the way the surface faces (its normal), the top plane for floors, the side
 * planes for walls. Sampling by world position makes a texture continuous across pieces and independent of each mesh's
 * transform. Each texture is divided by its own average colour, so it only adds detail: the material keeps its colour
 * (and a vertex colour its tint). Render-only. Textures are CC0 (public/textures/battle/CREDITS.txt).
 */
import * as THREE from 'three';

export type Surface = 'stone' | 'rock' | 'dungeon' | 'grass' | 'dirt' | 'wood' | 'tile' | 'cobble' | 'plaster';

/** Each Surface's texture (public/textures/battle/<name>.png) and how many times it repeats per metre. */
const SURFACES: Record<Surface, number> = {
  stone: 0.45,
  rock: 0.3,
  dungeon: 0.3,
  grass: 0.6,
  dirt: 0.5,
  wood: 0.6,
  tile: 0.7,
  cobble: 0.5,
  plaster: 0.4,
};

/** How sharply the planes separate: the blend weight of a plane is its normal component to this power. */
const SHARPNESS = 4;
/** Magnified texels stay crisp (the textures are only 64 px), shrunk ones are filtered. */
const MAG_FILTER = THREE.NearestFilter;

/** The Surface a Battle map material of this name is textured as, or null to leave it flat (glow, metal, cloth, glass, foliage). */
export function surfaceOf(name: string): Surface | null {
  const [map = '', part = ''] = name.split('_', 2);
  if (/Fire|Gold|Rune|Lava|Crust|Window|Banner|Awning|Leaf|DeckLine|Beam/.test(part)) return null;
  if (map === 'Cavern' && /^(Floor|Plat|Wall|Deck)/.test(part)) return 'dungeon';
  if (/Rock|Rubble/.test(part)) return 'rock';
  if (/Grass|Moss/.test(part)) return 'grass';
  if (/Dirt/.test(part)) return 'dirt';
  if (/Plaster/.test(part)) return 'plaster';
  if (/Tile|Slate/.test(part)) return 'tile';
  if (/Cobble|Plaza/.test(part)) return 'cobble';
  if (/Wood|Timber|Eave|Deck|Bark/.test(part)) return 'wood';
  if (/Stone|Wall/.test(part)) return 'stone';
  return null;
}

interface Shared {
  map: { value: THREE.Texture | null };
  mean: { value: THREE.Vector3 };
  scale: { value: number };
}
const shared = new Map<Surface, Shared>();

/** The uniforms of a Surface, shared by every material using it; its texture loads on first use. */
function sharedOf(surface: Surface): Shared {
  let s = shared.get(surface);
  if (s) return s;
  s = { map: { value: null }, mean: { value: new THREE.Vector3(1, 1, 1) }, scale: { value: SURFACES[surface] } };
  shared.set(surface, s);
  const uniforms = s;
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/battle/${surface}.png`, (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = MAG_FILTER;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    uniforms.mean.value.copy(averageOf(texture.image as CanvasImageSource & { width: number; height: number }));
    uniforms.map.value = texture;
  });
  return s;
}

/** The average colour of an image, in linear light (what the shader sees after sRGB decoding). */
function averageOf(image: CanvasImageSource & { width: number; height: number }): THREE.Vector3 {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.Vector3(1, 1, 1);
  g.drawImage(image, 0, 0);
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const sum = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < px.length; i += 4) {
    c.setRGB(px[i]! / 255, px[i + 1]! / 255, px[i + 2]! / 255, THREE.SRGBColorSpace);
    sum.x += c.r;
    sum.y += c.g;
    sum.z += c.b;
  }
  return sum.multiplyScalar(4 / px.length).max(new THREE.Vector3(0.02, 0.02, 0.02));
}

/** Texture `material` triplanar as `surface`: it keeps its colour and gains the texture's detail. Safe to call once per material. */
export function applyTriplanar(material: THREE.Material, surface: Surface): void {
  const s = sharedOf(surface);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tpMap = s.map;
    shader.uniforms.tpMean = s.mean;
    shader.uniforms.tpScale = s.scale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTpNormal = mat3(modelMatrix) * objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTpPos;
        varying vec3 vTpNormal;
        uniform sampler2D tpMap;
        uniform vec3 tpMean;
        uniform float tpScale;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 w = pow(abs(normalize(vTpNormal)), vec3(${SHARPNESS.toFixed(1)}));
          w /= w.x + w.y + w.z;
          vec3 p = vTpPos * tpScale;
          vec3 t = texture2D(tpMap, p.zy).rgb * w.x + texture2D(tpMap, p.xz).rgb * w.y + texture2D(tpMap, p.xy).rgb * w.z;
          diffuseColor.rgb *= t / tpMean;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'triplanar';
  material.needsUpdate = true;
}

/** Texture every material under `root` whose name says what it is (`surfaceOf`); a model shared between Matches is done once. */
export function texturedModel(root: THREE.Object3D): void {
  if (root.userData.triplanar) return;
  root.userData.triplanar = true;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const surface = surfaceOf((m as THREE.Material).name);
      if (surface) applyTriplanar(m as THREE.Material, surface);
    }
  });
}
