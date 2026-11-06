/**
 * The player's master volume, 0 (silent) to 1 (full, the default), set on the in-game menu and remembered.
 * The slider is linear in what it shows; the sound's gain is its square, so the slider's middle sounds like half.
 */
export const VOLUME_STORAGE_KEY = 'sword.volume';

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function load(): number {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    return raw === null ? 1 : clamp(Number(raw));
  } catch {
    return 1;
  }
}

let current = load();
const listeners = new Set<(gain: number) => void>();

export function getMasterVolume(): number {
  return current;
}

/** The gain the master volume plays at (its square). */
export function masterVolumeGain(volume: number = current): number {
  return volume * volume;
}

/** Sets (and remembers) the master volume, clamped to 0..1, and tells every listener at once. */
export function setMasterVolume(value: number): void {
  current = clamp(value);
  try {
    if (current === 1) localStorage.removeItem(VOLUME_STORAGE_KEY);
    else localStorage.setItem(VOLUME_STORAGE_KEY, String(current));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
  for (const listener of listeners) listener(masterVolumeGain());
}

/** Calls `listener` with the new gain whenever the master volume changes; returns the unsubscribe. */
export function onMasterVolume(listener: (gain: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
