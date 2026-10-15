import type { SimEvent } from './events';
import type { GaitState } from './gait';
import type { PoseTargets } from './motion';
import type { Direction } from './intent';
import type { RngState } from './rng';
import type { BladeTransform } from './skeleton';

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
  readonly hp: number;
  readonly action: Action;
  /** The Motion animating the current Action and its playhead. */
  readonly motion: MotionPlayback;
  /** The blade this Tick, solved from the Motion by IK. Last Tick's blade bounds the Blade Sweep. */
  readonly blade: BladeTransform;
  /** The feet: each one's planted world position and any step in progress (the Gait, ADR 0003). */
  readonly gait: GaitState;
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

/** Whether the Duel is still being fought. `winner` is a Fighter index, or null for a draw (both at 0 HP). */
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
