/**
 * The Map Editor's toolbar, over the top left of the view: one click to a tool (each with its key), undo and redo, the level being edited
 * (a chip a level, its key 1 to 9; + adds one over the top, and a right click on a chip or + offers the rest) and whether every level is
 * shown, mirror mode, the view (top, 3D, split), the play-test, the shortcut sheet, and whether the side panel is shown. It holds no state of its own: `update` reads what it shows from its `state` callback, and each button calls back.
 */
import { TOOL_ICONS } from './icons';
import type { Tool } from './topView';

export interface ToolbarState {
  readonly tool: Tool;
  readonly levels: readonly number[];
  readonly level: number;
  readonly showAll: boolean;
  readonly mirror: boolean;
  readonly view: 'top' | '3d' | 'split';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Whether the side panel (Tweakpane) is shown. */
  readonly panel: boolean;
}

export interface ToolbarActions {
  readonly tool: (t: Tool) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly level: (y: number) => void;
  readonly showAll: (on: boolean) => void;
  readonly mirror: (on: boolean) => void;
  readonly view: (v: ToolbarState['view']) => void;
  readonly playtest: () => void;
  readonly help: () => void;
  /** + : a level over the top one. */
  readonly addLevel: () => void;
  /** A right click on a level's chip (or on +, null): the menu of what can be done with the levels, at the screen point (x, y). */
  readonly levelMenu: (level: number | null, x: number, y: number) => void;
  readonly panel: (on: boolean) => void;
}

/** The tools as the toolbar shows them: a short name, its key, and what it does (the tooltip). */
const TOOLS: readonly { readonly tool: Tool; readonly name: string; readonly key: string; readonly tip: string }[] = [
  { tool: 'select', name: 'Select', key: 'V', tip: 'Pick, move and resize. Click again on the same spot to pick the Brush under it; Alt-drag copies.' },
  { tool: 'floor', name: 'Floor', key: 'F', tip: 'A floor at the level being edited' },
  { tool: 'deck', name: 'Deck', key: 'D', tip: 'A raised floor; the floor under it stays' },
  { tool: 'platform', name: 'Platform', key: 'P', tip: 'A solid box up to the next level' },
  { tool: 'ramp', name: 'Ramp', key: 'R', tip: 'A slope up to the next level (Q turns it)' },
  { tool: 'hole', name: 'Hole', key: 'H', tip: 'Takes away what was laid at this level' },
  { tool: 'hazard', name: 'Hazard', key: 'Z', tip: 'Lava, water or abyss' },
  { tool: 'rail', name: 'Rail', key: 'L', tip: 'A low rail (a segment)' },
  { tool: 'wall', name: 'Wall', key: 'W', tip: 'A wall (a segment)' },
  { tool: 'block', name: 'Block', key: 'B', tip: 'A one-level box' },
  { tool: 'enclosure', name: 'Room', key: 'E', tip: 'An Enclosure: a room with doorways' },
  { tool: 'objective', name: 'Objective', key: 'O', tip: 'Click to place an Objective' },
  { tool: 'prop', name: 'Prop', key: 'T', tip: 'Click to place a prop (its kind in the Look folder, or right-click for one)' },
];

const BAR_CSS =
  'position:absolute;left:8px;top:8px;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px;background:rgba(18,20,26,0.9);border-radius:5px;z-index:7;font:12px/1 system-ui,sans-serif;user-select:none';
const BUTTON_CSS = 'border:1px solid #3a3f4a;background:#262a32;color:#ddd;border-radius:3px;padding:4px 6px;cursor:pointer;font:inherit;white-space:nowrap';
const ON = { background: '#4a5a2a', borderColor: '#ffe14d', color: '#fff' };
const OFF = { background: '#262a32', borderColor: '#3a3f4a', color: '#ddd' };

export class Toolbar {
  readonly element = document.createElement('div');
  private readonly tools = new Map<Tool, HTMLButtonElement>();
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly levelBox = document.createElement('span');
  private readonly all: HTMLButtonElement;
  private readonly panel: HTMLButtonElement;
  private readonly mirror: HTMLButtonElement;
  private readonly views = new Map<ToolbarState['view'], HTMLButtonElement>();
  private levelsShown = '';

