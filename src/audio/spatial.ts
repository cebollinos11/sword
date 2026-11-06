/**
 * Where a sound is heard from: the fight's sounds are placed in the world (`Placed.at`) and heard from the
 * Player's ears (the Fighter's position, the camera's facing), quieter, muffled and wetter the further off,
 * and panned to the side they come from. Pure, so it is tested headlessly; the WebAudio player applies it.
 */
import type { Vec3 } from '../sim';
import type { AudioTuning } from '../tuning';

/** Where the Player hears from: a world position, and the horizontal unit vector to its right (the camera's). */
export interface Ears {
  readonly position: Vec3;
  readonly right: { readonly x: number; readonly z: number };
}

/** How one sound plays from where it is: its level (0 silent … 1), pan (-1 left … 1 right), low-pass cutoff (Hz, null for none) and extra reverb send. */
export interface Placement {
  readonly gain: number;
  readonly pan: number;
  readonly cutoff: number | null;
  readonly wet: number;
}

/** Height (m) above a Fighter's feet that its own sounds come from, and that the Player hears from: its chest. */
export const CHEST = 1.2;

/** A sound with no place, or no ears to hear it from: as it always played. */
export const UNPLACED: Placement = { gain: 1, pan: 0, cutoff: null, wet: 0 };

/** The top of hearing: a cutoff here is no muffle at all. */
const OPEN = 20000;
/** Within this horizontal distance (m) a sound narrows toward the centre: one's own blows are not hard to one side. */
const CENTRE = 2;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function placement(at: Vec3 | undefined, ears: Ears | null, tuning: AudioTuning): Placement {
  if (!at || !ears) return UNPLACED;
  const dx = at.x - ears.position.x;
  const dy = at.y - ears.position.y;
  const dz = at.z - ears.position.z;
  const distance = Math.hypot(dx, dy, dz);
  // How far into the fade, 0 within `near` … 1 at `far`.
  const t = clamp((distance - tuning.near) / (tuning.far - tuning.near), 0, 1);
  const gain = (1 - t) ** tuning.rolloff;
  const across = Math.hypot(dx, dz);
  const side = across > 1e-6 ? (dx * ears.right.x + dz * ears.right.z) / across : 0;
  const pan = clamp(side * Math.min(1, across / CENTRE) * tuning.pan, -1, 1);
  // Log-spaced, so the muffle closes in evenly to the ear.
  const cutoff = t > 0 ? tuning.muffle * (OPEN / tuning.muffle) ** (1 - t) : null;
  return { gain, pan, cutoff, wet: tuning.farWet * t };
}
