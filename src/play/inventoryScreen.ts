/**
 * The inventory screen (docs/plans/dungeon.md, Stage 3): a modal over the HUD, opened by `I` or, on a touch device, its button. It draws
 * `inventoryView` and nothing else: a click or tap on an item's control only hands `(ref, action)` to `onAction`, which sets the Local
 * Controller's `equip` or `drop` for one Tick (`LocalController.inventoryClick`). It never changes the Match.
 *
 * DOM (for scripts): `.inv-toggle` the touch button, `.inv-screen` the modal (`hidden` while closed), `.inv-close`, `.inv-status` the reason
 * nothing is available, `.inv-item` each item with `data-kind` (`weapon` or `relic`) and `data-slot`, and in it `.inv-equip` (the item's
 * main control: wield, equip or unequip) and `.inv-drop`. A control not available is `disabled` with its reason in `title`.
 */
import type { FighterState, HallPhase, InventoryRef } from '../sim';
import type { TuningData } from '../tuning';
import { inventoryView, inventoryViewKey, type ActionView, type InventoryView, type ItemView, type SlotView } from './inventoryView';

export type InventoryScreenAction = 'equip' | 'drop';

/** The screen's styles (added with the HUD's, `ensurePlayStyles`). */
export const INVENTORY_CSS = `
.inv-toggle { display: none; pointer-events: auto; position: absolute; right: calc(50% + 1.6rem); bottom: max(0.8rem, env(safe-area-inset-bottom));
  height: 2.4rem; padding: 0 0.8rem; font: 1.3rem var(--font-body); color: #fff; background: var(--panel-2); border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2); cursor: pointer; opacity: 0.85; }
@media (pointer: coarse) { .inv-toggle { display: block; } }
.inv-screen { position: absolute; inset: 0; pointer-events: auto; display: flex; align-items: center; justify-content: center; background: #0d0a14e0; }
.inv-screen[hidden] { display: none; }
.inv-panel { box-sizing: border-box; width: min(44rem, 100%); max-height: 100%; overflow-y: auto; padding: 0.8rem 1rem; background: var(--panel); color: #fff;
  border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2), calc(var(--px) * 3) calc(var(--px) * 3) 0 #000; font: 1.3rem/1.15 var(--font-body); }
.inv-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.inv-title { margin: 0; font-family: var(--font-display); font-size: 0.9rem; text-transform: uppercase; color: var(--gold-2); }
.inv-close { min-width: 2.4rem; height: 2.4rem; font-size: 1.3rem; color: #fff; background: var(--panel-2); border: var(--px) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2); cursor: pointer; }
.inv-status { min-height: 1.3rem; margin: 0.3rem 0; color: #ffb060; font-weight: 700; }
.inv-section { margin: 0.6rem 0 0.3rem; font-family: var(--font-display); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.inv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 0.5rem; }
.inv-slot { display: flex; align-items: stretch; gap: 0.3rem; min-height: 3.6rem; border: var(--px) dashed var(--line); }
.inv-slot.filled { border: var(--px) solid #000; background: var(--panel-2); }
.inv-slot.marked { border-color: #ffd56a; background: #4a3a14; }
.inv-slot .empty { margin: auto; opacity: 0.35; font-size: 1.04rem; }
.inv-equip { flex: 1; display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; text-align: left; color: inherit; font: inherit; background: none; border: 0; cursor: pointer; }
.inv-equip:disabled, .inv-drop:disabled { cursor: not-allowed; opacity: 0.55; }
.inv-icon { flex: none; width: 2.4rem; height: 2.4rem; }
.inv-text { display: flex; flex-direction: column; min-width: 0; }
.inv-name { font-size: 1.35rem; }
.inv-mark { color: #ffd56a; font-size: 1.1rem; }
.inv-words, .inv-note { font-size: 1.1rem; opacity: 0.8; }
.inv-note { color: #ffb060; opacity: 1; }
.inv-drop { flex: none; width: 3.4rem; font: 1.15rem var(--font-body); color: #ff9a8a; background: #0d0a14; border: 0; border-left: var(--px) solid #000; cursor: pointer; }
.inv-numbers { display: flex; flex-wrap: wrap; gap: 0.4rem 1.2rem; margin-top: 0.8rem; padding-top: 0.6rem; border-top: var(--px) solid #fff3; }
.inv-number b { margin-left: 0.3rem; font-variant-numeric: tabular-nums; }
.inv-help { margin: 0.6rem 0 0; font-size: 1.05rem; opacity: 0.6; }
.inv-panel { overscroll-behavior: contain; touch-action: pan-y; }
/* A landscape phone is about 390 px high: a denser panel that fits (three columns, no help line), and it still scrolls if it must. */
@media (max-height: 480px) {
  .inv-panel { max-height: 100dvh; padding: 0.4rem 0.7rem; font-size: 1.04rem; line-height: 1.2; }
  .inv-title { font-size: 1.3rem; }
  .inv-close { min-width: 2rem; height: 2rem; }
  .inv-status { min-height: 0; margin: 0.1rem 0; }
  .inv-status:empty { display: none; }
  .inv-section { margin: 0.3rem 0 0.2rem; font-size: 0.91rem; }
  .inv-grid { grid-template-columns: repeat(3, 1fr); gap: 0.3rem; }
  .inv-slot { min-height: 2.6rem; }
  .inv-equip { gap: 0.35rem; padding: 0.2rem 0.35rem; }
  .inv-icon { width: 1.8rem; height: 1.8rem; }
  .inv-words, .inv-note, .inv-mark { font-size: 0.88rem; }
  .inv-drop { width: 2.8rem; font-size: 0.88rem; }
  .inv-numbers { margin-top: 0.4rem; padding-top: 0.3rem; gap: 0.2rem 1rem; }
  .inv-help { display: none; }
}
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class InventoryScreen {
  /** Holds the screen and its touch button; append it to the HUD's root. */
  readonly root = el('div', 'inv');
  private readonly toggle = el('button', 'inv-toggle', 'Items');
  private readonly screen = el('div', 'inv-screen');
  private readonly panel = el('div', 'inv-panel');
  private shown = '';
  private isOpen = false;

  /** `onAction`: a control was clicked or tapped. `onToggle`: the touch button or the close control was (the game opens or closes the screen). */
  constructor(
    private readonly onAction: (ref: InventoryRef, action: InventoryScreenAction) => void,
    onToggle: () => void,
  ) {
    this.toggle.type = 'button';
    this.toggle.title = 'Inventory (I)';
    this.toggle.setAttribute('aria-label', 'Inventory');
    this.toggle.addEventListener('click', onToggle);
    this.screen.hidden = true;
    this.screen.setAttribute('role', 'dialog');
    this.screen.setAttribute('aria-label', 'Inventory');
    this.screen.append(this.panel);
    // A click outside the panel closes it, as on the menu.
    this.screen.addEventListener('click', (e) => {
      if (e.target === this.screen) onToggle();
    });
    this.panel.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.inv-close')) onToggle();
    });
    this.root.append(this.toggle, this.screen);
  }

  get open(): boolean {
    return this.isOpen;
  }

  set open(on: boolean) {
    this.isOpen = on;
    this.screen.hidden = !on;
    this.shown = '';
  }

  /** Draw the local Player's inventory (every frame; the DOM is rebuilt only when the view changes, so a press is never lost to a rebuild). */
  update(fighter: FighterState | undefined, tuning: Pick<TuningData, 'relics' | 'dungeon' | 'dagger'>, phase: HallPhase | undefined): void {
    if (!this.isOpen) return;
    const view = inventoryView(fighter, tuning, phase);
    const key = inventoryViewKey(view);
    if (key === this.shown) return;
    this.shown = key;
    this.panel.replaceChildren(...this.build(view));
  }

  private build(view: InventoryView | null): HTMLElement[] {
    const head = el('div', 'inv-head');
    const close = el('button', 'inv-close', '×');
    close.type = 'button';
    close.title = 'Close (I)';
    close.setAttribute('aria-label', 'Close');
    head.append(el('h2', 'inv-title', 'Inventory'), close);
    if (!view) return [head, el('p', 'inv-status', 'No inventory outside a Run')];
    const status = el('p', 'inv-status', view.lock ?? '');
    const weapons = this.grid('Weapons', `${view.weapons.filter((s) => s.item).length} / ${view.weapons.length}`, view.weapons, view.lock);
    const relics = this.grid('Relics', view.relicsEquipped, view.relics, view.lock);
    const numbers = el('div', 'inv-numbers');
    for (const n of view.numbers) {
      const row = el('span', 'inv-number', n.label);
      row.append(el('b', '', n.value));
      numbers.append(row);
    }
    const help = el('p', 'inv-help', '1-9 equip, Shift+1-9 select, X drop the selected, I close');
    return [head, status, ...weapons, ...relics, numbers, help];
  }

  private grid(title: string, count: string, slots: readonly SlotView[], lock: string | null): HTMLElement[] {
    const grid = el('div', 'inv-grid');
    grid.append(...slots.map((s) => this.slot(s, lock)));
    return [el('h3', 'inv-section', `${title} · ${count}`), grid];
  }

  private slot({ ref, item }: SlotView, lock: string | null): HTMLElement {
    const slot = el('div', item ? `inv-slot filled${item.marked ? ' marked' : ''}` : 'inv-slot');
    if (!item) {
      slot.append(el('span', 'empty', 'Empty'));
      return slot;
    }
    slot.classList.add('inv-item');
    slot.dataset.kind = ref.kind;
    slot.dataset.slot = String(ref.slot);
    slot.append(this.equipControl(ref, item, lock));
    if (item.drop) slot.append(this.control('inv-drop', item.drop, () => this.onAction(ref, 'drop')));
    return slot;
  }

  /** The item's main control: icon, name, mark, effects and, when it cannot be used for its own reason, why. */
  private equipControl(ref: InventoryRef, item: ItemView, lock: string | null): HTMLButtonElement {
    const icon = el('span', 'inv-icon');
    icon.innerHTML = item.icon;
    const text = el('span', 'inv-text');
    const name = el('span', 'inv-name', item.name);
    text.append(name);
    if (item.marked) text.append(el('span', 'inv-mark', ref.kind === 'weapon' ? 'Wielded' : 'Equipped'));
    if (item.words) text.append(el('span', 'inv-words', item.words));
    const equip = item.equip;
    // The screen's status line says why everything is locked; an item's note says only what is its own (every Relic slot taken).
    if (equip && equip.reason && equip.reason !== lock) text.append(el('span', 'inv-note', equip.reason));
    const button = this.control('inv-equip', equip, () => this.onAction(ref, 'equip'));
    button.title = equip ? (equip.available ? equip.label : `${equip.label}: ${equip.reason}`) : 'Wielded';
    button.prepend(icon, text);
    return button;
  }

  /** A button for `view` (null: nothing to do, so a plain disabled one); a click acts only when available. */
  private control(className: string, view: ActionView | null, act: () => void): HTMLButtonElement {
    const button = el('button', className, className === 'inv-drop' ? (view?.label ?? '') : '');
    button.type = 'button';
    const available = view?.available ?? false;
    button.disabled = !available;
    if (className === 'inv-drop' && view) button.title = available ? view.label : `${view.label}: ${view.reason}`;
    button.addEventListener('click', () => {
      if (available) act();
    });
    return button;
  }
}
