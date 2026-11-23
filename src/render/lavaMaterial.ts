/**
 * Lava's look (render-only): the texture pack has no lava, so a material named `<Map>_Lava` is shaded from one small procedural texture,
 * baked once: a tileable 32x32 map of crack heat, read with nearest filtering so its texels stay chunky like the pack's. Two copies of it
 * drift across the floor in world space (so lava runs unbroken over every rect) and are combined, then stepped into a four-colour ramp: dark
 * crust, red, orange, yellow-hot. Each pixel costs two texture reads, no noise maths. The material keeps its own colour and glow
 * (`HAZARD_LOOKS.lava`) as the orange the ramp is cut from. Never in the compiled map, the Tuning Data hash or the Simulation.
 */
import * as THREE from 'three';

/** The clock every lava material reads (s); `animateLava` sets it once a frame. */
const lavaTime = { value: 0 };

/** Advance the lava's flow to time `seconds`. */
export function animateLava(seconds: number): void {
  lavaTime.value = seconds;
}

/** Whether a material of this name is lava (`Map_Lava`, `Cavern_Lava`; not the glowing brush `Map_LavaGlow`). */
export const isLava = (name: string): boolean => /_Lava$/.test(name);

/** The heat texture's size (texels a side) and how many of them lie in a metre (a texel is about 17 cm: as chunky as the stone beside it). */
export const LAVA_SIZE = 32;
const TEXELS_PER_M = 6;

/** A tiny seeded hash in [0, 1) for lattice point (x, y). */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a `period`-cell lattice that wraps, so the texture tiles. At (x, y) in [0, 1). */
function tiled(x: number, y: number, period: number, seed: number): number {
  const fx = x * period;
  const fy = y * period;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = (fx - ix) ** 2 * (3 - 2 * (fx - ix));
  const sy = (fy - iy) ** 2 * (3 - 2 * (fy - iy));
  const at = (a: number, b: number) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
  const bottom = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** The heat of each texel (0 crust .. 255 crack): ridged, tiling noise, in two scales. Pure: always the same. */
export function lavaHeat(): Uint8Array {
  const out = new Uint8Array(LAVA_SIZE * LAVA_SIZE);
  for (let y = 0; y < LAVA_SIZE; y++) {
    for (let x = 0; x < LAVA_SIZE; x++) {
      const u = x / LAVA_SIZE;
      const v = y / LAVA_SIZE;
      const n = tiled(u, v, 3, 1) * 0.6 + tiled(u, v, 6, 2) * 0.4;
      const ridge = 1 - Math.abs(n * 2 - 1);
      out[y * LAVA_SIZE + x] = Math.round(Math.min(1, Math.max(0, (ridge - 0.5) / 0.42)) * 255);
    }
  }
  return out;
}

let heatTexture: THREE.DataTexture | undefined;
const texture = (): THREE.DataTexture => {
  if (!heatTexture) {
    heatTexture = new THREE.DataTexture(lavaHeat(), LAVA_SIZE, LAVA_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    heatTexture.wrapS = heatTexture.wrapT = THREE.RepeatWrapping;
    heatTexture.magFilter = heatTexture.minFilter = THREE.NearestFilter;
    heatTexture.generateMipmaps = false;
    heatTexture.needsUpdate = true;
  }
  return heatTexture;
};

/** Shade `material` as lava. Safe to call once per material. */
export function applyLava(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lvTime = lavaTime;
    shader.uniforms.lvMap = { value: texture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLvPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLvPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLvPos;\nuniform float lvTime;\nuniform sampler2D lvMap;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Two drifting copies of the heat map, on the same texel grid so the pixels stay square; stepped into four levels.
        vec2 lvUv = vLvPos.xz * ${(TEXELS_PER_M / LAVA_SIZE).toFixed(4)};
        float lvA = texture2D(lvMap, lvUv + vec2(lvTime * 0.011, lvTime * 0.006)).r;
        float lvB = texture2D(lvMap, lvUv * vec2(-1.0, 1.0) + vec2(0.37 - lvTime * 0.008, 0.61 + lvTime * 0.013)).r;
        float lvLevel = floor(clamp(lvA * lvB * 1.7, 0.0, 0.999) * 4.0);
        vec3 lvRamp = lvLevel < 1.0 ? vec3(0.09, 0.03, 0.02) : lvLevel < 2.0 ? vec3(0.55, 0.12, 0.05) : lvLevel < 3.0 ? vec3(1.0, 0.45, 0.1) : vec3(1.0, 0.85, 0.35);
        diffuseColor.rgb = lvRamp * diffuseColor.rgb / vec3(1.0, 0.29, 0.06);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= lvRamp * (lvLevel < 1.0 ? 0.25 : 1.0) * (0.9 + 0.1 * step(0.5, fract(lvTime * 0.5)));`,
      );
  };
  material.customProgramCacheKey = () => 'lava2';
  material.needsUpdate = true;
}
