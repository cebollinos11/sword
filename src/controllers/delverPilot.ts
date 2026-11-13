/**
 * The Delver pilot: a Player's Fighter on an AI for tests and the dev `?autopilot` on a Delver Run (docs/plans/delver.md, Stage 2). On a
 * Floor it walks to the Rest fires nearest first, one after another, then into the Stairs zone, so the Run takes the party down. While
 * the Run is Descending, or its Fighter has fallen, it stands. A promoted enemy near (`promotedNear`) it fights with its AI before it walks its
 * route: it does not go round Warbands, it walks through, and fights those the Bubble promotes beside it.
 *
 * Its memory (the Floor and which fires it has reached) is plain data in `save`, with its AI's, so Rollback and the Editor sandbox
 * give the same Intents again.
 */
import { IDLE_INTENT, inDuel, type Intent, type SimState } from '../sim';
import { floorOf } from '../sim/delver';
import type { TuningData } from '../tuning';
import { createAiController, type AiController } from './ai';
import { promotedNear } from './allyAi';
import type { Controller } from './controller';

/** How near (m, on the ground) the pilot must come for a fire to count as reached. */
export const FIRE_REACH = 1;
/** Where it stops short of a fire (m): inside `FIRE_REACH`, so walking to a fire always reaches it. */
const FIRE_STOP = 0.5;
/** Where it stops in the Stairs zone (m from its centre). */
const STAIRS_STOP = 0.3;

/** The pilot's memory: the Floor it is on and the fires (plan order) it has reached. */
interface PilotMemory {
  floor: number;
  reached: number[];
}

class DelverPilot implements Controller {
  private memory: PilotMemory = { floor: 0, reached: [] };

  constructor(
    private readonly tuning: TuningData,
    private readonly ai: AiController,
  ) {}

  intent(state: SimState, fighter: number): Intent {
    const run = state.delver;
    const self = state.fighters[fighter]!;
    if (!run || run.phase === 'Descending' || !inDuel(self)) return IDLE_INTENT;
    if (this.memory.floor !== run.floor) this.memory = { floor: run.floor, reached: [] };
    const { markers } = floorOf(this.tuning, state.arena)!.plan;
    const dist = (p: { readonly x: number; readonly z: number }): number => Math.hypot(p.x - self.position.x, p.z - self.position.z);
    // A fire it fights at counts as reached, so this comes before it turns to a promoted enemy near.
    markers.fires.forEach((fire, k) => {
      if (!this.memory.reached.includes(k) && dist(fire) <= FIRE_REACH) this.memory.reached.push(k);
    });
    if (promotedNear(this.tuning, state, fighter)) return this.ai.intent(state, fighter);
    let target = -1;
    markers.fires.forEach((fire, k) => {
      if (!this.memory.reached.includes(k) && (target < 0 || dist(fire) < dist(markers.fires[target]!))) target = k;
    });
    if (target >= 0) {
      const fire = markers.fires[target]!;
      return this.ai.walkTo(state, fighter, { x: fire.x, y: 0, z: fire.z }, FIRE_STOP);
    }
    const { zone } = markers.stairs;
    return this.ai.walkTo(state, fighter, { x: (zone.x0 + zone.x1) / 2, y: 0, z: (zone.z0 + zone.z1) / 2 }, STAIRS_STOP);
  }

  save(): unknown {
    return { floor: this.memory.floor, reached: [...this.memory.reached], ai: this.ai.save() };
  }

  load(saved: unknown): void {
    const { floor, reached, ai } = saved as PilotMemory & { ai: unknown };
    this.memory = { floor, reached: [...reached] };
    this.ai.load(ai);
  }
}

/**
 * A Delver pilot at `difficulty` (default Hard): fires nearest first, then the Stairs. It stops 0.5 m short of a fire (it counts as
 * reached within 1 m, `FIRE_REACH`), so a fire is always reached; the Stairs it walks to the zone's centre, 0.3 m.
 */
export function createDelverPilot(tuning: TuningData, difficulty = 'Hard'): Controller {
  return new DelverPilot(tuning, createAiController(tuning, difficulty));
}
