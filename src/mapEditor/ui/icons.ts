/**
 * The Map Editor's pictures, for picking by eye rather than by name: an icon for each tool (drawn as the top view draws that kind of Brush or
 * marker), a mark for each prop kind (as the top view marks it), and a swatch for each material and hazard (the game's own texture of the
 * material's Surface, tinted as the map model is drawn: the texture divided by its average and multiplied by the material's colour, as
 * `applyTriplanar` shades it; a flat material, metal or glow, its colour). All are image URLs, for an `<img>` or a menu's `icon`.
 *
 * The swatches need the textures: until `loadSwatches` has read them, a material's swatch is its flat colour.
 */
import { surfaceOf } from '../../render/triplanar';
import { HAZARD_LOOKS, MATERIAL_LOOKS, type MaterialLook } from '../look';
import { MAP_MATERIALS, type HazardKind, type MapMaterial, type PropKind } from '../source';
import type { Tool } from './topView';

/** How a prop is marked in the top view (and its icon): its colour and a letter. */
export const PROP_MARKS: Readonly<Record<PropKind, { readonly colour: string; readonly letter: string }>> = {
  tree: { colour: '#3f9a3a', letter: 'T' },
  rubble: { colour: '#9a948a', letter: 'R' },
  banner: { colour: '#d04a4a', letter: 'B' },
  crate: { colour: '#b0844c', letter: 'C' },
  torch: { colour: '#ff9a30', letter: 'F' },
};

const svgUrl = (body: string, size = 20): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">${body}</svg>`)}`;

/** The level colours the top view draws Brushes in (the lowest, the next). */
const LOW = '#4f7fbf';
const HIGH = '#5fa05a';
const EDGE = 'stroke="rgba(0,0,0,0.6)"';

/** Each tool's icon (20 × 20), drawn as the top view draws what it makes. */
export const TOOL_ICONS: Readonly<Record<Tool, string>> = {
  select: svgUrl('<path d="M5 3 L5 16 L8.5 12.5 L11 18 L13 17 L10.5 11.5 L15 11.5 Z" fill="#eee" stroke="#111" stroke-width="1"/>'),
  floor: svgUrl(`<rect x="3" y="3" width="14" height="14" fill="${LOW}" ${EDGE}/>`),
  deck: svgUrl(
    `<defs><clipPath id="c"><rect x="3" y="3" width="14" height="14"/></clipPath></defs><rect x="3" y="3" width="14" height="14" fill="${HIGH}"/><g clip-path="url(#c)" stroke="rgba(0,0,0,0.5)" stroke-width="1"><path d="M-3 17 L11 3 M2 17 L16 3 M7 17 L21 3 M12 17 L26 3"/></g><rect x="3" y="3" width="14" height="14" fill="none" stroke="rgba(0,0,0,0.6)" stroke-dasharray="3 2"/>`,
  ),
  platform: svgUrl(`<rect x="4" y="4" width="12" height="12" fill="${HIGH}" stroke="rgba(0,0,0,0.75)" stroke-width="2.5"/>`),
  ramp: svgUrl(`<rect x="5" y="2" width="10" height="16" fill="${HIGH}" ${EDGE}/><path d="M7 9 L10 6 L13 9 M7 14 L10 11 L13 14" fill="none" stroke="rgba(0,0,0,0.7)" stroke-width="1.6"/><path d="M5 2 V18 M15 2 V18" stroke="#ddd" stroke-width="1.6"/>`),
  hole: svgUrl('<rect x="3" y="3" width="14" height="14" fill="#16161a" stroke="#888" stroke-dasharray="3 2"/><path d="M3 3 L17 17 M17 3 L3 17" stroke="#666" stroke-width="1"/>'),
  hazard: svgUrl('<rect x="3" y="3" width="14" height="14" fill="#ff5a1f" stroke="rgba(0,0,0,0.6)"/><path d="M4 12 Q7 9 10 12 T16 12" fill="none" stroke="#ffd04a" stroke-width="1.5"/>'),
  rail: svgUrl(`<path d="M3 15 L17 5" stroke="${LOW}" stroke-width="3" stroke-linecap="round"/>`),
  wall: svgUrl('<path d="M3 15 L17 5" stroke="#e8e8e8" stroke-width="4.5" stroke-linecap="round"/>'),
  block: svgUrl('<rect x="3" y="3" width="14" height="14" fill="#8a8a8a" stroke="rgba(0,0,0,0.7)" stroke-width="2"/><path d="M3 3 L17 17 M17 3 L3 17" stroke="rgba(0,0,0,0.45)"/>'),
  enclosure: svgUrl(`<rect x="3" y="3" width="14" height="14" fill="${LOW}"/><path d="M3 3 H7.5 M12.5 3 H17 V7.5 M17 12.5 V17 H12.5 M7.5 17 H3 V12.5 M3 7.5 V3" fill="none" stroke="#e8e8e8" stroke-width="2.5"/>`),
  objective: svgUrl('<circle cx="10" cy="10" r="7.5" fill="#eee" stroke="#e0c040" stroke-width="2"/><text x="10" y="13.5" font-family="system-ui,sans-serif" font-size="10" font-weight="700" text-anchor="middle" fill="#111">A</text>'),
  prop: svgUrl('<circle cx="10" cy="10" r="7" fill="#3f9a3a" stroke="#111"/><text x="10" y="13.5" font-family="system-ui,sans-serif" font-size="9" font-weight="700" text-anchor="middle" fill="#111">T</text>'),
};

