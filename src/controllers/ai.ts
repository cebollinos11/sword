/**
 * The rule-based AI Controller.
 *
 * Fairness rules (spec #7, story 25/26):
 *  - It only observes what a human could see of the other Fighters: position
 *    and how it is moving, height, crouch, HP bar, Weapon, team, whether they
 *    have fallen, and the visible Action and pose (the Wind-up pose reveals the
 *    Direction, and how far along it is). Never anyone's Intents.
 *  - It acts on the others only as seen `reactionTime` ago (its Reaction
 *    Time), or a little longer when it notices an Attack late (`reactionJitter`).
 *    Its own Fighter it knows up to date.
 *  - With several enemies it fights its focus: the nearest one (or with
 *    `teamwork` the one its allies leave free), kept until another is clearly
 *    nearer, or one that swings or Kicks at it, kept for a while (`chooseFocus`).
 *    It defends against whichever enemy Attack nearest to it can reach it (see `intent`).
 *  - It fights only on the same level (feet within LEVEL of each other's).
 *    To reach an enemy on another Walk Surface it follows the navmesh
 *    (`findPath`, `steer`), re-planning when either moves to another surface
 *    or every REPATH_TICKS; the route is part of its memory. It follows jump
 *    Links held no longer than its `jumpNav`, and shortcut ones (up onto a
 *    floor it could walk to the long way) at any hold (none without one): it lines up
 *    behind the takeoff, runs in, presses Jump there and holds it for the
 *    Link's hold (`takeJump`, `flying`; the run is in its memory too), giving
 *    up on a Link it cannot get airborne on in time. With no way to its enemy
 *    it goes only as near as it safely can. Fighting, it never steps off a
 *    ledge or onto Lava or Water (`safeMove`): it turns aside, or holds its
 *    ground, and it only Jumps where the Simulation's own arc, made a little
 *    off every way, lands safely (`jumpIsSafe`).
 *
 * How it fights (each part scaled by its difficulty preset, `AiDifficulty`):
 *  - Defence: against an Attack it Blocks in the Direction that meets it; or
 *    Crouches under a Left or Right (`duckRate`: a Crouch lets both pass over);
 *    or tries a Chamber, attacking into it timed off how far along its Wind-up
 *    was (`chamberRate`); or, when its own Wind-up will land first, swings on
 *    (`preempt`). A wrong-Direction Block is the mistake (`mistakeRate`,
 *    rolled once per opponent Attack). An Attack Feint is a new Attack to plan for.
 *  - Footwork (`footwork`): it hovers just outside the longer of the two
 *    Weapons' reach (inside its own if its Weapon is the longer), circling its
 *    opponent, switching sides now and then or when the way is unsafe.
 *  - Tactics: Neutral (spacing and probing), Pressure (`pressure`: closing in,
 *    attacking and Chaining more, more likely when ahead on HP) and Disengage
 *    (`caution`: backing out of reach after being hit, or when low on HP;
 *    shuffling back out of a Blocked recoil, and stepping away in Recovery).
 *  - Attacking: from its spacing it steps in and swings into the Attack,
 *    holding the Wind-up while it closes; it keeps walking through the
 *    Release. It aims (pitch) at its opponent's chest, so it reaches one
 *    crouched or lying down. It picks a Direction around a raised Block,
 *    Overhead or Thrust against a Crouch, Thrust at long range; a mistake is
 *    a random one. It punishes openings (`punish`, rolled once per opening):
 *    Recovery, a Blocked or Chambered recoil, a hard Landing, a Knockdown,
 *    a whiffed Kick; with `punishFits` (rolled with it) only one its own
 *    Wind-up (Tempo included) Releases inside, as the seen playhead says how
 *    much is left of it (counted as seen: the opponent takes as long to see
 *    the punish coming), and otherwise it spaces out. It meets an opponent
 *    walking into its reach with an
 *    Attack already on the way (`preempt`), leaps in with a jumping Overhead
 *    from out of reach, or down off a ledge (`jumpAttackRate`; held for the
 *    shortest hold up to its `jumpNav` whose arc brings it within reach of where
 *    the opponent will be), Chains a second Attack while
 *    its opponent is still in reach (`chainRate`), Feints at `feintRate` (and
 *    Feints away from a Block it sees raised against its Wind-up), and now and
 *    then swings from out of range (the mistake). With `whiffCheck` (rolled
 *    once per Attack) it does not swing at a target it sees backing out of
 *    reach: about to Release, it holds the Wind-up while it may close in, or
 *    Feints into a Block.
 *  - Reading a low swing (`lowSwingRead`, rolled once per Attack it defends):
 *    a Left or Right from an attacker seen looking down (pitch below
 *    `ai.duckMaxPitch`; the torso leans with the look) hits a Crouch, so it
 *    Blocks it rather than Duck, re-checking every Tick of the Wind-up.
 *  - Breaking a held Wind-up (`holdBreak`, rolled once per Wind-up held
 *    HOLD_BREAK_TICKS past its held pose): it stops turtling, backs out of
 *    the attacker's reach with its Block kept, Kicks an attacker walking
 *    after it (a mover is knocked down), and from just outside baits the
 *    Release, stepping in under its Block and back, to punish the Recovery.
 *  - Jumps: an opponent seen in the air, it predicts the Landing from what it
 *    saw (`jumpArcFrom`, as moving, with no more boost: it cannot see Jump held),
 *    and at `landingPunish` (rolled once per Jump) stands just inside its reach
 *    of it and times an Overhead to Release as the opponent lands. Disengaging
 *    near a jump Link away from its opponent, onto another Walk Surface, it takes
 *    it (`jumpEscapeRate`), and holds its ground up there while it Disengages.
 *  - Kicks: it Kicks an opponent within `kickRange` who was last seen moving
 *    (a Kick knocks down anyone who gives movement input, ADR 0007), at
 *    `kickRate` per Tick, far more readily with a drop, Lava or Water behind
 *    them; `mistakeRate` makes it lose the chance, or Kick from just out of
 *    reach. It never Kicks an opponent lying in a Knockdown.
 *  - Throws: an Idle AI with daggers left throws one (at `throwRate`; `mistakeRate` makes it lose the
 *    chance and spoils its aim) at an enemy on its level beyond its reach, within `throwRange`, in line of
 *    sight and last seen walking away. It leads the target (its walk over the flight and Reaction Time) and
 *    offsets for its left hand (the dagger leaves the left hand, parallel to the facing).
 *  - Against a Throw Wind-up or Release aimed at it, it turns to the thrower and raises a Block, and keeps it
 *    raised while that dagger is still on its way. Its Reaction Time means it raises it after the Wind-up began,
 *    which is what a Block needs to stop a dagger (a Block held from before does not: it lets go and raises it
 *    again). `mistakeRate` is the chance, rolled once per throw, that it fails to.
 *  - Against a Kick Wind-up or Release within `kickRange` it stands still (a
 *    Kick only knocks down a mover), and Blocks only if a blade threatens too.
 *    A Kick in Recovery is an opening, like an Attack's.
 *  - Teamwork (`teamwork`), by what it sees of its allies as it sees everyone, Reaction Time ago (their place, how
 *    they move and their Action; never their plans), so the team shares no memory and every peer agrees:
 *    - Flank slots (rolled as it picks its circling side): the team on its target (each ally seen nearer it than
 *      any other enemy), ranked by Fighter index, takes slots around it (FLANKS: two at ±70°, three at 0° and ±115°
 *      of their mean bearing), and it circles to its own instead of at random; it steers clear of any ally within CROWD.
 *    - Turns (rolled once per Attack of its own): it starts no Attack from its spacing while an ally on its target is
 *      seen swinging, and otherwise only in its own turn window (TURN_TICKS, by rank), pressing as often there as the
 *      team would between them; it swings at once at a back turned on an ally, and punishes an opening as ever.
 *    - No friendly fire (the same roll): it never lets a Wind-up go with an ally in its swing line (`keepClear`:
 *      wide for a Left or Right, narrow for an Overhead or a Thrust), picks an Overhead or a Thrust with an ally beside
 *      its line, and tries no Chamber or Outpace with one near it.
 *    - Target spread (rolled as it picks an enemy): it fights the enemy its team leaves free (`spreadPick`), unless
 *      the one they share is low on HP (LOW_HP) or the last standing.
 *  - Feel (the human touches, each rolled as below; none changes what it sees, only when and how it acts on it):
 *    - Rhythm (`rhythm`, rolled once per Attack from its spacing): instead of a coin flip every Tick, it swings on a beat,
 *      the pace the coin flip would have pressed at summed up to a bell-shaped need (`Beat`), now and then after a pause,
 *      now and then as a double threat (step in, swing, Chain).
 *    - Reaction jitter (`reactionJitter`, rolled once per enemy Attack it sees coming): noticed 1 to half its Reaction Time
 *      late (at most JITTER_MAX), it acts on the Tick before it saw it until then (`sight`; it keeps that much more of what it saw).
 *    - Human mistakes (`humanMistakes`, rolled once per Attack it defends): its mistake is a Block raised a few Ticks late,
 *      or one beside the right Direction, a little likelier just after its own Attack or being hit (`shaken`).
 *    - Idle life (`idleLife`, rolled with its circling side): a spacing of its own, no circling for a while, a short pause.
 *    - Jump steps (`jumpStep`, rolled with its circling side, one hop each): a tapped Jump out of a pincer, or round to its
 *      flank slot when the walk round is blocked (`hopStep`). A hop is no quicker than a walk and cannot Block, so never
 *      with an enemy Attack or Kick seen coming in reach (as seen Reaction Time ago, jitter or not), and only where
 *      `jumpIsSafe` says it lands safely, its arc out of every enemy's reach.
 *  - Sheathe and Draw: it never Sheathes. Its own Fighter Sheathed (after an AI
 *    Takeover), it Draws (pressing attack Draws) once an enemy on its level is
 *    near, and a Block it means raises once the Draw is done. An enemy it sees
 *    Sheathed, Sheathing or Drawing cannot Block (`defenceless`): rolled once at
 *    `punish`, it skips spacing and Feints and closes in to swing.
 *
 * A Style (Tuning Data `ai.styles`) scales its difficulty's chances (`skillOf`); the default Style changes nothing.
 *
 * With every optional parameter left out it walks straight in, attacks at
 * `ai.aggression` from `ai.attackRange`, backs off inside `ai.retreatRange`
 * and always punishes an opening: the plain AI the tests drive.
 *
 * Deterministic given the seeded generator in state: it holds no generator of
 * its own. Each Tick it draws from a generator derived from the Simulation's
 * `state.rng` (which the Simulation advances every Tick) and its Fighter index,
 * so scrubbing back or re-simulating the same state gives the same Intents
 * given the same memory (`save`/`load`). It only draws for the parts of its
 * repertoire its difficulty uses.
 */
import {
  arenaOf,
  attackTimings,
  blockedAt,
  createRng,
  deadlyGround,
  findPath,
  groundBelow,
  inDuel,
  JITTER_POS,
  JUMP_HOLDS,
  jumpArc,
  jumpArcFrom,
  jumpIsSafe,
  kickTimings,
  levelJump,
  navMesh,
  navPolygon,
  steer,
  DIRECTIONS,
  IDLE_INTENT,
  mirrorDirection,
  nextFloat,
  secondsToTicks,
  staggerMotionName,
  throwTimings,
  TICK_SECONDS,
  type Action,
  type Direction,
  type FighterState,
  type Intent,
  type JumpLink,
  type PathOptions,
  type RngState,
  type SimState,
  type Vec2,
} from '../sim';
import { AI_STYLE_KEYS, DEFAULT_STYLE, defaultWeaponName, weaponByName, weaponMotion, type AiDifficulty, type AiStyle, type ArenaGeometry, type TuningData } from '../tuning';
import type { Controller } from './controller';

/** What the AI saw of one Fighter on one Tick. */
interface Sighting {
  readonly position: Vec2;
  /** Height of its feet. */
  readonly y: number;
  /** How it moved since the Tick before (m per Tick), and how its feet rose (m per Tick, up positive). */
  readonly velocity: Vec2;
  readonly rise: number;
  readonly action: Action;
  /** The playhead of its Motion (how far along its Wind-up is, as its pose shows). */
  readonly motionTick: number;
  readonly crouch: number;
  readonly airborne: boolean;
  readonly hp: number;
  readonly weapon: string;
  readonly team: number;
  /** Out of the Duel (`inDuel`): fallen, or a Benched slot. */
  readonly fallen: boolean;
  /** Which way its body faces. */
  readonly facing: number;
  /** Where it looks (radians, up positive): its torso leans with it (`applyLook`). */
  readonly pitch: number;
  /** Its feet moved since the Tick before (walking, or being pushed). */
  readonly moving: boolean;
  /** The Tick its current Attack became visible (identifies one Attack), or null when not attacking. */
  readonly attackStart: number | null;
  /** The Tick it was first seen off the ground this time (identifies one Jump or fall), or null when on the ground. */
  readonly airStart: number | null;
  /** Its Weapon is in its slot (on its hip or back, for anyone to see). */
  readonly sheathed: boolean;
}

/** An enemy throw the AI means to Block (`react`) or let be, rolled once per throw. */
interface ThrowPlan {
  readonly thrower: number;
  /** The enemy Throw's `startTick` (identifies one Throw; its dagger's `thrownAt` is on or after it). */
  readonly startTick: number;
  readonly react: boolean;
}

/** What the AI saw of every Fighter on one Tick (its own Fighter included, unused). */
interface Observation {
  readonly tick: number;
  readonly fighters: readonly Sighting[];
}

/**
 * How it means to meet one enemy Attack (rolled once, so a mistake sticks): Block it in `direction`, Crouch
 * under it (Duck), attack into it on Tick `pressAt` (Chamber), or swing on with its own faster Attack (Outpace).
 */
interface DefencePlan {
  readonly attacker: number;
  readonly attackStart: number;
  readonly kind: 'Block' | 'Duck' | 'Chamber' | 'Outpace';
  readonly direction: Direction;
  readonly pressAt: number;
  /** It rolled to read the attacker's look (`lowSwingRead`): a Duck switches to a Block while the look is low. */
  readonly reads?: boolean;
  /** Whether it breaks this Wind-up's hold (`holdBreak`, rolled once it is held long enough), and the Tick it began to. */
  readonly holdBreak?: { readonly go: boolean; readonly at: number };
  /** A late Block (`humanMistakes`): it raises it no sooner than this Tick. */
  readonly raiseAt?: number;
}

/** An Attack the AI means to Feint: hold the Wind-up in `from`, then switch to `into` on Duel Tick `at`. */
interface FeintPlan {
  readonly from: Direction;
  readonly into: Direction;
  readonly at: number;
}

/** How it means to play out its own current Attack. */
interface AttackPlan {
  /** The Direction of the Attack this plan is for. */
  readonly direction: Direction;
  /** It may hold the Wind-up while it closes in (swinging into the Attack) until this Tick. */
  readonly holdUntil: number;
  /** Whether it has rolled to Feint away from a Block raised against this Attack. */
  readonly reFeintRolled: boolean;
  /** Whether it has rolled to Chain, and the Direction it Chains into (null: no Chain). */
  readonly chainRolled: boolean;
  readonly chain: Direction | null;
  /** It held attack for the Chain last Tick: the next Attack starts on the Idle Tick. */
  readonly chainHeld: boolean;
  /** A jumping Attack: it keeps Jump held while in the air before this Tick (-1: not one). */
  readonly holdJumpUntil: number;
  /** It rolled to check for a whiff (`whiffCheck`): it does not Release at a target seen backing out of reach. */
  readonly whiff: boolean;
  /** It rolled to play this Attack as one of a team (`teamwork`): it holds the Wind-up while an ally is in its swing line (`keepClear`), and takes its turn without a Chain. */
  readonly team: boolean;
  /** A double threat (`rhythm`): it Chains this Attack whatever its `chainRate`. */
  readonly double?: boolean;
}

