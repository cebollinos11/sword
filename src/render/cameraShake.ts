/**
 * The camera's jolt when the local player's Fighter Blocks a blow or has one Blocked: a short,
 * decaying shake, harder for a faster blade. Like impact effects it lives outside the Simulation
 * and only listens to its events (ADR 0001); which jolts each event makes is pure, so it is tested headlessly.
 */
import type * as THREE from 'three';
import type { SimState } from '../sim';
import { weaponByName, type TuningData } from '../tuning';

/** A Blocked dagger jolts lightly. */
const DAGGER_BLOCK_STRENGTH = 0.35;
/** Peak shake at full strength: camera roll and pitch (radians) and sideways jolt (m). */
const MAX_ROLL = 0.035;
const MAX_PITCH = 0.025;
const MAX_JOLT = 0.04;
/** The shake dies away over this long (s). */
const SHAKE_LIFE = 0.28;
/** How fast it rattles (Hz). */
const SHAKE_RATE = 26;

/**
 * How hard each of one Tick's Blocks jolts the view of `fighter` (0..1, from the Blade Speed over the
 * attacker's Weapon's reference speed), in event order. Only Blocks it took part in, as defender or attacker.
 */
export function blockJolts(duel: Pick<SimState, 'events' | 'fighters'>, tuning: TuningData, fighter: number): number[] {
  const jolts: number[] = [];
  for (const e of duel.events) {
    if (e.type === 'DaggerBlocked' && e.defender === fighter) jolts.push(DAGGER_BLOCK_STRENGTH);
    if (e.type !== 'Block' || (e.defender !== fighter && e.attacker !== fighter)) continue;
    const { speed } = weaponByName(tuning, duel.fighters[e.attacker]!.weapon);
    // The defender takes the blow full on; the attacker feels its blade bounce back.
    const felt = e.defender === fighter ? 1 : 0.7;
    // A Perfect Block always jolts at full strength.
    jolts.push(felt * (e.perfect ? 1 : Math.min(1, Math.max(0.3, e.bladeSpeed / speed))));
  }
  return jolts;
}

/**
 * Shakes the game camera. The game loop calls `onTick(tick, duel, fighter)` after each step,
 * and `apply(camera, seconds)` after placing the camera each frame. Each Tick jolts at most once
 * (so rollback re-simulation does not repeat a jolt); call `seek(tick)` when the loop jumps.
 */
export class CameraShake {
  private lastTick = -Infinity;
  /** Current shake, 0..1; decays to 0 over SHAKE_LIFE. */
  private amount = 0;
  private phase = 0;

  constructor(private readonly tuning: TuningData) {}

  onTick(tick: number, duel: Pick<SimState, 'events' | 'fighters'>, fighter: number): void {
    if (tick <= this.lastTick) return;
    this.lastTick = tick;
    for (const j of blockJolts(duel, this.tuning, fighter)) this.amount = Math.min(1, Math.max(this.amount, j));
  }

  seek(tick: number): void {
    this.lastTick = tick;
    this.amount = 0;
  }

  /** Jolt the (just placed) camera and let the shake die away by `seconds`. */
  apply(camera: THREE.Camera, seconds: number): void {
    if (this.amount <= 0) return;
    this.phase += Math.max(0, seconds) * SHAKE_RATE * Math.PI * 2;
    // Eased so the first frames hit hardest.
    const a = this.amount * this.amount;
    camera.rotateZ(Math.sin(this.phase) * MAX_ROLL * a);
    camera.rotateX(Math.sin(this.phase * 1.37 + 1) * MAX_PITCH * a);
    camera.translateX(Math.sin(this.phase * 0.83 + 2) * MAX_JOLT * a);
    this.amount = Math.max(0, this.amount - seconds / SHAKE_LIFE);
  }
}
