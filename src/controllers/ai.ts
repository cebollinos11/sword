/**
 * The rule-based AI Controller.
 *
 * Fairness rules (spec #7, story 25/26):
 *  - It only observes what a human could see of the other Fighters: position
 *    and how it is moving, height, crouch, HP bar, Weapon, team, whether they
 *    have fallen, and the visible Action and pose (the Wind-up pose reveals the
 *    Direction, and how far along it is). Never anyone's Intents.
 *  - It acts on the others only as seen `reactionTime` ago (its Reaction
 *    Time). Its own Fighter it knows up to date.
 *  - With several enemies it fights the nearest one, and defends against
 *    whichever enemy Attack nearest to it can reach it (see `intent`).
 *  - It fights only on the same level (feet within LEVEL of each other's).
 *    To reach an enemy on another Walk Surface it follows the navmesh
 *    (`findPath`, `steer`), re-planning when either moves to another surface
 *    or every REPATH_TICKS; the route is part of its memory. Fighting, it
 *    never steps off a ledge or onto Lava or Water (`safeMove`): it turns
 *    aside, or holds its ground, and it only jumps where it lands safely.
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
 *    a whiffed Kick. It meets an opponent walking into its reach with an
 *    Attack already on the way (`preempt`), leaps in with a jumping Overhead
 *    from just out of reach (`jumpAttackRate`), Chains a second Attack while
 *    its opponent is still in reach (`chainRate`), Feints at `feintRate` (and
 *    Feints away from a Block it sees raised against its Wind-up), and now and
 *    then swings from out of range (the mistake).
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
  JITTER_POS,
  JUMP_HOLDS,
  jumpArc,
  jumpArcFrom,
  jumpIsSafe,
  levelJump,
  navMesh,
  navPolygon,
  steer,
  DIRECTIONS,
  IDLE_INTENT,
  mirrorDirection,
  nextFloat,
  secondsToTicks,
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
import { defaultWeaponName, weaponByName, type AiDifficulty, type TuningData } from '../tuning';
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
  readonly fallen: boolean;
  /** Which way its body faces. */
  readonly facing: number;
  /** Its feet moved since the Tick before (walking, or being pushed). */
  readonly moving: boolean;
  /** The Tick its current Attack became visible (identifies one Attack), or null when not attacking. */
  readonly attackStart: number | null;
  /** The Tick it was first seen off the ground this time (identifies one Jump or fall), or null when on the ground. */
  readonly airStart: number | null;
}

/** An enemy throw the AI means to Block (`react`) or let be, rolled once per throw. */
interface ThrowPlan {
  readonly thrower: number;
  /** The enemy Throw's `startTick`, which is also its dagger's `thrownAt`. */
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
}

/** Whether it goes for the opening it last saw (`fighter`'s, seen up to Tick `seen`). */
interface OpeningRoll {
  readonly fighter: number;
  readonly seen: number;
  readonly go: boolean;
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
}

/** A difficulty preset with every optional part filled in. */
type Skill = Required<AiDifficulty>;

/** A route is re-planned at least this often (Ticks), as its target moves about. */
const REPATH_TICKS = 30;
/** It fights (attacks, backs off) only an enemy whose feet are within this height of its own (m). */
const LEVEL = 0.5;
/** It defends against an Attack from an enemy whose feet are within this height of its own (m): a blade reaches up or down a stair. */
const DEFEND_LEVEL = 1.0;
/** Moving while it fights, it looks this far (m) ahead of its step for a ledge, Lava or Water. */
const SAFETY_PROBE = 0.8;
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

/** A Feint switches Direction this many Ticks after the press, plus up to FEINT_DELAY_SPREAD more (rolled). */
const FEINT_DELAY_MIN = 4;
const FEINT_DELAY_SPREAD = 10;

/** Look up a difficulty preset by name in Tuning Data. */
export function aiDifficulty(tuning: TuningData, name: string): AiDifficulty {
  const d = tuning.ai.difficulties[name];
  if (!d) throw new Error(`Unknown AI difficulty "${name}" (have: ${Object.keys(tuning.ai.difficulties).join(', ')})`);
  return d;
}

