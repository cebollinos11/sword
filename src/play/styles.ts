const CSS = `
.hud, .menu { position: fixed; inset: 0; font-family: system-ui, sans-serif; color: #fff; }
.hud { pointer-events: none; }
.hud[hidden], .menu[hidden], .menu-result[hidden] { display: none; }
.hud-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.8rem 1rem; }
.hud-fighter { flex: 1; max-width: 22rem; }
.hud-side-1 { text-align: right; }
.hud-name { font-size: 0.85rem; font-weight: 600; text-shadow: 0 1px 2px #0008; margin-bottom: 0.25rem; }
.hud-bar { position: relative; height: 1.1rem; background: #0006; border: 2px solid #fffc; border-radius: 4px; overflow: hidden; }
.hud-side-1 .hud-bar { transform: scaleX(-1); }
.hud-fill { height: 100%; width: 100%; transition: width 120ms linear; }
.hud-fill[data-fighter="0"] { background: #c0392b; }
.hud-fill[data-fighter="1"] { background: #2e86c1; }
.hud-hp { position: absolute; inset: 0; font-size: 0.75rem; line-height: 1.1rem; text-align: center; text-shadow: 0 1px 2px #000a; }
.hud-side-1 .hud-hp { transform: scaleX(-1); }
.hud-centre { text-align: center; text-shadow: 0 1px 3px #000a; min-width: 7rem; }
.hud-score { font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.hud-duel { font-size: 0.8rem; opacity: 0.9; }
.hud-banner { position: absolute; top: 30%; left: 0; right: 0; text-align: center; font-size: 2.2rem; font-weight: 700;
  text-shadow: 0 2px 6px #000a; opacity: 0; transition: opacity 250ms; }
.hud-banner.visible { opacity: 1; }
.menu { display: flex; align-items: center; justify-content: center; background: #0a1a2a99; }
.menu-panel { background: #18232fee; border: 1px solid #ffffff30; border-radius: 10px; padding: 1.6rem 2rem; width: min(30rem, calc(100vw - 2rem));
  box-sizing: border-box; box-shadow: 0 10px 40px #0008; }
.menu h1 { margin: 0 0 0.4rem; font-size: 2rem; letter-spacing: 0.08em; }
.menu h2 { margin: 1rem 0 0.6rem; font-size: 1rem; font-weight: 600; opacity: 0.85; }
.menu-result { font-size: 1.3rem; font-weight: 700; margin: 0.3rem 0; }
.menu-row { display: flex; align-items: center; gap: 0.8rem; margin: 0.5rem 0; flex-wrap: wrap; }
.menu-label { width: 5.5rem; opacity: 0.8; font-size: 0.9rem; }
.menu-choices { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.menu button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid #ffffff40; background: #ffffff14; color: #fff; padding: 0.35rem 0.8rem; }
.menu button[aria-checked="true"] { background: #e8b04b; border-color: #e8b04b; color: #1a1205; font-weight: 600; }
.menu .menu-start { display: block; width: 100%; margin-top: 1.1rem; padding: 0.65rem; font-size: 1.1rem; font-weight: 700; background: #c0392b; border-color: #c0392b; }
.menu .menu-start:hover { background: #d84a3b; }
.menu-help { font-size: 0.8rem; line-height: 1.45; opacity: 0.8; margin: 1rem 0 0.6rem; }
.menu-link { color: #9fc9e8; font-size: 0.85rem; }
`;

let injected = false;

/** Add the HUD and menu styles to the page once. */
export function ensurePlayStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
}
