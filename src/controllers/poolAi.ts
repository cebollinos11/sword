/**
 * The Pool AI: the Controller of one Fighter Pool slot of a Battle (docs/plans/big-battle.md, Stage 3). The slot keeps it
 * for the whole Battle, while the Bubbles decide which Soldier, if any, stands there (`FighterState.soldier`). Each
 * Promotion starts a soldier's AI (`battle.soldier.difficulty`, with its Battle-only `style`) from fresh memory on the slot's first Tick bound to that Soldier, as an AI Takeover
 * starts one at its Tick, so every peer's AI decides alike; a Demotion drops it. An unbound slot asks for nothing.
 *
 * Its memory is the binding it plays for (the Soldier and its Promotion Tick) and that AI's memory, so a Rollback across
 * a Promotion or a Demotion re-simulates the same Intents.
 */
import { IDLE_INTENT, type Intent, type SimState, type SoldierBinding } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController } from './ai';
import type { Controller } from './controller';

/** The difficulty every promoted Soldier plays by default (Elites are Later); Tuning Data `battle.soldier` says which, and its Battle-only Style. */
export const SOLDIER_DIFFICULTY = 'Beginner';

/** A Pool AI's memory: the binding its AI plays for and that AI's memory, or null while its slot is unbound. */
type PoolAiMemory = { readonly bound: SoldierBinding; readonly memory: unknown } | null;

class PoolAi implements Controller {
  private bound: SoldierBinding | null = null;
  private ai: Controller | null = null;
  /** A Beginner AI's memory as fresh as when it was made: each Promotion starts from it. */
  private fresh: unknown = undefined;

  constructor(private readonly tuning: TuningData) {}

  /** A Beginner AI from fresh memory (the same Controller each time, its memory reset). */
  private freshAi(): Controller {
    if (!this.ai) {
      const { difficulty, style } = this.tuning.battle.soldier;
      this.ai = createAiController(this.tuning, difficulty, style);
      this.fresh = this.ai.save?.();
    } else this.ai.load?.(this.fresh);
    return this.ai;
  }

  intent(state: SimState, fighter: number): Intent {
    const b = state.fighters[fighter]?.soldier;
    if (!b) {
      this.bound = null;
      return IDLE_INTENT;
    }
    if (!this.bound || this.bound.index !== b.index || this.bound.since !== b.since) {
      this.bound = b;
      this.freshAi();
    }
    return this.ai!.intent(state, fighter);
  }

  save(): PoolAiMemory {
    return this.bound ? { bound: this.bound, memory: this.ai!.save?.() } : null;
  }

  load(saved: unknown): void {
    const m = saved as PoolAiMemory;
    this.bound = m?.bound ?? null;
    if (m) this.freshAi().load?.(m.memory);
  }
}

/** A Pool AI for one slot of a Battle's Fighter Pool. */
export function createPoolAi(tuning: TuningData): Controller {
  return new PoolAi(tuning);
}

/**
 * The Controllers of a Battle's Fighter Pool of `poolSize` slots: `players[k]` drives slot k (the Players' Fighters, first),
 * and a Pool AI every other slot.
 */
export function poolControllers(tuning: TuningData, players: readonly Controller[], poolSize = tuning.battle.bubble.poolSize): Controller[] {
  return Array.from({ length: poolSize }, (_, k) => players[k] ?? createPoolAi(tuning));
}
