/**
 * The icons of the dungeon screens (map, inventory, HUD): one per Hall kind, per Relic icon id (data/relics.json) and
 * per Weapon of the roster. Inline SVG strings on a 32x32 box, bold flat shapes that read at 24 px and at 64 px: no
 * image files, no fetch. The DOM sets one as `innerHTML`; a three.js sprite takes `iconTexture`. Render-only
 * (ADR 0001). A new Relic icon id or Weapon in the Tuning Data needs an entry here: the test names the missing one.
 */
import * as THREE from 'three';
import type { HallKind } from '../tuning';

/** The Hall kinds, in the order the map lists them. */
export const HALL_KINDS: readonly HallKind[] = ['Fight', 'Elite', 'Treasure', 'Rest', 'Boss'];

const INK = '#1b1410';
const STEEL = '#c9d1d9';
const GOLD = '#f2b632';
const RED = '#d6453d';
const GREEN = '#58b368';
const BROWN = '#8a5a35';
const BLUE = '#4f8fd6';
const BONE = '#ece3cf';

/** Wrap shapes in the shared box. Shapes outline in ink so they hold on any background. */
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const path = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A straight blade from the grip (x, 26) up to the tip, with a guard. */
const sword = (x: number, half: number, tip: number) =>
  path(`M${x - half} 22 V${tip + 4} L${x} ${tip} L${x + half} ${tip + 4} V22 Z`, STEEL) +
  rect(x - 5, 22, 10, 2.5, GOLD) +
  rect(x - 1.5, 24.5, 3, 5, BROWN);

const HALLS: Readonly<Record<HallKind, string>> = {
  // Crossed swords.
  Fight: svg(
    path('M6 4 L9 4 L26 22 L24 24 Z', STEEL) +
      path('M26 4 L23 4 L6 22 L8 24 Z', STEEL) +
      rect(4, 22, 7, 3, GOLD) + rect(21, 22, 7, 3, GOLD),
  ),
  // A horned skull.
  Elite: svg(
    path('M5 5 Q4 12 9 14 L10 10 Z', BONE) +
      path('M27 5 Q28 12 23 14 L22 10 Z', BONE) +
      path('M16 8 C9 8 7 13 8 18 L10 21 V26 H22 V21 L24 18 C25 13 23 8 16 8 Z', BONE) +
      circle(12.5, 17, 2.4, INK) + circle(19.5, 17, 2.4, INK) +
      path('M14 22 H18', INK),
  ),
  // A chest.
  Treasure: svg(
    path('M4 14 Q4 6 16 6 Q28 6 28 14 Z', BROWN) +
      rect(4, 14, 24, 13, BROWN) +
      rect(4, 13, 24, 3, GOLD) +
      rect(13.5, 15, 5, 6, GOLD),
  ),
  // A campfire.
  Rest: svg(
    path('M16 3 C20 9 25 12 24 19 C23 24 20 26 16 26 C12 26 8 24 8 19 C8 14 13 12 16 3 Z', RED) +
      path('M16 14 C18 17 20 18 19 21 C18 23 17 24 16 24 C14 24 13 22 13 20 C13 18 15 17 16 14 Z', GOLD) +
      path('M5 29 L27 25 M5 25 L27 29', BROWN, 'stroke-width="3"'),
  ),
  // A crown.
  Boss: svg(
    path('M4 24 L3 9 L10 16 L16 6 L22 16 L29 9 L28 24 Z', GOLD) +
      rect(4, 24, 24, 4, GOLD) +
      circle(16, 18, 2, RED) + circle(9.5, 20, 1.4, BLUE) + circle(22.5, 20, 1.4, BLUE),
  ),
};

