import * as THREE from 'three';
import type { FighterState, Vec3 } from '../sim';
import type { CameraTarget } from './thirdPersonCamera';

/** The key that toggles the first-person view (keyboard only: touch play has no button for it). */
export const FIRST_PERSON_KEY = 'KeyP';
/** Where the choice is remembered between visits. */
const STORAGE_KEY = 'sword.firstPerson';
/** Seconds to swing between the first- and third-person cameras. */
export const FIRST_PERSON_BLEND_SECONDS = 0.3;
/** The eye sits this far (m) ahead of the head's centre, along the look, at the standard Size. */
const EYE_AHEAD = 0.07;
/**
 * Seconds for the eye to settle on where the head is over the feet: steadies the bob of each step and the jolt of a swing, while
 * crouching or leaning still moves the view, eased. Where the feet go (walking, jumping) the eye follows at once.
 */
export const HEAD_STEADY_SECONDS = 0.25;
/** The first-person camera's zoom: under 1 widens the view (about 72° high where the third-person camera is 60°). */
export const FIRST_PERSON_ZOOM = 0.8;

/**
 * Whether Fighter `f` is doing something that would throw a camera in its head about (a Whirlwind, a Knockdown, the stagger of a
 * hard Landing, a Death): the first-person view steps back to third person until it is over.
 */
export function firstPersonBlocked(f: FighterState | undefined): boolean {
  if (!f || f.death || f.benched) return true;
  const a = f.action;
  if (a.kind === 'Whirlwind' || a.kind === 'Knockdown') return true;
  return a.kind === 'Stagger' && a.cause === 'Landed';
}

const look = new THREE.Vector3();
const thirdPosition = new THREE.Vector3();
const thirdQuaternion = new THREE.Quaternion();

/**
 * First-person camera: at the eye (`head`, the drawn head joint's centre), looking along `yaw` (0 = +z) tilted by `pitch`
 * (radians, + looks up), the same aim the third-person camera follows.
 */
export function placeFirstPersonCamera(camera: THREE.PerspectiveCamera, head: Vec3, yaw: number, pitch: number, height = 1): void {
  const c = Math.cos(pitch);
  look.set(Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c);
  camera.position.set(head.x + look.x * EYE_AHEAD * height, head.y + look.y * EYE_AHEAD * height, head.z + look.z * EYE_AHEAD * height);
  camera.lookAt(camera.position.x + look.x, camera.position.y + look.y, camera.position.z + look.z);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The Player's choice of first-person view (toggled with `FIRST_PERSON_KEY`, remembered between visits), and how far the camera is
 * toward it: it swings over in `FIRST_PERSON_BLEND_SECONDS` whenever the choice changes or the Fighter is `firstPersonBlocked`.
 * Render-only: nothing here reaches the Simulation.
 */
export class FirstPersonView {
  /** The Player wants the first-person view. */
  enabled: boolean;
  /** 0: third person, 1: first person, between: on the way. */
  private t = 0;
  /** The steadied head, as an offset from the feet (null: none yet, so it starts where the head is). */
  private offset: { x: number; y: number; z: number } | null = null;
  /** Seconds since the last `update`, for steadying the head. */
  private since = 0;

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    this.enabled = read(storage) === '1';
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      this.storage?.setItem(STORAGE_KEY, this.enabled ? '1' : '0');
    } catch {
      /* storage off: the choice lasts this visit */
    }
  }

  /** How far toward first person the camera is (0 to 1), eased. */
  get blend(): number {
    return smooth(this.t);
  }

  /** Whether the Player's own body should be hidden: once the camera is most of the way into its head. */
  get hidesBody(): boolean {
    return this.t > 0.5;
  }

  /** Move toward first person (if wanted and not `blocked`) or back out, `seconds` on. */
  update(seconds: number, blocked: boolean): void {
    const goal = this.enabled && !blocked ? 1 : 0;
    const step = seconds / FIRST_PERSON_BLEND_SECONDS;
    this.t = goal > this.t ? Math.min(goal, this.t + step) : Math.max(goal, this.t - step);
    this.since = seconds;
  }

  /** Straight to third person, with no swing (a new Match, a cut to another camera). */
  reset(): void {
    this.t = 0;
    this.offset = null;
  }

  /**
   * With the third-person camera already placed on `camera`: move it the blend's share of the way to the first-person camera at
   * `head` (its centre as drawn), steadied over `feet` (`HEAD_STEADY_SECONDS`), and widen the view the same share toward
   * `FIRST_PERSON_ZOOM`. No `head`: it stays as it is, at the third-person zoom.
   */
  apply(camera: THREE.PerspectiveCamera, head: Vec3 | null, feet: CameraTarget, yaw: number, pitch: number, height = 1): void {
    const b = head ? this.blend : 0;
    const zoom = 1 + (FIRST_PERSON_ZOOM - 1) * b;
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    if (b <= 0 || !head) {
      this.offset = null;
      return;
    }
    const fy = feet.y ?? 0;
    const k = this.offset ? 1 - Math.exp(-this.since / HEAD_STEADY_SECONDS) : 1;
    const o = (this.offset ??= { x: 0, y: 0, z: 0 });
    o.x += (head.x - feet.x - o.x) * k;
    o.y += (head.y - fy - o.y) * k;
    o.z += (head.z - feet.z - o.z) * k;
    this.since = 0;
    thirdPosition.copy(camera.position);
    thirdQuaternion.copy(camera.quaternion);
    placeFirstPersonCamera(camera, { x: feet.x + o.x, y: fy + o.y, z: feet.z + o.z }, yaw, pitch, height);
    if (b >= 1) return;
    camera.position.lerpVectors(thirdPosition, camera.position, b);
    camera.quaternion.slerpQuaternions(thirdQuaternion, camera.quaternion, b);
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
