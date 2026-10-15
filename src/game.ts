import { createMatch, TICK_SECONDS, type MatchState, type SimState, type Vec2 } from './sim';
import type { TuningData } from './tuning';
import { Renderer } from './render/renderer';
import { placeThirdPersonCamera } from './render/thirdPersonCamera';
import { createBrowserAudio } from './audio';
import { LocalController } from './controllers';
import { playerVsAi, type MatchDriver } from './play/driver';
import { bindLocalInput } from './play/input';
import { bindTouchInput, isTouchDevice } from './play/touch';
import { Hud } from './play/hud';
import { Menu } from './play/menu';
import { MatchAnnouncer } from './play/announcer';
import { playerVsPlayer } from './play/online';
import {
  BrokerUrlError,
  createRollbackSession,
  hostRoom,
  joinRoom,
  parseBrokerUrl,
  parseRoomInput,
  RoomError,
  roomLink,
  type BrokerOptions,
  type SessionRole,
  type Transport,
} from './net';

/** Never simulate more than this many Ticks in one rendered frame (e.g. after a background tab). */
const MAX_TICKS_PER_FRAME = 8;
/** How long the final result stays on screen before the menu returns (seconds, cosmetic). */
const RESULT_SECONDS = 2.5;

/** What the loop needs to know to present a Match: the driver (which also says who the local player is). */
export interface MatchPresentation {
  readonly driver: MatchDriver;
}

export interface Game {
  /** Play a Match through any driver: Player vs AI here, a Rollback session for Player vs Player (#23). */
  play(presentation: MatchPresentation): void;
}

/** Seeds a fresh Match (outside the Simulation, so Math.random is fine). */
function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

/** A Room being created or joined (Player vs Player, not connected yet). */
interface RoomAttempt {
  cancel(): void;
}

