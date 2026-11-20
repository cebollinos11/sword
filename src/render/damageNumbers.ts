/**
 * The player's Damage Numbers setting: on (the default) floats the damage a Fighter takes over its head; off draws none.
 * Render-only: it never changes the Simulation, so online peers may differ. Set on the in-game menu and remembered.
 */
export const DAMAGE_NUMBERS_STORAGE_KEY = 'sword.damageNumbers';

function load(): boolean {
  try {
    return localStorage.getItem(DAMAGE_NUMBERS_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let current = load();

export function damageNumbersEnabled(): boolean {
  return current;
}

/** Sets (and remembers) whether Damage Numbers are drawn, from the next frame on. */
export function setDamageNumbersEnabled(on: boolean): void {
  current = on;
  try {
    if (on) localStorage.removeItem(DAMAGE_NUMBERS_STORAGE_KEY);
    else localStorage.setItem(DAMAGE_NUMBERS_STORAGE_KEY, 'off');
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}
