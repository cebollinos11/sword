import type { HitZone } from '../tuning';
import type { Direction } from './intent';
import type { AttackPhase, StaggerCause } from './state';
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

/** An Attack's Blade Sweep reached a defender who Blocked it by rule: no damage, the attacker Staggers. */
export interface BlockEvent {
  readonly type: 'Block';
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Direction;
}

/** A Fighter's Action was interrupted by a Stagger (hit, or its Attack was Blocked). */
export interface StaggerEvent {
  readonly type: 'Stagger';
  readonly fighter: number;
  readonly cause: StaggerCause;
}

/**
 * A Fighter cancelled its Attack's Wind-up (a Feint) into another Action:
 * a fresh Attack in a different Direction, or a Block. The new Action's own
 * events (e.g. the new Wind-up's AttackPhase) follow in the same Tick.
 */
export interface FeintEvent {
  readonly type: 'Feint';
  readonly fighter: number;
  /** Direction of the cancelled Attack. */
  readonly from: Direction;
  readonly into: { readonly kind: 'Attack' | 'Block'; readonly direction: Direction };
}

/** The Duel ended this Tick. `winner` is a Fighter index, or null for a draw. */
export interface DuelEndEvent {
  readonly type: 'DuelEnd';
  readonly winner: number | null;
}

/**
 * Everything observable that happened during one Tick, in order. Add new
 * members to this union; consumers switch on `type`.
 */
export type SimEvent = AttackPhaseEvent | HitEvent | BlockEvent | StaggerEvent | FeintEvent | DuelEndEvent;

/** Collects the events of one Tick. */
export type Emit = (event: SimEvent) => void;
