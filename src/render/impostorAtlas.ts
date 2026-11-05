/**
 * The impostor atlases (docs/plans/big-battle.md, Stage 2), baked in-engine when a Battle is drawn, one per look a Soldier can
 * have (a Troop's Body for each Team and its Weapon, `soldierLooks`): that Body and Weapon, posed frame by frame from its clips (`soldierClips`, recorded from the Simulation), rendered from
 * `IMPOSTOR_DIRECTIONS` directions round it into one texture (`atlasLayout`). Its team-coloured part is baked white and,
 * into a second texture of the same size and layout, as a mask, so the impostor's shader tints it with each Team's
 * colour: one atlas serves both Teams. Render-only.
 */
import * as THREE from 'three';
import { troopBodies, weaponByName, type BattleTuning, type TuningData } from '../tuning';
import { BODY_MODELS, type BodyModelName } from './bodyModel';
import { FighterView } from './fighterView';
import { atlasCell, atlasLayout, IMPOSTOR_CLIPS, type AtlasLayout, type ClipSeconds } from './impostor';
import { soldierClips } from './soldierClips';

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

function target(width: number, height: number, colorSpace: THREE.ColorSpace): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    colorSpace,
    depthBuffer: true,
  });
  rt.scissorTest = true;
  return rt;
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
  for (const look of looks) {
    await onProgress?.(atlases.length, looks.length);
    atlases.push(await bakeImpostorAtlas(renderer, tuning, look));
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

/** Bake one look's atlas with `renderer` (the one that will draw it). Resolves once its Body model has loaded. */
export async function bakeImpostorAtlas(renderer: THREE.WebGLRenderer, tuning: TuningData, soldier: SoldierLook): Promise<ImpostorAtlas> {
  if (!isModel(soldier.body)) throw new Error(`A Troop's Body "${soldier.body}" is not a Body model (${BODY_MODELS.join(', ')})`);
  const weapon = weaponByName(tuning, soldier.weapon);
  const clips = soldierClips(tuning, weapon.name);
  const view = new FighterView(0xffffff, tuning, soldier.body);
  await view.ready;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6644, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(0.5, 1, 0.7);
  scene.add(sun, view.root);
  const camera = new THREE.OrthographicCamera(-CELL_METRES / 2, CELL_METRES / 2, CELL_METRES - FEET_METRES, -FEET_METRES, 0.1, 20);

  const layout = atlasLayout(CELL_PIXELS, Math.min(MAX_PIXELS, renderer.capabilities.maxTextureSize));
  const colour = target(layout.width, layout.height, THREE.SRGBColorSpace);
  const mask = target(layout.width, layout.height, THREE.NoColorSpace);
  // Allocated with all their mip levels, then filled cell by cell without regenerating them; generated once at the end.
  for (const rt of [colour, mask]) {
    renderer.initRenderTarget(rt);
    rt.texture.generateMipmaps = false;
  }

  // The mask pass's materials: white on the team-coloured part, black elsewhere.
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const own = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh) own.set(o, o.material);
  });
  const masking = (on: boolean) => {
    for (const [mesh, material] of own) mesh.material = on ? ((material as THREE.Material).name?.endsWith('_Skirt') ? white : black) : material;
  };

  const saved = {
    target: renderer.getRenderTarget(),
    clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  for (const [rt, maskPass] of [
    [colour, false],
    [mask, true],
  ] as const) {
    masking(maskPass);
    const side = layout.cell;
    for (const clip of IMPOSTOR_CLIPS)
      clips.poses[clip].forEach((pose, frame) => {
        view.update(pose, weapon);
        for (let d = 0; d < layout.directions; d++) {
          const yaw = (d * 2 * Math.PI) / layout.directions;
          camera.position.set(Math.sin(yaw) * Math.cos(BAKE_ELEVATION), Math.sin(BAKE_ELEVATION), Math.cos(yaw) * Math.cos(BAKE_ELEVATION)).multiplyScalar(10);
          camera.lookAt(0, 0, 0);
          const { column, row } = atlasCell(layout, clip, frame, d);
          rt.viewport.set(column * side, row * side, side, side);
          rt.scissor.copy(rt.viewport);
          renderer.setRenderTarget(rt);
          renderer.render(scene, camera);
        }
      });
  }
  masking(false);
  // An empty draw into each target, which (with mipmaps on again) generates them once.
  const empty = new THREE.Scene();
  renderer.autoClear = false;
  for (const rt of [colour, mask]) {
    rt.texture.generateMipmaps = true;
    rt.viewport.set(0, 0, 1, 1);
    rt.scissor.set(0, 0, 1, 1);
    renderer.setRenderTarget(rt);
    renderer.render(empty, camera);
  }
  renderer.setRenderTarget(saved.target);
  renderer.setClearColor(saved.clear, saved.alpha);
  renderer.autoClear = saved.autoClear;
  view.dispose();
  white.dispose();
  black.dispose();

  return {
    colour: colour.texture,
    mask: mask.texture,
    layout,
    seconds: clips.seconds,
    dispose() {
      colour.dispose();
      mask.dispose();
    },
  };
}
