/**
 * Dev mode only (`?dev=1&autopilot=...`, src/devMode.ts): the local Player's Fighter on an AI, so a Run can be checked in
 * the browser (headless, at a few frames a second) without a human fighting it. While its Hall is Fighting it is the AI
 * at `difficulty`. Once the Hall is cleared it takes the Rest fire if the Hall is a Rest Hall, then walks into the zone
 * of exit `doors[row]` (the list's last for later rows, the Hall's last exit if past it), so the Run takes that Door.
 * It is still a Player's Fighter for the Run (Doors count it), only its Intents come from here.
 *
 * Its own memory (which Rest Halls it rested in) is not saved: it only ever drives a Run stepped locally, with no Rollback.
 */
import { arenaOf, atRestFire, exitDoor, hallKey, inDuel, inExitZone, restFire, type Intent, type SimState } from '../sim';
import type { TuningData } from '../tuning';
import { createAiController, type AiController } from './ai';
import type { Controller } from './controller';

class Autopilot implements Controller {
  private readonly rested = new Set<string>();

  constructor(
    private readonly tuning: TuningData,
    private readonly ai: AiController,
    /** The exit (0-based) to take in each row of a Floor. */
    private readonly doors: readonly number[],
  ) {}

  intent(state: SimState, fighter: number): Intent {
    const self = state.fighters[fighter]!;
    const hall = state.hall;
    if (!hall || hall.phase === 'Fighting' || !inDuel(self)) return this.ai.intent(state, fighter);
    const arena = arenaOf(this.tuning, state.arena);
    const key = hallKey(hall);
    if (hall.kind === 'Rest' && !this.rested.has(key)) {
      if (!atRestFire(arena, self)) return this.ai.walkTo(state, fighter, restFire(arena), 0);
      this.rested.add(key);
    }
    const exits = arena.doors.length - 1;
    if (exits <= 0) return this.ai.walkTo(state, fighter, { x: self.position.x, y: self.y, z: self.position.z }, Infinity);
    const exit = Math.min(this.doors[hall.row] ?? this.doors.at(-1) ?? 0, exits - 1);
    const { spawns } = arena.doors[exitDoor(exit)]!;
    const slot = state.fighters.slice(0, fighter).filter((f) => f.team === self.team).length;
    const spot = (spawns.find((s) => s.slot === slot) ?? spawns[0]!).position;
    return this.ai.walkTo(state, fighter, spot, inExitZone(arena, exit, self) ? Infinity : 0);
  }

  save(): unknown {
    return this.ai.save();
  }

  load(saved: unknown): void {
    this.ai.load(saved);
  }
}

/** The dev autopilot for the local Player's slot: the AI at `difficulty`, taking exit `doors[row]` (0-based) out of each cleared Hall. */
export function createAutopilot(tuning: TuningData, difficulty: string, doors: readonly number[]): Controller {
  return new Autopilot(tuning, createAiController(tuning, difficulty), doors);
}
