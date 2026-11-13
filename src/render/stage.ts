import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { arenaOf, battlefieldOf, battleMapName, isBattleName, type Battlefield, type Layout } from '../sim';
import { floorOf, isFloorName, parseFloorArena } from '../sim/delver';
import { compileDraft } from '../mapEditor/compile';
import { mapModel } from './mapModel';
import type { ArenaGeometry, Kit, TuningData } from '../tuning';
import { CameraCollider } from './cameraCollider';
import { colliderView, jumpLinkArcs, seeThrough, walkFans } from './colliderView';
import { battlefieldSetting, DUSK, lookSetting, type BattlefieldLook } from './battlefieldView';
import { texturedModel } from './triplanar';
import { abyss, battleGreybox, greybox, isGreybox } from './greybox';
import { hasBattleModel } from './battleModels';
import { MAP_MODEL_ROOT, TORCH_LIGHT } from '../mapEditor/look';
import { BATTLE_SKIES, type BattleSky } from '../mapEditor/source';
import { kitPlacements, STAND_IN_NODES, type KitPlacement } from './kitPlacement';
import { bakeSkies, sky, skyPane, type SkyLook } from './sky';
import { snowfall, type SnowfallLook } from './snowfall';

/** Camera field of view (degrees): vertical on a wide screen, widened on a tall one to keep this much across. */
const VERTICAL_FOV = 60;
const MIN_HORIZONTAL_FOV = 62;

/** The camera's far plane (m): an Arena's, and a Battlefield's, where the camera looks out over the whole field into the haze. */
const FAR = 200;
const BATTLEFIELD_FAR = 600;

/** PlayStation resolution, always on: the picture is drawn this many lines tall (as wide as the screen's aspect ratio makes it) and scaled up in hard-edged pixels. */
const PS1_LINES = 240;

/** One lamp of a model, by name prefix: its brightness (candela), how far it reaches (m) and its colour. */
interface Lamp {
  readonly prefix: string;
  readonly intensity: number;
  readonly distance: number;
  readonly color: number;
}

/** How a modelled Arena is lit: the lights over the whole room, its air, and its lamps (the rest are left out). */
interface ArenaLook {
  readonly lights: () => THREE.Light[];
  readonly background: number;
  readonly fog: { readonly color: number; readonly near: number; readonly far: number };
  /** Each point light costs every pixel of every surface, so only the lamps listed here are kept; the room lights stand in for the rest. */
  readonly lamps: readonly Lamp[];
  /** Snow falling round the camera, if any. */
  readonly snow?: SnowfallLook;
  /** A space sky round the camera, if any (drawn behind everything, unfogged). */
  readonly sky?: SkyLook;
  /** A material of the model (by name) drawn as window glass looking out on `sky`, tinted by `tint` (`amount`, 0 to 1). */
  readonly windows?: { readonly material: string; readonly sky: SkyLook; readonly tint: number; readonly amount: number };
  /** Parts of the model drawn without fog (a sky dome), by node name. */
  readonly unfogged?: readonly string[];
  /** The world sliding past a still Arena (a moving train's surroundings). */
  readonly scroll?: ScrollLook;
}

/**
 * Parts of an Arena's model that slide past along -z, at `speed` (m/s) times each band's
 * `parallax`. Each band is one node of the model, a tile `length` metres long along z from
 * z = 0, whose copies end to end cover a tile's length on either side of the Arena. Render-only.
 */
interface ScrollLook {
  readonly speed: number;
  readonly bands: readonly { readonly node: string; readonly length: number; readonly parallax: number }[];
}

const directional = (color: number, intensity: number, x: number, y: number, z: number): THREE.DirectionalLight => {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(x, y, z);
  return light;
};

/** Mystic space: a violet and magenta nebula with cyan wisps over the stars, sinking into violet mist. */
const MYSTIC_SKY: SkyLook = { deep: 0x2b0f5c, glow: 0xa8328c, highlight: 0x5fe0d8, horizon: 0x2a1f4a };

