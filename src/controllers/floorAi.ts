/**
 * The Floor AI: the Controller of one Team 1 slot of a Gauntlet Run (docs/plans/gauntlet.md). The slot keeps it for the
 * whole Run, while each Floor decides who stands there: it reads the Floor from `state.floor`, plays that Floor's
 * difficulty for its slot (Tuning Data `gauntlet.floors`), and starts that Floor's AI from fresh memory whenever the Floor
 * changes. A slot the Floor leaves empty is Benched, and its Floor AI asks for nothing.
 */
import { IDLE_INTENT, type Intent, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController } from './ai';
import type { Controller } from './controller';

/** A Floor AI's memory: the Floor it last saw (-1 before its first) and that Floor's AI's memory (null when the slot has no enemy). */
interface FloorAiMemory {
  readonly floor: number;
  readonly memory: unknown;
}

class FloorAi implements Controller {
  /** One AI Controller per difficulty, made on first use, with the memory it was made with. */
  private readonly ais = new Map<string, { readonly ai: Controller; readonly fresh: unknown }>();
  private floor = -1;
  /** The current Floor's AI, or null when the Floor has no enemy for this slot. */
  private current: Controller | null = null;

  constructor(
    private readonly tuning: TuningData,
    /** Which Team 1 slot (0-based, in Fighter order) it drives. */
    private readonly slot: number,
  ) {}

  /** The AI that plays `floor`'s enemy for this slot, its memory as fresh as when it was made; null when the Floor has none. */
  private aiFor(floor: number): Controller | null {
    const difficulty = this.tuning.gauntlet.floors[floor - 1]?.enemies[this.slot]?.difficulty;
    if (difficulty === undefined) return null;
    let kept = this.ais.get(difficulty);
    if (!kept) {
      const ai = createAiController(this.tuning, difficulty);
      this.ais.set(difficulty, (kept = { ai, fresh: ai.save?.() }));
    }
    kept.ai.load?.(kept.fresh);
    return kept.ai;
  }

  intent(state: SimState, fighter: number): Intent {
    const floor = state.floor ?? 1;
    if (floor !== this.floor) {
      this.floor = floor;
      this.current = this.aiFor(floor);
    }
    if (!this.current || state.fighters[fighter]?.benched) return IDLE_INTENT;
    return this.current.intent(state, fighter);
  }

  save(): FloorAiMemory {
    return { floor: this.floor, memory: this.current?.save?.() ?? null };
  }

  load(saved: unknown): void {
    const { floor, memory } = saved as FloorAiMemory;
    this.floor = floor;
    this.current = floor < 1 ? null : this.aiFor(floor);
    if (this.current && memory !== null) this.current.load?.(memory);
  }
}

/** A Floor AI for Team 1 slot `slot` (0-based) of a Gauntlet Run. */
export function createFloorAi(tuning: TuningData, slot: number): Controller {
  return new FloorAi(tuning, slot);
}