const RELICS: Readonly<Record<string, string>> = {
  // A whetstone with a spark of edge.
  whetstone: svg(path('M4 20 L22 8 L28 14 L10 26 Z', '#7d8590') + path('M6 21 L22 10 L24 12 L8 23 Z', STEEL) + path('M24 4 V9 M21.5 6.5 H26.5', GOLD, 'stroke-width="2"')),
  // A mailed fist.
  gauntlet: svg(
    rect(9, 5, 4, 10, STEEL) + rect(13, 4, 4, 11, STEEL) + rect(17, 5, 4, 10, STEEL) + rect(21, 7, 4, 8, STEEL) +
      path('M9 15 H25 V22 L21 27 H12 L9 22 Z', STEEL) + rect(10, 27, 11, 3, BROWN),
  ),
  // A breastplate.
  plate: svg(path('M6 6 L12 4 Q16 8 20 4 L26 6 L25 17 Q24 25 16 29 Q8 25 7 17 Z', STEEL) + path('M16 8 V26', INK, 'stroke-width="1.2"') + circle(16, 15, 2.5, GOLD)),
  // A round shield with a rim.
  buckler: svg(circle(16, 16, 12, STEEL) + circle(16, 16, 8, BLUE) + circle(16, 16, 3, GOLD)),
  // A heart charm on a cord.
  charm: svg(path('M10 3 Q16 8 22 3', 'none', 'stroke-width="2"') + path('M16 28 C4 19 6 9 12 9 C14.5 9 16 11 16 12 C16 11 17.5 9 20 9 C26 9 28 19 16 28 Z', RED)),
  // A strap of three daggers.
  bandolier: svg(
    path('M3 8 L29 24 L26 28 L0 12 Z', BROWN, 'transform="translate(2 -1)"') +
      path('M9 8 L11 8 L12 16 L10 18 L8 16 Z', STEEL) + path('M15 12 L17 12 L18 20 L16 22 L14 20 Z', STEEL) + path('M21 16 L23 16 L24 24 L22 26 L20 24 Z', STEEL),
  ),
  // A single dagger, pointing up.
  dagger: svg(path('M16 3 L20 17 H12 Z', STEEL) + rect(9, 17, 14, 3, GOLD) + rect(14.5, 20, 3, 8, BROWN) + circle(16, 29, 1.6, GOLD)),
  // A boot.
  boots: svg(path('M9 4 H18 V16 L27 20 Q29 22 28 26 H8 Q6 26 6 23 V4 Z', BROWN) + rect(6, 4, 12, 4, STEEL) + rect(6, 26, 22, 3, INK)),
  // A fang.
  fang: svg(path('M7 5 H25 Q26 14 17 28 Q16 29 15 28 Q6 14 7 5 Z', BONE) + path('M12 7 Q13 14 16 22', 'none', 'stroke-width="2"')),
  // A laurel wreath.
  wreath: svg(
    path('M16 27 C6 24 4 14 8 5 C8 14 11 20 16 22 Z', GREEN) + path('M16 27 C26 24 28 14 24 5 C24 14 21 20 16 22 Z', GREEN) +
      circle(16, 25, 2.2, RED),
  ),
  // A cannon.
  cannon: svg(path('M3 11 L22 9 L25 18 L5 20 Z', '#5d6670') + rect(23, 9, 4, 10, '#7d8590') + circle(10, 25, 4, BROWN) + circle(23, 25, 4, BROWN) + path('M26 7 L30 3 M27 11 L31 11', GOLD, 'stroke-width="2"')),
  // A horned berserker mask.
  mask: svg(
    path('M4 4 Q5 10 10 11 Z', BONE) + path('M28 4 Q27 10 22 11 Z', BONE) +
      path('M8 9 H24 V19 Q24 27 16 29 Q8 27 8 19 Z', RED) + path('M10 15 L14 17 M22 15 L18 17', INK, 'stroke-width="2.4"') + path('M12 24 H20', INK, 'stroke-width="2"'),
  ),
};

/** The generic Relic icon: a gem, for an icon id with no drawing of its own. */
const GENERIC_RELIC = svg(path('M8 6 H24 L29 13 L16 28 L3 13 Z', BLUE) + path('M3 13 H29 M12 6 L16 13 L20 6 M16 13 V28', 'none', 'stroke-width="1.2"'));

const WEAPONS: Readonly<Record<string, string>> = {
  'Arming Sword': svg(sword(16, 3, 3)),
  // A broader, longer blade with a long grip.
  Longsword: svg(path('M14 20 V6 L16 2 L18 6 V20 Z', STEEL) + rect(8, 20, 16, 2.5, GOLD) + rect(14.5, 22.5, 3, 7, BROWN) + circle(16, 30, 1.2, GOLD)),
  // A pole with an axe blade and a spike.
  Halberd: svg(
    path('M15 6 H17 V30 H15 Z', BROWN) + path('M16 1 L18.5 7 H13.5 Z', STEEL) +
      path('M17 8 Q27 8 27 16 Q22 14 17 15 Z', STEEL) + path('M15 10 L9 13 L15 15 Z', STEEL),
  ),
  // A long haft with a heavy square head.
  'Sledge Hammer': svg(rect(14.5, 10, 3, 20, BROWN) + rect(5, 3, 22, 9, '#7d8590') + rect(5, 3, 4, 9, STEEL) + rect(23, 3, 4, 9, STEEL)),
};

/** The generic Weapon icon: a plain blade, for a Weapon with no drawing of its own. */
const GENERIC_WEAPON = svg(path('M13 22 L13 8 L18 3 L19 22 Z', '#7d8590') + rect(8, 22, 16, 2.5, GOLD) + rect(14.5, 24.5, 3, 5, BROWN));

/** The SVG of a Hall kind. */
export function hallIcon(kind: HallKind): string {
  return HALLS[kind];
}

/** The SVG of a Relic icon id (data/relics.json); an unknown id gets the generic Relic icon. */
export function relicIcon(id: string): string {
  return Object.hasOwn(RELICS, id) ? RELICS[id]! : GENERIC_RELIC;
}

/** The SVG of a Weapon of the roster, by name; an unknown name gets the generic Weapon icon. */
export function weaponIcon(name: string): string {
  return Object.hasOwn(WEAPONS, name) ? WEAPONS[name]! : GENERIC_WEAPON;
}

const textures = new Map<string, THREE.CanvasTexture>();

/**
 * A `px` x `px` canvas texture of `svg`, for a three.js sprite. Cached by SVG and size, so a sprite per Hall or pickup
 * shares one. The texture is blank until the browser has decoded the SVG, then flags itself for upload; with no DOM
 * (node tests) it stays blank.
 */
export function iconTexture(svgText: string, px: number): THREE.CanvasTexture {
  const key = `${px}|${svgText}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const canvas = typeof document === 'undefined' ? ({ width: px, height: px } as HTMLCanvasElement) : document.createElement('canvas');
  canvas.width = canvas.height = px;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, texture);
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      canvas.getContext('2d')?.drawImage(img, 0, 0, px, px);
      texture.needsUpdate = true;
    };
    // The viewBox alone gives no intrinsic size to some browsers, so state the pixel size on the root.
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText.replace('width="100%" height="100%"', `width="${px}" height="${px}"`))}`;
  }
  return texture;
}
