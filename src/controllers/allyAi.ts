/**
 * The Ally AI: the Controller of a Run's Team 0 AI slot (docs/plans/delver.md). On a Floor it fights a promoted enemy near it with its own
 * AI, else follows the nearest living Player, so the party goes on together. With no Player alive it walks to the Stairs (the AI allies
 * then take them, `stairsCounters`). It never counts at the Stairs while a Player lives. A Player an AI Takeover has taken (`SimDelver.away`)
 * is no Player to it: not followed. It Sheathes to run while no enemy is near, and Draws as one comes near.
 *
 * It decides from the state alone, and walks with its AI's own navmesh routing (`AiController.walkTo`), so its memory
 * is its AI's memory and Rollback needs nothing more.
 */
import { inDuel, type Intent, type SimState } from '../sim';
import { floorOf } from '../sim/delver';
import type { TuningData } from '../tuning';
import { createAiController, type AiController } from './ai';
import type { Controller } from './controller';

/** How near (m, across the ground) an Ally AI following a Player stops. */
export const FOLLOW_DISTANCE = 1.5;

/**
 * Whether a promoted enemy (a Team 1 Fighter in play bound to a Soldier, or on a Floor any Team 1 Fighter in play: a traitor's too) stands within `bubble.promote` of Fighter `fighter` flat and less than
 * `battle.levels.height` above or below it: on a Floor, the Ally AI and the Delver pilot then fight it with their AI instead of following or walking
 * their route. Reads the state alone.
 */
export function promotedNear(tuning: TuningData, state: SimState, fighter: number): boolean {
  const self = state.fighters[fighter]!;
  const { promote } = tuning.battle.bubble;
  const { height } = tuning.battle.levels;
  return state.fighters.some(
    // (On a Floor a traitor's Fighter counts too, docs/plans/delver.md, Stage 8a: unbound, but an enemy Fighter all the same.)
    (o) => o.team === 1 && (o.soldier !== undefined || state.delver !== undefined) && inDuel(o) && Math.abs(o.y - self.y) < height && Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z) <= promote,
  );
}

/** How near (m, flat) an enemy makes a Sheathed Ally AI on a Floor Draw: a little past `bubble.promote`, so it is drawn before the fight. */
export const DRAW_DISTANCE = 12;
/** How far (m, flat) every enemy must be before an Ally AI on a Floor Sheathes, to run: further than it Draws, so it does not flicker. */
export const SHEATHE_DISTANCE = 16;

/**
 * The nearest living enemy to Fighter `fighter` (m, flat): a Team 1 Fighter in play or a living Soldier of the Crowd's Team 1 (a promoted
 * one is counted by its Fighter). A Fighter more than `battle.levels.height` above or below is not counted. Reads the state alone.
 */
export function nearestEnemy(tuning: TuningData, state: SimState, fighter: number): number {
  const self = state.fighters[fighter]!;
  const { height } = tuning.battle.levels;
  let best = Infinity;
  for (const o of state.fighters) {
    if (o.team !== 1 || !inDuel(o) || Math.abs(o.y - self.y) >= height) continue;
    best = Math.min(best, Math.hypot(o.position.x - self.position.x, o.position.z - self.position.z));
  }
  const c = state.crowd;
  if (c)
    for (let i = 0; i < c.alive.length; i++) {
      if (c.alive[i] !== 1 || c.team[i] !== 1 || c.slot[i]! >= 0) continue;
      best = Math.min(best, Math.hypot(c.x[i]! - self.position.x, c.z[i]! - self.position.z));
    }
  return best;
}

/** Where the j-th living Team 0 Fighter stands from the Stairs zone's centre (m) when no Player lives. */
const STAIRS_DX = [-1, 1, -1, 1];
const STAIRS_DZ = [-1, -1, 1, 1];

class AllyAi implements Controller {
  constructor(
    private readonly tuning: TuningData,
    private readonly ai: AiController,
    /** The Fighters the human Players drive (less, at a Tick, those the state says are away). */
    private readonly players: readonly number[],
  ) {}

