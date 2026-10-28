import { FLOOR_MAP_CSS } from './floorMapView';
import { MENU_CSS } from './menuStyles';

const CSS = `
.hud, .menu { position: fixed; inset: 0; font-family: system-ui, sans-serif; color: #fff; }
.hud { pointer-events: none; }
.hud[hidden], .menu[hidden] { display: none; }
.hud-stats { position: absolute; top: 0.3rem; right: 0.5rem; font-size: 0.65rem; opacity: 0.7; text-shadow: 0 1px 2px #000a; font-variant-numeric: tabular-nums; }
.hud-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.8rem 1rem; }
.hud-team { flex: 1; max-width: 22rem; display: flex; flex-direction: column; gap: 0.3rem; }
.hud-fighter { transition: opacity 300ms; }
.hud-fighter.fallen { opacity: 0.35; }
.hud-fighter:not(.hud-you) .hud-bar { height: 0.7rem; }
.hud-label { font-size: 0.7rem; opacity: 0.85; text-shadow: 0 1px 2px #000a; margin-bottom: 0.1rem; }
.hud-you .hud-label { font-weight: 700; opacity: 1; }
.hud-side-1 { text-align: right; }
.hud-bar { position: relative; height: 1.1rem; background: #0006; border: 2px solid #fffc; border-radius: 4px; overflow: hidden; }
.hud-side-1 .hud-bar { transform: scaleX(-1); }
.hud-fill { height: 100%; width: 100%; transition: width 120ms linear; }
.hud-hp { position: absolute; inset: 0; font-size: 0.75rem; line-height: 1.1rem; text-align: center; text-shadow: 0 1px 2px #000a; }
.hud-fighter:not(.hud-you) .hud-hp { display: none; }
.hud-side-1 .hud-hp { transform: scaleX(-1); }
.hud-daggers { display: flex; align-items: center; gap: 0.25rem; margin-top: 0.3rem; height: 1.1rem; }
.hud-dagger { width: 0.4rem; height: 1rem; background: linear-gradient(#e8ecf0, #9aa4ae); clip-path: polygon(50% 0, 100% 70%, 100% 100%, 0 100%, 0 70%); transition: opacity 150ms; }
.hud-dagger.spent { opacity: 0.2; }
.hud-slow { margin-left: 0.5rem; font-size: 0.7rem; font-weight: 700; color: #ffb060; text-shadow: 0 1px 2px #000a; opacity: 0; transition: opacity 150ms; }
.hud-slow.visible { opacity: 1; }
.hud-centre { text-align: center; text-shadow: 0 1px 3px #000a; min-width: 7rem; }
.hud-score { font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.hud-banner { position: absolute; top: 30%; left: 0; right: 0; text-align: center; font-size: 2.2rem; font-weight: 700;
  text-shadow: 0 2px 6px #000a; opacity: 0; transition: opacity 250ms; }
.hud-banner.visible { opacity: 1; }
.hud-results { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); min-width: 16rem; padding: 1.2rem 1.6rem;
  background: #000b; border: 1px solid #fff4; border-radius: 12px; text-align: center; text-shadow: 0 1px 2px #000a; }
.hud-results[hidden] { display: none; }
.hud-results-title { font-size: 2.4rem; font-weight: 800; margin-bottom: 0.6rem; }
.hud-results-title.victory { color: #ffd56a; }
.hud-results-title.defeat { color: #ff7a6a; }
.hud-results-row { display: flex; justify-content: space-between; gap: 2rem; font-size: 1rem; padding: 0.15rem 0; }
.hud-results-row b { font-variant-numeric: tabular-nums; }
.hud-results-note { margin: 0.8rem 0 0; font-size: 0.9rem; opacity: 0.85; max-width: 18rem; }
.hud-menu { pointer-events: auto; position: absolute; left: 50%; bottom: max(0.8rem, env(safe-area-inset-bottom)); transform: translateX(-50%);
  width: 2.4rem; height: 2.4rem; border-radius: 50%; font-size: 1.1rem; color: #fff; background: #0007; border: 1px solid #fff6; cursor: pointer; opacity: 0.75; }
.hud-menu:hover { opacity: 1; }
@media (pointer: fine) { .hud-menu { top: 0.6rem; bottom: auto; left: auto; right: 0.6rem; transform: none; width: 2rem; height: 2rem; font-size: 0.95rem; } .hud-stats { right: 3rem; } }
.hud-crosshair { position: absolute; top: 50%; left: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%;
  background: #fffe; box-shadow: 0 0 0 1px #0008; }
.hud-letterbox { position: absolute; left: 0; right: 0; height: 11vh; background: #000; transform: scaleY(0); transition: transform 350ms ease-out; }
.hud-letterbox-0 { top: 0; transform-origin: top; }
.hud-letterbox-1 { bottom: 0; transform-origin: bottom; }
.hud-cinematic .hud-letterbox { transform: scaleY(1); }
.hud-top, .hud-crosshair { transition: opacity 250ms; }
.hud-cinematic .hud-top, .hud-cinematic .hud-crosshair { opacity: 0; }
.hud-fade { position: absolute; inset: 0; background: #000; opacity: 0; }
.hud-doors { position: absolute; inset: 0; overflow: hidden; transition: opacity 250ms; }
.hud-cinematic .hud-doors { opacity: 0; }
.hud-door { position: absolute; left: 0; top: 0; padding: 0.15rem 0.5rem; border-radius: 6px; white-space: nowrap; font-size: 0.85rem;
  font-weight: 700; background: #0008; border: 1px solid #fff4; text-shadow: 0 1px 2px #000a; opacity: 0.55; }
.hud-door.open { opacity: 1; border-color: #ffd56acc; }
.hud-door[hidden] { display: none; }
.hud-pickup { opacity: 1; border-color: #9fd0ffcc; }
.hud-pickup.relic { border-color: #ffb0f0cc; }
.hud-inventory { position: absolute; left: 0.8rem; bottom: 0.8rem; margin: 0; padding: 0.5rem 0.7rem; border-radius: 6px; font: 0.8rem/1.35 ui-monospace, monospace;
  background: #000a; border: 1px solid #fff4; color: #fff; white-space: pre-wrap; max-width: 28rem; }
.hud-inventory[hidden] { display: none; }
.touch { position: fixed; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  font-family: system-ui, sans-serif; color: #fff; --pad: clamp(84px, 24vmin, 132px); --edge: max(18px, env(safe-area-inset-right));
  --base: max(18px, env(safe-area-inset-bottom)); }
.touch[hidden] { display: none; }
.touch-stick { position: absolute; width: 112px; height: 112px; margin: -56px 0 0 -56px; border-radius: 50%;
  left: calc(max(18px, env(safe-area-inset-left)) + 56px); top: calc(100% - var(--base) - 56px);
  background: #ffffff14; border: 2px solid #ffffff40; opacity: 0.6; pointer-events: none; }
.touch-stick.active { opacity: 1; }
.touch-stick-knob { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%;
  background: #ffffff70; }
.touch-pad { position: absolute; width: var(--pad); height: var(--pad); border-radius: 50%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; border: 2px solid #ffffff60; text-shadow: 0 1px 2px #000a; }
.touch-pad-arrow { font-size: 1.6rem; line-height: 1; min-height: 1.6rem; }
.touch-pad-label { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.9; }
.touch-attack { right: var(--edge); bottom: var(--base); background: #c0392b88; }
.touch-block { right: calc(var(--edge) + var(--pad) * 0.95); bottom: calc(var(--base) + var(--pad) * 0.85);
  width: calc(var(--pad) * 0.78); height: calc(var(--pad) * 0.78); background: #2e86c188; }
.touch-jump { right: calc(var(--edge) + var(--pad) * 1.15); bottom: var(--base);
  width: calc(var(--pad) * 0.62); height: calc(var(--pad) * 0.62); background: #8e8e3a88; }
.touch-throw { right: calc(var(--edge) + var(--pad) * 1.15); bottom: calc(var(--base) + var(--pad) * 0.62 + 14px);
  width: calc(var(--pad) * 0.62); height: calc(var(--pad) * 0.62); background: #7a5ea888; }
.touch-sheathe { right: calc(var(--edge) + var(--pad) * 1.15 + var(--pad) * 0.62 + 14px); bottom: var(--base);
  width: calc(var(--pad) * 0.62); height: calc(var(--pad) * 0.62); background: #3a7a6a88; }
.touch-sheathe .touch-pad-label { font-size: 0.66rem; letter-spacing: 0.02em; }
.touch-pad.active { border-color: #fff; filter: brightness(1.35); }
@media (orientation: portrait) {
  .touch { --pad: clamp(84px, 27vw, 128px); }
  .touch-block { right: var(--edge); bottom: calc(var(--base) + var(--pad) + 16px); }
  .touch-jump { right: calc(var(--edge) + var(--pad) + 16px); bottom: var(--base); }
  .touch-throw { right: calc(var(--edge) + var(--pad) + 16px); bottom: calc(var(--base) + var(--pad) * 0.62 + 14px); }
  .touch-sheathe { right: calc(var(--edge) + var(--pad) + 16px); bottom: calc(var(--base) + var(--pad) * 1.24 + 28px); }
}
`;

let injected = false;

/** Add the HUD and menu styles to the page once. */
export function ensurePlayStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = CSS + MENU_CSS + FLOOR_MAP_CSS;
  document.head.append(style);
}