/** Arenas drawn from a model (public/models/arenas/<name>.glb, exported by art/build_<name>.py); the rest are drawn from their Walk Surfaces. */
const ARENA_LOOKS: Readonly<Record<string, ArenaLook>> = {
  // Warm, dim candlelight, cool light through windows onto a nebula, and brown haze.
  library: {
    lights: () => [
      new THREE.HemisphereLight(0x8c97b8, 0x3a2616, 0.9),
      new THREE.AmbientLight(0x5a4632, 0.72),
      directional(0xa8bcff, 0.7, -8, 14, -5),
      directional(0xffc890, 0.35, 6, 9, 8),
    ],
    background: 0x0e0a07,
    fog: { color: 0x22170f, near: 16, far: 48 },
    lamps: [
      { prefix: 'LIGHT_chandelier', intensity: 70, distance: 26, color: 0xffb470 },
      { prefix: 'LIGHT_sconce0', intensity: 7, distance: 9, color: 0xffb470 },
      { prefix: 'LIGHT_sconce1', intensity: 7, distance: 9, color: 0xffb470 },
      { prefix: 'LIGHT_gallery', intensity: 14, distance: 12, color: 0xffb470 },
    ],
    windows: { material: 'Library_Glass', sky: MYSTIC_SKY, tint: 0x9fb4e0, amount: 0.12 },
  },
  // Lava glow from below, cold light from the freezing head above, and smoky orange air.
  chamber: {
    lights: () => [
      new THREE.HemisphereLight(0x5d6b88, 0xff5a1e, 0.85),
      new THREE.AmbientLight(0x3a3036, 0.6),
      directional(0xffb27a, 0.5, 6, -4, 3),
      directional(0xb4c8ff, 0.45, -3, 12, -6),
    ],
    background: 0x0b0a0c,
    fog: { color: 0x2a140c, near: 14, far: 42 },
    lamps: [
      { prefix: 'LIGHT_lavacore', intensity: 30, distance: 10, color: 0xff6a20 },
      { prefix: 'LIGHT_lava', intensity: 40, distance: 18, color: 0xff5a18 },
      { prefix: 'LIGHT_freeze', intensity: 22, distance: 14, color: 0xc4d8ff },
    ],
  },
  // A thick sea fog: pale, sunless light, and grey murk that swallows the ship's ends and the mastheads.
  ship: {
    lights: () => [
      new THREE.HemisphereLight(0xd8dee2, 0x3a4a52, 1.15),
      new THREE.AmbientLight(0x8a9296, 0.45),
      directional(0xeef0ea, 0.9, 7, 14, -9),
      directional(0xb8c6cf, 0.25, -6, 5, 8),
    ],
    background: 0xa7b0b4,
    fog: { color: 0xa7b0b4, near: 2, far: 22 },
    lamps: [],
  },
  // A cold mountain top in a snowstorm: dim sun through the cloud, blue sky light, mist that swallows the far peaks, snow driving east.
  summit: {
    lights: () => [
      new THREE.HemisphereLight(0xd6e4ff, 0x7d8898, 1.0),
      new THREE.AmbientLight(0x8c98ac, 0.3),
      directional(0xfff0da, 1.25, 9, 11, 6),
      directional(0x9fbcff, 0.3, -7, 6, -8),
    ],
    background: 0xc3cfdb,
    fog: { color: 0xc3cfdb, near: 0, far: 22 },
    lamps: [],
    snow: { count: 8000, box: [32, 18, 32], fall: 1.1, size: 0.055, wind: [0.9, 0.25], color: 0xf6f9ff, opacity: 0.9 },
  },
  // A wasteland sunset: a swollen sun low behind the train, dusky sky light, thick brown dust, and the ruins rushing past.
  train: {
    lights: () => [
      new THREE.HemisphereLight(0xf0c09a, 0x5a4030, 1.1),
      new THREE.AmbientLight(0x5e4a48, 0.4),
      directional(0xffa060, 1.45, 3, 3, -16),
      directional(0x8a90b8, 0.4, -6, 8, 10),
    ],
    background: 0xb07a52,
    fog: { color: 0xa87650, near: 18, far: 210 },
    lamps: [],
    unfogged: ['Train_Sky'],
    scroll: {
      speed: 15,
      bands: [
        { node: 'Train_Near', length: 240, parallax: 1 },
        { node: 'Train_Far', length: 480, parallax: 0.3 },
      ],
    },
  },
};

