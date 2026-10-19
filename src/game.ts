import { createMatch, secondsToTicks, TICK_SECONDS, type MatchOptions, type MatchState, type SimState } from './sim';
import type { TuningData } from './tuning';
import { Renderer } from './render/renderer';
import { placeOrbitCamera, placeThirdPersonCamera, type CameraTarget } from './render/thirdPersonCamera';
import { createBrowserAudio } from './audio';
import { lineupMatch, LocalController, playerFighter, type Lineup, type PlayerNumber } from './controllers';
import { playerVsAi, type MatchDriver } from './play/driver';
import { bindLocalInput } from './play/input';
import { bindTouchInput, isTouchDevice } from './play/touch';
import { Hud } from './play/hud';
import { Menu, type RoomInvite } from './play/menu';
import { MatchAnnouncer } from './play/announcer';
import { pickableArenas } from './play/lobbyView';
import { playerVsPlayer } from './play/online';
import { GuestLobby, HostLobby, lobbyLineup, type Lobby, type LobbyState, type NewLobbyOptions } from './lobby';
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
  type HostedRoom,
} from './net';

/** Never simulate more than this many Ticks in one rendered frame (e.g. after a background tab). */
const MAX_TICKS_PER_FRAME = 8;
/** How long the final result stays on screen before the Lobby returns (seconds, cosmetic). */
const RESULT_SECONDS = 2.5;
/** Online: how long after a Match ends a fresh one starts (part of the Match options, so both peers agree). */
const REMATCH_SECONDS = 5;
/** How often the Lobby gets its heartbeats and timeouts (ms). */
const LOBBY_PUMP_MS = 100;
/** The menu's camera circles the scene this fast (radians per second). */
const ORBIT_SPEED = 0.06;
/** The Character screen's close-up of your Fighter. */
const CLOSE_UP = { orbitDistance: 3.2, orbitHeight: 1.3, lookHeight: 2.1 };
/** ...turned this far (radians) to put your Fighter right of the Character card. */
const CLOSE_UP_TURN = 0.38;

const WEAPON_STORAGE_KEY = 'sword.weapon';
const ARENA_STORAGE_KEY = 'sword.arena';
const ROOM_ROUTE = '#/room/';

/** What the loop needs to know to present a Match: the driver (which also says who the local player is). */
export interface MatchPresentation {
  readonly driver: MatchDriver;
  /** Each Player's name (index = Player number), for the HUD. */
  readonly names?: readonly string[];
  /** Each Player's chosen Body (index = Player number); the AIs wear random ones. */
  readonly bodies?: readonly string[];
}

export interface Game {
  /** Play a Match through any driver: Player vs AI here, a Rollback session for Player vs Player (#23). */
  play(presentation: MatchPresentation): void;
}

/** Seeds a fresh Match (outside the Simulation, so Math.random is fine). */
function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/** A Room being created or joined (not connected yet). */
interface Attempt {
  cancel(): void;
}

/**
 * The game route: owns the wall clock and the fixed-Tick loop, the Lobby, and
 * the Room. Each Tick the Local Controller's Intent goes to the MatchDriver,
 * which steps the Match (locally against the AI, or through Rollback for online
 * play); the Renderer interpolates between the last two Match Ticks, the camera
 * follows the local Fighter (or, once it has fallen with its team still
 * fighting, orbits the fight), the HUD shows every Fighter's HP and the team
 * score, and audio and impact effects play each new Tick.
 *
 * Every Match starts from a Lobby: a Skirmish's (offline, you and AIs) or a
 * Room's (online). A start, or a restart from the in-game menu, is a new Match
 * generation of that Lobby; online it runs over the same Room link, so nobody
 * reconnects. Behind the menus the scene shows the Lobby's Map and Fighters.
 */
