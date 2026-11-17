/**
 * The impostor atlases (docs/plans/big-battle.md, Stage 2), baked in-engine when a Battle is drawn, one per look a Soldier can
 * have (a Troop's Body for each Team and its Weapon, `soldierLooks`): that Body and Weapon, posed frame by frame from its clips (`soldierClips`, recorded from the Simulation), rendered from
 * `IMPOSTOR_DIRECTIONS` directions round it into one texture (`atlasLayout`). Its team-coloured part is baked white and,
 * into a second texture of the same size and layout (drawn in the same pass), as a mask, so the impostor's shader tints it with each Team's
 * colour: one atlas serves both Teams. Render-only.
 */
import * as THREE from 'three';
import { troopBodies, weaponByName, type BattleTuning, type TuningData } from '../tuning';
import { BODY_MODELS, type BodyModelName } from './bodyModel';
import { FighterView } from './fighterView';
import { patchShader } from './shaderPatch';
import { atlasCell, atlasLayout, IMPOSTOR_CLIPS, type AtlasLayout, type ClipSeconds } from './impostor';
import { soldierClips, type SoldierClips } from './soldierClips';

/** A cell's side in the world (m): the soldier's swing reaches about 2.5 m up and its fall about 1 m round its feet. */
export const CELL_METRES = 2.9;
/** How far (m) the soldier's feet stand above a cell's bottom edge, leaving room for what lies in front of them. */
export const FEET_METRES = 0.35;
/** A cell's side (px) in the colour atlas and in the mask, which must match it so the mask's edge lines up with the colour's. */
const CELL_PIXELS = 128;
/** The atlas's longest side (px) at most, below the GPU's own limit. */
const MAX_PIXELS = 4096;
/** How far (radians) above level each direction is baked from: a spectator mostly looks down on a battle. */
const BAKE_ELEVATION = (10 * Math.PI) / 180;

export interface ImpostorAtlas {
  readonly colour: THREE.Texture;
  /** 1 on the team-coloured part, 0 elsewhere (red channel), in the same layout and size. */
  readonly mask: THREE.Texture;
  readonly layout: AtlasLayout;
  readonly seconds: ClipSeconds;
  dispose(): void;
}

const isModel = (body: string): body is BodyModelName => (BODY_MODELS as readonly string[]).includes(body);

/** The atlas's target: its colour (texture 0) and its mask (texture 1), drawn together. */
function target(width: number, height: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
    count: 2,
  });
  rt.scissorTest = true;
  return rt;
}

/** Make `material` also write `value` (red) to the target's second texture, the mask, wherever it draws. */
function maskShader(material: THREE.Material, value: 0 | 1): void {
  patchShader(material, `impostorMask${value}`, (shader) => {
    shader.fragmentShader = `layout(location = 1) out highp vec4 impostorMask;\n${shader.fragmentShader}`.replace(
      /}\s*$/,
      `  impostorMask = vec4(${value}.0, 0.0, 0.0, 1.0);\n}`,
    );
  });
}

/** One look a Soldier can have: the Body it is drawn as and the Weapon it holds. Each is baked into an atlas of its own. */
export interface SoldierLook {
  readonly body: string;
  readonly weapon: string;
}

/**
 * Every look a Battle's Soldiers can have (each Troop's Bodies, each with its Weapon), each once, and which of them Troop `t`'s look `l`
 * is (`index[team][t][l]`).
 */
export function soldierLooks(battle: Pick<BattleTuning, 'troops'>): { readonly looks: SoldierLook[]; readonly index: number[][][] } {
  const looks: SoldierLook[] = [];
  const index = [0, 1].map((team) =>
    battle.troops.map((t) =>
      troopBodies(t, team).map((body) => {
        const k = looks.findIndex((l) => l.body === body && l.weapon === t.weapon);
        if (k >= 0) return k;
        looks.push({ body, weapon: t.weapon });
        return looks.length - 1;
      }),
    ),
  );
  return { looks, index };
}

/** A Battle's impostor atlases: one per look (`soldierLooks`), and which atlas Troop `t`'s look `l` is drawn from (`index[team][t][l]`). */
export interface ImpostorAtlases {
  readonly atlases: readonly ImpostorAtlas[];
  readonly index: readonly (readonly (readonly number[])[])[];
  dispose(): void;
}

