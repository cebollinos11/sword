/**
 * The dithered crossfade (docs/plans/big-battle.md, Stage 3): instead of blending (which needs sorting and shows the
 * model's inside through itself), a fading object drops a share of its pixels in a fixed 4 × 4 screen pattern. A Fighter's
 * full model keeps the pixels whose threshold is below its fade; a Soldier's impostor (`crowdView.ts`) keeps the others
 * of its own fade, so where the two overlap mid-swap they fill the screen between them rather than both showing.
 */
import * as THREE from 'three';

/** GLSL: the 4 × 4 ordered-dither threshold (in (0, 1)) of a screen pixel. */
export const BAYER_GLSL = /* glsl */ `
  float bayer4(vec2 p) {
    ivec2 q = ivec2(mod(p, 4.0));
    int i = q.x + q.y * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[i]) + 0.5) / 16.0;
  }
`;

/** The 4 × 4 ordered-dither threshold of pixel (x, y), as the shaders compute it (for tests). */
export function bayer4(x: number, y: number): number {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(((x % 4) + 4) % 4) + (((y % 4) + 4) % 4) * 4]! + 0.5) / 16;
}

/** Whether a full model faded to `fade` draws a pixel whose threshold is `threshold`; an impostor at `1 - fade` draws exactly the others. */
export const modelDraws = (fade: number, threshold: number): boolean => threshold < fade;

const PATCHED = 'ditherFade';

/**
 * Fade everything under `root` to `fade` (0 hidden, 1 whole) by dropping pixels in the dither pattern. The first call patches
 * each material it finds (and any found later, such as a Body model that loaded since), each reading `root`'s own fade.
 */
export function setDitherFade(root: THREE.Object3D, fade: number): void {
  const uniform = (root.userData.fade ??= { value: 1 }) as { value: number };
  uniform.value = fade;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const material = m as THREE.Material;
      if (material.userData[PATCHED]) continue;
      material.userData[PATCHED] = true;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uDitherFade = uniform;
        shader.fragmentShader = `uniform float uDitherFade;\n${BAYER_GLSL}\n${shader.fragmentShader}`.replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n  if (uDitherFade < 1.0 && bayer4(gl_FragCoord.xy) >= uDitherFade) discard;',
        );
      };
      material.customProgramCacheKey = () => PATCHED;
      material.needsUpdate = true;
    }
  });
}