export function startGame(container: HTMLElement, tuning: TuningData): Game {
  const renderer = new Renderer(container, tuning);
  const audio = createBrowserAudio();
  const local = new LocalController();
  const mouseInput = bindLocalInput(local, renderer.canvas);
  const touchInput = isTouchDevice() ? bindTouchInput(local, container) : null;
  /** Feeds the Local Controller only while a Match is on and the menu closed (mouse/keyboard, plus touch on touch devices). */
  const input = {
    set enabled(on: boolean) {
      mouseInput.enabled = on;
      if (touchInput) touchInput.enabled = on;
    },
  };
  const hud = new Hud(container, tuning, () => openPause());

  const weapons = Object.keys(tuning.weapons);
  const arenas = pickableArenas(tuning);
  const difficulties = Object.keys(tuning.ai.difficulties);
  const savedWeapon = stored(WEAPON_STORAGE_KEY);
  const savedArena = stored(ARENA_STORAGE_KEY);

  let driver: MatchDriver | null = null;
  let names: readonly string[] | null = null;
  let bodies: readonly string[] | null = null;
  let prev: MatchState = createMatch(tuning, { bestOf: 1 });
  let curr: MatchState = prev;
  let accumulator = 0;
  let last = performance.now();
  let resultAt: number | null = null;
  let resultText = '';
  let announcer = new MatchAnnouncer();

  /** The Lobby the player is in (a Skirmish's, or a Room's), if any. */
  let lobby: Lobby | null = null;
  let unsubscribe: (() => void) | null = null;
  /** The Lobby has been shown since it was adopted (a guest's first state arrives a moment after connecting). */
  let lobbyShown = false;
  /** The Match generation being played (0: none). */
  let playing = 0;
  /** The Skirmish setup, kept for the next Skirmish. */
  let skirmish: HostLobby | null = null;
  let room: HostedRoom | null = null;
  let invite: RoomInvite | null = null;
  let attempt: Attempt | null = null;
  /** When the in-game menu last opened because the mouse was freed (the Esc that freed it must not close it again). */
  let pausedAt = -Infinity;

  const menu = new Menu(container, tuning, {
    onSkirmish() {
      skirmish ??= new HostLobby(tuning, lobbyOptions(false));
      adopt(skirmish);
      menu.showLobby(skirmish);
    },
    onCreateRoom(broker) {
      void createRoom(broker);
    },
    onJoinRoom(text, broker) {
      const address = parseRoomInput(text);
      if (!address) return menu.showOnline(`"${text.trim()}" is not a Room code or link.`);
      joinByCode(address.code, address.broker ?? broker);
    },
    onStart() {
      if (!lobby) return;
      const inGame = Boolean(driver);
      const problem = lobby.start(!inGame && lobby.online);
      if (problem) return inGame ? menu.showPause(lobby, invite, problem) : menu.showLobby(lobby, invite, problem);
      if (inGame) resume();
    },
    onLeaveLobby() {
      const online = lobby?.online ?? attempt !== null;
      leave();
      if (online) menu.showOnline();
      else menu.showTitle();
    },
    onResume: resume,
    onBackToLobby() {
      lobby?.backToLobby();
    },
    onQuit() {
      leave();
      menu.showTitle();
    },
  });

  function lobbyOptions(online: boolean): NewLobbyOptions {
    const weapon = weapons.find((w) => w === savedWeapon) ?? weapons[0]!;
    const arena = arenas.find((a) => a === savedArena) ?? tuning.arena.match;
    const difficulty = difficulties.includes('Normal') ? 'Normal' : difficulties[0]!;
    return { host: { name: menu.name, weapon, body: menu.body }, settings: { arena, bestOf: 3 }, online, ai: { difficulty, weapon: weapons[0]! } };
  }

  // --- Lobby and Room ---

  function adopt(next: Lobby): void {
    if (lobby === next) return;
    unsubscribe?.();
    lobby = next;
    lobbyShown = false;
    unsubscribe = next.onChange(onLobbyChange);
  }

  /** Stop the Match (if any), and leave the Lobby: close the Room or leave it, or drop the Skirmish setup's Match. */
  function leave(): void {
    stopMatch();
    attempt?.cancel();
    attempt = null;
    unsubscribe?.();
    unsubscribe = null;
    if (lobby && lobby !== skirmish) lobby.close();
    skirmish?.backToLobby();
    lobby = null;
    room?.cancel();
    room = null;
    invite = null;
  }

  /** Keep the Match in step with the Lobby: start each new generation this player plays, and leave a Match the host ended. */
  function onLobbyChange(): void {
    const l = lobby;
    if (!l) return;
    if (l.status === 'Closed') {
      const why = l.failure;
      leave();
      return menu.showOnline(why ?? undefined);
    }
    const s = l.state;
    if (!s) return;
    remember(l, s);
    const mine = l.me !== null && s.playing && s.inMatch.includes(l.me);
    if (mine && s.generation !== playing) return launch(l, s);
    if (!s.playing && playing) {
      stopMatch();
      return menu.showLobby(l, invite);
    }
    if (!lobbyShown && !driver) {
      lobbyShown = true;
      menu.showLobby(l, invite);
    }
  }

  /** The Weapon and Map picked last, for the next Lobby. */
  function remember(l: Lobby, s: LobbyState): void {
    const me = s.members.find((m) => m.id === l.me);
    if (me) store(WEAPON_STORAGE_KEY, me.weapon);
    if (l.isHost) store(ARENA_STORAGE_KEY, s.settings.arena);
  }

  /** Start Match `s.generation`: against the AI locally, or through a Rollback session with the other players (the host links to every guest; a guest to the host). */
  function launch(l: Lobby, s: LobbyState): void {
    playing = s.generation;
    lobbyShown = true;
    const { lineup, weapons: picks, names: playerNames, bodies: playerBodies, members } = lobbyLineup(s);
    const match = { bestOf: s.settings.bestOf, arena: s.settings.arena, seed: randomSeed() };
    if (members.length <= 1) {
      // A Skirmish, or a host playing the AIs alone while the Room waits for a player.
      const d = playerVsAi(tuning, { lineup, weapon: picks[0]!, ...match });
      return game.play({ driver: d, names: playerNames, bodies: playerBodies });
    }
    const me = members.indexOf(l.me!);
    const weapon = picks[me]!;
    let session;
    if (l.isHost) {
      // A guest who left between the start and now gets an AI in their place from the first Tick.
      const guests = members.slice(1).map((id) => l.matchTransport(s.generation, id));
      session = createRollbackSession({ role: 'host', guests, tuning, weapon, match: { ...match, rematchTicks: secondsToTicks(REMATCH_SECONDS) }, lineup });
    } else {
      const transport = l.matchTransport(s.generation, 0);
      if (!transport) return;
      session = createRollbackSession({ role: 'guest', transport, tuning, weapon });
    }
    game.play({ driver: playerVsPlayer(session, playerNames), names: playerNames, bodies: playerBodies });
  }

  /** The broker options, or undefined (after showing why) if the URL is unusable. */
  function brokerFrom(text: string): BrokerOptions | null | undefined {
    try {
      return parseBrokerUrl(text);
    } catch (e) {
      if (!(e instanceof BrokerUrlError)) throw e;
      menu.showOnline(e.message);
      return undefined;
    }
  }

  function failed(a: Attempt, e: unknown): void {
    if (attempt !== a) return; // cancelled meanwhile
    attempt = null;
    menu.showOnline(e instanceof RoomError ? e.message : `Room error: ${String(e)}`);
  }

  async function createRoom(brokerText: string): Promise<void> {
    const broker = brokerFrom(brokerText);
    if (broker === undefined) return;
    leave();
    menu.showConnecting('Creating a Room…', 'Registering with the broker.');
    const a: Attempt = { cancel() {} };
    attempt = a;
    try {
      const hosted = await hostRoom(broker);
      if (attempt !== a) return hosted.cancel();
      attempt = null;
      room = hosted;
      invite = { code: hosted.code, link: roomLink(location.href, hosted.code, brokerText.trim() || undefined) };
      const host = new HostLobby(tuning, lobbyOptions(true));
      hosted.onGuest((t) => host.addGuest(t));
      hosted.onError((e) => {
        if (room !== hosted) return;
        leave();
        menu.showOnline(e.message);
      });
      adopt(host);
      onLobbyChange();
    } catch (e) {
      failed(a, e);
    }
  }

  function joinByCode(code: string, brokerText: string): void {
    const broker = brokerFrom(brokerText);
    if (broker === undefined) return;
    leave();
    menu.showConnecting('Joining Room', 'Connecting to the host…', code);
    const pending = joinRoom(code, broker);
    attempt = pending;
    pending.connected.then(
      (transport) => {
        if (attempt !== pending) return transport.close();
        attempt = null;
        const weapon = weapons.find((w) => w === savedWeapon) ?? weapons[0]!;
        adopt(new GuestLobby(transport, tuning, { name: menu.name, weapon, body: menu.body }));
        menu.showConnecting('Joining Room', 'Connected. Waiting for the host’s Lobby…', code);
      },
      (e) => failed(pending, e),
    );
  }

  // --- Matches ---

  const game: Game = {
    play({ driver: d, names: n, bodies: b }) {
      if (driver !== d) driver?.close?.();
      driver = d;
      names = n ?? null;
      bodies = b ?? null;
      // Fresh random Bodies for the AIs.
      renderer.recast();
      local.releaseAll();
      announcer = new MatchAnnouncer();
      resultAt = null;
      hud.show();
      const start = d.state;
      // An online Match has no state until the peers connect; its first Tick then sounds.
      audio.seek(start?.tick ?? 0);
      renderer.impacts.seek(start?.tick ?? 0);
      renderer.shake.seek(start?.tick ?? 0);
      if (start) {
        prev = curr = start;
        present(start, d.localFighter);
      }
      accumulator = 0;
      // A restart the host made while this player had the in-game menu open keeps it open.
      if (menu.paused) return;
      menu.hide();
      input.enabled = true;
    },
  };

  function stopMatch(): void {
    driver?.close?.();
    driver = null;
    playing = 0;
    resultAt = null;
    input.enabled = false;
    local.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.hide();
  }

  /** The Match cannot go on (the host left, a refusal): back to the Lobby with why. */
  function matchFailed(text: string): void {
    stopMatch();
    const l = lobby;
    if (!l || l.status === 'Closed') return; // onLobbyChange says why
    l.backToLobby();
    menu.showLobby(l, invite, text);
  }

  function openPause(): void {
    if (!driver || menu.paused) return;
    input.enabled = false;
    local.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock();
    menu.showPause(lobby, invite);
  }

  function resume(): void {
    if (!driver) return;
    menu.hide();
    input.enabled = true;
    // On touch devices a pointer lock (Android Chrome grants one) sends every touch to the canvas, past the touch controls.
    if (touchInput) return;
    try {
      void Promise.resolve(renderer.canvas.requestPointerLock()).catch(() => undefined);
    } catch {
      // Refused (e.g. too soon after Esc): the next click in the Match asks again.
    }
  }

  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (performance.now() - pausedAt < 400) return;
    if (driver && !menu.visible) openPause();
    else if (menu.visible) menu.back();
  });
  document.addEventListener('pointerlockchange', () => {
    // Esc frees the mouse first (and some browsers swallow that Esc): freeing it in a Match opens the menu.
    if (document.pointerLockElement || !driver || menu.visible || !mouseInput.enabled) return;
    pausedAt = performance.now();
    openPause();
  });

  function aimAtDuelStart(match: MatchState): void {
    if (!driver) return;
    const f = match.duel.fighters[driver.localFighter];
    if (f) local.setYaw(f.facing);
  }

  /**
   * Announce what this Match state shows that is new (a Duel started or ended, the local Fighter
   * fell, the Match result), from the local player's team's side.
   * Read from the state, not the Tick's events: with Rollback the Tick carrying an event may only
   * ever have been re-simulated, and a Tick may be presented twice.
   */
  function present(match: MatchState, me: number): void {
    const myTeam = match.config.teams[me] ?? 0;
    for (const e of announcer.update(match, me)) {
      if (e.type === 'DuelEnd') {
        hud.announce(e.winner === null ? 'Draw' : e.winner === myTeam ? 'Duel won' : 'Duel lost');
      } else if (e.type === 'DuelStart') {
        hud.announce(e.duelNumber === 1 && match.matchNumber > 1 ? `Match ${match.matchNumber}` : `Duel ${e.duelNumber}`, 1.5);
        aimAtDuelStart(match);
      } else if (e.type === 'Fell') {
        hud.announce('You fell', 1.5);
      } else if (e.type === 'MatchEnd') {
        const verdict = e.winner === myTeam ? 'Victory' : 'Defeat';
        const score = `${match.score[myTeam]} – ${match.score[1 - myTeam]}`;
        if (match.config.rematchTicks !== null) {
          // Online: a fresh Match follows on its own; the result stays up until it starts.
          hud.announce(`${verdict}  ${score}`, match.config.rematchTicks * TICK_SECONDS);
        } else {
          resultText = `${e.winner === myTeam ? 'You win' : 'You lose'}  ${score}`;
          hud.announce(verdict, RESULT_SECONDS);
          resultAt = performance.now() + RESULT_SECONDS * 1000;
        }
      }
    }
  }

  // --- The scene behind the menus ---

  let previewKey = '';
  let preview: MatchState = curr;
  /** Behind the menus: the Lobby's Map and Fighters standing ready (or a plain Duel on the last Map). */
  function previewMatch(): { match: MatchState; me: number; bodies: (string | undefined)[] } {
    const s = lobby?.state;
    const arena = s?.settings.arena ?? arenas.find((a) => a === stored(ARENA_STORAGE_KEY)) ?? tuning.arena.match;
    let options: MatchOptions = { bestOf: 1, arena, weapons: [stored(WEAPON_STORAGE_KEY) ?? weapons[0]!, weapons[0]!] };
    let me = 0;
    let chosen: (string | undefined)[] = [];
    if (s) {
      const { lineup, weapons: picks, bodies: playerBodies, members } = lobbyLineup(s);
      chosen = fighterBodies(lineup, playerBodies);
      const player = members.indexOf(lobby!.me ?? -1);
      if (lineup.some((x) => x.team === 0) && lineup.some((x) => x.team === 1)) options = lineupMatch(tuning, lineup, picks, { bestOf: 1, arena });
      me = player >= 0 ? playerFighter(lineup, player as PlayerNumber) : -1;
    }
    const key = JSON.stringify(options);
    if (key !== previewKey) {
      try {
        preview = createMatch(tuning, options);
        previewKey = key;
      } catch {
        // Not a fieldable Lineup (yet): keep the last scene.
      }
    }
    return { match: preview, me, bodies: chosen };
  }

  // --- The loop ---

  setInterval(() => lobby?.pump(performance.now()), LOBBY_PUMP_MS);

  function frame(now: number): void {
    const frameSeconds = (now - last) / 1000;
    accumulator += Math.min(frameSeconds, MAX_TICKS_PER_FRAME * TICK_SECONDS);
    last = now;
    // A Skirmish pauses with its menu open; an online Match runs on (the other players are still fighting).
    const frozen = menu.paused && !lobby?.online;
    while (driver && !frozen && accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      const d = driver;
      const { advanced } = d.tick(local.sample());
      if (d.failure) {
        matchFailed(d.failure);
        break;
      }
      if (!advanced || !d.state) continue;
      // Possibly predicted, or corrected by a Rollback: the Renderer just interpolates from the last state shown.
      prev = curr;
      curr = d.state;
      audio.onMatchTick(curr);
      renderer.impacts.onTick(curr.tick, curr.duel);
      renderer.shake.onTick(curr.tick, curr.duel, d.localFighter);
      present(curr, d.localFighter);
    }
    if (frozen) accumulator = 0;
    if (driver?.waiting) hud.announce(driver.waiting, 0.5);
    const notice = driver?.takeNotice?.();
    if (notice) hud.announce(notice, 3);
    if (!driver) accumulator = 0;
    if (resultAt !== null && now >= resultAt) {
      resultAt = null;
      const l = lobby;
      stopMatch();
      if (l) {
        l.backToLobby();
        menu.showLobby(l, invite, resultText);
      } else menu.showTitle(resultText);
    }

    if (driver) {
      const alpha = accumulator / TICK_SECONDS;
      // A fresh Duel resets the Fighters: don't interpolate across the swap.
      const before: SimState = prev.duelNumber === curr.duelNumber ? prev.duel : curr.duel;
      const me = driver.localFighter;
      const yaw = local.yaw;
      // Fallen while the team fights on: orbit the fight instead of staring at the floor.
      if (curr.duel.fighters[me]?.death && curr.duel.duel.status === 'Fighting')
        placeOrbitCamera(renderer.camera, tuning.camera, fightCentre(before, curr.duel, alpha), yaw, renderer.collider);
      else placeThirdPersonCamera(renderer.camera, tuning.camera, lerpPosition(before, curr.duel, me, alpha), yaw, local.pitch, renderer.collider);
      renderer.shake.apply(renderer.camera, frozen ? 0 : frameSeconds);
      renderer.setPlayer(me, menu.body);
      renderer.setChosenBodies(fighterBodies(driver.lineup, bodies));
      renderer.render(before, curr.duel, alpha);
      hud.update(curr, { localFighter: me, lineup: driver.lineup, ping: driver.ping ?? null, names });
    } else {
      const { match, me, bodies: chosen } = previewMatch();
      const duel = match.duel;
      const mine = duel.fighters[me];
      if (menu.focus === 'character' && mine) {
        // Your Fighter close up, from a three-quarter angle off the line to the opponent (who would block a front view), swaying a little.
        const yaw = mine.facing + Math.PI + 1.05 + Math.sin(now / 2500) * 0.25;
        placeOrbitCamera(renderer.camera, { ...tuning.camera, ...CLOSE_UP }, { x: mine.position.x, y: mine.y, z: mine.position.z }, yaw, renderer.collider);
        // On a wide screen the Character card covers the left: turn so your Fighter stands in the space to its right.
        if (innerWidth > 820) renderer.camera.rotateY(CLOSE_UP_TURN);
      } else {
        placeOrbitCamera(renderer.camera, tuning.camera, fightCentre(duel, duel, 1), (now / 1000) * ORBIT_SPEED, renderer.collider);
      }
      renderer.setPlayer(me, menu.body);
      renderer.setChosenBodies(chosen);
      renderer.render(duel, duel, 1);
    }
    requestAnimationFrame(frame);
  }

  addEventListener('pagehide', () => leave());

  menu.showTitle();
  // Opened from a Room link: join it right away, and drop the hash so a reload doesn't rejoin.
  if (location.hash.startsWith(ROOM_ROUTE)) {
    const linked = parseRoomInput(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (linked) joinByCode(linked.code, linked.broker ?? menu.broker);
    else menu.showOnline('That Room link is not valid.');
  }
  requestAnimationFrame(frame);
  return game;
}