type Mode = 'Neutral' | 'Pressure' | 'Disengage';

/** Its current tactic, until Duel Tick `until`. */
interface Tactic {
  readonly mode: Mode;
  readonly until: number;
}

/** Which way it circles (+1 or -1, around its opponent), until Duel Tick `until`. */
interface Strafe {
  readonly sign: number;
  readonly until: number;
  /** It rolled to take a flank slot (`teamwork`) rather than circle: it steers to its slot around a target allies share, and clear of allies close by. */
  readonly flank: boolean;
  /** Idle life (`idleLife`, rolled with the side): how much (m) further out than its spacing it hovers, whether it stops circling, and the Tick a short pause ends (-1: none). */
  readonly spacing: number;
  readonly still: boolean;
  readonly pause: number;
  /** It rolled to hop to reposition (`jumpStep`): the next hop it finds a reason and a safe way for, it takes (once). */
  readonly hop: boolean;
}

/**
 * When its next Attack from its spacing comes (`rhythm`, rolled once per such Attack; not `timed`, the old coin flip every Tick):
 * once the pace it has spent (`done`: each Tick from its spacing, what the coin flip would have pressed at) reaches `need`;
 * as a double threat (`double`: it Chains it); and whether, out of reach when it comes, it swings at air anyway (`wild`, the mistake).
 */
interface Beat {
  readonly timed: boolean;
  readonly need: number;
  readonly done: number;
  readonly double: boolean;
  readonly wild: boolean;
}

/** The newest enemy Attack it rolled a jitter for (`reactionJitter`; its `attackStart`), and the Tick it notices it on: until then it acts on the Tick before it saw it. */
interface Jitter {
  readonly from: number;
  readonly until: number;
  readonly at: number;
}

/** Whether it goes for the opening it last saw (`fighter`'s, seen up to Tick `seen`). */
interface OpeningRoll {
  readonly fighter: number;
  readonly seen: number;
  readonly go: boolean;
  /** It rolled to punish it only if its Wind-up Releases in time (`punishFits`). */
  readonly fits: boolean;
}

/** The way to its target on another Walk Surface: Links (`findPath`, null if there is none) planned on Tick `at` from surface `from` to `to`. */
interface Route {
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly links: readonly number[] | null;
}

/**
 * A jump Link of its route it is carrying out (`link`, its id): walking to the run-up point behind the takeoff
 * (LineUp), running in along the heading (RunIn), or in the air since it pressed Jump on Tick `flew` (Fly). Not airborne by
 * Tick `deadline`, it gives up on it.
 */
interface JumpRun {
  readonly link: number;
  readonly stage: 'LineUp' | 'RunIn' | 'Fly';
  readonly deadline: number;
  readonly flew: number;
  /** Taken to get away from its enemy (`escapeLink`), not as part of a route: it carries it out whatever its route says. */
  readonly escape: boolean;
}

/** Whether it meets the Landing of `fighter`'s time in the air that began on Tick `airStart` (rolled once, at `landingPunish`). */
interface LandingRoll {
  readonly fighter: number;
  readonly airStart: number;
  readonly go: boolean;
}

/** A jump Link it gave up on, on Tick `at`: left out of its routes for JUMP_RETRY Ticks, so it does not try it again straight away. */
interface FailedJump {
  readonly link: number;
  readonly at: number;
}

/** The AI Controller's memory (what it has seen and its plans), saved and loaded by the Editor sandbox and the Rollback session. */
interface AiMemory {
  readonly seen: readonly Observation[];
  readonly lastTick: number;
  readonly defencePlan: DefencePlan | null;
  readonly feintPlan: FeintPlan | null;
  readonly attackPlan: AttackPlan | null;
  readonly throwPlan: ThrowPlan | null;
  /** The error (radians) it rolled for its current throw's aim. */
  readonly aimError: number;
  readonly route: Route | null;
  readonly jumpRun: JumpRun | null;
  readonly failedJumps: readonly FailedJump[];
  readonly landing: LandingRoll | null;
  readonly tactic: Tactic;
  readonly strafe: Strafe;
  readonly opening: OpeningRoll | null;
  /** Its own HP last Tick (-1 before its first), to notice being hit. */
  readonly lastHp: number;
  readonly focus: Focus | null;
  /** Whether it plays its next Attack as one of a team (`teamwork`, rolled once per Attack once allies come into it), or null before the roll. */
  readonly turn: boolean | null;
  /** Holding its Wind-up for an ally in its swing line, it Feints into a Block on this Tick (-1: not holding for one). */
  readonly lineHold: number;
  /** When its next Attack from its spacing comes (`rhythm`), or null before the roll. */
  readonly beat: Beat | null;
  /** The enemy Attack it is (or was last) late to notice (`reactionJitter`). */
  readonly jitter: Jitter | null;
  /** Lapses are likelier until this Tick (`humanMistakes`): just after its own Attack or being hit (-1: none). */
  readonly shaken: number;
}

/** The enemy it fights (`fighter`), kept whatever the others do until Tick `until` (-1: only while none is much nearer). */
interface Focus {
  readonly fighter: number;
  readonly until: number;
  /** It rolled to spread out (`teamwork`, as it picked this enemy): it fights the enemy its allies leave free (`spreadPick`), not the nearest. */
  readonly spread: boolean;
}

/** A difficulty preset with every optional part filled in. */
export type Skill = Required<AiDifficulty>;

/** A route is re-planned at least this often (Ticks), as its target moves about. */
const REPATH_TICKS = 30;
/** It fights (attacks, backs off) only an enemy whose feet are within this height of its own (m). */
const LEVEL = 0.5;
/** It defends against an Attack from an enemy whose feet are within this height of its own (m): a blade reaches up or down a stair. */
const DEFEND_LEVEL = 1.0;
/** Moving while it fights, it looks this far (m) ahead of its step for a ledge, Lava or Water. */
const SAFETY_PROBE = 0.8;
/** ...and this far (m) to either side of where it looks. */
const SAFETY_MARGIN = 0.1;
/** A Thrust reaches this much (m) further than a swing. */
const THRUST_REACH = 0.15;
/** From this far (m) beyond its reach it may step in and swing into an Attack, holding the Wind-up while it closes. */
const SWING_IN = 0.7;
/** It holds a Wind-up for at most this many Ticks while it closes in. */
const SWING_IN_HOLD = 22;
/** Hovering, it stands this far (m) beyond the longer reach. */
const HOVER_MARGIN = 0.25;
/** Disengaging, it backs off to this far (m) beyond the longer reach. */
const DISENGAGE_MARGIN = 1.0;
/** A jumping Attack at an enemy on its level is launched from at least this far (m) beyond its reach. */
const JUMP_FROM = 0.2;
/** A Chamber is pressed this many Ticks into the incoming Release (1 = its first Tick). */
const CHAMBER_AT = 2;
/** It aims (pitch) at this height (m) up a standing Fighter: the chest. */
const AIM_HEIGHT = 1.3;
/** A Fighter lying in a Knockdown is aimed at this high (m). */
const LYING_AIM = 0.3;

/** A jump Link is run up to from this far (m) behind its takeoff, along its heading. */
const RUNUP = 0.6;
/** Lining up for a jump Link, it is at the run-up point once this close (m) to it. */
const LINED_UP = 0.12;
/**
 * Running in, it presses Jump once it is no more than this far (m) short of the takeoff along the heading. It is lined
 * up within LINED_UP across it, and a Tick's walk takes it less than this past it: well inside the error check's JITTER_POS.
 */
const TAKEOFF_SHORT = 0.1;
/** Disengaging, it takes a jump Link away from its enemy whose takeoff is within this far (m). */
const ESCAPE_NEAR = 2.5;
/** Meeting a Landing, it stands this much (m) inside its reach of where the enemy comes down. */
const LANDING_INSIDE = 0.1;
/** It gives up on a jump Link it is still not airborne on this many Ticks after it could have walked to the run-up point. */
const JUMP_PATIENCE = 120;
/** A jump Link it gave up on is left out of its routes for this many Ticks. */
const JUMP_RETRY = 60;

/** The dagger leaves the left hand, this far (m) off the thrower's centreline, and flies parallel to its facing. */
const LEFT_HAND = 0.12;
/** The height (m) of the throwing hand above the feet at Release. */
const HAND_HEIGHT = 1.65;
/** An enemy throw is aimed at the AI when the line it faces passes within this distance (m) of it. */
const THROW_AIM_MISS = 0.6;
/** It only throws at a target walking away faster than this fraction of its walk speed. */
const FLEEING = 0.25;
/** Line of sight is checked at this spacing (m). */
const SIGHT_SPACING = 0.5;
/** The widest error (radians) a throw's aim can have, at a mistake rate of 1. */
const AIM_ERROR = 0.25;
const DEG = Math.PI / 180;

/** A Wind-up held this many Ticks past its held pose is one it may break (`holdBreak`). */
const HOLD_BREAK_TICKS = 15;
/** Breaking a hold, it backs out for this many Ticks, then baits: this many Ticks stepping in under its Block, as many back out. */
const BAIT_FIRST = 30;
const BAIT_HALF = 30;
/** Baiting, it steps this far (m) inside the attacker's reach. */
const BAIT_INSIDE = 0.15;
/** An enemy closing on it faster than this fraction of walk speed is walking after it. */
const WALKING_AFTER = 0.3;
/** A target backing off faster than this fraction of walk speed is backing out (`whiffCheck`). */
const BACKING_OUT = 0.1;

/** Flank slots (radians, around the target from the mean bearing of the team on it), by how many share it, in Fighter-index order. */
const FLANKS: Readonly<Record<number, readonly number[]>> = { 2: [-70 * DEG, 70 * DEG], 3: [0, -115 * DEG, 115 * DEG] };
/** It steers away from an ally closer than this (m). */
const CROWD = 1.0;
/**
 * An ally is in its swing line within this much (m) beyond its reach, and this far (radians) either side of the line to its
 * target: a Left or Right sweeps wide, an Overhead or a Thrust cuts close along the line.
 */
const LINE_MARGIN = 0.4;
const LINE_WIDE = 90 * DEG;
const LINE_NARROW = 30 * DEG;
/** ...but a Left or Right sweeps round the body: an ally within CROWD is in its line up to this far (radians) round. */
const LINE_CLOSE = 135 * DEG;
/** It holds a Wind-up for an ally in its swing line for at most this many Ticks, then Feints into a Block. */
const LINE_HOLD = 30;
/** Once it holds for an ally, the ally must stand this much (m) further out before it lets go. */
const LINE_SLACK = 0.4;
/**
 * Taking turns: the Duel's Ticks run in windows of TURN_TICKS, one for each of the team on a target in Fighter-index
 * order; it starts an Attack from its spacing only in the first TURN_OPEN Ticks of its own. The rest (longer than any
 * Reaction Time) lets the next one see a late Wind-up before its own window opens.
 */
const TURN_TICKS = 60;
const TURN_OPEN = 30;
/** Spreading out, it may take an enemy up to this much (m) further than its nearest. */
const SPREAD_RANGE = 3;
/** An enemy below this fraction of its max HP may be piled onto. */
const LOW_HP = 0.35;

/**
 * Rhythm: a beat needs a sum of BEAT_ROLLS uniforms of pace; at BEAT_PAUSE it pauses one to two beats more first, and at
 * BEAT_DOUBLE it is a double threat. With the pauses, a beat needs 1 on average: the coin flip's own mean wait, whatever
 * its tactic or range does to the pace on the way.
 */
const BEAT_ROLLS = 3;
const BEAT_PAUSE = 0.15;
const BEAT_DOUBLE = 0.2;
const BEAT = 1 / (1 + BEAT_PAUSE * 1.5);
/**
 * Idle life: its spacing varies from SPACING_IN (m) inside its own to SPACING_OUT beyond; at LIFE_STILL it stops circling
 * for the while, and at LIFE_PAUSE it stands still first for PAUSE_TICKS, plus up to as many more.
 */
const SPACING_IN = 0.15;
const SPACING_OUT = 0.35;
const LIFE_STILL = 0.3;
const LIFE_PAUSE = 0.3;
const PAUSE_TICKS = 15;
/**
 * Human mistakes: at LATE_SHARE a mistake is a Block raised LATE_MIN Ticks late (plus up to LATE_SPREAD more), else one in a
 * Direction BESIDE the right one (never its opposite); for LAPSE_TICKS after its own Attack or being hit they are LAPSE times as likely.
 */
const LATE_SHARE = 0.6;
const LATE_MIN = 3;
const LATE_SPREAD = 6;
const LAPSE = 1.5;
const LAPSE_TICKS = 45;
const BESIDE: Readonly<Record<Direction, readonly Direction[]>> = { Overhead: ['Left', 'Right'], Thrust: ['Left', 'Right'], Left: ['Overhead', 'Thrust'], Right: ['Overhead', 'Thrust'] };
/**
 * Jump steps: it hops out from between two enemies in reach seen more than PINCER apart (radians, from it), or round to a
 * flank slot more than HOP_SLOT off its bearing when the walk round is blocked: unsafe, or an ally in the way (within
 * ALLY_AHEAD (m) along it and ALLY_ASIDE across). Its arc stays HOP_CLEAR beyond every enemy's reach and ALLY_CLEAR from
 * every ally, and it takes off with no enemy Attack or Kick seen coming within reach and HOP_THREAT more.
 */
const PINCER = 120 * DEG;
const HOP_SLOT = 20 * DEG;
const ALLY_AHEAD = 1.5;
const ALLY_ASIDE = 0.8;
const HOP_CLEAR = 0.1;
const ALLY_CLEAR = 0.6;
const HOP_THREAT = 0.5;
/** ...a pincer is two enemies within this much (m) beyond their reach. */
const PINCER_NEAR = 0.3;

/** A late notice (`reactionJitter`) is at most this many Ticks (0.1 s): more, on a slow Reaction Time, and it Blocks almost nothing in time. */
const JITTER_MAX = 6;

/** A Feint switches Direction this many Ticks after the press, plus up to FEINT_DELAY_SPREAD more (rolled). */
const FEINT_DELAY_MIN = 4;
const FEINT_DELAY_SPREAD = 10;

/** Look up a difficulty preset by name in Tuning Data. */
export function aiDifficulty(tuning: TuningData, name: string): AiDifficulty {
  const d = tuning.ai.difficulties[name];
  if (!d) throw new Error(`Unknown AI difficulty "${name}" (have: ${Object.keys(tuning.ai.difficulties).join(', ')})`);
  return d;
}

/** Look up a Style by name in Tuning Data. */
export function aiStyle(tuning: TuningData, name: string): AiStyle {
  const s = tuning.ai.styles[name];
  if (!s) throw new Error(`Unknown AI Style "${name}" (have: ${Object.keys(tuning.ai.styles).join(', ')})`);
  return s;
}

/**
 * A preset with its optional parts filled in (the global `ai.aggression`/`ai.kickRate`, always punishing, and nothing
 * else), and then scaled by `style`: each chance it names multiplied, clamped to 0..1. With no Style it is the preset.
 */
export function skillOf(tuning: TuningData, d: AiDifficulty, style: AiStyle = {}): Skill {
  const skill: { -readonly [K in keyof Skill]: Skill[K] } = {
    aggression: tuning.ai.aggression,
    kickRate: tuning.ai.kickRate,
    throwRate: tuning.ai.throwRate,
    footwork: 0,
    pressure: 0,
    caution: 0,
    punish: 1,
    chainRate: 0,
    preempt: 0,
    jumpAttackRate: 0,
    duckRate: 0,
    chamberRate: 0,
    landingPunish: 0,
    jumpEscapeRate: 0,
    jumpNav: -1,
    lowSwingRead: 0,
    holdBreak: 0,
    whiffCheck: 0,
    punishFits: 0,
    teamwork: 0,
    rhythm: 0,
    reactionJitter: 0,
    humanMistakes: 0,
    idleLife: 0,
    jumpStep: 0,
    ...d,
  };
  for (const k of AI_STYLE_KEYS) {
    const m = style[k];
    if (m !== undefined) skill[k] = Math.min(1, Math.max(0, skill[k] * m));
  }
  return skill;
}

