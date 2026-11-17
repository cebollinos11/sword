/**
 * The look of the Delver maps (the minimap and the Floor Map, issue #162): a plan inked on parchment, as low-resolution pixel art like the
 * rest of the game. Each map is painted on a small canvas, one map pixel to one of the game's pixels (`--px`), and shown scaled up with
 * `image-rendering: pixelated`: flat colours, dithered shading, a 1-pixel ink line and a bitmap font, so nothing is smoothed. Render only.
 */

/** The paper's shades, lightest (its middle) to darkest (its browned edge), dithered into one another. */
const PAPER_SHADES = ['#efe0b4', '#e2cc98', '#d4b77f', '#c09c64'] as const;
/** The paper colour a label's halo is drawn in. */
export const PAPER = PAPER_SHADES[0];
/** A fleck on the paper. */
const FLECK = '#a8844f';
/** The ink the plan, the labels and the outlines are drawn in, and the paler ink of a spent or sealed place. */
export const INK = '#3e2614';
export const INK_FADED = '#9a7a52';
/** A Passage's floor, and an unexplored doorway's stub (which dithers away from it into the paper). */
export const PASSAGE = '#d8c08a';
/** A Hall's floor, washed by its kind. */
const HALL: Readonly<Record<string, string>> = {
  default: '#dec692',
  rest: '#e2b07c',
  treasure: '#e8cf6c',
  boss: '#d8907c',
  stairs: '#b4bea0',
  entrance: '#bfc890',
};
/** The local Player's arrow, the party's, and an enemy's dot. */
export const ME = '#c42a1c';
export const ALLY = '#2a6ea8';
export const ENEMY = '#7a1410';

export function hallColour(kind: string | undefined): string {
  return HALL[(kind ?? '').toLowerCase()] ?? HALL.default!;
}

/** The 4 × 4 ordered-dither threshold of pixel (x, y), in 0 to 1. */
export function bayer(x: number, y: number): number {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
}

/** A fixed hash of pixel (x, y) in 0 to 1, so the paper's flecks are the same every frame. */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const papers = new Map<number, HTMLCanvasElement>();

/** A sheet of parchment `n` pixels square, made once per size: lightest in the middle, browning in dithered steps to its edge, flecked. */
export function paperSheet(n: number): HTMLCanvasElement {
  const made = papers.get(n);
  if (made) return made;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const rgb = PAPER_SHADES.map((s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)));
  const fleck = [1, 3, 5].map((i) => parseInt(FLECK.slice(i, i + 2), 16));
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      // Distance from the middle, squarish so the corners brown most; a little noise so the bands' edges wander.
      const d = Math.min(1, Math.max(0, (Math.hypot(dx, dy) * 2 - 0.35) / 0.95 + (hash(x >> 2, y >> 2) - 0.5) * 0.25));
      const shade = Math.min(PAPER_SHADES.length - 1, Math.floor(d * (PAPER_SHADES.length - 1) + bayer(x, y)));
      const col = hash(x, y) < 0.012 ? fleck : rgb[shade]!;
      const o = (y * n + x) * 4;
      img.data[o] = col[0]!;
      img.data[o + 1] = col[1]!;
      img.data[o + 2] = col[2]!;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // A double ink frame: a line round the edge and a thinner-looking dotted one inside it.
  g.fillStyle = INK;
  g.fillRect(0, 0, n, 1);
  g.fillRect(0, n - 1, n, 1);
  g.fillRect(0, 0, 1, n);
  g.fillRect(n - 1, 0, 1, n);
  for (let k = 2; k < n - 2; k += 2) {
    g.fillRect(k, 2, 1, 1);
    g.fillRect(k, n - 3, 1, 1);
    g.fillRect(2, k, 1, 1);
    g.fillRect(n - 3, k, 1, 1);
  }
  papers.set(n, c);
  return c;
}

/** A rect in map pixels, corners in any order. */
export interface PixelRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** `r` snapped to whole pixels, as x, y, width and height (at least a pixel each way). */
function snap(r: PixelRect): [number, number, number, number] {
  const x = Math.round(Math.min(r.x0, r.x1));
  const y = Math.round(Math.min(r.y0, r.y1));
  return [x, y, Math.max(1, Math.round(Math.max(r.x0, r.x1)) - x), Math.max(1, Math.round(Math.max(r.y0, r.y1)) - y)];
}

/**
 * The plan: every Passage and Hall rect outlined in a 1-pixel ink line round its outside, then all filled, Passages first, so where shapes touch
 * (a Passage at its doorway, a shaped Hall's bands) the fills cover the line between them and the plan has one outline, on its outside.
 */