/**
 * Kits drawn from a model (public/models/kits/<name>.glb, exported by art/build_kit_<name>.py): a Generated Arena of one
 * of these Kits is drawn as its Layout's Pieces. Generated Arenas of other Kits are drawn as a greybox.
 */
const KIT_LOOKS: Readonly<Record<string, ArenaLook>> = {
  // Plain grey Pieces adrift in mystic space: violet starlight, a cyan rim, and a heavy nebula mist that swallows the far Pieces and the Abyss.
  greybox: {
    lights: () => [new THREE.HemisphereLight(0xc8b8ff, 0x3a2a60, 1.2), directional(0xe6d8ff, 1.2, 6, 12, -4), directional(0x6fd8e0, 0.55, -8, 6, 9)],
    background: 0x2a1f4a,
    fog: { color: 0x2a1f4a, near: 5, far: 34 },
    lamps: [],
    sky: MYSTIC_SKY,
  },
};

/**
 * The skies and light a Battle map made in the Map Editor may be drawn under (docs/plans/map-editor.md, Stage 5; the model names one,
 * `MAP_MODEL_ROOT`'s `userData.sky`): the Stage's existing looks, each an Arena's lights, air, sky and snow, with its haze pushed out to a
 * Battlefield's distances. Dusk is the Battlefield's own (`battlefieldSetting`).
 */
const BATTLE_LOOKS: Readonly<Record<Exclude<BattleSky, 'dusk'>, BattlefieldLook>> = {
  // The greybox Kit's mystic space: violet starlight, a cyan rim, a nebula sky.
  mystic: { lights: KIT_LOOKS.greybox!.lights, haze: KIT_LOOKS.greybox!.background, near: 60, far: 320, sky: MYSTIC_SKY },
  // The train's wasteland sunset and its brown dust.
  sunset: { lights: ARENA_LOOKS.train!.lights, haze: ARENA_LOOKS.train!.fog.color, near: 50, far: 300 },
  // The ship's thick sea fog.
  fog: { lights: ARENA_LOOKS.ship!.lights, haze: ARENA_LOOKS.ship!.fog.color, near: 10, far: 140 },
  // The summit's snowstorm.
  snow: { lights: ARENA_LOOKS.summit!.lights, haze: ARENA_LOOKS.summit!.background, near: 15, far: 190, snow: ARENA_LOOKS.summit!.snow },
  // The chamber's lava glow from below, cold light above, smoky orange air.
  ember: { lights: ARENA_LOOKS.chamber!.lights, haze: ARENA_LOOKS.chamber!.fog.color, near: 30, far: 240 },
};

/** The light and air of a Battle map's sky (the Map Editor's 3D view shows a draft under it). */
export const battleLook = (sky: BattleSky): BattlefieldLook => (sky === 'dusk' ? DUSK : BATTLE_LOOKS[sky]);

