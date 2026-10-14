import type { TuningData } from '../tuning';
import { ensurePlayStyles } from './styles';

export interface PlayerVsAiChoice {
  readonly difficulty: string;
  readonly bestOf: number;
}

export interface CreateRoomChoice {
  readonly bestOf: number;
  /** The broker URL as typed (blank = the public PeerJS broker). */
  readonly broker: string;
}

export interface JoinRoomChoice {
  /** What the player typed or pasted: a Room code or a Room link. */
  readonly room: string;
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

function storedBroker(): string {
  try {
    return new URLSearchParams(location.search).get('broker') ?? localStorage.getItem(BROKER_STORAGE_KEY) ?? '';
  } catch {
    return '';
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
 * The start menu: Player vs AI (difficulty, Match length) and Player vs
 * Player online (create a Room or join one by code/link, optional broker URL).
 * A separate Room screen shows the code and link while waiting.
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
  private difficulty: string;
  private bestOf = 3;
  private onlineBestOf = 3;

  constructor(container: HTMLElement, tuning: TuningData, handlers: MenuHandlers) {
    ensurePlayStyles();
    const names = Object.keys(tuning.ai.difficulties);
    this.difficulty = names.includes('Normal') ? 'Normal' : names[0]!;

    this.root.className = 'menu';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const title = document.createElement('h1');
    title.textContent = 'Sword';
    this.result.className = 'menu-result';

    // --- Player vs AI ---
    const mode = document.createElement('h2');
    mode.textContent = 'Player vs AI';
    const difficulty = this.choiceRow('Difficulty', names, this.difficulty, (v) => (this.difficulty = v));
    const bestOf = this.bestOfRow(this.bestOf, (n) => (this.bestOf = n));
    this.startButton.className = 'menu-start';
    this.startButton.textContent = 'Start Match';
    this.startButton.addEventListener('click', () => handlers.onStart({ difficulty: this.difficulty, bestOf: this.bestOf }));

    // --- Player vs Player ---
    const online = document.createElement('h2');
    online.textContent = 'Player vs Player (online)';
    const onlineBestOf = this.bestOfRow(this.onlineBestOf, (n) => (this.onlineBestOf = n));
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'menu-create-room';
    create.textContent = 'Create Room';
    create.addEventListener('click', () => {
      storeBroker(this.brokerInput.value);
      handlers.onCreateRoom({ bestOf: this.onlineBestOf, broker: this.brokerInput.value });
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
      handlers.onJoinRoom({ room: this.joinInput.value, broker: this.brokerInput.value });
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
    help.innerHTML =
      'Move the mouse to aim the camera and pick a Direction (left, right, up = Overhead, down = Thrust), then ' +
      '<b>hold left mouse</b> to wind up and let go to swing. <b>Right mouse</b> blocks in the Direction you last moved. ' +
      '<b>WASD</b> walks. <b>Q</b> during a wind-up feints into the Direction you last moved. Esc frees the mouse.';

    const editor = document.createElement('a');
    editor.className = 'menu-link';
    editor.href = '#/editor';
    editor.textContent = 'Open the Editor';

    this.main.append(mode, difficulty, bestOf, this.startButton, online, onlineBestOf, create, joinRow, brokerBox, help, editor);

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

    panel.append(title, this.result, this.main, this.room);
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
        this.roomStatus.textContent = 'Send the code or the link to your opponent. Waiting for them to join…';
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
