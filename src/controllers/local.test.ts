import { describe, expect, it } from 'vitest';
import { FACE_STEPS, LOOK_RADIANS_PER_PX, LocalController } from './local';

/** The Intent for the next Tick (the Local Controller ignores the state it is shown). */
function next(local: LocalController) {
  return local.sample();
}

describe('Local Controller', () => {
  it('defaults to an Overhead Attack when the mouse has never moved', () => {
    const local = new LocalController();
    local.buttonDown('attack');
    expect(next(local)).toMatchObject({ attack: true, block: false, direction: 'Overhead' });
  });

  it.each([
    ['Left', -40, 0],
    ['Right', 40, 0],
    ['Overhead', 0, -40],
    ['Thrust', 0, 40],
  ] as const)('a mouse movement before the press chooses the %s Direction', (direction, dx, dy) => {
    const local = new LocalController();
    local.mouseMove(dx, dy);
    local.buttonDown('attack');
    expect(next(local)).toMatchObject({ attack: true, direction });
  });

  it('uses only the most recent mouse movement, along its dominant axis', () => {
    const local = new LocalController();
    local.mouseMove(-40, 0);
    local.mouseMove(10, 35);
    local.buttonDown('attack');
    expect(next(local).direction).toBe('Thrust');
  });

  it('ignores mouse jitter too small to be a gesture', () => {
    const local = new LocalController();
    local.mouseMove(-40, 0);
    local.mouseMove(1, 1);
    local.buttonDown('attack');
    expect(next(local).direction).toBe('Left');
  });

  it('builds a gesture from many small pointer-lock movements', () => {
    const local = new LocalController();
    for (let i = 0; i < 10; i++) local.mouseMove(2, 0);
    local.buttonDown('attack');
    expect(next(local).direction).toBe('Right');
  });

  it('keeps the last Direction when the mouse has not moved since the last Action', () => {
    const local = new LocalController();
    local.mouseMove(40, 0);
    local.buttonDown('attack');
    next(local);
    local.buttonUp('attack');
    next(local);
    local.buttonDown('attack');
    expect(next(local)).toMatchObject({ attack: true, direction: 'Right' });
  });

  it('keeps attack held for as long as the button is held (a held Wind-up), then lets go (Release)', () => {
    const local = new LocalController();
    local.buttonDown('attack');
    for (let t = 0; t < 30; t++) expect(next(local).attack).toBe(true);
    local.buttonUp('attack');
    expect(next(local).attack).toBe(false);
  });

  it('does not lose a click that is pressed and released between two Ticks', () => {
    const local = new LocalController();
    local.buttonDown('attack');
    local.buttonUp('attack');
    expect(next(local).attack).toBe(true);
    expect(next(local).attack).toBe(false);
  });

  it('locks the Direction while attack is held, so turning the camera mid-Wind-up is not a Feint', () => {
    const local = new LocalController();
    local.mouseMove(0, -40);
    local.buttonDown('attack');
    next(local);
    local.mouseMove(80, 0);
    expect(next(local)).toMatchObject({ attack: true, direction: 'Overhead' });
  });

  it('a mouse movement during a held Attack chooses the Direction of the next press', () => {
    const local = new LocalController();
    local.buttonDown('attack');
    next(local);
    local.mouseMove(-40, 0);
    local.buttonUp('attack');
    next(local);
    local.buttonDown('attack');
    expect(next(local).direction).toBe('Left');
  });

  it('the Feint key re-aims a held Attack at the most recent mouse gesture (an Attack Feint)', () => {
    const local = new LocalController();
    local.buttonDown('attack');
    next(local);
    local.mouseMove(40, 0);
    local.feint();
    expect(next(local)).toMatchObject({ attack: true, direction: 'Right' });
  });

  it('right mouse blocks in the Direction of the most recent mouse gesture', () => {
    const local = new LocalController();
    local.mouseMove(0, 40);
    local.buttonDown('block');
    expect(next(local)).toMatchObject({ block: true, attack: false, direction: 'Thrust' });
    local.buttonUp('block');
    expect(next(local).block).toBe(false);
  });

  it('right mouse during a held Wind-up blocks in the newly gestured Direction (a Block Feint)', () => {
    const local = new LocalController();
    local.buttonDown('attack');
    next(local);
    local.mouseMove(-40, 0);
    local.buttonDown('block');
    expect(next(local)).toMatchObject({ attack: true, block: true, direction: 'Left' });
  });

  describe('movement and facing', () => {
    it('stands still and faces the camera yaw when nothing is pressed', () => {
      const local = new LocalController();
      expect(next(local)).toMatchObject({ move: { x: 0, z: 0 }, face: 0, attack: false, block: false });
    });

    it('walks with WASD relative to where the camera looks (yaw 0 looks along +z, right is -x)', () => {
      const local = new LocalController();
      local.keyDown('KeyW');
      expect(next(local).move).toEqual({ x: 0, z: 1 });
      local.keyUp('KeyW');
      local.keyDown('KeyD');
      expect(next(local).move.x).toBeCloseTo(-1);
      local.keyUp('KeyD');
      local.keyDown('KeyS');
      local.keyDown('KeyA');
      const back = next(local).move;
      expect(back.x).toBeCloseTo(Math.SQRT1_2);
      expect(back.z).toBeCloseTo(-Math.SQRT1_2);
    });

    it('turns the camera with horizontal mouse movement: moving right turns right', () => {
      const local = new LocalController();
      local.mouseMove(100, 0);
      local.keyDown('KeyW');
      const intent = next(local);
      expect(intent.face).toBeCloseTo(-100 * LOOK_RADIANS_PER_PX, 2);
      expect(intent.move.x).toBeLessThan(0);
    });

    it('vertical mouse movement chooses a Direction but does not turn', () => {
      const local = new LocalController();
      local.mouseMove(0, -200);
      expect(next(local).face).toBe(0);
    });

    it('starts from a given yaw (the Fighter facing at the start of a Duel)', () => {
      const local = new LocalController();
      local.setYaw(Math.PI);
      local.keyDown('KeyW');
      const intent = next(local);
      expect(intent.face).toBeCloseTo(Math.PI, 3);
      expect(intent.move.z).toBeCloseTo(-1);
    });

    it('sends face on a fixed grid, so the same aim is always the exact same number', () => {
      const local = new LocalController();
      local.mouseMove(37.3, 0);
      const steps = (next(local).face! * FACE_STEPS) / (2 * Math.PI);
      expect(steps).toBe(Math.round(steps));
    });

    it('keeps the facing in (-pi, pi] however far the mouse turns', () => {
      const local = new LocalController();
      for (let i = 0; i < 100; i++) local.mouseMove(-300, 0);
      const face = next(local).face!;
      expect(face).toBeGreaterThan(-Math.PI);
      expect(face).toBeLessThanOrEqual(Math.PI);
    });

    it('the Q key is the Attack Feint gesture', () => {
      const local = new LocalController();
      local.buttonDown('attack');
      next(local);
      local.mouseMove(0, 40);
      local.keyDown('KeyQ');
      expect(next(local).direction).toBe('Thrust');
    });

    it('lets go of everything when focus is lost', () => {
      const local = new LocalController();
      local.keyDown('KeyW');
      local.buttonDown('attack');
      next(local);
      local.releaseAll();
      expect(next(local)).toMatchObject({ move: { x: 0, z: 0 }, attack: false, block: false });
    });
  });
});
