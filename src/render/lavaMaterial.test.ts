import { describe, expect, it } from 'vitest';
import { isLava, LAVA_SIZE, lavaHeat } from './lavaMaterial';

describe('lava', () => {
  it('names only the lava floors, not the glowing brush', () => {
    expect(['Map_Lava', 'Cavern_Lava'].map(isLava)).toEqual([true, true]);
    expect(['Map_LavaGlow', 'Map_Stone', 'Map_Water'].map(isLava)).toEqual([false, false, false]);
  });

  it('bakes a 32x32 heat map, the same each time, with crust and cracks both', () => {
    const a = lavaHeat();
    expect(a.length).toBe(LAVA_SIZE * LAVA_SIZE);
    expect(lavaHeat()).toEqual(a);
    expect(Math.min(...a)).toBe(0);
    expect(Math.max(...a)).toBeGreaterThan(200);
  });

  it('tiles: the edges meet without a jump', () => {
    const a = lavaHeat();
    let seam = 0;
    let inner = 0;
    for (let i = 0; i < LAVA_SIZE; i++) {
      seam += Math.abs(a[i * LAVA_SIZE]! - a[i * LAVA_SIZE + LAVA_SIZE - 1]!);
      inner += Math.abs(a[i * LAVA_SIZE + 15]! - a[i * LAVA_SIZE + 16]!);
    }
    expect(seam).toBeLessThan(inner * 2);
  });
});
