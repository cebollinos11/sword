/**
 * The Battle autopilot (docs/plans/big-battle.md, Stage 5): a Player's Fighter in a Battle driven by an AI, for the soak
 * tests, the tuning runs and the dev page's scripted Battles. While an enemy full Fighter is in the Duel it is the AI at
 * `difficulty` (and `style`); with none it walks at the nearest living enemy Soldier in the Crowd (or stands, with none left), so it
 * goes where the fighting is, as a Player would. After a takeover it drives the Soldier it took over, as the Local
 * Controller does.
 *
 * It reads only the Simulation state, and its memory is the AI's, so a Rollback re-simulates the same Intents.
 */
import { DEFAULT_STYLE, type AiStyle, type TuningData } from '../tuning';
import { IDLE_INTENT, inDuel, type Intent, type SimState } from '../sim';
import { createAiController } from './ai';
import type { Controller } from './controller';

class BattlePilot implements Controller {
  private readonly ai: Controller;

  constructor(tuning: TuningData, difficulty: string, style: AiStyle | string) {
    this.ai = createAiController(tuning, difficulty, style);
  }

  intent(state: SimState, fighter: number): Intent {
    const self = state.fighters[fighter];
    const crowd = state.crowd;
    if (!self || !inDuel(self) || !crowd) return this.ai.intent(state, fighter);
    if (state.fighters.some((f) => inDuel(f) && f.team !== self.team)) return this.ai.intent(state, fighter);
    let best = -1;
    let bestD = Infinity;
    for (let s = 0; s < crowd.x.length; s++) {
      if (!crowd.alive[s] || crowd.team[s] === self.team) continue;
      const d = Math.hypot(crowd.x[s]! - self.position.x, crowd.z[s]! - self.position.z);
      if (d < bestD) [best, bestD] = [s, d];
    }
    // Keep the AI's clock running, so it is not caught out when an enemy steps up.
    this.ai.intent(state, fighter);
    if (best < 0 || bestD < 1e-6) return IDLE_INTENT;
    const dx = (crowd.x[best]! - self.position.x) / bestD;
    const dz = (crowd.z[best]! - self.position.z) / bestD;
    return { ...IDLE_INTENT, move: { x: dx, z: dz }, face: Math.atan2(dx, dz) };
  }

  save(): unknown {
    return this.ai.save?.();
  }

  load(saved: unknown): void {
    this.ai.load?.(saved);
  }
}

/** A Battle autopilot for a Player's slot, its AI at `difficulty` (and `style`). */
export function createBattlePilot(tuning: TuningData, difficulty: string, style: AiStyle | string = DEFAULT_STYLE): Controller {
  return new BattlePilot(tuning, difficulty, style);
}