const ROOM_ROUTE = '#/room/';

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
  const mouseInput = bindLocalInput(local, renderer.canvas);
  const touchInput = isTouchDevice() ? bindTouchInput(local, container) : null;
  /** Feeds the Local Controller only while a Match is on (mouse/keyboard, plus touch on touch devices). */
  const input = {
    set enabled(on: boolean) {
      mouseInput.enabled = on;
      if (touchInput) touchInput.enabled = on;
    },
  };
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
  let announcer = new MatchAnnouncer();
  let room: RoomAttempt | null = null;

  const menu = new Menu(container, tuning, {
    onStart({ difficulty, bestOf }) {
      game.play({
        driver: playerVsAi(tuning, { difficulty, bestOf, seed: randomSeed() }),
      });
    },
    onCreateRoom({ bestOf, broker }) {
      void createRoom(bestOf, broker);
    },
    onJoinRoom({ room: text, broker }) {
      const address = parseRoomInput(text);
      if (!address) return menu.show(`"${text.trim()}" is not a Room code or link.`);
      joinByCode(address.code, address.broker ?? broker);
    },
    onLeaveRoom() {
      leaveRoom();
      menu.show();
    },
  });

  /** The broker options, or undefined (after showing why) if the URL is unusable. */
  function brokerFrom(text: string): BrokerOptions | null | undefined {
    try {
      return parseBrokerUrl(text);
    } catch (e) {
      if (!(e instanceof BrokerUrlError)) throw e;
      menu.show(e.message);
      return undefined;
    }
  }

  function leaveRoom(): void {
    room?.cancel();
    room = null;
  }

  function roomFailed(attempt: RoomAttempt, e: unknown): void {
    if (room !== attempt) return; // left meanwhile
    room = null;
    menu.show(e instanceof RoomError ? e.message : `Room error: ${String(e)}`);
  }

  async function createRoom(bestOf: number, brokerText: string): Promise<void> {
    const broker = brokerFrom(brokerText);
    if (broker === undefined) return;
    leaveRoom();
    menu.showRoom({ kind: 'Creating' });
    const attempt: RoomAttempt = { cancel() {} };
    room = attempt;
    try {
      const hosted = await hostRoom(broker);
      attempt.cancel = () => hosted.cancel();
      if (room !== attempt) return hosted.cancel();
      menu.showRoom({ kind: 'Hosting', code: hosted.code, link: roomLink(location.href, hosted.code, brokerText.trim() || undefined) });
      const transport = await hosted.connected;
      if (room === attempt) startOnline('host', transport, bestOf);
      else transport.close();
    } catch (e) {
      roomFailed(attempt, e);
    }
  }

  function joinByCode(code: string, brokerText: string): void {
    const broker = brokerFrom(brokerText);
    if (broker === undefined) return;
    leaveRoom();
    menu.showRoom({ kind: 'Joining', code });
    const pending = joinRoom(code, broker);
    const attempt: RoomAttempt = pending;
    room = attempt;
    pending.connected.then(
      (transport) => (room === attempt ? startOnline('guest', transport) : transport.close()),
      (e) => roomFailed(attempt, e),
    );
  }

  /** Connected: run the Match through a Rollback session (host = Fighter 0 picks the Match options, guest = Fighter 1). */
  function startOnline(role: SessionRole, transport: Transport, bestOf = 3): void {
    room = null;
    const session = createRollbackSession({
      role,
      transport,
      tuning,
      ...(role === 'host' ? { match: { bestOf, seed: randomSeed() } } : {}),
    });
    game.play({ driver: playerVsPlayer(session) });
  }

  const game: Game = {
    play({ driver: d }) {
      if (driver !== d) driver?.close?.();
      driver = d;
      local.releaseAll();
      announcer = new MatchAnnouncer();
      resultAt = null;
      menu.hide();
      hud.show(d.localFighter);
      const start = d.state;
      // An online Match has no state until the peers connect; its first Tick then sounds.
      audio.seek(start?.tick ?? 0);
      if (start) {
        prev = curr = start;
        present(start, d.localFighter);
      }
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
    driver?.close?.();
    driver = null;
    input.enabled = false;
    local.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.hide();
    menu.show(text);
  }

  /**
   * Announce what this Match state shows that is new (a Duel started or ended, the Match result).
   * Read from the state, not the Tick's events: with Rollback the Tick carrying an event may only
   * ever have been re-simulated, and a Tick may be presented twice.
   */
  function present(match: MatchState, me: number): void {
    for (const e of announcer.update(match)) {
      if (e.type === 'DuelEnd') {
        hud.announce(e.winner === null ? 'Draw' : e.winner === me ? 'Duel won' : 'Duel lost');
      } else if (e.type === 'DuelStart') {
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
      const d = driver;
      const { advanced } = d.tick(local.sample());
      if (d.failure) {
        finish(d.failure);
        break;
      }
      if (!advanced || !d.state) continue;
      // Possibly predicted, or corrected by a Rollback: the Renderer just interpolates from the last state shown.
      prev = curr;
      curr = d.state;
      audio.onMatchTick(curr);
      present(curr, d.localFighter);
    }
    if (driver?.waiting) hud.announce(driver.waiting, 0.5);
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

  addEventListener('pagehide', () => {
    leaveRoom();
    driver?.close?.();
  });

  menu.show();
  // Opened from a Room link: join it right away, and drop the hash so a reload or "Play again" doesn't rejoin.
  if (location.hash.startsWith(ROOM_ROUTE)) {
    const linked = parseRoomInput(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (linked) joinByCode(linked.code, linked.broker ?? '');
    else menu.show('That Room link is not valid.');
  }
  requestAnimationFrame(frame);
  return game;
}

function lerpPosition(a: SimState, b: SimState, fighter: number, alpha: number): Vec2 {
  const p = b.fighters[fighter]?.position ?? { x: 0, z: 0 };
  const q = a.fighters[fighter]?.position ?? p;
  return { x: q.x + (p.x - q.x) * alpha, z: q.z + (p.z - q.z) * alpha };
}
