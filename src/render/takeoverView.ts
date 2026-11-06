/**
 * The view of a Battle's takeover (render only; the Simulation decides who and when, `stepBubbles`): while the Player lies
 * fallen, the ally Soldier they will take over is marked (`TakeoverMark`: a ring at its feet and a beam of light over it, in
 * their Team's colour, swelling as the takeover nears) and the camera drifts toward it (`fallenDrift`); on the takeover the
 * camera flies from where it was to behind the Soldier along an arc (`flightCamera`), and the screen, dimmed and greyed while
 * they were down (`deathTint`), clears as it lands.
 */
import * as THREE from 'three';
import type { Vec3 } from '../sim';

/** How long (s) the camera's flight to a taken-over Soldier takes: at least FLIGHT_SECONDS, longer the further it goes, up to FLIGHT_MAX_SECONDS. */
export const FLIGHT_SECONDS = 0.7;
const FLIGHT_PER_METRE = 0.012;
const FLIGHT_MAX_SECONDS = 1.4;
/** How high (m) the flight's arc rises at most, and per metre flown. */
const ARC_MAX = 7;
const ARC_PER_METRE = 0.3;
/** How far toward the Soldier (0 to 1) the fallen camera's aim drifts by the takeover (never more than DRIFT_MAX m), and how much further back and up it stands. */
const DRIFT_AIM = 0.45;
const DRIFT_MAX = 8;
const DRIFT_PULL = 0.6;
/** How far (0 to 1) the fallen camera's look turns from its aim to the Soldier by the takeover. */
const DRIFT_LOOK = 0.5;
/** How grey (0 to 1) and how dark (0 to 1, of the light taken away) the screen is while the Player is down. */
const GREY = 0.8;
const DARK = 0.35;

/** Smooth in and out (cubic), 0 to 1 over 0 to 1, held at the ends. */
export function easeInOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/**
 * The fallen camera's drift toward the Soldier to be taken over, `distance` m away, `progress` (0 to 1) of the way through the
 * takeover's delay: how far its aim has moved from the fallen Fighter toward the Soldier (`aim`, a share of the way, at most
 * DRIFT_AIM and DRIFT_MAX m, so a far Soldier does not leave it looking at empty field) and how much further back and up it stands
 * (`pull`, a factor from 1), and how far its look turns from the aim to the Soldier (`look`), so the Soldier comes into view. Still for the first moment (the fall plays out), then easing.
 */
export function fallenDrift(progress: number, distance: number): { aim: number; pull: number; look: number } {
  const e = easeInOut((progress - 0.25) / 0.75);
  const share = distance > 0 ? Math.min(DRIFT_AIM, DRIFT_MAX / distance) : 0;
  return { aim: share * e, pull: 1 + DRIFT_PULL * e, look: DRIFT_LOOK * e };
}

/** How long (s) the camera's flight over `distance` m takes. */
export function flightSeconds(distance: number): number {
  return Math.min(FLIGHT_MAX_SECONDS, FLIGHT_SECONDS + distance * FLIGHT_PER_METRE);
}

/**
 * The camera `elapsed` seconds into a flight (`flightSeconds` long) from (`from`, looking along `fromQuat`) to (`to`, `toQuat`): its position eased
 * along the straight line and lifted on an arc (higher the further it goes), its look turned between the two. Writes `out` and
 * returns whether the flight is over (it is then exactly at `to`).
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
