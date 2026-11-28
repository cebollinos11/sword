/**
 * Triplanar texturing for the Battle maps, the Delver Floors and the Map Editor's maps: their models and terrain have no UV maps, so a
 * surface's texture is projected along the three world axes and blended by the way the surface faces (its normal). Each Surface is a finish
 * of up to three textures: its wall texture on the side planes, its floor texture on faces that look up, its ceiling texture on faces that look
 * down, so a room reads as floor, walls and ceiling with no geometry split. Sampling by world position makes a texture continuous across
 * pieces and independent of each mesh's transform. Each texture is divided by its own average colour, so it only adds detail: the material
 * keeps its colour (and a vertex colour its tint), times the slot's `tint`. Render-only. Textures are CC0 (public/textures/battle/CREDITS.txt).
 */
import * as THREE from 'three';
import { applyLava, isLava } from './lavaMaterial';

/** A texture (public/textures/battle/<name>.png) and how many times it repeats per metre. */
const TEXTURES = {
  // Walls.
  dirty_medieval_bricks_bright_3: 0.5,
  dungeon_stone_wall_sharp: 0.3,
  ancient_fortress_wall_smooth: 0.35,
  medieval_red_bricks_sharp: 0.5,
  fractured_dark_rock_bright: 0.3,
  old_rustic_stone_wall_sharp_2: 0.4,
  rough_medieval_plaster_smooth: 0.35,
  old_sandstone_blocks: 0.45,
  weathered_fortress_wall_dark_1: 0.35,
  cracked_cabin_planks: 0.5,
  smooth_marble: 0.3,
  sloppy_beige_stone_bricks: 0.45,
  mountain_rock_bright: 0.3,
  earthy_rock_wall_smooth_2: 0.35,
  uneven_white_sandstone: 0.4,
  interlocking_clay_roof_tiles_smooth: 0.7,
  round_slate_roof_tiles_bright: 0.6,
  dark_old_wood: 0.6,
  japanese_camphor_bark_rough: 0.6,
  rough_grey_rocks_sharp: 0.5,
  // Floors.
  cobblestone_pavers_smooth_1: 0.5,
  roughhewn_stone_pavement_rough: 0.35,
  aged_pine_floor: 0.5,
  rocky_soil_smooth: 0.4,
  monastery_slate_floor_smooth: 0.35,
  stained_beige_limestone_tiles_sharp_1: 0.35,
  dirty_checker_marble_smooth: 0.3,
  weathered_volcanic_herringbone: 0.4,
  weathered_even_planks_sharp: 0.5,
  weathered_paving_stones: 0.35,
  dense_green_grass_sharp: 0.6,
  dusty_rocky_trail_smooth: 0.5,
  dry_trampled_sand_bright: 0.4,
  weathered_granite_tiles: 0.3,
  // Ceilings.
  stacked_cabin_beams_dark: 0.5,
  log_cabin_wall_sharp: 0.5,
} as const satisfies Record<string, number>;
export type TextureName = keyof typeof TEXTURES;

/** One slot of a finish: its texture, and a colour it is multiplied by (default white: the material's own colour). */
interface Slot {
  readonly tex: TextureName;
  readonly tint?: number;
}
/** A Surface's finish: the walls' texture, and the floor's and ceiling's (each the wall's when absent). */
export interface Finish {
  readonly wall: Slot;
  readonly floor?: Slot;
  readonly ceiling?: Slot;
}

