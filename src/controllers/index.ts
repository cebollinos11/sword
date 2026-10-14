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
export { aiDifficulty, createAiController } from './ai';
