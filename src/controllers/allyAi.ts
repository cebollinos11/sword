/**
 * The Ally AI: the Controller of a Gauntlet Run's Team 0 AI slot (docs/plans/dungeon.md, "AI in a Hall"). While its
 * Hall is Fighting it is that slot's ordinary AI. Once the Hall is cleared it walks to the exit Door with the most
 * living Players standing in its zone (ties to the lowest exit), else follows the nearest living Player, so the party
 * can leave together. With no Player alive it makes for the first exit (the AI allies then decide the Door,
 * `doorCounters`). It never counts towards a Door while a Player lives. A Player an AI Takeover has taken (`SimHall.away`)
 * is no Player to it: not followed, not a Door to gather at.
 *
 * It decides from the state alone, and walks with its AI's own navmesh routing (`AiController.walkTo`), so its memory
 * is its AI's memory and Rollback needs nothing more.
 */
import { arenaOf, inDuel, inExitZone, type Intent, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, type AiController } from './ai';
import type { Controller } from './controller';
import { exitDoorWalk } from './doorSpot';

/** How near (m, across the ground) an Ally AI following a Player stops. */
export const FOLLOW_DISTANCE = 1.5;

class AllyAi implements Controller {
  constructor(
    private readonly tuning: TuningData,
    private readonly ai: AiController,
    /** The Fighters the human Players drive (less, at a Tick, those the state says are away). */
    private readonly players: readonly number[],
  ) {}

  intent(state: SimState, fighter: number): Intent {
    const self = state.fighters[fighter]!;
    if (!state.hall || state.hall.phase === 'Fighting' || !inDuel(self)) return this.ai.intent(state, fighter);
    const arena = arenaOf(this.tuning, state.arena);
    // A Hall's Arena has a Door for its entrance and one for each of its exits.
    const exits = Math.max(0, arena.doors.length - 1);
    // The Players still in the Run: one an AI has taken over (`SimHall.away`, read off the state so it rolls back) is an ally like any other.
    const away = state.hall.away ?? [];
    const living = this.players.filter((i) => !away.includes(i) && state.fighters[i] !== undefined && inDuel(state.fighters[i]!));
    let door = -1;
    let most = 0;
    for (let exit = 0; exit < exits; exit++) {
      const here = living.filter((i) => inExitZone(arena, exit, state.fighters[i]!)).length;
      if (here > most) [door, most] = [exit, here];
    }
    if (door < 0 && living.length === 0 && exits > 0) door = 0;
    if (door >= 0) {
      // On into the zone, to its own spot there (one of the four in doorSpot.ts, or the free one nearest it if a Fighter stands on it), so the
      // party leaves the zone's entrance and its lane clear for whoever comes in last; and, in the zone, anywhere once it is crowded.
      const { to, stop, shove } = exitDoorWalk(arena, door, state, fighter, this.tuning.fighter.radius);
      return this.ai.walkTo(state, fighter, to, stop, shove);
    }
    const nearest = living
      .map((i) => {
        const p = state.fighters[i]!;
        return { i, p, d: Math.hypot(p.position.x - self.position.x, p.y - self.y, p.position.z - self.position.z) };
      })
      .sort((a, b) => a.d - b.d || a.i - b.i)[0];
    // No Player, no exit (the last Boss's Hall): stand.
    const to = nearest ? { x: nearest.p.position.x, y: nearest.p.y, z: nearest.p.position.z } : { x: self.position.x, y: self.y, z: self.position.z };
    return this.ai.walkTo(state, fighter, to, nearest ? FOLLOW_DISTANCE : Infinity);
  }

  save(): unknown {
    return this.ai.save();
  }

  load(saved: unknown): void {
    this.ai.load(saved);
  }
}

/**
 * An Ally AI for a Run's Team 0 AI slot: the AI at `difficulty` playing `style`, walking with the party once its Hall is
 * cleared. `players` are the Fighters the human Players drive (`lineupMatch`'s `players`).
 */
export function createAllyAi(tuning: TuningData, difficulty: string, style: string, players: readonly number[]): Controller {
  return new AllyAi(tuning, createAiController(tuning, difficulty, style), players);
}
