/**
 * Match drivers: the part of the game loop that turns the local player's
 * Intent into Match Ticks. The game loop (Local Controller, camera, HUD,
 * audio) only talks to a MatchDriver, so Player vs AI (`playerVsAi`, steps
 * the Match locally) and Player vs Player (#23: wrap the Rollback session,
 * which already has this shape) plug into the same loop.
 */
import { createMatch, stepMatch, type Intent, type MatchOptions, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, type Controller } from '../controllers';

export interface MatchDriver {
  /** The Fighter the local player drives. */
  readonly localFighter: number;
  /** The Match to render (null until it exists, e.g. while a peer connects). May be predicted. */
  readonly state: MatchState | null;
  /** Feed the local Intent for the next Match Tick. `advanced` is false when no Tick was simulated (stalled, connecting). */
  tick(localIntent: Intent): { advanced: boolean };
}

export interface PlayerVsAiOptions extends MatchOptions {
  /** An AI difficulty preset name from Tuning Data (`ai.difficulties`). */
  readonly difficulty: string;
}

/** A Player vs AI Match stepped locally: the player is Fighter 0, the AI Controller Fighter 1. */
export function playerVsAi(tuning: TuningData, options: PlayerVsAiOptions): MatchDriver {
  const { difficulty, ...matchOptions } = options;
  const ai: Controller = createAiController(tuning, difficulty);
  let match = createMatch(tuning, matchOptions);
  return {
    localFighter: 0,
    get state() {
      return match;
    },
    tick(localIntent) {
      match = stepMatch(match, [localIntent, ai.intent(match.duel, 1)], tuning);
      return { advanced: true };
    },
  };
}