/** The finishes, by Surface. A Map Editor material (`look.ts`) and each shipped Battle map's materials (`MAP_RULES`) take one each. */
export const FINISHES = {
  // A passage, or plain stone: soot-dark bricks, cobbled underfoot, under timber beams.
  stone: { wall: { tex: 'dirty_medieval_bricks_bright_3' }, floor: { tex: 'cobblestone_pavers_smooth_1', tint: 0xd8d0c4 }, ceiling: { tex: 'stacked_cabin_beams_dark', tint: 0x8a7a68 } },
  // A Rest Hall: a tavern's red brick, worn pine boards, a log ceiling.
  brick: { wall: { tex: 'medieval_red_bricks_sharp' }, floor: { tex: 'aged_pine_floor', tint: 0xc8a888 }, ceiling: { tex: 'log_cabin_wall_sharp', tint: 0x9a8070 } },
  // An Empty Hall: a raw cave of dark rock over stony soil.
  basalt: { wall: { tex: 'fractured_dark_rock_bright' }, floor: { tex: 'rocky_soil_smooth', tint: 0xc8b8a0 } },
  // A Fight Hall: rough dungeon stone, hewn flagstones, a vault of old blocks.
  dungeon: { wall: { tex: 'dungeon_stone_wall_sharp' }, floor: { tex: 'roughhewn_stone_pavement_rough', tint: 0xc0b8b0 }, ceiling: { tex: 'ancient_fortress_wall_smooth', tint: 0x9a9490 } },
  // A Stairs Hall: rustic stone walls round a monastery's slate floor.
  cobble: { wall: { tex: 'old_rustic_stone_wall_sharp_2' }, floor: { tex: 'monastery_slate_floor_smooth', tint: 0xc0c0c4 } },
  // The Entrance: limewashed plaster, limestone tiles, a beamed ceiling.
  plaster: { wall: { tex: 'rough_medieval_plaster_smooth' }, floor: { tex: 'stained_beige_limestone_tiles_sharp_1', tint: 0xd8ccb8 }, ceiling: { tex: 'stacked_cabin_beams_dark', tint: 0x7a6858 } },
  // A Treasure Hall: veined marble walls over a checkered marble floor.
  marble: { wall: { tex: 'smooth_marble' }, floor: { tex: 'dirty_checker_marble_smooth', tint: 0xd0c8b8 } },
  // A Boss Hall: dark fortress stone, volcanic herringbone underfoot, a cave of black rock above.
  bloodstone: { wall: { tex: 'weathered_fortress_wall_dark_1' }, floor: { tex: 'weathered_volcanic_herringbone', tint: 0xb09088 }, ceiling: { tex: 'fractured_dark_rock_bright', tint: 0x807070 } },
  // Wood: plank walls, boards underfoot, a log ceiling.
  wood: { wall: { tex: 'cracked_cabin_planks' }, floor: { tex: 'weathered_even_planks_sharp' }, ceiling: { tex: 'log_cabin_wall_sharp', tint: 0xb0a090 } },
  roofTile: { wall: { tex: 'interlocking_clay_roof_tiles_smooth' } },
  slate: { wall: { tex: 'round_slate_roof_tiles_bright' } },
  timber: { wall: { tex: 'dark_old_wood' } },
  bark: { wall: { tex: 'japanese_camphor_bark_rough' } },
  // Grass, dirt and sand: the ground on top, earth or sandstone down its banks.
  grass: { wall: { tex: 'earthy_rock_wall_smooth_2', tint: 0x9a8a70 }, floor: { tex: 'dense_green_grass_sharp' } },
  dirt: { wall: { tex: 'earthy_rock_wall_smooth_2' }, floor: { tex: 'dusty_rocky_trail_smooth' } },
  sand: { wall: { tex: 'uneven_white_sandstone' }, floor: { tex: 'dry_trampled_sand_bright' } },
  rock: { wall: { tex: 'mountain_rock_bright' } },
  rubble: { wall: { tex: 'rough_grey_rocks_sharp' } },
  // The Fort: weathered fortress stone walls, paving stones along the wall walks.
  fortress: { wall: { tex: 'ancient_fortress_wall_smooth' }, floor: { tex: 'weathered_paving_stones', tint: 0xd8d0c8 } },
  // The City: beige stone bricks, paved on top; its streets cobbled; its plazas granite.
  cityStone: { wall: { tex: 'sloppy_beige_stone_bricks' }, floor: { tex: 'weathered_paving_stones' } },
  street: { wall: { tex: 'cobblestone_pavers_smooth_1' } },
  plaza: { wall: { tex: 'sloppy_beige_stone_bricks' }, floor: { tex: 'weathered_granite_tiles' } },
  // The Ziggurat: sandstone blocks, its terraces and plaza in limestone.
  sandstone: { wall: { tex: 'old_sandstone_blocks' }, floor: { tex: 'stained_beige_limestone_tiles_sharp_1' } },
  // The Cavern: black volcanic rock, its paths hewn flagstones.
  cavern: { wall: { tex: 'fractured_dark_rock_bright' }, floor: { tex: 'roughhewn_stone_pavement_rough', tint: 0xb8b0a8 } },
} as const satisfies Record<string, Finish>;
export type Surface = keyof typeof FINISHES;

