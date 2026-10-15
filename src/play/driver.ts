/**
 * Match drivers: the part of the game loop that turns the local player's
 * Intent into Match Ticks. The game loop (Local Controller, camera, HUD,
 * audio) only talks to a MatchDriver, so Player vs AI (`playerVsAi`, steps
 * the Match locally) and Player vs Player (#23: wrap the Rollback session,
 * which already has this shape) plug into the same loop.
 */
import { createMatch, type Intent, type MatchOptions, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { checkLineup, lineupAis, lineupMatch, playerFighter, stepMatchWith, type Controller, type Lineup } from '../controllers';

export interface MatchDriver {
  /** The Fighter the local player drives (-1 until known, e.g. while a guest connects). */
  readonly localFighter: number;
  /** Who fights (null until known, e.g. while a guest connects). */
  readonly lineup: Lineup | null;
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

/** A Player vs AI Match: who fights (Player 0 and AI Fighters on two teams), the player's Weapon, and the Match options. */
export interface PlayerVsAiOptions extends MatchOptions {
  readonly lineup: Lineup;
  /** The player's Weapon (a Tuning Data Weapon name). */
  readonly weapon: string;
}

/** A Player vs AI Match stepped locally: the player drives their slot of the Lineup, an AI Controller every other. Throws on an invalid Lineup. */
export function playerVsAi(tuning: TuningData, options: PlayerVsAiOptions): MatchDriver {
  const { lineup, weapon, ...matchOptions } = options;
  checkLineup(tuning, lineup, 1);
  const me = playerFighter(lineup, 0);
  let match = createMatch(tuning, lineupMatch(tuning, lineup, [weapon], matchOptions));
  let pending: Intent | null = null;
  /** The Local Controller's Intent, sampled by the game loop and handed to `tick`. */
  const local: Controller = { intent: () => pending! };
  const controllers = lineupAis(tuning, lineup).map((ai) => ai ?? local);
  return {
    localFighter: me,
    lineup,
    get state() {
      return match;
    },
    tick(localIntent) {
      pending = localIntent;
      match = stepMatchWith(match, controllers, tuning);
      return { advanced: true };
    },
  };
}
