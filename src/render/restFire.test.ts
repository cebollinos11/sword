import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fireState, RestFire } from './restFire';

const resources = (root: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) materials.add(mat);
  });
  return { geometries, materials };
};

const flames = (fire: RestFire) => fire.root.getObjectByName('flames')!;

describe('the Rest fire', () => {
  it('is lit until the local Player has rested, then embers', () => {
    expect(fireState([], 0)).toBe('lit');
    expect(fireState([1], 0)).toBe('lit');
    expect(fireState([0], 0)).toBe('embers');
    expect(fireState([0, 1], 1)).toBe('embers');
    // A viewer that is no Player (-1, a spectator) sees it lit.
    expect(fireState([0], -1)).toBe('lit');
  });

  it('burns its flames while lit and shows only embers once rested', () => {
    const fire = new RestFire({ x: 1, y: 2, z: 3 });
    expect(fire.root.position.toArray()).toEqual([1, 2.03, 3]);
    fire.setState('lit');
    expect(flames(fire).visible).toBe(true);
    expect(fire.root.getObjectByName('embers')!.visible).toBe(false);
    fire.setState('embers');
    expect(flames(fire).visible).toBe(false);
    expect(fire.root.getObjectByName('embers')!.visible).toBe(true);
    fire.dispose();
  });

  it('flickers with the frames drawn', () => {
    const fire = new RestFire({ x: 0, y: 0, z: 0 });
    const before = flames(fire).scale.y;
    fire.animate(0.3);
    expect(flames(fire).scale.y).not.toBe(before);
    fire.dispose();
  });

  it('disposes every geometry and material it made', () => {
    const fire = new RestFire({ x: 0, y: 0, z: 0 });
    const { geometries, materials } = resources(fire.root);
    expect(geometries.size).toBeGreaterThan(0);
    expect(materials.size).toBeGreaterThan(0);
    const disposed: unknown[] = [];
    for (const r of [...geometries, ...materials]) r.addEventListener('dispose', () => disposed.push(r));
    fire.dispose();
    expect(disposed).toHaveLength(geometries.size + materials.size);
  });

  it('can be a Kit’s node instead, which it leaves to its owner', () => {
    const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const fire = new RestFire({ x: 0, y: 0, z: 0 }, node);
    expect(resources(fire.root).geometries.has(node.geometry)).toBe(true);
    let disposed = false;
    node.geometry.addEventListener('dispose', () => (disposed = true));
    fire.dispose();
    expect(disposed).toBe(false);
  });
});
