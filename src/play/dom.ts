/** A tiny element builder for the menus: `h('button', 'cls', 'text')`, with optional attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string | null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  for (const c of children) if (c) e.append(c);
  if (e instanceof HTMLButtonElement) e.type = 'button';
  return e;
}

/** A button that runs `onClick`. */
export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', className, text);
  b.addEventListener('click', onClick);
  return b;
}

/** A `<select>` over `options` (value, label), calling `onPick` with the new value. */
export function select(label: string, options: readonly (readonly [string, string])[], value: string, onPick: (v: string) => void): HTMLSelectElement {
  const s = h('select');
  s.setAttribute('aria-label', label);
  for (const [v, text] of options) s.append(new Option(text, v, false, v === value));
  s.addEventListener('change', () => onPick(s.value));
  return s;
}

export const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** A picture drawn by the thumbnail page (`#/thumbs`), under public/thumbs/. */
export function thumb(folder: 'arenas' | 'bodies' | 'weapons', name: string): string {
  return `${import.meta.env.BASE_URL}thumbs/${folder}/${name}.webp`;
}

/** An `<img>` of a thumbnail that removes itself if the picture is missing. */
export function thumbImage(className: string, folder: 'arenas' | 'bodies' | 'weapons', name: string, alt = ''): HTMLImageElement {
  const img = h('img', className);
  img.src = thumb(folder, name);
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('error', () => img.remove());
  return img;
}

/** A Weapon's thumbnail name: its name in kebab case, like its Tuning Data file. */
export function weaponThumb(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