/** Is this visible Action an Attack that can still land (Wind-up or Release)? */
const isThreat = (a: Action): a is Extract<Action, { kind: 'Attack' }> => a.kind === 'Attack' && a.phase !== 'Recovery';
/** Is this visible Action a Kick whose leg can still land (Wind-up or Release)? */
const isKickThreat = (a: Action): boolean => a.kind === 'Kick' && a.phase !== 'Recovery';
/** Is this visible Action a Throw whose dagger is not out of the hand yet or has just left it (Wind-up or Release)? */
const isThrowThreat = (a: Action): a is Extract<Action, { kind: 'Throw' }> => a.kind === 'Throw' && a.phase !== 'Recovery';
/**
 * A visible opening: the opponent is committed (Recovery, of an Attack or a
 * Kick), recoiling from a Block or a Chamber (the defender's earned timing
 * advantage), crouched from a hard Landing, or lying in a Knockdown. A
 * Stagger from being hit is not one: after a Trade both Fighters Stagger
 * together, and punishing it would just make two AIs Trade again in lockstep.
 */
const isOpening = (a: Action): boolean =>
  (a.kind === 'Stagger' && a.cause !== 'Hit') || ((a.kind === 'Attack' || a.kind === 'Kick') && a.phase === 'Recovery') || (a.kind === 'Knockdown' && a.phase !== 'Rising');
/**
 * A Fighter who cannot Block for a while, as anyone can see: Sheathed (its Weapon on its body), or Sheathing or Drawing (committed, its
 * Weapon on the way to or from its slot).
 */
const defenceless = (o: Sighting): boolean => o.sheathed || o.action.kind === 'Sheathe' || o.action.kind === 'Draw';
/** The Direction a visible Fighter guards in: its Block's, or a Knockdown's guard. */
const guardOf = (a: Action): Direction | null => (a.kind === 'Block' ? a.direction : a.kind === 'Knockdown' ? a.guard : null);

/** murmur3's 32-bit finaliser: spreads nearby seeds (consecutive Ticks, Fighter indices) over the whole range. */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Besides its focus's, the AI defends against any enemy Attack from within this many times `ai.attackRange`. */
const THREAT_REACH = 2;
/** An enemy that swings or Kicks at it stays its focus for this many Ticks (3 s), however near the others. */
const AGGRO_TICKS = secondsToTicks(3);
/** It leaves its focus for another enemy only once that one is this much (m) nearer. */
const SWITCH_MARGIN = 1.5;

/** This Tick's generator for one Fighter's AI, derived from the Simulation's seeded generator in state. */
function tickRng(state: SimState, fighter: number): RngState {
  return createRng(mix32(state.rng.seed ^ Math.imul(fighter + 1, 0x9e3779b9)));
}

const ZERO: Vec2 = Object.freeze({ x: 0, z: 0 });
const NEUTRAL: Tactic = Object.freeze({ mode: 'Neutral', until: -1 });
const NO_STRAFE: Strafe = Object.freeze({ sign: 1, until: -1, flank: false, spacing: 0, still: false, pause: -1, hop: false });

function unit(v: Vec2): Vec2 {
  const d = Math.hypot(v.x, v.z);
  return d > 1e-9 ? { x: v.x / d, z: v.z / d } : ZERO;
}

/** `v` turned by `a` radians about the vertical (same sense as facing). */
const rotate = (v: Vec2, a: number): Vec2 => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), z: -v.x * Math.sin(a) + v.z * Math.cos(a) });

/** An ally (a teammate standing) as the AI sees it this Tick. */
interface Ally {
  readonly o: Sighting;
  readonly i: number;
}

/** What it sees of its team around its target this Tick (`teamView`). */
interface TeamView {
  readonly allies: readonly Ally[];
  /** The team on its target, itself included (each ally seen nearer it than any other enemy), by Fighter index, and its own place there. */
  readonly on: readonly number[];
  readonly rank: number;
  /** The bearing (radians, as a facing) from the target of its flank slot; null when it is alone on it. */
  readonly slot: number | null;
  /** An ally on its target is seen in Wind-up or Release. */
  readonly attacking: boolean;
  /** The target is seen facing an ally on it, not itself: its back is turned. */
  readonly exposed: boolean;
}

/** How its team lets it attack this Tick (`turnOf`): wait (another's turn, or an ally in its swing line), or swing at a turned back. */
interface Turn {
  readonly wait: boolean;
  readonly line: boolean;
  readonly back: boolean;
}
const FREE: Turn = Object.freeze({ wait: false, line: false, back: false });

/** An enemy as the AI sees it this Tick. */
interface Enemy {
  readonly o: Sighting;
  readonly i: number;
  readonly flat: number;
  readonly level: boolean;
  readonly dist: number;
  readonly near: boolean;
}

class AiController implements Controller {
  private readonly reactionTicks: number;
  /** The most Ticks late it may notice an Attack (`reactionJitter`): half its Reaction Time, at most JITTER_MAX, or 0 without the knob. */
  private readonly jitterTicks: number;
  private readonly skill: Skill;
  /** This Tick's generator (derived from state each call, never carried between Ticks). */
  private rng: RngState = createRng(0);
  /** Observations of every Fighter, oldest first; only the last reactionTicks + jitterTicks + 1 are kept. */
  private seen: Observation[] = [];
  private lastTick = -1;
  private defencePlan: DefencePlan | null = null;
  private feintPlan: FeintPlan | null = null;
  private attackPlan: AttackPlan | null = null;
  private throwPlan: ThrowPlan | null = null;
  private aimError = 0;
  private route: Route | null = null;
  private jumpRun: JumpRun | null = null;
  private failedJumps: readonly FailedJump[] = [];
  private landing: LandingRoll | null = null;
  private tactic: Tactic = NEUTRAL;
  private strafe: Strafe = NO_STRAFE;
  private opening: OpeningRoll | null = null;
  private lastHp = -1;
  private focus: Focus | null = null;
  private turn: boolean | null = null;
  private lineHold = -1;
  private beat: Beat | null = null;
  private jitter: Jitter | null = null;
  private shaken = -1;
  /** This Tick's view of its team around its target and the way to it (`decide` sets it; never carried between Ticks). */
  private view: { readonly team: TeamView; readonly toward: Vec2 } | null = null;

  constructor(
    private readonly tuning: TuningData,
    difficulty: AiDifficulty,
    style?: AiStyle,
  ) {
    this.reactionTicks = secondsToTicks(difficulty.reactionTime);
    this.skill = skillOf(tuning, difficulty, style);
    this.jitterTicks = this.skill.reactionJitter > 0 ? Math.min(JITTER_MAX, Math.max(1, Math.ceil(this.reactionTicks / 2))) : 0;
  }

  /** All of the Controller's memory, as plain data (observations and plans are immutable, so a shallow array copy is enough). */
  save(): AiMemory {
    const { seen, lastTick, defencePlan, feintPlan, attackPlan, throwPlan, aimError, route, jumpRun, failedJumps, landing, tactic, strafe, opening, lastHp, focus, turn, lineHold, beat, jitter, shaken } = this;
    return { seen: [...seen], lastTick, defencePlan, feintPlan, attackPlan, throwPlan, aimError, route, jumpRun, failedJumps, landing, tactic, strafe, opening, lastHp, focus, turn, lineHold, beat, jitter, shaken };
  }

  load(saved: unknown): void {
    const m = saved as AiMemory;
    this.seen = [...m.seen];
    this.lastTick = m.lastTick;
    this.defencePlan = m.defencePlan;
    this.feintPlan = m.feintPlan;
    this.attackPlan = m.attackPlan;
    this.throwPlan = m.throwPlan;
    this.aimError = m.aimError;
    this.route = m.route;
    this.jumpRun = m.jumpRun;
    this.failedJumps = m.failedJumps;
    this.landing = m.landing;
    this.tactic = m.tactic;
    this.strafe = m.strafe;
    this.opening = m.opening;
    this.lastHp = m.lastHp;
    this.focus = m.focus;
    this.turn = m.turn;
    this.lineHold = m.lineHold;
    this.beat = m.beat;
    this.jitter = m.jitter;
    this.shaken = m.shaken;
  }

  private random(): number {
    const [v, next] = nextFloat(this.rng);
    this.rng = next;
    return v;
  }

