import type * as THREE from 'three';
import type { Vec2 } from '../sim';
import type { CameraTuning } from '../tuning';

/**
 * Third-person camera: over the right shoulder of the Fighter at `position`,
 * looking along `yaw` (the player's aim, 0 = +z). It follows the aim, not the
 * Fighter's facing, so the view answers the mouse at once while the Fighter
 * turns at its own speed. `setup` (Tuning Data `camera`) says where it sits.
 */
export function placeThirdPersonCamera(camera: THREE.PerspectiveCamera, setup: CameraTuning, position: Vec2, yaw: number): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Right of the aim: (-cos, sin).
  const rx = -fz;
  const rz = fx;
  const { back, shoulder, eyeHeight, ahead, lookHeight } = setup;
  camera.position.set(position.x - fx * back + rx * shoulder, eyeHeight, position.z - fz * back + rz * shoulder);
  camera.lookAt(position.x + fx * ahead + rx * shoulder * 0.5, lookHeight, position.z + fz * ahead + rz * shoulder * 0.5);
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
