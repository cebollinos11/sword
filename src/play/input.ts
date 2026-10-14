import type { LocalController } from '../controllers';

export interface LocalInputBinding {
  /** Feed events to the Controller only while true (the menu is closed). */
  enabled: boolean;
  dispose(): void;
}

/**
 * Feeds browser mouse/key events to a Local Controller. Left mouse = attack,
 * right mouse = block, mouse movement = gesture + camera turn (pointer lock is
 * requested on the first click so the mouse never leaves the window), WASD
 * walk, Q = Attack Feint. Losing focus lets go of everything.
 */
export function bindLocalInput(local: LocalController, canvas: HTMLCanvasElement): LocalInputBinding {
  const binding: LocalInputBinding = { enabled: false, dispose };
  const button = (b: number) => (b === 0 ? 'attack' : b === 2 ? 'block' : null);

  const onMouseDown = (e: MouseEvent) => {
    if (!binding.enabled) return;
    if (document.pointerLockElement !== canvas) {
      // Some browsers refuse (or have no) pointer lock; play on with plain mouse movement then.
      try {
        void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      } catch {
        /* no pointer lock */
      }
    }
    const b = button(e.button);
    if (b) local.buttonDown(b);
    e.preventDefault();
  };
  const onMouseUp = (e: MouseEvent) => {
    const b = button(e.button);
    if (b) local.buttonUp(b);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (binding.enabled) local.mouseMove(e.movementX, e.movementY);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!binding.enabled || e.repeat) return;
    local.keyDown(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => local.keyUp(e.code);
  const onBlur = () => local.releaseAll();
  const onContextMenu = (e: Event) => e.preventDefault();

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('contextmenu', onContextMenu);

  function dispose(): void {
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('contextmenu', onContextMenu);
  }

  return binding;
}
