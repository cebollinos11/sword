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

/** A Blade Sweep connected with a Hit Zone and dealt damage (none to a teammate). */
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
  /** Whether the Weapon's Head landed (full damage); false for a Hit from the shaft behind it (× `shaftDamage`). */
  readonly head: boolean;
  readonly damage: number;
}

/** A Kick's leg sweep connected: a Knockdown (the victim moved) or a Shove (it gave no movement input, or was already down). Teammates take no damage. */
export interface KickLandedEvent {
  readonly type: 'KickLanded';
  readonly attacker: number;
  readonly defender: number;
  readonly outcome: 'Shove' | 'Knockdown';
  readonly zone: HitZone;
  /** World-space contact point. */
  readonly point: Vec3;
  readonly damage: number;
}

/** A Throw entered Release: the dagger left the thrower's hand and its count dropped by one. */
export interface DaggerThrownEvent {
  readonly type: 'DaggerThrown';
  readonly thrower: number;
}

/** An Attack's Blade Sweep reached a defender who Blocked it by rule: no damage, the attacker Staggers. */
export interface BlockEvent {
  readonly type: 'Block';
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Direction;
  /** World-space point where the Blade Sweep met the defender's blade (or body). */
  readonly point: Vec3;
  /** Blade Speed at the contact point, m/s. */
  readonly bladeSpeed: number;
}

/**
 * `chamberer` countered `attacker`'s Attack (in `direction`) by attacking into it, in the
 * mirrored Direction, inside the Chamber window: the incoming Attack is cancelled (`attacker` Staggers, cause Chambered)
 * and the chamberer's own Attack continues.
 */
export interface ChamberEvent {
  readonly type: 'Chamber';
  readonly chamberer: number;
  readonly attacker: number;
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

/** A Fighter's foot landed at the end of a step (the Gait). */
export interface StepEvent {
  readonly type: 'Step';
  readonly fighter: number;
  readonly foot: 'left' | 'right';
  /** World ground position where the foot landed. */
  readonly position: { readonly x: number; readonly z: number };
}

/** A Fighter jumped (it leaves the ground this Tick). */
export interface JumpEvent {
  readonly type: 'Jump';
  readonly fighter: number;
}

/**
 * A Fighter landed: `height` is how far (m) it dropped from the top of its arc. A drop
 * beyond `fall.safeHeight` deals `damage` and Staggers it (cause `Landed`).
 */
export interface LandEvent {
  readonly type: 'Land';
  readonly fighter: number;
  readonly height: number;
  readonly damage: number;
}

/** The Duel ended this Tick. `winner` is a team (0 or 1), or null for a draw. */
export interface DuelEndEvent {
  readonly type: 'DuelEnd';
  readonly winner: number | null;
}

/**
 * Everything observable that happened during one Tick, in order. Add new
 * members to this union; consumers switch on `type`.
 */
export type SimEvent = AttackPhaseEvent | HitEvent | KickLandedEvent | DaggerThrownEvent | BlockEvent | ChamberEvent | StaggerEvent | FeintEvent | StepEvent | JumpEvent | LandEvent | DuelEndEvent;

/** Collects the events of one Tick. */
export type Emit = (event: SimEvent) => void;
