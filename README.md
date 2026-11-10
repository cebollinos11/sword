# sword
Sword dueling game

## Controls

### Keyboard and mouse

| Input | Does |
|---|---|
| Mouse | Aim the camera; the last way you moved picks the Direction (up = Overhead, down = Thrust) |
| Hold left mouse | Wind up an Attack; let go to swing |
| Mouse wheel up / down | Quick Overhead / Thrust Attack, queued to follow your current swing |
| Right mouse | Block in the Direction you last moved |
| W A S D | Walk |
| Space | Jump |
| C (hold) | Crouch |
| F | Kick |
| E (hold) | Throw a dagger: hold to draw it back, let go to throw |
| R | Sheathe your Weapon to walk faster (you cannot Attack or Block), or Draw it again |
| Q | Feint, during a Wind-up, into the Direction you last moved |
| Esc | Menu (frees the mouse) |

Attack or Block while Sheathed Draws the Weapon first.

### Touch

- Drag the left thumb to walk; drag anywhere else to turn the camera.
- Attack and Block pads: swipe left, right, up (Overhead) or down (Thrust) to wind up in that Direction, and lift to
  swing. A tap repeats the last Direction; swipe a new way while holding to Feint.
- Jump, Throw and Sheathe pads: tap. The Sheathe pad reads Draw while you are Sheathed; tap it again to Draw.
- ☰ opens the menu.

## Tests

| Command | Runs | About |
|---|---|---|
| `npm test` | the fast tier (everything but `*.slow.test.ts`) | ~3.5 min on 4 cores |
| `npm run test:slow` | whole-Battle, soak and Rollback-budget tests | ~5.5 min on 4 cores |
| `npm run test:all` | both (what CI runs before deploying) | |

A test that plays a whole Battle or a long soak belongs in its own `*.slow.test.ts` file, one scenario per file, so the workers can run the files side by side (Vitest parallelises per file, not per test). Shared set-up goes in a plain module beside it (see `src/net/battleHarness.ts`).
