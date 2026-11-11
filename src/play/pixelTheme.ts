/**
 * The old-school pixel look shared by every screen drawn over the 3D scene (HUD, menus, Lobby, dungeon screens).
 * The scene is always drawn at PlayStation resolution, so the UI is flat colour, hard 1-pixel-unit edges, a bitmap font
 * and a small palette: no rounded corners, gradients, blur or glow. Render-only (ADR 0001).
 *
 * `--px` is the UI's pixel: every border and shadow is a whole number of them. The two fonts are OFL bitmap-style faces
 * (licences beside the files): Silkscreen for titles and labels, VT323 for text.
 */
import silkscreen400 from './fonts/silkscreen-latin-400-normal.woff2?url';
import silkscreen700 from './fonts/silkscreen-latin-700-normal.woff2?url';
import vt323 from './fonts/vt323-latin-400-normal.woff2?url';

export const PIXEL_CSS = `
@font-face { font-family: 'Silkscreen'; font-weight: 400; font-display: swap; src: url(${silkscreen400}) format('woff2'); }
@font-face { font-family: 'Silkscreen'; font-weight: 700; font-display: swap; src: url(${silkscreen700}) format('woff2'); }
@font-face { font-family: 'VT323'; font-weight: 400; font-display: swap; src: url(${vt323}) format('woff2'); }
:root { --px: 2px; --font-body: 'VT323', ui-monospace, monospace; --font-display: 'Silkscreen', 'VT323', ui-monospace, monospace; }
@media (min-height: 800px) { :root { --px: 3px; } }
.hud, .menu, .touch, .loading-bar, .inv-panel, .floor-map {
  font-family: var(--font-body); -webkit-font-smoothing: none; font-smooth: never; letter-spacing: 0.02em;
  --ink: #0d0a14; --panel: #1b1626; --panel-2: #271f36; --line: #4b3f63; --line-2: #6d5f8c; --text: #f3e6c8; --muted: #a79d8c;
  --gold: #f2b632; --gold-2: #ffd56a; --red: #d6453d; --green: #58b368; --blue: #4f8fd6; }
.hud img, .menu img, .inv-panel img, .floor-map img, .hud canvas, .menu canvas { image-rendering: pixelated; }
.hud svg, .menu svg, .inv-panel svg, .floor-map svg { shape-rendering: crispEdges; }
.hud button, .menu button, .touch button, .inv-panel button { font-family: var(--font-body); }
`;
