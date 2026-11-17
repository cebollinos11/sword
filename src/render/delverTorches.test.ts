import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf } from '../sim/arena';
import { arenaTuning, floorArenaName, floorOf } from '../sim/delver';
import { sconcesOf } from './delverTorches';

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
        // A Hall's sconce is on its own floor's wall, not where a Passage meets it, and burns between its floor and its roof.
        const wall = { x: s.x - s.nx * 0.6, z: s.z - s.nz * 0.6 };
        expect(pieces.some((r) => wall.x > r.x0 && wall.x < r.x1 && wall.z > r.z0 && wall.z < r.z1), `${h.id} (${s.x}, ${s.z})`).toBe(false);
        expect(s.y).toBeGreaterThan(h.y);
        expect(s.y).toBeLessThan(h.top);
      }
    }
    expect(sconces.length).toBeGreaterThan(built.plan.halls.length * 3);
  });
});
