import * as THREE from 'three';

/**
 * The steel of blades (sword, polearm head, daggers): bright and partly unlit, so a Weapon reads against any Arena and its lighting.
 * The emissive part keeps it pale even on its shadowed faces; the lit part still shows its facets turning.
 */
export const bladeSteel = (): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: 0xeef2f6, emissive: 0x9aa2ac, flatShading: true });
