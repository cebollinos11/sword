/**
 * The view of a Battle's takeover (render only; the Simulation decides who and when, `stepBubbles`). The Player falls and, for
 * `takeover.pickSeconds`, watches from an orbit round where they fell (turned with the mouse), the screen dimmed and greyed
 * (`deathTint`). Then the Soldier they will take over (near their Team's spawn) is marked (`TakeoverMark`: a ring at its feet and
 * a pillar of light over it, in their Team's colour) and the camera flies by (`flybyCamera`) from where it was, up over the field,
 * to behind that Soldier, landing as the takeover happens, the grey clearing as it goes. Should the Soldier change at the last
 * moment, a short flight (`flightCamera`) covers the rest.
 */
import * as THREE from 'three';
import type { Vec3 } from '../sim';

/** How long (s) the short catch-up flight at the takeover takes: at least FLIGHT_SECONDS, longer the further it goes, up to FLIGHT_MAX_SECONDS. */
export const FLIGHT_SECONDS = 0.7;
const FLIGHT_PER_METRE = 0.012;
const FLIGHT_MAX_SECONDS = 1.4;
/** How high (m) the short flight's arc rises at most, and per metre flown. */
const ARC_MAX = 7;
const ARC_PER_METRE = 0.3;
/** How high (m) the flyby rises over the straight line: per metre flown, within these bounds, so the field is seen from above. */
const FLYBY_ARC_PER_METRE = 0.35;
const FLYBY_ARC_MIN = 4;
const FLYBY_ARC_MAX = 30;
/** The share of the flyby spent turning to look at the Soldier at its start, and settling behind its shoulder at its end. */
const FLYBY_TURN = 0.3;
/** How grey (0 to 1) and how dark (0 to 1, of the light taken away) the screen is while the Player is down. */
const GREY = 0.8;
const DARK = 0.35;

/** Smooth in and out (cubic), 0 to 1 over 0 to 1, held at the ends. */
export function easeInOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/** How long (s) the short catch-up flight over `distance` m takes. */
export function flightSeconds(distance: number): number {
  return Math.min(FLIGHT_MAX_SECONDS, FLIGHT_SECONDS + distance * FLIGHT_PER_METRE);
}

/**
 * The camera `elapsed` seconds into a short flight (`flightSeconds` long) from (`from`, looking along `fromQuat`) to (`to`,
 * `toQuat`): its position eased along the straight line and lifted on an arc (higher the further it goes), its look turned
 * between the two. Writes `out` and returns whether the flight is over (it is then exactly at `to`).
 */
export function flightCamera(
  from: THREE.Vector3,
  fromQuat: THREE.Quaternion,
  to: THREE.Vector3,
  toQuat: THREE.Quaternion,
  elapsed: number,
  out: { position: THREE.Vector3; quaternion: THREE.Quaternion },
): boolean {
  const t = Math.min(1, Math.max(0, elapsed / flightSeconds(from.distanceTo(to))));
  const e = easeInOut(t);
  const arc = Math.min(ARC_MAX, from.distanceTo(to) * ARC_PER_METRE) * Math.sin(Math.PI * t);
  out.position.lerpVectors(from, to, e);
  out.position.y += arc;
  out.quaternion.slerpQuaternions(fromQuat, toQuat, e);
  return t >= 1;
}