/** How sharply the planes separate: the blend weight of a plane is its normal component to this power. */
const SHARPNESS = 4;
/**
 * How the textures are filtered, cycled live with `TEXTURE_FILTER_KEY` to compare them on a device. Magnified texels stay crisp (the textures
 * are only 64 px); the modes differ in how shrunk (distant) texels are drawn. `pixelAA` filters linearly but the shader snaps each sample to
 * its texel, blending only across the pixel-wide edge between two texels: crisp at any distance, with no shimmer.
 */
export const TEXTURE_FILTERS = [
  { name: 'Nearest mipmap nearest', min: THREE.NearestMipmapNearestFilter, mag: THREE.NearestFilter, pixelAA: false },
  { name: 'Nearest mipmap linear', min: THREE.NearestMipmapLinearFilter, mag: THREE.NearestFilter, pixelAA: false },
  { name: 'Nearest, no mipmaps', min: THREE.NearestFilter, mag: THREE.NearestFilter, pixelAA: false },
  { name: 'Pixel-art AA (shader)', min: THREE.LinearMipmapLinearFilter, mag: THREE.LinearFilter, pixelAA: true },
  { name: 'Trilinear (old, blurry)', min: THREE.LinearMipmapLinearFilter, mag: THREE.NearestFilter, pixelAA: false },
] as const;
/** The key that cycles `TEXTURE_FILTERS`. */
export const TEXTURE_FILTER_KEY = 'KeyT';
let filterIndex = 0;
/** Whether the shader snaps samples to texels (`pixelAA`), shared by every triplanar material. */
const pixelAA = { value: 0 };

function applyFilter(texture: THREE.Texture): void {
  const mode = TEXTURE_FILTERS[filterIndex]!;
  texture.minFilter = mode.min;
  texture.magFilter = mode.mag;
  texture.needsUpdate = true;
}

/** Switch every triplanar texture to the next filter mode; returns its name. */
export function cycleTextureFilter(): string {
  filterIndex = (filterIndex + 1) % TEXTURE_FILTERS.length;
  const mode = TEXTURE_FILTERS[filterIndex]!;
  pixelAA.value = mode.pixelAA ? 1 : 0;
  for (const s of loaded.values()) if (s.map.value) applyFilter(s.map.value);
  return mode.name;
}

/** The URL of a texture's image. */
export const textureUrl = (tex: TextureName): string => `${import.meta.env.BASE_URL}textures/battle/${tex}.png`;

/**
 * Each shipped Battle map's materials (`<Map>_<Part>`, built in art/) and the Map Editor's (`Map_<Part>`, `look.ts`), by map: the first rule
 * whose pattern matches the part gives its Surface, null to leave it flat (glow, metal, cloth, glass, foliage).
 */
