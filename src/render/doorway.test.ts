import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf } from '../sim';
import { doorway, doorwayMiddle } from './doorway';

describe('a Door’s doorway', () => {
  const tuning = loadTuningData();

  it('is the back edge of its zone: two of its corners, across its facing, nearer the Arena’s edge than the zone’s middle', () => {
    for (const seed of [1, 12, 4242]) {
      const arena = arenaOf(tuning, `gen:greybox:${seed}:d4`);
      expect(arena.doors).toHaveLength(4);
      for (const door of arena.doors) {
        const [a, b] = doorway(door);
        expect(door.zone).toContain(a);
        expect(door.zone).toContain(b);
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(2.5);
        // Across the facing: the edge is square to it.
        expect((b.x - a.x) * Math.sin(door.facing) + (b.z - a.z) * Math.cos(door.facing)).toBeCloseTo(0);
        const mid = doorwayMiddle(door);
        const c = { x: door.zone.reduce((s, p) => s + p.x, 0) / door.zone.length, z: door.zone.reduce((s, p) => s + p.z, 0) / door.zone.length };
        expect(Math.hypot(mid.x, mid.z)).toBeGreaterThan(Math.hypot(c.x, c.z));
      }
    }
  });
});