export function paintPlan(g: CanvasRenderingContext2D, passages: readonly PixelRect[], halls: readonly (PixelRect & { readonly kind?: string })[]): void {
  g.fillStyle = INK;
  for (const r of [...passages, ...halls]) {
    const [x, y, w, h] = snap(r);
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
  }
  g.fillStyle = PASSAGE;
  for (const r of passages) g.fillRect(...snap(r));
  for (const r of halls) {
    g.fillStyle = hallColour(r.kind);
    g.fillRect(...snap(r));
  }
}

/** An unexplored doorway's stub: Passage floor dithered away into the paper from its edge `from` (the side against its Hall). */
export function paintStub(g: CanvasRenderingContext2D, r: PixelRect, from: 'top' | 'bottom' | 'left' | 'right'): void {
  const [x, y, w, h] = snap(r);
  g.fillStyle = PASSAGE;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = from === 'top' ? j / h : from === 'bottom' ? 1 - (j + 1) / h : from === 'left' ? i / w : 1 - (i + 1) / w;
      if (bayer(x + i, y + j) >= t) g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/** A bitmap font, 5 pixels tall: each glyph its rows, '#' inked. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  ' ': ['..', '..', '..', '..', '..'],
};

/** Whether the bitmap font has a glyph for every character of `text` (any case). */
export function canLetter(text: string): boolean {
  return [...text.toUpperCase()].every((ch) => ch in GLYPHS);
}

/** The inked pixels of `text` in the bitmap font (upper-cased; a letter it lacks is skipped), and its width. */
export function textPixels(text: string): { readonly width: number; readonly dots: readonly (readonly [number, number])[] } {
  const dots: [number, number][] = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    const rows = GLYPHS[ch];
    if (!rows) continue;
    rows.forEach((row, y) => [...row].forEach((c, i) => c === '#' && dots.push([x + i, y])));
    x += rows[0]!.length + 1;
  }
  return { width: Math.max(0, x - 1), dots };
}

/**
 * `text` in the bitmap font, `scale` pixels to its pixel, centred on (cx, cy) (`inside`: moved in to lie wholly inside the paper's frame), with a
 * 1-pixel halo of paper round it so it reads across the plan.
 */
export function paintText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, scale: number, colour: string, inside = false): void {
  const { width, dots } = textPixels(text);
  const n = g.canvas.width;
  const w = width * scale;
  const keep = (v: number, size: number) => (inside ? Math.max(5, Math.min(n - 5 - size, v)) : v);
  const x0 = keep(Math.round(cx - w / 2), w);
  const y0 = keep(Math.round(cy - (5 * scale) / 2), 5 * scale);
  g.fillStyle = PAPER;
  for (const [x, y] of dots) g.fillRect(x0 + x * scale - 1, y0 + y * scale - 1, scale + 2, scale + 2);
  g.fillStyle = colour;
  for (const [x, y] of dots) g.fillRect(x0 + x * scale, y0 + y * scale, scale, scale);
}

/**
 * An arrow at (cx, cy) pointing along the unit (dx, dy), `r` pixels from its middle to its tip: every pixel whose middle lies inside it filled,
 * and each pixel beside one of those outlined in `outline`, so its edge is a clean 1-pixel line.
 */
export function paintArrow(g: CanvasRenderingContext2D, cx: number, cy: number, dx: number, dy: number, r: number, fill: string, outline: string): void {
  const pts = [
    [cx + dx * r, cy + dy * r],
    [cx - dx * r * 0.6 - dy * r * 0.6, cy - dy * r * 0.6 + dx * r * 0.6],
    [cx - dx * r * 0.2, cy - dy * r * 0.2],
    [cx - dx * r * 0.6 + dy * r * 0.6, cy - dy * r * 0.6 - dx * r * 0.6],
  ] as const;
  const inside = (x: number, y: number): boolean => {
    let odd = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  const x0 = Math.floor(cx - r) - 2;
  const y0 = Math.floor(cy - r) - 2;
  const n = Math.ceil(r * 2) + 5;
  const fillIn = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) fillIn[j * n + i] = inside(x0 + i + 0.5, y0 + j + 0.5) ? 1 : 0;
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= n || j >= n ? 0 : fillIn[j * n + i]!);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (at(i, j)) g.fillStyle = fill;
      else if (at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1)) g.fillStyle = outline;
      else continue;
      g.fillRect(x0 + i, y0 + j, 1, 1);
    }
  }
}