const FLAT = /Fire|Gold|Rune|Lava|Crust|Window|Banner|Awning|Leaf|DeckLine|Beam|Metal|Water|Abyss/;
const MAP_RULES: Readonly<Record<string, readonly (readonly [RegExp, Surface])[]>> = {
  Map: [
    [/^BloodDungeon$/, 'bloodstone'],
    [/^Dungeon$/, 'dungeon'],
    [/^BrickWall$/, 'brick'],
    [/^BasaltRock$/, 'basalt'],
    [/^Marble$/, 'marble'],
    [/^Cobble$/, 'cobble'],
    [/^Plaster$/, 'plaster'],
    [/^Tile$/, 'roofTile'],
    [/^SandDirt$/, 'sand'],
    [/^Rubble$/, 'rubble'],
    [/^Bark$/, 'bark'],
    [/^(Wood|CrateWood)$/, 'wood'],
    [/^Stone$/, 'stone'],
  ],
  Fort: [
    [/^Stone|^Wall/, 'fortress'],
    [/Rubble/, 'rubble'],
  ],
  City: [
    [/Plaster/, 'plaster'],
    [/Timber|Eave/, 'timber'],
    [/^Tile/, 'roofTile'],
    [/Slate/, 'slate'],
    [/Cobble/, 'street'],
    [/PlazaStone/, 'plaza'],
    [/^Stone|^Wall/, 'cityStone'],
  ],
  Ziggurat: [
    [/^Plaza$/, 'sandstone'],
    [/^Stone|^Wall/, 'sandstone'],
  ],
  Cavern: [
    [/^(Floor|Plat|Wall|Deck)/, 'cavern'],
    [/^Rock/, 'basalt'],
  ],
};
/** Any map's material the rules above leave: by what its name says it is. */
const GENERIC: readonly (readonly [RegExp, Surface])[] = [
  [/Dungeon/, 'dungeon'],
  [/Rock|Rubble/, 'rock'],
  [/Grass|Moss/, 'grass'],
  [/Dirt/, 'dirt'],
  [/Plaster/, 'plaster'],
  [/Tile|Slate/, 'roofTile'],
  [/Cobble|Plaza/, 'street'],
  [/Bark/, 'bark'],
  [/Wood|Timber|Eave|Deck/, 'wood'],
  [/Stone|Wall/, 'stone'],
];

/** The Surface a map material of this name is textured as, or null to leave it flat. */
export function surfaceOf(name: string): Surface | null {
  const [map = '', part = ''] = name.split('_', 2);
  if (FLAT.test(part)) return null;
  for (const [pattern, surface] of [...(MAP_RULES[map] ?? []), ...GENERIC]) if (pattern.test(part)) return surface;
  return null;
}

/** The three textures a Surface draws (wall, floor, ceiling), each with its tint. */
export function finishOf(surface: Surface): { wall: Required<Slot>; floor: Required<Slot>; ceiling: Required<Slot> } {
  const f: Finish = FINISHES[surface];
  const full = (s: Slot): Required<Slot> => ({ tex: s.tex, tint: s.tint ?? 0xffffff });
  return { wall: full(f.wall), floor: full(f.floor ?? f.wall), ceiling: full(f.ceiling ?? f.wall) };
}

interface Loaded {
  map: { value: THREE.Texture | null };
  mean: { value: THREE.Vector3 };
  scale: { value: number };
}
const loaded = new Map<TextureName, Loaded>();

/** A texture's uniforms, shared by every material using it; it loads on first use. */
function textureOf(tex: TextureName): Loaded {
  let s = loaded.get(tex);
  if (s) return s;
  s = { map: { value: null }, mean: { value: new THREE.Vector3(1, 1, 1) }, scale: { value: TEXTURES[tex] } };
  loaded.set(tex, s);
  const uniforms = s;
  new THREE.TextureLoader().load(textureUrl(tex), (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    applyFilter(texture);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    uniforms.mean.value.copy(averageOf(texture.image as CanvasImageSource & { width: number; height: number }));
    uniforms.map.value = texture;
  });
  return s;
}

/** The average colour of an image, in linear light (what the shader sees after sRGB decoding). */
function averageOf(image: CanvasImageSource & { width: number; height: number }): THREE.Vector3 {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.Vector3(1, 1, 1);
  g.drawImage(image, 0, 0);
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const sum = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < px.length; i += 4) {
    c.setRGB(px[i]! / 255, px[i + 1]! / 255, px[i + 2]! / 255, THREE.SRGBColorSpace);
    sum.x += c.r;
    sum.y += c.g;
    sum.z += c.b;
  }
  return sum.multiplyScalar(4 / px.length).max(new THREE.Vector3(0.02, 0.02, 0.02));
}

