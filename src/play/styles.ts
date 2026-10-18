const CSS = `
.hud, .menu { position: fixed; inset: 0; font-family: system-ui, sans-serif; color: #fff; }
.hud { pointer-events: none; }
.hud[hidden], .menu[hidden], .menu-result[hidden] { display: none; }
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
.hud-leave { pointer-events: auto; margin-top: 0.3rem; font: inherit; font-size: 0.75rem; color: #fff; background: #0006;
  border: 1px solid #fff8; border-radius: 4px; padding: 0.15rem 0.7rem; cursor: pointer; }
.hud-leave[hidden] { display: none; }
.hud-banner { position: absolute; top: 30%; left: 0; right: 0; text-align: center; font-size: 2.2rem; font-weight: 700;
  text-shadow: 0 2px 6px #000a; opacity: 0; transition: opacity 250ms; }
.hud-banner.visible { opacity: 1; }
.hud-crosshair { position: absolute; top: 50%; left: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%;
  background: #fffe; box-shadow: 0 0 0 1px #0008; }
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
.menu-panel { max-height: calc(100vh - 2rem); overflow-y: auto; }
.menu [hidden] { display: none !important; }
.menu input[type="text"] { font: inherit; flex: 1; min-width: 0; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #ffffff40;
  background: #0006; color: #fff; }
.menu .menu-create-room { display: block; width: 100%; margin: 0.5rem 0; padding: 0.5rem; font-weight: 600; background: #2e86c1; border-color: #2e86c1; }
.menu-join { flex-wrap: nowrap; }
.menu select { font: inherit; font-size: 0.85rem; padding: 0.25rem 0.4rem; border-radius: 6px; border: 1px solid #ffffff40; background: #0006; color: #fff; }
.menu select option { background: #18232f; }
.team-format { margin: 0.2rem 0; font-weight: 700; opacity: 0.85; }
.team-ai { margin: 0.3rem 0; }
.team-ai .menu-label { min-width: 4.5rem; }
.menu-host { font-size: 0.95rem; margin: 0.4rem 0; }
.menu-host summary { cursor: pointer; opacity: 0.8; }
.menu-broker { font-size: 0.85rem; margin: 0.4rem 0; }
.menu-broker summary { cursor: pointer; opacity: 0.8; }
.menu-broker input[type="text"] { width: 100%; box-sizing: border-box; margin-top: 0.4rem; font-size: 0.8rem; }
.menu-room-code { font-size: 2.6rem; font-weight: 700; letter-spacing: 0.25em; font-family: ui-monospace, monospace; margin: 0.4rem 0; }
.menu-room-status { opacity: 0.85; font-size: 0.9rem; }
.menu-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.menu .menu-fullscreen { font-size: 0.85rem; padding: 0.3rem 0.7rem; }
.menu button, .menu input { touch-action: manipulation; }
@media (pointer: coarse) { .menu button { padding: 0.55rem 0.95rem; } .menu-panel { padding: 1.2rem 1.2rem; } }
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
.touch-pad.active { border-color: #fff; filter: brightness(1.35); }
@media (orientation: portrait) {
  .touch { --pad: clamp(84px, 27vw, 128px); }
  .touch-block { right: var(--edge); bottom: calc(var(--base) + var(--pad) + 16px); }
  .touch-jump { right: calc(var(--edge) + var(--pad) + 16px); bottom: var(--base); }
  .touch-throw { right: calc(var(--edge) + var(--pad) + 16px); bottom: calc(var(--base) + var(--pad) * 0.62 + 14px); }
}
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
