/** The player's mouse sensitivity: a multiplier on how far the mouse turns the camera. 1 is the original feel. */
export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;
export const SENSITIVITY_STORAGE_KEY = 'sword.sensitivity';

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, value));
}

function load(): number {
  try {
    const raw = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    return raw === null ? 1 : clamp(Number(raw));
  } catch {
    return 1;
  }
}

let current = load();

export function getLookSensitivity(): number {
  return current;
}

/** Sets (and remembers) the sensitivity, clamped to the slider's range. */
export function setLookSensitivity(value: number): void {
  current = clamp(value);
  try {
    if (current === 1) localStorage.removeItem(SENSITIVITY_STORAGE_KEY);
    else localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(current));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}
