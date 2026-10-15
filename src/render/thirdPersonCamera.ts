import type * as THREE from 'three';
import type { Vec2 } from '../sim';

/** Metres behind the Fighter, to its right (over the shoulder), and above the floor. */
const BACK = 3.2;
const SHOULDER = 0.75;
const EYE_HEIGHT = 2.1;
/** The point looked at: this far ahead of the Fighter, at this height. */
const AHEAD = 2.5;
const LOOK_HEIGHT = 1.2;

/**
 * Third-person camera: over the right shoulder of the Fighter at `position`,
 * looking along `yaw` (the player's aim, 0 = +z). It follows the aim, not the
 * Fighter's facing, so the view answers the mouse at once while the Fighter
 * turns at its own speed.
 */
export function placeThirdPersonCamera(camera: THREE.PerspectiveCamera, position: Vec2, yaw: number): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Right of the aim: (-cos, sin).
  const rx = -fz;
  const rz = fx;
  camera.position.set(position.x - fx * BACK + rx * SHOULDER, EYE_HEIGHT, position.z - fz * BACK + rz * SHOULDER);
  camera.lookAt(position.x + fx * AHEAD + rx * SHOULDER * 0.5, LOOK_HEIGHT, position.z + fz * AHEAD + rz * SHOULDER * 0.5);
}

/** The orbit camera's distance from what it looks at, and its height. */
const ORBIT_DISTANCE = 7;
const ORBIT_HEIGHT = 5;

/**
 * Orbit camera, for a player whose Fighter has fallen while the Duel goes on:
 * high and back from `target` (e.g. the living Fighters' centre), looking
 * along `yaw`, so the mouse swings it around the fight.
 */
export function placeOrbitCamera(camera: THREE.PerspectiveCamera, target: Vec2, yaw: number): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  camera.position.set(target.x - fx * ORBIT_DISTANCE, ORBIT_HEIGHT, target.z - fz * ORBIT_DISTANCE);
  camera.lookAt(target.x, LOOK_HEIGHT * 0.5, target.z);
}
