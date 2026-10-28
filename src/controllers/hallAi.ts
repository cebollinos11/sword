/**
 * The Hall AI: the Controller of one Team 1 slot of a Gauntlet Run (docs/plans/dungeon.md). The slot keeps it for the
 * whole Run, while each Hall decides who stands there: it reads the Hall from `state.hall`, plays its Encounter's
 * difficulty and Style for its slot (Tuning Data `dungeon.floors`, a `"random"` Style picked from the Run seed by
 * `hallRoster`), and starts that Hall's AI from fresh memory whenever the Hall changes. A slot the Hall leaves empty is
 * Benched, and its Hall AI asks for nothing. The Run's Team 0 AI slots get Ally AIs instead (`allyAi.ts`).
 */
import { hallKey, hallRoster, IDLE_INTENT, type HallRef, type Intent, type SimState } from '../sim';
import { DEFAULT_STYLE, type TuningData } from '../tuning';
import { createAiController } from './ai';
import type { Controller } from './controller';

/** A Hall AI's memory: the Hall it last saw (`hallKey`, '' before its first) and that Hall's AI's memory (null when the slot has no enemy). */
interface HallAiMemory {
  readonly hall: string;
  readonly memory: unknown;
}

class HallAi implements Controller {
  /** One AI Controller per difficulty and Style, made on first use, with the memory it was made with. */
  private readonly ais = new Map<string, { readonly ai: Controller; readonly fresh: unknown }>();
  private hall = '';
  /** The current Hall's AI, or null when the Hall has no enemy for this slot. */
  private current: Controller | null = null;

  constructor(
    private readonly tuning: TuningData,
    /** Which Team 1 slot (0-based, in Fighter order) it drives. */
    private readonly slot: number,
    /** The Run's first Arena (its seed is the Run seed). */
    private readonly arena: string,
  ) {}

  /** The AI that plays Hall `at`'s enemy for this slot, its memory as fresh as when it was made; null when the Hall has none. */
  private aiFor(at: HallRef): Controller | null {
    let enemy;
    try {
      enemy = hallRoster(this.tuning, { arena: this.arena, humans: 1 }, at)[this.slot];
    } catch {
      return null;
    }
    if (!enemy) return null;
    const style = enemy.style ?? DEFAULT_STYLE;
    const key = `${enemy.difficulty}/${style}`;
    let kept = this.ais.get(key);
    if (!kept) {
      const ai = createAiController(this.tuning, enemy.difficulty, style);
      this.ais.set(key, (kept = { ai, fresh: ai.save?.() }));
    }
    kept.ai.load?.(kept.fresh);
    return kept.ai;
  }

  intent(state: SimState, fighter: number): Intent {
    const at = state.hall ?? { floor: 1, row: 0, index: 0 };
    const key = hallKey(at);
    if (key !== this.hall) {
      this.hall = key;
      this.current = this.aiFor(at);
    }
    if (!this.current || state.fighters[fighter]?.benched) return IDLE_INTENT;
    return this.current.intent(state, fighter);
  }

  save(): HallAiMemory {
    return { hall: this.hall, memory: this.current?.save?.() ?? null };
  }

  load(saved: unknown): void {
    const { hall, memory } = saved as HallAiMemory;
    this.hall = hall;
    const [floor, row, index] = hall.split(':').map(Number);
    this.current = hall === '' ? null : this.aiFor({ floor: floor!, row: row!, index: index! });
    if (this.current && memory !== null) this.current.load?.(memory);
  }
}

/** A Hall AI for Team 1 slot `slot` (0-based) of a Gauntlet Run whose first Arena is `arena` (default `arena.match`, as `createMatch`'s). */
export function createHallAi(tuning: TuningData, slot: number, arena: string = tuning.arena.match): Controller {
  return new HallAi(tuning, slot, arena);
}
