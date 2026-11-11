import { BATTLE_HUD_CSS } from './battleHud';
import { PLAYER_TAGS_CSS } from './playerTags';
import { FLOOR_MAP_CSS } from './floorMapView';
import { INVENTORY_CSS } from './inventoryScreen';
import { MENU_CSS } from './menuStyles';
import { PIXEL_CSS } from './pixelTheme';

const CSS = `
.hud, .menu { position: fixed; inset: 0; color: #fff; }
.hud { pointer-events: none; }
.hud[hidden], .menu[hidden] { display: none; }
.hud-stats { position: absolute; top: 0.3rem; right: 0.5rem; font-size: 0.85rem; opacity: 0.7; text-shadow: var(--px) var(--px) 0 #000; font-variant-numeric: tabular-nums; }
.hud-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.8rem 1rem; }
.hud-team { flex: 1; max-width: 22rem; display: flex; flex-direction: column; gap: 0.3rem; }
.hud-fighter { transition: opacity 300ms steps(4, end); }
.hud-fighter.fallen { opacity: 0.35; }
.hud-fighter:not(.hud-you) .hud-bar { height: 0.7rem; }
.hud-label { font-size: 1.4rem; opacity: 0.85; text-shadow: var(--px) var(--px) 0 #000; margin-bottom: 0.1rem; }
.hud-you .hud-label { font-weight: 700; opacity: 1; }
.hud-side-1 { text-align: right; }
.hud-bar { position: relative; height: 1.3rem; background: #0d0a14; border: calc(var(--px) * 2) solid #000; box-shadow: 0 0 0 var(--px) #f3e6c8; overflow: hidden; }
.hud-side-1 .hud-bar { transform: scaleX(-1); }
.hud-fill { height: 100%; width: 100%; transition: width 120ms steps(4, end);
  background-image: repeating-linear-gradient(90deg, transparent 0 calc(var(--px) * 5), #0006 calc(var(--px) * 5) calc(var(--px) * 6)); }
.hud-hp { position: absolute; inset: 0; font-size: 1.1rem; line-height: 1.2rem; text-align: center; text-shadow: var(--px) var(--px) 0 #000; }
.hud-fighter:not(.hud-you) .hud-hp { display: none; }
.hud-side-1 .hud-hp { transform: scaleX(-1); }
.hud-daggers { display: flex; align-items: center; gap: 0.25rem; margin-top: 0.3rem; height: 1.1rem; }
.hud-dagger { width: 0.4rem; height: 1rem; background: #e8ecf0; box-shadow: inset calc(var(--px) * -1) 0 0 #9aa4ae; clip-path: polygon(50% 0, 100% 70%, 100% 100%, 0 100%, 0 70%); }
.hud-dagger.spent { opacity: 0.2; }
.hud-slow { margin-left: 0.5rem; font-size: 0.91rem; font-weight: 700; color: #ffb060; text-shadow: var(--px) var(--px) 0 #000; opacity: 0; transition: opacity 150ms steps(4, end); }
.hud-slow.visible { opacity: 1; }
.hud-centre { text-align: center; text-shadow: var(--px) var(--px) 0 #000; min-width: 7rem; }
.hud-score { font-family: var(--font-display); font-size: clamp(0.9rem, 3.4vw, 1.4rem); white-space: nowrap; font-weight: 700; font-variant-numeric: tabular-nums; }
.hud-banner { position: absolute; top: 30%; left: 0; right: 0; text-align: center; font-family: var(--font-display); font-size: 1.8rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 #000; opacity: 0; transition: opacity 250ms steps(3, end); }
.hud-banner.visible { opacity: 1; }
.hud-bar.refill { box-shadow: 0 0 0 var(--px) #fff; border-color: #fff; }
.hud-bar.refill .hud-fill { transition: none steps(4, end); }
.hud-results { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); min-width: 16rem; padding: 1.2rem 1.6rem;
  background: var(--panel); border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2), calc(var(--px) * 3) calc(var(--px) * 3) 0 #000; text-align: center; }
.hud-results { max-height: 90vh; max-width: 92vw; overflow-y: auto; box-sizing: border-box; }
.hud-results[hidden] { display: none; }
.hud-results-title { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.6rem; }
.hud-results-title.victory { color: #ffd56a; }
.hud-results-title.defeat { color: #ff7a6a; }
.hud-results-row { display: flex; justify-content: space-between; gap: 2rem; font-size: 1.4rem; padding: 0.1rem 0; }
.hud-results-row b { font-variant-numeric: tabular-nums; }
.hud-build { margin-top: 0.7rem; padding-top: 0.5rem; border-top: var(--px) solid #fff3; }
.hud-build-who { font-size: 1.04rem; opacity: 0.7; }
.hud-build-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.2rem 0.8rem; margin-top: 0.2rem; }
.hud-build-item { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 1.3rem; }
.hud-build-item i { display: inline-block; width: 1.6rem; height: 1.6rem; }
.hud-build-item.carried { font-size: 0.98rem; opacity: 0.75; }
.hud-build-item.carried i { width: 1.1rem; height: 1.1rem; }
.hud-results-note { margin: 0.8rem 0 0; font-size: 1.17rem; opacity: 0.85; max-width: 18rem; }
.hud-menu { pointer-events: auto; position: absolute; left: 50%; bottom: max(0.8rem, env(safe-area-inset-bottom)); transform: translateX(-50%);
  width: 2.4rem; height: 2.4rem; font-size: 1.4rem; color: #fff; background: var(--panel-2); border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 var(--line-2); cursor: pointer; opacity: 0.85; }
.hud-menu:hover { opacity: 1; }
@media (pointer: fine) { .hud-menu { top: 0.6rem; bottom: auto; left: auto; right: 0.6rem; transform: none; width: 2rem; height: 2rem; font-size: 1.23rem; } .hud-stats { right: 3rem; } }
.hud-crosshair { position: absolute; top: 50%; left: 50%; width: var(--px); height: var(--px); margin: calc(var(--px) * -0.5) 0 0 calc(var(--px) * -0.5); background: #fff; box-shadow: 0 0 0 var(--px) #000; }
.hud-letterbox { position: absolute; left: 0; right: 0; height: 11vh; background: #000; transform: scaleY(0); transition: transform 350ms steps(4, end); }
.hud-letterbox-0 { top: 0; transform-origin: top; }
.hud-letterbox-1 { bottom: 0; transform-origin: bottom; }
.hud-cinematic .hud-letterbox { transform: scaleY(1); }
.hud-top, .hud-crosshair { transition: opacity 250ms steps(4, end); }
.hud-cinematic .hud-top, .hud-cinematic .hud-crosshair { opacity: 0; }
.hud-fade { position: absolute; inset: 0; background: #000; opacity: 0; }
.hud-doors { position: absolute; inset: 0; overflow: hidden; transition: opacity 250ms steps(4, end); }
.hud-cinematic .hud-doors { opacity: 0; }
.hud-door { position: absolute; left: 0; top: 0; padding: 0.05rem 0.5rem; white-space: nowrap; font-size: 1.25rem; background: #0d0a14; border: var(--px) solid #fff4; text-shadow: var(--px) var(--px) 0 #000; opacity: 0.6; }
.hud-door.open { opacity: 1; border-color: #ffd56acc; }
.hud-door[hidden] { display: none; }
.hud-pickup { opacity: 1; border-color: #9fd0ffcc; }
.hud-pickup.relic { border-color: #ffb0f0cc; }
.touch { position: fixed; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  color: #fff; --pad: clamp(84px, 24vmin, 132px); --edge: max(18px, env(safe-area-inset-right));
  --base: max(18px, env(safe-area-inset-bottom)); }
.touch[hidden] { display: none; }
.touch-stick { position: absolute; width: 112px; height: 112px; margin: -56px 0 0 -56px;
  left: calc(max(18px, env(safe-area-inset-left)) + 56px); top: calc(100% - var(--base) - 56px);
  background: #0d0a1480; border: calc(var(--px) * 2) solid #ffffff60; opacity: 0.7; pointer-events: none; clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%); }
.touch-stick.active { opacity: 1; }
.touch-stick-knob { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; margin: -24px 0 0 -24px; background: #f3e6c8c0; clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%); }
.touch-pad { position: absolute; width: var(--pad); height: var(--pad); display: flex; flex-direction: column;
  align-items: center; justify-content: center; border: calc(var(--px) * 2) solid #000; box-shadow: inset var(--px) var(--px) 0 #ffffff60, inset calc(var(--px) * -1) calc(var(--px) * -1) 0 #0006;
  clip-path: polygon(15% 0, 85% 0, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0 85%, 0 15%); text-shadow: var(--px) var(--px) 0 #000; }
.touch-pad-arrow { font-size: 2rem; line-height: 1; min-height: 2rem; }
.touch-pad-label { font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.touch-attack { right: var(--edge); bottom: var(--base); background: #d9a22a; }
.touch-block { right: calc(var(--edge) + var(--pad) * 0.95); bottom: calc(var(--base) + var(--pad) * 0.85);
  width: calc(var(--pad) * 0.78); height: calc(var(--pad) * 0.78); background: #3a72b0; }
.touch-jump { right: calc(var(--edge) + var(--pad) * 1.15); bottom: var(--base);
  width: calc(var(--pad) * 0.62); height: calc(var(--pad) * 0.62); background: #7a7a30; }
.touch-throw { right: calc(var(--edge) + var(--pad) * 1.15); bottom: calc(var(--base) + var(--pad) * 0.62 + 14px);
  width: calc(var(--pad) * 0.62); height: calc(var(--pad) * 0.62); background: #6a4e98; }
.touch-sheathe { right: calc(var(--edge) + var(--pad) * 1.15 + var(--pad) * 0.62 + 14px); bottom: var(--base);
  width: calc(var(--pad) * 0.62); height: calc(var(--pad) * 0.62); background: #2f6a5a; }
.touch-sheathe .touch-pad-label { font-size: 0.86rem; letter-spacing: 0.02em; }
.touch-pad.active { filter: brightness(1.4); }
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
  style.textContent = PIXEL_CSS + CSS + MENU_CSS + FLOOR_MAP_CSS + INVENTORY_CSS + BATTLE_HUD_CSS + PLAYER_TAGS_CSS;
  document.head.append(style);
}
