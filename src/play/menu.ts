import type { TuningData } from '../tuning';
import { BODY_LABELS, BODY_MODELS, type BodyModelName } from '../render/bodyModel';
import { cleanName, MAX_NAME, member, startProblem, type Lobby } from '../lobby';
import { devMode } from '../devMode';
import { button, h, thumb, thumbImage } from './dom';
import { arenaLabel, lobbyBody } from './lobbyView';
import { ensurePlayStyles } from './styles';
import { isTouchDevice } from './touch';

/** What the player can ask for from the menus; the game decides what happens. */
export interface MenuHandlers {
  /** Set up a Skirmish (you and AIs): the game opens its Lobby. */
  onSkirmish(): void;
  onCreateRoom(broker: string): void;
  /** `room`: a Room code or link, as typed or pasted. */
  onJoinRoom(room: string, broker: string): void;
  /** The Lobby's main button: start the Match (host), or restart it with the current settings (in game). */
  onStart(): void;
  /** Leave the Lobby (close the Room, leave it, or drop the Skirmish setup) for the title screen. */
  onLeaveLobby(): void;
  /** Close the in-game menu. */
  onResume(): void;
  /** Host, online, in game: end the Match for everyone and gather in the Lobby. */
  onBackToLobby(): void;
  /** In game: stop playing and leave (the Room too) for the title screen. */
  onQuit(): void;
  /** PlayStation resolution turned on or off (see Menu.ps1). */
  onPs1(on: boolean): void;
  /** The collider view turned on or off (see Menu.colliders; offered only with ?dev=1). */
  onColliders(on: boolean): void;
}

/** A Room this player hosts: what to show others so they can join. */
export interface RoomInvite {
  readonly code: string;
  readonly link: string;
}

type Screen = 'title' | 'online' | 'settings' | 'controls' | 'connecting' | 'lobby' | 'pause';

const BROKER_STORAGE_KEY = 'sword.broker';
const BODY_STORAGE_KEY = 'sword.body';
const NAME_STORAGE_KEY = 'sword.name';
const PS1_STORAGE_KEY = 'sword.ps1';
const COLLIDERS_STORAGE_KEY = 'sword.colliders';


function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