/**
 * The shared 3D scene: WebGL renderer, camera, and the Arena with its light and air. `setArena`
 * swaps the Arena drawn (a Match's, or the Editor's flat circle); `collider` keeps the camera inside it.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** The current Arena's camera collider. */
  collider: CameraCollider;
  private arena: string;
  /** The geometry drawn: a new copy under the same name (a regenerated Arena) is drawn again. */
  private geometry: ArenaGeometry;
  /** The Layout a Generated Arena was assembled from, if known: drawn from its Kit's model when the Kit has one. */
  private layout: Layout | undefined;
  private setting: THREE.Object3D;
  private loaded: Promise<void> = Promise.resolve();
  /** Moves the current Arena's moving parts to the time given (s), if it has any. */
  private animate: ((seconds: number) => void) | undefined;
  /** The collision geometry drawn over a see-through model (see setColliders). */
  private colliders = false;
  private overlay: THREE.Object3D | undefined;
  /** The Arena the collider view is of, and whether its jump Link arcs have been added (on first showing: they need the navmesh). */
  private overlayArena: ArenaGeometry | undefined;
  private overlayJumps = false;
  private seeThrough: ((on: boolean) => void) | undefined;

  constructor(
    private readonly container: HTMLElement,
    private tuning: TuningData,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.style.imageRendering = 'pixelated';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.05, FAR);
    this.camera.position.set(0, 3, -6);
    this.camera.lookAt(0, 1, 0);

    this.arena = tuning.arena.editor;
    const geometry = arenaOf(tuning, this.arena);
    this.geometry = geometry;
    this.setting = this.build(this.arena, geometry);
    this.collider = new CameraCollider(geometry);

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  private readonly onResize = (): void => this.resize();

  /** Take the canvas out of the page and let go of the WebGL context, for a Stage made for a while (the Map Editor's play-test makes one each time). */
  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Resolves once the current Arena's model (if it has one) has loaded, or failed to. */
  ready(): Promise<void> {
    return this.loaded;
  }

  /**
   * Draw the Arena named `name`, from `tuning` if given (which Arenas, and jump Link arcs, then come from from now on:
   * e.g. a copy holding a Generated Arena, in the Arena Lab). A Generated Arena given with its `layout` is drawn from its
   * Kit's model (`tuning.kits`), if the Kit has one. Nothing changes if that geometry is already drawn.
   */
  setArena(name: string, tuning: TuningData = this.tuning, layout?: Layout): void {
    this.tuning = tuning;
    const geometry = arenaOf(tuning, name);
    if (name === this.arena && geometry === this.geometry) return;
    this.scene.remove(this.setting);
    this.arena = name;
    this.geometry = geometry;
    this.layout = layout;
    this.setting = this.build(name, geometry);
    this.collider = new CameraCollider(geometry);
  }

  /** Draw the Arena's Walk Surfaces and Walls over its model, made see-through (a developer view), or not. Kept across setArena. */
  setColliders(on: boolean): void {
    if (on === this.colliders) return;
    this.colliders = on;
    this.showColliders();
  }

  private showColliders(): void {
    if (this.overlay && this.colliders && !this.overlayJumps && this.overlayArena) {
      const arcs = jumpLinkArcs(this.overlayArena, this.tuning);
      if (arcs) this.overlay.add(arcs);
      this.overlayJumps = true;
    }
    if (this.overlay) this.overlay.visible = this.colliders;
    this.seeThrough?.(this.colliders);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(PS1_LINES / h);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // A tall (portrait) screen keeps at least MIN_HORIZONTAL_FOV across, so the opponent stays in view.
    const minVertical = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / this.camera.aspect) * (180 / Math.PI);
    this.camera.fov = Math.max(VERTICAL_FOV, minVertical);
    this.camera.updateProjectionMatrix();
  }

  draw(): void {
    this.animate?.(performance.now() / 1000);
    bakeSkies(this.renderer);
    this.renderer.render(this.scene, this.camera);
  }

  private build(name: string, geometry: ArenaGeometry): THREE.Object3D {
    const look = ARENA_LOOKS[name];
    const layout = this.layout;
    const kitLook = layout && KIT_LOOKS[layout.kit];
    const kit = layout && kitLook ? this.tuning.kits[layout.kit] : undefined;
    const field = isBattleName(name) ? battlefieldOf(this.tuning.battle, name) : null;
    this.camera.far = field ? BATTLEFIELD_FAR : FAR;
    this.camera.updateProjectionMatrix();
    const setting: Setting = field
      ? battle(name, field, () => this.arena === name, floorModelOf(this.tuning, name))
      : look
        ? modelled(name, look, () => this.arena === name)
        : kit && kitLook && layout
          ? kitted(kit, layout, kitLook, geometry, () => this.geometry === geometry)
          : isGreybox(name)
            ? greybox(geometry)
            : outdoors(geometry);
    this.loaded = setting.loaded ?? Promise.resolve();
    this.animate = setting.animate;
    this.scene.background = setting.background;
    this.scene.fog = setting.fog;
    this.scene.add(setting.root);
    this.overlay = colliderView(geometry);
    this.overlayArena = geometry;
    this.overlayJumps = false;
    setting.root.add(this.overlay);
    this.seeThrough = setting.seeThrough;
    this.showColliders();
    return setting.root;
  }
}

