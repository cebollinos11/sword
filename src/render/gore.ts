/**
 * The player's Blood & gore setting: on (the default) draws blood (sprays, stains, bloody Weapons and bodies, stump
 * drips) and Dismemberment; off draws none of it, and a Hit bursts in pale chips instead of red bits. Render-only: it never
 * changes the Simulation (a Death still records its cut), so online peers may differ. Set on the in-game menu and remembered.
 */
export const GORE_STORAGE_KEY = 'sword.gore';

function load(): boolean {
  try {
    return localStorage.getItem(GORE_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let current = load();

export function goreEnabled(): boolean {
  return current;
}

/** Sets (and remembers) whether blood and Dismemberment are drawn, from the next frame on. */
export function setGoreEnabled(on: boolean): void {
  current = on;
  try {
    if (on) localStorage.removeItem(GORE_STORAGE_KEY);
    else localStorage.setItem(GORE_STORAGE_KEY, 'off');
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}
