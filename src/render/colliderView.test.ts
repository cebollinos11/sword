import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseArena } from '../tuning';
import { colliderView, seeThrough } from './colliderView';

const arena = parseArena(
  {
    name: 'box',
    walk: [
      { id: 'floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
      { id: 'deck', points: [[-10, 3, 2], [10, 3, 2], [10, 3, 10], [-10, 3, 10]] },
      { id: 'pool', water: true, points: [[-2, -1, -2], [2, -1, -2], [2, -1, 2]] },
      { id: 'pit', lava: true, points: [[-1, -2, -1], [0, -2, -2], [1, -2, -1], [1, -2, 1], [-1, -2, 1]] },
    ],
    walls: [
      { id: 'wall', a: [-10, -5], b: [10, -5], bottom: 0, top: 6 },
      { id: 'rail', a: [-10, -2], b: [10, -2], bottom: 0, top: 1 },
    ],
  },
  'box',
);

const view = colliderView(arena);
const vertices = (name: string) => (view.getObjectByName(name) as THREE.Mesh).geometry.getAttribute('position').count;

describe('colliderView', () => {
  it('makes one fan per Walk Surface kind, with its triangles', () => {
    expect(vertices('walk-plain')).toBe(2 * 2 * 3);
    expect(vertices('walk-water')).toBe(1 * 3);
    expect(vertices('walk-lava')).toBe(3 * 3);
  });

  it('makes a quad per Wall, from its bottom to its top', () => {
    const walls = view.getObjectByName('walls') as THREE.Mesh;
    expect(walls.geometry.getAttribute('position').count).toBe(2 * 6);
    walls.geometry.computeBoundingBox();
    expect(walls.geometry.boundingBox!.min.y).toBe(0);
    expect(walls.geometry.boundingBox!.max.y).toBe(6);
  });

  it('outlines each polygon edge, and leaves out empty kinds', () => {
    expect(vertices('walk-plain-edges')).toBe((4 + 4) * 2);
    expect(vertices('walls-edges')).toBe(2 * 4 * 2);
    const dry = colliderView(parseArena({ name: 'dry', walk: [{ id: 'f', points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] }], walls: [] }, 'dry'));
    expect(dry.children.map((c) => c.name)).toEqual(['walk-plain', 'walk-plain-edges']);
  });

  it('draws see-through, over the model, unfogged and without writing depth', () => {
    for (const o of view.children) {
      const m = (o as THREE.Mesh).material as THREE.Material;
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect((m as THREE.MeshBasicMaterial).fog).toBe(false);
      expect(o.renderOrder).toBeGreaterThan(1);
    }
  });

  it('makes a model dithered see-through and back', () => {
    const material = new THREE.MeshLambertMaterial();
    const model = new THREE.Group().add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    seeThrough(model, true);
    expect(material.alphaHash).toBe(true);
    expect(material.opacity).toBeLessThan(0.5);
    seeThrough(model, false);
    expect(material.alphaHash).toBe(false);
    expect(material.opacity).toBe(1);
  });
});
