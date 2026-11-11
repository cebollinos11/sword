import type * as THREE from 'three';

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

interface Patch {
  readonly key: string;
  readonly apply: (shader: Shader) => void;
}

/**
 * Change a material's shader as it is compiled, alongside whatever else patches it (a material has one `onBeforeCompile`:
 * the dither fade and the body blood both want it). Each patch is named by `key` and applied once, in the order added.
 * Returns whether it was added (false: this material already has it).
 */
export function patchShader(material: THREE.Material, key: string, apply: (shader: Shader) => void): boolean {
  const patches = (material.userData.shaderPatches ??= []) as Patch[];
  if (patches.some((p) => p.key === key)) return false;
  patches.push({ key, apply });
  material.onBeforeCompile = (shader) => {
    for (const p of patches) p.apply(shader);
  };
  material.customProgramCacheKey = () => patches.map((p) => p.key).join('+');
  material.needsUpdate = true;
  return true;
}
