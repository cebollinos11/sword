import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseArena } from '../tuning';
import { CameraCollider } from './cameraCollider';

const arena = parseArena(
  {
    name: 'box',
    walk: [
      { id: 'floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
      { id: 'deck', points: [[-10, 3, 2], [10, 3, 2], [10, 3, 10], [-10, 3, 10]] },
    ],
    walls: [
      { id: 'wall', a: [-10, -5], b: [10, -5], bottom: 0, top: 6 },
      { id: 'rail', a: [-10, -2], b: [10, -2], bottom: 0, top: 1 },
    ],
  },
  'box',
);
const collider = new CameraCollider(arena);

describe('CameraCollider', () => {
  it('pulls the camera in, short of a Wall between it and the pivot', () => {
    const eye = new THREE.Vector3(0, 1.6, -8);
    collider.pull(new THREE.Vector3(0, 1.6, 0), eye);
    expect(eye.z).toBeGreaterThan(-5);
    expect(eye.z).toBeLessThan(-4.5);
  });

  it('looks over a low rail, and leaves a clear view alone', () => {
    const eye = new THREE.Vector3(0, 1.6, -4);
    collider.pull(new THREE.Vector3(0, 1.6, 0), eye);
    expect(eye.toArray()).toEqual([0, 1.6, -4]);
  });

  it('stops under a floor above', () => {
    const eye = new THREE.Vector3(0, 5, 6);
    collider.pull(new THREE.Vector3(0, 1.6, 0), eye);
    expect(eye.y).toBeLessThan(3);
  });
});
