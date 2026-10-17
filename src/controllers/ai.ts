/**
 * The rule-based AI Controller.
 *
 * Fairness rules (spec #7, story 25/26):
 *  - It only observes what a human could see of the other Fighters: position,
 *    team, whether they have fallen, and the visible Action (the Wind-up pose
 *    reveals the Direction). Never anyone's Intents or HP-to-come.
 *  - It acts on the others only as seen `reactionTime` ago (its Reaction
 *    Time). Its own Fighter it knows up to date.
 *  - With several enemies it fights the nearest one, and blocks whichever
 *    enemy Attack nearest to it can reach it (see `intent`).
 *  - It fights only on the same level (feet within LEVEL of each other's).
 *    To reach an enemy on another Walk Surface it follows the navmesh
 *    (`findPath`, `steer`), re-planning when either moves to another surface
 *    or every REPATH_TICKS; the route is part of its memory. Backing off, it
 *    never steps off a ledge: it strafes, or holds its ground.
 *  - It makes mistakes at `mistakeRate`: a wrong-Direction Block (rolled once
 *    per opponent Attack), or a mistimed Attack from out of range.
 *  - It Feints at `feintRate`: that share of its Attacks hold the Wind-up and
 *    then switch to another Direction (an Attack Feint) before Releasing.
 *
 * Deterministic given the seeded generator in state: it holds no generator of
 * its own. Each Tick it draws from a generator derived from the Simulation's
 * `state.rng` (which the Simulation advances every Tick) and its Fighter index,
 * so scrubbing back or re-simulating the same state gives the same Intents
 * without saving any generator. A given seed and the same opponent always give
 * the same Intents.
 */
import {
  arenaOf,
  createRng,
  findPath,
  groundBelow,
  navPolygon,
  steer,
  DIRECTIONS,
  IDLE_INTENT,
  mirrorDirection,
  nextFloat,
  secondsToTicks,
  type Action,
  type Direction,
  type FighterState,
  type Intent,
  type RngState,
  type SimState,
  type Vec2,
} from '../sim';
import type { AiDifficulty, TuningData } from '../tuning';
import type { Controller } from './controller';

/** What the AI saw of one Fighter on one Tick. */
interface Sighting {
  readonly position: Vec2;
  /** Height of its feet. */
  readonly y: number;
  readonly action: Action;
  readonly team: number;
  readonly fallen: boolean;
  /** The Tick its current Attack became visible (identifies one Attack), or null when not attacking. */
  readonly attackStart: number | null;
}

/** What the AI saw of every Fighter on one Tick (its own Fighter included, unused). */
interface Observation {
  readonly tick: number;
  readonly fighters: readonly Sighting[];
}

/** The Block Direction chosen for one enemy Attack (rolled once, so a mistake sticks). */
interface BlockPlan {
  readonly attacker: number;
  readonly attackStart: number;
  readonly direction: Direction;
}

/** The AI Controller's memory (what it has seen and its plans), saved and loaded by the Editor sandbox and the Rollback session. */
interface AiMemory {
  readonly seen: readonly Observation[];
  readonly lastTick: number;
  readonly blockPlan: BlockPlan | null;
  readonly feintPlan: FeintPlan | null;
  readonly route: Route | null;
}

/** The way to its target on another Walk Surface: Links (`findPath`, null if there is none) planned on Tick `at` from surface `from` to `to`. */
interface Route {
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly links: readonly number[] | null;
}

/** A route is re-planned at least this often (Ticks), as its target moves about. */
const REPATH_TICKS = 30;
/** It fights (attacks, blocks, backs off) only an enemy whose feet are within this height of its own (m). */
const LEVEL = 0.5;
/** Backing off, it looks this far (m) behind it for a ledge. */
const RETREAT_PROBE = 0.8;

/** An Attack the AI means to Feint: hold the Wind-up in `from`, then switch to `into` on Duel Tick `at`. */
interface FeintPlan {
  readonly from: Direction;
  readonly into: Direction;
  readonly at: number;
}

/** A Feint switches Direction this many Ticks after the press, plus up to FEINT_DELAY_SPREAD more (rolled). */
const FEINT_DELAY_MIN = 4;
const FEINT_DELAY_SPREAD = 10;

/** Look up a difficulty preset by name in Tuning Data. */
export function aiDifficulty(tuning: TuningData, name: string): AiDifficulty {
  const d = tuning.ai.difficulties[name];
  if (!d) throw new Error(`Unknown AI difficulty "${name}" (have: ${Object.keys(tuning.ai.difficulties).join(', ')})`);
  return d;
}

/** Is this visible Action an Attack that can still land (Wind-up or Release)? */
const isThreat = (a: Action): a is Extract<Action, { kind: 'Attack' }> => a.kind === 'Attack' && a.phase !== 'Recovery';
/**
 * A visible opening: the opponent is committed (Recovery) or recoiling from a
 * Block (the defender's earned timing advantage). A Stagger from being hit is
 * not one: after a Trade both Fighters Stagger together, and punishing it
 * would just make two AIs Trade again in lockstep.
 */
