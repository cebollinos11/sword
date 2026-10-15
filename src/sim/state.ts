import type { SimEvent } from './events';
import type { GaitState } from './gait';
import type { PoseTargets } from './motion';
import type { Direction } from './intent';
import type { RngState } from './rng';
import type { BladeTransform } from './skeleton';
import type { Vec3 } from './vec';

/** Ground-plane vector (metres). y is up and the Arena is flat, so only x/z. */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** The three phases of an Attack, in order. */
export const ATTACK_PHASES = ['Wind-up', 'Release', 'Recovery'] as const;
export type AttackPhase = (typeof ATTACK_PHASES)[number];

export interface IdleAction {
  readonly kind: 'Idle';
}

export interface AttackAction {
  readonly kind: 'Attack';
  readonly direction: Direction;
  readonly phase: AttackPhase;
  /** True once this Attack's Blade Sweep has connected; an Attack lands at most once. */
  readonly landed: boolean;
}

/** Holding a Block in one Direction for as long as block is held. Stops matching Attacks by rule (ADR 0002). */
export interface BlockAction {
  readonly kind: 'Block';
  readonly direction: Direction;
}

/** Why a Fighter Staggers: it was hit, its Attack was Blocked (the attacker recoils), or its Attack was Chambered. */
export type StaggerCause = 'Hit' | 'Blocked' | 'Chambered';

/** A short forced Action in which the Fighter cannot act; it lasts as long as the Stagger Motion. */
export interface StaggerAction {
  readonly kind: 'Stagger';
  readonly cause: StaggerCause;
}

/**
 * What a Fighter is doing right now; exactly one at a time. A tagged union of
 * plain data: add a member here and a handler in `actions/index.ts`.
 */
export type Action = IdleAction | AttackAction | BlockAction | StaggerAction;
export type ActionKind = Action['kind'];

export interface FighterState {
  /** Position on the Arena floor, centre of the Arena is the origin. */
  readonly position: Vec2;
  /** Yaw in radians; 0 faces +z. */
  readonly facing: number;
  /** Its team (0 or 1), fixed for the Match. Teammates' blades Stagger but never wound each other. */
  readonly team: number;
  readonly hp: number;
  /** The name of the Weapon it wields (Tuning Data `weapons`), chosen when the Match is created and kept across Duels. */
  readonly weapon: string;
  readonly action: Action;
  /** The Motion animating the current Action and its playhead. */
  readonly motion: MotionPlayback;
  /** The blade this Tick, solved from the Motion by IK. Last Tick's blade bounds the Blade Sweep. */
  readonly blade: BladeTransform;
  /** The feet: each one's planted world position and any step in progress (the Gait, ADR 0003). */
  readonly gait: GaitState;
  /** Present while a Blocked blow is still shaking the sword hand (Block Impact); absent once it has settled. */
  readonly blockImpact?: BlockImpact;
  /** Present once the Fighter has fallen (its HP reached zero). It is no longer simulated, hits and is hit by nothing, and no longer blocks bodies: its state stays as it was on that Tick. */
  readonly death?: Death;
}

/**
 * How a Fighter fell. The Simulation only records it; the Death Ragdoll is
 * drawn from it outside the Tick, so it never changes an outcome.
 */
export interface Death {
  /** The Duel Tick on which it fell. */
  readonly tick: number;
  /** The Hit that felled it, or null if none is known. */
  readonly blow: DeathBlow | null;
}

export interface DeathBlow {
  /** World-space contact point. */
  readonly point: Vec3;
  /** Blade Speed at contact, m/s. */
  readonly bladeSpeed: number;
  readonly direction: Direction;
  /** Where the attacker stood on that Tick (the blow drives the body away from it). */
  readonly from: Vec2;
}

/**
 * The give and bounce of a Blocked blow on the defender: the sword hand is
 * knocked back along the Attack and springs back, settling over
 * `block.impactDuration` (Tuning Data). Cosmetic in outcome (ADR 0002), but
 * part of the simulation, so the pose it moves is the pose the Hit Zones use.
 */
export interface BlockImpact {
  /** The Direction of the Block that stopped the blow (which way the hand is knocked). */
  readonly direction: Direction;
  /**
   * How hard the blow was: its Blade Speed over the attacker's Weapon's reference speed, clamped,
   * times the attacker's Weapon's `blockImpact.dealt` and the defender's `blockImpact.taken`.
   */
  readonly strength: number;
  /** Ticks since the blow. */
  readonly tick: number;
}

export interface MotionPlayback {
  /** A Motion name from Tuning Data. */
  readonly name: string;
  /**
   * Playhead in Ticks from the start of the Motion. It advances one per Tick
   * except while an Action holds it (e.g. a held Wind-up stays on its last pose).
   */
  readonly tick: number;
  /**
   * Present while this Motion is crossfading in from the pose the previous one
   * left (Motion Blend, `fighter.motionBlend`): `from` is that pose, `tick`
   * how far into the blend. Absent once the blend is over.
   */
  readonly blend?: MotionBlend;
}

/** A crossfade from a frozen pose into the current Motion. */
export interface MotionBlend {
  readonly from: PoseTargets;
  readonly tick: number;
}

/** Whether the Duel is still being fought. `winner` is a team (0 or 1), or null for a draw (the last of both teams fell on the same Tick). */
export type DuelState =
  | { readonly status: 'Fighting' }
  | { readonly status: 'Over'; readonly winner: number | null; readonly tick: number };

/**
 * The complete Simulation state. Plain, JSON-like data only: everything that
 * influences the next Tick lives here so snapshot/restore and hashing are exact.
 */
export interface SimState {
  readonly tick: number;
  readonly rng: RngState;
  readonly fighters: readonly FighterState[];
  readonly duel: DuelState;
  /** What happened during the Tick that produced this state (for audio, effects, overlays, tests). */
  readonly events: readonly SimEvent[];
}
