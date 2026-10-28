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
import { arenaOf, exitDoor, inDuel, inExitZone, type Intent, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, type AiController } from './ai';
import type { Controller } from './controller';
import { exitDoorSpawn } from './doorSpot';

/** How near (m, across the ground) an Ally AI following a Player stops. */
export const FOLLOW_DISTANCE = 1.5;
/** How near (m, across the ground) to its spot in a Door's zone an Ally AI stops, once inside the zone. */
const DOOR_ARRIVED = 0.3;

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
      // A spot in the zone (one of Team 0's spawns there), so the party stands side by side: its own slot's, unless
      // another Fighter stands on it, then the free one nearest it (ties to the lowest slot).
      const { spawns } = arena.doors[exitDoor(door)]!;
      const taken = (p: { x: number; z: number }) =>
        state.fighters.some((f, i) => i !== fighter && inDuel(f) && Math.hypot(f.position.x - p.x, f.position.z - p.z) < 2 * this.tuning.fighter.radius);
      const own = exitDoorSpawn(arena, door, state, fighter);
      const free = spawns
        .filter((s) => !taken(s.position))
        .map((s) => ({ s, d: Math.hypot(s.position.x - self.position.x, s.position.z - self.position.z) }))
        .sort((a, b) => a.d - b.d || a.s.slot - b.s.slot);
      const spot = (taken(own.position) && free[0] ? free[0].s : own).position;
      // In the zone it stands at its spot, or anywhere once every spot it could take is taken (the zone is crowded).
      const stop = !inExitZone(arena, door, self) ? 0 : taken(spot) ? Infinity : DOOR_ARRIVED;
      return this.ai.walkTo(state, fighter, spot, stop);
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
