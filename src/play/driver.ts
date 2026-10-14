/**
 * Match drivers: the part of the game loop that turns the local player's
 * Intent into Match Ticks. The game loop (Local Controller, camera, HUD,
 * audio) only talks to a MatchDriver, so Player vs AI (`playerVsAi`, steps
 * the Match locally) and Player vs Player (#23: wrap the Rollback session,
 * which already has this shape) plug into the same loop.
 */
import { createMatch, type Intent, type MatchOptions, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, stepMatchWith, type Controller } from '../controllers';

export interface MatchDriver {
  /** The Fighter the local player drives. */
  readonly localFighter: number;
  /** The Controller driving the other Fighter: the AI Controller (Player vs AI) or the Remote Controller (Player vs Player). */
  readonly opponent: Controller;
  /** The Match to render (null until it exists, e.g. while a peer connects). May be predicted. */
  readonly state: MatchState | null;
  /** Feed the local Intent for the next Match Tick. `advanced` is false when no Tick was simulated (stalled, connecting). */
  tick(localIntent: Intent): { advanced: boolean };
  /** Set once the Match cannot go on (opponent gone, Tuning Data mismatch): the message to show the player. */
  readonly failure?: string | null;
  /** A status line while there is nothing to play yet (e.g. connecting to the opponent). */
  readonly waiting?: string | null;
  /** The loop is done with this driver (Match over or abandoned): release its connection. */
  close?(): void;
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
  let pending: Intent | null = null;
  /** The Local Controller's Intent, sampled by the game loop and handed to `tick`. */
  const local: Controller = { intent: () => pending! };
  return {
    localFighter: 0,
    opponent: ai,
    get state() {
      return match;
    },
    tick(localIntent) {
      pending = localIntent;
      match = stepMatchWith(match, [local, ai], tuning);
      return { advanced: true };
    },
  };
}
