/** The menus' styles (title screen, cards, Lobby), drawn over the live 3D scene. Injected with the HUD's by `ensurePlayStyles`. */
export const MENU_CSS = `
.menu { --panel: #111922f2; --panel-2: #18222df2; --line: #ffffff1c; --line-2: #ffffff33; --text: #f3efe6;
  --muted: #f3efe6a6; --gold: #e8b04b; --gold-2: #f5cd7a;
  --display: 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  display: flex; align-items: center; justify-content: center; color: var(--text); padding: max(16px, env(safe-area-inset-top)) 16px;
  box-sizing: border-box; background: radial-gradient(ellipse at 50% 40%, #070b1066, #070b10d0); }
.menu *, .menu *::before, .menu *::after { box-sizing: border-box; }
.menu [hidden] { display: none !important; }
.menu.menu-in-game { background: #05080cb8; backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
.menu.menu-on-title { justify-content: flex-start; padding: 0;
  background: linear-gradient(90deg, #070b10f2 0%, #070b10c4 34%, #070b1030 62%, transparent 80%), linear-gradient(0deg, #070b10a0, transparent 30%); }
.menu-frame { width: 100%; max-height: 100%; display: flex; justify-content: center; }
.menu-frame.menu-screen-title { height: 100%; justify-content: flex-start; }
.menu button, .menu input, .menu select { font: inherit; color: inherit; touch-action: manipulation; }
.menu button { cursor: pointer; }
.menu button:disabled { cursor: default; }
.menu :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* Buttons */
.menu .cta { border: 0; border-radius: 8px; padding: 0.75rem 1.6rem; font-weight: 700; font-size: 1.05rem; letter-spacing: 0.04em;
  color: #1b1206; background: linear-gradient(180deg, var(--gold-2), var(--gold)); box-shadow: 0 4px 18px #e8b04b40, inset 0 1px 0 #fff6;
  transition: transform 120ms, box-shadow 120ms, filter 120ms; }
.menu .cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 24px #e8b04b66, inset 0 1px 0 #fff6; }
.menu .cta:disabled { filter: grayscale(0.8) brightness(0.6); box-shadow: none; }
.menu .cta.secondary { color: var(--text); background: #ffffff14; box-shadow: inset 0 0 0 1px var(--line-2); }
.menu .ghost { border: 1px solid var(--line-2); background: #ffffff0d; border-radius: 6px; padding: 0.4rem 0.85rem; font-size: 0.9rem; }
.menu .ghost:hover { background: #ffffff1f; }
.menu .ghost.small { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
.menu .back-button { border: 0; background: none; padding: 0.3rem 0.2rem; color: var(--muted); font-size: 0.9rem; white-space: nowrap; }
.menu .back-button:hover { color: var(--text); background: none; }

/* Title screen */
.title-screen { height: 100%; width: min(40rem, 100%); display: flex; flex-direction: column; justify-content: center; overflow-y: auto;
  padding: 2rem clamp(1rem, 6vw, 5rem); }
.title-hero { display: flex; flex-direction: column; }
.logo { margin: 0; font-family: var(--display); font-weight: 700; font-size: clamp(2.8rem, 8vw, 5.4rem); line-height: 0.95; letter-spacing: 0.14em; white-space: nowrap;
  text-transform: uppercase; background: linear-gradient(180deg, #fff 10%, #e9dcc0 55%, #a98a52); -webkit-background-clip: text; background-clip: text;
  color: transparent; filter: drop-shadow(0 4px 18px #000a); }
.title-hero::before { content: ''; display: block; width: 4.2rem; height: 0.32rem; margin-bottom: 1.1rem; border-radius: 2px;
  background: linear-gradient(90deg, var(--gold), transparent); }
.tagline { margin: 0.9rem 0 1.8rem; color: var(--muted); font-size: 1.05rem; letter-spacing: 0.05em; font-style: italic; }
.title-nav { display: flex; flex-direction: column; gap: 0.3rem; }
.nav-item { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 0.1rem; padding: 0.65rem 1rem 0.65rem 1.1rem;
  border-radius: 8px; border-left: 3px solid transparent; transition: background 140ms, border-color 140ms, transform 140ms; }
.nav-item:hover, .nav-item:focus-visible { background: linear-gradient(90deg, #ffffff17, #ffffff05); border-left-color: var(--gold); transform: translateX(4px); }
.nav-label { font-family: var(--display); font-size: 1.35rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.nav-hint { font-size: 0.82rem; color: var(--muted); }
.nav-item.primary .nav-label { color: var(--gold-2); }
.nav-item.danger .nav-label { color: #f08a7c; }
.nav-link { color: inherit; text-decoration: none; }
.title-nav.compact .nav-label { font-size: 1.1rem; }
.title-nav.compact .nav-item { padding: 0.5rem 0.9rem; }
.title-foot { display: flex; align-items: center; gap: 0.6rem; margin-top: 2rem; flex-wrap: wrap; }
.you-chip { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0.9rem 0.35rem 0.35rem; border-radius: 999px; border: 1px solid var(--line-2);
  background: #ffffff0d; text-align: left; }
.you-chip:hover { background: #ffffff1c; }
.you-avatar, .seat-avatar { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 2.1rem; height: 2.1rem; border-radius: 50%;
  font-weight: 700; font-size: 0.85rem; color: #fff; background: #3a4654; box-shadow: inset 0 0 0 2px #ffffff40; text-shadow: 0 1px 2px #0008; }
.you-avatar { width: 2.6rem; height: 2.6rem; background-size: 260%, cover; background-position: 50% 6%, center; background-repeat: no-repeat; }
.you-text { display: flex; flex-direction: column; line-height: 1.15; font-size: 0.9rem; }
.you-text span { color: var(--muted); font-size: 0.78rem; }

/* Cards */
.menu-card { width: min(46rem, 100%); max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem); display: flex; flex-direction: column;
  background: linear-gradient(180deg, var(--panel-2), var(--panel)); border: 1px solid var(--line); border-radius: 14px; padding: 1.2rem 1.5rem 1.4rem;
  box-shadow: 0 24px 80px #000b, inset 0 1px 0 #ffffff12; overflow: hidden; }
.menu-card.narrow { width: min(26rem, 100%); overflow-y: auto; }
.menu-card.wide { width: min(72rem, 100%); }
.menu-card.centre { align-items: center; text-align: center; gap: 0.4rem; }
.menu-screen-settings .menu-card { margin-right: auto; width: min(32rem, 100%); overflow-y: auto; }
.card-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.8rem; }
.card-title { margin: 0; font-family: var(--display); font-size: 1.5rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.menu-scroll { overflow-y: auto; min-height: 0; flex: 1; margin: 0 -0.5rem; padding: 0 0.5rem; }
.menu-message { margin: 0 0 0.8rem; padding: 0.6rem 0.8rem; border-radius: 8px; background: #e8b04b1f; border: 1px solid #e8b04b55; color: var(--gold-2); font-weight: 600; }
.title-hero .menu-message { margin: -0.8rem 0 1.2rem; }
.menu-help { font-size: 0.85rem; line-height: 1.5; color: var(--muted); margin: 0.6rem 0; }
.menu-help.big { font-size: 1rem; }
.field { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.4rem 0 0.9rem; }
.field-label, .lb-label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.text-input { width: 100%; min-width: 0; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid var(--line-2); background: #0008; }
.text-input:focus { border-color: var(--gold); outline: none; }
.menu select { padding: 0.3rem 0.4rem; border-radius: 6px; border: 1px solid var(--line-2); background: #0007; font-size: 0.82rem; max-width: 100%; }
.menu select option { background: #18232f; }

/* Online */
.choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.9rem; margin: 0.2rem 0 0.9rem; }
.choice-card { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.1rem; border-radius: 12px; border: 1px solid var(--line); background: #ffffff08; }
.choice-card h3 { margin: 0; font-family: var(--display); letter-spacing: 0.06em; font-size: 1.15rem; }
.choice-card p { margin: 0 0 0.4rem; color: var(--muted); font-size: 0.88rem; line-height: 1.45; flex: 1; }
.join-form { display: flex; gap: 0.5rem; }
.join-form .cta { padding: 0.6rem 1.1rem; }
.code-input { font-family: ui-monospace, monospace; letter-spacing: 0.08em; }
.advanced summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; margin-bottom: 0.4rem; }
.spinner { width: 2.4rem; height: 2.4rem; border-radius: 50%; border: 3px solid #ffffff22; border-top-color: var(--gold); animation: menu-spin 0.9s linear infinite; margin: 0.6rem; }
@keyframes menu-spin { to { transform: rotate(360deg); } }
.room-code { font-family: ui-monospace, monospace; font-size: 2rem; font-weight: 700; letter-spacing: 0.22em; color: var(--gold-2); }

/* Character */
.body-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.6rem, 1fr)); gap: 0.5rem; }
.body-card { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; padding: 0.4rem 0.3rem 0.5rem; border-radius: 10px; border: 1px solid var(--line);
  background: radial-gradient(ellipse at 50% 40%, #ffffff14, transparent 70%), #ffffff06; transition: background 120ms, border-color 120ms, transform 120ms; }
.body-card:hover { transform: translateY(-2px); }
.body-picture { display: block; width: 100%; aspect-ratio: 320 / 420; }
.body-picture img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 6px 8px #0009); }
.body-card:hover { background: #ffffff14; }
.body-card[aria-pressed="true"] { border-color: var(--gold); background: #e8b04b1c; box-shadow: inset 0 0 0 1px var(--gold); }
.body-name { font-size: 0.85rem; }
.lb-row { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; margin: 0.5rem 0; }
.lb-row .field-label, .lb-row .lb-label { min-width: 4rem; }

/* How to play */
.keys { display: grid; grid-template-columns: auto 1fr; gap: 0.55rem 1.1rem; margin: 0 0 1rem; align-items: baseline; }
.keys dt { text-align: right; white-space: nowrap; }
.keys dd { margin: 0; color: var(--muted); font-size: 0.92rem; }
.menu kbd { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 5px; border: 1px solid var(--line-2); border-bottom-width: 3px; background: #ffffff10;
  font: 600 0.8rem ui-monospace, monospace; color: var(--text); }
.tips { margin: 0; padding-left: 1.1rem; color: var(--muted); font-size: 0.9rem; line-height: 1.6; }

/* Lobby */
.lobby { padding-bottom: 0; }
.lb-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
.lb-title { display: flex; align-items: center; gap: 0.6rem; }
.invite { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 0.5rem 0.8rem; border-radius: 10px; background: #e8b04b12; border: 1px solid #e8b04b40; }
.invite-code { display: flex; flex-direction: column; line-height: 1.1; }
.invite .room-code { font-size: 1.5rem; }
.invite-link { display: flex; gap: 0.4rem; align-items: center; }
.link-input { width: 14rem; font-size: 0.78rem; padding: 0.35rem 0.5rem; }
.menu-card.pause .invite { margin-top: 1rem; }
.lb-body { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 1.4rem; padding-bottom: 1rem; }
.lb-section { margin-bottom: 1.1rem; }
.lb-heading { margin: 0 0 0.6rem; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.lb-note { margin: 0.5rem 0 0; font-size: 0.78rem; color: var(--muted); }
.lb-teams { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 0.6rem; align-items: stretch; }
.lb-vs { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem; font-family: var(--display); color: var(--muted); }
.lb-vs b { font-size: 1rem; color: var(--gold); text-transform: uppercase; letter-spacing: 0.1em; }
.lb-vs span { font-size: 1.5rem; font-weight: 700; color: var(--text); }
.lb-team { --team: #888; border-radius: 12px; padding: 0.6rem; background: linear-gradient(180deg, color-mix(in srgb, var(--team) 22%, transparent), #ffffff05 60%);
  border: 1px solid color-mix(in srgb, var(--team) 45%, transparent); display: flex; flex-direction: column; gap: 0.4rem; }
.lb-team-head { display: flex; justify-content: space-between; align-items: baseline; padding: 0 0.2rem 0.2rem; }
.lb-team-name { font-family: var(--display); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: color-mix(in srgb, var(--team) 55%, #fff); }
.lb-team-count { font-size: 0.75rem; color: var(--muted); }
.seat { display: flex; align-items: center; gap: 0.6rem; min-height: 3.4rem; padding: 0.45rem 0.55rem; border-radius: 9px; background: #0005;
  border: 1px solid var(--line); }
.seat-mine { border-color: var(--gold); box-shadow: inset 0 0 0 1px #e8b04b55; background: #e8b04b12; }
.seat-open { border-style: dashed; border-color: var(--line-2); background: #ffffff06; }
.seat-closed { background: transparent; border-style: dashed; opacity: 0.75; }
.seat-avatar-empty { background: transparent; box-shadow: inset 0 0 0 2px #ffffff26; color: var(--muted); }
.seat-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.seat-title { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.seat-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seat-sub { font-size: 0.78rem; color: var(--muted); }
.seat-controls { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.seat-open .seat-name, .seat-closed .seat-name { color: var(--muted); font-weight: 500; }
.tag { font-size: 0.62rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.1rem 0.4rem; border-radius: 4px; }
.tag-you { background: var(--gold); color: #1b1206; }
.tag-host { background: #ffffff22; }
.seat-ready { font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 999px; background: #ffffff14; color: var(--muted); white-space: nowrap; }
.seat-ready.is-ready { background: #3fa96b33; color: #8fe0ad; }
.seat-move { flex: none; width: 1.9rem; height: 1.9rem; padding: 0; border: 1px solid var(--line-2); background: #ffffff0d; border-radius: 50%;
  font-size: 0.95rem; line-height: 1; color: var(--muted); }
.seat-controls select { flex: 1 1 5.5rem; min-width: 0; }
.seat-move:hover { color: var(--text); background: #ffffff1f; }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.5rem; margin-bottom: 0.6rem; }
.map-card { position: relative; display: flex; flex-direction: column; justify-content: flex-end; text-align: left; min-height: 5.6rem; padding: 0.5rem 0.6rem;
  border-radius: 10px; border: 1px solid var(--line); overflow: hidden; background: #000; transition: transform 140ms, border-color 140ms; }
.map-art { position: absolute; inset: 0; transition: transform 300ms; }
.map-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 30%, #000c); }
.map-name, .map-blurb { position: relative; z-index: 1; text-shadow: 0 1px 3px #000; }
.map-name { font-weight: 700; font-size: 0.88rem; line-height: 1.15; }
.map-blurb { font-size: 0.7rem; color: #ffffffb0; line-height: 1.2; }
.map-card:hover:not(:disabled) { transform: translateY(-2px); }
.map-card:hover:not(:disabled) .map-art { transform: scale(1.06); }
.map-card[aria-pressed="true"] { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold), 0 6px 20px #e8b04b30; }
.map-card:disabled { opacity: 0.35; }
.map-card[aria-pressed="true"]:disabled { opacity: 1; }
.segmented { display: inline-flex; border: 1px solid var(--line-2); border-radius: 8px; overflow: hidden; }
.segmented button { border: 0; background: transparent; padding: 0.4rem 0.8rem; font-size: 0.85rem; color: var(--muted); }
.segmented button + button { border-left: 1px solid var(--line); }
.segmented button[aria-checked="true"] { background: var(--gold); color: #1b1206; font-weight: 700; }
.segmented button:disabled:not([aria-checked="true"]) { opacity: 0.45; }
.weapon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.5rem; }
.weapon-card { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.65rem 0.7rem; border-radius: 10px; border: 1px solid var(--line); background: #ffffff08;
  text-align: left; transition: background 120ms, border-color 120ms; }
.weapon-card:hover { background: #ffffff12; }
.weapon-card[aria-pressed="true"] { border-color: var(--gold); background: #e8b04b16; box-shadow: inset 0 0 0 1px var(--gold); }
.weapon-picture { display: block; aspect-ratio: 3 / 1; margin: -0.2rem -0.2rem 0.1rem; border-radius: 7px;
  background: radial-gradient(ellipse at 50% 55%, #ffffff1c, transparent 70%); }
.weapon-picture img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 4px 6px #000a); }
.weapon-card:hover .weapon-picture img { transform: rotate(-4deg) scale(1.04); }
.weapon-picture img { transition: transform 200ms; }
.weapon-name { font-weight: 700; }
.weapon-grip { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.stat { display: grid; grid-template-columns: 3.3rem 1fr; align-items: center; gap: 0.4rem; font-size: 0.7rem; color: var(--muted); }
.stat-bar { height: 5px; border-radius: 3px; background: #ffffff18; overflow: hidden; }
.stat-fill { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #a8742a, var(--gold-2)); }
.lb-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin: 0 -1.5rem; padding: 0.9rem 1.5rem;
  border-top: 1px solid var(--line); background: #0004; }
.lb-status { margin: 0; color: var(--muted); font-size: 0.9rem; flex: 1; min-width: 12rem; }
.lb-actions { display: flex; gap: 0.5rem; }
@media (max-width: 820px) {
  .lb-body { grid-template-columns: 1fr; gap: 0.4rem; }
  .lb-teams { grid-template-columns: 1fr; }
  .lb-vs { flex-direction: row; gap: 0.6rem; }
  .link-input { width: 100%; }
  .menu-card { padding: 1rem 1rem 1.1rem; }
  .lb-footer { margin: 0 -1rem; padding: 0.8rem 1rem; }
  .menu.menu-on-title { background: linear-gradient(90deg, #070b10f2, #070b10b0); }
}
@media (max-height: 560px) { .title-screen { justify-content: flex-start; padding-top: 1rem; } .tagline { margin-bottom: 0.8rem; } .nav-item { padding: 0.35rem 0.8rem; } }
@media (pointer: coarse) { .menu .ghost { padding: 0.5rem 0.8rem; } .seat-move { width: 2.4rem; height: 2.4rem; } }
`;
