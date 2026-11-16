/**
 * The Delver pilot: a Player's Fighter on an AI for tests and the dev `?autopilot` on a Delver Run (docs/plans/delver.md, Stage 2). On a
 * Floor it walks to the Rest fires nearest first, one after another, then into the Stairs zone, so the Run takes the party down (on a Boss Floor
 * whose gate is shut, to the Boss's post first: Stage 7c's throne stands away from the Stairs zone). While
 * the Run is Descending, or its Fighter has fallen, it stands. A promoted enemy near (`promotedNear`) it fights with its AI before it walks its
 * route: it does not go round Warbands, it walks through, and fights those the Bubble promotes beside it.
 *
 * Before its fires it walks to the nearest pickup it sees and has room for (a wiped Warband's drop, a pedestal), its fight rule still first.
 *
 * Its memory (the Floor and which fires it has reached) is plain data in `save`, with its AI's, so Rollback and the Editor sandbox
 * give the same Intents again.
 */
import { IDLE_INTENT, inDuel, pickupVisibleTo, type Dropped, type Intent, type Inventory, type SimState } from '../sim';
import { floorOf } from '../sim/delver';
import { BOSS } from '../sim/warband';
import type { TuningData } from '../tuning';
import { aiDifficulty, createAiController, type AiController } from './ai';
import { promotedNear } from './allyAi';
import type { Controller } from './controller';

/** How near (m, on the ground) the pilot must come for a fire to count as reached. */
export const FIRE_REACH = 1;
/** Where it stops short of a fire (m): inside `FIRE_REACH`, so walking to a fire always reaches it. */
const FIRE_STOP = 0.5;
/** Where it stops short of a pickup (m): inside `PICKUP_RADIUS`, so walking to one always takes it. */
const PICKUP_STOP = 0.2;
/** Where it stops in the Stairs zone (m from its centre). */
const STAIRS_STOP = 0.3;

/** Whether `inventory` has room for `item`: `addItem`'s rule (fewer Weapons held than `sizes.weapons`, or fewer Relics than `sizes.relics`), by counts. */
const hasRoom = (inventory: Inventory, item: Dropped, sizes: TuningData['dungeon']['inventory']): boolean =>
  item.kind === 'weapon' ? inventory.weapons.length < sizes.weapons : inventory.relics.length < sizes.relics;

/** Whether the Floor's Boss Warband (rank BOSS) has a Soldier alive: until it is wiped the Boss Floor's gate stays shut. */
function bossLives(state: SimState): boolean {
  const c = state.crowd;
  const q = c?.warbands?.rank.indexOf(BOSS) ?? -1;
  return q >= 0 && c!.squad.some((s, i) => s === q && c!.alive[i] === 1);
}

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
    // Loot it sees (its own and shared ones) and has room for comes before its fires: the nearest in a straight line, the lower id on a tie.
    const inventory = self.inventory;
    let loot: (typeof run.pickups)[number] | undefined;
    if (inventory)
      for (const p of run.pickups)
        if (pickupVisibleTo(p, fighter) && hasRoom(inventory, p, this.tuning.dungeon.inventory) && (!loot || dist(p.at) < dist(loot.at))) loot = p;
    if (loot) return this.ai.walkTo(state, fighter, { x: loot.at.x, y: loot.at.y, z: loot.at.z }, PICKUP_STOP);
    let target = -1;
    markers.fires.forEach((fire, k) => {
      if (!this.memory.reached.includes(k) && (target < 0 || dist(fire) < dist(markers.fires[target]!))) target = k;
    });
    if (target >= 0) {
      const fire = markers.fires[target]!;
      return this.ai.walkTo(state, fighter, { x: fire.x, y: fire.y, z: fire.z }, FIRE_STOP);
    }
    // On a Boss Floor while its gate is shut, it goes up to the Boss's post (a throne may stand beyond a Warband's sight of the Stairs zone), so the two meet.
    if (markers.boss && bossLives(state)) return this.ai.walkTo(state, fighter, { x: markers.boss.x, y: markers.boss.y, z: markers.boss.z }, STAIRS_STOP);
    const { zone, y } = markers.stairs;
    return this.ai.walkTo(state, fighter, { x: (zone.x0 + zone.x1) / 2, y, z: (zone.z0 + zone.z1) / 2 }, STAIRS_STOP);
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

/** How a Delver pilot is made (`createDelverPilot`). */
export interface DelverPilotOptions {
  /**
   * It walks: its routes take no jump Link (its AI's `jumpNav` −1), only Ramps and drops, which reach every Walk Surface of a Floor (the judge's
   * walk check). For a pilot played through an Input Delay (online, docs/plans/delver.md, Stage 8): its Jump, timed at the takeoff, is played Ticks
   * later from beyond it, falls short of the Deck it was for, and it walks back and tries again for ever.
   */
  readonly walk?: boolean;
}

/**
 * A Delver pilot at `difficulty` (default Hard): fires nearest first, then the Stairs. It stops 0.5 m short of a fire (it counts as
 * reached within 1 m, `FIRE_REACH`), so a fire is always reached; the Stairs it walks to the zone's centre, 0.3 m.
 */
export function createDelverPilot(tuning: TuningData, difficulty = 'Hard', options: DelverPilotOptions = {}): Controller {
  const skill = aiDifficulty(tuning, difficulty);
  return new DelverPilot(tuning, createAiController(tuning, options.walk ? { ...skill, jumpNav: -1 } : skill));
}