interface Setting {
  readonly root: THREE.Object3D;
  readonly background: THREE.Color;
  readonly fog: THREE.Fog;
  /** Resolves when the model is in (modelled Arenas only). */
  readonly loaded?: Promise<void>;
  /** Moves its moving parts to the time given (s). */
  readonly animate?: (seconds: number) => void;
  /** Draws the model see-through, or solid; applied to the model when it loads too (modelled Arenas only). */
  readonly seeThrough?: (on: boolean) => void;
}

/** An open-air Arena: sky, sun, a grass plain and the Walk Surfaces as sand-coloured ground. */
function outdoors(arena: ArenaGeometry): Setting {
  const root = new THREE.Group();
  root.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 10, -3);
  root.add(sun);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x6b8e4e }));
  grass.rotation.x = -Math.PI / 2;
  root.add(grass);
  root.add(walkSurfaces(arena, new THREE.MeshLambertMaterial({ color: 0xc8b48a, flatShading: true, side: THREE.DoubleSide })));
  return { root, background: new THREE.Color(0x9fc9e8), fog: new THREE.Fog(0x9fc9e8, 20, 60) };
}

/** The Walk Surfaces as triangle fans, a centimetre up. */
function walkSurfaces(arena: ArenaGeometry, material: THREE.Material): THREE.Mesh {
  const positions = walkFans(arena.walk, 0.01);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

const models = new Map<string, Promise<THREE.Object3D>>();

/** Flat Lambert materials like the rest of the scene; glass and flames keep their glow. */
function lambert(o: THREE.Mesh): void {
  const from = o.material as THREE.MeshStandardMaterial;
  o.material = new THREE.MeshLambertMaterial({ name: from.name, color: from.color, emissive: from.emissive, emissiveIntensity: from.emissiveIntensity, side: from.side });
}

function arenaModel(name: string, lamps: readonly Lamp[]): Promise<THREE.Object3D> {
  let p = models.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/arenas/${name}.glb`).then((gltf) => prepared(gltf.scene, lamps));
    models.set(name, p);
  }
  return p;
}

/**
 * A Map Editor map's model (`mapModel`) made ready to draw as the game draws it once loaded (`setDraftBattleModel`): Lambert materials, the
 * torches' lamps, the triplanar textures. For the editor's 3D view; a model is made ready once.
 */
export function drawnMapModel(model: THREE.Object3D): THREE.Object3D {
  // Once: drawn again (an overlay toggled), it is already made ready.
  if (model.userData.drawn) return model;
  model.userData.drawn = true;
  texturedModel(prepared(model, BATTLE_LAMPS));
  return model;
}

/** A loaded model made ready to draw: Lambert materials, fixed transforms, and only the lamps listed (each set as listed). */
function prepared(root: THREE.Object3D, lamps: readonly Lamp[]): THREE.Object3D {
  const dropped: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      lambert(o);
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    } else if (o instanceof THREE.PointLight) {
      const lamp = lamps.find((l) => o.name.startsWith(l.prefix));
      if (!lamp) {
        dropped.push(o);
        return;
      }
      o.intensity = lamp.intensity;
      o.distance = lamp.distance;
      o.decay = 1.6;
      o.color.set(lamp.color);
    }
  });
  for (const o of dropped) o.removeFromParent();
  return root;
}

/** The lamps a Battle map's model keeps: a Map Editor map's torches (the generators' models carry no lights). */
const BATTLE_LAMPS: readonly Lamp[] = [TORCH_LIGHT];

/** Models of Map Editor drafts, by map (and the file each was read from), drawn in place of any saved file while set (the play-test's, `setDraftBattleModel`). */
const draftModels = new Map<string, { readonly glb: ArrayBuffer; readonly model: Promise<THREE.Object3D> }>();

/**
 * Draw the Battle map `map` from `glb` (a Map Editor draft's model, as Save would write it: `exportMapModel`) until it is cleared
 * (`clearDraftBattleModel`), in place of its saved model or its greybox: the play-test draws the draft as the game will once it is saved.
 * Resolves once it is read.
 */
export function setDraftBattleModel(map: string, glb: ArrayBuffer): Promise<void> {
  const model = new GLTFLoader().parseAsync(glb, '').then((gltf) => prepared(gltf.scene, BATTLE_LAMPS));
  draftModels.set(map, { glb, model });
  return model.then(() => undefined);
}

/** Stop drawing `map` from the draft model read from `glb`; a later draft's (a play-test started since) is left as it is. */
export function clearDraftBattleModel(map: string, glb: ArrayBuffer): void {
  if (draftModels.get(map)?.glb === glb) draftModels.delete(map);
}

/** The sky a Map Editor map's model names (dusk for any other model). */
function skyOf(model: THREE.Object3D): BattleSky {
  const sky: unknown = model.getObjectByName(MAP_MODEL_ROOT)?.userData.sky;
  return (BATTLE_SKIES as readonly unknown[]).includes(sky) ? (sky as BattleSky) : 'dusk';
}

/** A modelled Arena: its room lights and air (`look`), and its model once loaded. */
function modelled(name: string, look: ArenaLook, current: () => boolean): Setting {
  const root = new THREE.Group();
  root.add(...look.lights());
  if (look.sky) root.add(sky(look.sky));
  if (look.snow) root.add(snowfall(look.snow));
  let bands: ScrollBand[] = [];
  // The model is shared by every Match in its Arena, so the see-through setting is applied to it whenever it is shown.
  let clear = false;
  let shown: THREE.Object3D | undefined;
  const loaded = arenaModel(name, look.lamps)
    .then((model) => {
      for (const node of look.unfogged ?? []) model.getObjectByName(node)?.traverse(unfog);
      if (look.windows) glaze(model, look.windows);
      if (look.scroll) bands = scrolling(model, look.scroll);
      // Shown only if this Arena is still the one drawn once it has loaded.
      if (current()) {
        shown = model;
        seeThrough(model, clear);
        root.add(model);
      }
    })
    .catch((e: unknown) => console.error(`Arena model "${name}" failed to load`, e));
  const speed = look.scroll?.speed ?? 0;
  const animate = look.scroll
    ? (seconds: number) => {
        for (const b of bands) b.group.position.z = -((seconds * speed * b.parallax) % b.length);
      }
    : undefined;
  const see = (on: boolean) => {
    clear = on;
    if (shown) seeThrough(shown, on);
  };
  return { root, background: new THREE.Color(look.background), fog: new THREE.Fog(look.fog.color, look.fog.near, look.fog.far), loaded, animate, seeThrough: see };
}

/**
 * A Battlefield's setting: the sky, light, ground and haze (`battlefieldSetting`), and on a hand-built Battle map (docs/plans/battle-objectives.md,
 * Stage 3a) its model, `public/models/arenas/battle_<map>.glb` (exported by `art/build_battle_<map>.py`, or by the Map Editor's Save), on the flat
 * ground once loaded, or, with no model (a draft in the Map Editor), its Walk Surfaces and Walls (`battleGreybox`). A draft being play-tested is
 * drawn from its own model (`setDraftBattleModel`). A Map Editor map's model names its sky and light (`BATTLE_LOOKS`), put in once it has loaded.
 */
function battle(name: string, field: Battlefield, current: () => boolean, floor: THREE.Object3D | null = null): Setting {
  const map = battleMapName(name);
  // A hand-built map models its own ground; the flat grass plane would only show through it and run on past its edge.
  const setting = battlefieldSetting(field.heights, map === null);
  if (map === null) return setting;
  /** The sky, lights (and snow) dusk put in, taken out again for another look. */
  const dusk = [...setting.root.children];
  // A Delver Floor is drawn from its generated source, made ready at once (no file to load).
  const draft = floor ? Promise.resolve(floor) : draftModels.get(map)?.model;
  if (!draft && !hasBattleModel(map)) {
    setting.root.add(battleGreybox(field.arena));
    return setting;
  }
  const loaded = (draft ?? arenaModel(`battle_${map}`, BATTLE_LAMPS))
    .then((model) => {
      texturedModel(model);
      if (!current()) return;
      const sky = skyOf(model);
      if (sky !== 'dusk') {
        // The same root, fog and background the Stage holds, made over in the map's look.
        const look = lookSetting(battleLook(sky));
        setting.root.remove(...dusk);
        setting.root.add(...look.root.children);
        setting.fog.color.copy(look.fog.color);
        setting.fog.near = look.fog.near;
        setting.fog.far = look.fog.far;
        setting.background.copy(look.background);
      }
      setting.root.add(model);
    })
    .catch((e: unknown) => {
      console.error(`Battle map model "${map}" failed to load`, e);
      // A map shipped without its model (its .glb not moved into public/ beside its files) is still drawn: from its Walk Surfaces and Walls.
      if (current()) setting.root.add(battleGreybox(field.arena));
    });
  return { ...setting, loaded };
}

/** The last few Delver Floors' drawn models, by Arena name (most recently used last): a restart may rebuild a Floor, the model is the same. */
const KEPT_FLOOR_MODELS = 3;
const floorModels = new Map<string, THREE.Object3D>();

/**
 * The drawn model of Delver Floor Arena `name` (docs/plans/delver.md, Stage 2): the Floor's source compiled for its Battle Tuning and drawn as the
 * Map Editor's 3D view draws it (`mapModel`, `drawnMapModel`), kept per name. Null for any other name. `tuning` is the world's for the Floor
 * (`arenaTuning`), or its base: `floorOf` reads both.
 */
function floorModelOf(tuning: TuningData, name: string): THREE.Object3D | null {
  if (!parseFloorArena(name) || !isFloorName(battleMapName(name) ?? '')) return null;
  let model = floorModels.get(name);
  if (model) {
    floorModels.delete(name);
  } else {
    const floor = floorOf(tuning, name);
    if (!floor) return null;
    model = drawnMapModel(mapModel(floor.source, compileDraft(floor.source, floor.battle)));
    if (floorModels.size >= KEPT_FLOOR_MODELS) floorModels.delete(floorModels.keys().next().value!);
  }
  floorModels.set(name, model);
  return model;
}

const kitModels = new Map<string, Promise<THREE.Object3D>>();

/** A Kit's model (loaded once, shared by every Generated Arena of the Kit): a root node per Piece, holding its look. */
function kitModel(name: string): Promise<THREE.Object3D> {
  let p = kitModels.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/kits/${name}.glb`).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) lambert(o);
      });
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
    kitModels.set(name, p);
  }
  return p;
}