const lookMatrix = new THREE.Matrix4();
const lookQuat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The camera `t` (0 to 1) of the way through the flyby from (`from`, looking along `fromQuat`) to (`to`, `toQuat`: behind the
 * Soldier's shoulder), with `focus` the Soldier (its chest): its position eased along the straight line and lifted high on an arc
 * (higher the further it goes); its look turning first to the Soldier, holding on it across the field, then settling into `toQuat`.
 * At `t` 1 it is exactly at `to`, looking along `toQuat`. Writes `out`.
 */
export function flybyCamera(
  from: THREE.Vector3,
  fromQuat: THREE.Quaternion,
  to: THREE.Vector3,
  toQuat: THREE.Quaternion,
  focus: THREE.Vector3,
  t: number,
  out: { position: THREE.Vector3; quaternion: THREE.Quaternion },
): void {
  const u = Math.min(1, Math.max(0, t));
  const distance = from.distanceTo(to);
  const arc = Math.min(FLYBY_ARC_MAX, Math.max(FLYBY_ARC_MIN, distance * FLYBY_ARC_PER_METRE)) * Math.sin(Math.PI * u);
  out.position.lerpVectors(from, to, easeInOut(u));
  out.position.y += arc;
  // Looking at the Soldier from where the camera is (a camera looks down its -z).
  if (out.position.distanceToSquared(focus) > 1e-6) lookQuat.setFromRotationMatrix(lookMatrix.lookAt(out.position, focus, UP));
  else lookQuat.copy(toQuat);
  out.quaternion.slerpQuaternions(fromQuat, lookQuat, easeInOut(u / FLYBY_TURN));
  out.quaternion.slerp(toQuat, easeInOut((u - (1 - FLYBY_TURN)) / FLYBY_TURN));
}

/** How much the screen is tinted (0 clear, 1 fully) while the Player is down: `down` (0 to 1) as a CSS filter, '' when clear. */
export function deathTint(down: number): string {
  const d = Math.min(1, Math.max(0, down));
  if (d < 0.005) return '';
  return `grayscale(${(GREY * d).toFixed(3)}) brightness(${(1 - DARK * d).toFixed(3)})`;
}

/** Segments round the ring. */
const SEGMENTS = 48;
/** The ring's radii (m) and the beam's height and radius (m). */
const RING = { inner: 0.75, outer: 1 };
const BEAM = { height: 40, radius: 0.35 };

/** The marker over the Soldier a fallen Player will take over: a ring at its feet and a beam over it, pulsing. Hidden until `show`n. */
export class TakeoverMark {
  readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    // Clear of the fog, so a Soldier far off is still marked on the horizon.
    const ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(RING.inner, RING.outer, SEGMENTS), ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    // A tall pillar of light, so a Soldier far off shows on the horizon: open-ended, seen from inside too, additive so it glows
    // over whatever stands behind it, and fading to nothing up its height (its vertex colours run from white to black).
    const beamGeometry = new THREE.CylinderGeometry(BEAM.radius * 0.6, BEAM.radius, BEAM.height, 16, 8, true);
    beamGeometry.translate(0, BEAM.height / 2, 0);
    const heights = beamGeometry.getAttribute('position');
    const shade = new Float32Array(heights.count * 3);
    for (let i = 0; i < heights.count; i++) shade.fill((1 - heights.getY(i) / BEAM.height) ** 2, i * 3, i * 3 + 3);
    beamGeometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    const beamMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    this.beam = new THREE.Mesh(beamGeometry, beamMaterial);
    this.root.add(this.ring, this.beam);
    this.root.visible = false;
    this.root.renderOrder = 2;
  }

  /** Mark the Soldier whose feet are at `at`, in `colour` (0xRRGGBB), `progress` (0 to 1) through the takeover's delay; `time` (s) beats the pulse. */
  show(at: Vec3, colour: number, progress: number, time: number): void {
    const p = Math.min(1, Math.max(0, progress));
    const pulse = 0.5 + 0.5 * Math.sin(time * 9);
    this.root.visible = true;
    this.root.position.set(at.x, at.y, at.z);
    this.ring.material.color.setHex(colour);
    this.beam.material.color.setHex(colour);
    // Fades in, then swells and quickens toward the takeover.
    const fade = Math.min(1, p * 4);
    this.ring.material.opacity = fade * (0.55 + 0.35 * pulse);
    this.ring.scale.setScalar(1 + 0.25 * pulse * p);
    this.beam.material.opacity = fade * (0.35 + 0.4 * p) * (0.75 + 0.25 * pulse);
    this.beam.scale.set(1 + p, 1, 1 + p);
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.beam.geometry.dispose();
    this.beam.material.dispose();
  }
}