const SLOTS = ['Wall', 'Floor', 'Ceil'] as const;

/** Texture `material` triplanar as `surface`: it keeps its colour and gains its finish's detail. Safe to call once per material. */
export function applyTriplanar(material: THREE.Material, surface: Surface): void {
  const f = finishOf(surface);
  const slots = [f.wall, f.floor, f.ceiling].map((s) => ({ t: textureOf(s.tex), tint: { value: new THREE.Color(s.tint) } }));
  material.onBeforeCompile = (shader) => {
    SLOTS.forEach((name, k) => {
      const s = slots[k]!;
      shader.uniforms[`tp${name}Map`] = s.t.map;
      shader.uniforms[`tp${name}Mean`] = s.t.mean;
      shader.uniforms[`tp${name}Scale`] = s.t.scale;
      shader.uniforms[`tp${name}Tint`] = s.tint;
    });
    shader.uniforms.tpPixelAA = pixelAA;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTpNormal = mat3(modelMatrix) * objectNormal;`,
      );
    const decl = SLOTS.map((n) => `uniform sampler2D tp${n}Map;\nuniform vec3 tp${n}Mean;\nuniform float tp${n}Scale;\nuniform vec3 tp${n}Tint;`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTpPos;
        varying vec3 vTpNormal;
        ${decl}
        uniform float tpPixelAA;
        // A texel-snapped sample: the nearest texel's colour, blended with its neighbour only across the pixel-wide edge between them.
        // The mip is picked from the unsnapped coordinates, so the snapping makes no seams.
        vec3 tpSample(sampler2D map, vec2 uv) {
          if (tpPixelAA < 0.5) return texture2D(map, uv).rgb;
          vec2 size = vec2(textureSize(map, 0));
          vec2 px = uv * size;
          vec2 box = clamp(fwidth(px), 1e-5, 1.0);
          vec2 tx = px - 0.5 * box;
          vec2 offset = smoothstep(1.0 - box, vec2(1.0), fract(tx));
          return textureGrad(map, (floor(tx) + 0.5 + offset) / size, dFdx(uv), dFdy(uv)).rgb;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // The side seen: a double-sided face wound the other way (a Walk Surface's polygon may be) is lit from its back, so is turned round.
          vec3 n = normalize(vTpNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          vec3 w = pow(abs(n), vec3(${SHARPNESS.toFixed(1)}));
          w /= w.x + w.y + w.z;
          vec3 pw = vTpPos * tpWallScale;
          vec3 side = (tpSample(tpWallMap, pw.zy) * w.x + tpSample(tpWallMap, pw.xy) * w.z) / tpWallMean * tpWallTint;
          // Both sampled, outside any branch, so their screen derivatives are defined.
          vec3 floorC = tpSample(tpFloorMap, vTpPos.xz * tpFloorScale) / tpFloorMean * tpFloorTint;
          vec3 ceilC = tpSample(tpCeilMap, vTpPos.xz * tpCeilScale) / tpCeilMean * tpCeilTint;
          vec3 top = n.y >= 0.0 ? floorC : ceilC;
          diffuseColor.rgb *= side + top * w.y;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'triplanar4';
  material.needsUpdate = true;
}

/** Texture every material under `root` whose name says what it is (`surfaceOf`); a model shared between Matches is done once. */
export function texturedModel(root: THREE.Object3D): void {
  if (root.userData.triplanar) return;
  root.userData.triplanar = true;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const name = (m as THREE.Material).name;
      if (isLava(name)) applyLava(m as THREE.Material);
      const surface = surfaceOf(name);
      if (surface) applyTriplanar(m as THREE.Material, surface);
    }
  });
}
