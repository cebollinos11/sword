/**
 * The Remote Controller: drives the Fighter of the peer in a Player vs Player
 * Match. Its Intents come from the Rollback session (src/net): the peer's real
 * Intent for the Tick being simulated once it has arrived, a prediction (the
 * last real one repeated) until then. When a prediction proves wrong the
 * session rolls back and asks again, so the Fighter never knows the difference.
 */
import type { Intent } from '../sim';
import type { Controller } from './controller';

/** Where a Remote Controller reads the peer's Intents (the Rollback session). */
export interface PeerIntentSource {
  /** The peer's Intent for the Tick about to be simulated: real if it has arrived, predicted otherwise. */
  peerIntent(): Intent;
}

export function createRemoteController(source: PeerIntentSource): Controller {
  return { intent: () => source.peerIntent() };
}
