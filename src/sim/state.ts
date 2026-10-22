import type { SimEvent } from './events';
import type { GaitState } from './gait';
import type { PoseTargets, UpperBody } from './motion';
import type { Direction } from './intent';
import type { RngState } from './rng';
import type { BladeTransform, KickLeg } from './skeleton';
import type { Vec3 } from './vec';

/** Ground-plane vector (metres): x/z, with y up. Heights are kept apart (`FighterState.y`). */
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
  /** Ticks the Weapon stays lodged in the victim after a Hit: the Attack's Motion holds still until it runs out. */
  readonly lodge?: number;
  /**
   * Present while attack is held during Recovery (a Chain): the pose blends straight toward the next Attack's Wind-up
   * instead of back to guard. `tick` is the Recovery's own playhead, which still decides when Recovery ends; the Motion
   * playback meanwhile shows the next Attack's Motion. `direction` is the Direction it was held in.
   */
  readonly chain?: AttackChain;
}

/** A Chain: attack held during Recovery (see AttackAction.chain). */
export interface AttackChain {
  readonly direction: Direction;
  readonly tick: number;
}

/** Holding a Block in one Direction for as long as block is held. Stops matching Attacks by rule (ADR 0002). */
export interface BlockAction {
  readonly kind: 'Block';
  readonly direction: Direction;
  /** Ticks since the Block was raised; until `block.correctionWindow` (Tuning Data) runs out, the Intent's Direction can still change it. */
  readonly age: number;
}

/** Why a Fighter Staggers: it was hit, its Attack was Blocked (the attacker recoils), its Attack was Chambered, or it Landed hard from a fall. */
export type StaggerCause = 'Hit' | 'Blocked' | 'Chambered' | 'Landed';

/** A short forced Action in which the Fighter cannot act; it lasts as long as the Stagger Motion. */
export interface StaggerAction {
  readonly kind: 'Stagger';
  readonly cause: StaggerCause;
  /**
   * A blade Hit only: the side the blow came from, from the Fighter's own view (the attacker's Direction mirrored for
   * Left and Right, as a Block names it), which picks its hit reaction.
   */
  readonly from?: Direction;
}

/**
 * A Kick: the right leg winds up, snaps forward in Release (the only phase in which it can land) and recovers, driven by the Kick Motion's
 * `windUpEnd` / `releaseEnd` markers like an Attack. Committed: no moving, Blocking, Attacking or cancelling, but the Fighter can turn.
 */
export interface KickAction {
  readonly kind: 'Kick';
  readonly phase: AttackPhase;
  /** True once this Kick's leg sweep has connected; a Kick lands at most once. */
  readonly landed: boolean;
  /** Ticks of extra Recovery (`kick.whiffRecovery`) still to hold the pose for, once Recovery was reached without landing; absent until then. */
  readonly whiff?: number;
}

/**
 * A Throw: the off (left) hand takes a Throwing Dagger by its point, draws it back behind the head and throws it, driven by the Throw Motion's
 * `windUpEnd` / `releaseEnd` markers like an Attack. Like an Attack's, its Wind-up holds at its held pose while throw is held (up to
 * `dagger.maxHoldTicks`). The dagger leaves the hand on the first Tick of Release. The Fighter can still walk, turn and crouch, but not Attack,
 * Block, Kick, Feint or cancel.
 */
export interface ThrowAction {
  readonly kind: 'Throw';
  readonly phase: AttackPhase;
  /** The Tick (`SimState.tick`) on which this Throw's Wind-up started: a Block only stops its dagger if it was raised on or after it. */
  readonly startTick: number;
  /** Ticks the Wind-up has been held at its held pose so far; absent until it is held. */
  readonly held?: number;
}

/**
 * A Sheathe: the sword hand puts the Weapon away in its slot (the hip or the back, Weapon `sheathe.slot`), driven by the slot's Sheathe
 * Motion. The Weapon leaves the hand at the Motion's `swap` marker, and from that Tick on the Fighter is Sheathed (`FighterState.sheathed`).
 * Committed: the Fighter can walk (at its drawn speed), turn and crouch, but not Jump, Kick, Throw, Attack, Block or cancel.
 */
export interface SheatheAction {
  readonly kind: 'Sheathe';
}

