/**
 * The Map Editor's 3D view (docs/plans/map-editor.md, Stage 2): the compiled draft as the greybox the game draws a map with no model in
 * (`greybox`: floors tinted by height under a metre grid, Walls as thin boxes, the Walls triplanar-textured as stone), seen through an orbit
 * camera, with the same overlays as the top view: reachability, edges, the destination fields' clearance and the cell centres Walls cut
 * off, and the Objectives and Bases as posts. Render-only; it reads the checks (`checks.ts`) and draws, nothing more.
 *
 * Stage 5: given the map's model (`render/mapModel.ts`), it draws that instead of the greybox, as the game draws a loaded one (Lambert,
 * triplanar textures, torches lit), under the map's sky and light: the look the map ships with, under the same overlays.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { frameArena } from '../../editor/arenaLab';
import { greybox } from '../../render/greybox';
import { applyTriplanar } from '../../render/triplanar';
import { battleLook, drawnMapModel } from '../../render/stage';
import { lookSetting } from '../../render/battlefieldView';
import { bakeSkies } from '../../render/sky';
import type { BattleSky } from '../source';
import { groundNear, surfaceHeight } from '../../sim';
import type { LevelsTuning } from '../../tuning';
import type { ClearanceNode, EdgeKind, MapChecks, SurfaceReach } from '../checks';
import type { Rect } from '../source';
import { clearanceColour, EDGE_COLOURS, REACH_COLOURS, type Overlays } from './overlays';

const FOV = 50;
/** How far (m) over its floor an overlay is drawn, so it does not fight the floor for depth. */
const LIFT = { reach: 0.04, clearance: 0.08, edges: 0.12, centres: 0.3 };
const TEAM = [0xe0c040, 0x4080e0];
/** How long (ms) after the look is drawn the view keeps drawing (its textures, and its sky, come in a moment later). */
const SETTLE_MS = 2500;

