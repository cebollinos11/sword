/**
 * Test opponents for the Editor sandbox: Controllers that stand still so a
 * player can try their attacks against a fixed answer. Not AI difficulties
 * (they are not Tuning Data and the game's menu never offers them).
 *
 *  - Dummy: never moves, attacks or blocks.
 *  - Wall: never moves or attacks; always faces its opponent and holds a Block
 *    in the Direction that meets the opponent's current Attack, with no
 *    Reaction Time and no mistakes.
 *  - Runner: never attacks or blocks; turns its back on its opponent and walks
 *    straight away from it, so a thrown dagger has something to chase.
 *
 * All read only the state they are given, so they have no memory to save.
 */
import { IDLE_INTENT, mirrorDirection, type Direction, type Intent, type SimState } from '../sim';
import type { Controller } from './controller';

export const DUMMY = 'Dummy';
export const WALL = 'Wall';
export const RUNNER = 'Runner';
/** The test opponents' names, in the order the Editor lists them. */
export const TEST_OPPONENTS = [DUMMY, WALL, RUNNER] as const;
export type TestOpponent = (typeof TEST_OPPONENTS)[number];

export function isTestOpponent(name: string): name is TestOpponent {
  return (TEST_OPPONENTS as readonly string[]).includes(name);
}

export function createTestOpponent(name: TestOpponent): Controller {
  return name === DUMMY ? dummyController() : name === WALL ? wallController() : runnerController();
}

/** Stands idle every Tick. */
export function dummyController(): Controller {
  return { intent: () => IDLE_INTENT };
}

/** Walks directly away from its opponent, facing the way it runs. */
export function runnerController(): Controller {
  return {
    intent(state: SimState, fighter: number): Intent {
      const self = state.fighters[fighter]!;
      const other = state.fighters[fighter === 0 ? 1 : 0]!;
      const dx = self.position.x - other.position.x;
      const dz = self.position.z - other.position.z;
      const len = Math.hypot(dx, dz) || 1;
      return { ...IDLE_INTENT, face: Math.atan2(dx, dz), move: { x: dx / len, z: dz / len } };
    },
  };
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
