import * as THREE from 'three';
import type { FighterState, SimState } from '../sim';
import type { TuningData } from '../tuning';

const FIGHTER_COLOURS = [0xc0392b, 0x2e86c1];

/**
 * Three.js view of the Simulation. Reads Simulation state, interpolates between
 * the previous and current Tick, and never writes back.
 */
export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly fighterMeshes: THREE.Object3D[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly tuning: TuningData,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fc9e8); // sky
    this.scene.fog = new THREE.Fog(0x9fc9e8, 20, 60);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.camera.position.set(0, 3, -6);
    this.camera.lookAt(0, 1, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, -3);
    this.scene.add(sun);

    this.scene.add(this.buildArena());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildArena(): THREE.Object3D {
    const group = new THREE.Group();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0x6b8e4e }),
    );
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);
    const arena = new THREE.Mesh(
      new THREE.CircleGeometry(this.tuning.arena.radius, 64),
      new THREE.MeshLambertMaterial({ color: 0xc8b48a, flatShading: true }),
    );
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.01;
    group.add(arena);
    return group;
  }

  /** Placeholder Fighter: a capsule body. The primitive Skeleton replaces it later. */
  private buildFighter(index: number): THREE.Object3D {
    const { radius, height } = this.tuning.fighter;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, height - 2 * radius, 4, 12),
      new THREE.MeshLambertMaterial({ color: FIGHTER_COLOURS[index % FIGHTER_COLOURS.length], flatShading: true }),
    );
    body.position.y = height / 2;
    // A nose so facing is visible.
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.25), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    nose.position.set(0, height * 0.85, radius);
    const root = new THREE.Group();
    root.add(body, nose);
    return root;
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draw a frame between Tick `prev` and Tick `curr`; `alpha` in [0, 1]. */
  render(prev: SimState, curr: SimState, alpha: number): void {
    curr.fighters.forEach((f, i) => {
      let mesh = this.fighterMeshes[i];
      if (!mesh) {
        mesh = this.buildFighter(i);
        this.fighterMeshes[i] = mesh;
        this.scene.add(mesh);
      }
      placeFighter(mesh, prev.fighters[i] ?? f, f, alpha);
    });
    this.renderer.render(this.scene, this.camera);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function placeFighter(obj: THREE.Object3D, a: FighterState, b: FighterState, t: number): void {
  obj.position.set(
    a.position.x + (b.position.x - a.position.x) * t,
    0,
    a.position.z + (b.position.z - a.position.z) * t,
  );
  obj.rotation.y = lerpAngle(a.facing, b.facing, t);
}
