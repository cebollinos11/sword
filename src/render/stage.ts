import * as THREE from 'three';
import type { TuningData } from '../tuning';

/** The shared 3D scene: WebGL renderer, camera, lights, ground, Arena and sky. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  constructor(
    private readonly container: HTMLElement,
    tuning: TuningData,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fc9e8); // sky
    this.scene.fog = new THREE.Fog(0x9fc9e8, 20, 60);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
    this.camera.position.set(0, 3, -6);
    this.camera.lookAt(0, 1, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, -3);
    this.scene.add(sun);

    this.scene.add(buildArena(tuning.arena.radius));

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  draw(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function buildArena(radius: number): THREE.Object3D {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x6b8e4e }));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const arena = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    new THREE.MeshLambertMaterial({ color: 0xc8b48a, flatShading: true }),
  );
  arena.rotation.x = -Math.PI / 2;
  arena.position.y = 0.01;
  group.add(arena);
  return group;
}