  intent(state: SimState, fighter: number): Intent {
    // Only a Run's Floor gives an Ally AI more to do than its AI (a Duel's, outside one).
    return state.delver ? this.onFloor(state, fighter) : this.ai.intent(state, fighter);
  }

  /**
   * On a Delver Run's Floor, while Exploring and in play: a promoted enemy near (`promotedNear`) and it is its AI (it fights). Else it follows the
   * nearest living Player still in the Run, or (none lives) walks to its own spot in the Stairs zone so the Run takes the party down. While
   * Descending, or fallen, it is its AI (it stands). Its Weapon follows the enemies (`sheatheToggle`): Sheathed to run with none near, drawn
   * once one comes near.
   */
  private onFloor(state: SimState, fighter: number): Intent {
    const intent = this.floorIntent(state, fighter);
    return this.sheatheToggle(state, fighter) ? { ...intent, sheathe: true, attack: false, block: false } : intent;
  }

  /**
   * Whether it presses sheathe this Tick, on a Floor while Exploring and Idle: to Sheathe with no enemy within `SHEATHE_DISTANCE`, or to Draw
   * with one within `DRAW_DISTANCE` (or a promoted enemy near). From the state alone: a press only ever starts the Action the state lacks.
   */
  private sheatheToggle(state: SimState, fighter: number): boolean {
    const self = state.fighters[fighter]!;
    if (state.delver!.phase === 'Descending' || !inDuel(self) || self.action.kind !== 'Idle') return false;
    const near = nearestEnemy(this.tuning, state, fighter);
    if (self.sheathed) return near <= DRAW_DISTANCE || promotedNear(this.tuning, state, fighter);
    return near > SHEATHE_DISTANCE && !promotedNear(this.tuning, state, fighter);
  }

  private floorIntent(state: SimState, fighter: number): Intent {
    const self = state.fighters[fighter]!;
    const run = state.delver!;
    if (run.phase === 'Descending' || !inDuel(self) || promotedNear(this.tuning, state, fighter)) return this.ai.intent(state, fighter);
    const away = run.away ?? [];
    const living = this.players.filter((i) => !away.includes(i) && state.fighters[i] !== undefined && inDuel(state.fighters[i]!));
    const nearest = living
      .map((i) => {
        const p = state.fighters[i]!;
        return { p, i, d: Math.hypot(p.position.x - self.position.x, p.y - self.y, p.position.z - self.position.z) };
      })
      .sort((a, b) => a.d - b.d || a.i - b.i)[0];
    if (nearest) return this.ai.walkTo(state, fighter, { x: nearest.p.position.x, y: nearest.p.y, z: nearest.p.position.z }, FOLLOW_DISTANCE);
    const { zone, y } = floorOf(this.tuning, state.arena)!.plan.markers.stairs;
    // Its rank among the living Team 0 Fighters picks the spot, so the party stands in the zone's four quarters rather than on one point.
    let rank = 0;
    for (let i = 0; i < fighter; i++) if (state.fighters[i]!.team === 0 && inDuel(state.fighters[i]!)) rank++;
    const r = rank % 4;
    return this.ai.walkTo(state, fighter, { x: (zone.x0 + zone.x1) / 2 + STAIRS_DX[r]!, y, z: (zone.z0 + zone.z1) / 2 + STAIRS_DZ[r]! }, 0.3);
  }

  save(): unknown {
    return this.ai.save();
  }

  load(saved: unknown): void {
    this.ai.load(saved);
  }
}

/**
 * An Ally AI for a Run's Team 0 AI slot: the AI at `difficulty` playing `style` (with `quirks`, `ai.quirks` names), walking with the party once its Hall is
 * cleared. `players` are the Fighters the human Players drive (`lineupMatch`'s `players`).
 */
export function createAllyAi(tuning: TuningData, difficulty: string, style: string, players: readonly number[], quirks: readonly string[] = []): Controller {
  return new AllyAi(tuning, createAiController(tuning, difficulty, style, { quirks }), players);
}
