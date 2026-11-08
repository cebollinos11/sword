import { describe, expect, it } from 'vitest';
import { surfaceOf } from './triplanar';

describe('surfaceOf', () => {
  it('textures stone, ground and wood materials of the Battle maps', () => {
    expect(surfaceOf('Fort_Stone')).toBe('stone');
    expect(surfaceOf('Ziggurat_WallTop')).toBe('stone');
    expect(surfaceOf('City_Grass1')).toBe('grass');
    expect(surfaceOf('City_Tile2b')).toBe('tile');
    expect(surfaceOf('City_Cobble0')).toBe('cobble');
    expect(surfaceOf('Fort_Rubble')).toBe('rock');
    expect(surfaceOf('Cavern_Floor0')).toBe('dungeon');
    expect(surfaceOf('Fort_Wood')).toBe('wood');
  });
  it('leaves glow, metal, cloth and glass flat', () => {
    for (const n of ['Cavern_Lava', 'Cavern_Rune', 'City_Fire', 'Fort_Banner0', 'City_Window', 'City_Gold', 'City_Leaf1']) expect(surfaceOf(n)).toBeNull();
  });
});
