import * as THREE from 'three';
import { restFire, type SimHall } from '../sim';
import type { ArenaDoor, ArenaGeometry } from '../tuning';
import { doorway } from './doorway';
import { RestFire, type FireState } from './restFire';

/** A doorway frame's height (m), and its posts' and lintel's thickness. */
const FRAME_HEIGHT = 2.4;
const FRAME_THICKNESS = 0.18;
const FRAME_COLOR = 0x7d7d84;
/** An exit Door's zone on the ground: shut while the Hall is fought, lit once it is Cleared. */
const ZONE_SHUT = 0x60646c;
const ZONE_OPEN = 0xffd56a;
/** Drawn this far (m) over the ground, so the marks never flicker into it. */
const LIFT = 0.03;

/**
 * Placeholder marks for a Run's Hall (docs/plans/dungeon.md, Stage 1; Stage 3 brings the art): a plain greybox frame
 * in each Door's doorway, each exit Door's zone as a flat patch (grey while the Hall is fought, gold once it is Cleared),
 * and a Rest Hall's fire (`RestFire`). Render only; rebuilt when the Arena drawn changes, recoloured as the
 * Hall's phase does. Nothing outside a Run's Hall.
 */
export class HallMarks {
  readonly root = new THREE.Group();
  private arena: ArenaGeometry | null = null;
  private kind = '';
  private zones: THREE.MeshBasicMaterial[] = [];
  private fire: RestFire | null = null;
  private readonly frame = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.9 });

  /** `fire`: how the Rest fire burns for the local Player (lit until they have rested, then embers). */
  update(arena: ArenaGeometry, hall: SimHall | undefined, fire: FireState = 'lit'): void {
    const kind = hall?.kind ?? '';
    if (arena !== this.arena || kind !== this.kind) this.build(arena, hall);
    const open = hall !== undefined && hall.phase !== 'Fighting';
    for (const m of this.zones) {
      m.color.setHex(open ? ZONE_OPEN : ZONE_SHUT);
      m.opacity = open ? 0.45 : 0.25;
    }
    this.fire?.setState(fire);
  }

  /** Flicker the Rest fire, `seconds` of wall time after the last call. */
  animate(seconds: number): void {
    this.fire?.animate(seconds);
  }

  private build(arena: ArenaGeometry, hall: SimHall | undefined): void {
    this.arena = arena;
    this.kind = hall?.kind ?? '';
    // The fire frees its own geometries and materials; the rest are freed here (the Door frames' material is shared and stays).
    if (this.fire) {
      this.root.remove(this.fire.root);
      this.fire.dispose();
      this.fire = null;
    }
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const m of this.zones) m.dispose();
    this.zones = [];
    if (!hall) return;
    arena.doors.forEach((door, i) => {
      this.root.add(this.doorFrame(door));
      // Door 0 is the entrance: no zone to stand in.
      if (i > 0) this.root.add(this.zone(door));
    });
    if (hall.kind === 'Rest') {
      this.fire = new RestFire(restFire(arena));
      this.root.add(this.fire.root);
    }
  }

  /** Two posts and a lintel along the doorway. */
  private doorFrame(door: ArenaDoor): THREE.Object3D {
    const [a, b] = doorway(door);
    const group = new THREE.Group();
    const width = Math.hypot(b.x - a.x, b.z - a.z);
    const along = Math.atan2(b.x - a.x, b.z - a.z);
    for (const p of [a, b]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(FRAME_THICKNESS, FRAME_HEIGHT, FRAME_THICKNESS), this.frame);
      post.position.set(p.x, p.y + FRAME_HEIGHT / 2, p.z);
      group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(FRAME_THICKNESS, FRAME_THICKNESS, width + FRAME_THICKNESS), this.frame);
    lintel.position.set((a.x + b.x) / 2, a.y + FRAME_HEIGHT, (a.z + b.z) / 2);
    lintel.rotation.y = along;
    group.add(lintel);
    return group;
  }

  /** The zone's polygon on its ground, as a fan. */
  private zone(door: ArenaDoor): THREE.Object3D {
    const points = door.zone;
    const positions: number[] = [];
    for (let i = 1; i + 1 < points.length; i++)
      for (const p of [points[0]!, points[i]!, points[i + 1]!]) positions.push(p.x, p.y + LIFT, p.z);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.MeshBasicMaterial({ color: ZONE_SHUT, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    this.zones.push(material);
    return new THREE.Mesh(geometry, material);
  }
}
