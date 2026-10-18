import type { TuningData } from '../tuning';
import type { Lineup } from '../controllers';
import { BODY_LABELS, BODY_MODELS, type BodyModelName } from '../render/bodyModel';
import { ensurePlayStyles } from './styles';
import { TeamSetup } from './teamSetup';
import { isTouchDevice } from './touch';

export interface PlayerVsAiChoice {
  readonly bestOf: number;
  /** The Arena every Duel is fought in (a Tuning Data Arena name). */
  readonly arena: string;
  /** Your Weapon (a Tuning Data Weapon name). */
  readonly weapon: string;
  /** Who fights: you (Player 0), and the AIs on both teams with their difficulty and Weapon. */
  readonly lineup: Lineup;
}

export interface CreateRoomChoice {
  readonly bestOf: number;
  /** The Arena every Duel is fought in (a Tuning Data Arena name); the host picks it. */
  readonly arena: string;
  /** Your Weapon; the other player picks theirs. */
  readonly weapon: string;
  /** Who fights: you (Player 0), the other player (Player 1, ally or enemy), and any AIs. */
  readonly lineup: Lineup;
  /** The broker URL as typed (blank = the public PeerJS broker). */
  readonly broker: string;
}

export interface JoinRoomChoice {
  /** What the player typed or pasted: a Room code or a Room link. */
  readonly room: string;
  /** Your Weapon; the other player picks theirs. */
  readonly weapon: string;
  readonly broker: string;
}

export interface MenuHandlers {
  onStart(choice: PlayerVsAiChoice): void;
  onCreateRoom(choice: CreateRoomChoice): void;
  onJoinRoom(choice: JoinRoomChoice): void;
  /** Leave the Room screen (stop hosting / joining). */
  onLeaveRoom(): void;
}

/** What the Room screen shows while a Player vs Player Match is being set up. */
export type RoomView =
  | { readonly kind: 'Creating' }
  | { readonly kind: 'Hosting'; readonly code: string; readonly link: string }
  | { readonly kind: 'Joining'; readonly code: string };

const BEST_OF = [1, 3, 5] as const;
const BROKER_STORAGE_KEY = 'sword.broker';
const BODY_STORAGE_KEY = 'sword.body';
const ARENA_STORAGE_KEY = 'sword.arena';

/** How the menu names each Arena; one missing here shows its file name. */
const ARENA_LABELS: Readonly<Record<string, string>> = {
  library: 'Library',
  chamber: 'Carbon-freezing chamber',
  ship: 'Pirate ship',
  summit: 'Snowy summit',
  circle: 'Training circle',
};

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

