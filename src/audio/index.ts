/**
 * Audio: listens to Simulation events and plays synthesised sounds. Lives outside the Simulation (ADR 0001); the Simulation never
 * imports it.
 */
import { SimAudio } from './listener';
import { WebAudioPlayer } from './synth';

export { matchCues, soundCues, type SoundCue, type Surface } from './cues';
export { SimAudio, type SoundPlayer } from './listener';
export { WebAudioPlayer } from './synth';

/** A SimAudio playing through WebAudio, unlocked by the first click or key press on the page. */
export function createBrowserAudio(): SimAudio {
  const player = new WebAudioPlayer();
  player.unlockOn(window);
  return new SimAudio(player);
}
