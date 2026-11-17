import * as THREE from 'three';

/** The steel's emissive colour (Rarity tints it: `rarityTint`). */
export const STEEL_EMISSIVE = 0x9aa2ac;

/**
 * The steel of blades (sword, polearm head, daggers): bright and partly unlit, so a Weapon reads against any Arena and its lighting.
 * The emissive part keeps it pale even on its shadowed faces; the lit part still shows its facets turning.
 */
export const bladeSteel = (): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color: 0xeef2f6, emissive: STEEL_EMISSIVE, flatShading: true });
