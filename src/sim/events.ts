import type { HitZone } from '../tuning';
import type { Direction } from './intent';
import type { AttackPhase } from './state';
import type { Vec3 } from './vec';

/** A Fighter's Attack entered a phase (Wind-up on press, Release = the swing sound, Recovery). */
export interface AttackPhaseEvent {
  readonly type: 'AttackPhase';
  readonly fighter: number;
  readonly direction: Direction;
  readonly phase: AttackPhase;
}

/** A Blade Sweep connected with a Hit Zone and dealt damage. */
export interface HitEvent {
  readonly type: 'Hit';
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Direction;
  readonly zone: HitZone;
  /** World-space contact point. */
  readonly point: Vec3;
  /** Blade Speed at the contact point, m/s (world space, so footwork counts). */
  readonly bladeSpeed: number;
  readonly damage: number;
}

/** The Duel ended this Tick. `winner` is a Fighter index, or null for a draw. */
export interface DuelEndEvent {
  readonly type: 'DuelEnd';
  readonly winner: number | null;
}

/**
 * Everything observable that happened during one Tick, in order. Add new
 * members (Block, Stagger, ...) to this union; consumers switch on `type`.
 */
export type SimEvent = AttackPhaseEvent | HitEvent | DuelEndEvent;

/** Collects the events of one Tick. */
export type Emit = (event: SimEvent) => void;
