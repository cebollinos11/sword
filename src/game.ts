import { ARENA_SEED_RANGE, battleNameFor, createMatch, hashValue, inDuel, isArenaName, parseGeneratedName, runPlayers, runSeed, secondsToTicks, TICK_SECONDS, traitorOf, type MatchOptions, type Pickup, type MatchState, type SimState } from './sim';
import { parseBattleKnobs, storedSize, type BattleKnobs, type Size, type TuningData } from './tuning';
import { Vector3, type Camera } from 'three';
import { Renderer } from './render/renderer';
import { BODY_MODELS, preloadBody } from './render/bodyModel';
import { LoadingBar, WARM_UP_DETAIL } from './play/loadingBar';
import { CameraShake } from './render/cameraShake';
import { FIRST_PERSON_KEY, firstPersonBlocked, FirstPersonView } from './render/firstPerson';
import { cameraForHeight, placeOrbitCamera, placeShotCamera, placeThirdPersonCamera, type CameraTarget } from './render/thirdPersonCamera';
import { arenaSurface, CHEST, createBrowserAudio, type Ears } from './audio';
import { createBattlePilot, createDelverPilot, createTraitorPilot, INVENTORY_LIST_KEY, lineupMatch, LocalController, playerFighter, type Lineup, type PlayerNumber } from './controllers';
import { arenaToWarm, createArenaWorlds, warmArena } from './play/arenaWorlds';
import { playerInBattle, playerVsAi, type MatchDriver } from './play/driver';
import { spectateTarget } from './play/spectateFollow';
import type { BattleScreen } from './play/battleScreen';
import type { FloorCrowd } from './play/floorCrowd';
import { playersBySlot } from './play/battleHud';
import { PlayerTags } from './play/playerTags';
import { DamageNumbers } from './play/damageNumbers';
import { partyMarkers } from './render/minimap';
import { devAutopilot, devBattlePilot, devDelverStart, devImmortal, devMode, devSpeed, devRunRelics } from './devMode';
import { bindLocalInput } from './play/input';
import { bindGamepadInput } from './play/gamepad';
import { InventoryScreen } from './play/inventoryScreen';
import { delverContextOf, type DelverContext } from './play/inventoryView';
import { bindTouchInput, isTouchDevice } from './play/touch';
import { mapKeyAction } from './play/floorMap';
import { crateTop, pickupViews, type PickupView } from './render/pickupView';
import { crateStacked } from './render/mapProps';
import { gateState, type DelverMarksView } from './render/delverMarks';
import { bossesBeaten } from './sim/delverRun';
import { floorOf } from './sim/delver';
import { playerName, runBuilds } from './play/runBuilds';
import { Hud, runResultLine, traitorWatchLine, type RunResult } from './play/hud';
import { Menu, type RoomInvite } from './play/menu';
import { MatchAnnouncer } from './play/announcer';
import { floorBodies, floorBodyOf } from './play/floorBodies';
import { FinalBlowShot } from './play/finalBlow';
import { pickableArenas, randomMap } from './play/lobbyView';
import { playerVsPlayer } from './play/online';
import { GuestLobby, HostLobby, lobbyLineup, runTuning, type Lobby, type LobbyState, type NewLobbyOptions } from './lobby';
import {
  BATTLE_INPUT_DELAY,
  BATTLE_MAX_INPUT_DELAY,
  DUEL_MAX_INPUT_DELAY,
  BrokerUrlError,
  createRollbackSession,
  hostRoom,
  joinRoom,
  mainThreadLag,
  parseBrokerUrl,
  parseRoomInput,
  RoomError,
  roomLink,
  type BrokerOptions,
  type HostedRoom,
} from './net';

/** How long a message waits on this page's main thread, for the online sessions' pongs (the CPU part of the ping). */
const lag = () => mainThreadLag.estimate;

/** Scratch for the camera's direction each frame. */
const cameraDir = new Vector3();

/** Never simulate more than this many Ticks in one rendered frame (e.g. after a background tab). */
const MAX_TICKS_PER_FRAME = 8;
/** Dev mode only (`?dev=1&speed=N`): a solo Match's Tick rate multiplier (1 otherwise). */
const DEV_SPEED = devSpeed();
/** How long the final result stays on screen before the Lobby returns (seconds, cosmetic). */
const RESULT_SECONDS = 2.5;
/** How long a Battle's results screen stays up before the Lobby returns (seconds, cosmetic). */
const BATTLE_RESULT_SECONDS = 8;
/** How long a Run's results screen stays up, after its Final Blow Shot, before the Lobby returns (seconds, cosmetic). */
const RUN_RESULT_SECONDS = 6;
/** Online: how long after a Match ends a fresh one starts (part of the Match options, so both peers agree). */
const REMATCH_SECONDS = 5;
/** How long a Duel's shader warm-up may take before its loading bar goes up (ms): shorter is done before anyone would notice. */
const DUEL_BAR_DELAY_MS = 150;
/** How often the Lobby gets its heartbeats and timeouts (ms). */
const LOBBY_PUMP_MS = 100;
/** The menu's camera circles the scene this fast (radians per second). */
const ORBIT_SPEED = 0.06;
/** The Arena behind the menus, whatever the Lobby's Map: hand-made, so it costs nothing to build (a Random Map or a Run's Floor is generated only at the start). */
const MENU_ARENA = 'library';
/** The Character screen's close-up of your Fighter. */
const CLOSE_UP = { orbitDistance: 3.2, orbitHeight: 1.3, lookHeight: 2.1 };
/** ...turned this far (radians) to put your Fighter right of the Character card. */
const CLOSE_UP_TURN = 0.38;

const WEAPON_STORAGE_KEY = 'sword.weapon';
const ARENA_STORAGE_KEY = 'sword.arena';
const FORMAT_STORAGE_KEY = 'sword.format';
const BATTLE_KNOBS_STORAGE_KEY = 'sword.battleKnobs';
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
/** `{ size }` for a Member's wishes when the menu's Build is not the standard body. */
function sizeOf(menu: { readonly size: Size }): { size?: Size } {
  const size = storedSize(menu.size);
  return size ? { size } : {};
}

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

