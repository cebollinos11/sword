/**
 * The rule-based AI Controller.
 *
 * Fairness rules (spec #7, story 25/26):
 *  - It only observes what a human could see of its opponent: position and
 *    the visible Action (the Wind-up pose reveals the Direction). Never the
 *    opponent's Intents or HP-to-come.
 *  - It acts on its opponent only as seen `reactionTime` ago (its Reaction
 *    Time). Its own Fighter it knows up to date.
 *  - It makes mistakes at `mistakeRate`: a wrong-Direction Block (rolled once
 *    per opponent Attack), or a mistimed Attack from out of range.
 *
 * Deterministic given the seeded generator in state: it holds no generator of
 * its own. Each Tick it draws from a generator derived from the Simulation's
 * `state.rng` (which the Simulation advances every Tick) and its Fighter index,
 * so scrubbing back or re-simulating the same state gives the same Intents
 * without saving any generator. A given seed and the same opponent always give
 * the same Intents.
 */
import {
  createRng,
  DIRECTIONS,
  IDLE_INTENT,
  nextFloat,
  secondsToTicks,
  type Action,
  type Direction,
  type Intent,
  type RngState,
  type SimState,
  type Vec2,
} from '../sim';
import type { AiDifficulty, TuningData } from '../tuning';
import type { Controller } from './controller';

/** What the AI saw of its opponent on one Tick. */
interface Observation {
  readonly tick: number;
  readonly position: Vec2;
  readonly action: Action;
  /** The Tick the opponent's current Attack became visible (identifies one Attack), or null when not attacking. */
  readonly attackStart: number | null;
}

/** The AI Controller's memory (what it has seen and its plans), saved and loaded by the Editor sandbox. */
interface AiMemory {
  readonly seen: readonly Observation[];
  readonly lastTick: number;
  readonly blockPlan: { readonly attackStart: number; readonly direction: Direction } | null;
}

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

/** This Tick's generator for one Fighter's AI, derived from the Simulation's seeded generator in state. */
function tickRng(state: SimState, fighter: number): RngState {
  return createRng(mix32(state.rng.seed ^ Math.imul(fighter + 1, 0x9e3779b9)));
}

class AiController implements Controller {
  private readonly reactionTicks: number;
  /** This Tick's generator (derived from state each call, never carried between Ticks). */
  private rng: RngState = createRng(0);
  /** Observations of the opponent, oldest first; only the last reactionTicks + 1 are kept. */
  private seen: Observation[] = [];
  private lastTick = -1;
  /** The Block Direction chosen for one opponent Attack (rolled once, so a mistake sticks). */
  private blockPlan: { readonly attackStart: number; readonly direction: Direction } | null = null;

  constructor(
    private readonly tuning: TuningData,
    private readonly difficulty: AiDifficulty,
  ) {
    this.reactionTicks = secondsToTicks(difficulty.reactionTime);
  }

  /** All of the Controller's memory, as plain data (observations are immutable, so a shallow array copy is enough). */
  save(): AiMemory {
    return { seen: [...this.seen], lastTick: this.lastTick, blockPlan: this.blockPlan };
  }

  load(saved: unknown): void {
    const m = saved as AiMemory;
    this.seen = [...m.seen];
    this.lastTick = m.lastTick;
    this.blockPlan = m.blockPlan;
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

  private observe(state: SimState, opponent: number): void {
    if (state.tick <= this.lastTick) {
      // A new Duel: forget what was seen.
      this.seen = [];
      this.blockPlan = null;
    }
    this.lastTick = state.tick;
    const o = state.fighters[opponent]!;
    const prev = this.seen[this.seen.length - 1];
    // An Attack Feint (a new Direction mid-Wind-up) is a new Attack to plan a Block for.
    const sameAttack = o.action.kind === 'Attack' && prev?.action.kind === 'Attack' && prev.action.direction === o.action.direction;
    const attackStart = o.action.kind !== 'Attack' ? null : sameAttack && prev ? prev.attackStart : state.tick;
    this.seen.push({ tick: state.tick, position: o.position, action: o.action, attackStart });
    if (this.seen.length > this.reactionTicks + 1) this.seen.shift();
  }

  intent(state: SimState, fighter: number): Intent {
    this.rng = tickRng(state, fighter);
    const opponent = fighter === 0 ? 1 : 0;
    this.observe(state, opponent);
    // What it may act on: the opponent as it was Reaction Time ago.
    const seen = this.seen[0];
    if (!seen || seen.tick !== state.tick - this.reactionTicks) return IDLE_INTENT;

    const self = state.fighters[fighter]!;
    const dx = seen.position.x - self.position.x;
    const dz = seen.position.z - self.position.z;
    const dist = Math.hypot(dx, dz);
    const base: Intent = { ...IDLE_INTENT, face: Math.atan2(dx, dz) };
    const toward: Vec2 = dist > 0 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 0 };

    if (isThreat(seen.action) && seen.attackStart !== null) return this.defend(self.action, seen.action.direction, seen.attackStart, base);
    this.blockPlan = null;

    if (self.action.kind !== 'Idle') return base; // let go of block/attack; finish what it is doing
    const { attackRange, retreatRange, aggression } = this.tuning.ai;
    if (dist > attackRange) {
      // Mistimed Attack: swinging from out of range.
      if (this.random() < aggression * this.difficulty.mistakeRate) return { ...base, attack: true, direction: this.randomDirection() };
      return { ...base, move: toward };
    }
    if (dist < retreatRange) return { ...base, move: { x: -toward.x, z: -toward.z } };
    // An opening (opponent in Recovery or Staggered) is always punished, unless the AI never attacks (aggression 0).
    if (aggression > 0 && (isOpening(seen.action) || this.random() < aggression)) return { ...base, attack: true, direction: this.randomDirection() };
    return base;
  }

  /** Block the seen Attack, in its Direction unless this Attack's roll made it a mistake. */
  private defend(self: Action, attackDirection: Direction, attackStart: number, base: Intent): Intent {
    if (this.blockPlan?.attackStart !== attackStart) {
      const mistake = this.random() < this.difficulty.mistakeRate;
      this.blockPlan = { attackStart, direction: mistake ? this.randomDirection(attackDirection) : attackDirection };
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
