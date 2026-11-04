import * as THREE from 'three';
import type { Vec2 } from '../sim';
import type { CameraTuning } from '../tuning';
import type { CameraCollider } from './cameraCollider';

/** Where the camera follows: a point on the ground plane, and the height of the feet there (default 0). */
export type CameraTarget = Vec2 & { readonly y?: number };

const pivot = new THREE.Vector3();
const eyeAt = new THREE.Vector3();

/** The lowest the third-person camera may sink (m above the feet) when looking up. */
const MIN_CAMERA_HEIGHT = 0.3;
/** The Final Blow Shot looks at this height (m) above the fallen Fighter's feet: between standing and lying. */
const SHOT_LOOK_HEIGHT = 0.8;

/**
 * Third-person camera: over the right shoulder of the Fighter at `position`,
 * looking along `yaw` (the player's aim, 0 = +z) and tilted by `pitch`
 * (radians, + looks up). It follows the aim, not the Fighter's facing, so the
 * view answers the mouse at once while the Fighter turns at its own speed.
 * `setup` (Tuning Data `camera`) says where it sits when level; pitch swings it
 * around a point over the shoulder at `lookHeight`, under the look when looking up.
 * Everything is measured from the Fighter's feet (`position.y`), and a `collider`
 * pulls the camera in where the Arena stands between it and the shoulder.
 */
export function placeThirdPersonCamera(
  camera: THREE.PerspectiveCamera,
  setup: CameraTuning,
  position: CameraTarget,
  yaw: number,
  pitch = 0,
  collider?: CameraCollider,
): void {
  const y = position.y ?? 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Right of the aim: (-cos, sin).
  const rx = -fz;
  const rz = fx;
  const { back, shoulder, eyeHeight, ahead, lookHeight } = setup;
  // Tilt (forward, up) offsets from the pivot by the pitch.
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  const tilt = (forward: number, up: number) => ({ forward: forward * c - up * s, up: forward * s + up * c });
  const eye = tilt(-back, eyeHeight - lookHeight);
  const look = tilt(ahead, 0);
  eyeAt.set(position.x + fx * eye.forward + rx * shoulder, y + Math.max(MIN_CAMERA_HEIGHT, lookHeight + eye.up), position.z + fz * eye.forward + rz * shoulder);
  if (collider) collider.pull(pivot.set(position.x + rx * shoulder * 0.5, y + lookHeight, position.z + rz * shoulder * 0.5), eyeAt);
  camera.position.copy(eyeAt);
  camera.lookAt(position.x + fx * look.forward + rx * shoulder * 0.5, y + lookHeight + look.up, position.z + fz * look.forward + rz * shoulder * 0.5);
}

/** The follow camera for a Fighter `height` times as tall as standard: it sits, looks and stands off in proportion, so a giant is not crowded and a midget not lost. */
export function cameraForHeight(setup: CameraTuning, height: number): CameraTuning {
  if (height === 1) return setup;
  const { back, shoulder, eyeHeight, ahead, lookHeight } = setup;
  return { ...setup, back: back * height, shoulder: shoulder * height, eyeHeight: eyeHeight * height, ahead: ahead * height, lookHeight: lookHeight * height };
}

/**
 * Final Blow Shot camera: `distance` back from `centre` and `height` above its floor,
 * looking along `yaw` at the fallen Fighter's middle, close and low enough to see the blow land.
 */
export function placeShotCamera(
  camera: THREE.PerspectiveCamera,
  centre: CameraTarget,
  yaw: number,
  distance: number,
  height: number,
  collider?: CameraCollider,
): void {
  const y = centre.y ?? 0;
  eyeAt.set(centre.x - Math.sin(yaw) * distance, y + height, centre.z - Math.cos(yaw) * distance);
  if (collider) collider.pull(pivot.set(centre.x, y + SHOT_LOOK_HEIGHT, centre.z), eyeAt);
  camera.position.copy(eyeAt);
  camera.lookAt(centre.x, y + SHOT_LOOK_HEIGHT, centre.z);
}

/**
 * Orbit camera, for a player whose Fighter has fallen while the Duel goes on:
 * high and back from `target` (e.g. the living Fighters' centre), looking
 * along `yaw`, so the mouse swings it around the fight.
 */
export function placeOrbitCamera(camera: THREE.PerspectiveCamera, setup: CameraTuning, target: CameraTarget, yaw: number, collider?: CameraCollider): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const y = target.y ?? 0;
  eyeAt.set(target.x - fx * setup.orbitDistance, y + setup.orbitHeight, target.z - fz * setup.orbitDistance);
  if (collider) collider.pull(pivot.set(target.x, y + setup.lookHeight, target.z), eyeAt);
  camera.position.copy(eyeAt);
  camera.lookAt(target.x, y + setup.lookHeight * 0.5, target.z);
}