  /** True at chance `p`; never draws when `p` is 0 or 1, so a part of the repertoire left out costs no randomness. */
  private chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.random() < p;
  }

  private pick<T>(options: readonly T[]): T {
    return options[Math.min(options.length - 1, Math.floor(this.random() * options.length))]!;
  }

  private randomDirection(except?: Direction): Direction {
    return this.pick(DIRECTIONS.filter((d) => d !== except));
  }

  private forget(): void {
    this.defencePlan = null;
    this.feintPlan = null;
    this.attackPlan = null;
    this.throwPlan = null;
    this.route = null;
    this.opening = null;
    this.landing = null;
    // A Jump already in the air is carried through.
    if (this.jumpRun?.stage !== 'Fly') this.jumpRun = null;
  }

  private observe(state: SimState): void {
    if (state.tick <= this.lastTick) {
      // A new Duel: forget what was seen.
      this.seen = [];
      this.forget();
      this.jumpRun = null;
      this.failedJumps = [];
      this.tactic = NEUTRAL;
      this.strafe = NO_STRAFE;
      this.lastHp = -1;
      this.focus = null;
      this.turn = null;
      this.lineHold = -1;
      this.beat = null;
      this.jitter = null;
      this.shaken = -1;
    }
    this.lastTick = state.tick;
    const prev = this.seen[this.seen.length - 1];
    const fighters = state.fighters.map((o, i): Sighting => {
      const before = prev?.fighters[i];
      // An Attack Feint (a new Direction mid-Wind-up) is a new Attack to plan a defence for.
      const sameAttack = o.action.kind === 'Attack' && before?.action.kind === 'Attack' && before.action.direction === o.action.direction;
      const attackStart = o.action.kind !== 'Attack' ? null : sameAttack && before ? before.attackStart : state.tick;
      const velocity = before ? { x: o.position.x - before.position.x, z: o.position.z - before.position.z } : ZERO;
      const rise = before ? o.y - before.y : 0;
      const airStart = o.air === undefined ? null : before?.airborne && before.airStart !== null ? before.airStart : state.tick;
      const moving = velocity.x !== 0 || velocity.z !== 0;
      return {
        position: o.position,
        y: o.y,
        velocity,
        rise,
        action: o.action,
        motionTick: o.motion.tick,
        crouch: o.crouch,
        airborne: o.air !== undefined,
        hp: o.hp,
        weapon: o.weapon,
        team: o.team,
        fallen: !inDuel(o),
        facing: o.facing,
        pitch: o.pitch,
        moving,
        attackStart,
        airStart,
        sheathed: o.sheathed,
      };
    });
    this.seen.push({ tick: state.tick, fighters });
    if (this.seen.length > this.reactionTicks + this.jitterTicks + 1) this.seen.shift();
  }

  /** How far (m) a Fighter with `weapon` reaches with a swing: `ai.attackRange` for the default Weapon, more for a longer one. */
  private reach(weapon: string): number {
    const { attackRange } = this.tuning.ai;
    return attackRange + weaponByName(this.tuning, weapon).length - weaponByName(this.tuning, defaultWeaponName(this.tuning)).length;
  }

  /**
   * Acts on everyone as seen Reaction Time ago: it defends against the nearest
   * enemy Attack that can reach it (its focus's, or any from within
   * THREAT_REACH × `ai.attackRange`, on its level), else closes on and fights its focus
   * (`chooseFocus`; nearest in 3D; ranges are measured flat). Teammates it ignores.
   */
  intent(state: SimState, fighter: number): Intent {
    this.rng = tickRng(state, fighter);
    this.view = null;
    this.observe(state);
    const self = state.fighters[fighter]!;
    return this.flying(state, self, this.holdingJump(state.tick, self, this.keepClear(state.tick, self, this.decide(state, fighter))));
  }

  /**
   * Played as one of a team (its Attack's roll, or for a Chamber its next one's), it never lets a Wind-up go with an ally
   * in its swing line (for the Wind-up's Direction), whichever plan pressed it: it holds the Wind-up for LINE_HOLD Ticks (until the ally stands
   * LINE_SLACK clear beyond the line), then Feints into a Block.
   */
  private keepClear(tick: number, self: FighterState, intent: Intent): Intent {
    const a = self.action;
    if (a.kind !== 'Attack' || a.phase !== 'Wind-up') {
      this.lineHold = -1;
      return intent;
    }
    const v = this.view;
    if (!v || self.air || intent.block || !(this.attackPlan?.team ?? this.turn)) return intent;
    const holding = this.lineHold >= 0;
    const reach = this.reach(self.weapon) + (a.direction === 'Thrust' ? THRUST_REACH : 0) + (holding ? LINE_SLACK : 0);
    if (!this.allyInLine(self, v.team, v.toward, reach, a.direction)) return intent;
    if (!holding) this.lineHold = tick + LINE_HOLD;
    return tick < this.lineHold ? { ...intent, attack: true, direction: a.direction } : { ...intent, attack: false, block: true, direction: a.direction };
  }

  /**
   * The Observation it acts on this Tick: everyone as seen Reaction Time ago, or null before it has seen that far back. With
   * `reactionJitter`, each enemy Attack it sees coming (newer than any it rolled for) is rolled once to be noticed late, by 1
   * to `jitterTicks` Ticks: until then it acts on what it saw the Tick before it noticed it, as if nothing had changed.
   */
  private sight(state: SimState, fighter: number): Observation | null {
    if (this.jitterTicks === 0) {
      const seen = this.seen[0];
      return seen && seen.tick === state.tick - this.reactionTicks ? seen : null;
    }
    const now = this.seen.find((o) => o.tick === state.tick - this.reactionTicks);
    if (!now) return null;
    const self = state.fighters[fighter]!;
    const reach = THREAT_REACH * this.tuning.ai.attackRange;
    let newest = -1;
    now.fighters.forEach((o, i) => {
      if (i === fighter || o.fallen || o.team === self.team || !isThreat(o.action) || o.attackStart === null || Math.abs(o.y - self.y) >= DEFEND_LEVEL) return;
      if (Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z) <= reach) newest = Math.max(newest, o.attackStart);
    });
    if (newest >= 0 && newest > (this.jitter?.from ?? -1)) {
      const late = this.chance(this.skill.reactionJitter) ? 1 + Math.floor(this.random() * this.jitterTicks) : 0;
      this.jitter = { from: newest, until: state.tick + late, at: now.tick - 1 };
    }
    const j = this.jitter;
    if (!j || state.tick >= j.until) return now;
    return this.seen.find((o) => o.tick === j.at) ?? now;
  }

  /** What it would do this Tick, before a Jump it is in the air on has its say (`flying`). */
  private decide(state: SimState, fighter: number): Intent {
    const seen = this.sight(state, fighter);
    if (!seen) return IDLE_INTENT;

    const self = state.fighters[fighter]!;
    const enemies = seen.fighters
      .map((o, i) => ({ o, i, flat: Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z), level: Math.abs(o.y - self.y) < LEVEL }))
      .map((e) => ({ ...e, dist: Math.hypot(e.flat, e.o.y - self.y), near: Math.abs(e.o.y - self.y) < DEFEND_LEVEL }))
      .filter(({ o, i }) => i !== fighter && !o.fallen && o.team !== self.team)
      .sort((a, b) => a.dist - b.dist || a.i - b.i);
    const nearest = enemies[0];
    if (!nearest) {
      this.forget();
      this.focus = null;
      return IDLE_INTENT;
    }
    const aimAt = (o: Sighting, flat: number): Intent => ({ ...IDLE_INTENT, face: Math.atan2(o.position.x - self.position.x, o.position.z - self.position.z), pitch: this.aim(self, o, flat) });

    const reach = THREAT_REACH * this.tuning.ai.attackRange;
    // Its allies as seen (only with `teamwork`: without it, it never looks at them).
    const allies: Ally[] = this.skill.teamwork > 0 ? seen.fighters.map((o, i) => ({ o, i })).filter(({ o, i }) => i !== fighter && !o.fallen && o.team === self.team) : [];
    const focused = this.chooseFocus(state, self, fighter, enemies, reach, allies);

    this.think(state.tick, self, focused.o);
    const team = allies.length > 0 ? this.teamView(self, fighter, focused, enemies, allies) : null;
    if (team) this.view = { team, toward: unit({ x: focused.o.position.x - self.position.x, z: focused.o.position.z - self.position.z }) };

    const threat = enemies.find(({ o, i, flat, near }) => near && isThreat(o.action) && o.attackStart !== null && (i === focused.i || flat <= reach));
    if (threat && isThreat(threat.o.action) && threat.o.attackStart !== null) {
      this.feintPlan = null;
      return this.defend(state, self, threat.i, threat.o, threat.flat, aimAt(threat.o, threat.flat), team);
    }
    this.defencePlan = null;

    // A dagger coming: face the thrower and Block it (raised after the throw began, or it does not count).
    const dodge = this.dodgeThrow(state, self, enemies, aimAt);
    if (dodge) {
      this.feintPlan = null;
      return dodge;
    }

    // A Kick coming: stand still (it only knocks down a mover), and do not start anything else.
    const kickReach = this.tuning.ai.kickRange;
    if (enemies.some(({ o, flat, level }) => level && isKickThreat(o.action) && flat <= kickReach)) {
      this.feintPlan = null;
      return aimAt(focused.o, focused.flat);
    }

    const { o: target, i: targetIndex, flat: dist, level } = focused;
    const base = aimAt(target, dist);
    const toward: Vec2 = dist > 0 ? { x: (target.position.x - self.position.x) / dist, z: (target.position.z - self.position.z) / dist } : ZERO;
    const away: Vec2 = { x: -toward.x, z: -toward.z };
    const feint = this.feint(state.tick, self.action, base);
    if (feint) return feint;

    switch (self.action.kind) {
      case 'Attack':
        return this.pressOn(state, self, target, dist, toward, base, team);
      case 'Fall':
        // In the air with nothing to swing: keep the line it leapt on.
        return { ...base, move: self.air ? unit({ x: self.air.vx, z: self.air.vz }) : ZERO };
      case 'Stagger':
        // Its Attack was Blocked: shuffle back out of reach through the recoil, if it is minded to.
        if (self.action.cause === 'Blocked' && (this.skill.caution > 0 || this.skill.footwork > 0)) return { ...base, move: this.safeMove(state, self, away) };
        return base;
      case 'Idle':
        break;
      case 'Throw':
        // Its dagger still in the hand: keep the aim on the target as it moves.
        return level ? { ...base, ...this.throwAim(self, target, dist) } : base;
      default:
        return base; // let go of a Block; finish what it is doing
    }

    // An enemy in the air coming down on its level: meet the Landing.
    const meet = this.meetLanding(state, self, target, targetIndex, seen.tick, base);
    if (meet) return meet;

    // Disengaging from an enemy on another level (it got away up there, or the enemy did): hold its ground.
    if (!level && this.tactic.mode === 'Disengage' && !this.jumpRun && !target.airborne) return base;

    // An enemy on lower ground in reach of a jumping Attack: leap down at it.
    const below = target.y < self.y - LEVEL && (target.action.kind === 'Idle' || target.action.kind === 'Block');
    if (below && !this.jumpRun && dist <= this.reach(self.weapon) + this.leapRange() && this.chance(this.skill.jumpAttackRate)) {
      const leap = this.leap(state, self, target, dist, toward, base);
      if (leap) return leap;
    }

    if (!level || this.jumpRun || this.jumpFirst(state, self, target)) {
      // Another level, or a Jump on the way: find the way there, looking where it walks (and starting nothing on the way).
      const way = this.approach(state, self, target);
      const { move } = way;
      return { ...IDLE_INTENT, ...way, face: move.x === 0 && move.z === 0 ? base.face : Math.atan2(move.x, move.z) };
    }

    // A Chain it held through Recovery: the next Attack starts now.
    const chained = this.attackPlan;
    if (chained?.chain && chained.chainHeld) return this.startAttack(state.tick, self, target, dist, base, { direction: chained.chain });
    this.attackPlan = null;

    const kick = this.kick(state, target, dist, toward);
    if (kick) return { ...base, kick: true };

    if (this.toss(state, self, target, dist, toward)) return { ...base, ...this.throwAim(self, target, dist), throw: true };

    const myReach = this.reach(self.weapon);
    const theirReach = this.reach(target.weapon);
    const turn = this.turnOf(state.tick, self, team, toward, myReach);
    // Taking turns, it presses as often in its own window as the team would between them.
    const turns = this.turn === true && team !== null ? team.on.length : 1;
    const aggression = this.skill.aggression * turns * (this.tactic.mode === 'Pressure' ? 2.5 : this.tactic.mode === 'Disengage' ? 0.2 : 1);

    if (this.skill.aggression > 0 && level) {
      // Its own Weapon Sheathed (it took over a Sheathed Fighter): Draw it (pressing attack Draws) once the enemy is near.
      if (self.sheathed && dist <= Math.max(myReach, theirReach) + SWING_IN + 1.5) return { ...base, attack: true, direction: 'Overhead' };
      // An enemy who cannot Block: no spacing or Feints, close in and swing (rolled once, like an opening, at `punish`).
      if (defenceless(target) && !turn.line && this.goesFor(targetIndex, seen.tick)) {
        if (dist <= myReach) return this.startAttack(state.tick, self, target, dist, base);
        if (dist <= myReach + SWING_IN) return this.startAttack(state.tick, self, target, dist, { ...base, move: toward }, { swingIn: true });
        return { ...base, ...this.approach(state, self, target) };
      }
    }

    // An opening, near enough to step in on: punish it (unless the AI never attacks, aggression 0).
    if (this.skill.aggression > 0 && isOpening(target.action) && dist <= myReach + SWING_IN && !turn.line && this.goesFor(targetIndex, seen.tick)) {
      const punish = { ...base, move: dist > myReach ? toward : ZERO };
      if (!this.opening!.fits) return this.startAttack(state.tick, self, target, dist, punish, { swingIn: dist > myReach });
      // Only an opening its own Wind-up Releases inside; else space out, out of the counter.
      const direction = this.chooseDirection(self, target, dist, this.narrowLine(self));
      if (this.landsInTime(self, target, dist, direction)) return this.startAttack(state.tick, self, target, dist, punish, { swingIn: dist > myReach, direction });
      return { ...base, move: this.footwork(state, self, dist, toward, myReach, theirReach, team) };
    }

    // Its target's back turned on an ally: swing at it now (stepping in, if need be).
    if (turn.back && this.skill.aggression > 0 && level && dist <= myReach + SWING_IN) {
      return this.startAttack(state.tick, self, target, dist, dist > myReach ? { ...base, move: toward } : base, { swingIn: dist > myReach });
    }

    if (this.skill.footwork <= 0) {
      // The plain AI: walk straight in, attack in range, back off when crowded.
      if (dist > myReach) {
        // Mistimed Attack: swinging from out of range.
        if (!turn.wait && this.chance(aggression * this.skill.mistakeRate)) return this.startAttack(state.tick, self, target, dist, base);
        return { ...base, ...this.approach(state, self, target) };
      }
      if (dist < this.tuning.ai.retreatRange) return { ...base, move: this.retreat(state, self, away) };
      if (!turn.wait && this.chance(aggression)) return this.startAttack(state.tick, self, target, dist, base);
      return base;
    }

    // A hop to reposition: out of a pincer, round to its flank slot, or to its spacing.
    const hop = this.hopStep(state, self, enemies, focused, team, base);
    if (hop) return hop;

    // Far off: close in along the navmesh.
    const longer = Math.max(myReach, theirReach);
    if (dist > longer + SWING_IN + 1.5) return { ...base, ...this.approach(state, self, target) };

    // Meet an opponent walking into reach with an Attack already on the way.
    const closing = -(target.velocity.x * toward.x + target.velocity.z * toward.z) / (this.tuning.fighter.walkSpeed * TICK_SECONDS);
    if (target.action.kind === 'Idle' && closing > 0.5 && dist > myReach && dist <= myReach + SWING_IN && !turn.wait && this.chance(this.skill.preempt * 0.3)) {
      return this.startAttack(state.tick, self, target, dist, base, { swingIn: true });
    }

    // Leap in with an Overhead from out of reach.
    const notBusy = target.action.kind === 'Idle' || target.action.kind === 'Block';
    if (!self.air && notBusy && dist >= myReach + JUMP_FROM && dist <= myReach + this.leapRange() && !turn.wait && this.chance(this.skill.jumpAttackRate * (this.tactic.mode === 'Disengage' ? 0.2 : 1))) {
      const leap = this.leap(state, self, target, dist, toward, base);
      if (leap) return leap;
    }

    // Disengaging near a jump Link away from its enemy: take it, onto ground the enemy must Jump after it to.
    if (this.tactic.mode === 'Disengage' && !self.air && !this.jumpRun && this.skill.jumpEscapeRate > 0) {
      const escape = this.escapeLink(state, self, target);
      if (escape !== null && this.chance(this.skill.jumpEscapeRate)) {
        const link = navMesh(arenaOf(this.tuning, state.arena), this.tuning).links[escape] as JumpLink;
        this.jumpRun = this.newJumpRun(state.tick, self, escape, link, true);
        const way = this.takeJump(state, self, escape, link);
        return { ...base, ...way, face: Math.atan2(way.move.x, way.move.z) };
      }
    }

    // Disengaging and crowded: hop back out of reach.
    if (this.tactic.mode === 'Disengage' && !self.air && dist < theirReach + 0.2 && notBusy && this.chance(this.skill.jumpAttackRate * 0.5)) {
      if (jumpIsSafe(arenaOf(this.tuning, state.arena), this.tuning, { at: self.position, y: self.y, heading: away, holdTicks: 0 })) return { ...base, move: away, jump: true };
    }

    // From its spacing: step in and swing (or swing from where it stands, in reach), on its beat (`rhythm`) or at a coin flip every Tick.
    if (!turn.wait) {
      const beat = this.skill.rhythm > 0 ? this.beatOf() : null;
      if (beat?.timed) {
        // The pace the coin flip would press at here: its aggression in reach, less stepping in, none beyond.
        const pace = dist <= myReach ? aggression : dist <= myReach + SWING_IN ? aggression * 0.6 : 0;
        const done = beat.done + pace;
        this.beat = { ...beat, done };
        // Its beat come, it swings (only this uses the beat up: an Attack for another reason keeps the pace it has spent).
        if (done >= beat.need && (pace > 0 || (beat.wild && this.chance(aggression)))) {
          this.beat = null;
          if (dist <= myReach) return this.startAttack(state.tick, self, target, dist, base, { double: beat.double });
          if (dist <= myReach + SWING_IN) return this.startAttack(state.tick, self, target, dist, { ...base, move: toward }, { swingIn: true, double: beat.double });
          return this.startAttack(state.tick, self, target, dist, base);
        }
      } else {
        if (dist <= myReach && this.chance(aggression)) return this.startAttack(state.tick, self, target, dist, base);
        if (dist <= myReach + SWING_IN && this.chance(aggression * 0.6)) return this.startAttack(state.tick, self, target, dist, { ...base, move: toward }, { swingIn: true });
        if (dist > myReach + SWING_IN && this.chance(aggression * this.skill.mistakeRate)) return this.startAttack(state.tick, self, target, dist, base);
      }
    }

    return { ...base, move: this.footwork(state, self, dist, toward, myReach, theirReach, team) };
  }

  /** Once a Tick: notice being hit, and pick its tactic (and circling side) as the old one runs out. */
  /**
   * The enemy it fights (`enemies` nearest first, never empty): one that swings or Kicks at it from within `reach`
   * becomes its focus for AGGRO_TICKS (the nearest such, if several); else it keeps its focus while that enemy is
   * standing and no other is SWITCH_MARGIN nearer, and otherwise takes its nearest. With `allies` and more than one
   * enemy, it rolls as it picks a new one (`teamwork`) to spread out: it takes the enemy its allies leave free
   * (`spreadPick`) instead of the nearest, and keeps it while none is SWITCH_MARGIN nearer than that one.
   */
  private chooseFocus(state: SimState, self: FighterState, fighter: number, enemies: readonly Enemy[], reach: number, allies: readonly Ally[]): Enemy {
    const tick = state.tick;
    const spread = this.focus?.spread ?? false;
    const attacker = enemies.find(({ o, flat, near }) => near && flat <= reach && (isThreat(o.action) || isKickThreat(o.action)) && this.aimedAt(o, self));
    if (attacker) {
      this.focus = { fighter: attacker.i, until: tick + AGGRO_TICKS, spread };
      return attacker;
    }
    const nearest = enemies[0]!;
    const pick = spread ? this.spreadPick(state, self, fighter, enemies, allies) : nearest;
    const kept = this.focus && enemies.find(({ i }) => i === this.focus!.fighter);
    if (kept && (tick < this.focus!.until || kept.dist <= pick.dist + SWITCH_MARGIN)) return kept;
    const go = allies.length > 0 && enemies.length > 1 && this.chance(this.skill.teamwork);
    const chosen = go ? this.spreadPick(state, self, fighter, enemies, allies) : nearest;
    this.focus = { fighter: chosen.i, until: -1, spread: go };
    return chosen;
  }

  /**
   * The enemy to fight spreading out: its team (itself and `allies`, as seen) is shared out over `enemies` in Fighter-index
   * order, each taking, of the enemies within SPREAD_RANGE of its nearest, the one the fewest before it took (nearest
   * first on a tie). An enemy below LOW_HP of its max HP (its HP bar shows it), or the last standing, counts as free
   * however many took it. The same sharing for every one of the team, so each takes its own.
   */
  private spreadPick(state: SimState, self: FighterState, fighter: number, enemies: readonly Enemy[], allies: readonly Ally[]): Enemy {
    const free = (e: Enemy) => enemies.length === 1 || e.o.hp < LOW_HP * state.fighters[e.i]!.maxHp;
    const taken = new Map<number, number>();
    const load = (e: Enemy) => (free(e) ? 0 : (taken.get(e.i) ?? 0));
    const members = [...allies.map(({ o, i }) => ({ i, at: o.position, y: o.y })), { i: fighter, at: self.position, y: self.y }].sort((a, b) => a.i - b.i);
    for (const m of members) {
      const near = enemies.map((e) => ({ e, d: Math.hypot(e.o.position.x - m.at.x, e.o.position.z - m.at.z, e.o.y - m.y) }));
      const closest = Math.min(...near.map((n) => n.d));
      const best = near.filter((n) => n.d <= closest + SPREAD_RANGE).sort((a, b) => load(a.e) - load(b.e) || a.d - b.d || a.e.i - b.e.i)[0]!.e;
      if (m.i === fighter) return best;
      taken.set(best.i, (taken.get(best.i) ?? 0) + 1);
    }
    return enemies[0]!;
  }

  /**
   * Its team around `focused` as seen: the allies on it (each nearer it than any other enemy, in 3D, the lower index
   * on a tie), its own flank slot among them (FLANKS, ranked by Fighter index, about the mean bearing of the team from
   * the target), whether an ally on it is seen swinging, and whether the target faces one of them and not itself.
   */
  private teamView(self: FighterState, fighter: number, focused: Enemy, enemies: readonly Enemy[], allies: readonly Ally[]): TeamView {
    const t = focused.o;
    const nearestEnemy = (o: Sighting) => {
      let best = -1;
      let bestDist = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.o.position.x - o.position.x, e.o.position.z - o.position.z, e.o.y - o.y);
        if (d < bestDist) [best, bestDist] = [e.i, d];
      }
      return best;
    };
    const onIt = allies.filter(({ o }) => nearestEnemy(o) === focused.i);
    const on = [fighter, ...onIt.map(({ i }) => i)].sort((a, b) => a - b);
    const rank = on.indexOf(fighter);
    let slot: number | null = null;
    if (on.length > 1) {
      const bearings = [self.position, ...onIt.map(({ o }) => o.position)].map((p) => Math.atan2(p.x - t.position.x, p.z - t.position.z));
      const mean = Math.atan2(bearings.reduce((a, b) => a + Math.sin(b), 0), bearings.reduce((a, b) => a + Math.cos(b), 0));
      slot = mean + FLANKS[on.length]![rank]!;
    }
    const attacking = onIt.some(({ o }) => isThreat(o.action));
    const exposed = onIt.some(({ o }) => this.aimedAt(t, o)) && !this.aimedAt(t, self);
    return { allies, on, rank, slot, attacking, exposed };
  }

  /**
   * Whether its team lets it start an Attack this Tick. With allies standing, it rolls (`teamRoll`) to play its next
   * Attack as one of a team: then
   * it waits while an ally is in its swing line or an ally on its target is seen swinging; swings at once at a back
   * turned on an ally; and otherwise starts one from its spacing only in its own turn window (TURN_TICKS).
   */
  private turnOf(tick: number, self: FighterState, team: TeamView | null, toward: Vec2, myReach: number): Turn {
    if (!team || !this.teamRoll()) return FREE;
    const line = this.allyInLine(self, team, toward, myReach);
    const n = team.on.length;
    if (line) return { wait: true, line: true, back: false };
    if (team.attacking) return { wait: true, line: false, back: false };
    if (team.exposed) return { wait: false, line: false, back: true };
    const mine = n < 2 || (tick % TURN_TICKS < TURN_OPEN && Math.floor(tick / TURN_TICKS) % n === team.rank);
    return mine ? FREE : { wait: true, line: false, back: false };
  }

  /** Played as one of a team with an ally beside its line (where a Left or Right would sweep), it cuts along the line (an Overhead or a Thrust), not across it. */
  private narrowLine(self: FighterState): boolean {
    const v = this.view;
    return this.turn === true && v !== null && this.allyInLine(self, v.team, v.toward, this.reach(self.weapon), 'Left');
  }

  /** Whether it plays its next Attack as one of a team: rolled at `teamwork` (once, kept in `turn` until it starts one). Only asked with allies standing. */
  private teamRoll(): boolean {
    if (this.turn === null) this.turn = this.chance(this.skill.teamwork);
    return this.turn;
  }

  /**
   * Whether an ally (where it is by now, carrying on as seen, or where it was seen: it may have stopped or turned back
   * since) stands where its blade would sweep in `direction` (any Direction: the narrowest, an Overhead's): within
   * LINE_MARGIN beyond `myReach`, and LINE_WIDE (a Left or Right, LINE_CLOSE for an ally within CROWD) or LINE_NARROW
   * (an Overhead or a Thrust, LINE_WIDE for an ally within CROWD: that close, one step puts it in the blade's way) of
   * the line `toward` its target.
   */
  private allyInLine(self: FighterState, team: TeamView, toward: Vec2, myReach: number, direction?: Direction): boolean {
    const sweeps = direction === 'Left' || direction === 'Right';
    const inLine = (x: number, z: number) => {
      const d = Math.hypot(x, z);
      const cos = Math.cos(d < CROWD ? (sweeps ? LINE_CLOSE : LINE_WIDE) : sweeps ? LINE_WIDE : LINE_NARROW);
      return d <= myReach + LINE_MARGIN && (d < 1e-6 || (x * toward.x + z * toward.z) / d > cos);
    };
    return team.allies.some(({ o }) => {
      const x = o.position.x - self.position.x;
      const z = o.position.z - self.position.z;
      return inLine(x + o.velocity.x * this.reactionTicks, z + o.velocity.z * this.reactionTicks) || inLine(x, z);
    });
  }

  private think(tick: number, self: FighterState, target: Sighting): void {
    const { caution, pressure, footwork } = this.skill;
    const hurt = this.lastHp >= 0 && self.hp < this.lastHp;
    this.lastHp = self.hp;
    // Just hit, or in its own Recovery: shaken, it lapses more readily for a while.
    if (this.skill.humanMistakes > 0 && (hurt || (self.action.kind === 'Attack' && self.action.phase === 'Recovery'))) this.shaken = tick + LAPSE_TICKS;
    if (hurt && this.chance(caution)) {
      this.tactic = { mode: 'Disengage', until: tick + 40 + Math.floor(this.random() * 50) };
    } else if (tick >= this.tactic.until && (pressure > 0 || caution > 0)) {
      const max = self.maxHp;
      const ahead = (self.hp - target.hp) / max;
      const press = Math.min(1, Math.max(0, pressure * (0.7 + ahead * 1.5)));
      const back = caution * (self.hp < 0.35 * max ? 0.45 : 0.08);
      const r = this.random();
      const mode: Mode = r < press ? 'Pressure' : r < press + back ? 'Disengage' : 'Neutral';
      this.tactic = { mode, until: tick + 60 + Math.floor(this.random() * 120) };
    }
    if (footwork > 0 && tick >= this.strafe.until) {
      const sign = this.random() < 0.5 ? 1 : -1;
      const until = tick + 40 + Math.floor(this.random() * 100);
      const flank = this.chance(this.skill.teamwork);
      this.strafe = { sign, until, flank, ...this.idleLife(tick), hop: this.chance(this.skill.jumpStep) };
    }
  }

  /** Idle life for its next while of circling (`idleLife`, rolled with the side): a spacing of its own, maybe no circling, maybe a short pause first. */
  private idleLife(tick: number): Pick<Strafe, 'spacing' | 'still' | 'pause'> {
    if (!this.chance(this.skill.idleLife)) return { spacing: 0, still: false, pause: -1 };
    const spacing = this.random() * (SPACING_IN + SPACING_OUT) - SPACING_IN;
    const still = this.random() < LIFE_STILL;
    const pause = this.random() < LIFE_PAUSE ? tick + PAUSE_TICKS + Math.floor(this.random() * (PAUSE_TICKS + 1)) : -1;
    return { spacing, still, pause };
  }

  /**
   * When its next Attack from its spacing comes (`rhythm`, rolled once per Attack): the pace it needs, bell-shaped about
   * the coin flip's mean wait (BEAT_ROLLS uniforms), now and then with a pause first (BEAT_PAUSE), or as a double threat
   * (BEAT_DOUBLE); whether it swings from out of reach when it comes is the mistake. Not timed, the coin flip it was.
   */
  private beatOf(): Beat {
    if (this.beat) return this.beat;
    if (!this.chance(this.skill.rhythm)) return (this.beat = { timed: false, need: 0, done: 0, double: false, wild: false });
    let sum = 0;
    for (let k = 0; k < BEAT_ROLLS; k++) sum += this.random();
    let need = (sum / BEAT_ROLLS) * 2 * BEAT;
    if (this.random() < BEAT_PAUSE) need += BEAT * (1 + this.random());
    const double = this.random() < BEAT_DOUBLE;
    return (this.beat = { timed: true, need, done: 0, double, wild: this.chance(this.skill.mistakeRate) });
  }

  /** Whether to go for the opening it sees on `fighter` (rolled once per opening, at `punish`). */
  private goesFor(fighter: number, seenTick: number): boolean {
    const o = this.opening;
    const same = o && o.fighter === fighter && o.seen >= seenTick - 1;
    const go = same ? o.go : this.chance(this.skill.punish);
    const fits = same ? o.fits : this.chance(this.skill.punishFits);
    this.opening = { fighter, seen: seenTick, go, fits };
    return go;
  }

  /**
   * Whether its own Attack in `direction` on `target`'s opening, pressed now (stepping in first if `dist` is beyond its
   * reach), Releases before the opening ends (`openingLeft`). The ends are counted as it saw the opening, Reaction Time
   * ago: the opponent needs as long to see its Wind-up coming as it took to see the opening.
   */
  private landsInTime(self: FighterState, target: Sighting, dist: number, direction: Direction): boolean {
    const { windUpEnd } = attackTimings(this.tuning, self.weapon, direction);
    const walk = Math.ceil(Math.max(0, dist - this.reach(self.weapon)) / (this.tuning.fighter.walkSpeed * TICK_SECONDS));
    return Math.max(windUpEnd, walk) <= this.openingLeft(target);
  }

  /** Ticks `o`, as seen, has left of its opening before it can act again, as its playhead shows (a Knockdown: long enough). */
  private openingLeft(o: Sighting): number {
    const a = o.action;
    if (a.kind === 'Attack') return attackTimings(this.tuning, o.weapon, a.direction).end - (a.chain?.tick ?? o.motionTick);
    if (a.kind === 'Kick') return kickTimings(this.tuning, o.weapon).end - o.motionTick + (a.landed ? 0 : (a.whiff ?? this.tuning.kick.whiffRecovery));
    if (a.kind === 'Stagger') {
      const motion = weaponMotion(this.tuning, o.weapon, staggerMotionName(this.tuning, o.weapon, a.cause, a.from));
      return (motion ? secondsToTicks(motion.duration) : 0) - o.motionTick;
    }
    return Infinity;
  }

  /**
   * Where to stand, circling: hovering at its spacing for the tactic, along the side it circles, never stepping somewhere
   * unsafe. Rolled to take a flank slot (`Strafe.flank`) with `team` on its target, it circles to its slot and stops
   * there instead, and it steers clear of any ally within CROWD.
   */
  private footwork(state: SimState, self: FighterState, dist: number, toward: Vec2, myReach: number, theirReach: number, team: TeamView | null = null): Vec2 {
    const { mode } = this.tactic;
    const spacing = this.spacing(myReach, theirReach);
    // Idle life: a short pause, out of their reach.
    if (mode === 'Neutral' && state.tick < this.strafe.pause && dist > theirReach) return ZERO;
    const radial = Math.max(-1, Math.min(1, (dist - spacing) * 2.5));
    let side = this.strafe.still ? 0 : this.strafe.sign * this.skill.footwork * (mode === 'Pressure' ? 0.5 : 1);
    const tangent = (s: number): Vec2 => ({ x: -toward.z * s, z: toward.x * s });
    const flank = team !== null && this.strafe.flank;
    if (flank && team.slot !== null) {
      // To its slot: a positive side turns its bearing from the target up.
      const off = team.slot - Math.atan2(-toward.x, -toward.z);
      side = Math.max(-1, Math.min(1, Math.atan2(Math.sin(off), Math.cos(off)) * 2));
      if (side !== 0 && !this.safe(state, self, unit(tangent(side)))) side = 0;
    } else if (side !== 0 && !this.safe(state, self, unit(tangent(side)))) {
      side = -side;
      this.strafe = { ...this.strafe, sign: -this.strafe.sign };
    }
    const t = tangent(side);
    const m = { x: toward.x * radial + t.x, z: toward.z * radial + t.z };
    if (flank) {
      for (const { o } of team.allies) {
        const dx = self.position.x - o.position.x;
        const dz = self.position.z - o.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-6 && d < CROWD) {
          m.x += (dx / d) * (1 - d / CROWD) * 2;
          m.z += (dz / d) * (1 - d / CROWD) * 2;
        }
      }
    }
    const len = Math.hypot(m.x, m.z);
    if (len < 0.15) return ZERO;
    return this.safeMove(state, self, len > 1 ? { x: m.x / len, z: m.z / len } : m);
  }

  /** How far (m) from its target it hovers, for its tactic (and in Neutral, its idle life's spacing). */
  private spacing(myReach: number, theirReach: number): number {
    const { mode } = this.tactic;
    const longer = Math.max(myReach, theirReach);
    // Outreached by its own Weapon, it stands in its reach and out of theirs; else just outside the longer reach.
    const poke = myReach > theirReach + 0.2 ? myReach - 0.1 : longer + HOVER_MARGIN;
    if (mode === 'Pressure') return (this.tuning.ai.retreatRange + myReach) / 2;
    return mode === 'Disengage' ? longer + DISENGAGE_MARGIN : this.strafe.spacing === 0 ? poke : poke + this.strafe.spacing;
  }

  /** Where it pitches its look: at the chest of `o` (lower when it crouches, the floor when it lies in a Knockdown), so its blows reach it. */
  private aim(self: FighterState, o: Sighting, flat: number): number {
    const crouchDrop = this.tuning.fighter.crouchDepth / this.tuning.fighter.height;
    const theirs = o.action.kind === 'Knockdown' ? LYING_AIM : AIM_HEIGHT * (1 - crouchDrop * o.crouch);
    const mine = AIM_HEIGHT * (1 - crouchDrop * self.crouch);
    return Math.atan2(o.y + theirs - (self.y + mine), Math.max(flat, 0.5));
  }

  /**
   * Its route to `target` (Links, from where it stands), re-planned when either changes surface or every REPATH_TICKS;
   * null when they share a Walk Surface, either is off the navmesh, it is in the air, or there is no way. It follows jump
   * Links held no longer than its `jumpNav` (none while Slowed, as a Slowed Jump falls short), except one it just gave up on.
   */
  private routeTo(state: SimState, self: FighterState, target: Sighting): readonly number[] | null {
    const arena = arenaOf(this.tuning, state.arena);
    const me = { x: self.position.x, z: self.position.z, y: self.y };
    const it = { x: target.position.x, z: target.position.z, y: target.y };
    const from = navPolygon(arena, this.tuning, me);
    const to = navPolygon(arena, this.tuning, it);
    if (from < 0 || to < 0 || from === to || self.air) {
      if (from === to) this.route = null;
      return null;
    }
    const r = this.route;
    if (!r || r.from !== from || r.to !== to || state.tick - r.at >= REPATH_TICKS) {
      this.failedJumps = this.failedJumps.filter((f) => state.tick - f.at < JUMP_RETRY);
      const { jumpNav } = this.skill;
      const options: PathOptions = { jumps: jumpNav >= 0 && !self.slow, maxJumpHold: jumpNav, exclude: this.failedJumps.map((f) => f.link) };
      this.route = { from, to, at: state.tick, links: findPath(arena, this.tuning, me, it, options) };
    }
    return this.route!.links;
  }

  /** Whether the next Link of its route to `target` is a jump Link. */
  private jumpFirst(state: SimState, self: FighterState, target: Sighting): boolean {
    const first = this.routeTo(state, self, target)?.[0];
    return first !== undefined && navMesh(arenaOf(this.tuning, state.arena), this.tuning).links[first]!.kind === 'jump';
  }

  /**
   * Which way to walk to `target` (and when to Jump): straight at it on the same Walk Surface (or off the navmesh),
   * else towards the next corner of its route there, or through the jump Link its route takes next (`takeJump`); with
   * no way there, as near as it safely can.
   */
  private approach(state: SimState, self: FighterState, target: Sighting): Pick<Intent, 'move' | 'jump' | 'jumpHeld'> {
    const arena = arenaOf(this.tuning, state.arena);
    const run = this.jumpRun;
    if (run?.escape && run.stage !== 'Fly') return this.takeJump(state, self, run.link, navMesh(arena, this.tuning).links[run.link] as JumpLink);
    const links = this.routeTo(state, self, target);
    const first = links?.[0] === undefined ? undefined : navMesh(arena, this.tuning).links[links[0]]!;
    if (first?.kind === 'jump') {
      // Its enemy in the air may be on its way here: wait to see where it lands, rather than both taking the Links at once
      // and swapping levels, again and again. The wait does not count against the run.
      if (target.airborne) {
        if (run && run.link === links![0]) this.jumpRun = { ...run, deadline: run.deadline + 1 };
        return { move: ZERO };
      }
      return this.takeJump(state, self, links![0]!, first);
    }
    if (this.jumpRun?.stage !== 'Fly') this.jumpRun = null;
    const goal = links ? steer(arena, this.tuning, links, self.position, target.position) : target.position;
    const move = unit({ x: goal.x - self.position.x, z: goal.z - self.position.z });
    // No way there it can take: go as near as it safely can, never off a ledge or into Lava or Water.
    return { move: this.route && !this.route.links ? this.safeMove(state, self, move) : move };
  }

  /**
   * Carry out jump Link `id` (`link`): walk to the run-up point RUNUP behind its takeoff, then run in along its heading
   * and press Jump as it reaches the takeoff (holding it while it flies: `flying`). Pushed off the line (or past the
   * takeoff), it lines up again; not airborne in time, it gives up on the Link (`giveUpJump`).
   */
  private takeJump(state: SimState, self: FighterState, id: number, link: JumpLink): Pick<Intent, 'move' | 'jump' | 'jumpHeld'> {
    const { takeoff, heading } = link;
    const runup = { x: takeoff.x - heading.x * RUNUP, z: takeoff.z - heading.z * RUNUP };
    const toRunup = { x: runup.x - self.position.x, z: runup.z - self.position.z };
    let run = (this.jumpRun?.link === id && this.jumpRun.stage !== 'Fly' ? this.jumpRun : null) ?? this.newJumpRun(state.tick, self, id, link, false);
    if (state.tick > run.deadline) {
      this.giveUpJump(state.tick, id);
      return { move: ZERO };
    }
    const off = { x: self.position.x - takeoff.x, z: self.position.z - takeoff.z };
    const along = off.x * heading.x + off.z * heading.z;
    const across = Math.abs(off.x * heading.z - off.z * heading.x);
    if (run.stage === 'RunIn' && (along > JITTER_POS || across > LINED_UP)) run = { ...run, stage: 'LineUp' };
    if (run.stage === 'LineUp') {
      if (Math.hypot(toRunup.x, toRunup.z) > LINED_UP) {
        this.jumpRun = run;
        return { move: unit(toRunup) };
      }
      run = { ...run, stage: 'RunIn' };
    }
    if (along >= -TAKEOFF_SHORT) {
      this.jumpRun = { ...run, stage: 'Fly', flew: state.tick };
      return { move: heading, jump: true, jumpHeld: link.holdTicks > 0 };
    }
    this.jumpRun = run;
    return { move: heading };
  }

  /** A new run at jump Link `id`, from lining up: it has until it could have walked to the run-up point, and JUMP_PATIENCE more, to get airborne. */
  private newJumpRun(tick: number, self: FighterState, id: number, link: JumpLink, escape: boolean): JumpRun {
    const { takeoff, heading } = link;
    const far = Math.hypot(takeoff.x - heading.x * RUNUP - self.position.x, takeoff.z - heading.z * RUNUP - self.position.z);
    return { link: id, stage: 'LineUp', deadline: tick + Math.ceil(far / (this.tuning.fighter.walkSpeed * TICK_SECONDS)) + JUMP_PATIENCE, flew: -1, escape };
  }

  /**
   * A jump Link out of the Walk Surface it stands on to get away from `target` by (an id), or null: held no longer
   * than its `jumpNav`, onto another Walk Surface than the target's, taking off within ESCAPE_NEAR, further from the
   * target than it stands and heading away from it. The nearest takeoff; ties go to the lower id.
   */
  private escapeLink(state: SimState, self: FighterState, target: Sighting): number | null {
    const arena = arenaOf(this.tuning, state.arena);
    const mesh = navMesh(arena, this.tuning);
    const from = navPolygon(arena, this.tuning, { x: self.position.x, z: self.position.z, y: self.y });
    if (from < 0) return null;
    const theirs = navPolygon(arena, this.tuning, { x: target.position.x, z: target.position.z, y: target.y });
    const fromThem = (p: Vec2) => Math.hypot(p.x - target.position.x, p.z - target.position.z);
    let best: number | null = null;
    let bestDist = Infinity;
    for (const id of mesh.out[from]!) {
      const l = mesh.links[id]!;
      if (l.kind !== 'jump' || l.holdTicks > this.skill.jumpNav || l.to === theirs || this.failedJumps.some((f) => f.link === id)) continue;
      const d = Math.hypot(l.takeoff.x - self.position.x, l.takeoff.z - self.position.z);
      const away = l.heading.x * (l.takeoff.x - target.position.x) + l.heading.z * (l.takeoff.z - target.position.z) > 0;
      if (d > ESCAPE_NEAR || !away || fromThem(l.takeoff) <= fromThem(self.position) || d >= bestDist) continue;
      best = id;
      bestDist = d;
    }
    return best;
  }

  /**
   * Meet the Landing of `target` seen in the air (rolled once per time in the air, at `landingPunish`): predict where
   * it comes down from what was seen of it (`jumpArcFrom`, carrying on as it moved, with no more boost), and if that is
   * on its level and it can walk to LANDING_INSIDE within its reach of it before then, go there facing it and press
   * an Overhead timed to Release as the target lands. Null when it does not.
   */
  private meetLanding(state: SimState, self: FighterState, target: Sighting, targetIndex: number, seenTick: number, base: Intent): Intent | null {
    if (!target.airborne || target.airStart === null || this.skill.landingPunish <= 0 || self.air) return null;
    if (this.landing?.fighter !== targetIndex || this.landing.airStart !== target.airStart) {
      this.landing = { fighter: targetIndex, airStart: target.airStart, go: this.chance(this.skill.landingPunish) };
    }
    if (!this.landing.go) return null;
    const { walkSpeed } = this.tuning.fighter;
    const air = { vx: target.velocity.x / TICK_SECONDS, vz: target.velocity.z / TICK_SECONDS, vy: target.rise / TICK_SECONDS, peakY: target.y, ticks: 0, jumped: true };
    const arc = jumpArcFrom(arenaOf(this.tuning, state.arena), this.tuning, { at: target.position, y: target.y, air, move: { x: air.vx / walkSpeed, z: air.vz / walkSpeed } });
    const lands = arc.lands;
    if (!lands || Math.abs(lands.y - self.y) >= LEVEL) return null;
    const landTick = seenTick + arc.ticks;
    const windUp = attackTimings(this.tuning, self.weapon, 'Overhead').windUpEnd;
    const pressAt = landTick - windUp - 1;
    if (state.tick > landTick) return null;
    const face = Math.atan2(lands.x - self.position.x, lands.z - self.position.z);
    const toward = { x: Math.sin(face), z: Math.cos(face) };
    const flat = Math.hypot(lands.x - self.position.x, lands.z - self.position.z);
    const stand = this.reach(self.weapon) - LANDING_INSIDE;
    const spot = { x: lands.x - toward.x * stand, z: lands.z - toward.z * stand };
    const walk = Math.hypot(spot.x - self.position.x, spot.z - self.position.z) / (walkSpeed * TICK_SECONDS);
    if (state.tick < pressAt && walk > landTick - state.tick) return null;
    const aimed = { ...base, face, pitch: this.aim(self, { ...target, position: lands, y: lands.y, airborne: false }, Math.max(flat, stand)) };
    if (state.tick >= pressAt && self.action.kind === 'Idle') return this.startAttack(state.tick, self, target, flat, aimed, { direction: 'Overhead', timed: true });
    const step = Math.abs(flat - stand) < 0.05 ? ZERO : unit({ x: spot.x - self.position.x, z: spot.z - self.position.z });
    return { ...aimed, move: this.safeMove(state, self, step) };
  }

  /** Give up on jump Link `id` on Tick `tick`: forget it, and leave it out of its routes for a while. */
  private giveUpJump(tick: number, id: number): void {
    this.jumpRun = null;
    this.route = null;
    this.failedJumps = [...this.failedJumps.filter((f) => tick - f.at < JUMP_RETRY), { link: id, at: tick }];
  }

  /**
   * In the air on a jump Link: keep walking along its heading and hold Jump for its hold, starting nothing (it may still
   * Block). Back on the ground it is done, and re-plans from wherever it landed; if the press never took it off, it gives up on the Link.
   */
  private flying(state: SimState, self: FighterState, intent: Intent): Intent {
    const run = this.jumpRun;
    if (!run || run.stage !== 'Fly' || state.tick === run.flew) return intent;
    if (!self.air) {
      if (state.tick === run.flew + 1) this.giveUpJump(state.tick, run.link);
      else {
        this.jumpRun = null;
        this.route = null;
      }
      return intent;
    }
    const link = navMesh(arenaOf(this.tuning, state.arena), this.tuning).links[run.link] as JumpLink;
    return { ...intent, move: link.heading, jump: false, jumpHeld: state.tick - run.flew < link.holdTicks, attack: false, kick: false, throw: false };
  }

  /** Whether a step along `dir` (a unit vector) keeps it on safe ground: no ledge, no Lava or Water, no higher ground in the way. */
  private safe(state: SimState, self: FighterState, dir: Vec2): boolean {
    return stepIsSafe(arenaOf(this.tuning, state.arena), this.tuning, self.position, self.y, dir);
  }

  /** `m` if it walks onto safe ground, else the nearest safe heading turned up to 135° aside (keeping its speed), else standing still. */
  private safeMove(state: SimState, self: FighterState, m: Vec2): Vec2 {
    const len = Math.hypot(m.x, m.z);
    if (len === 0) return m;
    const dir = { x: m.x / len, z: m.z / len };
    for (const a of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
      const d = a === 0 ? dir : rotate(dir, a);
      if (this.safe(state, self, d)) return { x: d.x * len, z: d.z * len };
    }
    return ZERO;
  }

  /** Back off along `away`, unless that steps off a ledge: then strafe (left, else right), or hold its ground. */
  private retreat(state: SimState, self: FighterState, away: Vec2): Vec2 {
    return [away, { x: -away.z, z: away.x }, { x: away.z, z: -away.x }].find((m) => this.safe(state, self, m)) ?? ZERO;
  }

  /** The holds (Ticks) a jumping Attack may use, shortest first: up to its `jumpNav`, or a tap without one. */
  private leapHolds(): number[] {
    return JUMP_HOLDS.filter((h) => h <= Math.max(0, this.skill.jumpNav));
  }

  /** How far (m) its longest jumping Attack carries it on level ground. */
  private leapRange(): number {
    const holds = this.leapHolds();
    return levelJump(this.tuning, holds[holds.length - 1]!).distance;
  }

  /**
   * A jumping Attack at `target`: an Overhead with a Jump along `toward`, held for the shortest of its holds whose arc
   * (`jumpArc`) brings it within its reach (in 3D) of where the target will be (as seen, carried on at the walk it was seen at)
   * as its blade comes down (the second half of its Release, which starts once it is in
   * reach or can hold its Wind-up no longer), and that lands safely (`jumpIsSafe`). It never Feints it: the
   * arc was picked for this Release. Null when none does. It covers leaping down onto lower ground too.
   */
  private leap(state: SimState, self: FighterState, target: Sighting, dist: number, toward: Vec2, base: Intent): Intent | null {
    const arena = arenaOf(this.tuning, state.arena);
    const reach = this.reach(self.weapon);
    const { windUpEnd: windUp, releaseEnd } = attackTimings(this.tuning, self.weapon, 'Overhead');
    const release = releaseEnd - windUp;
    for (const hold of this.leapHolds()) {
      const plan = { at: self.position, y: self.y, heading: toward, holdTicks: hold };
      const arc = jumpArc(arena, this.tuning, plan);
      if (!arc.lands) continue;
      /** Where it is `k` Ticks after the press (on the ground where it lands, once down), and how far from where the target will be then. */
      const at = (k: number) => arc.path[Math.min(k, arc.ticks) - 1]!;
      const off = (k: number) => {
        const p = at(k);
        const lead = this.reactionTicks + k;
        return Math.hypot(target.position.x + target.velocity.x * lead - p.x, target.position.z + target.velocity.z * lead - p.z);
      };
      // It Releases as it comes within its reach (as `pressOn` does), or once it can hold the Wind-up no longer...
      let released = windUp;
      while (released < SWING_IN_HOLD && off(released) > reach - 0.05) released++;
      // ...and its blade comes down in the second half of the Release: it must be within reach all through it, counting the height between them.
      let meets = true;
      for (let k = released + Math.ceil(release / 2); k <= released + release && meets; k++) meets = Math.hypot(off(k), target.y - at(k).y) <= reach;
      if (!meets || !jumpIsSafe(arena, this.tuning, plan)) continue;
      return this.startAttack(state.tick, self, target, dist, { ...base, move: toward, jump: true, jumpHeld: hold > 0 }, { direction: 'Overhead', swingIn: true, holdJump: hold, timed: true });
    }
    return null;
  }

  /**
   * A hop to reposition (`jumpStep`: rolled with its circling side, taken once), a tapped Jump. A hop is no quicker than a
   * walk (it carries on at walk speed, then lands) and cannot Block, so it hops only where walking does worse: out from
   * between two enemies on its level within reach (PINCER_NEAR) seen more than PINCER apart, sideways so both are in front;
   * or round its target to its flank slot (`team`) more than HOP_SLOT off when the walk round is blocked (`walkBlocked`),
   * landing as far from the target as it stands (or straight along its way round). Never with an enemy Attack or Kick
   * seen coming within its reach and HOP_THREAT of where it takes off, and only a hop `jumpIsSafe` lands safely, whose arc
   * (a pincer's last quarter) stays HOP_CLEAR beyond every enemy's reach and ALLY_CLEAR from every ally (each where it
   * will be, carrying on as seen). Null when it does not hop.
   */
  private hopStep(state: SimState, self: FighterState, enemies: readonly Enemy[], focused: Enemy, team: TeamView | null, base: Intent): Intent | null {
    if (!this.strafe.hop || self.air || self.slow || this.jumpRun || self.action.kind !== 'Idle') return null;
    const reachOf = (o: Sighting) => this.reach(o.weapon) + THRUST_REACH;
    // As seen Reaction Time ago, even an Attack it has yet to notice (`reactionJitter`): in the air it could not Block it.
    const fresh = this.seen.find((o) => o.tick === state.tick - this.reactionTicks)!;
    const coming = fresh.fighters.some(
      (o, i) =>
        enemies.some((e) => e.i === i) &&
        (isThreat(o.action) || isKickThreat(o.action)) &&
        Math.abs(o.y - self.y) < DEFEND_LEVEL &&
        Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z) <= reachOf(o) + HOP_THREAT,
    );
    if (coming) return null;
    const arena = arenaOf(this.tuning, state.arena);
    const at = self.position;
    const t = focused.o.position;
    const tries: { heading: Vec2; pincer: boolean }[] = [];
    // Out of a pincer: sideways off the line between the two, its circling side first.
    const close = enemies.filter(({ o, flat, level }) => level && flat <= reachOf(o) + PINCER_NEAR);
    const bearing = (p: Vec2) => Math.atan2(p.x - at.x, p.z - at.z);
    for (let a = 0; a < close.length && tries.length === 0; a++) {
      for (let b = a + 1; b < close.length && tries.length === 0; b++) {
        const d = bearing(close[a]!.o.position) - bearing(close[b]!.o.position);
        if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) <= PINCER) continue;
        const u = unit({ x: close[b]!.o.position.x - close[a]!.o.position.x, z: close[b]!.o.position.z - close[a]!.o.position.z });
        const side = { x: -u.z * this.strafe.sign, z: u.x * this.strafe.sign };
        tries.push({ heading: side, pincer: true }, { heading: { x: -side.x, z: -side.z }, pincer: true });
      }
    }
    // Round to its flank slot, its walk there blocked: a chord of the circle it stands on, as far round as a hop carries it, or straight along its way round.
    if (team && team.slot !== null && this.strafe.flank) {
      const mine = Math.atan2(at.x - t.x, at.z - t.z);
      const off = Math.atan2(Math.sin(team.slot - mine), Math.cos(team.slot - mine));
      const r = focused.flat;
      const round = unit({ x: (at.z - t.z) * Math.sign(off), z: -(at.x - t.x) * Math.sign(off) });
      if (Math.abs(off) > HOP_SLOT && r > 0.5 && this.walkBlocked(state, self, team, round)) {
        const turn = Math.sign(off) * Math.min(Math.abs(off), 2 * Math.asin(Math.min(1, levelJump(this.tuning, 0).distance / (2 * r))));
        const land = { x: t.x + Math.sin(mine + turn) * r, z: t.z + Math.cos(mine + turn) * r };
        tries.push({ heading: unit({ x: land.x - at.x, z: land.z - at.z }), pincer: false }, { heading: round, pincer: false });
      }
    }
    const lead = this.reactionTicks;
    for (const { heading, pincer } of tries) {
      const plan = { at, y: self.y, heading, holdTicks: 0 };
      const arc = jumpArc(arena, this.tuning, plan);
      if (!arc.lands) continue;
      let clear = true;
      for (let k = pincer ? Math.ceil((arc.ticks * 3) / 4) : 1; k <= arc.ticks && clear; k++) {
        const p = arc.path[k - 1]!;
        const off = (o: Sighting) => Math.hypot(o.position.x + o.velocity.x * (lead + k) - p.x, o.position.z + o.velocity.z * (lead + k) - p.z);
        clear = enemies.every(({ o }) => off(o) > reachOf(o) + HOP_CLEAR) && (team?.allies ?? []).every(({ o }) => off(o) > ALLY_CLEAR);
      }
      if (!clear || !jumpIsSafe(arena, this.tuning, plan)) continue;
      this.strafe = { ...this.strafe, hop: false };
      return { ...base, move: heading, jump: true };
    }
    return null;
  }

  /** Whether its walk `round` (a unit vector) to its flank slot is blocked: the step is unsafe, or an ally (where it is by now, carrying on as seen) stands in the way. */
  private walkBlocked(state: SimState, self: FighterState, team: TeamView, round: Vec2): boolean {
    if (!this.safe(state, self, round)) return true;
    const lead = this.reactionTicks;
    return team.allies.some(({ o }) => {
      const x = o.position.x + o.velocity.x * lead - self.position.x;
      const z = o.position.z + o.velocity.z * lead - self.position.z;
      const along = x * round.x + z * round.z;
      return along > 0 && along < ALLY_AHEAD && Math.abs(x * round.z - z * round.x) < ALLY_ASIDE;
    });
  }

  /** Keep Jump held through a jumping Attack's hold, while in the air. */
  private holdingJump(tick: number, self: FighterState, intent: Intent): Intent {
    const plan = this.attackPlan;
    return plan && self.air && tick < plan.holdJumpUntil ? { ...intent, jumpHeld: true } : intent;
  }

  /**
   * Whether to Kick `target` this Tick: at `kickRate`, when it was last seen moving and is within `kickRange`
   * (the chance is lost at `mistakeRate`), four times as readily with a drop, Lava or Water behind it; a
   * mistimed Kick from just beyond it, within `attackRange`, is the mistake. Never at an opponent in a
   * Knockdown. Draws from the generator only when a Kick is possible.
   */
  private kick(state: SimState, target: Sighting, dist: number, toward: Vec2): boolean {
    const { kickRange, attackRange } = this.tuning.ai;
    const { kickRate, mistakeRate } = this.skill;
    if (kickRate <= 0 || !target.moving || target.action.kind === 'Knockdown' || dist > attackRange) return false;
    if (dist > kickRange) return this.random() < kickRate * mistakeRate;
    const ringOut = this.skill.footwork > 0 && this.hazardBehind(state, target, toward);
    return this.random() < Math.min(1, kickRate * (1 - mistakeRate) * (ringOut ? 4 : 1));
  }

  /**
   * Whether to throw a dagger at `target` this Tick: it has daggers left, the target is beyond its reach and
   * within `throwRange`, in line of sight, and was last seen walking away. At `throwRate` per Tick, lost at
   * `mistakeRate`. Rolls the aim error for the throw. Draws from the generator only when a throw is possible.
   */
  private toss(state: SimState, self: FighterState, target: Sighting, dist: number, toward: Vec2): boolean {
    const { throwRange } = this.tuning.ai;
    const { throwRate, mistakeRate } = this.skill;
    if (throwRate <= 0 || self.daggers <= 0 || dist <= this.reach(self.weapon) || dist > throwRange) return false;
    const walkingAway = (target.velocity.x * toward.x + target.velocity.z * toward.z) / (this.tuning.fighter.walkSpeed * TICK_SECONDS);
    if (walkingAway < FLEEING || !this.clearLine(state, self, target)) return false;
    if (!this.chance(throwRate * (1 - mistakeRate))) return false;
    this.aimError = mistakeRate > 0 ? (this.random() * 2 - 1) * AIM_ERROR * mistakeRate : 0;
    return true;
  }

  /** Whether no ground rises in the way between it and `target` (sampled along the line). */
  private clearLine(state: SimState, self: FighterState, target: Sighting): boolean {
    const arena = arenaOf(this.tuning, state.arena);
    const dx = target.position.x - self.position.x;
    const dz = target.position.z - self.position.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / SIGHT_SPACING);
    for (let k = 1; k < steps; k++) {
      if (blockedAt(arena, self.position.x + (dx * k) / steps, self.position.z + (dz * k) / steps, self.y, this.tuning)) return false;
    }
    return true;
  }

  /**
   * The facing and pitch that put a dagger on `target`: aimed at where it will be when the dagger gets there (its
   * last seen walk over Reaction Time, the Wind-up still to run and the flight), from the left hand, with the
   * arc's drop made up and the loft taken off, plus the error rolled for this throw.
   */
  private throwAim(self: FighterState, target: Sighting, dist: number): Pick<Intent, 'face' | 'pitch'> {
    const { speed, gravity, loft } = this.tuning.dagger;
    const windUpEnd = throwTimings(this.tuning, self.weapon).windUpEnd;
    const windUp = self.action.kind === 'Throw' ? Math.max(0, windUpEnd - self.motion.tick) : windUpEnd;
    const ticks = this.reactionTicks + windUp + dist / speed / TICK_SECONDS;
    const x = target.position.x + target.velocity.x * ticks;
    const z = target.position.z + target.velocity.z * ticks;
    // Aim from the left hand (it sits left of the facing, which is (cos, -sin)); one pass settles the heading.
    const rough = Math.atan2(x - self.position.x, z - self.position.z);
    const hx = self.position.x + Math.cos(rough) * LEFT_HAND;
    const hz = self.position.z - Math.sin(rough) * LEFT_HAND;
    const flat = Math.max(Math.hypot(x - hx, z - hz), 0.5);
    const flight = flat / speed;
    const crouchDrop = this.tuning.fighter.crouchDepth / this.tuning.fighter.height;
    const rise = target.y + AIM_HEIGHT * (1 - crouchDrop * target.crouch) - (self.y + HAND_HEIGHT) + 0.5 * gravity * flight * flight;
    return { face: Math.atan2(x - hx, z - hz) + this.aimError, pitch: Math.atan2(rise, flat) - loft * DEG };
  }

  /**
   * An enemy Throw aimed at it, or its dagger still on its way: turn to the thrower and Block. Whether it
   * does is rolled once per throw (`mistakeRate` says no). A Block already up from before the dagger left the hand does
   * not stop it, so once the dagger is out it lets that go for a Tick and raises it again. Null when there is nothing to Block.
   */
  private dodgeThrow(state: SimState, self: FighterState, enemies: readonly Enemy[], aimAt: (o: Sighting, flat: number) => Intent): Intent | null {
    const { throwRange } = this.tuning.ai;
    const aimed = enemies.find(({ o, flat, near }) => near && flat <= throwRange && isThrowThreat(o.action) && this.aimedAt(o, self));
    const aimedThrow = aimed && isThrowThreat(aimed.o.action) ? aimed.o.action : null;
    if (aimed && aimedThrow && (this.throwPlan?.thrower !== aimed.i || this.throwPlan.startTick !== aimedThrow.startTick)) {
      this.throwPlan = { thrower: aimed.i, startTick: aimedThrow.startTick, react: !this.chance(this.skill.mistakeRate) };
    }
    const plan = this.throwPlan;
    if (!plan?.react) return null;
    const coming = state.daggers.find(
      (d) => d.owner === plan.thrower && d.thrownAt >= plan.startTick && (self.position.x - d.position.x) * d.velocity.x + (self.position.z - d.position.z) * d.velocity.z > 0,
    );
    const onItsWay = coming !== undefined;
    const aimedNow = aimed !== undefined && aimed.i === plan.thrower && aimedThrow?.startTick === plan.startTick;
    const thrower = enemies.find((e) => e.i === plan.thrower);
    if (!thrower || !(onItsWay || aimedNow)) return null;
    const own = self.action;
    const base = aimAt(thrower.o, thrower.flat);
    if (own.kind === 'Block' && coming && state.tick - own.age < coming.thrownAt) return base;
    return { ...base, block: true, direction: own.kind === 'Block' ? own.direction : 'Overhead' };
  }

  /** Whether `o`'s facing carries a dagger (or a blow) within THROW_AIM_MISS of `self`. */
  private aimedAt(o: Sighting, self: { readonly position: Vec2 }): boolean {
    const dx = self.position.x - o.position.x;
    const dz = self.position.z - o.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return true;
    const off = Math.atan2(dx, dz) - o.facing;
    const turn = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
    return turn < Math.PI / 2 && dist * Math.sin(turn) <= THROW_AIM_MISS;
  }

  /** Whether a Knockdown's Slide along `dir` would carry `target` off a ledge, or into Lava or Water. */
  private hazardBehind(state: SimState, target: Sighting, dir: Vec2): boolean {
    const arena = arenaOf(this.tuning, state.arena);
    const { stepUp } = this.tuning.fall;
    for (const k of [0.8, 1.6, 2.4]) {
      const x = target.position.x + dir.x * k;
      const z = target.position.z + dir.z * k;
      const g = groundBelow(arena, x, z, target.y + stepUp);
      if (g === null || target.y - g.y > this.tuning.fall.safeHeight * 0.5 || deadlyGround(arena, x, z, g.y)) return true;
    }
    return false;
  }

  /**
   * The Direction to attack `target` in: around the Direction it guards, Overhead or Thrust against a Crouch or
   * a Fighter in the air (or `narrow`, with an ally beside its line), often a Thrust (the longest reach) from the edge of
   * its reach; a random one on a mistake.
   */
  private chooseDirection(self: FighterState, target: Sighting, dist: number, narrow = false): Direction {
    if (this.chance(this.skill.mistakeRate)) return this.randomDirection();
    const guard = guardOf(target.action);
    let options = DIRECTIONS.filter((d) => guard === null || mirrorDirection(d) !== guard);
    if (narrow || target.crouch > 0.5 || target.airborne || target.action.kind === 'Knockdown') {
      const high = options.filter((d) => d === 'Overhead' || d === 'Thrust');
      if (high.length > 0) options = high;
    }
    if (options.includes('Thrust') && dist > this.reach(self.weapon) - 0.1 && this.random() < 0.6) return 'Thrust';
    return this.pick(options);
  }

  /**
   * Press attack: in `direction`, or one chosen against the target's guard. With `swingIn` it may hold the
   * Wind-up while it closes in. At `feintRate` it plans to Feint this Attack into another Direction, unless it is
   * `timed` (its Release must come when it was pressed for) or the target cannot Block anyway (`defenceless`).
   */
  private startAttack(tick: number, self: FighterState, target: Sighting, dist: number, base: Intent, opts: { direction?: Direction; swingIn?: boolean; holdJump?: number; timed?: boolean; double?: boolean } = {}): Intent {
    const direction = opts.direction ?? this.chooseDirection(self, target, dist, this.narrowLine(self));
    if (!opts.timed && !defenceless(target) && this.chance(this.skill.feintRate)) {
      const at = tick + FEINT_DELAY_MIN + Math.floor(this.random() * (FEINT_DELAY_SPREAD + 1));
      this.feintPlan = { from: direction, into: this.chooseFeint(target, direction), at };
    }
    const whiff = !opts.timed && this.chance(this.skill.whiffCheck);
    const team = this.turn === true;
    this.turn = null;
    const planned = opts.swingIn || this.skill.chainRate > 0 || this.skill.feintRate > 0 || whiff || team || opts.double;
    const holdJumpUntil = opts.holdJump === undefined ? -1 : tick + opts.holdJump;
    this.attackPlan = planned
      ? { direction, holdUntil: opts.swingIn ? tick + SWING_IN_HOLD : -1, reFeintRolled: false, chainRolled: false, chain: null, chainHeld: false, holdJumpUntil, whiff, team, ...(opts.double ? { double: true } : {}) }
      : null;
    return { ...base, attack: true, direction };
  }

  /** The Direction to Feint `from` into: around the target's guard, never `from` itself. */
  private chooseFeint(target: Sighting, from: Direction): Direction {
    const guard = guardOf(target.action);
    const options = DIRECTIONS.filter((d) => d !== from && (guard === null || mirrorDirection(d) !== guard));
    return options.length > 0 ? this.pick(options) : this.randomDirection(from);
  }

  /**
   * Its own Attack under way. Wind-up: hold it while it closes in (swinging into the Attack), Feint away
   * from a Block it sees raised against it, else let it Release. Release: walk on into it. Recovery: Chain
   * another Attack while the target is still in reach, or step back out of reach. Played as one of a team
   * (`AttackPlan.team`), it takes its turn without a Chain when others share its target or an ally is in its swing line.
   */
  private pressOn(state: SimState, self: FighterState, target: Sighting, dist: number, toward: Vec2, base: Intent, team: TeamView | null): Intent {
    const a = self.action as Extract<Action, { kind: 'Attack' }>;
    const tick = state.tick;
    let plan = this.attackPlan;
    if (plan && plan.direction !== a.direction && !plan.chain) plan = this.attackPlan = { ...plan, direction: a.direction };
    const myReach = this.reach(self.weapon) + (a.direction === 'Thrust' ? THRUST_REACH : 0);
    const closeIn = dist > Math.max(1.0, this.tuning.ai.retreatRange + 0.1) ? toward : ZERO;
    const inLine = plan?.team === true && team !== null && this.allyInLine(self, team, toward, myReach);
    if (a.phase === 'Wind-up') {
      const guard = guardOf(target.action);
      if (plan && !plan.reFeintRolled && guard === mirrorDirection(a.direction)) {
        const go = this.chance(Math.min(1, this.skill.feintRate * 2));
        plan = this.attackPlan = { ...plan, reFeintRolled: true };
        if (go) {
          const into = this.chooseFeint(target, a.direction);
          this.attackPlan = { ...plan, direction: into };
          return { ...base, attack: true, direction: into, move: closeIn };
        }
      }
      if (plan && tick < plan.holdUntil && dist > myReach - 0.05) return { ...base, attack: true, direction: a.direction, move: self.air ? toward : this.safeMove(state, self, toward) };
      // About to Release at a target seen backing out of reach: hold on while it may close in, else Feint into a Block.
      if (plan?.whiff && !self.air && this.backingOut(self, target, dist, toward, a.direction, myReach)) {
        if (tick < plan.holdUntil) return { ...base, attack: true, direction: a.direction, move: this.safeMove(state, self, toward) };
        return { ...base, block: true, direction: a.direction };
      }
      return { ...base, move: self.air ? toward : this.safeMove(state, self, closeIn) };
    }
    if (a.phase === 'Release') return { ...base, move: self.air ? toward : this.safeMove(state, self, closeIn) };
    // Recovery.
    if (plan && (this.skill.chainRate > 0 || plan.double)) {
      if (!plan.chainRolled) {
        // A double threat always Chains.
        const p = plan.double ? 1 : this.skill.chainRate * (this.tactic.mode === 'Pressure' ? 1.5 : 1) * (a.landed ? 1.2 : 1);
        const chain = this.chance(Math.min(1, p)) ? this.chooseDirection(self, target, dist) : null;
        plan = this.attackPlan = { ...plan, chainRolled: true, chain };
      }
      const myTurn = !plan.team || team === null || (team.on.length < 2 && !inLine);
      if (plan.chain && myTurn && dist <= this.reach(self.weapon) + SWING_IN * 0.5 && target.action.kind !== 'Knockdown') {
        this.attackPlan = { ...plan, chainHeld: true };
        return { ...base, attack: true, direction: plan.chain, move: this.safeMove(state, self, closeIn) };
      }
      this.attackPlan = { ...plan, chainHeld: false };
    }
    // Not Chaining: step back out of a counter, if it is cautious.
    if (this.skill.caution > 0 && (this.tactic.mode !== 'Pressure' || !a.landed) && dist < this.reach(target.weapon) + 0.2) {
      return { ...base, move: this.safeMove(state, self, { x: -toward.x * this.skill.caution, z: -toward.z * this.skill.caution }) };
    }
    return base;
  }

  /**
   * Whether its own Wind-up in `direction` is about to Release (its last Tick before the held pose, or held) at `target`
   * seen backing off, and the target, carrying on as seen (since it was seen) while it walks on after it from now (as
   * `pressOn` does from beyond a metre), will be beyond `myReach` by the middle of the Release.
   */
  private backingOut(self: FighterState, target: Sighting, dist: number, toward: Vec2, direction: Direction, myReach: number): boolean {
    const { windUpEnd, releaseEnd } = attackTimings(this.tuning, self.weapon, direction);
    if (self.motion.tick < windUpEnd - 1) return false;
    const step = this.tuning.fighter.walkSpeed * TICK_SECONDS;
    const away = target.velocity.x * toward.x + target.velocity.z * toward.z;
    if (away <= BACKING_OUT * step) return false;
    const after = dist > Math.max(1.0, this.tuning.ai.retreatRange + 0.1) ? step : 0;
    // It saw the target Reaction Time ago; its own walk from now on.
    const ticks = 1 + Math.ceil((releaseEnd - windUpEnd) / 2);
    return dist + away * (this.reactionTicks + ticks) - after * ticks > myReach;
  }

  /** While a planned Feint's Wind-up runs: hold attack, then switch Direction (the Feint) and let the new Attack Release. */
  private feint(tick: number, self: Action, base: Intent): Intent | null {
    const plan = this.feintPlan;
    if (!plan) return null;
    if (self.kind !== 'Attack' || self.phase !== 'Wind-up' || self.direction !== plan.from) {
      this.feintPlan = null;
      return null;
    }
    if (tick < plan.at) return { ...base, attack: true, direction: plan.from };
    this.feintPlan = null;
    if (this.attackPlan) this.attackPlan = { ...this.attackPlan, direction: plan.into };
    return { ...base, attack: true, direction: plan.into };
  }

  /**
   * Meet the seen Attack as planned for it (rolled once per Attack): Block it in the Direction that meets it
   * (unless the roll made it a mistake), Crouch under a Left or Right, Chamber it, or swing on when its own
   * Wind-up lands first (neither of those, played as one of a team, with an ally where its blade would sweep).
   */
  private defend(state: SimState, self: FighterState, attacker: number, seen: Sighting, flat: number, base: Intent, team: TeamView | null): Intent {
    const atk = seen.action as Extract<Action, { kind: 'Attack' }>;
    const attackStart = seen.attackStart!;
    const meets = mirrorDirection(atk.direction);
    if (this.defencePlan?.attacker !== attacker || this.defencePlan.attackStart !== attackStart) {
      // Played as one of a team, it swings into no Attack (a Chamber, an Outpace) with an ally in its swing line.
      const toward = unit({ x: seen.position.x - self.position.x, z: seen.position.z - self.position.z });
      const swings = team === null || !this.teamRoll() || !this.allyInLine(self, team, toward, this.reach(self.weapon), 'Left');
      this.defencePlan = this.planDefence(state, self, attacker, seen, flat, attackStart, meets, swings);
      this.attackPlan = this.defencePlan.kind === 'Outpace' ? this.attackPlan : null;
    }
    const own = self.action;
    const broken = this.breakHold(state, self, seen, flat, base, meets);
    if (broken) return broken;
    let plan = this.defencePlan;
    switch (plan.kind) {
      case 'Duck':
        // Reading the look: a Left or Right swung looking down hits a Crouch, so Block it instead.
        if (!plan.reads || !this.lowLook(seen)) return { ...base, crouch: true };
        plan = this.defencePlan = { ...plan, kind: 'Block', direction: meets };
        break;
      case 'Outpace':
        // Its own Wind-up lands first: let it go (it may already have Released).
        if (own.kind === 'Attack') return base;
        plan = this.defencePlan = { ...plan, kind: 'Block', direction: meets };
        break;
      case 'Chamber': {
        if (state.tick < plan.pressAt) return own.kind === 'Idle' ? base : { ...base, block: true, direction: meets };
        if (state.tick === plan.pressAt && (own.kind === 'Idle' || (own.kind === 'Fall' && self.air?.jumped))) return { ...base, attack: true, direction: meets };
        // Pressed: let its Attack run until it can see whether it met the Release, then on while that Release lasts (the
        // Chamber lands only when the blades meet) and once it has (the attacker Staggers, Chambered): its counter swings.
        // Still threatened by a Wind-up held past the press, Block (a Block Feint).
        const took = seen.action.kind === 'Stagger' && seen.action.cause === 'Chambered';
        if (own.kind === 'Attack' && (state.tick <= plan.pressAt + this.reactionTicks + 2 || atk.phase === 'Release' || took)) return base;
        plan = this.defencePlan = { ...plan, kind: 'Block', direction: meets };
        break;
      }
      case 'Block':
        // A late Block (a human mistake): not raised yet.
        if (plan.raiseAt !== undefined && state.tick < plan.raiseAt && !(own.kind === 'Block' && own.direction === plan.direction)) return base;
        break;
    }
    return this.guard(own, base, plan.direction);
  }

  /** Raise (or keep) a Block in `direction`: a Block's Direction is fixed on press, so one in another Direction is dropped for a Tick first. Mid-Wind-up, pressing block Feints into the Block. */
  private guard(own: Action, base: Intent, direction: Direction): Intent {
    if (own.kind === 'Block' && own.direction !== direction) return base;
    return { ...base, block: true, direction };
  }

  /** Whether `o` is seen looking down far enough that its Left or Right would hit a Crouch (`ai.duckMaxPitch`). */
  private lowLook(o: Sighting): boolean {
    return o.pitch < this.tuning.ai.duckMaxPitch * DEG;
  }

  /**
   * Break the hold of `seen`'s Wind-up, held HOLD_BREAK_TICKS past its held pose (rolled once per Wind-up, at `holdBreak`),
   * rather than turtle in a Block: Kick it if it walks after it (holding its ground under its Block until it is in
   * `kickRange`), else back out of its reach keeping the Block for
   * BAIT_FIRST Ticks, then bait (BAIT_HALF Ticks stepping BAIT_INSIDE into its reach under the Block, as many back out,
   * Idle out there, ready to punish a Release that whiffs). Its Release seen from out of reach, it stays Idle. Null when it does not.
   */
  private breakHold(state: SimState, self: FighterState, seen: Sighting, flat: number, base: Intent, meets: Direction): Intent | null {
    if (this.skill.holdBreak <= 0 || self.air) return null;
    const atk = seen.action as Extract<Action, { kind: 'Attack' }>;
    let plan = this.defencePlan!;
    const theirReach = this.reach(seen.weapon) + (atk.direction === 'Thrust' ? THRUST_REACH : 0);
    if (atk.phase === 'Release') return plan.holdBreak?.go && flat > theirReach + 0.1 ? base : null;
    const { windUpEnd } = attackTimings(this.tuning, seen.weapon, atk.direction);
    const held = state.tick - this.reactionTicks - plan.attackStart - windUpEnd;
    if (atk.phase !== 'Wind-up' || held < HOLD_BREAK_TICKS) return null;
    if (!plan.holdBreak) plan = this.defencePlan = { ...plan, holdBreak: { go: this.chance(this.skill.holdBreak), at: state.tick } };
    if (!plan.holdBreak!.go) return null;
    const own = self.action;
    const toward = unit({ x: seen.position.x - self.position.x, z: seen.position.z - self.position.z });
    // Walking after it while holding: let it come on under its Block, and Kick it once in range (a mover is knocked
    // down), letting the Block go for a Tick first.
    const closing = -(seen.velocity.x * toward.x + seen.velocity.z * toward.z) / (this.tuning.fighter.walkSpeed * TICK_SECONDS);
    if (closing > WALKING_AFTER) {
      // Where it is by now, carrying on as seen.
      const lead = this.reactionTicks;
      const gap = Math.hypot(seen.position.x + seen.velocity.x * lead - self.position.x, seen.position.z + seen.velocity.z * lead - self.position.z);
      if (gap <= this.tuning.ai.kickRange && self.crouch < 0.5) {
        if (own.kind === 'Idle') return { ...base, kick: true };
        if (own.kind === 'Block') return base;
      }
      return this.guard(own, base, meets);
    }
    const k = state.tick - plan.holdBreak!.at;
    const baiting = k >= BAIT_FIRST && Math.floor((k - BAIT_FIRST) / BAIT_HALF) % 2 === 0;
    const spacing = baiting ? theirReach - BAIT_INSIDE : theirReach + HOVER_MARGIN;
    const radial = Math.max(-1, Math.min(1, (flat - spacing) * 2.5));
    const move = Math.abs(radial) < 0.15 ? ZERO : this.safeMove(state, self, { x: toward.x * radial, z: toward.z * radial });
    // Its Block up while in its reach; out of it, Idle, ready to punish.
    if (flat <= theirReach + 0.1 || baiting) return { ...this.guard(own, base, meets), move: own.kind === 'Block' && own.direction !== meets ? ZERO : move };
    return { ...base, move: own.kind === 'Block' ? ZERO : move };
  }

  private planDefence(state: SimState, self: FighterState, attacker: number, seen: Sighting, flat: number, attackStart: number, meets: Direction, swings: boolean): DefencePlan {
    const atk = seen.action as Extract<Action, { kind: 'Attack' }>;
    const plan = (kind: DefencePlan['kind'], direction = meets, pressAt = -1): DefencePlan => ({ attacker, attackStart, kind, direction, pressAt });
    // A human mistake (`humanMistakes`): likelier while shaken; usually a late Block, else one beside the right Direction.
    const human = this.chance(this.skill.humanMistakes);
    const rate = human && state.tick < this.shaken ? Math.min(1, this.skill.mistakeRate * LAPSE) : this.skill.mistakeRate;
    if (this.random() < rate) {
      if (!human) return plan('Block', this.randomDirection(meets));
      if (this.random() < LATE_SHARE) return { ...plan('Block'), raiseAt: state.tick + LATE_MIN + Math.floor(this.random() * (LATE_SPREAD + 1)) };
      return plan('Block', this.pick(BESIDE[meets]));
    }
    const own = self.action;
    const theirs = attackTimings(this.tuning, seen.weapon, atk.direction);
    // How many Ticks until their Release, if they let go as soon as they can (as far as their pose shows).
    const theirRelease = atk.phase === 'Wind-up' ? Math.max(0, theirs.windUpEnd - seen.motionTick - this.reactionTicks) : 0;
    if (swings && own.kind === 'Attack' && own.phase === 'Wind-up' && flat <= this.reach(self.weapon)) {
      const mine = attackTimings(this.tuning, self.weapon, own.direction);
      if (Math.max(0, mine.windUpEnd - self.motion.tick) + 6 < theirRelease && this.chance(this.skill.preempt)) return plan('Outpace');
    }
    if ((atk.direction === 'Left' || atk.direction === 'Right') && !self.air && this.chance(this.skill.duckRate)) {
      // Reading the look: never Duck a swing seen coming low (it would hit the Crouch).
      if (!this.chance(this.skill.lowSwingRead)) return plan('Duck');
      return this.lowLook(seen) ? { ...plan('Block'), reads: true } : { ...plan('Duck'), reads: true };
    }
    // Sheathed, its press would only Draw: no Chamber.
    if (atk.phase === 'Wind-up' && seen.motionTick < theirs.windUpEnd && own.kind === 'Idle' && !self.air && !self.sheathed && swings && this.skill.chamberRate > 0) {
      // Their first Release Tick is seen.tick + (windUpEnd + 1 - motionTick); press so the Chamber lands CHAMBER_AT Ticks into it.
      const pressAt = state.tick - this.reactionTicks + theirs.windUpEnd + CHAMBER_AT - 1 - seen.motionTick;
      if (pressAt > state.tick && this.chance(this.skill.chamberRate)) return plan('Chamber', meets, pressAt);
    }
    return plan('Block');
  }
}