const isOpening = (a: Action): boolean => (a.kind === 'Stagger' && a.cause === 'Blocked') || (a.kind === 'Attack' && a.phase === 'Recovery');

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

class AiController implements Controller {
  private readonly reactionTicks: number;
  /** This Tick's generator (derived from state each call, never carried between Ticks). */
  private rng: RngState = createRng(0);
  /** Observations of every Fighter, oldest first; only the last reactionTicks + 1 are kept. */
  private seen: Observation[] = [];
  private lastTick = -1;
  /** The Block Direction chosen for one enemy Attack (rolled once, so a mistake sticks). */
  private blockPlan: BlockPlan | null = null;
  /** Its own Attack it is about to Feint, if any. */
  private feintPlan: FeintPlan | null = null;
  /** Its way to a target on another Walk Surface, if it is following one. */
  private route: Route | null = null;

  constructor(
    private readonly tuning: TuningData,
    private readonly difficulty: AiDifficulty,
  ) {
    this.reactionTicks = secondsToTicks(difficulty.reactionTime);
  }

  /** All of the Controller's memory, as plain data (observations are immutable, so a shallow array copy is enough). */
  save(): AiMemory {
    return { seen: [...this.seen], lastTick: this.lastTick, blockPlan: this.blockPlan, feintPlan: this.feintPlan, route: this.route };
  }

  load(saved: unknown): void {
    const m = saved as AiMemory;
    this.seen = [...m.seen];
    this.lastTick = m.lastTick;
    this.blockPlan = m.blockPlan;
    this.feintPlan = m.feintPlan;
    this.route = m.route;
  }

  private random(): number {
    const [v, next] = nextFloat(this.rng);
    this.rng = next;
    return v;
  }

  private randomDirection(except?: Direction): Direction {
    const options = DIRECTIONS.filter((d) => d !== except);
    return options[Math.min(options.length - 1, Math.floor(this.random() * options.length))]!;
  }

  private observe(state: SimState): void {
    if (state.tick <= this.lastTick) {
      // A new Duel: forget what was seen.
      this.seen = [];
      this.blockPlan = null;
      this.feintPlan = null;
      this.route = null;
    }
    this.lastTick = state.tick;
    const prev = this.seen[this.seen.length - 1];
    const fighters = state.fighters.map((o, i): Sighting => {
      const before = prev?.fighters[i];
      // An Attack Feint (a new Direction mid-Wind-up) is a new Attack to plan a Block for.
      const sameAttack = o.action.kind === 'Attack' && before?.action.kind === 'Attack' && before.action.direction === o.action.direction;
      const attackStart = o.action.kind !== 'Attack' ? null : sameAttack && before ? before.attackStart : state.tick;
      return { position: o.position, y: o.y, action: o.action, team: o.team, fallen: o.death !== undefined, attackStart };
    });
    this.seen.push({ tick: state.tick, fighters });
    if (this.seen.length > this.reactionTicks + 1) this.seen.shift();
  }

  /**
   * Acts on everyone as seen Reaction Time ago: it Blocks the nearest enemy
   * Attack that can reach it (its nearest enemy's, or any from within
   * THREAT_REACH × `ai.attackRange`, on its level), else closes on and fights its nearest
   * living enemy (nearest in 3D; ranges are measured flat). Teammates it ignores.
   */
  intent(state: SimState, fighter: number): Intent {
    this.rng = tickRng(state, fighter);
    this.observe(state);
    const seen = this.seen[0];
    if (!seen || seen.tick !== state.tick - this.reactionTicks) return IDLE_INTENT;

    const self = state.fighters[fighter]!;
    const enemies = seen.fighters
      .map((o, i) => ({ o, i, flat: Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z), level: Math.abs(o.y - self.y) < LEVEL }))
      .map((e) => ({ ...e, dist: Math.hypot(e.flat, e.o.y - self.y) }))
      .filter(({ o, i }) => i !== fighter && !o.fallen && o.team !== self.team)
      .sort((a, b) => a.dist - b.dist || a.i - b.i);
    const nearest = enemies[0];
    if (!nearest) {
      this.blockPlan = null;
      this.feintPlan = null;
      this.route = null;
      return IDLE_INTENT;
    }
    const facing = (o: Sighting): Intent => ({ ...IDLE_INTENT, face: Math.atan2(o.position.x - self.position.x, o.position.z - self.position.z) });

    const reach = THREAT_REACH * this.tuning.ai.attackRange;
    const threat = enemies.find(({ o, flat, level }, k) => level && isThreat(o.action) && o.attackStart !== null && (k === 0 || flat <= reach));
    if (threat && isThreat(threat.o.action) && threat.o.attackStart !== null) {
      this.feintPlan = null;
      return this.defend(self.action, threat.i, threat.o.action.direction, threat.o.attackStart, facing(threat.o));
    }
    this.blockPlan = null;

