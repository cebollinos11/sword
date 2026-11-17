import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINISHES, finishOf, surfaceOf, type Surface } from './triplanar';

describe('surfaceOf', () => {
  it('gives each shipped Battle map its own finishes', () => {
    const meant: Record<string, Surface> = {
      Fort_Stone: 'fortress',
      Fort_WallTop: 'fortress',
      Fort_Rubble: 'rubble',
      Fort_Grass: 'grass',
      Fort_Wood: 'wood',
      City_Plaster2: 'plaster',
      City_Timber: 'timber',
      City_Tile2b: 'roofTile',
      City_Slate: 'slate',
      City_Cobble0: 'street',
      City_PlazaStone: 'plaza',
      City_StoneDark: 'cityStone',
      City_Bark: 'bark',
      City_Grass1: 'grass',
      Ziggurat_WallTop: 'sandstone',
      Ziggurat_Plaza: 'sandstone',
      Ziggurat_Moss: 'grass',
      Cavern_Floor0: 'cavern',
      Cavern_Plat8a: 'cavern',
      Cavern_Rock: 'basalt',
      Cavern_Wood: 'wood',
    };
    for (const [name, surface] of Object.entries(meant)) expect([name, surfaceOf(name)]).toEqual([name, surface]);
  });

  it('leaves glow, metal, cloth and glass flat', () => {
    for (const n of ['Cavern_Lava', 'Cavern_Rune', 'City_Fire', 'Fort_Banner0', 'City_Window', 'City_Gold', 'City_Leaf1', 'Map_Metal', 'Map_LavaGlow', 'Map_Water']) expect(surfaceOf(n)).toBeNull();
  });
});

describe('the finishes', () => {
  it('give every room-like finish a floor apart from its walls', () => {
    for (const s of ['stone', 'brick', 'basalt', 'dungeon', 'cobble', 'plaster', 'marble', 'bloodstone', 'wood', 'fortress', 'cavern', 'sandstone'] as const) {
      const f = finishOf(s);
      expect([s, f.floor.tex]).not.toEqual([s, f.wall.tex]);
    }
  });

  it('name only textures that ship, and every shipped texture is used', () => {
    const shipped = new Set(readdirSync('public/textures/battle').filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
    const used = new Set(Object.keys(FINISHES).flatMap((s) => Object.values(finishOf(s as Surface)).map((slot) => slot.tex as string)));
    expect([...used].filter((t) => !shipped.has(t))).toEqual([]);
    expect([...shipped].filter((t) => !used.has(t))).toEqual([]);
  });
});
