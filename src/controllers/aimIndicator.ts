/** Whether the HUD draws the Direction line off the crosshair. On by default; the pause menu toggles it and the choice is remembered. */
export const AIM_INDICATOR_STORAGE_KEY = 'sword.aimIndicator';

function load(): boolean {
  try {
    return localStorage.getItem(AIM_INDICATOR_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

let current = load();

export function getAimIndicator(): boolean {
  return current;
}

export function setAimIndicator(on: boolean): void {
  current = on;
  try {
    if (on) localStorage.removeItem(AIM_INDICATOR_STORAGE_KEY);
    else localStorage.setItem(AIM_INDICATOR_STORAGE_KEY, '0');
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}
