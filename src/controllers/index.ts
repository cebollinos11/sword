/**
 * Controllers (Local, AI, Remote): the sources of Intents. Not part of the
 * Simulation; they only read Simulation state and produce Intents.
 */
export {
  controllerIntents,
  runControllers,
  runMatch,
  scriptedController,
  stepMatchWith,
  type Controller,
  type MatchRun,
} from './controller';
export { aiDifficulty, aiStyle, createAiController, type AiController } from './ai';
export { createAllyAi, FOLLOW_DISTANCE } from './allyAi';
export { createAutopilot, type AutopilotLoot } from './autopilot';
export { createHallAi } from './hallAi';
export { createTestOpponent, dummyController, isTestOpponent, runnerController, TEST_OPPONENTS, wallController, type TestOpponent } from './testOpponents';
export { FACE_STEPS, FEINT_KEY, GESTURE_PX, gestureDirection, LocalController, LOOK_RADIANS_PER_PX, type LocalButton } from './local';
export { createRemoteController, type PeerIntentSource } from './remote';
export {
  checkLineup,
  FLOOR_DIFFICULTY,
  lineupAis,
  lineupMatch,
  lineupPlayers,
  lineupStyle,
  MAX_PLAYERS,
  ONE_VS_ONE,
  playerFighter,
  type Lineup,
  type LineupSlot,
  type Pilot,
  type PlayerNumber,
} from './lineup';
export { DROP_KEY, EQUIP_KEYS, INVENTORY_LIST_KEY, inventoryKey, type InventoryKey } from './inventoryKeys';