/** A Draw: the reverse of a Sheathe, by the slot's Draw Motion. The Weapon is back in the hand from its `swap` marker on. Committed like a Sheathe. */
export interface DrawAction {
  readonly kind: 'Draw';
}

/** The phases of a Knockdown, in order: the fall, lying, the Get-up. */
export type KnockdownPhase = 'Falling' | 'Down' | 'Rising';

/**
 * A Knockdown: the Fighter falls flat on its back, lies for `kick.knockdownTicks` and gets up. It can
 * guard throughout but cannot turn, move, Attack, Kick or Jump, and it can be hit normally (ADR 0007).
 */
export interface KnockdownAction {
  readonly kind: 'Knockdown';
  readonly phase: KnockdownPhase;
  /** Ticks spent lying so far while Down (counting up to `kick.knockdownTicks`); 0 in the other phases. */
  readonly ticks: number;
  /** The Direction of the guard it is holding (it Blocks like a Block in that Direction), or null when it holds none. */
  readonly guard: Direction | null;
}

/** In the air after a Jump, or after `fall.fallDelay` airborne. After a ledge or push it cannot Attack or Block until it lands; after a Jump it can. */
export interface FallAction {
  readonly kind: 'Fall';
}

/**
 * What a Fighter is doing right now; exactly one at a time. A tagged union of
 * plain data: add a member here and a handler in `actions/index.ts`.
 */
export type Action = IdleAction | AttackAction | BlockAction | KickAction | ThrowAction | SheatheAction | DrawAction | KnockdownAction | StaggerAction | FallAction;
export type ActionKind = Action['kind'];

/** A Fighter off the ground (walked off a ledge, pushed off, or jumped): its velocity (m/s) and the top of its arc. */
export interface Airborne {
  readonly vx: number;
  readonly vz: number;
  /** Vertical speed, up positive. */
  readonly vy: number;
  /** The highest its feet have been since it left the ground: a Landing's drop is measured from here. */
  readonly peakY: number;
  /** Ticks since it left the ground. */
  readonly ticks: number;
  /** Whether it left the ground by jumping. */
  readonly jumped: boolean;
  /** Ticks of Jump boost left: while Jump stays held it is pushed up at `fall.jumpBoost`. Absent once let go or spent (it never comes back). */
  readonly boost?: number;
  /** The height it jumped from (a Jump only): the drop a Jump's Landing reports is measured from no higher than a plain Jump's top above it (a Jump lands without fall damage anyway). */
  readonly launchY?: number;
}

/** A push along the floor, decelerating to a stop: its current velocity (m/s) and the Ticks it has left (see `slide.ts`). */
export interface Slide {
  readonly vx: number;
  readonly vz: number;
  readonly ticks: number;
}

/** The Slow a dagger Hit leaves: walking and air steering run at `dagger.slowFactor` for these many more Ticks (never stored as zero). */
export interface Slow {
  readonly ticks: number;
}

