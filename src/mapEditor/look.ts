/**
 * The look of a map made in the Map Editor (docs/plans/map-editor.md, Stage 5), the pure part: the palette of materials a Brush is drawn in,
 * the material each kind of Brush takes when the source names none, and how hazards and props are drawn. All render-only: the compiled map
 * never reads any of it. No DOM, no three.js (`render/mapModel.ts` builds the model from it).
 *
 * Each material of the model is named `Map_<Part>`, a name the game's texturing already reads (`surfaceOf` in `render/triplanar.ts`): the part
 * says which triplanar Surface textures it (`Stone`, `Rock`, `Grass`…), or that it stays flat (`Lava`, `Metal`, `Leaf`, `Fire`, `Banner`), so the
 * model needs no texture of its own and the game's loading path is the shipped maps'. The colour is the material's own (the texture only adds
 * its detail, `applyTriplanar`).
 */
import type { Brush, HazardKind, MapMaterial, MapSource } from './source';

/** How a material is drawn: its name in the model (which says its texture), its colour, and its glow (emissive colour and strength), if any. */
export interface MaterialLook {
  readonly name: string;
  readonly colour: number;
  readonly emissive?: { readonly colour: number; readonly strength: number };
}

/** The Brushes' palette. */
export const MATERIAL_LOOKS: Readonly<Record<MapMaterial, MaterialLook>> = {
  stone: { name: 'Map_Stone', colour: 0x9a8f7c },
  // Sandstone blocks fired red.
  brick: { name: 'Map_BrickWall', colour: 0x9c5c46 },
  basalt: { name: 'Map_BasaltRock', colour: 0x4a4542 },
  dungeon: { name: 'Map_Dungeon', colour: 0x5a5452 },
  cobble: { name: 'Map_Cobble', colour: 0x8a8070 },
  plaster: { name: 'Map_Plaster', colour: 0xd0bf9a },
  tile: { name: 'Map_Tile', colour: 0xa8472f },
  wood: { name: 'Map_Wood', colour: 0x7a5a3a },
  grass: { name: 'Map_Grass', colour: 0x5e7a3b },
  dirt: { name: 'Map_Dirt', colour: 0x7a6248 },
  sand: { name: 'Map_SandDirt', colour: 0xd4bc88 },
  metal: { name: 'Map_Metal', colour: 0x6a737e },
  glow: { name: 'Map_LavaGlow', colour: 0xff6a1f, emissive: { colour: 0xff5a14, strength: 1.6 } },
};

/** How a Hazard's floor is drawn, by what it is: lava glows, water is a flat blue, the Abyss is near black. */
export const HAZARD_LOOKS: Readonly<Record<HazardKind, MaterialLook>> = {
  lava: { name: 'Map_Lava', colour: 0xff4a0f, emissive: { colour: 0xff4a0f, strength: 2.2 } },
  water: { name: 'Map_Water', colour: 0x2f6fb0 },
  abyss: { name: 'Map_Abyss', colour: 0x0b0b10 },
};

/** The props' own materials (`render/mapProps.ts`): bark, leaves, rubble, a crate's planks, a banner's cloth by Team (or plain), a torch's flame. */
export const PROP_LOOKS = {
  bark: { name: 'Map_Bark', colour: 0x5a4330 },
  leaf: { name: 'Map_Leaf', colour: 0x3f6a2c },
  rubble: { name: 'Map_Rubble', colour: 0x8a8274 },
  crate: { name: 'Map_CrateWood', colour: 0x9a7448 },
  pole: { name: 'Map_Metal', colour: MATERIAL_LOOKS.metal.colour },
  banner: { name: 'Map_Banner', colour: 0xd8d0b8 },
  banner0: { name: 'Map_Banner0', colour: 0xd0a020 },
  banner1: { name: 'Map_Banner1', colour: 0x2e6fc1 },
  fire: { name: 'Map_Fire', colour: 0xffa040, emissive: { colour: 0xff8a2a, strength: 3 } },
} as const satisfies Record<string, MaterialLook>;

/** The name of a Map Editor model's root node, which carries the map's sky (`userData.sky`; glTF's `extras`), read back by the renderer. */
export const MAP_MODEL_ROOT = 'MapEditor';

/** A torch's light (the model's `LIGHT_torch_<n>` point lights): its brightness (candela), reach (m) and colour; only the first few torches carry one. */
export const TORCH_LIGHT = { prefix: 'LIGHT_torch', intensity: 40, distance: 16, color: 0xffa050 } as const;
export const MAX_TORCH_LIGHTS = 8;

/** The map's ground: its first Floor in paint order (a new map's is the whole field). */
export const groundOf = (source: Pick<MapSource, 'brushes'>): Brush | undefined => source.brushes.find((b) => b.kind === 'floor');

/** The material a Brush is drawn in: its own, else its kind's (the ground grass, any other Floor stone, a Deck and a Rail wood, the rest stone). */
export function materialOf(b: Brush, source: Pick<MapSource, 'brushes'>): MapMaterial {
  if (b.material !== undefined) return b.material;
  switch (b.kind) {
    case 'floor':
      return b.id === groundOf(source)?.id ? 'grass' : 'stone';
    case 'deck':
    case 'rail':
      return 'wood';
    default:
      return 'stone';
  }
}

/** The look a Brush's floors, faces and rails are drawn with (a Hazard's by what it is; a Hole has none, so it is drawn as stone if ever asked). */
export function brushLook(b: Brush, source: Pick<MapSource, 'brushes'>): MaterialLook {
  return b.kind === 'hazard' ? HAZARD_LOOKS[b.hazard] : MATERIAL_LOOKS[materialOf(b, source)];
}