/** Each prop kind's icon: its top-view mark. */
export const PROP_ICONS: Readonly<Record<PropKind, string>> = Object.fromEntries(
  Object.entries(PROP_MARKS).map(([k, m]) => [
    k,
    svgUrl(`<circle cx="10" cy="10" r="7.5" fill="${m.colour}" stroke="#111"/><text x="10" y="13.5" font-family="system-ui,sans-serif" font-size="9" font-weight="700" text-anchor="middle" fill="#111">${m.letter}</text>`),
  ]),
) as Record<PropKind, string>;

// --- Material and hazard swatches -------------------------------------------
const SWATCH_PX = 48;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** A flat swatch of `look`: its colour, a glowing one brighter in the middle. */
function flatSwatch(look: MaterialLook): string {
  const c = document.createElement('canvas');
  c.width = c.height = SWATCH_PX;
  const g = c.getContext('2d')!;
  if (look.emissive) {
    const grad = g.createRadialGradient(SWATCH_PX / 2, SWATCH_PX / 2, 2, SWATCH_PX / 2, SWATCH_PX / 2, SWATCH_PX * 0.7);
    grad.addColorStop(0, '#ffd27a');
    grad.addColorStop(1, hex(look.colour));
    g.fillStyle = grad;
  } else g.fillStyle = hex(look.colour);
  g.fillRect(0, 0, SWATCH_PX, SWATCH_PX);
  if (look.name === 'Map_Metal') {
    // A sheen across it, so metal does not read as plain grey paint.
    const grad = g.createLinearGradient(0, 0, SWATCH_PX, SWATCH_PX);
    grad.addColorStop(0, 'rgba(255,255,255,0.25)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = grad;
    g.fillRect(0, 0, SWATCH_PX, SWATCH_PX);
  }
  return c.toDataURL();
}

/** `image` (a Surface's texture) tinted as the model draws it in `colour`: each texel over the texture's average, times the colour, in linear light. */
function texturedSwatch(image: HTMLImageElement, colour: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = SWATCH_PX;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(image, 0, 0, SWATCH_PX, SWATCH_PX);
  const data = g.getImageData(0, 0, SWATCH_PX, SWATCH_PX);
  const px = data.data;
  const mean = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) mean[k]! += toLinear(px[i + k]! / 255);
  const n = px.length / 4;
  const tint = [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255].map((v) => toLinear(v / 255));
  for (let i = 0; i < px.length; i += 4)
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(255 * toSrgb(Math.min(1, (toLinear(px[i + k]! / 255) / Math.max(0.02, mean[k]! / n)) * tint[k]!)));
  g.putImageData(data, 0, 0);
  return c.toDataURL();
}

const swatches = new Map<string, string>();
let loading: Promise<void> | null = null;

/** The swatch of a material: its tinted texture once `loadSwatches` has read it, else its flat colour. */
export function materialSwatch(m: MapMaterial): string {
  const key = `m:${m}`;
  let s = swatches.get(key);
  if (!s) swatches.set(key, (s = flatSwatch(MATERIAL_LOOKS[m])));
  return s;
}

/** The swatch of a hazard: its flat colour (lava glowing). */
export function hazardSwatch(h: HazardKind): string {
  const key = `h:${h}`;
  let s = swatches.get(key);
  if (!s) swatches.set(key, (s = flatSwatch(HAZARD_LOOKS[h])));
  return s;
}

/** Read the textures the materials use and make their swatches (once; a texture that fails leaves its material flat). */
export function loadSwatches(): Promise<void> {
  loading ??= Promise.all(
    MAP_MATERIALS.map(async (m) => {
      const look = MATERIAL_LOOKS[m];
      const surface = surfaceOf(look.name);
      if (!surface) return;
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}textures/battle/${surface}.png`;
      try {
        await image.decode();
        swatches.set(`m:${m}`, texturedSwatch(image, look.colour));
      } catch {
        // Left flat.
      }
    }),
  ).then(() => undefined);
  return loading;
}

/**
 * A grid of pictures to pick one of (a material, a prop kind…): each a picture over its name, the chosen one ringed. `set` rings another;
 * `refresh` redraws the pictures (the swatches once the textures are read).
 */
export interface PictureGrid {
  readonly element: HTMLElement;
  set(value: string): void;
  refresh(): void;
}

export function pictureGrid(options: readonly { readonly value: string; readonly label: string; readonly picture: () => string; readonly title?: string }[], current: string, pick: (value: string) => void, px = 38): PictureGrid {
  const element = document.createElement('div');
  element.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${px + 8}px,1fr));gap:4px;padding:4px 8px 8px`;
  const cells = options.map((o) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.title = o.title ?? o.label;
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px 0 2px;background:#262a32;border:2px solid transparent;border-radius:4px;cursor:pointer;color:#ccc;font:10px/1.1 system-ui,sans-serif';
    const img = document.createElement('img');
    img.width = img.height = px;
    img.style.cssText = 'image-rendering:pixelated;border-radius:3px;display:block';
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = o.label;
    name.style.cssText = `max-width:${px + 6}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
    cell.append(img, name);
    cell.addEventListener('mousedown', (e) => e.preventDefault());
    cell.addEventListener('click', () => pick(o.value));
    element.appendChild(cell);
    return { o, cell, img };
  });
  const grid: PictureGrid = {
    element,
    set(value) {
      for (const c of cells) c.cell.style.borderColor = c.o.value === value ? '#ffe14d' : 'transparent';
    },
    refresh() {
      for (const c of cells) c.img.src = c.o.picture();
    },
  };
  grid.refresh();
  grid.set(current);
  return grid;
}
