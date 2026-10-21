import * as THREE from 'three';
import { groundBelow, type SkeletonPose, type Vec3 } from '../sim';
import { surfacePlane, type ArenaGeometry } from '../tuning';

/** Radius (m) of a Fighter's shadow standing on the ground, and how dark its middle is (0 to 1). */
const RADIUS = 0.45;
const OPACITY = 0.6;
/** Height (m) of the lowest foot above the ground at which the shadow has shrunk to SMALLEST of its size and faded out. */
const FADE_HEIGHT = 2.5;
const SMALLEST = 0.55;
/** How far (m) the shadow sits above its Walk Surface, so the floor never shows through it. */
const LIFT = 0.02;

/** Where a Fighter's shadow lies: on the ground under its pelvis, tilted to that ground, smaller and fainter the higher its feet are. */
export interface BlobPlacement {
  readonly position: Vec3;
  /** The ground's up direction (unit length). */
  readonly normal: Vec3;
  readonly radius: number;
  readonly opacity: number;
}

/** A Fighter's shadow for `pose` (the drawn pose: a Ragdoll's too), or null when there is no ground under it or it is too high to cast one. */
export function blobPlacement(pose: SkeletonPose, arena: ArenaGeometry): BlobPlacement | null {
  const j = pose.joints;
  const pelvis = j.pelvis;
  const ground = groundBelow(arena, pelvis.x, pelvis.z, pelvis.y);
  if (!ground) return null;
  const lowest = Math.min(j.leftToe.y, j.rightToe.y, j.leftAnkle.y, j.rightAnkle.y, pelvis.y);
  const k = 1 - Math.min(1, Math.max(0, lowest - ground.y) / FADE_HEIGHT);
  if (k <= 0) return null;
  const { a, c } = surfacePlane(arena.walk[ground.surface]!);
  const n = Math.hypot(a, 1, c);
  const normal = { x: -a / n, y: 1 / n, z: -c / n };
  return {
    position: { x: pelvis.x + normal.x * LIFT, y: ground.y + normal.y * LIFT, z: pelvis.z + normal.z * LIFT },
    normal,
    radius: RADIUS * (SMALLEST + (1 - SMALLEST) * k),
    opacity: OPACITY * k,
  };
}

/** A soft dark disc: black, opaque in the middle, fading to clear at the rim. */
function blobTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const UP = new THREE.Vector3(0, 1, 0);
const normal = new THREE.Vector3();

/**
 * Blob shadows: a soft dark disc on the ground under each Fighter, which shrinks and fades as it
 * rises, so a body reads as standing on the floor and a Jump shows where it will come down. Render-only.
 */
export class BlobShadows {
  readonly root = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private texture: THREE.Texture | undefined;
  private readonly blobs: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];

  /** Lay a shadow under each of `poses` (by Fighter) on `arena`; the rest are hidden. */
  update(poses: readonly SkeletonPose[], arena: ArenaGeometry): void {
    poses.forEach((pose, i) => {
      const blob = this.blobs[i] ?? this.add();
      const at = blobPlacement(pose, arena);
      blob.visible = at !== null;
      if (!at) return;
      blob.position.set(at.position.x, at.position.y, at.position.z);
      blob.quaternion.setFromUnitVectors(UP, normal.set(at.normal.x, at.normal.y, at.normal.z));
      blob.scale.setScalar(at.radius * 2);
      blob.material.opacity = at.opacity;
    });
    for (let i = poses.length; i < this.blobs.length; i++) this.blobs[i]!.visible = false;
  }

  private add(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    this.texture ??= blobTexture();
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: 0x000000,
      transparent: true,
      depthWrite: false,
      // Drawn just in front of the floor it lies on, so it never flickers into it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    // After the opaque Arena and Fighters, before the other see-through effects.
    mesh.renderOrder = 1;
    this.blobs.push(mesh);
    this.root.add(mesh);
    return mesh;
  }
}
