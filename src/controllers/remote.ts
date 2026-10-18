/**
 * The Remote Controller: drives the Fighters of the other Players in a Player
 * vs Player Match. Their Intents come from the Rollback session (src/net): a
 * Player's real Intent for the Tick being simulated once it has arrived, a
 * prediction (their last real one repeated) until then. When a prediction
 * proves wrong the session rolls back and asks again, so the Fighter never
 * knows the difference.
 */
import type { Intent } from '../sim';
import type { Controller } from './controller';

/** Where a Remote Controller reads the other Players' Intents (the Rollback session). */
export interface PeerIntentSource {
  /** The Intent of the Player driving `fighter` for the Tick about to be simulated: real if it has arrived, predicted otherwise. */
  peerIntent(fighter: number): Intent;
}

export function createRemoteController(source: PeerIntentSource): Controller {
  return { intent: (_state, fighter) => source.peerIntent(fighter) };
}
