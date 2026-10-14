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
 * Deterministic: its only randomness is the Simulation's seeded generator
 * (`createRng`/`nextFloat`), seeded from the Duel state's `rng` and the
 * Fighter index on first use, then advanced by the Controller. So a given
 * seed and the same opponent always give the same Intents.
 */
import {
  createRng,
  DIRECTIONS,
  IDLE_INTENT,
  nextFloat,
  TICK_RATE,
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

/** The AI Controller's memory (its generator and what it has seen), saved and loaded by the Editor sandbox. */
interface AiMemory {
  readonly rng: RngState | null;
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

class AiController implements Controller {
  private readonly reactionTicks: number;
  private rng: RngState | null = null;
  /** Observations of the opponent, oldest first; only the last reactionTicks + 1 are kept. */
  private seen: Observation[] = [];
  private lastTick = -1;
  /** The Block Direction chosen for one opponent Attack (rolled once, so a mistake sticks). */
  private blockPlan: { readonly attackStart: number; readonly direction: Direction } | null = null;

  constructor(
    private readonly tuning: TuningData,
    private readonly difficulty: AiDifficulty,
  ) {
    this.reactionTicks = Math.round(difficulty.reactionTime * TICK_RATE);
  }

  /** All of the Controller's memory, as plain data (observations are immutable, so a shallow array copy is enough). */
  save(): AiMemory {
    return { rng: this.rng, seen: [...this.seen], lastTick: this.lastTick, blockPlan: this.blockPlan };
  }

  load(saved: unknown): void {
    const m = saved as AiMemory;
    this.rng = m.rng;
    this.seen = [...m.seen];
    this.lastTick = m.lastTick;
    this.blockPlan = m.blockPlan;
  }

  private random(): number {
    const [v, next] = nextFloat(this.rng!);
    this.rng = next;
    return v;
  }

  private randomDirection(except?: Direction): Direction {
    const options = DIRECTIONS.filter((d) => d !== except);
    return options[Math.min(options.length - 1, Math.floor(this.random() * options.length))]!;
  }

  private observe(state: SimState, opponent: number): void {
    if (state.tick <= this.lastTick) {
      // A new Duel: forget what was seen (the generator carries on).
      this.seen = [];
      this.blockPlan = null;
    }
    this.lastTick = state.tick;
    const o = state.fighters[opponent]!;
    const prev = this.seen[this.seen.length - 1];
    const attackStart = o.action.kind !== 'Attack' ? null : prev?.action.kind === 'Attack' ? prev.attackStart : state.tick;
    this.seen.push({ tick: state.tick, position: o.position, action: o.action, attackStart });
    if (this.seen.length > this.reactionTicks + 1) this.seen.shift();
  }

  intent(state: SimState, fighter: number): Intent {
    this.rng ??= createRng(state.rng.seed ^ Math.imul(fighter + 1, 0x9e3779b9));
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
  private defend(self: Action, direction: Direction, attackStart: number, base: Intent): Intent {
    if (this.blockPlan?.attackStart !== attackStart) {
      const mistake = this.random() < this.difficulty.mistakeRate;
      this.blockPlan = { attackStart, direction: mistake ? this.randomDirection(direction) : direction };
    }
    const guard = this.blockPlan.direction;
    // A Block's Direction is fixed on press: drop a wrong guard for a Tick, then raise the right one.
    if (self.kind === 'Block' && self.direction !== guard) return base;
    // Mid-Attack it cannot Block; letting go of attack at least Releases the Wind-up.
    return { ...base, block: true, direction: guard };
  }
}

/** A rule-based AI Controller with the given difficulty (a preset from `tuning.ai.difficulties`, or explicit values). */
export function createAiController(tuning: TuningData, difficulty: AiDifficulty | string): Controller {
  return new AiController(tuning, typeof difficulty === 'string' ? aiDifficulty(tuning, difficulty) : difficulty);
}
