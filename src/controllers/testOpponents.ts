/**
 * Test opponents for the Editor sandbox: Controllers that stand still so a
 * player can try their attacks against a fixed answer. Not AI difficulties
 * (they are not Tuning Data and the game's menu never offers them).
 *
 *  - Dummy: never moves, attacks or blocks.
 *  - Wall: never moves or attacks; always faces its opponent and holds a Block
 *    in the Direction that meets the opponent's current Attack, with no
 *    Reaction Time and no mistakes.
 *
 * Both read only the state they are given, so they have no memory to save.
 */
import { IDLE_INTENT, mirrorDirection, type Direction, type Intent, type SimState } from '../sim';
import type { Controller } from './controller';

export const DUMMY = 'Dummy';
export const WALL = 'Wall';
/** The test opponents' names, in the order the Editor lists them. */
export const TEST_OPPONENTS = [DUMMY, WALL] as const;
export type TestOpponent = (typeof TEST_OPPONENTS)[number];

export function isTestOpponent(name: string): name is TestOpponent {
  return (TEST_OPPONENTS as readonly string[]).includes(name);
}

export function createTestOpponent(name: TestOpponent): Controller {
  return name === DUMMY ? dummyController() : wallController();
}

/** Stands idle every Tick. */
export function dummyController(): Controller {
  return { intent: () => IDLE_INTENT };
}

/** The Block Direction a Wall raises when nothing is coming. */
const WALL_REST: Direction = 'Overhead';

/** Faces its opponent and Blocks whatever Attack it shows, perfectly. */
export function wallController(): Controller {
  return {
    intent(state: SimState, fighter: number): Intent {
      const self = state.fighters[fighter]!;
      const other = state.fighters[fighter === 0 ? 1 : 0]!;
      const face = Math.atan2(other.position.x - self.position.x, other.position.z - self.position.z);
      const base: Intent = { ...IDLE_INTENT, face };
      const held = self.action.kind === 'Block' ? self.action.direction : WALL_REST;
      const direction = other.action.kind === 'Attack' ? mirrorDirection(other.action.direction) : held;
      // A Block's Direction is fixed on press: drop a Block in another Direction for a Tick, then raise this one.
      if (self.action.kind === 'Block' && self.action.direction !== direction) return base;
      return { ...base, block: true, direction };
    },
  };
}