function storedBroker(): string {
  try {
    return new URLSearchParams(location.search).get('broker') ?? localStorage.getItem(BROKER_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storedBody(): BodyModelName {
  try {
    const saved = localStorage.getItem(BODY_STORAGE_KEY);
    return BODY_MODELS.find((b) => b === saved) ?? 'female';
  } catch {
    return 'female';
  }
}

function storeBody(value: BodyModelName): void {
  try {
    localStorage.setItem(BODY_STORAGE_KEY, value);
  } catch {
    // Storage unavailable: the model just isn't remembered.
  }
}

/** The Arena picked last time, if it still exists, else `fallback`. */
function storedArena(arenas: readonly string[], fallback: string): string {
  try {
    const saved = localStorage.getItem(ARENA_STORAGE_KEY);
    return arenas.find((a) => a === saved) ?? fallback;
  } catch {
    return fallback;
  }
}

function storeArena(value: string): void {
  try {
    localStorage.setItem(ARENA_STORAGE_KEY, value);
  } catch {
    // Storage unavailable: the Arena just isn't remembered.
  }
}

function storeBroker(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(BROKER_STORAGE_KEY, value.trim());
    else localStorage.removeItem(BROKER_STORAGE_KEY);
  } catch {
    // Storage unavailable: the broker just isn't remembered.
  }
}

/**
 * The start menu: Player vs AI (your Weapon, your AI allies and AI enemies with each one's
 * difficulty and Weapon, Match length) and Player vs Player online (your Weapon; to create a Room
 * also the Match length, whether the other player is your ally or enemy, and any AIs; or join one
 * by code/link; optional broker URL). A separate Room screen shows the code and link while waiting.
 */
export class Menu {
  readonly root = document.createElement('div');
  private readonly result = document.createElement('p');
  private readonly startButton = document.createElement('button');
  private readonly main = document.createElement('div');
  private readonly room = document.createElement('div');
  private readonly roomTitle = document.createElement('h2');
  private readonly roomCode = document.createElement('div');
  private readonly roomLink = document.createElement('input');
  private readonly roomCopy = document.createElement('button');
  private readonly roomStatus = document.createElement('p');
  private readonly joinInput = document.createElement('input');
  private readonly brokerInput = document.createElement('input');
  private bestOf = 3;
  private onlineBestOf = 3;
  private weapon: string;
  /** The Arena a Match you start (or a Room you create) is fought in. */
  private arena: string;
  /** Your Weapon for a Player vs Player Match (also used when joining from a Room link). */
  onlineWeapon: string;
  /** The Body model you are drawn as, in every Match (render-only; the other Fighters wear random ones). */
  body: BodyModelName = storedBody();

  constructor(container: HTMLElement, tuning: TuningData, handlers: MenuHandlers) {
    ensurePlayStyles();
    const weapons = Object.keys(tuning.weapons);
    this.weapon = this.onlineWeapon = weapons[0]!;
    const arenas = Object.keys(tuning.arenas);
    this.arena = storedArena(arenas, tuning.arena.match);
    const row = this.choiceRow.bind(this);

    this.root.className = 'menu';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const head = document.createElement('div');
    head.className = 'menu-head';
    const title = document.createElement('h1');
    title.textContent = 'Sword';
    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'menu-fullscreen';
    const labelFullscreen = () => {
      fullscreen.textContent = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
      fullscreen.setAttribute('aria-pressed', String(isFullscreen()));
    };
    labelFullscreen();
    fullscreen.hidden = !fullscreenSupported(); // e.g. iPhone Safari has no Fullscreen API
    fullscreen.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', labelFullscreen);
    document.addEventListener('webkitfullscreenchange', labelFullscreen);
    head.append(title, fullscreen);
    this.result.className = 'menu-result';

    const labels = BODY_MODELS.map((b) => BODY_LABELS[b]);
    const model = this.choiceRow('Your Model', labels, BODY_LABELS[this.body], (v) => {
      this.body = BODY_MODELS[labels.indexOf(v)]!;
      storeBody(this.body);
    });
    const map = this.mapRow(arenas);

    // --- Player vs AI ---
    const mode = document.createElement('h2');
    mode.textContent = 'Player vs AI';
    const weapon = this.choiceRow('Your Weapon', weapons, this.weapon, (v) => (this.weapon = v));
    const teams = new TeamSetup(tuning, false, row);
    const bestOf = this.bestOfRow(this.bestOf, (n) => (this.bestOf = n));
    this.startButton.className = 'menu-start';
    this.startButton.textContent = 'Start Match';
    this.startButton.addEventListener('click', () => handlers.onStart({ bestOf: this.bestOf, arena: this.arena, weapon: this.weapon, lineup: teams.lineup() }));

    // --- Player vs Player ---
    const online = document.createElement('h2');
    online.textContent = 'Player vs Player (online)';
    const onlineWeapon = this.choiceRow('Your Weapon', weapons, this.onlineWeapon, (v) => (this.onlineWeapon = v));
    const hostBox = document.createElement('details');
    hostBox.className = 'menu-host';
    const hostSummary = document.createElement('summary');
    hostSummary.textContent = 'Room setup (when you create one)';
    const onlineBestOf = this.bestOfRow(this.onlineBestOf, (n) => (this.onlineBestOf = n));
    const onlineTeams = new TeamSetup(tuning, true, row);
    hostBox.append(hostSummary, onlineBestOf, onlineTeams.root);
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'menu-create-room';
    create.textContent = 'Create Room';
    create.addEventListener('click', () => {
      storeBroker(this.brokerInput.value);
      handlers.onCreateRoom({ bestOf: this.onlineBestOf, arena: this.arena, weapon: this.onlineWeapon, lineup: onlineTeams.lineup(), broker: this.brokerInput.value });
    });

    const joinRow = document.createElement('form');
    joinRow.className = 'menu-row menu-join';
    this.joinInput.type = 'text';
    this.joinInput.placeholder = 'Room code or link';
    this.joinInput.setAttribute('aria-label', 'Room code or link');
    this.joinInput.autocomplete = 'off';
    this.joinInput.spellcheck = false;
    const join = document.createElement('button');
    join.type = 'submit';
    join.className = 'menu-join-room';
    join.textContent = 'Join Room';
    joinRow.addEventListener('submit', (e) => {
      e.preventDefault();
      storeBroker(this.brokerInput.value);
      handlers.onJoinRoom({ room: this.joinInput.value, weapon: this.onlineWeapon, broker: this.brokerInput.value });
    });
    joinRow.append(this.joinInput, join);

    const brokerBox = document.createElement('details');
    brokerBox.className = 'menu-broker';
    const brokerSummary = document.createElement('summary');
    brokerSummary.textContent = 'Broker';
    this.brokerInput.type = 'text';
    this.brokerInput.placeholder = 'blank = public PeerJS broker, or https://host:port/path?key=…';
    this.brokerInput.setAttribute('aria-label', 'Broker URL');
    this.brokerInput.spellcheck = false;
    this.brokerInput.value = storedBroker();
    if (this.brokerInput.value) brokerBox.open = true;
    const brokerHelp = document.createElement('p');
    brokerHelp.className = 'menu-help';
    brokerHelp.textContent =
      'The PeerJS server the two players meet through (only to connect; the Match itself runs peer to peer). Both players must use the same one; Room links carry it.';
    brokerBox.append(brokerSummary, this.brokerInput, brokerHelp);

    const help = document.createElement('p');
    help.className = 'menu-help';
    help.innerHTML = isTouchDevice()
      ? 'Drag the <b>left thumb</b> to walk and drag anywhere else to turn the camera. On the <b>Attack</b> pad, ' +
        'swipe left, right, up (Overhead) or down (Thrust) to wind up in that Direction, and lift to swing. A tap ' +
        'repeats the last Direction. Swipe a new way while holding to feint. The <b>Block</b> pad works the same way.'
      : 'Move the mouse to aim the camera and pick a Direction (left, right, up = Overhead, down = Thrust), then ' +
      '<b>hold left mouse</b> to wind up and let go to swing. <b>Right mouse</b> blocks in the Direction you last moved. ' +
      '<b>WASD</b> walks. <b>Q</b> during a wind-up feints into the Direction you last moved. Esc frees the mouse.';

    const editor = document.createElement('a');
    editor.className = 'menu-link';
    editor.href = '#/editor';
    editor.textContent = 'Open the Editor';

    this.main.append(model, map, mode, weapon, teams.root, bestOf, this.startButton, online, onlineWeapon, hostBox, create, joinRow, brokerBox, help, editor);

    // --- Room screen ---
    this.room.className = 'menu-room';
    this.roomCode.className = 'menu-room-code';
    const linkRow = document.createElement('div');
    linkRow.className = 'menu-row';
    this.roomLink.type = 'text';
    this.roomLink.readOnly = true;
    this.roomLink.className = 'menu-room-link';
    this.roomLink.setAttribute('aria-label', 'Room link');
    this.roomLink.addEventListener('focus', () => this.roomLink.select());
    this.roomCopy.type = 'button';
    this.roomCopy.textContent = 'Copy link';
    this.roomCopy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.roomLink.value).then(
        () => (this.roomCopy.textContent = 'Copied'),
        () => this.roomLink.select(),
      );
    });
    linkRow.append(this.roomLink, this.roomCopy);
    this.roomStatus.className = 'menu-room-status';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'menu-leave-room';
    leave.textContent = 'Cancel';
    leave.addEventListener('click', () => handlers.onLeaveRoom());
    this.room.append(this.roomTitle, this.roomCode, linkRow, this.roomStatus, leave);
    this.room.hidden = true;

    panel.append(head, this.result, this.main, this.room);
    this.root.append(panel);
    container.append(this.root);
  }

  /** The main menu, optionally with a result or error line on top. */
  show(result?: string): void {
    this.result.textContent = result ?? '';
    this.result.hidden = !result;
    this.startButton.textContent = result ? 'Play again' : 'Start Match';
    this.main.hidden = false;
    this.room.hidden = true;
    this.root.hidden = false;
  }

  /** The Room screen (creating, waiting for a guest with code and link, or joining). */
  showRoom(view: RoomView): void {
    this.result.hidden = true;
    this.main.hidden = true;
    this.room.hidden = false;
    this.root.hidden = false;
    const linkRow = this.roomLink.parentElement!;
    switch (view.kind) {
      case 'Creating':
        this.roomTitle.textContent = 'Creating a Room…';
        this.roomCode.textContent = '';
        linkRow.hidden = true;
        this.roomStatus.textContent = 'Registering with the broker.';
        break;
      case 'Hosting':
        this.roomTitle.textContent = 'Room';
        this.roomCode.textContent = view.code;
        this.roomLink.value = view.link;
        this.roomCopy.textContent = 'Copy link';
        linkRow.hidden = false;
        this.roomStatus.textContent = 'Send the code or the link to the other player. Waiting for them to join…';
        break;
      case 'Joining':
        this.roomTitle.textContent = 'Joining Room';
        this.roomCode.textContent = view.code;
        linkRow.hidden = true;
        this.roomStatus.textContent = 'Connecting to the host…';
        break;
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  private bestOfRow(initial: number, onPick: (n: number) => void): HTMLElement {
    return this.choiceRow(
      'Match',
      BEST_OF.map((n) => `Best of ${n}`),
      `Best of ${initial}`,
      (v) => onPick(Number(v.replace('Best of ', ''))),
    );
  }

  /** The Map dropdown: the Arena of a Match you start or a Room you create (whoever joins plays the host's). */
  private mapRow(arenas: readonly string[]): HTMLElement {
    const row = document.createElement('label');
    row.className = 'menu-row';
    const name = document.createElement('span');
    name.className = 'menu-label';
    name.textContent = 'Map';
    const select = document.createElement('select');
    select.className = 'menu-map';
    for (const a of arenas) select.append(new Option(ARENA_LABELS[a] ?? a, a, false, a === this.arena));
    select.addEventListener('change', () => {
      this.arena = select.value;
      storeArena(this.arena);
    });
    row.append(name, select);
    return row;
  }

  private choiceRow(label: string, options: readonly string[], initial: string, onPick: (v: string) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'menu-row';
    const name = document.createElement('span');
    name.className = 'menu-label';
    name.textContent = label;
    const group = document.createElement('div');
    group.className = 'menu-choices';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    const buttons = options.map((option) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = option;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-checked', String(other === b));
        onPick(option);
      });
      b.setAttribute('aria-checked', String(option === initial));
      return b;
    });
    group.append(...buttons);
    row.append(name, group);
    return row;
  }
}
