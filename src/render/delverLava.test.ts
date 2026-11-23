import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { floorArenaName, floorOf } from '../sim/delver';
import { noLava } from '../sim/delver/flat.testdata';
import { LAVA_INTENSITY, LAVA_LIGHT_COLOUR, LAVA_POOL, LavaLights, lavaPointsOf, type LavaPoint } from './delverLava';

const tuning = loadTuningData();

describe('lavaPointsOf', () => {
  it('gives each lava Hall a point 1 m over the centre of its largest lava rect, at the lava height + 1', () => {
    // Seed 3 Floor 1 holds a three-rect trough, seed 10 a pit, seed 16 a river.
    for (const [seed, n] of [[3, 1], [10, 1], [16, 1]] as const) {
      const plan = floorOf(tuning, floorArenaName(seed, n))!.plan;
      const halls = plan.halls.filter((h) => h.lava);
      const points = lavaPointsOf(plan);
      expect(points).toHaveLength(halls.length);
      expect(points.length).toBeGreaterThan(0);
      halls.forEach((h, k) => {
        const area = (r: { x0: number; z0: number; x1: number; z1: number }) => (r.x1 - r.x0) * (r.z1 - r.z0);
        const big = h.lava!.rects.reduce((a, r) => (area(r) > area(a) ? r : a));
        expect(points[k]).toEqual({ x: (big.x0 + big.x1) / 2, y: h.lava!.y + 1, z: (big.z0 + big.z1) / 2 });
      });
    }
  });

  it('is empty for a Floor with no lava, and the same each time', () => {
    const dry = floorOf(noLava(tuning), floorArenaName(10, 1))!.plan;
    expect(lavaPointsOf(dry)).toEqual([]);
    const plan = floorOf(tuning, floorArenaName(10, 1))!.plan;
    expect(lavaPointsOf(plan)).toEqual(lavaPointsOf(plan));
  });
});

describe('LavaLights', () => {
  const at = (x: number, z: number): THREE.Camera => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(x, 1.7, z);
    return c;
  };
  const points: LavaPoint[] = [{ x: 0, y: -3, z: 0 }, { x: 10, y: -3, z: 0 }, { x: 100, y: -3, z: 0 }];
  const lit = (l: LavaLights) => l.lavaLights.map((p) => p.intensity > 0);

  it('keeps a fixed pool of warm lights, dark with no lava, or none near', () => {
    const none = new LavaLights([]);
    expect(none.lavaLights).toHaveLength(LAVA_POOL);
    none.update(at(0, 0), 1);
    expect(lit(none)).toEqual([false, false]);
    for (const p of none.lavaLights) expect(p.color.getHex()).toBe(LAVA_LIGHT_COLOUR);
    const far = new LavaLights(points);
    far.update(at(500, 500), 1);
    expect(lit(far)).toEqual([false, false]);
  });

  it('puts its lights on the nearest points, and never more or fewer lights', () => {
    const l = new LavaLights(points);
    const count = () => l.group.children.length;
    l.update(at(1, 0), 1);
    expect(count()).toBe(LAVA_POOL);
    const on = l.lavaLights.map((p) => p.position.x).sort((a, b) => a - b);
    expect(on).toEqual([0, 10]);
    expect(Math.max(...l.lavaLights.map((p) => p.intensity))).toBeGreaterThan(0);
    expect(Math.max(...l.lavaLights.map((p) => p.intensity))).toBeLessThanOrEqual(LAVA_INTENSITY);
    // Walking on to the far point: the lights follow, the pool is still two.
    l.update(at(99, 0), 2);
    expect(count()).toBe(LAVA_POOL);
    expect(l.lavaLights.some((p) => p.position.x === 100 && p.intensity > 0)).toBe(true);
  });
});
