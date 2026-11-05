/**
 * The Objectives drawn in a Battle's world (docs/plans/battle-objectives.md, Stage 2b): on the ground, a ring in the Owner's colour
 * round each Objective's circle with a capture ring inside it that fills toward the Team that is winning it, and over it a pole with a
 * flag and its letter. Render only: it reads `CrowdState.objectives` each frame, and the map's static Objectives once.
 *
 * The rings follow the ground (`battlefieldHeight` at every vertex), so they sit on a hill's slope rather than float over or sink in it.
 */
import * as THREE from 'three';
import { battlefieldHeight, type Heightfield, type MapObjective, type ObjectiveState } from '../sim';

/** Nobody's colour. */
const NEUTRAL = 0xd8d2c4;
/** Segments round a ring, and how far (m) its strip sits over the ground. */
const SEGMENTS = 72;
const LIFT = 0.18;
/** The outer ring's width (m), the capture ring's width and how far in from the edge it runs. */
const RIM = 0.5;
const CAPTURE = 0.9;
const INSET = 1.4;
/** The pole's height (m), the flag's size and the letter's sprite size. */
const POLE = 7;
const FLAG = { width: 2.6, height: 1.5 };
const LETTER = 3.4;

/** The label an Objective shows: its id, bar a Home Objective's number (H0 and H1 both read H). */
export const objectiveLetter = (site: Pick<MapObjective, 'id'>): string => (/^H\d+$/.test(site.id) ? 'H' : site.id);

/** A flat strip round (x, z) between two radii, over the ground (heights absolute, positions about the centre). Its triangles run in angle order, so a draw range cuts it as an arc. */
function ringGeometry(hf: Heightfield, x: number, z: number, inner: number, outer: number, level?: number): THREE.BufferGeometry {
  const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const index: number[] = [];
  for (let s = 0; s <= SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    for (const [k, r] of [inner, outer].entries()) {
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      positions.set([px - x, (level ?? battlefieldHeight(hf, px, pz)) + LIFT, pz - z], (s * 2 + k) * 3);
    }
    if (s < SEGMENTS) {
      const i = s * 2;
      index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/** The letter on a transparent canvas, light with a dark edge (none where there is no DOM to draw it on: a test). */
function letterTexture(letter: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 96px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(letter, 64, 70);
  ctx.fillStyle = '#fff';
  ctx.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** One Objective's parts. */
interface Mark {
  readonly root: THREE.Group;
  readonly rim: THREE.Mesh;
  readonly capture: THREE.Mesh;
  readonly flag: THREE.Mesh;
  /** The Owner and capture direction last drawn: a redraw is skipped while they stand. */
  owner: number;
  lean: number;
  arc: number;
}

export class ObjectiveMarks {
  readonly root = new THREE.Group();
  private readonly marks: Mark[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  /** `colours`: the two Teams' colours (hex), Team 0's first. */
  constructor(
    sites: readonly MapObjective[],
    hf: Heightfield,
    private readonly colours: readonly number[],
  ) {
    const poleGeometry = new THREE.CylinderGeometry(0.07, 0.1, POLE, 6);
    const flagGeometry = new THREE.PlaneGeometry(FLAG.width, FLAG.height);
    flagGeometry.translate(FLAG.width / 2, 0, 0);
    const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x6a645c });
    this.disposables.push(poleGeometry, flagGeometry, poleMaterial);
    for (const site of sites) {
      const root = new THREE.Group();
      root.name = `objective ${site.id}`;
      // An Objective on a named level (`y`: a hall under a roof) is drawn flat on it, not on the highest ground over it.
      root.position.set(site.x, site.y ?? battlefieldHeight(hf, site.x, site.z), site.z);
      const ring = (inner: number, outer: number, opacity: number): THREE.Mesh => {
        const geometry = ringGeometry(hf, site.x, site.z, inner, outer, site.y);
        // Rebased on the ground at the centre, so the mesh sits at the Objective's own height and the ring's vertices follow the slope.
        geometry.translate(0, -root.position.y, 0);
        const material = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
        this.disposables.push(geometry, material);
        return new THREE.Mesh(geometry, material);
      };
      const rim = ring(site.radius - RIM, site.radius, 0.85);
      const capture = ring(site.radius - INSET - CAPTURE, site.radius - INSET, 0.7);
      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.y = POLE / 2;
      const flagMaterial = new THREE.MeshBasicMaterial({ color: NEUTRAL, side: THREE.DoubleSide });
      this.disposables.push(flagMaterial);
      const flag = new THREE.Mesh(flagGeometry, flagMaterial);
      flag.position.set(0.07, POLE - FLAG.height / 2 - 0.2, 0);
      const texture = letterTexture(objectiveLetter(site));
      const letterMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false });
      this.disposables.push(letterMaterial);
      if (texture) this.disposables.push(texture);
      const letter = new THREE.Sprite(letterMaterial);
      letter.scale.set(LETTER, LETTER, 1);
      letter.position.y = POLE + LETTER * 0.55;
      root.add(rim, capture, pole, flag, letter);
      this.root.add(root);
      this.marks.push({ root, rim, capture, flag, owner: -2, lean: -2, arc: -1 });
    }
  }

  /** The colour of Team `team`, or the neutral grey for none. */
  private colourOf(team: number): number {
    return team >= 0 ? this.colours[team]! : NEUTRAL;
  }

  /** Draw each Objective as `state` has it: the rim and flag in the Owner's colour, the capture ring an arc of the leading Team's. */
  update(state: ObjectiveState): void {
    this.marks.forEach((mark, k) => {
      const owner = state.owner[k] ?? -1;
      const progress = state.progress[k] ?? 0;
      const lean = progress > 0 ? 0 : progress < 0 ? 1 : -1;
      // The capture ring shows how far from neutral the progress is; an Owner's is full, and only drops when the other side presses.
      const arc = Math.round(Math.min(1, Math.abs(progress)) * SEGMENTS);
      if (mark.owner !== owner) {
        (mark.rim.material as THREE.MeshBasicMaterial).color.setHex(this.colourOf(owner));
        (mark.flag.material as THREE.MeshBasicMaterial).color.setHex(this.colourOf(owner));
        mark.owner = owner;
      }
      if (mark.lean !== lean) {
        (mark.capture.material as THREE.MeshBasicMaterial).color.setHex(this.colourOf(lean));
        mark.lean = lean;
      }
      if (mark.arc !== arc) {
        mark.capture.geometry.setDrawRange(0, arc * 6);
        mark.arc = arc;
      }
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
