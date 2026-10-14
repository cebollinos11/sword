import type { TuningData } from '../tuning';
import { ensurePlayStyles } from './styles';

export interface PlayerVsAiChoice {
  readonly difficulty: string;
  readonly bestOf: number;
}

const BEST_OF = [1, 3, 5] as const;

/**
 * The start menu: pick an AI difficulty and the Match length, then start a
 * Player vs AI Match. #23 adds Player vs Player (Room) entries here.
 */
export class Menu {
  readonly root = document.createElement('div');
  private readonly result = document.createElement('p');
  private readonly startButton = document.createElement('button');
  private difficulty: string;
  private bestOf = 3;

  constructor(container: HTMLElement, tuning: TuningData, onStart: (choice: PlayerVsAiChoice) => void) {
    ensurePlayStyles();
    const names = Object.keys(tuning.ai.difficulties);
    this.difficulty = names.includes('Normal') ? 'Normal' : names[0]!;

    this.root.className = 'menu';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const title = document.createElement('h1');
    title.textContent = 'Sword';
    this.result.className = 'menu-result';

    const mode = document.createElement('h2');
    mode.textContent = 'Player vs AI';

    const difficulty = this.choiceRow('Difficulty', names, this.difficulty, (v) => (this.difficulty = v));
    const bestOf = this.choiceRow(
      'Match',
      BEST_OF.map((n) => `Best of ${n}`),
      `Best of ${this.bestOf}`,
      (v) => (this.bestOf = Number(v.replace('Best of ', ''))),
    );

    this.startButton.className = 'menu-start';
    this.startButton.textContent = 'Start Match';
    this.startButton.addEventListener('click', () => onStart({ difficulty: this.difficulty, bestOf: this.bestOf }));

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

    panel.append(title, this.result, mode, difficulty, bestOf, this.startButton, help, editor);
    this.root.append(panel);
    container.append(this.root);
  }

  show(result?: string): void {
    this.result.textContent = result ?? '';
    this.result.hidden = !result;
    this.startButton.textContent = result ? 'Play again' : 'Start Match';
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
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
