/**
 * Lava's look (render-only): the texture pack has no lava, so a material named `<Map>_Lava` is shaded procedurally, in world space so
 * it runs unbroken across every lava rect. A slow domain-warped flow of ridged noise: a dark cooled crust broken by bright
 * yellow-orange cracks that drift, and the whole surface breathes. The material keeps its own colour and glow (`HAZARD_LOOKS.lava`) as
 * the mid-orange the pattern shades round. Never in the compiled map, the Tuning Data hash or the Simulation.
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

/** Metres per noise cell: big slow plates of crust with cracks between. */
const SCALE = 0.22;

const NOISE = /* glsl */ `
float lvHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lvNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lvHash(i), lvHash(i + vec2(1.0, 0.0)), f.x), mix(lvHash(i + vec2(0.0, 1.0)), lvHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float lvFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { s += a * lvNoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
// 0 on the crust, 1 in a crack: ridges of warped noise, drifting.
float lvHeat(vec2 p, float t) {
  vec2 q = p * ${SCALE.toFixed(2)};
  vec2 w = vec2(lvFbm(q + vec2(0.0, t * 0.05)), lvFbm(q + vec2(5.2, 1.3 - t * 0.04)));
  float r = lvFbm(q + 2.2 * w + vec2(t * 0.03, 0.0));
  float ridge = 1.0 - abs(r * 2.0 - 1.0);
  return smoothstep(0.66, 0.93, ridge);
}`;

/** Shade `material` as lava. Safe to call once per material. */
export function applyLava(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lvTime = lavaTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLvPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLvPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLvPos;\nuniform float lvTime;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float lvH = lvHeat(vLvPos.xz, lvTime);
        float lvPulse = 0.85 + 0.15 * sin(lvTime * 1.3 + lvNoise(vLvPos.xz * 0.3) * 6.28);
        diffuseColor.rgb = mix(vec3(0.03, 0.012, 0.01), diffuseColor.rgb * vec3(1.0, 1.1, 0.6), lvH);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance * vec3(0.06, 0.03, 0.02), totalEmissiveRadiance * vec3(1.0, 1.2, 0.7), lvH) * lvPulse;`,
      );
  };
  material.customProgramCacheKey = () => 'lava1';
  material.needsUpdate = true;
}
