import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { arenaOf } from '../sim';
import type { ArenaGeometry, TuningData } from '../tuning';
import { CameraCollider } from './cameraCollider';

/** Camera field of view (degrees): vertical on a wide screen, widened on a tall one to keep this much across. */
const VERTICAL_FOV = 60;
const MIN_HORIZONTAL_FOV = 62;

const MAX_PIXEL_RATIO = 1.5;
/** The game lowers its own resolution in steps when frames run slow (a weak or wrong GPU), never below this, and never raises it again. */
const MIN_PIXEL_RATIO = 0.75;
const PIXEL_RATIO_STEP = 0.5;
/** Frames averaged before judging, and the average frame time (ms) above which it steps down (about 45 fps). */
const ADAPT_FRAMES = 90;
const SLOW_FRAME_MS = 22;

/** Arenas drawn from a model (public/models/arenas/<name>.glb, exported by art/build_<name>.py); the rest are drawn from their Walk Surfaces. */
const ARENA_MODELS: ReadonlySet<string> = new Set(['library']);

/** Lamps left out of the scene: each point light costs every pixel of every surface, so the faint, far ones go and the ambient light stands in. */
const DROPPED_LAMPS: readonly string[] = ['LIGHT_table', 'LIGHT_sconce2', 'LIGHT_sconce3'];

/** Each lamp of a model, by name prefix: its brightness (candela) and how far it reaches (m). */
const LAMPS: readonly { readonly prefix: string; readonly intensity: number; readonly distance: number }[] = [
  { prefix: 'LIGHT_chandelier', intensity: 70, distance: 26 },
  { prefix: 'LIGHT_sconce', intensity: 7, distance: 9 },
  { prefix: 'LIGHT_table', intensity: 4, distance: 6 },
  { prefix: 'LIGHT_gallery', intensity: 14, distance: 12 },
];

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
  private setting: THREE.Object3D;
  private pixelRatio: number;
  private lastFrame = 0;
  private slowTime = 0;
  private slowFrames = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly tuning: TuningData,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Fill rate is the cost here (per-pixel lights): a 2x display would shade four times the pixels for little visible gain.
    this.pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(this.pixelRatio);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.05, 200);
    this.camera.position.set(0, 3, -6);
    this.camera.lookAt(0, 1, 0);

    this.arena = tuning.arena.editor;
    const geometry = arenaOf(tuning, this.arena);
    this.setting = this.build(this.arena, geometry);
    this.collider = new CameraCollider(geometry);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Draw the Arena named `name` (a Tuning Data Arena); nothing changes if it is already drawn. */
  setArena(name: string): void {
    if (name === this.arena) return;
    this.scene.remove(this.setting);
    this.arena = name;
    const geometry = arenaOf(this.tuning, name);
    this.setting = this.build(name, geometry);
    this.collider = new CameraCollider(geometry);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // A tall (portrait) screen keeps at least MIN_HORIZONTAL_FOV across, so the opponent stays in view.
    const minVertical = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / this.camera.aspect) * (180 / Math.PI);
    this.camera.fov = Math.max(VERTICAL_FOV, minVertical);
    this.camera.updateProjectionMatrix();
  }

  draw(): void {
    this.renderer.render(this.scene, this.camera);
    this.adapt();
  }

  /** Steps the resolution down once a run of frames averages slow. Long gaps (a hidden tab) are not counted. */
  private adapt(): void {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 250 || this.pixelRatio <= MIN_PIXEL_RATIO) return;
    this.slowTime += dt;
    if (++this.slowFrames < ADAPT_FRAMES) return;
    if (this.slowTime / this.slowFrames > SLOW_FRAME_MS) {
      this.pixelRatio = Math.max(MIN_PIXEL_RATIO, this.pixelRatio - PIXEL_RATIO_STEP);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
    this.slowTime = this.slowFrames = 0;
  }

  private build(name: string, geometry: ArenaGeometry): THREE.Object3D {
    const setting = ARENA_MODELS.has(name) ? indoors(name, () => this.arena === name) : outdoors(geometry);
    this.scene.background = setting.background;
    this.scene.fog = setting.fog;
    this.scene.add(setting.root);
    return setting.root;
  }
}

interface Setting {
  readonly root: THREE.Object3D;
  readonly background: THREE.Color;
  readonly fog: THREE.Fog;
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
  const positions: number[] = [];
  for (const s of arena.walk) {
    const p = s.points;
    for (let k = 1; k + 1 < p.length; k++) for (const q of [p[0]!, p[k]!, p[k + 1]!]) positions.push(q.x, q.y + 0.01, q.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

const models = new Map<string, Promise<THREE.Object3D>>();

function arenaModel(name: string): Promise<THREE.Object3D> {
  let p = models.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/arenas/${name}.glb`).then((gltf) => {
      const root = gltf.scene;
      const dropped: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          // Flat Lambert materials like the rest of the scene; glass and flames keep their glow.
          const from = o.material as THREE.MeshStandardMaterial;
          o.material = new THREE.MeshLambertMaterial({ color: from.color, emissive: from.emissive, emissiveIntensity: from.emissiveIntensity, side: from.side });
          o.matrixAutoUpdate = false;
          o.updateMatrix();
        } else if (o instanceof THREE.PointLight && DROPPED_LAMPS.some((n) => o.name.startsWith(n))) {
          dropped.push(o);
        } else if (o instanceof THREE.PointLight) {
          const lamp = LAMPS.find((l) => o.name.startsWith(l.prefix));
          o.intensity = lamp?.intensity ?? 5;
          o.distance = lamp?.distance ?? 8;
          o.decay = 1.6;
          o.color.set(0xffb470);
        }
      });
      for (const o of dropped) o.removeFromParent();
      return root;
    });
    models.set(name, p);
  }
  return p;
}

/** A modelled indoor Arena (the library): warm, dim candlelight, cool moonlight through the windows, and brown haze. */
function indoors(name: string, current: () => boolean): Setting {
  const root = new THREE.Group();
  root.add(new THREE.HemisphereLight(0x8c97b8, 0x3a2616, 0.9));
  root.add(new THREE.AmbientLight(0x5a4632, 0.72));
  const moon = new THREE.DirectionalLight(0xa8bcff, 0.7);
  moon.position.set(-8, 14, -5);
  root.add(moon);
  const warm = new THREE.DirectionalLight(0xffc890, 0.35);
  warm.position.set(6, 9, 8);
  root.add(warm);
  void arenaModel(name)
    .then((model) => {
      // Shown only if this Arena is still the one drawn once it has loaded.
      if (current()) root.add(model);
    })
    .catch((e: unknown) => console.error(`Arena model "${name}" failed to load`, e));
  return { root, background: new THREE.Color(0x0e0a07), fog: new THREE.Fog(0x22170f, 16, 48) };
}
