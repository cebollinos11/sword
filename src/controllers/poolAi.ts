/**
 * The Pool AI: the Controller of one Fighter Pool slot of a Battle (docs/plans/big-battle.md, Stage 3). The slot keeps it
 * for the whole Battle, while the Bubbles decide which Soldier, if any, stands there (`FighterState.soldier`). Each
 * Promotion starts a soldier's AI (its Troop's difficulty, `battle.troops`, with its Troop's Style when it has one, as a Boss's, else the Battle-only `battle.soldier.style`) from fresh memory on the slot's first Tick bound to that Soldier, as an AI Takeover
 * starts one at its Tick, so every peer's AI decides alike; a Demotion drops it. An unbound slot asks for nothing.
 *
 * Its memory is the binding it plays for (the Soldier and its Promotion Tick) and that AI's memory, so a Rollback across
 * a Promotion or a Demotion re-simulates the same Intents.
 */
import { IDLE_INTENT, troopOf, type Intent, type SimState, type SoldierBinding } from '../sim';
import { arenaTuning } from '../sim/delver';
import type { TuningData } from '../tuning';
import { createAiController } from './ai';
import type { Controller } from './controller';

/** The difficulty a promoted Soldier plays by default (Elites are Later); Tuning Data `battle.troops` says which for each Troop, and `battle.soldier` the Battle-only Style. */
export const SOLDIER_DIFFICULTY = 'Beginner';

/** A Pool AI's memory: the binding its AI plays for, at which difficulty and in which Style, and that AI's memory, or null while its slot is unbound. */
type PoolAiMemory = { readonly bound: SoldierBinding; readonly difficulty: string; readonly style: string; readonly memory: unknown } | null;

class PoolAi implements Controller {
  private bound: SoldierBinding | null = null;
  /** The difficulty the bound Soldier's AI plays (its Troop's). */
  private difficulty = '';
  /** The Style the bound Soldier's AI plays: its Troop's name, or '' for the Battle's own. */
  private style = '';
  /** One AI per (difficulty, Style), made the first time a Troop of it is bound, with its memory as fresh as when it was made: each Promotion starts from it. */
  private readonly ais = new Map<string, { readonly ai: Controller; readonly fresh: unknown }>();

  constructor(private readonly tuning: TuningData) {}

  /** An AI of `difficulty` and Style name `style` ('' for the Battle's own, `battle.soldier.style`) from fresh memory (the same Controller each time for that pair, its memory reset). */
  private freshAi(difficulty: string, style: string): Controller {
    this.difficulty = difficulty;
    this.style = style;
    const key = `${difficulty}\n${style}`;
    const made = this.ais.get(key);
    if (made) {
      made.ai.load?.(made.fresh);
      return made.ai;
    }
    const ai = createAiController(this.tuning, difficulty, style === '' ? this.tuning.battle.soldier.style : style);
    this.ais.set(key, { ai, fresh: ai.save?.() });
    return ai;
  }

  private get ai(): Controller {
    return this.ais.get(`${this.difficulty}\n${this.style}`)!.ai;
  }

  intent(state: SimState, fighter: number): Intent {
    const b = state.fighters[fighter]?.soldier;
    if (!b) {
      this.bound = null;
      return IDLE_INTENT;
    }
    if (!this.bound || this.bound.index !== b.index || this.bound.since !== b.since) {
      this.bound = b;
      // A Floor's Crowd indexes the Floor's Troops (its Bosses' and elites' too): read them under the Floor's Tuning Data.
      const battle = arenaTuning(this.tuning, state.arena).battle;
      const troop = state.crowd ? troopOf(battle, state.crowd, b.index) : undefined;
      this.freshAi(troop?.difficulty ?? battle.soldier.difficulty, troop?.style ?? '');
    }
    return this.ai.intent(state, fighter);
  }

  save(): PoolAiMemory {
    return this.bound ? { bound: this.bound, difficulty: this.difficulty, style: this.style, memory: this.ai.save?.() } : null;
  }

  load(saved: unknown): void {
    const m = saved as PoolAiMemory;
    this.bound = m?.bound ?? null;
    if (m) this.freshAi(m.difficulty, m.style).load?.(m.memory);
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
