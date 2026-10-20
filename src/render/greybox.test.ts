import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseArena } from '../tuning';
import { greybox, isGreybox } from './greybox';

const arena = parseArena(
  {
    name: 'gen:greybox:1',
    walk: [
      { id: 'low', points: [[0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3]] },
      { id: 'low2', points: [[3, 0, 0], [6, 0, 0], [6, 0, 3], [3, 0, 3]] },
      { id: 'high', points: [[0, 3, 3], [3, 3, 3], [3, 3, 6], [0, 3, 6]] },
      { id: 'abyss', abyss: true, points: [[-5, -10, -5], [10, -10, -5], [10, -10, 10], [-5, -10, 10]] },
    ],
    walls: [{ id: 'skirt', a: [0, 3], b: [3, 3], bottom: 0, top: 3 }],
  },
  'gen',
);

const setting = greybox(arena);
const named = (name: string) => setting.root.getObjectByName(name) as THREE.Mesh;
/** The colour of the vertex of `mesh` nearest height y. */
function colourAt(mesh: THREE.Mesh, y: number): string {
  const pos = mesh.geometry.getAttribute('position');
  const col = mesh.geometry.getAttribute('color');
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - y) < 0.05) return [col.getX(i), col.getY(i), col.getZ(i)].map((c) => c.toFixed(3)).join(',');
  throw new Error(`no vertex at height ${y}`);
}

describe('greybox: the look of a Generated Arena', () => {
  it('is used for Arenas named gen:*', () => {
    expect(isGreybox('gen:greybox:1')).toBe(true);
    expect(isGreybox('library')).toBe(false);
    expect(isGreybox('circle')).toBe(false);
  });

  it('tints Walk Surfaces by height: one colour per level', () => {
    const walk = named('greybox-walk');
    expect(walk.geometry.getAttribute('position').count).toBe(3 * 2 * 3);
    expect(colourAt(walk, 0)).not.toBe(colourAt(walk, 3));
  });

  it('draws the Abyss dark, apart from the floors', () => {
    const abyss = named('greybox-abyss');
    expect(abyss.geometry.getAttribute('position').count).toBe(2 * 3);
    const c = (abyss.material as THREE.MeshLambertMaterial).color;
    expect(Math.max(c.r, c.g, c.b)).toBeLessThan(0.15);
  });

  it('draws each Wall as a thin box from its bottom to its top', () => {
    const walls = named('greybox-walls');
    expect(walls.geometry.getAttribute('position').count).toBe(36);
    walls.geometry.computeBoundingBox();
    const box = walls.geometry.boundingBox!;
    expect(box.min.y).toBe(0);
    expect(box.max.y).toBe(3);
    expect(box.max.z - box.min.z).toBeLessThan(0.3);
    expect(box.max.x - box.min.x).toBeCloseTo(3, 1);
  });

  it('lays a grid texture over the floors, in world metres', () => {
    const walk = named('greybox-walk');
    expect((walk.material as THREE.MeshLambertMaterial).map).toBeInstanceOf(THREE.Texture);
    const uv = walk.geometry.getAttribute('uv');
    const pos = walk.geometry.getAttribute('position');
    expect(uv.count).toBe(pos.count);
    // The grid repeats every cell: u, v follow x, z.
    const k = [...Array(pos.count).keys()].find((i) => pos.getX(i) === 6 && pos.getZ(i) === 3)!;
    expect(uv.getX(k) - uv.getX(0)).not.toBe(0);
  });
});