/** Bake every look's atlas of a Battle (`soldierLooks`), one after another, with `renderer`. */
export async function bakeImpostorAtlases(
  renderer: THREE.WebGLRenderer,
  tuning: TuningData,
  battle: BattleTuning = tuning.battle,
  /** Called before each look is baked and after the last: `done` of `total` looks are in. Resolving it lets the page paint between looks. */
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<ImpostorAtlases> {
  const { looks, index } = soldierLooks(battle);
  const atlases: ImpostorAtlas[] = [];
  // A Weapon's clips are the same whatever Body holds it: recorded once for every look that wields it.
  const clips = new Map<string, SoldierClips>();
  for (const look of looks) {
    await onProgress?.(atlases.length, looks.length);
    const weapon = weaponByName(tuning, look.weapon).name;
    if (!clips.has(weapon)) clips.set(weapon, soldierClips(tuning, weapon));
    atlases.push(await bakeImpostorAtlas(renderer, tuning, look, clips.get(weapon)));
  }
  await onProgress?.(looks.length, looks.length);
  return {
    atlases,
    index,
    dispose() {
      for (const a of atlases) a.dispose();
    },
  };
}

/**
 * Bake one look's atlas with `renderer` (the one that will draw it), from its Weapon's `clips` (recorded here if not given).
 * Resolves once its Body model has loaded. With `pace`, the bake stops between frames whenever `pace` asks it to (returns a promise): the
 * renderer is handed back as it was for the wait (so the game draws its own frames meanwhile) and taken again after, so a look can bake a
 * few cells a frame during play.
 */
export async function bakeImpostorAtlas(
  renderer: THREE.WebGLRenderer,
  tuning: TuningData,
  soldier: SoldierLook,
  clips: SoldierClips = soldierClips(tuning, weaponByName(tuning, soldier.weapon).name),
  pace?: () => Promise<void> | undefined,
): Promise<ImpostorAtlas> {
  if (!isModel(soldier.body)) throw new Error(`A Troop's Body "${soldier.body}" is not a Body model (${BODY_MODELS.join(', ')})`);
  const weapon = weaponByName(tuning, soldier.weapon);
  const view = new FighterView(0xffffff, tuning, soldier.body);
  await view.ready;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6644, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(0.5, 1, 0.7);
  scene.add(sun, view.root);
  const camera = new THREE.OrthographicCamera(-CELL_METRES / 2, CELL_METRES / 2, CELL_METRES - FEET_METRES, -FEET_METRES, 0.1, 20);

  const layout = atlasLayout(CELL_PIXELS, Math.min(MAX_PIXELS, renderer.capabilities.maxTextureSize));
  // One target, two textures: each cell is drawn once, into the colour and the mask together.
  const rt = target(layout.width, layout.height);
  const [colour, mask] = rt.textures as [THREE.Texture, THREE.Texture];
  colour.colorSpace = THREE.SRGBColorSpace;
  mask.colorSpace = THREE.NoColorSpace;
  // Allocated with all their mip levels, then filled cell by cell without regenerating them; generated once at the end.
  renderer.initRenderTarget(rt);
  for (const t of rt.textures) t.generateMipmaps = false;

  // While it is baked, each mesh draws with a copy of its material that also writes the mask: 1 on the team-coloured part, 0
  // elsewhere, on exactly the pixels its colour covers (so a skirt seen from behind is masked as it is coloured).
  const own = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const copies = new Map<THREE.Material, THREE.Material>();
  const masked = (material: THREE.Material): THREE.Material => {
    let copy = copies.get(material);
    if (!copy) {
      copy = material.clone();
      // The copy's own patches only: the original's (its blood, its fade) do not survive the clone, and are not baked.
      copy.userData = {};
      maskShader(copy, material.name?.endsWith('_Skirt') ? 1 : 0);
      copies.set(material, copy);
    }
    return copy;
  };
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      own.set(o, o.material);
      o.material = Array.isArray(o.material) ? o.material.map(masked) : masked(o.material as THREE.Material);
    }
  });

  const saved = {
    target: renderer.getRenderTarget(),
    clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  const take = (): void => {
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.setRenderTarget(rt);
  };
  const give = (): void => {
    renderer.setRenderTarget(saved.target);
    renderer.setClearColor(saved.clear, saved.alpha);
    renderer.autoClear = saved.autoClear;
  };
  take();
  const side = layout.cell;
  for (const clip of IMPOSTOR_CLIPS)
    for (const [frame, pose] of clips.poses[clip].entries()) {
      const wait = pace?.();
      if (wait) {
        give();
        await wait;
        take();
      }
      view.update(pose, weapon);
      // Only the front, the back and the right between them: the left is drawn as the right, mirrored (`atlasCell`).
      for (let d = 0; d < layout.baked; d++) {
        const yaw = (d * 2 * Math.PI) / layout.directions;
        camera.position.set(Math.sin(yaw) * Math.cos(BAKE_ELEVATION), Math.sin(BAKE_ELEVATION), Math.cos(yaw) * Math.cos(BAKE_ELEVATION)).multiplyScalar(10);
        camera.lookAt(0, 0, 0);
        const { column, row } = atlasCell(layout, clip, frame, d);
        rt.viewport.set(column * side, row * side, side, side);
        rt.scissor.copy(rt.viewport);
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
      }
    }
  for (const [mesh, material] of own) mesh.material = material;
  for (const copy of copies.values()) copy.dispose();
  // An empty draw into the target, which (with mipmaps on again) generates them once.
  renderer.autoClear = false;
  for (const t of rt.textures) t.generateMipmaps = true;
  rt.viewport.set(0, 0, 1, 1);
  rt.scissor.set(0, 0, 1, 1);
  renderer.setRenderTarget(rt);
  renderer.render(new THREE.Scene(), camera);
  renderer.setRenderTarget(saved.target);
  renderer.setClearColor(saved.clear, saved.alpha);
  renderer.autoClear = saved.autoClear;
  view.dispose();

  return {
    colour,
    mask,
    layout,
    seconds: clips.seconds,
    dispose() {
      rt.dispose();
    },
  };
}