/** The Battle options picked last (army size, hit rate), or null for none. */
function storedBattleKnobs(): BattleKnobs | null {
  try {
    return parseBattleKnobs(JSON.parse(stored(BATTLE_KNOBS_STORAGE_KEY) ?? 'null'));
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
  const audio = createBrowserAudio(tuning.audio, tuning);
  renderer.onDaggerClatter = (point, arena) => audio.playCue({ sound: 'Clatter', point, surface: arenaSurface(arena), at: point });
  renderer.onSplatter = (point, strength) => audio.playCue({ sound: 'Splatter', point, strength, at: point });
  const local = new LocalController();
  const mouseInput = bindLocalInput(local, renderer.canvas);
  const touchInput = isTouchDevice() ? bindTouchInput(local, container) : null;
  /** Gamepad (Standard mapping: DualShock / Xbox): polled each frame into the same Local Controller. */
  const gamepadInput = bindGamepadInput(local, {
    onMenu: () => {
      if (driver && !menu.visible) openPause();
    },
  });
  /** Feeds the Local Controller only while a Match is on and the menu closed (mouse/keyboard, touch, gamepad). */
  const input = {
    set enabled(on: boolean) {
      mouseInput.enabled = on;
      if (touchInput) touchInput.enabled = on;
      gamepadInput.enabled = on;
    },
  };
  const hud = new Hud(container, tuning, () => openPause(), () => toggleMap());
  /** The inventory screen (`I`, or its touch button): render only, its clicks become the Local Controller's `equip` and `drop`. */
  const inventoryScreen = new InventoryScreen((ref, action) => local.inventoryClick(ref, action), () => toggleInventory());
  hud.root.append(inventoryScreen.root);
  /** An online Delver Run's name tags over the party's other Players (docs/plans/delver.md, Stage 8), in Team 0's army colour; hidden in any other Match. */
  const partyTags = new PlayerTags(container, tuning.battle.soldier.colours, []);
  partyTags.root.hidden = true;
  /** Floating damage over a hurt Fighter (the Damage Numbers setting). */
  const damageNumbers = new DamageNumbers(container);

  const weapons = Object.keys(tuning.weapons);
  const arenas = pickableArenas(tuning);
  const difficulties = Object.keys(tuning.ai.difficulties);
  const savedWeapon = stored(WEAPON_STORAGE_KEY);
  const savedArena = stored(ARENA_STORAGE_KEY);
  const savedFormat = stored(FORMAT_STORAGE_KEY);
  const savedBattleKnobs = storedBattleKnobs();

  let driver: MatchDriver | null = null;
  let names: readonly string[] | null = null;
  let bodies: readonly string[] | null = null;
  /** What is drawn while no Match has a state: before the first one, and while an online one connects. */
  const noMatch: MatchState = createMatch(tuning, { bestOf: 1 });
  let prev: MatchState = noMatch;
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
  /** The first-person view (P toggles it; no touch button): render-only, so each Player chooses their own, online too. */
  const firstPerson = new FirstPersonView();

  /** The Lobby the player is in (a Skirmish's, or a Room's), if any. */
  let lobby: Lobby | null = null;
  let unsubscribe: (() => void) | null = null;
  /** The Lobby has been shown since it was adopted (a guest's first state arrives a moment after connecting). */
  let lobbyShown = false;
  /** The Match generation being played (0: none). */
  let playing = 0;
  /** The Arena of the Match played last in this Lobby (online a Rematch moves it on), or null: a Random Map's next Match follows on from it. */
  let played: string | null = null;
  /** The Tuning Data the Match is played with, and the Arenas built ahead for it (a Rematch's, or a Run's next Floor's). */
  let matchTuning = tuning;
  let warmed = new Set<string>();
  /** The Skirmish setup, kept for the next Skirmish. */
  let skirmish: HostLobby | null = null;
  /** Dev mode only: the Set Piece Gallery's solo Lobby while it is in use (`onSetPieceGallery`); each Run it starts is the gallery's one Floor. */
  let galleryLobby: HostLobby | null = null;
  let room: HostedRoom | null = null;
  let invite: RoomInvite | null = null;
  let attempt: Attempt | null = null;
  /** When the in-game menu last opened because the mouse was freed (the Esc that freed it must not close it again). */
  let pausedAt = -Infinity;
  /** A Battle is being played (docs/plans/big-battle.md): its screen draws it (null while its code loads), not the Duel's loop. */
  let battleOn = false;
  let battle: BattleScreen | null = null;
  /** A Delver Run's Crowd drawn as impostors, made on the Run's first frame (null while its code loads, and outside a Delver Run). */
  let floorCrowd: FloorCrowd | null = null;
  let floorCrowdLoading = false;
  /** The loading bar over a Delver Run's first frames, while its Floor is built and its Soldiers' impostors bake; null once they are done. */
  let floorBar: LoadingBar | null = null;
  /** The Run's impostors are baked (or failed to): an offline Run waits for this before its first Tick. */
  let floorCrowdSettled = false;
  /** A Duel's shaders warming up (`warmDuel`), with the loading bar over it once it takes a while; null once done. */
  let duelWarm: { bar: LoadingBar | null; readonly shown: ReturnType<typeof setTimeout> } | null = null;

  const menu = new Menu(container, tuning, {
    onSkirmish() {
      if (skirmish) skirmish.setMine({ name: menu.name, body: menu.body, size: storedSize(menu.size) });
      else skirmish = new HostLobby(tuning, lobbyOptions(false));
      adopt(skirmish);
      menu.showLobby(skirmish);
    },
    onSetPieceGallery() {
      if (!devMode()) return;
      leave();
      // A solo Run (no AI ally, no traitor): its seed sizes and turns the Halls; every Run from this Lobby is the gallery's.
      const settings = { arena: randomMap(tuning, Math.floor(Math.random() * ARENA_SEED_RANGE)), bestOf: 3, format: 'Gauntlet' as const };
      const l = new HostLobby(tuning, { ...lobbyOptions(false), settings });
      l.edit((s) => ({ ...s, teams: s.teams.map((row, team) => (team === 0 ? row : row.map(() => ({ kind: 'Closed' as const })))) }));
      galleryLobby = l;
      adopt(l);
      const problem = l.start(false);
      if (problem) menu.showLobby(l, null, problem);
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
    onColliders(on) {
      renderer.setColliders(on);
    },
  });
  renderer.setColliders(menu.colliders);

  function lobbyOptions(online: boolean): NewLobbyOptions {
    const weapon = weapons.find((w) => w === savedWeapon) ?? weapons[0]!;
    const random = savedArena !== null && savedArena.startsWith('gen:') && isArenaName(tuning, savedArena);
    // The Format picked last: a Gauntlet on its Random Map, or a fresh one, or a Battle, in a Skirmish and in a Room.
    const gauntlet = savedFormat === 'Gauntlet' && Object.keys(tuning.kits).length > 0;
    const battleFormat = savedFormat === 'Battle';
    const arena = random || (savedArena !== null && !gauntlet && arenas.includes(savedArena)) ? savedArena! : gauntlet ? randomMap(tuning, Math.floor(Math.random() * ARENA_SEED_RANGE)) : tuning.arena.match;
    const difficulty = difficulties.includes('Skilled') ? 'Skilled' : difficulties[0]!;
    const settings = { arena, bestOf: 3, ...(gauntlet ? { format: 'Gauntlet' as const } : battleFormat ? { format: 'Battle' as const } : {}), ...(savedBattleKnobs ? { battle: savedBattleKnobs } : {}) };
    return { host: { name: menu.name, weapon, body: menu.body, ...sizeOf(menu) }, settings, online, ai: { difficulty, weapon: weapons[0]! } };
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
    galleryLobby = null;
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
    // (The Set Piece Gallery's Lobby is not a setup to come back to.)
    if (l === galleryLobby) return;
    const me = s.members.find((m) => m.id === l.me);
    if (me) store(WEAPON_STORAGE_KEY, me.weapon);
    if (l.isHost) {
      store(ARENA_STORAGE_KEY, s.settings.arena);
      store(FORMAT_STORAGE_KEY, s.settings.format ?? 'Duels');
      store(BATTLE_KNOBS_STORAGE_KEY, JSON.stringify(s.settings.battle ?? {}));
    }
  }

  /** Remember the Arena being played, and name it in the in-game menu. */
  function setPlayed(arena: string | null): void {
    if (arena === played) return;
    played = arena;
    menu.setArenaInPlay(arena);
  }

  /**
   * Build the next Arena ahead (`arenaToWarm`), with its navmesh for the Match's Tuning Data: an online Match's Rematch's while the result
   * shows, or a Run's next Floor's from its Floor's start, so the Tick that moves onto it (and any Rollback re-simulating it) only reads the cache.
   */
  function warmNextArena(match: MatchState): void {
    const name = arenaToWarm(match);
    if (name === null || warmed.has(name)) return;
    warmed.add(name);
    const t = matchTuning;
    // After this frame, so the result (or the new Floor) is on screen first.
    setTimeout(() => warmArena(arenaWorld, t, name), 0);
  }

  /** Start Match `s.generation`: against the AI locally, or through a Rollback session with the other players (the host links to every guest; a guest to the host). */
  function launch(l: Lobby, s: LobbyState): void {
    playing = s.generation;
    lobbyShown = true;
    const { lineup, weapons: picks, names: playerNames, bodies: playerBodies, members } = lobbyLineup(s);
    // A restart replaces the Battle being played, if any.
    battle?.dispose();
    battle = null;
    battleOn = false;
    dropFloorCrowd();
    dropDuelWarm();
    if (s.settings.format === 'Battle') return launchBattle(l, s, lineup, picks, playerNames, playerBodies, members);
    // The Lobby's Map for its first Match, then (a Random Map) the next seed each Match: the host's Lobby says which.
    const arena = s.matchArena ?? s.settings.arena;
    // The menu never builds the Map (its backdrop is MENU_ARENA): a Random Map, or a Run's first Floor, is generated here.
    // That takes a moment, so put a loading bar up and let it paint first, so the menu doesn't just hang there.
    if (s.settings.format === 'Gauntlet' || arena.startsWith('gen:')) {
      const run = s.settings.format === 'Gauntlet';
      const bar = new LoadingBar(container, run ? 'Entering the dungeon' : 'Entering the arena');
      bar.set(0, run ? 'Building the Floor…' : 'Building the map…');
      requestAnimationFrame(() =>
        setTimeout(() => {
          bar.dispose();
          // Left, or restarted, meanwhile.
          if (lobby === l && playing === s.generation) beginMatch(l, s, arena);
        }, 0),
      );
      return;
    }
    beginMatch(l, s, arena);
  }

  function beginMatch(l: Lobby, s: LobbyState, arena: string): void {
    const { lineup, weapons: picks, names: playerNames, bodies: playerBodies, members } = lobbyLineup(s);
    const match = { bestOf: s.settings.bestOf, arena, seed: randomSeed(), ...(s.settings.format === 'Gauntlet' ? { format: 'Gauntlet' as const } : {}) };
    // Every peer builds a Random Map from its name; the Tuning Data hash then covers the Arena too.
    matchTuning = runTuning(arenaWorld(arena).tuning, s.settings);
    warmed = new Set();
    setPlayed(arena);
    // A Run warms its shaders behind its own bar, once its Floor's impostors are baked (`drawFloorCrowd`).
    if (match.format !== 'Gauntlet') warmDuel(arena);
    if (members.length <= 1) {
      // A Skirmish, or a host playing the AIs alone while the Room waits for a player.
      // In dev mode a Run may start deeper in (`?dev=1&delverStart=F`), for tuning: only a Run stepped here, never an online one.
      // ...and the player's Fighter may be on the Delver pilot (`?dev=1&autopilot=1`), to check a Run in a headless browser.
      const run = match.format === 'Gauntlet';
      // ...or be the Set Piece Gallery (the main menu's dev button), one Floor from Floor 1.
      const gallery = run && l === galleryLobby;
      const d = playerVsAi(matchTuning, { lineup, weapon: picks[0]!, ...match, ...(gallery ? { delverGallery: true as const, ...devRunRelics() } : run ? { ...devDelverStart(), ...devRunRelics() } : {}), ...(run && devAutopilot() ? { autopilot: true } : {}), ...(run && devImmortal() ? { immortal: true } : {}) });
      return game.play({ driver: d, names: playerNames, bodies: playerBodies });
    }
    const me = members.indexOf(l.me!);
    const weapon = picks[me]!;
    // A Run's Floor with its Warbands costs a Battle's Tick, and so does every Tick a Rollback re-simulates (docs/plans/delver.md, Stage 3:
    // a Rollback's p99 was 11.6 ms with Warbands): it takes a Battle's Input Delay. Each peer's own (peers need not agree), from the Lobby's Format.
    const inputDelay = s.settings.format === 'Gauntlet' ? BATTLE_INPUT_DELAY : 0;
    // Either adapts to the link above that (ADR 0030): a bad one gets a few Ticks more, so the peers stop rolling back on every Intent.
    const maxInputDelay = s.settings.format === 'Gauntlet' ? BATTLE_MAX_INPUT_DELAY : DUEL_MAX_INPUT_DELAY;
    let session;
    if (l.isHost) {
      // A guest who left between the start and now gets an AI in their place from the first Tick.
      const guests = members.slice(1).map((id) => l.matchTransport(s.generation, id));
      // Duels restart on their own; a Run has no Rematch (the host starts the next one from the in-game menu).
      const rematch = match.format === 'Gauntlet' ? {} : { rematchTicks: secondsToTicks(REMATCH_SECONDS) };
      session = createRollbackSession({ role: 'host', guests, tuning: matchTuning, weapon, match: { ...match, ...rematch }, lineup, inputDelay, maxInputDelay, lag });
    } else {
      const transport = l.matchTransport(s.generation, 0);
      if (!transport) return;
      session = createRollbackSession({ role: 'guest', transport, tuning: matchTuning, weapon, inputDelay, maxInputDelay, lag });
    }
    // Dev mode only: this peer's Fighter on the Delver pilot too (`?dev=1&autopilot=1`), for the two-browser check of a Run.
    const autopilot = match.format === 'Gauntlet' && devAutopilot();
    // (A traitor's, its slot on Team 1, is the traitor pilot: docs/plans/delver.md, Stage 8a.)
    const delverPilot = () => {
      const party = createDelverPilot(matchTuning, 'Hard', { walk: inputDelay > 0 });
      const traitor = createTraitorPilot(matchTuning, 'Hard', { walk: inputDelay > 0 });
      return { intent: (state: SimState, fighter: number) => (state.fighters[fighter]?.team === 1 ? traitor : party).intent(state, fighter) };
    };
    const pilot = autopilot ? delverPilot() : undefined;
    game.play({ driver: playerVsPlayer(session, playerNames, pilot), names: playerNames, bodies: playerBodies });
  }

  /**
   * Compile the shaders a Duel on `arena` may come to draw (`Renderer.warmUp`) before it starts, else its first Hit's blood
   * hitches as they compile. A Duel played here waits for them (`heldForLoading`). The loading bar goes up only if it takes a
   * while: after the first Match they are all compiled already, and the bar would only flash.
   */
  function warmDuel(arena: string): void {
    dropDuelWarm();
    const warm = {
      bar: null as LoadingBar | null,
      shown: setTimeout(() => {
        warm.bar = new LoadingBar(container, 'Entering the arena');
        warm.bar.set(0.5, WARM_UP_DETAIL);
      }, DUEL_BAR_DELAY_MS),
    };
    duelWarm = warm;
    void renderer.warmUp(arena).then(() => {
      if (duelWarm !== warm) return;
      clearTimeout(warm.shown);
      warm.bar?.finish();
      duelWarm = null;
    });
  }

  /** Stop waiting for a Duel's warm-up (a new Match, or none): its bar comes down at once. */
  function dropDuelWarm(): void {
    if (!duelWarm) return;
    clearTimeout(duelWarm.shown);
    duelWarm.bar?.dispose();
    duelWarm = null;
  }

  /**
   * Whether the Match waits behind its loading bar before its next Tick: a Battle until its impostors are baked and its shaders
   * warmed; a Run or a Duel played here until theirs are (online the Match is already ticking on every peer, so it runs on).
   * An online Battle with no state yet is never held: its peers connect in `tick`, and the Battle's warm-up waits for a
   * first state to draw (else the bar would wait on the connection and the connection on the bar, for good).
   */
  function heldForLoading(): boolean {
    if (battleOn) return !battle?.ready && driver?.state != null;
    if (lobby?.online || !driver) return false;
    return (curr.delver !== undefined && !floorCrowdSettled) || duelWarm !== null;
  }

  /**
   * Start a Battle (docs/plans/big-battle.md): each Player's Fighter in their Team's army on a fresh Battlefield, with their
   * Weapon and Body. A host with nobody else plays it here; with other Players it runs in a Rollback session (every peer
   * steps the same Battle, as for a Duel or a Run), the host choosing the Battlefield's seed. Its screen (loaded on demand)
   * bakes the soldiers' impostors before the first Tick; it draws from the local Fighter the session names.
   */
  function launchBattle(l: Lobby, s: LobbyState, lineup: Lineup, picks: readonly string[], playerNames: readonly string[], playerBodies: readonly string[], members: readonly number[]): void {
    // Building the Battle takes a moment: put the loading bar up and let it paint first, so the menu doesn't just hang there.
    const bar = new LoadingBar(container, 'Mustering the armies');
    bar.set(0, 'Preparing the battlefield…');
    requestAnimationFrame(() => setTimeout(() => beginBattle(l, s, lineup, picks, playerNames, playerBodies, members, bar), 0));
  }

  function beginBattle(l: Lobby, s: LobbyState, lineup: Lineup, picks: readonly string[], playerNames: readonly string[], playerBodies: readonly string[], members: readonly number[], bar: LoadingBar): void {
    // The Lobby's army size and hit rate folded in; every peer builds the same from the host's Lobby.
    const battleTuning = runTuning(tuning, s.settings);
    matchTuning = battleTuning;
    warmed = new Set();
    setPlayed(null);
    const pilot = devBattlePilot();
    // The Lobby's map: a hand-built one by name, else the open field of the host's seed.
    const seed = Math.floor(Math.random() * ARENA_SEED_RANGE);
    const arena = battleNameFor(s.settings.battle?.map !== undefined && Object.hasOwn(tuning.battle.maps, s.settings.battle.map) ? s.settings.battle.map : undefined, seed);
    let d: MatchDriver;
    if (members.length <= 1) {
      d = playerInBattle(battleTuning, { weapon: picks[0]!, seed, arena, team: lineup[0]!.team === 1 ? 1 : 0, ...(lineup[0]!.size ? { size: lineup[0]!.size } : {}), ...(pilot ? { pilot: createBattlePilot(battleTuning, pilot) } : {}) });
    } else {
      const me = members.indexOf(l.me!);
      let session;
      if (l.isHost) {
        const guests = members.slice(1).map((id) => l.matchTransport(s.generation, id));
        // A Battle's Tick costs many times a Duel's, and so does every Tick a Rollback re-simulates: the Input Delay lets the other Players'
        // Intents arrive before the Tick they are for (ADR 0025), and it adapts to the link above that (ADR 0030).
        session = createRollbackSession({ role: 'host', guests, tuning: battleTuning, weapon: picks[me]!, match: { bestOf: 1, format: 'Battle', seed, arena }, lineup, inputDelay: BATTLE_INPUT_DELAY, maxInputDelay: BATTLE_MAX_INPUT_DELAY, lag });
      } else {
        const transport = l.matchTransport(s.generation, 0);
        if (!transport) {
          bar.dispose();
          return;
        }
        session = createRollbackSession({ role: 'guest', transport, tuning: battleTuning, weapon: picks[me]!, inputDelay: BATTLE_INPUT_DELAY, maxInputDelay: BATTLE_MAX_INPUT_DELAY, lag });
      }
      // Dev mode only: this peer's Fighter on a Battle autopilot (`?dev=1&battlePilot=Hard`), for the browser check.
      const battlePilot = pilot ? createBattlePilot(battleTuning, pilot) : null;
      d = playerVsPlayer(session, playerNames, battlePilot ?? undefined);
    }
    game.play({ driver: d, names: playerNames, bodies: playerBodies });
    battleOn = true;
    hud.hide();
    // By Fighter slot: a Battle's Lineup names only its Players, in the Pool's first slots.
    const chosen = playersBySlot(lineup, playerBodies);
    const tagged = playersBySlot(lineup, playerNames);
    void import('./play/battleScreen').then(({ BattleScreen }) => {
      if (driver !== d) {
        bar.dispose();
        return;
      }
      battle = new BattleScreen(container, renderer, battleTuning, local, chosen, tagged, bar, (cue) => audio.playCue(cue), firstPerson);
    });
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
        adopt(new GuestLobby(transport, tuning, { name: menu.name, weapon, body: menu.body, ...sizeOf(menu) }));
        menu.showConnecting('Joining Room', 'Connected. Waiting for the host’s Lobby…', code);
      },
      (e) => failed(pending, e),
    );
  }

  // --- Matches ---

  /** The Lineup the party's tags were last named from (a guest's arrives with the host's hello). */
  let taggedLineup: Lineup | null | undefined;
  /** The party Fighter a watching Delver Player's camera follows (`spectateTarget`), or -1. */
  let followed = -1;
  /** Name the party's tags by Fighter slot from the driver's Lineup. (A traitor tags the party's AI allies too, as `AI`.) */
  function tagNames(d: MatchDriver): void {
    taggedLineup = d.lineup;
    partyTags.setNames(playersBySlot(d.lineup ?? [], names ?? []).map((n, k) => n ?? (d.lineup?.[k]?.team === 0 ? 'AI' : undefined)));
  }

  const game: Game = {
    play({ driver: d, names: n, bodies: b }) {
      if (driver !== d) driver?.close?.();
      driver = d;
      names = n ?? null;
      bodies = b ?? null;
      tagNames(d);
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
      renderer.impacts.seek(start?.tick ?? 0, true);
      shake.seek(start?.tick ?? 0);
      damageNumbers.seek(start?.tick ?? 0);
      if (start) {
        prev = curr = start;
        present(start, d.localFighter);
      } else {
        // Never draw the last Match while this one connects: a Delver Run's Floor Crowd view would be built from it, keeping its
        // party size for the whole new Run, and a Fighter past that size would be drawn as an empty Bubble slot (unseen, issue #161).
        prev = curr = noMatch;
      }
      accumulator = 0;
      // A restart the host made while this player had the in-game menu open keeps it open.
      if (menu.paused) return;
      menu.hide();
      input.enabled = true;
    },
  };

  function stopMatch(): void {
    battle?.dispose();
    battle = null;
    battleOn = false;
    dropFloorCrowd();
    dropDuelWarm();
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
    partyTags.root.hidden = true;
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
    } else if (curr.delver) {
      // (A Run's map shows only what the party has revealed.)
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
   * Open or close the inventory screen. Open, it frees the mouse but never takes the Controller's input: the Fighter keeps its keys (a
   * Warband may be near), the number keys and X among them. The Simulation runs on; closed, the pointer lock comes back.
   */
  function toggleInventory(): void {
    if (!driver || menu.visible) return;
    const opening = !inventoryScreen.open;
    if (opening) hud.setMapOpen(false);
    inventoryScreen.open = opening;
    input.enabled = true;
    if (opening) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else lockPointer();
  }

  /** Free a Delver Run's Crowd view (the Run is over, or restarted, or the player left). */
  function dropFloorCrowd(): void {
    floorCrowd?.dispose();
    floorCrowd = null;
    floorCrowdLoading = false;
    floorCrowdSettled = false;
    floorBar?.dispose();
    floorBar = null;
  }

  /**
   * Draw a Delver Run's Crowd for the frame about to be rendered (`alpha` of the way to the next Tick, of `duel`: the final-blow shot draws its own state). Its code loads on the Run's
   * first frame, behind a loading bar that stays up while the Floor is built (the first frame drawn) and the impostors bake. Returns false on that first
   * frame: draw nothing yet, so the bar paints before the heavy work starts.
   */
  function drawFloorCrowd(match: MatchState, duel: SimState, alpha: number, seconds: number): boolean {
    if (!match.delver) return true;
    if (!floorCrowd) {
      if (floorCrowdLoading) return true;
      floorCrowdLoading = true;
      const generation = playing;
      const bar = new LoadingBar(container, 'Entering the dungeon');
      bar.set(0.05, 'Building the Floor…');
      floorBar = bar;
      void import('./play/floorCrowd').then(({ FloorCrowd }) => {
        if (generation !== playing || !floorCrowdLoading) return;
        const progress = (done: number, total: number) => bar.set(0.15 + 0.75 * (total === 0 ? 1 : done / total), done < total ? `Drawing the enemies ${done + 1} of ${total}…` : WARM_UP_DETAIL);
        const crowd = new FloorCrowd(renderer, matchTuning, match.config.teams.length, duel.arena, undefined, progress);
        floorCrowd = crowd;
        // With the impostors in the scene, compile every shader the Run may come to draw while the bar is still up: else the
        // impostors as it lifts, the first Soldier promoted and the first Hit's blood each hitch as their shaders compile.
        void crowd.settled.then(() => (floorCrowd === crowd ? renderer.warmUp() : undefined)).then(() => {
          if (floorCrowd !== crowd) return;
          floorCrowdSettled = true;
          if (floorBar === bar) floorBar = null;
          bar.finish();
        });
      });
      return false;
    }
    floorCrowd.update(duel, alpha, seconds, renderer.camera);
    return true;
  }

  /** A Delver Floor's pedestal items stand on its crate props (`pedestal<n>`, in `plan.markers.pedestals` order): the top of each one's stack. False outside a Delver Run. */
  function crateTops(match: MatchState): false | ((p: Pickup) => number) {
    const plan = match.delver && floorOf(matchTuning, match.arena)?.plan;
    if (!plan) return false;
    return (p) => crateTop(crateStacked(`pedestal${plan.markers.pedestals.findIndex((m) => m.x === p.at.x && m.z === p.at.z)}`));
  }

  /** What the Renderer draws a Delver Run's Floor marks from, or null outside a Delver Run. */
  function delverMarksOf(match: MatchState, me: number): DelverMarksView | null {
    const run = match.delver;
    const plan = run && floorOf(matchTuning, match.arena)?.plan;
    return run && plan ? { plan, restUsed: run.restUsed, me, fireRadius: matchTuning.delver.fireRadius, gate: gateState(plan, match.duel.crowd, run.wiped) } : null;
  }

  /** A Delver Run's context for the inventory screen: its phase, whether the Floor is mapped and whether an ally has fallen. Undefined outside a Delver Run. */
  function delverContext(match: MatchState): DelverContext | undefined {
    return driver ? delverContextOf(match, matchTuning) : undefined;
  }

  addEventListener('keydown', (e) => {
    if (e.code === INVENTORY_LIST_KEY && !e.repeat) toggleInventory();
    // Only in play, so typing a P into the menu (a name, a Room code) does not flip it.
    if (e.code === FIRST_PERSON_KEY && !e.repeat && driver && !menu.visible) firstPerson.toggle();
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

  /** The Final Blow Shot ended (or was cut): back to the live Match's sounds and sparks. */
  function endShot(): void {
    if (!inShot) return;
    inShot = false;
    hud.cinematic(false);
    audio.setSpeed(1);
    audio.seek(curr.tick);
    renderer.impacts.seek(curr.tick);
    shake.seek(curr.tick);
    damageNumbers.seek(curr.tick);
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
    const delver = match.delver;
    // The Bosses beaten are the Run's own count, from the RunEnd event the Match's events carry; `bossesBeaten` only when none was seen.
    const runEnd = match.events.find((e) => e.type === 'RunEnd');
    for (const e of announcer.update(match, me)) {
      if (e.type === 'DuelEnd') {
        // A Run's Duel ends only with the Run (a wipe, or the last Stairs): the results screen says so.
        if (delver) continue;
        hud.announce(e.winner === null ? 'Draw' : e.winner === myTeam ? 'Duel won' : 'Duel lost');
      } else if (e.type === 'Rested') {
        hud.announce('Rested', 1.5);
      } else if (e.type === 'Revived') {
        hud.announce('Revived', 1.5);
      } else if (e.type === 'BossBeaten') {
        hud.announce('Boss beaten — the Stairs are open', 2.5);
      } else if (e.type === 'LootDropped') {
        hud.announce('Loot dropped', 1.5);
      } else if (e.type === 'DuelStart') {
        const seed = parseGeneratedName(match.arena)?.seed;
        if (delver) {
          hud.announce(`Floor ${delver.floor} / ${delver.floors} · Run seed ${runSeed(match.config.arena)}`, 2.5);
          aimAtDuelStart(match);
          continue;
        }
        const title = e.duelNumber === 1 && match.matchNumber > 1 ? `Match ${match.matchNumber}` : `Duel ${e.duelNumber}`;
        // A Random Map's seed with each Match's first Duel, so a good one can be played again.
        hud.announce(e.duelNumber === 1 && seed !== undefined ? `${title} · seed ${seed}` : title, e.duelNumber === 1 && seed !== undefined ? 2.5 : 1.5);
        aimAtDuelStart(match);
      } else if (e.type === 'Fell') {
        hud.announce('You fell', 1.5);
      } else if (e.type === 'MatchEnd' && delver && match.status.status === 'Over') {
        // A Run's results screen follows the Final Blow Shot, if any (a Defeat has one), then the Lobby.
        const victory = e.winner === myTeam;
        const bossTotal = matchTuning.delver.warbands.filter((t) => t.boss).length;
        runResult = {
          victory,
          floors: delver.floors,
          reached: delver.floor,
          warbands: runEnd?.type === 'RunEnd' ? runEnd.warbands : delver.beaten + delver.wiped.length,
          ...(bossTotal > 0 && match.duel.crowd ? { bosses: runEnd?.type === 'RunEnd' ? runEnd.bosses : bossesBeaten(matchTuning.delver, delver, match.duel.crowd), bossTotal } : {}),
          seconds: (match.status.tick - delver.startTick) * TICK_SECONDS,
          seed: runSeed(match.config.arena),
          builds: runBuilds(match, (f) => playerName(driver?.lineup ?? null, names, f)),
          // Each Player's stats (the party's human slots, in order).
          players: [...runPlayers(match.config)]
            .sort((a, b) => a - b)
            .flatMap((i) => (delver.stats[i] ? [{ name: playerName(driver?.lineup ?? null, names, i), ...delver.stats[i]! }] : [])),
          // Each traitor's kills and deaths (docs/plans/delver.md, Stage 8a): traitor j plays slot `teams.length + j`.
          ...(delver.traitors ? { traitors: delver.traitors.map((t, j) => ({ name: playerName(driver?.lineup ?? null, names, match.config.teams.length + j), kills: t.kills, deaths: t.deaths })) } : {}),
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

  /** A Battle's new Tick: its banners, and once it is over its results screen, then the Lobby. */
  function presentBattle(match: MatchState, me: number): void {
    const r = battle?.present(match, me);
    if (!r || !battle) return;
    // Online the host decides when the Lobby returns (its Lobby message takes every guest back; a guest closing its session first
    // would look to the host like a Player leaving): the results wait on a guest.
    const waits = lobby?.online === true && !lobby.isHost;
    resultText = battle.showResults(r, waits ? 'Back to the Lobby when the host returns.' : `Back to the Lobby in ${BATTLE_RESULT_SECONDS} seconds.`);
    resultAt = waits ? null : performance.now() + BATTLE_RESULT_SECONDS * 1000;
  }

  // Dev mode only: play `ticks` of a Battle at once (for a browser that is not drawing at speed), with the Player's Intents
  // as the loop would sample them (or the `battlePilot`'s). Reports where the Battle stands.
  if (devMode())
    (window as unknown as { battleAdvance: (ticks: number) => unknown }).battleAdvance = (ticks) => {
      const d = driver;
      if (!d || !battleOn || !battle?.ready) return 'no Battle running';
      for (let k = 0; k < ticks && resultAt === null; k++) {
        d.tick(local.sample(d.state?.duel.fighters[d.localFighter]));
        prev = curr;
        curr = d.state!;
        renderer.impacts.onTick(curr.tick, curr.duel);
        presentBattle(curr, d.localFighter);
      }
      const me = curr.duel.fighters[d.localFighter]!;
      const crowd = curr.duel.crowd!;
      const alive = [0, 1].map((t) => crowd.alive.filter((a, s) => a && crowd.team[s] === t).length);
      return { tick: curr.tick, status: curr.status, record: crowd.players[d.localFighter], hp: me.hp, fallen: Boolean(me.death), at: me.position, alive, rout: crowd.rout, result: resultText };
    };

  // Dev mode only: where an online Battle stands on this peer and what its session has done (Rollbacks, stalls, resyncs), for the browser check.
  if (devMode())
    (window as unknown as { battleOnline: () => unknown }).battleOnline = () => {
      const d = driver as { stats?: unknown; localFighter: number } | null;
      const crowd = curr.duel.crowd;
      if (!d || !battleOn || !crowd) return null;
      const f = curr.duel.fighters[d.localFighter];
      return {
        tick: curr.tick,
        me: d.localFighter,
        status: curr.status,
        record: crowd.players[d.localFighter],
        hp: f?.hp,
        players: crowd.players,
        bound: curr.duel.fighters.filter((x) => x.soldier).length,
        hash: hashValue(curr.duel),
        stats: d.stats,
        result: resultText,
      };
    };

  // --- The scene behind the menus ---

  let previewKey = '';
  let preview: MatchState = curr;
  /**
   * Behind the menus: the Lobby's Fighters standing ready in the Library (MENU_ARENA), or a plain Duel there. Never the Lobby's own Map: a Random
   * Map or a Run's first Floor takes a good part of a second to generate, which would hitch the menu each time the Map or the Format changed.
   */
  function previewMatch(): { match: MatchState; me: number; bodies: (string | undefined)[] } {
    const s = lobby?.state;
    const arena = MENU_ARENA;
    let options: MatchOptions = { bestOf: 1, arena, weapons: [stored(WEAPON_STORAGE_KEY) ?? weapons[0]!, weapons[0]!], sizes: [menu.size] };
    let me = 0;
    let seated: { lineup: Lineup; bodies: readonly string[] } | null = null;
    if (s) {
      const { lineup, weapons: picks, bodies: playerBodies, members } = lobbyLineup(s);
      seated = { lineup, bodies: playerBodies };
      const player = members.indexOf(lobby!.me ?? -1);
      // Always as Duels (a Run's Lineup too): a Gauntlet would generate its first Floor.
      if (lineup.some((x) => x.team === 0) && lineup.some((x) => x.team === 1)) options = lineupMatch(tuning, lineup, picks, { bestOf: 1, arena });
      me = player >= 0 ? playerFighter(lineup, player as PlayerNumber) : -1;
    }
    const key = JSON.stringify(options);
    if (key !== previewKey) {
      try {
        preview = createMatch(s ? runTuning(tuning, s.settings) : tuning, options);
        previewKey = key;
      } catch {
        // Not a fieldable Lineup (yet): keep the last scene.
      }
    }
    return { match: preview, me, bodies: seated ? fighterBodies(tuning, seated.lineup, seated.bodies, preview) : [] };
  }

  // --- The loop ---

  setInterval(() => lobby?.pump(performance.now()), LOBBY_PUMP_MS);

  /**
   * Each animation frame. The next one is asked for first, so nothing a frame throws can stop the loop for good: a page
   * whose loop died would still show the Lobby (its own timer pumps it) while every Match it starts never ticks, which
   * the other players see as this one leaving. A Match that throws ends here with the reason instead.
   */
  let lastFailure = '';
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const start = performance.now();
    try {
      runFrame(now);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (why !== lastFailure) console.error(e);
      lastFailure = why;
      if (driver) matchFailed(`The Match stopped on an error: ${why}`);
    }
    // How long this frame held the main thread: the CPU part of the ping (see MainThreadLag).
    mainThreadLag.work(start, performance.now());
  }

  function runFrame(now: number): void {
    gamepadInput.poll();
    const elapsed = Math.min((now - last) / 1000, MAX_TICKS_PER_FRAME * TICK_SECONDS);
    // Dev `speed=N`: the fade between a Delver Run's Floors plays at 1×, so its banner can be seen.
    const speed = DEV_SPEED > 1 && !lobby?.online && curr.delver?.phase !== 'Descending' ? DEV_SPEED : 1;
    accumulator += elapsed * speed;
    last = now;
    // A Skirmish pauses with its menu open; an online Match runs on (the other players are still fighting).
    const frozen = menu.paused && !lobby?.online;
    // A Match's first state (Tick 0, with its first DuelStart) is never stepped into: hear it once it exists.
    if (driver?.state && !inShot) audio.onMatchTick(driver.state);
    if (heldForLoading()) accumulator = 0;
    while (driver && !frozen && accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      const d = driver;
      const { advanced } = d.tick(local.sample(d.state?.duel.fighters[d.localFighter]));
      if (d.failure) {
        matchFailed(d.failure);
        break;
      }
      if (!advanced || !d.state) continue;
      // Possibly predicted, or corrected by a Rollback: the Renderer just interpolates from the last state shown.
      prev = curr;
      curr = d.state;
      if (!battleOn && finalBlow.record(curr, local.yaw) && !inShot) {
        // The last Fighter of a Team fell: cut to the Final Blow Shot, which replays from a moment before.
        inShot = true;
        hud.cinematic(true);
        audio.seek(finalBlow.startTick!);
        audio.setSpeed(tuning.camera.finalBlowSpeed);
        renderer.impacts.seek(finalBlow.startTick!);
        shake.seek(curr.tick);
        damageNumbers.seek(curr.tick);
      }
      if (!inShot) {
        audio.onMatchTick(curr);
        renderer.impacts.onTick(curr.tick, curr.duel);
        shake.onTick(curr.tick, curr.duel.events, d.localFighter);
        damageNumbers.onTick(curr.tick, curr.duel, d.localFighter);
      }
      if (battleOn) {
        presentBattle(curr, d.localFighter);
        continue;
      }
      present(curr, d.localFighter);
      // A Run's Floors are `battle:delver<F>s<S>` names, not Maps a Lobby can move on from: the Run's own Map (its first Arena) is
      // what a restart follows on from (the next seed), else Retry would start a Match on a Floor's name, which Tuning Data does not hold.
      setPlayed(curr.delver ? curr.config.arena : curr.arena);
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
      // Online the Lobby message first, so a guest follows it rather than finding the host's session closed under it.
      if (battleOn && l?.online) l.backToLobby();
      stopMatch();
      if (l) {
        l.backToLobby();
        menu.showLobby(l, invite, resultText);
      } else menu.showTitle(resultText);
    }

    // The fight is heard from the Player's Fighter (the camera's, once it has fallen), facing the way the camera does.
    audio.setEars(driver ? earsOf(curr.duel, driver.localFighter, renderer.camera) : null);
    if (driver && battleOn) {
      battle?.draw(prev, curr, driver.localFighter, Math.min(1, accumulator / TICK_SECONDS), frozen ? 0 : elapsed, driver.ping ?? null);
    } else if (driver) {
      const alpha = accumulator / TICK_SECONDS;
      // A fresh Duel resets the Fighters: don't interpolate across the swap.
      const before: SimState = prev.duelNumber === curr.duelNumber ? prev.duel : curr.duel;
      const me = driver.localFighter;
      const yaw = local.yaw;
      const shot = inShot ? finalBlow.frame(frozen ? 0 : elapsed) : null;
      if (inShot && !shot) endShot();
      // A Delver traitor (docs/plans/delver.md, Stage 8a) wears the Soldier it took over, as everyone else sees it, not its own Body.
      const traitor = traitorOf(curr.config, me) >= 0;
      renderer.setPlayer(traitor ? -1 : me, menu.body);
      // The camera as last placed: a frame behind is fine for choosing what to label.
      const mine = curr.duel.fighters[me];
      const pickups: PickupView[] = mine
        ? pickupViews(curr.delver?.pickups ?? [], me, {
            at: renderer.camera.position,
            dir: renderer.camera.getWorldDirection(cameraDir),
            near: { x: mine.position.x, y: mine.y, z: mine.position.z },
          }, crateTops(curr))
        : [];
      renderer.setPickups(pickups);
      renderer.setDelver(delverMarksOf(curr, me));
      renderer.setChosenBodies(fighterBodies(matchTuning, driver.lineup, bodies, curr));
      if (shot) {
        for (const m of shot.reached) {
          audio.onMatchTick(m);
          renderer.impacts.onTick(m.tick, m.duel);
        }
        const { camera } = tuning;
        firstPerson.reset();
        firstPerson.apply(renderer.camera, null, shot.centre, 0, 0);
        renderer.setFirstPerson(-1);
        placeShotCamera(renderer.camera, shot.centre, shot.yaw, camera.finalBlowDistance, camera.finalBlowHeight, renderer.collider);
        if (drawFloorCrowd(curr, shot.to, shot.alpha, 0)) renderer.render(shot.from, shot.to, shot.alpha, camera.finalBlowSpeed);
      } else {
        const fallen = curr.duel.fighters[me]?.death !== undefined;
        // A traitor watching (no Soldier taken over yet).
        const waiting = traitor && !inDuel(curr.duel.fighters[me]!);
        const spectating = (fallen || waiting) && curr.duel.duel.status === 'Fighting';
        // In a Run, a watcher follows one living party Fighter, the next once it falls, orbiting it (turned with the mouse).
        followed = spectating && curr.delver ? spectateTarget(curr.config, curr.duel, me, followed) : -1;
        if (followed >= 0) placeOrbitCamera(renderer.camera, tuning.camera, lerpPosition(before, curr.duel, followed, alpha), yaw, renderer.collider);
        // Fallen while the team fights on: orbit the fight instead of staring at the floor.
        else if (spectating && fallen) placeOrbitCamera(renderer.camera, tuning.camera, fightCentre(before, curr.duel, alpha), yaw, renderer.collider);
        else if (spectating) placeOrbitCamera(renderer.camera, tuning.camera, fightCentre(before, curr.duel, alpha, 0), yaw, renderer.collider);
        else placeThirdPersonCamera(renderer.camera, cameraForHeight(tuning.camera, curr.duel.fighters[me]?.size?.height ?? 1), lerpPosition(before, curr.duel, me, alpha), yaw, local.pitch, renderer.collider);
        const feet = lerpPosition(before, curr.duel, me, alpha);
        // First person steps back out while the Fighter Whirlwinds, is knocked down, falls or is not its own (a traitor's Soldier, a watcher).
        const own = !spectating && followed < 0;
        firstPerson.update(frozen ? 0 : elapsed, !own || firstPersonBlocked(curr.duel.fighters[me]));
        firstPerson.apply(renderer.camera, own ? renderer.headOf(before, curr.duel, me, alpha) : null, feet, yaw, local.pitch, curr.duel.fighters[me]?.size?.height ?? 1);
        renderer.setFirstPerson(own && firstPerson.hidesBody ? me : -1);
        shake.update(frozen ? 0 : elapsed);
        shake.apply(renderer.camera, tuning.camera.shake);
        if (drawFloorCrowd(curr, curr.duel, alpha, frozen ? 0 : elapsed)) renderer.render(before, curr.duel, alpha);
      }
      if (touchInput) touchInput.sheathed = curr.duel.fighters[me]?.sheathed ?? false;
      // Online, the party's other Players carry name tags on a Floor (offline there is nobody else to name).
      const tagged = driver.ping !== undefined && curr.delver !== undefined;
      partyTags.root.hidden = !tagged || shot !== null;
      // A guest's session learns the Lineup from the host's hello, after the Match began: name the tags once it does.
      if (tagged && driver.lineup !== taggedLineup) tagNames(driver);
      if (tagged && !shot) partyTags.update(curr.duel, before, me, alpha, (p) => renderer.toScreen(p), partyMarkers(curr.config, curr.duel, me));
      // A watching traitor is told when it takes over its next Soldier (docs/plans/delver.md, Stage 8a).
      const watching = traitor && !shot ? traitorWatchLine(curr, me) : null;
      if (watching) hud.announce(watching, 0.3);
      hud.update(curr, { localFighter: me, lineup: driver.lineup, ping: driver.ping ?? null, names, tuning: matchTuning, project: (p) => renderer.toScreen(p), pickups });
      damageNumbers.root.hidden = shot !== null;
      damageNumbers.update(frozen ? 0 : elapsed, (p) => renderer.toScreen(p));
      inventoryScreen.update(curr.duel.fighters[me], matchTuning, delverContext(curr));
    } else {
      damageNumbers.clear();
      partyTags.root.hidden = true;
      renderer.setPickups([]);
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
      renderer.setFirstPerson(-1);
      firstPerson.reset();
      firstPerson.apply(renderer.camera, null, { x: 0, z: 0 }, 0, 0);
      renderer.setChosenBodies(chosen);
      renderer.render(duel, duel, 1);
    }
  }

  addEventListener('pagehide', () => leave());

  menu.showTitle();
  loadBodiesWithBar(container);
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

/** Load every Body model behind a loading bar over the menu, so the first seconds don't look like a freeze. */
function loadBodiesWithBar(container: HTMLElement): void {
  const bar = new LoadingBar(container, 'Loading');
  let done = 0;
  const total = BODY_MODELS.length;
  bar.set(0, 'Fighters…');
  void Promise.allSettled(
    BODY_MODELS.map((b) =>
      preloadBody(b).finally(() => {
        done++;
        bar.set(done / total, `Fighters ${done} of ${total}`);
      }),
    ),
  ).then(() => bar.finish());
}

/**
 * Each Fighter's chosen Body: its Player's (index = Player number), none for an AI (drawn as a random one), except an AI fighting as a Delver
 * Troop in a Duel, which wears its Troop's (`MatchConfig.troops`, docs/plans/enemy-behaviours.md, Stage 0). In a Run, each Pool slot bound
 * to a Soldier wears its Troop's Body (`floorBodies`).
 */
function fighterBodies(tuning: TuningData, lineup: Lineup | null, bodies: readonly string[] | null, match: MatchState): (string | undefined)[] {
  if (match.delver) {
    const party = match.config.teams.length;
    const chosen = (lineup ?? []).map((slot) => (slot.pilot.kind === 'Player' ? bodies?.[slot.pilot.player] : undefined));
    return floorBodies(match.duel, party, chosen, floorBodyOf(tuning, match.arena, match.duel.crowd));
  }
  const troops = match.config.troops;
  return (lineup ?? []).map((slot, i) => troops?.[i]?.body ?? (slot.pilot.kind === 'Player' ? bodies?.[slot.pilot.player] : undefined));
}

/** Where the Fighters still in the Duel are, on average (the Arena centre if none): neither fallen nor Benched. */
const earRight = new Vector3();

/** Where the Player hears from: its Fighter's chest while it stands (the camera, once it has fallen), with the camera's right as its right. */
function earsOf(duel: SimState, me: number, camera: Camera): Ears {
  const f = duel.fighters[me];
  const position = f && !f.death ? { x: f.position.x, y: f.y + CHEST, z: f.position.z } : { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  earRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const across = Math.hypot(earRight.x, earRight.z) || 1;
  return { position, right: { x: earRight.x / across, z: earRight.z / across } };
}

/** Where the Fighters still in the Duel (of Team `team` only, when given) are, on average. */
function fightCentre(a: SimState, b: SimState, alpha: number, team?: number): CameraTarget {
  const living = b.fighters.flatMap((f, i) => (inDuel(f) && (team === undefined || (f.team === team && !f.death)) ? [lerpPosition(a, b, i, alpha)] : []));
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
