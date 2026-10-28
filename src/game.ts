import { ARENA_SEED_RANGE, createMatch, doorTicksNeeded, hallRoster, inDuel, isArenaName, parseGeneratedName, runCleared, runHall, runSeed, secondsToTicks, TICK_SECONDS, type MatchOptions, type MatchState, type SimState } from './sim';
import { parseRunKnobs, type RunKnobs, type TuningData } from './tuning';
import { Vector3 } from 'three';
import { Renderer } from './render/renderer';
import { BODY_MODELS } from './render/bodyModel';
import { CameraShake } from './render/cameraShake';
import { placeOrbitCamera, placeShotCamera, placeThirdPersonCamera, type CameraTarget } from './render/thirdPersonCamera';
import { arenaSurface, createBrowserAudio } from './audio';
import { createAutopilot, INVENTORY_LIST_KEY, inventoryKey, lineupMatch, LocalController, playerFighter, type Lineup, type PlayerNumber } from './controllers';
import { arenasToWarm, createArenaWorlds, warmArena, warmingWaits } from './play/arenaWorlds';
import { playerVsAi, type MatchDriver } from './play/driver';
import { devAutopilot, devAutopilotLoot, devRunRelics, devRunStart } from './devMode';
import { bindLocalInput } from './play/input';
import { InventoryScreen } from './play/inventoryScreen';
import { inventoryHoldsInput } from './play/inventoryView';
import { bindTouchInput, isTouchDevice } from './play/touch';
import { doorMarkView, doorRun } from './play/doorMarks';
import { mapKeyAction } from './play/floorMap';
import { pickupViews, type PickupView } from './render/pickupView';
import { fireState } from './render/restFire';
import { playerName, runBuilds } from './play/runBuilds';
import { hallBanner, Hud, runResultLine, type RunResult } from './play/hud';
import { Menu, type RoomInvite } from './play/menu';
import { MatchAnnouncer } from './play/announcer';
import { FinalBlowShot, shotIntent } from './play/finalBlow';
import { pickableArenas, randomMap } from './play/lobbyView';
import { playerVsPlayer } from './play/online';
import { GuestLobby, HostLobby, lobbyLineup, nextMatchArena, runTuning, type Lobby, type LobbyState, type NewLobbyOptions } from './lobby';
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

/** Scratch for the camera's direction each frame. */
const cameraDir = new Vector3();

/** Never simulate more than this many Ticks in one rendered frame (e.g. after a background tab). */
const MAX_TICKS_PER_FRAME = 8;
/** How long the final result stays on screen before the Lobby returns (seconds, cosmetic). */
const RESULT_SECONDS = 2.5;
/** How long a Run's results screen stays up, after its Final Blow Shot, before the Lobby returns (seconds, cosmetic). */
const RUN_RESULT_SECONDS = 6;
/** A Run's exit Halls are built one at a time this far apart (ms), so no one frame takes all of them. */
const WARM_STAGGER_MS = 120;
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
const FORMAT_STORAGE_KEY = 'sword.format';
const RUN_KNOBS_STORAGE_KEY = 'sword.runKnobs';
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