/** The Kit model's parts placed as `placements` says: one InstancedMesh per mesh of each node, an instance per placement. */
function kitInstances(model: THREE.Object3D, placements: readonly KitPlacement[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'kit';
  const byNode = new Map<string, THREE.Matrix4[]>();
  for (const p of placements) {
    const list = byNode.get(p.node) ?? [];
    list.push(new THREE.Matrix4().fromArray(p.matrix));
    byNode.set(p.node, list);
  }
  for (const [node, matrices] of byNode) {
    const template = model.getObjectByName(node) ?? (STAND_IN_NODES[node] ? model.getObjectByName(STAND_IN_NODES[node]) : undefined);
    if (!template) {
      console.error(`Kit model has no node "${node}"`);
      continue;
    }
    // Each mesh relative to its Piece's root: where the root stands in the model file is ignored.
    const toRoot = template.matrixWorld.clone().invert();
    template.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const local = toRoot.clone().multiply(o.matrixWorld);
      const mesh = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
      mesh.name = `${node}:${o.name}`;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m.clone().multiply(local)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
  }
  return group;
}

/** A Generated Arena drawn from its Kit's model: the Kit's lights, air and sky (`look`), the Abyss, and each placed Piece once the model has loaded. */
function kitted(kit: Kit, layout: Layout, look: ArenaLook, arena: ArenaGeometry, current: () => boolean): Setting {
  const root = new THREE.Group();
  root.add(...look.lights());
  if (look.sky) root.add(sky(look.sky));
  const pit = abyss(arena);
  if (pit) root.add(pit);
  let clear = false;
  let shown: THREE.Object3D | undefined;
  const loaded = kitModel(kit.name)
    .then((model) => {
      if (!current()) return;
      shown = kitInstances(model, kitPlacements(kit, layout));
      seeThrough(shown, clear);
      root.add(shown);
    })
    .catch((e: unknown) => console.error(`Kit model "${kit.name}" failed to load`, e));
  const see = (on: boolean) => {
    clear = on;
    if (shown) seeThrough(shown, on);
  };
  return { root, background: new THREE.Color(look.background), fog: new THREE.Fog(look.fog.color, look.fog.near, look.fog.far), loaded, seeThrough: see };
}

/** Draws the windows' glass as the sky beyond it. */
function glaze(model: THREE.Object3D, windows: NonNullable<ArenaLook['windows']>): void {
  let pane: THREE.ShaderMaterial | undefined;
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.material.name !== windows.material) return;
    pane ??= skyPane(windows.sky, windows.tint, windows.amount);
    pane.name = windows.material;
    o.material = pane;
  });
}

function unfog(o: THREE.Object3D): void {
  if (o instanceof THREE.Mesh) (o.material as THREE.MeshLambertMaterial).fog = false;
}

interface ScrollBand {
  /** Holds the tile's copies end to end; slid back by up to a tile's length. */
  readonly group: THREE.Group;
  readonly length: number;
  readonly parallax: number;
}

/** Sets up `model`'s scrolling bands (once: the model is shared by every Match in its Arena). */
function scrolling(model: THREE.Object3D, look: ScrollLook): ScrollBand[] {
  const made = model.userData.scrollBands as ScrollBand[] | undefined;
  if (made) return made;
  const bands: ScrollBand[] = [];
  for (const { node, length, parallax } of look.bands) {
    const tile = model.getObjectByName(node);
    if (!tile) continue;
    const group = new THREE.Group();
    tile.parent!.add(group);
    // Copies one tile back, here and one ahead: slid back by up to a tile, they always cover a tile either side.
    for (const k of [-1, 0, 1]) {
      const copy = k === 0 ? tile : tile.clone();
      copy.position.z += k * length;
      copy.updateMatrix();
      group.add(copy);
    }
    bands.push({ group, length, parallax });
  }
  model.userData.scrollBands = bands;
  return bands;
}
