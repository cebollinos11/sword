/**
 * Audio: listens to Simulation events and plays synthesised sounds and stock clips. Lives outside the Simulation (ADR 0001); the Simulation never
 * imports it.
 */
import type { AudioTuning } from '../tuning';
import { SimAudio } from './listener';
import { WebAudioPlayer } from './synth';

export { arenaSurface, matchCues, soundCues, type SoundCue, type Surface } from './cues';
export { SimAudio, type SoundPlayer } from './listener';
export { CHEST, placement, type Ears, type Placement } from './spatial';
export { getMasterVolume, masterVolumeGain, onMasterVolume, setMasterVolume } from './volume';
export { WebAudioPlayer } from './synth';

/** A SimAudio playing through WebAudio, unlocked by the first click or key press on the page; `hearing` places its sounds in the world. */
export function createBrowserAudio(hearing?: AudioTuning): SimAudio {
  const player = new WebAudioPlayer(hearing);
  player.unlockOn(window);
  return new SimAudio(player);
}