/** Each Fighter's chosen Body: its Player's (index = Player number), none for an AI. */
function fighterBodies(lineup: Lineup | null, bodies: readonly string[] | null): (string | undefined)[] {
  return (lineup ?? []).map((slot) => (slot.pilot.kind === 'Player' ? bodies?.[slot.pilot.player] : undefined));
}

/** Where the living Fighters are, on average (the Arena centre if none). */
function fightCentre(a: SimState, b: SimState, alpha: number): CameraTarget {
  const living = b.fighters.flatMap((f, i) => (f.death ? [] : [lerpPosition(a, b, i, alpha)]));
  if (living.length === 0) return { x: 0, z: 0 };
  const mean = (k: 'x' | 'y' | 'z') => living.reduce((s, p) => s + (p[k] ?? 0), 0) / living.length;
  return { x: mean('x'), y: mean('y'), z: mean('z') };
}

/** Where Fighter `fighter` stands between two Ticks: on the ground plane, and the height of its feet. */
function lerpPosition(a: SimState, b: SimState, fighter: number, alpha: number): CameraTarget {
  const f = b.fighters[fighter];
  const g = a.fighters[fighter] ?? f;
  if (!f || !g) return { x: 0, z: 0 };
  const l = (u: number, v: number) => u + (v - u) * alpha;
  return { x: l(g.position.x, f.position.x), y: l(g.y, f.y), z: l(g.position.z, f.position.z) };
}