function storedBroker(): string {
  try {
    return new URLSearchParams(location.search).get('broker') ?? stored(BROKER_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storedBody(): BodyModelName {
  const saved = stored(BODY_STORAGE_KEY);
  return BODY_MODELS.find((b) => b === saved) ?? 'female';
}

/** Fullscreen with the WebKit prefix some iPad Safari versions still need. */
type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

function fullscreenSupported(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

function toggleFullscreen(): void {
  const doc = document as FullscreenDocument;
  const el = document.documentElement as FullscreenElement;
  try {
    if (isFullscreen()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    } else {
      el.webkitRequestFullscreen?.();
    }
  } catch {
    // Refused (e.g. not from a user gesture): stay as we are.
  }
}

/** The controls, as [keys, what they do]. */
const KEYS: readonly (readonly [string, string])[] = [
  ['Mouse', 'Aim the camera; the last way you moved picks the Direction (up = Overhead, down = Thrust)'],
  ['Hold left mouse', 'Wind up an Attack; let go to swing'],
  ['Right mouse', 'Block in the Direction you last moved'],
  ['W A S D', 'Walk'],
  ['Space', 'Jump'],
  ['C (hold)', 'Crouch'],
  ['F', 'Kick'],
  ['E (hold)', 'Throw a dagger: hold to draw it back, let go to throw'],
  ['R', 'Sheathe your Weapon to walk faster (you cannot Attack or Block), or Draw it again'],
  ['Q', 'Feint, during a Wind-up, into the Direction you last moved'],
  ['Esc', 'Menu (frees the mouse)'],
];

const TOUCH_HELP =
  'Drag the left thumb to walk and drag anywhere else to turn the camera. On the Attack pad, swipe left, right, up (Overhead) ' +
  'or down (Thrust) to wind up in that Direction, and lift to swing. A tap repeats the last Direction. Swipe a new way while ' +
  'holding to feint. The Block pad works the same way. Sheathe puts your Weapon away to walk faster (you cannot Attack or Block); ' +
  'tap it again (it now reads Draw) to take it back out. ☰ opens the menu.';

/**
 * The menus, drawn over the live 3D scene: the title screen (Skirmish, Play
 * Online, Character, How to Play, Editor), the online screen (host or join a
 * Room), the Lobby (Skirmish setup or a Room's Lobby), and in a Match the
 * in-game menu (resume, restart, change the Match setup, leave). They only
 * show and ask; the game owns the Lobby and the Matches.
 */
export class Menu {
  readonly root = h('div', 'menu');
  private readonly frame = h('div', 'menu-frame');
  private screen: Screen = 'title';
  private history: Screen[] = [];
  private message: string | null = null;
  private lobby: Lobby | null = null;
  private arenaInPlay: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private invite: RoomInvite | null = null;
  private connecting = { title: '', detail: '', code: '' };
  private inGame = false;
  private joinText = '';
  /** The Body model you are drawn as, in every Match (render-only; the other players see it too, and the AIs wear random ones). */
  body: BodyModelName = storedBody();
  /** Your name in Rooms. */
  name: string = cleanName(stored(NAME_STORAGE_KEY) ?? 'Player');
  /** Draw the game at PlayStation resolution (240 lines, the screen's aspect ratio kept). */
  ps1: boolean = stored(PS1_STORAGE_KEY) === '1';
  /** Draw the Arena's collision geometry over a see-through model (a developer view: only with ?dev=1). */
  colliders: boolean = devMode() && stored(COLLIDERS_STORAGE_KEY) === '1';
  /** The broker URL as typed (blank = the public PeerJS broker). */
  broker: string = storedBroker();

  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
    private readonly handlers: MenuHandlers,
  ) {
    ensurePlayStyles();
    this.root.append(this.frame);
    container.append(this.root);
    const relabel = () => this.root.querySelectorAll<HTMLButtonElement>('.menu-fullscreen').forEach((b) => this.labelFullscreen(b));
    document.addEventListener('fullscreenchange', relabel);
    document.addEventListener('webkitfullscreenchange', relabel);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** What the camera behind the menu should look at: your Fighter close up on the Character screen, else the scene. */
  get focus(): 'character' | 'scene' {
    return this.visible && this.screen === 'settings' ? 'character' : 'scene';
  }

  /** In a Match, the in-game menu is up (it dims the Match instead of hiding it). */
  get paused(): boolean {
    return this.visible && this.inGame;
  }

  /** The title screen, optionally with a message (a result, or why something failed). */
  showTitle(message?: string): void {
    this.setLobby(null);
    this.inGame = false;
    this.history = [];
    this.go('title', message);
  }

  /** The online screen (host or join), optionally with a message. */
  showOnline(message?: string): void {
    this.setLobby(null);
    this.inGame = false;
    this.history = ['title'];
    this.go('online', message);
  }

  /** Creating or joining a Room. */
  showConnecting(title: string, detail: string, code = ''): void {
    this.connecting = { title, detail, code };
    this.inGame = false;
    this.history = ['title', 'online'];
    this.go('connecting');
  }

  /** The Lobby (out of a Match): Skirmish setup or a Room's Lobby, with an invite for a Room you host. */
  showLobby(lobby: Lobby, invite: RoomInvite | null = null, message?: string): void {
    this.setLobby(lobby, invite);
    this.inGame = false;
    this.history = lobby.online ? ['title', 'online'] : ['title'];
    this.go('lobby', message);
  }

  /** The Arena of the Match being played (or played last in this Lobby), named in the in-game menu and the Lobby's next Random Map; null for none. */
  setArenaInPlay(arena: string | null): void {
    if (arena === this.arenaInPlay) return;
    this.arenaInPlay = arena;
    this.onLobbyChange();
  }

  /** In a Match: the in-game menu. */
  showPause(lobby: Lobby | null, invite: RoomInvite | null = null, message?: string): void {
    this.setLobby(lobby, invite);
    this.inGame = true;
    this.history = [];
    this.go('pause', message);
  }

  hide(): void {
    this.root.hidden = true;
    this.root.classList.remove('menu-in-game');
  }

  /** Esc in the menu: one screen back, or out of the in-game menu. */
  back(): void {
    if (this.screen === 'pause') return this.handlers.onResume();
    if (this.screen === 'lobby' && !this.inGame) return this.handlers.onLeaveLobby();
    if (this.screen === 'connecting') return this.handlers.onLeaveLobby();
    const previous = this.history.pop();
    if (previous) this.go(previous);
  }

  private setLobby(lobby: Lobby | null, invite: RoomInvite | null = null): void {
    if (lobby !== this.lobby) {
      this.unsubscribe?.();
      this.unsubscribe = lobby?.onChange(() => this.onLobbyChange()) ?? null;
    }
    this.lobby = lobby;
    this.invite = invite;
  }

  private onLobbyChange(): void {
    if (this.visible && (this.screen === 'lobby' || this.screen === 'pause')) this.render();
  }

  /** Open a screen; `message` shows on top of it until the next screen. */
  private go(screen: Screen, message?: string): void {
    this.screen = screen;
    this.message = message ?? null;
    this.root.hidden = false;
    this.root.classList.toggle('menu-in-game', this.inGame);
    this.root.classList.toggle('menu-on-title', screen === 'title');
    this.render();
  }

  /** Open a sub-screen that Back returns from. */
  private open(screen: Screen): void {
    this.history.push(this.screen);
    this.go(screen);
  }

  private render(): void {
    // Keep the focused field's text and caret when the Lobby re-renders under it.
    const scrollers = [...this.frame.querySelectorAll('.menu-scroll')].map((e) => e.scrollTop);
    const content = this.build();
    this.frame.className = `menu-frame menu-screen-${this.screen}`;
    this.frame.replaceChildren(content);
    this.frame.querySelectorAll('.menu-scroll').forEach((e, i) => (e.scrollTop = scrollers[i] ?? 0));
  }

  private build(): HTMLElement {
    switch (this.screen) {
      case 'title':
        return this.titleScreen();
      case 'online':
        return this.onlineScreen();
      case 'settings':
        return this.settingsScreen();
      case 'controls':
        return this.controlsScreen();
      case 'connecting':
        return this.connectingScreen();
      case 'lobby':
        return this.lobbyScreen();
      case 'pause':
        return this.pauseScreen();
    }
  }

  private messageLine(): HTMLElement | null {
    return this.message ? h('p', 'menu-message', this.message) : null;
  }

  private labelFullscreen(b: HTMLButtonElement): void {
    b.textContent = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
    b.setAttribute('aria-pressed', String(isFullscreen()));
  }

  private fullscreenButton(): HTMLButtonElement | null {
    if (!fullscreenSupported()) return null; // e.g. iPhone Safari has no Fullscreen API
    const b = button('menu-fullscreen ghost', '', toggleFullscreen);
    this.labelFullscreen(b);
    return b;
  }

  private navItem(label: string, hint: string, onClick: () => void, className = ''): HTMLButtonElement {
    const b = h('button', `nav-item ${className}`, null, h('span', 'nav-label', label), h('span', 'nav-hint', hint));
    b.addEventListener('click', onClick);
    return b;
  }

  /** Toggles PlayStation resolution; stays on this screen. */
  private ps1Item(): HTMLButtonElement {
    const b = this.navItem(`PS1 Resolution: ${this.ps1 ? 'On' : 'Off'}`, 'Play in 240 chunky lines, at your screen\'s shape', () => {
      this.ps1 = !this.ps1;
      store(PS1_STORAGE_KEY, this.ps1 ? '1' : null);
      this.handlers.onPs1(this.ps1);
      this.render();
    });
    b.setAttribute('aria-pressed', String(this.ps1));
    return b;
  }

  /** Toggles the collider view; stays on this screen. Null without ?dev=1. */
  private colliderItem(): HTMLButtonElement | null {
    if (!devMode()) return null;
    const b = this.navItem(`Show Colliders: ${this.colliders ? 'On' : 'Off'}`, 'Walk Surfaces and Walls over a see-through Arena', () => {
      this.colliders = !this.colliders;
      store(COLLIDERS_STORAGE_KEY, this.colliders ? '1' : null);
      this.handlers.onColliders(this.colliders);
      this.render();
    });
    b.setAttribute('aria-pressed', String(this.colliders));
    return b;
  }

  private backButton(label = 'Back', onClick = () => this.back()): HTMLButtonElement {
    return button('back-button ghost', `‹ ${label}`, onClick);
  }

  private card(title: string, ...children: (Node | null | false)[]): HTMLElement {
    return h('div', 'menu-card', null, h('div', 'card-head', null, this.backButton(), h('h2', 'card-title', title)), this.messageLine(), ...children);
  }

  // --- Title ---

  private titleScreen(): HTMLElement {
    // The Editor is for developers: only offered with ?dev=1 in the URL (the #/editor route itself stays open).
    let editor: HTMLAnchorElement | null = null;
    if (devMode()) {
      editor = h('a', 'nav-item nav-link', null, h('span', 'nav-label', 'Editor'), h('span', 'nav-hint', 'Author Motions and Weapons'));
      editor.href = '#/editor';
    }
    const nav = h(
      'nav',
      'title-nav',
      null,
      this.navItem('Skirmish', 'You and AI Fighters, up to 3 a side', () => this.handlers.onSkirmish(), 'primary'),
      this.navItem('Play Online', 'Host or join a Room with a friend', () => this.open('online')),
      this.navItem('Character', 'Your name and how you look', () => this.open('settings')),
      this.navItem('How to Play', 'Directions, Blocks, Kicks and daggers', () => this.open('controls')),
      this.ps1Item(),
      this.colliderItem(),
      editor,
    );
    const you = button('you-chip', '', () => this.open('settings'));
    const face = h('span', 'you-avatar');
    face.style.backgroundImage = `url("${thumb('bodies', this.body)}"), linear-gradient(135deg, #f5cd7a, #a8742a)`;
    you.append(face, h('span', 'you-text', null, h('b', '', this.name), h('span', '', BODY_LABELS[this.body])));
    return h(
      'div',
      'title-screen',
      null,
      h('div', 'title-hero', null, h('h1', 'logo', 'Sword'), h('p', 'tagline', 'Read the blade. Answer the blow.'), this.messageLine(), nav),
      h('div', 'title-foot', null, you, this.fullscreenButton()),
    );
  }

  // --- Online ---

  private nameField(): HTMLElement {
    const input = h('input', 'text-input');
    input.type = 'text';
    input.maxLength = MAX_NAME;
    input.value = this.name;
    input.placeholder = 'Your name';
    input.setAttribute('aria-label', 'Your name');
    input.spellcheck = false;
    input.addEventListener('change', () => {
      this.name = cleanName(input.value);
      input.value = this.name;
      store(NAME_STORAGE_KEY, this.name);
      this.lobby?.setMine({ name: this.name });
    });
    return h('label', 'field', null, h('span', 'field-label', 'Your name'), input);
  }

  private onlineScreen(): HTMLElement {
    const host = h(
      'div',
      'choice-card',
      null,
      h('h3', '', 'Host a Room'),
      h('p', '', 'Get a code and a link to send. You pick the Map, the teams and any AI Fighters in the Lobby.'),
      button('cta', 'Create Room', () => {
        store(BROKER_STORAGE_KEY, this.broker.trim() || null);
        this.handlers.onCreateRoom(this.broker);
      }),
    );
    const code = h('input', 'text-input code-input');
    code.type = 'text';
    code.placeholder = 'ABC123 or a Room link';
    code.setAttribute('aria-label', 'Room code or link');
    code.autocomplete = 'off';
    code.spellcheck = false;
    code.value = this.joinText;
    code.addEventListener('input', () => (this.joinText = code.value));
    const form = h('form', 'join-form', null, code, h('button', 'cta secondary', 'Join'));
    (form.lastChild as HTMLButtonElement).type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      store(BROKER_STORAGE_KEY, this.broker.trim() || null);
      this.handlers.onJoinRoom(code.value, this.broker);
    });
    const join = h('div', 'choice-card', null, h('h3', '', 'Join a Room'), h('p', '', 'Type the code your friend sent, or paste their link.'), form);

    const broker = h('input', 'text-input');
    broker.type = 'text';
    broker.placeholder = 'blank = public PeerJS broker, or https://host:port/path?key=…';
    broker.setAttribute('aria-label', 'Broker URL');
    broker.spellcheck = false;
    broker.value = this.broker;
    broker.addEventListener('input', () => (this.broker = broker.value));
    const advanced = h(
      'details',
      'advanced',
      null,
      h('summary', '', 'Advanced: broker'),
      broker,
      h('p', 'menu-help', 'The PeerJS server players meet through (only to connect; Matches run peer to peer). Everyone must use the same one; Room links carry it.'),
    );
    advanced.open = Boolean(this.broker);
    return this.card('Play Online', this.nameField(), h('div', 'choice-grid', null, host, join), advanced);
  }

  // --- Character ---

  private settingsScreen(): HTMLElement {
    const grid = h('div', 'body-grid');
    for (const b of BODY_MODELS) {
      const card = button('body-card', '', () => {
        this.body = b;
        store(BODY_STORAGE_KEY, b);
        this.lobby?.setMine({ body: b });
        grid.querySelectorAll('.body-card').forEach((c) => c.setAttribute('aria-pressed', String(c === card)));
      });
      card.append(h('span', 'body-picture', null, thumbImage('', 'bodies', b, BODY_LABELS[b])), h('span', 'body-name', BODY_LABELS[b]));
      card.setAttribute('aria-pressed', String(b === this.body));
      grid.append(card);
    }
    const display = h('div', 'lb-row', null, h('span', 'field-label', 'Display'), this.fullscreenButton() ?? h('span', 'menu-help', 'Fullscreen is not available here.'));
    return this.card(
      'Character',
      this.nameField(),
      h('div', 'field', null, h('span', 'field-label', 'Look'), grid),
      h('p', 'menu-help', 'Only you see your look: everyone else is drawn in a random one, and it never changes how a Fighter fights.'),
      display,
    );
  }

  // --- How to Play ---

  private controlsScreen(): HTMLElement {
    const body = isTouchDevice()
      ? h('p', 'menu-help big', TOUCH_HELP)
      : h('dl', 'keys', null, ...KEYS.flatMap(([k, what]) => [h('dt', '', null, ...k.split(' + ').map((x) => h('kbd', '', x))), h('dd', '', what)]));
    const tips = h(
      'ul',
      'tips',
      null,
      h('li', '', 'A Block stops an Attack only from its Direction: watch the Wind-up, then answer it.'),
      h('li', '', 'Hold attack during Recovery to Chain straight into the next swing.'),
      h('li', '', 'A Kick knocks down a Fighter who moves into it, and only shoves one who stands still.'),
      h('li', '', 'Three daggers a Duel: a hit wounds and slows.'),
    );
    return this.card('How to Play', h('div', 'menu-scroll', null, body, h('h3', 'lb-heading', 'Tips'), tips));
  }

  // --- Connecting ---

  private connectingScreen(): HTMLElement {
    const { title, detail, code } = this.connecting;
    return h(
      'div',
      'menu-card narrow centre',
      null,
      h('div', 'spinner'),
      h('h2', 'card-title', title),
      code ? h('div', 'room-code', code) : null,
      h('p', 'menu-help', detail),
      button('ghost', 'Cancel', () => this.handlers.onLeaveLobby()),
    );
  }

  // --- Lobby ---

  private inviteBlock(): HTMLElement | null {
    if (!this.invite) return null;
    const { code, link } = this.invite;
    const copy = button('ghost small', 'Copy link', () => {
      void navigator.clipboard?.writeText(link).then(
        () => (copy.textContent = 'Copied ✓'),
        () => linkInput.select(),
      );
    });
    const linkInput = h('input', 'text-input link-input');
    linkInput.type = 'text';
    linkInput.readOnly = true;
    linkInput.value = link;
    linkInput.setAttribute('aria-label', 'Room link');
    linkInput.addEventListener('focus', () => linkInput.select());
    return h('div', 'invite', null, h('div', 'invite-code', null, h('span', 'field-label', 'Room code'), h('span', 'room-code', code)), h('div', 'invite-link', null, linkInput, copy));
  }

  private lobbyScreen(): HTMLElement {
    const lobby = this.lobby;
    if (!lobby?.state) return this.connectingScreen();
    const state = lobby.state;
    const title = !lobby.online ? 'Skirmish' : this.inGame ? 'Match setup' : lobby.isHost ? 'Your Room' : 'Room';
    const leaveLabel = this.inGame ? 'Back' : lobby.online ? (lobby.isHost ? 'Close Room' : 'Leave Room') : 'Back';
    const head = h('div', 'lb-header', null, h('div', 'lb-title', null, this.backButton(leaveLabel), h('h2', 'card-title', title)), this.inviteBlock());

    const me = lobby.me === null ? undefined : member(state, lobby.me);
    let status = '';
    const actions: HTMLElement[] = [];
    if (this.inGame) {
      if (lobby.isHost) {
        const problem = startProblem(state, false);
        status = problem ?? (lobby.online ? 'Restarting starts a fresh Match for everyone with these settings.' : 'Restarting starts a fresh Match with these settings.');
        const restart = button('cta', 'Restart with these settings', () => this.handlers.onStart());
        restart.disabled = Boolean(problem);
        actions.push(restart);
      } else status = 'Only the host restarts the Match; your Weapon and Seat apply then.';
    } else if (!lobby.online) {
      const problem = startProblem(state, false);
      status = problem ?? 'Pick your Weapon and fill the Seats, then fight.';
      const fight = button('cta', 'Fight', () => this.handlers.onStart());
      fight.disabled = Boolean(problem);
      actions.push(fight);
    } else if (lobby.isHost) {
      const problem = startProblem(state, true);
      status =
        state.members.length < 2 ? `Waiting for a player to join…${problem ? '' : ' Or start now against the AI.'}` : (problem ?? 'Everyone is ready.');
      const start = button('cta', 'Start Match', () => this.handlers.onStart());
      start.disabled = Boolean(problem);
      actions.push(start);
    } else {
      const ready = Boolean(me?.ready);
      status = state.playing ? 'A Match is on: you join the next one.' : ready ? 'Waiting for the host to start…' : 'Say when you are ready.';
      const toggle = button(ready ? 'cta secondary' : 'cta', ready ? 'Not ready' : 'Ready', () => lobby.setMine({ ready: !ready }));
      actions.push(toggle);
    }
    const foot = h('div', 'lb-footer', null, h('p', 'lb-status', status), h('div', 'lb-actions', null, ...actions));
    return h(
      'div',
      'menu-card wide lobby',
      null,
      head,
      this.messageLine(),
      h('div', 'menu-scroll', null, lobbyBody({ tuning: this.tuning, lobby, inGame: this.inGame, played: this.arenaInPlay })),
      foot,
    );
  }

  // --- In-game menu ---

  private pauseScreen(): HTMLElement {
    const lobby = this.lobby;
    const online = Boolean(lobby?.online);
    const host = lobby?.isHost ?? true;
    const nav = h('nav', 'title-nav compact', null, this.navItem('Resume', 'Back to the fight (Esc)', () => this.handlers.onResume(), 'primary'));
    if (host) nav.append(this.navItem('Restart Match', online ? 'A fresh Match for everyone, same settings' : 'Start over, same settings', () => this.handlers.onStart()));
    if (lobby) nav.append(this.navItem('Match setup', host ? 'Weapons, Map, teams, AI — then restart' : 'Your Weapon and Seat for the next Match', () => this.open('lobby')));
    nav.append(this.navItem('Character', 'Your name and how you look', () => this.open('settings')));
    nav.append(this.navItem('How to Play', 'Controls and tips', () => this.open('controls')));
    nav.append(this.ps1Item());
    const colliders = this.colliderItem();
    if (colliders) nav.append(colliders);
    if (online && host) nav.append(this.navItem('Back to Lobby', 'End the Match for everyone, keep the Room', () => this.handlers.onBackToLobby()));
    const leave = !online ? 'Quit to title' : host ? 'Close Room' : 'Leave Room';
    nav.append(this.navItem(leave, online ? 'Everyone else is told you left' : 'Leave this Skirmish', () => this.handlers.onQuit(), 'danger'));
    const settings = lobby?.state?.settings;
    const where = settings ? `${arenaLabel(this.arenaInPlay ?? settings.arena)} · Best of ${settings.bestOf}. ` : '';
    const note = h('p', 'menu-help', where + (online ? 'Online Matches keep running while this menu is open.' : 'The Match waits for you.'));
    return h('div', 'menu-card narrow pause', null, h('h2', 'card-title', online ? 'Match menu' : 'Paused'), this.messageLine(), note, nav, this.inviteBlock());
  }
}
