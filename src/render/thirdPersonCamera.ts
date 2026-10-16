import type * as THREE from 'three';
import type { Vec2 } from '../sim';
import type { CameraTuning } from '../tuning';

/** The lowest the third-person camera may sink (m above the floor) when looking up. */
const MIN_CAMERA_HEIGHT = 0.3;

/**
 * Third-person camera: over the right shoulder of the Fighter at `position`,
 * looking along `yaw` (the player's aim, 0 = +z) and tilted by `pitch`
 * (radians, + looks up). It follows the aim, not the Fighter's facing, so the
 * view answers the mouse at once while the Fighter turns at its own speed.
 * `setup` (Tuning Data `camera`) says where it sits when level; pitch swings it
 * around a point over the shoulder at `lookHeight`, under the look when looking up.
 */
export function placeThirdPersonCamera(camera: THREE.PerspectiveCamera, setup: CameraTuning, position: Vec2, yaw: number, pitch = 0): void {
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
  camera.position.set(position.x + fx * eye.forward + rx * shoulder, Math.max(MIN_CAMERA_HEIGHT, lookHeight + eye.up), position.z + fz * eye.forward + rz * shoulder);
  camera.lookAt(position.x + fx * look.forward + rx * shoulder * 0.5, lookHeight + look.up, position.z + fz * look.forward + rz * shoulder * 0.5);
}

/**
 * Orbit camera, for a player whose Fighter has fallen while the Duel goes on:
 * high and back from `target` (e.g. the living Fighters' centre), looking
 * along `yaw`, so the mouse swings it around the fight.
 */
export function placeOrbitCamera(camera: THREE.PerspectiveCamera, setup: CameraTuning, target: Vec2, yaw: number): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  camera.position.set(target.x - fx * setup.orbitDistance, setup.orbitHeight, target.z - fz * setup.orbitDistance);
  camera.lookAt(target.x, setup.lookHeight * 0.5, target.z);
}
