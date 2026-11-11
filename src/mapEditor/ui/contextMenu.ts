/**
 * The Map Editor's right-click menu: a small DOM menu at the pointer, with items, checked items, disabled headers, separators and submenus
 * (opened by hovering). One is open at a time; a click elsewhere, the wheel, Escape or leaving the window closes it. It knows nothing of the
 * map: the top view's caller builds the items for what lies under the pointer (`index.ts`).
 */

export type MenuItem =
  | 'separator'
  | {
      readonly label: string;
      /** The shortcut that does the same, shown on the right. */
      readonly hint?: string;
      /** A tick before the label (a toggle that is on, the current choice of several). */
      readonly checked?: boolean;
      readonly disabled?: boolean;
      /** A heading: drawn dim and bold, never clicked. */
      readonly header?: boolean;
      /** A picture before the label (an image URL: a tool's icon, a material's swatch). */
      readonly icon?: string;
      readonly action?: () => void;
      readonly submenu?: readonly MenuItem[];
    };

const MENU_CSS =
  'position:fixed;z-index:100001;min-width:180px;max-height:80vh;overflow-y:auto;padding:4px 0;background:rgb(30,33,40);color:#ddd;font:12px/1.2 system-ui,sans-serif;border:1px solid #444;border-radius:5px;box-shadow:0 6px 18px rgba(0,0,0,0.5);user-select:none';

let open: { readonly root: HTMLElement; readonly close: () => void } | null = null;

/** Close the menu that is open, if one is. */
export function closeMenu(): void {
  open?.close();
}

/** Whether a menu is open. */
export function menuOpen(): boolean {
  return open !== null;
}

/** Open a menu of `items` at the screen point (x, y), kept inside the window. */
export function showMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeMenu();
  const menus: HTMLElement[] = [];
  const onDown = (e: PointerEvent) => {
    if (!menus.some((m) => m.contains(e.target as Node))) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const onWheel = (e: WheelEvent) => {
    if (!menus.some((m) => m.contains(e.target as Node))) close();
  };
  const close = () => {
    for (const m of menus) m.remove();
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('blur', close);
    if (open?.close === close) open = null;
  };
  /** Build a menu (the root, or a submenu at `depth`) at the screen point (x, y); a submenu opened from it closes its deeper ones first. */
  const build = (list: readonly MenuItem[], at: { x: number; y: number; flipX?: number }, depth: number): HTMLElement => {
    const menu = document.createElement('div');
    menu.style.cssText = MENU_CSS;
    menu.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const item of list) {
      if (item === 'separator') {
        const hr = document.createElement('div');
        hr.style.cssText = 'height:1px;margin:4px 6px;background:#444';
        menu.appendChild(hr);
        continue;
      }
      const row = document.createElement('div');
      const usable = !item.disabled && !item.header && (item.action !== undefined || item.submenu !== undefined);
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 12px 5px 8px;white-space:nowrap;cursor:${usable ? 'pointer' : 'default'};${item.header ? 'font-weight:600;color:#9ab;' : ''}${item.disabled ? 'opacity:0.45;' : ''}`;
      const tick = document.createElement('span');
      tick.style.cssText = 'width:12px;flex:none;color:#ffe14d';
      tick.textContent = item.checked ? '✓' : '';
      const label = document.createElement('span');
      label.style.cssText = 'flex:1';
      label.textContent = item.label;
      const hint = document.createElement('span');
      hint.style.cssText = 'color:#888;margin-left:16px';
      hint.textContent = item.submenu ? '▸' : (item.hint ?? '');
      row.append(tick);
      if (item.icon) {
        const img = document.createElement('img');
        img.src = item.icon;
        img.width = img.height = 18;
        img.alt = '';
        img.style.cssText = 'flex:none;image-rendering:pixelated;border-radius:2px';
        row.append(img);
      }
      row.append(label, hint);
      row.addEventListener('pointerenter', () => {
        // Hovering a row closes the submenus deeper than this menu, then opens its own.
        for (const m of menus.splice(depth + 1)) m.remove();
        if (usable) row.style.background = 'rgba(255,255,255,0.09)';
        if (item.submenu && usable) {
          const r = row.getBoundingClientRect();
          menus.push(build(item.submenu, { x: r.right - 2, y: r.top - 5, flipX: r.left + 2 }, depth + 1));
        }
      });
      row.addEventListener('pointerleave', () => (row.style.background = ''));
      row.addEventListener('click', () => {
        if (!usable || !item.action) return;
        close();
        item.action();
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    // Inside the window: a menu too far right opens leftward (a submenu on the other side of its row), too low moves up.
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = at.x + w <= window.innerWidth - 4 ? at.x : Math.max(4, (at.flipX ?? at.x) - w);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - h - 4))}px`;
    return menu;
  };
  menus.push(build(items, { x, y }, 0));
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', onWheel, true);
  window.addEventListener('blur', close);
  open = { root: menus[0]!, close };
}