export class View3D {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 2000);
  private readonly controls: OrbitControls;
  private content: THREE.Object3D | null = null;
  private framedFor: string | null = null;
  /** The reach overlay's unreached floors, which flash. */
  private flashing: THREE.MeshBasicMaterial[] = [];
  private visible = false;
  private animating = false;
  /** Draw every frame until this time (ms): the look's textures are loading. */
  private settleUntil = 0;

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
    parent.appendChild(this.canvas);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.addEventListener('change', () => this.render());
    new ResizeObserver(() => this.fit()).observe(this.canvas);
  }

  show(on: boolean): void {
    this.visible = on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) {
      this.fit();
      this.loop();
    }
  }

  /** Draw `checks`' draft with the overlays switched on (and the clearance, when it has been built). */
  update(checks: MapChecks, overlays: Overlays, clearance: readonly ClearanceNode[] | null, lv: LevelsTuning, model: THREE.Object3D | null = null): void {
    if (this.content) {
      this.scene.remove(this.content);
      // The same model drawn again (an overlay toggled) is kept; the rest goes.
      if (model) model.removeFromParent();
      dispose(this.content);
    }
    this.content = null;
    this.flashing = [];
    const draft = checks.draft;
    if (!draft) {
      this.scene.background = new THREE.Color(0x2a1d1d);
      this.render();
      return;
    }
    let root: THREE.Group;
    if (model) {
      // The look: the model under its sky's light, its sky dome (or haze) behind; no fog, so the whole map shows.
      const look = lookSetting(battleLook((checks.source.look?.sky ?? 'dusk') as BattleSky));
      root = look.root;
      root.add(drawnMapModel(model));
      this.scene.background = look.background;
      // The textures load a moment after the first one asks: keep drawing until they are in.
      this.settleUntil = performance.now() + SETTLE_MS;
    } else {
      const look = greybox(draft.arena);
      const walls = look.root.getObjectByName('greybox-walls');
      if (walls instanceof THREE.Mesh) applyTriplanar(walls.material as THREE.Material, 'stone');
      this.scene.background = look.background;
      root = look.root;
      const deadly = draft.map.walk.filter((w) => w.lava || w.water);
      if (deadly.length) root.add(fans(deadly.map((w) => ({ points: w.points, colour: w.lava ? 0xff5a1f : 0x2f7fe0 })), 0.02, 0.9));
    }
    if (overlays.reach) {
      const groups = new Map<SurfaceReach, typeof draft.map.walk[number][]>();
      draft.map.walk.forEach((w, i) => {
        const r = checks.reach[i]!;
        if (r === 'deadly') return;
        groups.set(r, [...(groups.get(r) ?? []), w]);
      });
      for (const [r, list] of groups) {
        const mesh = fans(list.map((w) => ({ points: w.points, colour: REACH_COLOURS[r] })), LIFT.reach, r === 'reached' ? 0.25 : 0.6);
        if (r !== 'reached') this.flashing.push(mesh.material as THREE.MeshBasicMaterial);
        root.add(mesh);
      }
    }
    if (overlays.edges) {
      const pos: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      for (const e of checks.edges) {
        if (!overlays.edgeKinds[e.kind]) continue;
        c.set(EDGE_COLOURS[e.kind as EdgeKind]);
        pos.push(e.a.x, e.a.y + LIFT.edges, e.a.z, e.b.x, e.b.y + LIFT.edges, e.b.z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: true })));
    }
    if (overlays.clearance && clearance) {
      const half = checks.centres.cell * 0.42;
      root.add(
        fans(
          clearance.map((n) => ({
            points: [
              { x: n.x - half, y: n.y, z: n.z - half },
              { x: n.x + half, y: n.y, z: n.z - half },
              { x: n.x + half, y: n.y, z: n.z + half },
              { x: n.x - half, y: n.y, z: n.z + half },
            ],
            colour: clearanceColour(n),
          })),
          LIFT.clearance,
          0.6,
        ),
      );
    }
    if (overlays.centres && checks.centres.hits.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(checks.centres.hits.flatMap((h) => [h.x, h.y + LIFT.centres, h.z]), 3));
      root.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff3b3b, size: 8, sizeAttenuation: false, depthTest: false })));
    }
    // The Objectives and the Bases, standing where the Battlefield stands them.
    const post = (x: number, z: number, y: number | undefined, colour: number, height: number) => {
      const s = groundNear(draft.arena, lv, x, z, y ?? Infinity, true);
      const at = s >= 0 ? surfaceHeight(draft.arena, s, x, z) : 0;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, height, 10), new THREE.MeshLambertMaterial({ color: colour }));
      m.position.set(x, at + height / 2, z);
      root.add(m);
    };
    // The axes at the centre: x (east) red, y up green, z (north) blue. Seen from above in 3D, east lies left of north (the top view is drawn east right).
    const axes = new THREE.AxesHelper(12);
    axes.position.y = 0.2;
    root.add(axes);
    for (const o of checks.source.objectives) post(o.x, o.z, o.y, o.owner < 0 ? 0xf0f0f0 : TEAM[o.owner]!, 6);
    checks.source.bases.forEach((b, t) => post(b.x, b.z, undefined, TEAM[t]!, 3));
    this.content = root;
    this.scene.add(root);
    if (this.settleUntil > performance.now()) this.loop();
    // Framed once per map (a new map, or one opened), so an edit keeps the camera where the author left it.
    if (this.framedFor !== checks.source.name) {
      this.framedFor = checks.source.name;
      const { target, position } = frameArena(draft.arena, FOV);
      this.controls.target.set(target.x, target.y, target.z);
      this.camera.position.set(position.x, position.y, position.z);
      this.controls.update();
    }
    this.render();
  }

  /** Turn the camera to look at `rect` (an issue's Brushes on map `name`) from where it stands, close enough to see it whole; the map is then not framed whole again. */
  focus(rect: Rect, y: number, name: string): void {
    this.framedFor = name;
    const target = new THREE.Vector3((rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2);
    const radius = Math.max(6, Math.hypot(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2);
    // From where the camera looks now; before it has looked anywhere, from above and behind red's side, as `frameArena` stands it.
    const back = this.camera.position.clone().sub(this.controls.target);
    if (back.lengthSq() < 1e-9) back.set(0, 0.77, -0.64);
    back.normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(back, (1.4 * radius) / Math.tan((FOV * Math.PI) / 360));
    this.controls.update();
    this.render();
  }

  /** Forget the framing, so the next map drawn is framed whole. */
  reframe(): void {
    this.framedFor = null;
  }

  private fit(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** While shown and something flashes, keep drawing. */
  private loop(): void {
    if (this.animating) return;
    this.animating = true;
    const step = (t: number) => {
      if (!this.visible) {
        this.animating = false;
        return;
      }
      if (this.flashing.length) for (const m of this.flashing) m.opacity = 0.35 + 0.35 * Math.sin(t / 160);
      if (this.flashing.length || performance.now() < this.settleUntil) this.render();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private render(): void {
    if (!this.visible) return;
    bakeSkies(this.renderer);
    this.renderer.render(this.scene, this.camera);
  }
}

/** Convex polygons as one mesh of triangle fans, each in its own colour, `lift` over their heights. */
function fans(polys: readonly { points: readonly { x: number; y: number; z: number }[]; colour: number | string }[], lift: number, opacity: number): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const { points: p, colour } of polys) {
    c.set(colour);
    for (let k = 1; k + 1 < p.length; k++)
      for (const q of [p[0]!, p[k]!, p[k + 1]!]) {
        pos.push(q.x, q.y + lift, q.z);
        col.push(c.r, c.g, c.b);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
}

function dispose(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) {
      o.geometry.dispose();
      const m = o.material as THREE.Material | THREE.Material[];
      for (const x of Array.isArray(m) ? m : [m]) {
        (x as THREE.MeshLambertMaterial).map?.dispose();
        x.dispose();
      }
    }
  });
}
