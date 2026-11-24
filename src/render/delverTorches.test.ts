import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf } from '../sim/arena';
import { arenaTuning, floorArenaName, floorOf, hallBase } from '../sim/delver';
import * as THREE from 'three';
import { sconcesOf, TorchLights } from './delverTorches';

const tuning = loadTuningData();

describe('sconcesOf', () => {
  it('hangs sconces in every Hall and along the Passages, never in a doorway, the same each time', () => {
    const name = floorArenaName(7, 1);
    const built = floorOf(tuning, name)!;
    const arena = arenaOf(arenaTuning(tuning, name), name);
    const sconces = sconcesOf(built.plan, arena);
    expect(sconcesOf(built.plan, arena)).toEqual(sconces);
    const pieces = built.plan.passages.flatMap((p) => p.pieces.map((q) => q.rect));
    for (const h of built.plan.halls) {
      const own = sconces.filter((s) => s.x > h.rect.x0 && s.x < h.rect.x1 && s.z > h.rect.z0 && s.z < h.rect.z1);
      expect(own.length, h.id).toBeGreaterThan(0);
      for (const s of own) {
        // A Hall's sconce is on its own floor's wall, not where a Passage meets it, and burns between its floor and its roof (its Enclosure's floor: an Uphill's is its low landing, under the Hall's `y`).
        const wall = { x: s.x - s.nx * 0.6, z: s.z - s.nz * 0.6 };
        expect(pieces.some((r) => wall.x > r.x0 && wall.x < r.x1 && wall.z > r.z0 && wall.z < r.z1), `${h.id} (${s.x}, ${s.z})`).toBe(false);
        expect(s.y).toBeGreaterThan(hallBase(h));
        expect(s.y).toBeLessThan(h.top);
      }
    }
    expect(sconces.length).toBeGreaterThan(built.plan.halls.length * 3);
  });
});

describe('TorchLights', () => {
  it('keeps each light on its flame while that flame is among the nearest, so what it lights never jumps', () => {
    // A row of flames 4 m apart, walked along a tenth of a metre a step: the pool's lights take new flames ahead only as the ones behind fade out.
    const flames = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: 2, z: 0, colour: 0xffa050 }));
    const torches = new TorchLights(flames);
    const camera = new THREE.PerspectiveCamera();
    const on = (light: THREE.PointLight) => flames.findIndex((f) => f.x === light.position.x);
    let before: number[] = [];
    let was: number[] = [];
    for (let x = 0; x <= 60; x += 0.1) {
      camera.position.set(x, 2, 0);
      torches.update(camera, x);
      const now = torches.flameLights.map(on);
      expect(new Set(now).size).toBe(now.length);
      torches.flameLights.forEach((light, k) => {
        // A light changes flame only once the one it was on had all but gone dark (faded out as the farthest of the pool), and comes up
        // dim on the next.
        if (before.length && now[k] !== before[k]) {
          expect(was[k]).toBeLessThan(1);
          expect(light.intensity).toBeLessThan(1);
        }
      });
      before = now;
      was = torches.flameLights.map((l) => l.intensity);
    }
  });
});
