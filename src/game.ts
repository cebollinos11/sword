import { createMatch, TICK_SECONDS, type MatchState, type SimState, type Vec2 } from './sim';
import type { TuningData } from './tuning';
import { Renderer } from './render/renderer';
import { placeThirdPersonCamera } from './render/thirdPersonCamera';
import { createBrowserAudio } from './audio';
import { LocalController } from './controllers';
import { playerVsAi, type MatchDriver } from './play/driver';
import { bindLocalInput } from './play/input';
import { Hud } from './play/hud';
import { Menu } from './play/menu';

/** Never simulate more than this many Ticks in one rendered frame (e.g. after a background tab). */
const MAX_TICKS_PER_FRAME = 8;
/** How long the final result stays on screen before the menu returns (seconds, cosmetic). */
const RESULT_SECONDS = 2.5;

/** What the loop needs to know to present a Match: who the local player is and what to call each Fighter. */
export interface MatchPresentation {
  readonly driver: MatchDriver;
  /** Display name per Fighter index (HUD). */
  readonly names: readonly string[];
}

export interface Game {
  /** Play a Match through any driver: Player vs AI here, a Rollback session for Player vs Player (#23). */
  play(presentation: MatchPresentation): void;
}

/**
 * The game route: owns the wall clock and the fixed-Tick loop. Each Tick the
 * Local Controller's Intent goes to the MatchDriver, which steps the Match
 * (locally against the AI, or through Rollback for online play); the Renderer
 * interpolates between the last two Match Ticks, the camera follows the local
 * Fighter, the HUD shows HP and round score, and audio plays each new Tick.
 */
export function startGame(container: HTMLElement, tuning: TuningData): Game {
  const renderer = new Renderer(container, tuning);
  const audio = createBrowserAudio();
  const local = new LocalController();
  const input = bindLocalInput(local, renderer.canvas);
  const hud = new Hud(container, tuning);

  let driver: MatchDriver | null = null;
  // Shown behind the menu before the first Match.
  const backdrop = createMatch(tuning, { bestOf: 1 });
  let prev: MatchState = backdrop;
  let curr: MatchState = backdrop;
  let accumulator = 0;
  let last = performance.now();
  let resultAt: number | null = null;
  let resultText = '';

  const menu = new Menu(container, tuning, ({ difficulty, bestOf }) => {
    game.play({
      driver: playerVsAi(tuning, { difficulty, bestOf, seed: (Math.random() * 0x7fffffff) | 0 }),
      names: ['You', `AI (${difficulty})`],
    });
  });

  const game: Game = {
    play({ driver: d, names }) {
      driver = d;
      local.releaseAll();
      const start = d.state;
      if (start) {
        prev = curr = start;
        audio.seek(start.tick);
        aimAtDuelStart(start);
      }
      resultAt = null;
      menu.hide();
      hud.show({ fighters: names, localFighter: d.localFighter });
      hud.announce(`Duel ${start?.duelNumber ?? 1}`, 1.5);
      input.enabled = true;
      accumulator = 0;
    },
  };

  function aimAtDuelStart(match: MatchState): void {
    if (!driver) return;
    const f = match.duel.fighters[driver.localFighter];
    if (f) local.setYaw(f.facing);
  }

  function finish(text: string): void {
    driver = null;
    input.enabled = false;
    local.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.hide();
    menu.show(text);
  }

  /** Announce what this Match Tick changed (Duel won/lost, a new Duel, the Match result). */
  function present(match: MatchState, me: number): void {
    for (const e of match.duel.events) {
      if (e.type === 'DuelEnd') hud.announce(e.winner === null ? 'Draw' : e.winner === me ? 'Duel won' : 'Duel lost');
    }
    for (const e of match.events) {
      if (e.type === 'DuelStart') {
        hud.announce(`Duel ${e.duelNumber}`, 1.5);
        aimAtDuelStart(match);
      } else if (e.type === 'MatchEnd') {
        resultText = `${e.winner === me ? 'You win' : 'You lose'}  ${match.score[me]} – ${match.score[1 - me]}`;
        hud.announce(e.winner === me ? 'Victory' : 'Defeat', RESULT_SECONDS);
        resultAt = performance.now() + RESULT_SECONDS * 1000;
      }
    }
  }

  function frame(now: number): void {
    accumulator += Math.min((now - last) / 1000, MAX_TICKS_PER_FRAME * TICK_SECONDS);
    last = now;
    while (driver && accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      if (!driver.tick(local.sample()).advanced || !driver.state) continue;
      prev = curr;
      curr = driver.state;
      audio.onMatchTick(curr);
      present(curr, driver.localFighter);
    }
    if (!driver) accumulator = 0;
    if (resultAt !== null && now >= resultAt) {
      resultAt = null;
      finish(resultText);
    }

    const alpha = driver ? accumulator / TICK_SECONDS : 1;
    // A fresh Duel resets the Fighters: don't interpolate across the swap.
    const before: SimState = prev.duelNumber === curr.duelNumber ? prev.duel : curr.duel;
    const me = driver?.localFighter ?? 0;
    placeThirdPersonCamera(renderer.camera, lerpPosition(before, curr.duel, me, alpha), driver ? local.yaw : curr.duel.fighters[me]?.facing ?? 0);
    renderer.render(before, curr.duel, alpha);
    hud.update(curr);
    requestAnimationFrame(frame);
  }

  menu.show();
  requestAnimationFrame(frame);
  return game;
}

function lerpPosition(a: SimState, b: SimState, fighter: number, alpha: number): Vec2 {
  const p = b.fighters[fighter]?.position ?? { x: 0, z: 0 };
  const q = a.fighters[fighter]?.position ?? p;
  return { x: q.x + (p.x - q.x) * alpha, z: q.z + (p.z - q.z) * alpha };
}