  constructor(
    parent: HTMLElement,
    private readonly state: () => ToolbarState,
    private readonly act: ToolbarActions,
  ) {
    this.element.style.cssText = BAR_CSS;
    // A click here is not a click on the view under it.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const t of TOOLS) {
      const b = this.button(`${t.name}`, `${t.tip} (${t.key})`, () => act.tool(t.tool));
      const icon = document.createElement('img');
      icon.src = TOOL_ICONS[t.tool];
      icon.width = icon.height = 16;
      icon.alt = '';
      icon.style.cssText = 'vertical-align:-3px;margin-right:4px';
      b.prepend(icon);
      const key = document.createElement('sup');
      key.textContent = t.key;
      key.style.cssText = 'color:#999;margin-left:2px;font-size:9px';
      b.appendChild(key);
      this.tools.set(t.tool, b);
    }
    this.gap();
    this.undo = this.button('↶', 'Undo (Ctrl+Z)', act.undo);
    this.redo = this.button('↷', 'Redo (Ctrl+Shift+Z)', act.redo);
    this.gap();
    const levelLabel = document.createElement('span');
    levelLabel.textContent = 'level';
    levelLabel.style.cssText = 'color:#999;margin:0 2px';
    this.levelBox.style.cssText = 'display:flex;gap:2px';
    this.element.append(levelLabel, this.levelBox);
    const add = this.button('+', 'Add a level over the top one (+); right-click for below, between or at a height', act.addLevel);
    add.addEventListener('contextmenu', (e) => act.levelMenu(null, e.clientX, e.clientY));
    this.all = this.button('all', 'Show and pick every level, the others faded (A)', () => act.showAll(!this.state().showAll));
    this.gap();
    this.mirror = this.button('⇅ mirror', 'Mirror mode: what you place gets its half-turn twin (M)', () => act.mirror(!this.state().mirror));
    this.gap();
    for (const [v, name] of [
      ['top', 'Top'],
      ['3d', '3D'],
      ['split', 'Split'],
    ] as const)
      this.views.set(v, this.button(name, `The ${name === 'Split' ? 'top and 3D views side by side' : `${name} view`}`, () => act.view(v)));
    this.gap();
    this.button('▶ Play-test', 'Play-test the draft (Ctrl+Enter)', act.playtest);
    this.button('?', 'Shortcuts (?)', act.help);
    this.panel = this.button('◨ panel', 'Show or hide the side panel (\\)', () => act.panel(!this.state().panel));
    parent.appendChild(this.element);
    this.update();
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.style.cssText = BUTTON_CSS;
    // Not focused by a click: the keyboard's shortcuts stay with the editor.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    this.element.appendChild(b);
    return b;
  }

  private gap(): void {
    const g = document.createElement('span');
    g.style.cssText = 'width:1px;height:18px;background:#3a3f4a;margin:0 3px';
    this.element.appendChild(g);
  }

  private static mark(b: HTMLButtonElement, on: boolean): void {
    Object.assign(b.style, on ? ON : OFF);
  }

  /** Show the state as it is now (cheap: called on every refresh of the panel). */
  update(): void {
    const s = this.state();
    for (const [t, b] of this.tools) Toolbar.mark(b, t === s.tool);
    this.undo.disabled = !s.canUndo;
    this.redo.disabled = !s.canRedo;
    this.undo.style.opacity = s.canUndo ? '1' : '0.4';
    this.redo.style.opacity = s.canRedo ? '1' : '0.4';
    const key = s.levels.join(',');
    if (key !== this.levelsShown) {
      this.levelsShown = key;
      this.levelBox.replaceChildren(
        ...s.levels.map((y, k) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = `${y} m`;
          b.title = `${k < 9 ? `Edit the level at ${y} m (${k + 1}; PageUp/PageDown step)` : `Edit the level at ${y} m`}; right-click to add or remove levels`;
          b.style.cssText = BUTTON_CSS;
          b.dataset.level = String(y);
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => this.act.level(y));
          b.addEventListener('contextmenu', (e) => this.act.levelMenu(y, e.clientX, e.clientY));
          return b;
        }),
      );
    }
    for (const b of this.levelBox.children) Toolbar.mark(b as HTMLButtonElement, Number((b as HTMLElement).dataset.level) === s.level);
    Toolbar.mark(this.all, s.showAll);
    Toolbar.mark(this.panel, s.panel);
    this.element.style.maxWidth = s.panel ? 'calc(100% - 370px)' : 'calc(100% - 16px)';
    Toolbar.mark(this.mirror, s.mirror);
    for (const [v, b] of this.views) Toolbar.mark(b, v === s.view);
  }
}
