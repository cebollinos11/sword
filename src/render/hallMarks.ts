import * as THREE from 'three';
import { REST_FIRE_RADIUS, restFire, type SimHall } from '../sim';
import type { ArenaDoor, ArenaGeometry } from '../tuning';
import { doorway } from './doorway';

/** A doorway frame's height (m), and its posts' and lintel's thickness. */
const FRAME_HEIGHT = 2.4;
const FRAME_THICKNESS = 0.18;
const FRAME_COLOR = 0x7d7d84;
/** An exit Door's zone on the ground: shut while the Hall is fought, lit once it is Cleared. */
const ZONE_SHUT = 0x60646c;
const ZONE_OPEN = 0xffd56a;
const FIRE_COLOR = 0xff7a2a;
/** Drawn this far (m) over the ground, so the marks never flicker into it. */
const LIFT = 0.03;

/**
 * Placeholder marks for a Run's Hall (docs/plans/dungeon.md, Stage 1; Stage 3 brings the art): a plain greybox frame
 * in each Door's doorway, each exit Door's zone as a flat patch (grey while the Hall is fought, gold once it is Cleared),
 * and a Rest Hall's fire zone as a glowing disc. Render only; rebuilt when the Arena drawn changes, recoloured as the
 * Hall's phase does. Nothing outside a Run's Hall.
 */
export class HallMarks {
  readonly root = new THREE.Group();
  private arena: ArenaGeometry | null = null;
  private kind = '';
  private zones: THREE.MeshBasicMaterial[] = [];
  private readonly frame = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.9 });

  update(arena: ArenaGeometry, hall: SimHall | undefined): void {
    const kind = hall?.kind ?? '';
    if (arena !== this.arena || kind !== this.kind) this.build(arena, hall);
    const open = hall !== undefined && hall.phase !== 'Fighting';
    for (const m of this.zones) {
      m.color.setHex(open ? ZONE_OPEN : ZONE_SHUT);
      m.opacity = open ? 0.45 : 0.25;
    }
  }

  private build(arena: ArenaGeometry, hall: SimHall | undefined): void {
    this.arena = arena;
    this.kind = hall?.kind ?? '';
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
    if (hall.kind === 'Rest') this.root.add(fireDisc(arena));
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

/** A Rest Hall's fire zone: a glowing disc of REST_FIRE_RADIUS, with a small flame in the middle. */
function fireDisc(arena: ArenaGeometry): THREE.Object3D {
  const at = restFire(arena);
  const group = new THREE.Group();
  group.position.set(at.x, at.y + LIFT, at.z);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(REST_FIRE_RADIUS, 32),
    new THREE.MeshBasicMaterial({ color: FIRE_COLOR, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), new THREE.MeshBasicMaterial({ color: FIRE_COLOR }));
  flame.position.y = 0.35;
  group.add(disc, flame);
  return group;
}
