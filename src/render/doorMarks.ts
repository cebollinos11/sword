import * as THREE from 'three';
import { doorway } from './doorway';
import { hallIcon, iconTexture } from '../play/icons';
import type { DoorMarkView } from '../play/doorMarks';
import type { SimHall } from '../sim';
import type { ArenaDoor, ArenaGeometry } from '../tuning';

/** A doorway's height (m): the frame's posts (hallMarks.ts); the gate hangs from the lintel down to the ground. */
const GATE_HEIGHT = 2.4;
const GATE_COLOR = 0x4a4d55;
/** The icon's centre and size over the doorway's ground, and the text's centre and size under it (m). */
const ICON_AT = 3.35;
const ICON_SIZE = 0.9;
const TEXT_AT = 2.68;
const TEXT_WIDTH = 1.6;
const TEXT_HEIGHT = 0.4;
/** The marks stand this far (m) in front of the Wall, into the Hall. */
const INSET = 0.15;
const ICON_PX = 64;

/**
 * A Door's gate, drawn in its doorway: render only, no collider (ADR 0006, ADR 0019). The seam for the Kit's `door`
 * node (#62): a factory that returns the Kit node as `object` and plays its open animation in `setOpen` replaces
 * `fallbackGate` without anything else changing.
 */
export interface DoorGate {
  /** What to put in the scene, placed in the doorway already. */
  readonly object: THREE.Object3D;
  setOpen(open: boolean): void;
  /** Free what the gate made (geometry, materials). */
  dispose(): void;
}

export type GateFactory = (door: ArenaDoor) => DoorGate;

/** The greybox gate: a dark slab across the doorway, hanging from the lintel; open, it is drawn drawn up into it. */
export const fallbackGate: GateFactory = (door) => {
  const [a, b] = doorway(door);
  const width = Math.hypot(b.x - a.x, b.z - a.z);
  const geometry = new THREE.BoxGeometry(0.08, GATE_HEIGHT, width);
  const material = new THREE.MeshStandardMaterial({ color: GATE_COLOR, roughness: 0.8 });
  const slab = new THREE.Mesh(geometry, material);
  slab.position.y = -GATE_HEIGHT / 2;
  const object = new THREE.Group();
  object.position.set((a.x + b.x) / 2, a.y + GATE_HEIGHT, (a.z + b.z) / 2);
  object.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  object.add(slab);
  return {
    object,
    setOpen: (open) => object.scale.setY(open ? 0.05 : 1),
    dispose: () => (geometry.dispose(), material.dispose()),
  };
};

/** A line of text on a sprite, redrawn when it changes. Without a DOM (node tests) the canvas stays blank. */
class TextSprite {
  readonly sprite: THREE.Sprite;
  private readonly canvas = typeof document === 'undefined' ? ({ width: 256, height: 64 } as HTMLCanvasElement) : document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private text = '';

  constructor() {
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true }));
    this.sprite.scale.set(TEXT_WIDTH, TEXT_HEIGHT, 1);
    this.sprite.visible = false;
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.sprite.visible = text !== '';
    const g = typeof document === 'undefined' ? null : this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.font = 'bold 40px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = '#000c';
    g.strokeText(text, this.canvas.width / 2, this.canvas.height / 2);
    g.fillStyle = '#fff';
    g.fillText(text, this.canvas.width / 2, this.canvas.height / 2);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.material.dispose();
    this.texture.dispose();
  }
}

/** One exit Door's mark in the scene. */
interface Mark {
  readonly gate: DoorGate;
  readonly text: TextSprite;
  readonly icon: THREE.Sprite;
}

/**
 * The marks over a Run's exit Doors (docs/plans/dungeon.md, Stage 3): the icon of the Hall kind behind each as a sprite
 * facing the camera, under it the gathering count ("2 / 3", after a Boss "Floor 2"), and a gate in the doorway, closed
 * while the Hall is fought and open once it is Cleared. The entrance (Door 0) has none. Render only. Rebuilt when the
 * Arena or Hall changes (everything made is disposed then); the gate and the texts follow the marks' views each frame.
 */
export class DoorMarks {
  readonly root = new THREE.Group();
  private key = '';
  private marks: Mark[] = [];

  constructor(private readonly makeGate: GateFactory = fallbackGate) {}

  update(arena: ArenaGeometry, hall: SimHall | undefined, views: readonly DoorMarkView[]): void {
    const key = hall ? `${arena.name}|${hall.floor}.${hall.row}.${hall.index}|${views.map((v) => `${v.exit}${v.icon}${v.label}`).join()}` : '';
    if (key !== this.key) this.build(arena, key, views);
    this.marks.forEach((mark, i) => {
      const view = views[i];
      if (!view) return;
      mark.gate.setOpen(view.gate === 'open');
      mark.text.set([view.label, view.count].filter(Boolean).join(' · '));
    });
  }

  private build(arena: ArenaGeometry, key: string, views: readonly DoorMarkView[]): void {
    this.key = key;
    for (const mark of this.marks) {
      mark.gate.dispose();
      mark.text.dispose();
      mark.icon.material.dispose();
    }
    this.marks = [];
    this.root.clear();
    for (const view of views) {
      const door = arena.doors[view.exit + 1];
      if (!door) continue;
      const [a, b] = doorway(door);
      const group = new THREE.Group();
      group.position.set(
        (a.x + b.x) / 2 - Math.sin(door.facing) * INSET,
        a.y,
        (a.z + b.z) / 2 - Math.cos(door.facing) * INSET,
      );
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(hallIcon(view.icon), ICON_PX), transparent: true }));
      icon.scale.set(ICON_SIZE, ICON_SIZE, 1);
      icon.position.y = ICON_AT;
      const text = new TextSprite();
      text.sprite.position.y = TEXT_AT;
      group.add(icon, text.sprite);
      const gate = this.makeGate(door);
      this.root.add(gate.object, group);
      this.marks.push({ gate, text, icon });
    }
  }
}