/**
 * Whether a step from feet at (`at`, `y`) along `dir` (a unit vector) keeps it on safe ground, looking up to SAFETY_PROBE
 * ahead: no ledge (a drop of more than a step), no Lava, Water or Abyss, no higher ground in the way. The ground is looked
 * at SAFETY_MARGIN to either side of each point too, so a walk that cuts an open corner between the points is not safe.
 */
export function stepIsSafe(arena: ArenaGeometry, tuning: TuningData, at: Vec2, y: number, dir: Vec2): boolean {
  if (dir.x === 0 && dir.z === 0) return true;
  const { stepUp } = tuning.fall;
  const solid = (x: number, z: number) => {
    const g = groundBelow(arena, x, z, y + stepUp);
    return g !== null && y - g.y <= stepUp && !deadlyGround(arena, x, z, g.y) ? g : null;
  };
  for (const k of [0.5, 1]) {
    const x = at.x + dir.x * SAFETY_PROBE * k;
    const z = at.z + dir.z * SAFETY_PROBE * k;
    const g = solid(x, z);
    if (!g || blockedAt(arena, x, z, g.y, tuning)) return false;
    for (const side of [-1, 1]) if (!solid(x + side * dir.z * SAFETY_MARGIN, z - side * dir.x * SAFETY_MARGIN)) return false;
  }
  return true;
}

/** A rule-based AI Controller with the given difficulty, playing `style` (a Style from `tuning.ai.styles`, or explicit multipliers; default DEFAULT_STYLE). */
export function createAiController(tuning: TuningData, difficulty: AiDifficulty | string, style: AiStyle | string = DEFAULT_STYLE): Controller {
  return new AiController(tuning, typeof difficulty === 'string' ? aiDifficulty(tuning, difficulty) : difficulty, typeof style === 'string' ? aiStyle(tuning, style) : style);
}