    const { o: target, flat: dist, level } = nearest;
    const base = facing(target);
    const toward: Vec2 = dist > 0 ? { x: (target.position.x - self.position.x) / dist, z: (target.position.z - self.position.z) / dist } : { x: 0, z: 0 };
    const feint = this.feint(state.tick, self.action, base);
    if (feint) return feint;
    if (self.action.kind !== 'Idle') return base; // let go of block/attack; finish what it is doing
    const { attackRange, retreatRange, aggression } = this.tuning.ai;
    if (!level) {
      // Another level: find the way there, looking where it walks.
      const move = this.approach(state, self, target);
      return { ...IDLE_INTENT, move, face: move.x === 0 && move.z === 0 ? base.face : Math.atan2(move.x, move.z) };
    }
    if (dist > attackRange) {
      // Mistimed Attack: swinging from out of range.
      if (this.random() < aggression * this.difficulty.mistakeRate) return this.startAttack(state.tick, base);
      return { ...base, move: this.approach(state, self, target) };
    }
    if (dist < retreatRange) return { ...base, move: this.retreat(state, self, { x: -toward.x, z: -toward.z }) };
    // An opening (its target in Recovery or Staggered) is always punished, unless the AI never attacks (aggression 0).
    if (aggression > 0 && (isOpening(target.action) || this.random() < aggression)) return this.startAttack(state.tick, base);
    return base;
  }

  /**
   * Which way to walk to `target`: straight at it on the same Walk Surface (or off the navmesh), else
   * towards the next corner of its route there, re-planned when either changes surface or every REPATH_TICKS.
   */
  private approach(state: SimState, self: FighterState, target: Sighting): Vec2 {
    const arena = arenaOf(this.tuning, state.arena);
    const me = { x: self.position.x, z: self.position.z, y: self.y };
    const it = { x: target.position.x, z: target.position.z, y: target.y };
    const from = navPolygon(arena, this.tuning, me);
    const to = navPolygon(arena, this.tuning, it);
    let goal = target.position;
    if (from >= 0 && to >= 0 && from !== to && !self.air) {
      const r = this.route;
      const route = !r || r.from !== from || r.to !== to || state.tick - r.at >= REPATH_TICKS ? { from, to, at: state.tick, links: findPath(arena, this.tuning, me, it) } : r;
      this.route = route;
      if (route.links) goal = steer(arena, this.tuning, route.links, self.position, target.position);
    } else if (from === to) this.route = null;
    const dx = goal.x - self.position.x;
    const dz = goal.z - self.position.z;
    const d = Math.hypot(dx, dz);
    return d > 1e-9 ? { x: dx / d, z: dz / d } : { x: 0, z: 0 };
  }

  /** Back off along `away`, unless that steps off a ledge: then strafe (left, else right), or hold its ground. */
  private retreat(state: SimState, self: FighterState, away: Vec2): Vec2 {
    const arena = arenaOf(this.tuning, state.arena);
    const { stepUp } = this.tuning.fall;
    const safe = (m: Vec2) => {
      const g = groundBelow(arena, self.position.x + m.x * RETREAT_PROBE, self.position.z + m.z * RETREAT_PROBE, self.y + stepUp);
      return g !== null && self.y - g.y <= stepUp;
    };
    return [away, { x: -away.z, z: away.x }, { x: away.z, z: -away.x }].find(safe) ?? { x: 0, z: 0 };
  }

  /** Press attack in a random Direction; at `feintRate` it plans to Feint this Attack into another Direction. */
  private startAttack(tick: number, base: Intent): Intent {
    const direction = this.randomDirection();
    if (this.random() < this.difficulty.feintRate) {
      const at = tick + FEINT_DELAY_MIN + Math.floor(this.random() * (FEINT_DELAY_SPREAD + 1));
      this.feintPlan = { from: direction, into: this.randomDirection(direction), at };
    }
    return { ...base, attack: true, direction };
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
    return { ...base, attack: true, direction: plan.into };
  }

  /** Block the seen Attack, in the Direction that meets it unless this Attack's roll made it a mistake. */
  private defend(self: Action, attacker: number, attackDirection: Direction, attackStart: number, base: Intent): Intent {
    if (this.blockPlan?.attacker !== attacker || this.blockPlan.attackStart !== attackStart) {
      const mistake = this.random() < this.difficulty.mistakeRate;
      const meets = mirrorDirection(attackDirection);
      this.blockPlan = { attacker, attackStart, direction: mistake ? this.randomDirection(meets) : meets };
    }
    const direction = this.blockPlan.direction;
    // A Block's Direction is fixed on press: drop a Block in another Direction for a Tick, then raise this one.
    if (self.kind === 'Block' && self.direction !== direction) return base;
    // Mid-Wind-up, pressing block Feints into the Block.
    return { ...base, block: true, direction };
  }
}

/** A rule-based AI Controller with the given difficulty (a preset from `tuning.ai.difficulties`, or explicit values). */
export function createAiController(tuning: TuningData, difficulty: AiDifficulty | string): Controller {
  return new AiController(tuning, typeof difficulty === 'string' ? aiDifficulty(tuning, difficulty) : difficulty);
}