/** A preset with its optional parts filled in: the global `ai.aggression`/`ai.kickRate`, always punishing, and nothing else. */
function skillOf(tuning: TuningData, d: AiDifficulty): Skill {
  return {
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
    ...d,
  };
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
/** The Direction a visible Fighter guards in: its Block's, or a Knockdown's guard. */
const guardOf = (a: Action): Direction | null => (a.kind === 'Block' ? a.direction : a.kind === 'Knockdown' ? a.guard : null);

/** murmur3's 32-bit finaliser: spreads nearby seeds (consecutive Ticks, Fighter indices) over the whole range. */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Besides its nearest enemy's, the AI defends against any enemy Attack from within this many times `ai.attackRange`. */
const THREAT_REACH = 2;

/** This Tick's generator for one Fighter's AI, derived from the Simulation's seeded generator in state. */
function tickRng(state: SimState, fighter: number): RngState {
  return createRng(mix32(state.rng.seed ^ Math.imul(fighter + 1, 0x9e3779b9)));
}

const ZERO: Vec2 = Object.freeze({ x: 0, z: 0 });
const NEUTRAL: Tactic = Object.freeze({ mode: 'Neutral', until: -1 });
const NO_STRAFE: Strafe = Object.freeze({ sign: 1, until: -1 });

function unit(v: Vec2): Vec2 {
  const d = Math.hypot(v.x, v.z);
  return d > 1e-9 ? { x: v.x / d, z: v.z / d } : ZERO;
}

/** `v` turned by `a` radians about the vertical (same sense as facing). */
const rotate = (v: Vec2, a: number): Vec2 => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), z: -v.x * Math.sin(a) + v.z * Math.cos(a) });

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
  private readonly skill: Skill;
  /** This Tick's generator (derived from state each call, never carried between Ticks). */
  private rng: RngState = createRng(0);
  /** Observations of every Fighter, oldest first; only the last reactionTicks + 1 are kept. */
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

  constructor(
    private readonly tuning: TuningData,
    difficulty: AiDifficulty,
  ) {
    this.reactionTicks = secondsToTicks(difficulty.reactionTime);
    this.skill = skillOf(tuning, difficulty);
  }

  /** All of the Controller's memory, as plain data (observations and plans are immutable, so a shallow array copy is enough). */
  save(): AiMemory {
    const { seen, lastTick, defencePlan, feintPlan, attackPlan, throwPlan, aimError, route, jumpRun, failedJumps, landing, tactic, strafe, opening, lastHp } = this;
    return { seen: [...seen], lastTick, defencePlan, feintPlan, attackPlan, throwPlan, aimError, route, jumpRun, failedJumps, landing, tactic, strafe, opening, lastHp };
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
        fallen: o.death !== undefined,
        facing: o.facing,
        moving,
        attackStart,
        airStart,
      };
    });
    this.seen.push({ tick: state.tick, fighters });
    if (this.seen.length > this.reactionTicks + 1) this.seen.shift();
  }

  /** How far (m) a Fighter with `weapon` reaches with a swing: `ai.attackRange` for the default Weapon, more for a longer one. */
  private reach(weapon: string): number {
    const { attackRange } = this.tuning.ai;
    return attackRange + weaponByName(this.tuning, weapon).length - weaponByName(this.tuning, defaultWeaponName(this.tuning)).length;
  }

  /**
   * Acts on everyone as seen Reaction Time ago: it defends against the nearest
   * enemy Attack that can reach it (its nearest enemy's, or any from within
   * THREAT_REACH × `ai.attackRange`, on its level), else closes on and fights its nearest
   * living enemy (nearest in 3D; ranges are measured flat). Teammates it ignores.
   */
  intent(state: SimState, fighter: number): Intent {
    this.rng = tickRng(state, fighter);
    this.observe(state);
    const self = state.fighters[fighter]!;
    return this.flying(state, self, this.holdingJump(state.tick, self, this.decide(state, fighter)));
  }

  /** What it would do this Tick, before a Jump it is in the air on has its say (`flying`). */
  private decide(state: SimState, fighter: number): Intent {
    const seen = this.seen[0];
    if (!seen || seen.tick !== state.tick - this.reactionTicks) return IDLE_INTENT;

    const self = state.fighters[fighter]!;
    const enemies = seen.fighters
      .map((o, i) => ({ o, i, flat: Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z), level: Math.abs(o.y - self.y) < LEVEL }))
      .map((e) => ({ ...e, dist: Math.hypot(e.flat, e.o.y - self.y), near: Math.abs(e.o.y - self.y) < DEFEND_LEVEL }))
      .filter(({ o, i }) => i !== fighter && !o.fallen && o.team !== self.team)
      .sort((a, b) => a.dist - b.dist || a.i - b.i);
    const nearest = enemies[0];
    if (!nearest) {
      this.forget();
      return IDLE_INTENT;
    }
    const aimAt = (o: Sighting, flat: number): Intent => ({ ...IDLE_INTENT, face: Math.atan2(o.position.x - self.position.x, o.position.z - self.position.z), pitch: this.aim(self, o, flat) });

    this.think(state.tick, self, nearest.o);

    const reach = THREAT_REACH * this.tuning.ai.attackRange;
    const threat = enemies.find(({ o, flat, near }, k) => near && isThreat(o.action) && o.attackStart !== null && (k === 0 || flat <= reach));
    if (threat && isThreat(threat.o.action) && threat.o.attackStart !== null) {
      this.feintPlan = null;
      return this.defend(state, self, threat.i, threat.o, threat.flat, aimAt(threat.o, threat.flat));
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
      return aimAt(nearest.o, nearest.flat);
    }

    const { o: target, i: targetIndex, flat: dist, level } = nearest;
    const base = aimAt(target, dist);
    const toward: Vec2 = dist > 0 ? { x: (target.position.x - self.position.x) / dist, z: (target.position.z - self.position.z) / dist } : ZERO;
    const away: Vec2 = { x: -toward.x, z: -toward.z };
    const feint = this.feint(state.tick, self.action, base);
    if (feint) return feint;

    switch (self.action.kind) {
      case 'Attack':
        return this.pressOn(state, self, target, dist, toward, base);
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
    const aggression = this.skill.aggression * (this.tactic.mode === 'Pressure' ? 2.5 : this.tactic.mode === 'Disengage' ? 0.2 : 1);

    // An opening, near enough to step in on: punish it (unless the AI never attacks, aggression 0).
    if (this.skill.aggression > 0 && isOpening(target.action) && dist <= myReach + SWING_IN && this.goesFor(targetIndex, seen.tick)) {
      return this.startAttack(state.tick, self, target, dist, { ...base, move: dist > myReach ? toward : ZERO }, { swingIn: dist > myReach });
    }

    if (this.skill.footwork <= 0) {
      // The plain AI: walk straight in, attack in range, back off when crowded.
      if (dist > myReach) {
        // Mistimed Attack: swinging from out of range.
        if (this.chance(aggression * this.skill.mistakeRate)) return this.startAttack(state.tick, self, target, dist, base);
        return { ...base, ...this.approach(state, self, target) };
      }
      if (dist < this.tuning.ai.retreatRange) return { ...base, move: this.retreat(state, self, away) };
      if (this.chance(aggression)) return this.startAttack(state.tick, self, target, dist, base);
      return base;
    }

    // Far off: close in along the navmesh.
    const longer = Math.max(myReach, theirReach);
    if (dist > longer + SWING_IN + 1.5) return { ...base, ...this.approach(state, self, target) };

    // Meet an opponent walking into reach with an Attack already on the way.
    const closing = -(target.velocity.x * toward.x + target.velocity.z * toward.z) / (this.tuning.fighter.walkSpeed * TICK_SECONDS);
    if (target.action.kind === 'Idle' && closing > 0.5 && dist > myReach && dist <= myReach + SWING_IN && this.chance(this.skill.preempt * 0.3)) {
      return this.startAttack(state.tick, self, target, dist, base, { swingIn: true });
    }

    // Leap in with an Overhead from out of reach.
    const notBusy = target.action.kind === 'Idle' || target.action.kind === 'Block';
    if (!self.air && notBusy && dist >= myReach + JUMP_FROM && dist <= myReach + this.leapRange() && this.chance(this.skill.jumpAttackRate * (this.tactic.mode === 'Disengage' ? 0.2 : 1))) {
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

    // From its spacing: step in and swing (or swing from where it stands, in reach).
    if (dist <= myReach && this.chance(aggression)) return this.startAttack(state.tick, self, target, dist, base);
    if (dist <= myReach + SWING_IN && this.chance(aggression * 0.6)) return this.startAttack(state.tick, self, target, dist, { ...base, move: toward }, { swingIn: true });
    if (dist > myReach + SWING_IN && this.chance(aggression * this.skill.mistakeRate)) return this.startAttack(state.tick, self, target, dist, base);

    return { ...base, move: this.footwork(state, self, dist, toward, myReach, theirReach) };
  }

  /** Once a Tick: notice being hit, and pick its tactic (and circling side) as the old one runs out. */
  private think(tick: number, self: FighterState, target: Sighting): void {
    const { caution, pressure, footwork } = this.skill;
    const hurt = this.lastHp >= 0 && self.hp < this.lastHp;
    this.lastHp = self.hp;
    if (hurt && this.chance(caution)) {
      this.tactic = { mode: 'Disengage', until: tick + 40 + Math.floor(this.random() * 50) };
    } else if (tick >= this.tactic.until && (pressure > 0 || caution > 0)) {
      const max = this.tuning.fighter.maxHp;
      const ahead = (self.hp - target.hp) / max;
      const press = Math.min(1, Math.max(0, pressure * (0.7 + ahead * 1.5)));
      const back = caution * (self.hp < 0.35 * max ? 0.45 : 0.08);
      const r = this.random();
      const mode: Mode = r < press ? 'Pressure' : r < press + back ? 'Disengage' : 'Neutral';
      this.tactic = { mode, until: tick + 60 + Math.floor(this.random() * 120) };
    }
    if (footwork > 0 && tick >= this.strafe.until) this.strafe = { sign: this.random() < 0.5 ? 1 : -1, until: tick + 40 + Math.floor(this.random() * 100) };
  }

  /** Whether to go for the opening it sees on `fighter` (rolled once per opening, at `punish`). */
  private goesFor(fighter: number, seenTick: number): boolean {
    const o = this.opening;
    const go = o && o.fighter === fighter && o.seen >= seenTick - 1 ? o.go : this.chance(this.skill.punish);
    this.opening = { fighter, seen: seenTick, go };
    return go;
  }

  /** Where to stand, circling: hovering at its spacing for the tactic, along the side it circles, never stepping somewhere unsafe. */
  private footwork(state: SimState, self: FighterState, dist: number, toward: Vec2, myReach: number, theirReach: number): Vec2 {
    const { mode } = this.tactic;
    const longer = Math.max(myReach, theirReach);
    // Outreached by its own Weapon, it stands in its reach and out of theirs; else just outside the longer reach.
    const poke = myReach > theirReach + 0.2 ? myReach - 0.1 : longer + HOVER_MARGIN;
    const spacing = mode === 'Pressure' ? (this.tuning.ai.retreatRange + myReach) / 2 : mode === 'Disengage' ? longer + DISENGAGE_MARGIN : poke;
    const radial = Math.max(-1, Math.min(1, (dist - spacing) * 2.5));
    let side = this.strafe.sign * this.skill.footwork * (mode === 'Pressure' ? 0.5 : 1);
    const tangent = (s: number): Vec2 => ({ x: -toward.z * s, z: toward.x * s });
    if (side !== 0 && !this.safe(state, self, unit(tangent(side)))) {
      side = -side;
      this.strafe = { sign: -this.strafe.sign, until: this.strafe.until };
    }
    const t = tangent(side);
    const m = { x: toward.x * radial + t.x, z: toward.z * radial + t.z };
    const len = Math.hypot(m.x, m.z);
    if (len < 0.15) return ZERO;
    return this.safeMove(state, self, len > 1 ? { x: m.x / len, z: m.z / len } : m);
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
    if (first?.kind === 'jump') return this.takeJump(state, self, links![0]!, first);
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
    if (dir.x === 0 && dir.z === 0) return true;
    const arena = arenaOf(this.tuning, state.arena);
    const { stepUp } = this.tuning.fall;
    for (const k of [0.5, 1]) {
      const x = self.position.x + dir.x * SAFETY_PROBE * k;
      const z = self.position.z + dir.z * SAFETY_PROBE * k;
      const g = groundBelow(arena, x, z, self.y + stepUp);
      if (g === null || self.y - g.y > stepUp || deadlyGround(arena, x, z, g.y) || blockedAt(arena, x, z, g.y, this.tuning)) return false;
    }
    return true;
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
   * (`jumpArc`) brings it within its reach of where the target will be (as seen, carried on at the walk it was seen at),
   * at a height its blade reaches, at some Tick from the end of its Wind-up (which it may hold while it closes) to its
   * Landing, and that lands safely (`jumpIsSafe`). Null when none does. It covers leaping down onto lower ground too.
   */
  private leap(state: SimState, self: FighterState, target: Sighting, dist: number, toward: Vec2, base: Intent): Intent | null {
    const arena = arenaOf(this.tuning, state.arena);
    const reach = this.reach(self.weapon);
    const windUp = attackTimings(this.tuning, self.weapon, 'Overhead').windUpEnd;
    for (const hold of this.leapHolds()) {
      const plan = { at: self.position, y: self.y, heading: toward, holdTicks: hold };
      const arc = jumpArc(arena, this.tuning, plan);
      if (!arc.lands) continue;
      let meets = false;
      for (let k = windUp; k <= Math.min(arc.ticks, windUp + SWING_IN_HOLD) && !meets; k++) {
        const p = arc.path[k - 1]!;
        const lead = this.reactionTicks + k;
        const flat = Math.hypot(target.position.x + target.velocity.x * lead - p.x, target.position.z + target.velocity.z * lead - p.z);
        meets = flat <= reach && Math.abs(target.y - p.y) <= DEFEND_LEVEL;
      }
      if (!meets || !jumpIsSafe(arena, this.tuning, plan)) continue;
      return this.startAttack(state.tick, self, target, dist, { ...base, move: toward, jump: true, jumpHeld: hold > 0 }, { direction: 'Overhead', swingIn: true, holdJump: hold });
    }
    return null;
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
   * does is rolled once per throw (`mistakeRate` says no). A Block already up from before the throw began does
   * not stop the dagger, so it lets that go for a Tick and raises it again. Null when there is nothing to Block.
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
    const onItsWay = state.daggers.some(
      (d) => d.owner === plan.thrower && d.thrownAt === plan.startTick && (self.position.x - d.position.x) * d.velocity.x + (self.position.z - d.position.z) * d.velocity.z > 0,
    );
    const aimedNow = aimed !== undefined && aimed.i === plan.thrower && aimedThrow?.startTick === plan.startTick;
    const thrower = enemies.find((e) => e.i === plan.thrower);
    if (!thrower || !(onItsWay || aimedNow)) return null;
    const own = self.action;
    const base = aimAt(thrower.o, thrower.flat);
    if (own.kind === 'Block' && state.tick - own.age < plan.startTick) return base;
    return { ...base, block: true, direction: own.kind === 'Block' ? own.direction : 'Overhead' };
  }

  /** Whether `o`'s facing carries a dagger within THROW_AIM_MISS of `self`. */
  private aimedAt(o: Sighting, self: FighterState): boolean {
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
   * a Fighter in the air, often a Thrust (the longest reach) from the edge of its reach; a random one on a mistake.
   */
  private chooseDirection(self: FighterState, target: Sighting, dist: number): Direction {
    if (this.chance(this.skill.mistakeRate)) return this.randomDirection();
    const guard = guardOf(target.action);
    let options = DIRECTIONS.filter((d) => guard === null || mirrorDirection(d) !== guard);
    if (target.crouch > 0.5 || target.airborne || target.action.kind === 'Knockdown') {
      const high = options.filter((d) => d === 'Overhead' || d === 'Thrust');
      if (high.length > 0) options = high;
    }
    if (options.includes('Thrust') && dist > this.reach(self.weapon) - 0.1 && this.random() < 0.6) return 'Thrust';
    return this.pick(options);
  }

  /**
   * Press attack: in `direction`, or one chosen against the target's guard. With `swingIn` it may hold the
   * Wind-up while it closes in. At `feintRate` it plans to Feint this Attack into another Direction, unless it is
   * `timed` (its Release must come when it was pressed for).
   */
  private startAttack(tick: number, self: FighterState, target: Sighting, dist: number, base: Intent, opts: { direction?: Direction; swingIn?: boolean; holdJump?: number; timed?: boolean } = {}): Intent {
    const direction = opts.direction ?? this.chooseDirection(self, target, dist);
    if (!opts.timed && this.chance(this.skill.feintRate)) {
      const at = tick + FEINT_DELAY_MIN + Math.floor(this.random() * (FEINT_DELAY_SPREAD + 1));
      this.feintPlan = { from: direction, into: this.chooseFeint(target, direction), at };
    }
    const planned = opts.swingIn || this.skill.chainRate > 0 || this.skill.feintRate > 0;
    const holdJumpUntil = opts.holdJump === undefined ? -1 : tick + opts.holdJump;
    this.attackPlan = planned ? { direction, holdUntil: opts.swingIn ? tick + SWING_IN_HOLD : -1, reFeintRolled: false, chainRolled: false, chain: null, chainHeld: false, holdJumpUntil } : null;
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
   * another Attack while the target is still in reach, or step back out of reach.
   */
  private pressOn(state: SimState, self: FighterState, target: Sighting, dist: number, toward: Vec2, base: Intent): Intent {
    const a = self.action as Extract<Action, { kind: 'Attack' }>;
    const tick = state.tick;
    let plan = this.attackPlan;
    if (plan && plan.direction !== a.direction && !plan.chain) plan = this.attackPlan = { ...plan, direction: a.direction };
    const myReach = this.reach(self.weapon) + (a.direction === 'Thrust' ? THRUST_REACH : 0);
    const closeIn = dist > Math.max(1.0, this.tuning.ai.retreatRange + 0.1) ? toward : ZERO;
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
      return { ...base, move: self.air ? toward : this.safeMove(state, self, closeIn) };
    }
    if (a.phase === 'Release') return { ...base, move: self.air ? toward : this.safeMove(state, self, closeIn) };
    // Recovery.
    if (plan && this.skill.chainRate > 0) {
      if (!plan.chainRolled) {
        const p = this.skill.chainRate * (this.tactic.mode === 'Pressure' ? 1.5 : 1) * (a.landed ? 1.2 : 1);
        const chain = this.chance(Math.min(1, p)) ? this.chooseDirection(self, target, dist) : null;
        plan = this.attackPlan = { ...plan, chainRolled: true, chain };
      }
      if (plan.chain && dist <= this.reach(self.weapon) + SWING_IN * 0.5 && target.action.kind !== 'Knockdown') {
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
   * Wind-up lands first.
   */
  private defend(state: SimState, self: FighterState, attacker: number, seen: Sighting, flat: number, base: Intent): Intent {
    const atk = seen.action as Extract<Action, { kind: 'Attack' }>;
    const attackStart = seen.attackStart!;
    const meets = mirrorDirection(atk.direction);
    if (this.defencePlan?.attacker !== attacker || this.defencePlan.attackStart !== attackStart) {
      this.defencePlan = this.planDefence(state, self, attacker, seen, flat, attackStart, meets);
      this.attackPlan = this.defencePlan.kind === 'Outpace' ? this.attackPlan : null;
    }
    let plan = this.defencePlan;
    const own = self.action;
    switch (plan.kind) {
      case 'Duck':
        return { ...base, crouch: true };
      case 'Outpace':
        // Its own Wind-up lands first: let it go (it may already have Released).
        if (own.kind === 'Attack') return base;
        plan = this.defencePlan = { ...plan, kind: 'Block', direction: meets };
        break;
      case 'Chamber': {
        if (state.tick < plan.pressAt) return own.kind === 'Idle' ? base : { ...base, block: true, direction: meets };
        if (state.tick === plan.pressAt && (own.kind === 'Idle' || (own.kind === 'Fall' && self.air?.jumped))) return { ...base, attack: true, direction: meets };
        // Pressed: let its Attack run until it can see whether the Chamber took; still threatened after that, Block (a Block Feint).
        if (own.kind === 'Attack' && state.tick <= plan.pressAt + this.reactionTicks + 2) return base;
        plan = this.defencePlan = { ...plan, kind: 'Block', direction: meets };
        break;
      }
      case 'Block':
        break;
    }
    const direction = plan.direction;
    // A Block's Direction is fixed on press: drop a Block in another Direction for a Tick, then raise this one.
    if (own.kind === 'Block' && own.direction !== direction) return base;
    // Mid-Wind-up, pressing block Feints into the Block.
    return { ...base, block: true, direction };
  }

  private planDefence(state: SimState, self: FighterState, attacker: number, seen: Sighting, flat: number, attackStart: number, meets: Direction): DefencePlan {
    const atk = seen.action as Extract<Action, { kind: 'Attack' }>;
    const plan = (kind: DefencePlan['kind'], direction = meets, pressAt = -1): DefencePlan => ({ attacker, attackStart, kind, direction, pressAt });
    if (this.random() < this.skill.mistakeRate) return plan('Block', this.randomDirection(meets));
    const own = self.action;
    const theirs = attackTimings(this.tuning, seen.weapon, atk.direction);
    // How many Ticks until their Release, if they let go as soon as they can (as far as their pose shows).
    const theirRelease = atk.phase === 'Wind-up' ? Math.max(0, theirs.windUpEnd - seen.motionTick - this.reactionTicks) : 0;
    if (own.kind === 'Attack' && own.phase === 'Wind-up' && flat <= this.reach(self.weapon)) {
      const mine = attackTimings(this.tuning, self.weapon, own.direction);
      if (Math.max(0, mine.windUpEnd - self.motion.tick) + 6 < theirRelease && this.chance(this.skill.preempt)) return plan('Outpace');
    }
    if ((atk.direction === 'Left' || atk.direction === 'Right') && !self.air && this.chance(this.skill.duckRate)) return plan('Duck');
    if (atk.phase === 'Wind-up' && seen.motionTick < theirs.windUpEnd && own.kind === 'Idle' && !self.air && this.skill.chamberRate > 0) {
      // Their first Release Tick is seen.tick + (windUpEnd + 1 - motionTick); press so the Chamber lands CHAMBER_AT Ticks into it.
      const pressAt = state.tick - this.reactionTicks + theirs.windUpEnd + CHAMBER_AT - 1 - seen.motionTick;
      if (pressAt > state.tick && this.chance(this.skill.chamberRate)) return plan('Chamber', meets, pressAt);
    }
    return plan('Block');
  }
}

/** A rule-based AI Controller with the given difficulty (a preset from `tuning.ai.difficulties`, or explicit values). */
export function createAiController(tuning: TuningData, difficulty: AiDifficulty | string): Controller {
  return new AiController(tuning, typeof difficulty === 'string' ? aiDifficulty(tuning, difficulty) : difficulty);
}
