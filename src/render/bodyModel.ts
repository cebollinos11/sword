import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SkeletonTuning } from '../tuning';
import { BodyRig } from './bodyRig';

/** How a Fighter is drawn: the bare Skeleton from primitives, or a skinned model driven by it. */
export type Body = 'skeleton' | 'female';

const MODEL_FILES: Record<Exclude<Body, 'skeleton'>, string> = {
  female: 'models/female.glb',
};

/**
 * The Body to draw Fighters with: `?body=skeleton` (or `female`) in the page
 * URL, the female model otherwise. Outside a browser, the Skeleton.
 */
export function defaultBody(): Body {
  if (typeof window === 'undefined') return 'skeleton';
  const asked = new URLSearchParams(window.location.search).get('body');
  return asked === 'skeleton' || asked === 'female' ? asked : 'female';
}

const loaded = new Map<Body, Promise<THREE.Object3D>>();

function template(body: Exclude<Body, 'skeleton'>): Promise<THREE.Object3D> {
  let p = loaded.get(body);
  if (!p) {
    p = new GLTFLoader().loadAsync(import.meta.env.BASE_URL + MODEL_FILES[body]).then((gltf) => gltf.scene);
    loaded.set(body, p);
  }
  return p;
}

/** A Fighter's own copy of a Body model, posed through its rig. */
export interface BodyModel {
  readonly root: THREE.Object3D;
  readonly rig: BodyRig;
}

/**
 * Load a Body model for one Fighter: flat Lambert materials like the rest of
 * the scene, with its Team-coloured part (the skirt) in `colour`.
 */
export async function loadBodyModel(body: Exclude<Body, 'skeleton'>, colour: number, skeleton: SkeletonTuning): Promise<BodyModel> {
  const root = clone(await template(body));
  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    // The model is placed in world space by its bones, far from where its bind-pose bounds say.
    o.frustumCulled = false;
    const from = o.material as THREE.MeshStandardMaterial;
    o.material = new THREE.MeshLambertMaterial({
      color: from.name.endsWith('_Skirt') ? colour : from.color,
      side: from.side,
    });
  });
  return { root, rig: new BodyRig(root, skeleton) };
}