export interface FighterState {
  /** Position on the ground plane, centre of the Arena is the origin. */
  readonly position: Vec2;
  /** Height (m) of its feet: the Walk Surface it stands on, or where it is in the air. */
  readonly y: number;
  /** Present while it is off the ground; absent while it stands on a Walk Surface. */
  readonly air?: Airborne;
  /** Yaw in radians; 0 faces +z. */
  readonly facing: number;
  /** Where it looks: radians up (+) or down (-) from level. Leans the torso and hips (Intent `pitch`). */
  readonly pitch: number;
  /** How crouched it is, 0 (standing) to 1 (fully): lowers its hips and hands (and so its Hit Zones and blows) and slows its walk (Intent `crouch`). */
  readonly crouch: number;
  /** Its team (0 or 1), fixed for the Match. Teammates' blades Stagger but never wound each other. */
  readonly team: number;
  readonly hp: number;
  /** Its max HP: `fighter.maxHp`, or in a Gauntlet Run an enemy's scaled one (docs/plans/gauntlet.md). HP never rises above it. */
  readonly maxHp: number;
  /** The name of the Weapon it wields (Tuning Data `weapons`), chosen when the Match is created and kept across Duels. */
  readonly weapon: string;
  readonly action: Action;
  /** The Motion animating the current Action and its playhead. */
  readonly motion: MotionPlayback;
  /** The blade this Tick, solved from the Motion by IK. Last Tick's blade bounds the Blade Sweep. */
  readonly blade: BladeTransform;
  /** The kicking (right) leg this Tick, solved from the Skeleton. Last Tick's leg bounds the Kick's sweep, as last Tick's blade bounds the Blade Sweep. */
  readonly kickLeg: KickLeg;
  /** Throwing Daggers left to throw this Duel; refilled to `dagger.count` when a Duel starts. */
  readonly daggers: number;
  /**
   * Whether its Weapon is put away in its slot (Sheathed): it walks faster and cannot Attack or Block. It flips at a Sheathe's or Draw's
   * `swap` marker, so an interrupted one keeps whatever already happened. False when a Duel starts. The sheathed Weapon is render-only (ADR 0017).
   */
  readonly sheathed: boolean;
  /** The feet: each one's planted world position and any step in progress (the Gait, ADR 0003). */
  readonly gait: GaitState;
  /** Present while a Kick's push is carrying the Fighter along the floor (a Slide); absent otherwise, and while airborne. */
  readonly slide?: Slide;
  /** Present while a dagger Hit's Slow lasts; absent once it has run out. A new dagger Hit restarts it at the same strength. */
  readonly slow?: Slow;
  /** Present while a Blocked blow is still shaking the sword hand (Block Impact); absent once it has settled. */
  readonly blockImpact?: BlockImpact;
  /** Present once the Fighter has fallen (its HP reached zero). It is no longer simulated, hits and is hit by nothing, and no longer blocks bodies: its state stays as it was on that Tick. */
  readonly death?: Death;
  /**
   * Present on an enemy slot a Gauntlet Floor leaves empty (Benched), set only when the Floor starts: 0 HP and no `death`, standing at its
   * slot's spawn, out of the Duel (`inDuel`): not stepped, hits and is hit by nothing, blocks no bodies, never a target, not counted by the Duel's end.
   */
  readonly benched?: true;
}

/**
 * How a Fighter fell. The Simulation only records it; the Death Ragdoll is
 * drawn from it outside the Tick, so it never changes an outcome.
 */
export interface Death {
  /** The Duel Tick on which it fell. */
  readonly tick: number;
  /** What felled it: a Hit, fall damage or an Abyss (Fall), or landing in lava or water. */
  readonly cause: DeathCause;
  /** The Hit that felled it, or null if none is known. */
  readonly blow: DeathBlow | null;
}

export type DeathCause = 'Hit' | 'Fall' | 'Lava' | 'Water';

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

/** A Throwing Dagger in flight (ADR 0008). Ordered in `SimState.daggers` by when it was thrown. */
export interface DaggerState {
  /** The Fighter that threw it (it passes through that Fighter). */
  readonly owner: number;
  /** The thrower's team (it passes through the thrower's teammates). */
  readonly team: number;
  /** The Tick (`SimState.tick`) its throw's Wind-up started: a Block only stops it if it was raised on or after it. */
  readonly thrownAt: number;
  /** Where it is. */
  readonly position: Vec3;
  /** Its velocity (m/s), up positive. */
  readonly velocity: Vec3;
  /** Ticks it has flown. */
  readonly ticks: number;
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
  /**
   * Present while a Motion holds the Fighter's upper body (torso and hands) where it was,
   * whatever the Motion says: a blocked attacker's recoil freezes its pose from the moment it was blocked. Absent otherwise.
   */
  readonly hold?: UpperBody;
}

/** A crossfade from a frozen pose into the current Motion. */
export interface MotionBlend {
  readonly from: PoseTargets;
  readonly tick: number;
  /** The blend's length in Ticks, when it is not the usual Motion Blend (a Chain blends across the rest of Recovery and the next Wind-up). */
  readonly ticks?: number;
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
  /** The Arena (a Tuning Data Arena name) the Duel is fought in. */
  readonly arena: string;
  readonly rng: RngState;
  readonly fighters: readonly FighterState[];
  /** Throwing Daggers in flight, in the order they were thrown. */
  readonly daggers: readonly DaggerState[];
  readonly duel: DuelState;
  /** In a Gauntlet Run, the Floor this Duel is (1-based), so a Controller, which sees only SimState, can tell Floors apart; absent otherwise. */
  readonly floor?: number;
  /** What happened during the Tick that produced this state (for audio, effects, overlays, tests). */
  readonly events: readonly SimEvent[];
}
