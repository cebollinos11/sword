import * as THREE from 'three';

const FLAME_COLORS = [0xff5a1e, 0xff9a2a, 0xffd56a];
const LOG_LIT = 0x5a3a20;
const LOG_BURNT = 0x2a2522;
const EMBER_COLOR = 0xc8431c;
/** Drawn this far (m) over the ground, so the fire never flickers into it. */
const LIFT = 0.03;

/** A Rest Hall's fire as one Player sees it: burning until they have rested, then embers. */
export type FireState = 'lit' | 'embers';

/** The fire `viewer` (a Player Fighter, -1 for none) sees, from the Players that took it (`Run.rested`). Render only. */
export const fireState = (rested: readonly number[], viewer: number): FireState => (rested.includes(viewer) ? 'embers' : 'lit');

/**
 * A Rest Hall's fire (docs/plans/dungeon.md, Stage 3): crossed logs under three nested flames that flicker with the frames drawn,
 * or, once the local Player has rested, charred logs and a few glowing embers. `kit` is the seam for a Kit's model (#62): given, it is
 * drawn in place of the fallback meshes, and its children named `flames` and `embers`, if it has them, follow the state. The fire owns
 * only what it makes, and `dispose` frees that; a Kit node stays its owner's.
 */
export class RestFire {
  readonly root = new THREE.Group();
  private readonly flames: THREE.Object3D = new THREE.Group();
  private readonly embers: THREE.Object3D = new THREE.Group();
  private readonly logs: THREE.MeshBasicMaterial | null = null;
  private readonly owned: { dispose(): void }[] = [];
  private state: FireState = 'lit';
  private clock = 0;

  constructor(at: { readonly x: number; readonly y: number; readonly z: number }, kit?: THREE.Object3D) {
    this.root.position.set(at.x, at.y + LIFT, at.z);
    this.flames.name = 'flames';
    this.embers.name = 'embers';
    if (kit) {
      this.root.add(kit);
      this.flames = kit.getObjectByName('flames') ?? this.flames;
      this.embers = kit.getObjectByName('embers') ?? this.embers;
      return;
    }
    const logs = this.own(new THREE.MeshBasicMaterial({ color: LOG_LIT }));
    this.logs = logs;
    const log = this.own(new THREE.BoxGeometry(0.1, 0.1, 0.9));
    for (const yaw of [Math.PI / 4, -Math.PI / 4]) {
      const mesh = new THREE.Mesh(log, logs);
      mesh.position.y = 0.05;
      mesh.rotation.y = yaw;
      this.root.add(mesh);
    }
    // Three cones, the tallest outermost; the group's height flickers.
    FLAME_COLORS.forEach((color, i) => {
      const height = 0.75 - i * 0.2;
      const flame = new THREE.Mesh(this.own(new THREE.ConeGeometry(0.3 - i * 0.08, height, 8)), this.own(new THREE.MeshBasicMaterial({ color })));
      flame.position.y = 0.08 + height / 2;
      this.flames.add(flame);
    });
    const ember = this.own(new THREE.BoxGeometry(0.07, 0.04, 0.07));
    const glow = this.own(new THREE.MeshBasicMaterial({ color: EMBER_COLOR }));
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(ember, glow);
      const a = (i / 6) * Math.PI * 2;
      mesh.position.set(Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18);
      mesh.rotation.y = a * 3;
      this.embers.add(mesh);
    }
    this.root.add(this.flames, this.embers);
    this.setState('lit');
  }

  private own<T extends { dispose(): void }>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  setState(state: FireState): void {
    this.state = state;
    this.flames.visible = state === 'lit';
    this.embers.visible = state === 'embers';
    this.logs?.color.setHex(state === 'lit' ? LOG_LIT : LOG_BURNT);
  }

  /** Flicker the flames, `seconds` of wall time after the last call. */
  animate(seconds: number): void {
    this.clock += seconds;
    if (this.state !== 'lit') return;
    this.flames.scale.set(1 + 0.08 * Math.sin(this.clock * 9), 1 + 0.15 * Math.sin(this.clock * 13 + 1), 1 + 0.08 * Math.sin(this.clock * 11 + 2));
  }

  /** Free every geometry and material the fire made. */
  dispose(): void {
    for (const r of this.owned) r.dispose();
    this.owned.length = 0;
  }
}
