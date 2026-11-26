/**
 * The traitor pilot (docs/plans/delver.md, Stage 8a): a traitor's stand-in for tests and the dev `?autopilot` of a traitor. While its slot holds a
 * Soldier it has taken over, it walks to the nearest living party Fighter and, once near, fights with its AI; while it watches, it stands.
 * Its memory is its AI's, plain data in `save`, so Rollback gives the same Intents again.
 */
import { IDLE_INTENT, inDuel, type Intent, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import { aiDifficulty, createAiController, type AiController } from './ai';
import type { Controller } from './controller';

/** How near (m, on the ground) a party Fighter must be for the pilot to fight it rather than walk to it. */
export const TRAITOR_ENGAGE = 8;
/** Where it stops walking short of its quarry (m). */
const STOP = 1.5;

class TraitorPilot implements Controller {
  constructor(private readonly ai: AiController) {}

  intent(state: SimState, fighter: number): Intent {
    const self = state.fighters[fighter];
    if (!self || !inDuel(self) || self.death || state.delver?.phase !== 'Exploring') return IDLE_INTENT;
    let best = -1;
    let bestD = Infinity;
    state.fighters.forEach((f, i) => {
      if (f.team !== 0 || !inDuel(f) || f.death) return;
      const d = Math.hypot(f.position.x - self.position.x, f.position.z - self.position.z);
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0) return IDLE_INTENT;
    if (bestD <= TRAITOR_ENGAGE) return this.ai.intent(state, fighter);
    const q = state.fighters[best]!;
    return this.ai.walkTo(state, fighter, { x: q.position.x, y: q.y, z: q.position.z }, STOP);
  }

  save(): unknown {
    return this.ai.save();
  }

  load(saved: unknown): void {
    this.ai.load(saved);
  }
}

/** A traitor pilot at `difficulty` (default Hard); with `walk`, its routes take no jump Link (as `createDelverPilot`'s, for an Input Delay). */
export function createTraitorPilot(tuning: TuningData, difficulty = 'Hard', options: { readonly walk?: boolean } = {}): Controller {
  return new TraitorPilot(createAiController(tuning, aiDifficulty(tuning, difficulty), undefined, { walk: options.walk === true }));
}