/** The Run knobs picked last (each a number; `applyDungeonKnobs` holds them to their ranges), or null for none. */
function storedKnobs(): RunKnobs | null {
  try {
    // Only today's knobs: a stale key (v1's `heal`) is dropped, as the Lobby message would refuse it.
    return parseRunKnobs(JSON.parse(stored(RUN_KNOBS_STORAGE_KEY) ?? 'null'));
  } catch {
    return null;
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
  /** The Tuning Data a Match on an Arena is played with, and a Random Map's Layout (`createArenaWorlds`). */
  const arenaWorld = createArenaWorlds(tuning);
  const renderer = new Renderer(container, tuning, arenaWorld);
  const audio = createBrowserAudio();
  renderer.onDaggerClatter = (point, arena) => audio.playCue({ sound: 'Clatter', point, surface: arenaSurface(arena) });
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
  const hud = new Hud(container, tuning, () => openPause(), () => toggleMap());
  /** The inventory screen (`I`, or its touch button): render only, its clicks become the Local Controller's `equip` and `drop`. */
  const inventoryScreen = new InventoryScreen((ref, action) => local.inventoryClick(ref, action), () => toggleInventory());
  hud.root.append(inventoryScreen.root);

  const weapons = Object.keys(tuning.weapons);
  const arenas = pickableArenas(tuning);
  const difficulties = Object.keys(tuning.ai.difficulties);
  const savedWeapon = stored(WEAPON_STORAGE_KEY);
  const savedArena = stored(ARENA_STORAGE_KEY);
  const savedFormat = stored(FORMAT_STORAGE_KEY);
  const savedKnobs = storedKnobs();

  let driver: MatchDriver | null = null;
  let names: readonly string[] | null = null;
  let bodies: readonly string[] | null = null;
  let prev: MatchState = createMatch(tuning, { bestOf: 1 });
  let curr: MatchState = prev;
  let accumulator = 0;
  let last = performance.now();
  let resultAt: number | null = null;
  let resultText = '';
  /** A Run that ended, its results screen not shown yet (it waits for the Final Blow Shot). */
  let runResult: RunResult | null = null;
  let announcer = new MatchAnnouncer();
  /** The slow-motion replay of each Duel's final blow; while it plays, audio and impacts follow it rather than the live Match. */
  const finalBlow = new FinalBlowShot(tuning.camera);
  let inShot = false;
  /** Jolts the player's camera on the Hits, Knockdowns and hurting Landings of the live Match (never during the Final Blow Shot). */
  const shake = new CameraShake();

  /** The Lobby the player is in (a Skirmish's, or a Room's), if any. */
  let lobby: Lobby | null = null;
  let unsubscribe: (() => void) | null = null;
  /** The Lobby has been shown since it was adopted (a guest's first state arrives a moment after connecting). */
  let lobbyShown = false;
  /** The Match generation being played (0: none). */
  let playing = 0;
  /** The Arena of the Match played last in this Lobby (online a Rematch moves it on), or null: a Random Map's next Match follows on from it. */
  let played: string | null = null;
  /** The Tuning Data the Match is played with, and the Arenas built ahead for it (a Rematch's, or a Run's exit Halls'). */
  let matchTuning = tuning;
  let warmed = new Set<string>();
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
      const problem = lobby.start(!inGame && lobby.online, played ?? undefined);
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
    onPs1(on) {
      renderer.setPs1(on);
    },
    onColliders(on) {
      renderer.setColliders(on);
    },
  });
  renderer.setPs1(menu.ps1);
  renderer.setColliders(menu.colliders);

  function lobbyOptions(online: boolean): NewLobbyOptions {
    const weapon = weapons.find((w) => w === savedWeapon) ?? weapons[0]!;
    const random = savedArena !== null && savedArena.startsWith('gen:') && isArenaName(tuning, savedArena);
    // The Format picked last: a Gauntlet on its Random Map, or a fresh one, in a Skirmish and in a Room.
    const gauntlet = savedFormat === 'Gauntlet' && Object.keys(tuning.kits).length > 0;
    const arena = random || (savedArena !== null && !gauntlet && arenas.includes(savedArena)) ? savedArena! : gauntlet ? randomMap(tuning, Math.floor(Math.random() * ARENA_SEED_RANGE)) : tuning.arena.match;
    const difficulty = difficulties.includes('Normal') ? 'Normal' : difficulties[0]!;
    const settings = { arena, bestOf: 3, ...(gauntlet ? { format: 'Gauntlet' as const } : {}), ...(savedKnobs ? { run: savedKnobs } : {}) };
    return { host: { name: menu.name, weapon, body: menu.body }, settings, online, ai: { difficulty, weapon: weapons[0]! } };
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
    setPlayed(null);
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
    if (l.isHost) {
      store(ARENA_STORAGE_KEY, s.settings.arena);
      store(FORMAT_STORAGE_KEY, s.settings.format ?? 'Duels');
      store(RUN_KNOBS_STORAGE_KEY, JSON.stringify(s.settings.run ?? {}));
    }
  }

  /** Remember the Arena being played, and name it in the in-game menu. */
  function setPlayed(arena: string | null): void {
    if (arena === played) return;
    played = arena;
    menu.setArenaInPlay(arena);
  }

  /**
   * Build the next Arenas ahead (`arenasToWarm`), with their navmeshes for the Match's Tuning Data: an online Match's
   * Rematch's while the result shows, or every exit Hall's once a Run's Hall is Cleared, so the Tick that moves onto
   * one (and any Rollback re-simulating it) only reads the cache whichever Door the party takes. Building takes a few
   * hundred ms each, so a Run's waits for the Final Blow Shot to end, unless the next Hall is close (`warmingWaits`).
   */
  function warmNextArena(match: MatchState): void {
    const next = arenasToWarm(match, matchTuning).filter((name) => !warmed.has(name));
    if (next.length === 0 || warmingWaits(match, inShot)) return;
    const t = matchTuning;
    // After this frame, so the result (or the cleared Hall) is on screen first; one at a time, the taken Door's first.
    next.forEach((name, k) => {
      warmed.add(name);
      setTimeout(() => warmArena(arenaWorld, t, name), k * WARM_STAGGER_MS);
    });
  }

  /** Start Match `s.generation`: against the AI locally, or through a Rollback session with the other players (the host links to every guest; a guest to the host). */
  function launch(l: Lobby, s: LobbyState): void {
    playing = s.generation;
    lobbyShown = true;
    const { lineup, weapons: picks, names: playerNames, bodies: playerBodies, members } = lobbyLineup(s);
    // The Lobby's Map for its first Match, then (a Random Map) the next seed each Match: the host's Lobby says which.
    const arena = s.matchArena ?? s.settings.arena;
    const match = { bestOf: s.settings.bestOf, arena, seed: randomSeed(), ...(s.settings.format === 'Gauntlet' ? { format: 'Gauntlet' as const } : {}) };
    // Every peer builds a Random Map from its name; the Tuning Data hash then covers the Arena too.
    matchTuning = runTuning(arenaWorld(arena).tuning, s.settings);
    warmed = new Set();
    setPlayed(arena);
    if (members.length <= 1) {
      // A Skirmish, or a host playing the AIs alone while the Room waits for a player.
      // In dev mode a Run may start deeper in (`?dev=1&floor=F&row=R`), for tuning: only a Run stepped here, never an online one.
      // ...and the player's Fighter may be on an AI (`?dev=1&autopilot=1,2`), to check a Run in a headless browser.
      const autopilot = match.format ? devAutopilot() : null;
      const d = playerVsAi(matchTuning, { lineup, weapon: picks[0]!, ...match, ...(match.format ? { ...devRunStart(), ...devRunRelics() } : {}), ...(autopilot ? { autopilot, autopilotLoot: devAutopilotLoot() } : {}) });
      return game.play({ driver: d, names: playerNames, bodies: playerBodies });
    }
    const me = members.indexOf(l.me!);
    const weapon = picks[me]!;
    let session;
    if (l.isHost) {
      // A guest who left between the start and now gets an AI in their place from the first Tick.
      const guests = members.slice(1).map((id) => l.matchTransport(s.generation, id));
      // Duels restart on their own; a Run has no Rematch (the host starts the next one from the in-game menu).
      const rematch = match.format === 'Gauntlet' ? {} : { rematchTicks: secondsToTicks(REMATCH_SECONDS) };
      session = createRollbackSession({ role: 'host', guests, tuning: matchTuning, weapon, match: { ...match, ...rematch }, lineup });
    } else {
      const transport = l.matchTransport(s.generation, 0);
      if (!transport) return;
      session = createRollbackSession({ role: 'guest', transport, tuning: matchTuning, weapon });
    }
    // Dev mode only: this peer's Fighter on the autopilot too (`?dev=1&autopilot=...`), for the two-browser check of a Run.
    const doors = match.format ? devAutopilot() : null;
    const pilot = doors ? createAutopilot(matchTuning, 'Hard', doors, devAutopilotLoot()) : undefined;
    game.play({ driver: playerVsPlayer(session, playerNames, pilot), names: playerNames, bodies: playerBodies });
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
      endShot();
      finalBlow.stop();
      resultAt = null;
      runResult = null;
      inventoryScreen.open = false;
      hud.show();
      const start = d.state;
      // An online Match has no state until the peers connect; its first state then sounds.
      audio.seek(start ? start.tick - 1 : -1);
      renderer.impacts.seek(start?.tick ?? 0);
      shake.seek(start?.tick ?? 0);
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
    runResult = null;
    endShot();
    finalBlow.stop();
    inventoryScreen.open = false;
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

  /** The Floor map (`M`, or its touch button) over a live Run, which keeps simulating; the mouse is freed while it is open and taken again on close, as the menu does. */
  function toggleMap(): void {
    if (!driver || menu.visible) return;
    if (hud.map.open) {
      hud.setMapOpen(false);
      if (!touchInput) resume();
    } else if (curr.run) {
      if (inventoryScreen.open) toggleInventory();
      hud.setMapOpen(true);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  function openPause(): void {
    if (!driver || menu.paused) return;
    inventoryScreen.open = false;
    hud.setMapOpen(false);
    input.enabled = false;
    local.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock();
    menu.showPause(lobby, invite);
  }

  function resume(): void {
    if (!driver) return;
    menu.hide();
    input.enabled = true;
    lockPointer();
  }

  function lockPointer(): void {
    // On touch devices a pointer lock (Android Chrome grants one) sends every touch to the canvas, past the touch controls.
    if (touchInput) return;
    try {
      void Promise.resolve(renderer.canvas.requestPointerLock()).catch(() => undefined);
    } catch {
      // Refused (e.g. too soon after Esc): the next click in the Match asks again.
    }
  }

  /**
   * Open or close the inventory screen. Open, it frees the mouse and, once the Hall is not being fought (`inventoryHoldsInput`), takes the
   * Controller's input (as the menu does); in a fight the Fighter keeps its keys. The Simulation runs on; closed, the input and the pointer lock
   * come back. The number keys and X still work while it is open (they go to the Controller here, or through the input if it is still on).
   */
  function toggleInventory(): void {
    if (!driver || menu.visible) return;
    const opening = !inventoryScreen.open;
    if (opening) hud.setMapOpen(false);
    inventoryScreen.open = opening;
    if (opening) {
      syncInventoryInput();
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      input.enabled = true;
      lockPointer();
    }
  }

  /** While the screen is open, the input follows the Hall: held in a cleared Hall, the Fighter's own again when the next fight begins. */
  function syncInventoryInput(): void {
    if (!inventoryScreen.open || menu.visible) return;
    const hold = inventoryHoldsInput(curr.run?.phase);
    if (hold !== mouseInput.enabled) return;
    input.enabled = !hold;
    if (hold) local.releaseAll();
  }

  addEventListener('keydown', (e) => {
    if (e.code === INVENTORY_LIST_KEY && !e.repeat) toggleInventory();
    else if (inventoryScreen.open && !mouseInput.enabled && !e.repeat && inventoryKey(e.code, null)) local.keyDown(e.code, e.shiftKey);
    const mapAction = mapKeyAction(e.code, hud.map.open);
    if (mapAction && !e.repeat) {
      if (mapAction === 'toggle') toggleMap();
      else if (!menu.visible) toggleMap();
      if (e.code === 'Escape') return;
    }
    if (e.code !== 'Escape' || e.repeat) return;
    if (inventoryScreen.open) return toggleInventory();
    if (performance.now() - pausedAt < 400) return;
    if (driver && !menu.visible) openPause();
    else if (menu.visible) menu.back();
  });
  document.addEventListener('pointerlockchange', () => {
    // Esc frees the mouse first (and some browsers swallow that Esc): freeing it in a Match opens the menu.
    if (document.pointerLockElement || !driver || menu.visible || !mouseInput.enabled || hud.map.open || inventoryScreen.open) return;
    pausedAt = performance.now();
    openPause();
  });

  /** The Final Blow Shot ended (or was cut): back to the live Match's sounds and sparks. `rest`: a Hall's Ticks the replay never reached, which sound now. */
  function endShot(rest: readonly MatchState[] = []): void {
    if (!inShot) return;
    inShot = false;
    hud.cinematic(false);
    audio.setSpeed(1);
    for (const m of rest) audio.onMatchTick(m);
    audio.seek(curr.tick);
    renderer.impacts.seek(curr.tick);
    shake.seek(curr.tick);
  }

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
    const run = match.run;
    for (const e of announcer.update(match, me)) {
      if (e.type === 'DuelEnd') {
        // A Run's Duel ends only with the Run (a wipe, or the last Boss): the results screen says so.
        if (run) continue;
        hud.announce(e.winner === null ? 'Draw' : e.winner === myTeam ? 'Duel won' : 'Duel lost');
      } else if (e.type === 'HallCleared') {
        // A Hall with no Encounter (Treasure, Rest) is open from the start: its banner said what it is. The last Boss ends the Run.
        if (match.status.status === 'Over' || e.kind === 'Treasure' || e.kind === 'Rest') continue;
        hud.announce('Hall cleared', 2);
      } else if (e.type === 'Rested') {
        hud.announce('Rested', 1.5);
      } else if (e.type === 'DuelStart') {
        const seed = parseGeneratedName(match.arena)?.seed;
        if (run) {
          const kind = match.duel.hall?.kind;
          const banner = hallBanner(run, run.floors, runSeed(match.config.arena));
          hud.announce(kind === 'Treasure' || kind === 'Rest' ? `${kind} · ${banner}` : banner, 2.5);
          aimAtDuelStart(match);
          continue;
        }
        const title = e.duelNumber === 1 && match.matchNumber > 1 ? `Match ${match.matchNumber}` : `Duel ${e.duelNumber}`;
        // A Random Map's seed with each Match's first Duel, so a good one can be played again.
        hud.announce(e.duelNumber === 1 && seed !== undefined ? `${title} · seed ${seed}` : title, e.duelNumber === 1 && seed !== undefined ? 2.5 : 1.5);
        aimAtDuelStart(match);
      } else if (e.type === 'Fell') {
        hud.announce('You fell', 1.5);
      } else if (e.type === 'MatchEnd' && run && match.status.status === 'Over') {
        // The Run's results screen follows the Final Blow Shot (see the loop), then the Lobby.
        const cleared = runCleared(run);
        runResult = {
          victory: e.winner === myTeam,
          cleared: cleared.floors,
          floors: run.floors,
          halls: cleared.halls,
          seconds: (match.status.tick - run.startTick) * TICK_SECONDS,
          seed: runSeed(match.config.arena),
          builds: runBuilds(match, (f) => playerName(driver?.lineup ?? null, names, f)),
        };
        resultText = runResultLine(runResult);
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
    // The next Match's Arena (built now, so the Fight that starts it does not wait for it).
    const arena = (s && nextMatchArena(s, played ?? undefined)) ?? arenas.find((a) => a === stored(ARENA_STORAGE_KEY)) ?? tuning.arena.match;
    let options: MatchOptions = { bestOf: 1, arena, weapons: [stored(WEAPON_STORAGE_KEY) ?? weapons[0]!, weapons[0]!] };
    let me = 0;
    let seated: { lineup: Lineup; bodies: readonly string[] } | null = null;
    if (s) {
      const { lineup, weapons: picks, bodies: playerBodies, members } = lobbyLineup(s);
      seated = { lineup, bodies: playerBodies };
      const player = members.indexOf(lobby!.me ?? -1);
      const format = s.settings.format === 'Gauntlet' ? ({ format: 'Gauntlet' } as const) : {};
      if (lineup.some((x) => x.team === 0) && lineup.some((x) => x.team === 1)) options = lineupMatch(tuning, lineup, picks, { bestOf: 1, arena, ...format });
      me = player >= 0 ? playerFighter(lineup, player as PlayerNumber) : -1;
    }
    const key = JSON.stringify([options, s?.settings.run]);
    if (key !== previewKey) {
      try {
        preview = createMatch(s ? runTuning(arenaWorld(arena).tuning, s.settings) : arenaWorld(arena).tuning, options);
        previewKey = key;
      } catch {
        // Not a fieldable Lineup (yet): keep the last scene.
      }
    }
    // A Run's first Hall's enemies wear their own Bodies.
    return { match: preview, me, bodies: seated ? fighterBodies(tuning, seated.lineup, seated.bodies, preview) : [] };
  }

  // --- The loop ---

  setInterval(() => lobby?.pump(performance.now()), LOBBY_PUMP_MS);

  function frame(now: number): void {
    const elapsed = Math.min((now - last) / 1000, MAX_TICKS_PER_FRAME * TICK_SECONDS);
    accumulator += elapsed;
    last = now;
    // A Skirmish pauses with its menu open; an online Match runs on (the other players are still fighting).
    const frozen = menu.paused && !lobby?.online;
    // A Match's first state (Tick 0, with its first DuelStart) is never stepped into: hear it once it exists.
    if (driver?.state && !inShot) audio.onMatchTick(driver.state);
    while (driver && !frozen && accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      const d = driver;
      // A Hall's Final Blow Shot holds the Player (sampled all the same, so a press during it is spent).
      const { advanced } = d.tick(shotIntent(finalBlow, local.sample()));
      if (d.failure) {
        matchFailed(d.failure);
        break;
      }
      if (!advanced || !d.state) continue;
      // Possibly predicted, or corrected by a Rollback: the Renderer just interpolates from the last state shown.
      prev = curr;
      curr = d.state;
      if (finalBlow.record(curr, local.yaw, doorTicksNeeded(matchTuning)) && !inShot) {
        // The last Fighter of a Team fell: cut to the Final Blow Shot, which replays from a moment before.
        inShot = true;
        hud.cinematic(true);
        audio.seek(finalBlow.startTick!);
        audio.setSpeed(tuning.camera.finalBlowSpeed);
        renderer.impacts.seek(finalBlow.startTick!);
        shake.seek(curr.tick);
      }
      if (!inShot) {
        audio.onMatchTick(curr);
        renderer.impacts.onTick(curr.tick, curr.duel);
        shake.onTick(curr.tick, curr.duel.events, d.localFighter);
      }
      present(curr, d.localFighter);
      setPlayed(curr.arena);
      warmNextArena(curr);
    }
    if (frozen) accumulator = 0;
    if (driver?.waiting) hud.announce(driver.waiting, 0.5);
    const notice = driver?.takeNotice?.();
    if (notice) hud.announce(notice, 3);
    if (!driver) accumulator = 0;
    if (runResult && !inShot) {
      if (lobby?.online) {
        // Online the results stay up on every peer, the Match running on behind them, until the host starts the next Run or ends it.
        hud.showResults(runResult, lobby.isHost ? 'Esc: Restart for a new Run on the next seed, or Back to Lobby.' : 'Waiting for the host: a new Run, or back to the Lobby.');
      } else {
        hud.showResults(runResult);
        resultAt = now + RUN_RESULT_SECONDS * 1000;
      }
      runResult = null;
    }
    if (resultAt !== null && now >= resultAt && !inShot) {
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
      const shot = inShot ? finalBlow.frame(frozen ? 0 : elapsed) : null;
      if (inShot && !shot) endShot(finalBlow.takeRest());
      renderer.setPlayer(me, menu.body);
      // The camera as last placed: a frame behind is fine for choosing what to label.
      const mine = curr.duel.fighters[me];
      const pickups: PickupView[] = mine
        ? pickupViews(curr.run?.pickups ?? [], me, {
            at: renderer.camera.position,
            dir: renderer.camera.getWorldDirection(cameraDir),
            near: { x: mine.position.x, y: mine.y, z: mine.position.z },
          })
        : [];
      renderer.setPickups(pickups);
      renderer.setFire(fireState(curr.run?.rested ?? [], me));
      const doorRunNow = doorRun(curr, matchTuning);
      renderer.setDoors(doorRunNow ? doorMarkView(curr.duel.hall, doorRunNow.exits, doorRunNow.players) : []);
      renderer.setChosenBodies(fighterBodies(matchTuning, driver.lineup, bodies, curr));
      if (shot) {
        for (const m of shot.reached) {
          audio.onMatchTick(m);
          renderer.impacts.onTick(m.tick, m.duel);
        }
        const { camera } = tuning;
        placeShotCamera(renderer.camera, shot.centre, shot.yaw, camera.finalBlowDistance, camera.finalBlowHeight, renderer.collider);
        renderer.render(shot.from, shot.to, shot.alpha, camera.finalBlowSpeed);
      } else {
        // Fallen while the team fights on: orbit the fight instead of staring at the floor.
        if (curr.duel.fighters[me]?.death && curr.duel.duel.status === 'Fighting')
          placeOrbitCamera(renderer.camera, tuning.camera, fightCentre(before, curr.duel, alpha), yaw, renderer.collider);
        else placeThirdPersonCamera(renderer.camera, tuning.camera, lerpPosition(before, curr.duel, me, alpha), yaw, local.pitch, renderer.collider);
        shake.update(frozen ? 0 : elapsed);
        shake.apply(renderer.camera, tuning.camera.shake);
        renderer.render(before, curr.duel, alpha);
      }
      if (touchInput) touchInput.sheathed = curr.duel.fighters[me]?.sheathed ?? false;
      hud.update(curr, { localFighter: me, lineup: driver.lineup, ping: driver.ping ?? null, names, tuning: matchTuning, project: (p) => renderer.toScreen(p), pickups });
      syncInventoryInput();
      inventoryScreen.update(curr.duel.fighters[me], matchTuning, curr.run?.phase);
    } else {
      renderer.setPickups([]);
      renderer.setDoors([]);
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

/**
 * Each Fighter's chosen Body: its Player's (index = Player number), none for an AI. In a Run, each Team 1 slot wears its
 * Hall's enemy's Body when Tuning Data names one (a `"random"` one picked from the Run seed, `hallRoster`; the last Boss's wraith).
 */
function fighterBodies(tuning: TuningData, lineup: Lineup | null, bodies: readonly string[] | null, match: MatchState): (string | undefined)[] {
  const roster = match.run ? hallRoster(tuning, match.config, runHall(match.run), BODY_MODELS) : [];
  let enemy = 0;
  return (lineup ?? []).map((slot) => {
    if (match.run && slot.team === 1) return roster[enemy++]?.body;
    return slot.pilot.kind === 'Player' ? bodies?.[slot.pilot.player] : undefined;
  });
}

/** Where the Fighters still in the Duel are, on average (the Arena centre if none): neither fallen nor Benched. */
function fightCentre(a: SimState, b: SimState, alpha: number): CameraTarget {
  const living = b.fighters.flatMap((f, i) => (inDuel(f) ? [lerpPosition(a, b, i, alpha)] : []));
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
