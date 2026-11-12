/** The menus' styles (title screen, cards, Lobby), drawn over the live 3D scene. Injected with the HUD's by `ensurePlayStyles`. */
export const MENU_CSS = `
.menu { --display: var(--font-display);
  display: flex; align-items: center; justify-content: center; color: var(--text); padding: max(16px, env(safe-area-inset-top)) 16px;
  box-sizing: border-box; background: #0d0a14b0; }
.menu *, .menu *::before, .menu *::after { box-sizing: border-box; }
.menu [hidden] { display: none !important; }
.menu.menu-in-game { background: #0d0a14d8; }
.menu.menu-on-title { justify-content: flex-start; padding: 0;
  background: linear-gradient(90deg, #0d0a14f2 0 min(40rem, 100%), var(--line) min(40rem, 100%) calc(min(40rem, 100%) + var(--px)), transparent calc(min(40rem, 100%) + var(--px))); }
.menu-frame { width: 100%; max-height: 100%; display: flex; justify-content: center; }
.menu-frame.menu-screen-title { height: 100%; justify-content: flex-start; }
.menu button, .menu input, .menu select { font: inherit; color: inherit; touch-action: manipulation; }
.menu button { cursor: pointer; }
.menu button:disabled { cursor: default; }
.menu :focus-visible { outline: var(--px) solid var(--gold-2); outline-offset: var(--px); }

/* Buttons */
.menu .cta { border: var(--px) solid var(--ink); padding: 0.6rem 1.4rem; font-family: var(--font-display); font-weight: 700; font-size: 0.85rem; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink); background: var(--gold); box-shadow: inset calc(var(--px) * -1) calc(var(--px) * -1) 0 #a8742a, inset var(--px) var(--px) 0 var(--gold-2), calc(var(--px) * 2) calc(var(--px) * 2) 0 #000; }
.menu .cta:hover:not(:disabled) { background: var(--gold-2); }
.menu .cta:active:not(:disabled) { transform: translate(var(--px), var(--px)); box-shadow: inset var(--px) var(--px) 0 #a8742a; }
.menu .cta:disabled { background: #6b6358; box-shadow: inset calc(var(--px) * -1) calc(var(--px) * -1) 0 #4a443c; color: #2c2822; }
.menu .cta.secondary { color: var(--text); background: var(--panel-2); box-shadow: inset calc(var(--px) * -1) calc(var(--px) * -1) 0 var(--ink), inset var(--px) var(--px) 0 var(--line-2), calc(var(--px) * 2) calc(var(--px) * 2) 0 #000; }
.menu .ghost { border: var(--px) solid var(--ink); background: var(--panel-2); box-shadow: inset var(--px) var(--px) 0 var(--line-2); padding: 0.3rem 0.8rem; font-size: 1.15rem; }
.menu .ghost:hover { background: var(--line); }
.menu .ghost.small { padding: 0.3rem 0.6rem; font-size: 1.04rem; }
.menu .back-button { border: 0; background: none; padding: 0.3rem 0.2rem; color: var(--muted); font-size: 1.17rem; white-space: nowrap; }
.menu .back-button:hover { color: var(--text); background: none; }

/* Title screen */
.title-screen { height: 100%; width: min(40rem, 100%); display: flex; flex-direction: column; justify-content: center; overflow-y: auto;
  padding: 2rem clamp(1rem, 6vw, 5rem); }
.title-hero { display: flex; flex-direction: column; }
.logo { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: clamp(2rem, 6.2vw, 4rem); line-height: 1.1; letter-spacing: 0.1em; white-space: nowrap;
  text-transform: uppercase; color: var(--gold-2); text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 #7a4a12, calc(var(--px) * 3) calc(var(--px) * 3) 0 #000; }
.title-hero::before { content: ''; display: block; width: 4.2rem; height: calc(var(--px) * 2); margin-bottom: 1.1rem; background: var(--gold); box-shadow: var(--px) var(--px) 0 #000; }
.tagline { margin: 0.9rem 0 1.8rem; color: var(--muted); font-size: 1.4rem; letter-spacing: 0.05em; }
.title-nav { display: flex; flex-direction: column; gap: 0.3rem; }
.nav-item { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 0.1rem; padding: 0.55rem 1rem 0.55rem 2rem; position: relative; }
.nav-item:hover, .nav-item:focus-visible { background: var(--panel-2); box-shadow: inset var(--px) var(--px) 0 var(--line-2), inset calc(var(--px) * -1) calc(var(--px) * -1) 0 var(--ink); }
.nav-item:hover::before, .nav-item:focus-visible::before { content: ''; position: absolute; left: 0.7rem; top: 50%; margin-top: calc(var(--px) * -2); border: calc(var(--px) * 2) solid transparent; border-left-color: var(--gold-2); border-right-width: 0; }
.nav-label { font-family: var(--font-display); font-size: 1rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.nav-hint { font-size: 1.1rem; color: var(--muted); }
.nav-item.sens { cursor: default; }
.nav-item.sens:hover { transform: none; }
.sens-slider { width: 100%; accent-color: var(--gold); }
.nav-item.primary .nav-label { color: var(--gold-2); }
.nav-item.danger .nav-label { color: #ff8a7a; }
.nav-link { color: inherit; text-decoration: none; }
.title-nav.compact .nav-label { font-size: 0.85rem; }
.title-nav.compact .nav-item { padding: 0.5rem 0.9rem; }
.title-foot { display: flex; align-items: center; gap: 0.6rem; margin-top: 2rem; flex-wrap: wrap; }
.you-chip { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem 0.9rem 0.3rem 0.3rem; border: var(--px) solid var(--ink); background: var(--panel-2); box-shadow: inset var(--px) var(--px) 0 var(--line-2), calc(var(--px) * 2) calc(var(--px) * 2) 0 #000; text-align: left; }
.you-chip:hover { background: var(--line); }
.you-avatar, .seat-avatar { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 2.1rem; height: 2.1rem; border: var(--px) solid var(--ink);
  font-family: var(--font-display); font-weight: 700; font-size: 0.7rem; color: #fff; background: #3a4654; text-shadow: var(--px) var(--px) 0 #000; }
.you-avatar { width: 2.6rem; height: 2.6rem; background-size: 260%, cover; background-position: 50% 6%, center; background-repeat: no-repeat; }
.you-text { display: flex; flex-direction: column; line-height: 1.05; font-size: 1.25rem; }
.you-text span { color: var(--muted); font-size: 1.05rem; }

/* Cards */
.menu-card { width: min(46rem, 100%); max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem); display: flex; flex-direction: column;
  background: var(--panel); border: calc(var(--px) * 2) solid var(--ink); padding: 1.2rem 1.5rem 1.4rem;
  box-shadow: inset var(--px) var(--px) 0 var(--line-2), inset calc(var(--px) * -1) calc(var(--px) * -1) 0 var(--line), calc(var(--px) * 3) calc(var(--px) * 3) 0 #000; overflow: hidden; }
.menu-card.narrow { width: min(26rem, 100%); overflow-y: auto; }
.menu-card.wide { width: min(72rem, 100%); }
.menu-card.centre { align-items: center; text-align: center; gap: 0.4rem; }
.menu-screen-settings .menu-card { margin-right: auto; width: min(32rem, 100%); overflow-y: auto; }
.card-head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.8rem; }
.card-title { margin: 0; font-family: var(--font-display); font-size: 1.05rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: var(--gold-2); }
.menu-scroll { overflow-y: auto; min-height: 0; flex: 1; margin: 0 -0.5rem; padding: 0 0.5rem; }
.menu-message { margin: 0 0 0.8rem; padding: 0.5rem 0.8rem; background: #4a3a14; border: var(--px) solid var(--gold); color: var(--gold-2); font-size: 1.3rem; }
.title-hero .menu-message { margin: -0.8rem 0 1.2rem; }
.menu-help { font-size: 1.2rem; line-height: 1.25; color: var(--muted); margin: 0.6rem 0; }
.menu-help.big { font-size: 1.4rem; }
.field { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.4rem 0 0.9rem; }
.field-label, .lb-label { font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.text-input { width: 100%; min-width: 0; padding: 0.5rem 0.7rem; border: var(--px) solid var(--ink); background: #0d0a14; box-shadow: inset var(--px) var(--px) 0 #000; font-size: 1.3rem; }
.text-input:focus { border-color: var(--gold); outline: none; }
.menu select { padding: 0.2rem 0.4rem; border: var(--px) solid var(--ink); background: #0d0a14; font-size: 1.15rem; max-width: 100%; }
.menu select option { background: #0d0a14; }

/* Online */
.choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.9rem; margin: 0.2rem 0 0.9rem; }
.choice-card { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.1rem; border: var(--px) solid var(--ink); background: var(--panel-2); box-shadow: inset var(--px) var(--px) 0 var(--line); }
.choice-card h3 { margin: 0; font-family: var(--font-display); letter-spacing: 0.06em; font-size: 0.85rem; text-transform: uppercase; }
.choice-card p { margin: 0 0 0.4rem; color: var(--muted); font-size: 1.2rem; line-height: 1.2; flex: 1; }
.join-form { display: flex; gap: 0.5rem; }
.join-form .cta { padding: 0.6rem 1.1rem; }
.code-input { font-family: var(--font-body); letter-spacing: 0.08em; }
.advanced summary { cursor: pointer; color: var(--muted); font-size: 1.15rem; margin-bottom: 0.4rem; }
.spinner { width: 2rem; height: 2rem; border: calc(var(--px) * 2) solid var(--line); border-top-color: var(--gold); animation: menu-spin 0.8s steps(4) infinite; margin: 0.6rem; }
@keyframes menu-spin { to { transform: rotate(360deg); } }
.room-code { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; letter-spacing: 0.2em; color: var(--gold-2); }

/* Character */
.size-slider { flex: 1; min-width: 6rem; accent-color: var(--accent, #f5cd7a); }
.size-value { min-width: 3.2rem; text-align: right; font-variant-numeric: tabular-nums; }
.body-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.6rem, 1fr)); gap: 0.5rem; }
.body-card { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; padding: 0.4rem 0.3rem 0.5rem; border: var(--px) solid var(--ink); background: var(--panel-2); }
.body-card:hover { background: var(--line); }
.body-picture { display: block; width: 100%; aspect-ratio: 320 / 420; }
.body-picture img { width: 100%; height: 100%; object-fit: contain; }

.body-card[aria-pressed="true"] { border-color: var(--gold); background: #4a3a14; }
.body-name { font-size: 1.2rem; }
.lb-row { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; margin: 0.5rem 0; }
.lb-row .field-label, .lb-row .lb-label { min-width: 4rem; }
.lb-knob { flex-direction: column; align-items: flex-start; gap: 0.35rem; margin: 0.65rem 0; }
.lb-knob .segmented { flex-wrap: wrap; }
.lb-reset { margin-top: 0.3rem; padding: 0.3rem 0.8rem; border: var(--px) solid var(--ink); background: var(--panel-2); color: var(--muted); font-size: 1.15rem; }
.lb-reset:hover { color: inherit; border-color: var(--gold); }

/* How to play */
.keys { display: grid; grid-template-columns: auto 1fr; gap: 0.55rem 1.1rem; margin: 0 0 1rem; align-items: baseline; }
.keys dt { text-align: right; white-space: nowrap; }
.keys dd { margin: 0; color: var(--muted); font-size: 1.2rem; }
.menu kbd { display: inline-block; padding: 0.05rem 0.5rem; border: var(--px) solid var(--ink); border-bottom-width: calc(var(--px) * 2); background: var(--line); font: 1.15rem var(--font-body); color: var(--text); }
.tips { margin: 0; padding-left: 1.1rem; color: var(--muted); font-size: 1.2rem; line-height: 1.3; }

/* Lobby */
.lobby { padding-bottom: 0; }
.lb-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
.lb-title { display: flex; align-items: center; gap: 0.6rem; }
.invite { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 0.5rem 0.8rem; background: #4a3a14; border: var(--px) solid var(--gold); }
.invite-code { display: flex; flex-direction: column; line-height: 1.1; }
.invite .room-code { font-size: 1.1rem; }
.invite-link { display: flex; gap: 0.4rem; align-items: center; }
.link-input { width: 14rem; font-size: 1.05rem; padding: 0.3rem 0.5rem; }
.menu-card.pause .invite { margin-top: 1rem; }
.lb-body { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 1.4rem; padding-bottom: 1rem; }
.lb-section { margin-bottom: 1.1rem; }
.lb-heading { margin: 0 0 0.6rem; font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.lb-note { margin: 0.5rem 0 0; font-size: 1.1rem; color: var(--muted); }
.lb-teams { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 0.6rem; align-items: stretch; }
.lb-vs { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem; font-family: var(--font-display); color: var(--muted); }
.lb-vs b { font-size: 0.7rem; color: var(--gold); text-transform: uppercase; letter-spacing: 0.1em; }
.lb-vs span { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.lb-team { --team: #888; padding: 0.6rem; background: color-mix(in srgb, var(--team) 18%, var(--panel));
  border: var(--px) solid var(--ink); box-shadow: inset 0 calc(var(--px) * 2) 0 var(--team); display: flex; flex-direction: column; gap: 0.4rem; }
.lb-team-head { display: flex; justify-content: space-between; align-items: baseline; padding: calc(var(--px) * 2) 0.2rem 0.2rem; }
.lb-team-name { font-family: var(--font-display); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: color-mix(in srgb, var(--team) 55%, #fff); }
.lb-team-count { font-size: 1.1rem; color: var(--muted); }
.seat { display: flex; align-items: center; gap: 0.6rem; min-height: 3.4rem; padding: 0.45rem 0.55rem; background: #0d0a14; border: var(--px) solid var(--ink); }
.seat-mine { border-color: var(--gold); background: #2a2210; }
.seat-open { border-style: dashed; border-color: var(--line-2); background: var(--panel); }
.seat-closed { background: transparent; border-style: dashed; opacity: 0.75; }
.seat-avatar-empty { background: transparent; border-style: dashed; border-color: var(--line-2); color: var(--muted); }
.seat-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.seat-title { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.seat-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seat-sub { font-size: 1.1rem; color: var(--muted); }
.seat-controls { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.seat-open .seat-name, .seat-closed .seat-name { color: var(--muted); font-weight: 500; }
.tag { font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.15rem 0.4rem; }
.tag-you { background: var(--gold); color: #1b1206; }
.tag-host { background: var(--line-2); }
.seat-ready { font-size: 1.1rem; padding: 0.1rem 0.5rem; background: var(--panel-2); color: var(--muted); white-space: nowrap; }
.seat-ready.is-ready { background: #1f4a30; color: #8fe0ad; }
.seat-move { flex: none; width: 1.9rem; height: 1.9rem; padding: 0; border: var(--px) solid var(--ink); background: var(--panel-2); font-size: 1.2rem; line-height: 1; color: var(--muted); }
.seat-controls select { flex: 1 1 5.5rem; min-width: 0; }
.seat-move:hover { color: var(--text); background: var(--line); }
.lb-seed { width: 8rem; padding: 0.3rem 0.5rem; border: var(--px) solid var(--ink); background: #0d0a14; font-size: 1.15rem; }
.lb-seed:focus { border-color: var(--gold); outline: none; }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.5rem; margin-bottom: 0.6rem; }
.map-card { position: relative; display: flex; flex-direction: column; justify-content: flex-end; text-align: left; min-height: 5.6rem; padding: 0.5rem 0.6rem; border: var(--px) solid var(--ink); overflow: hidden; background: #000; }
.map-art { position: absolute; inset: 0; }
.map-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0 45%, #0d0a14c8 45%); }
.map-name, .map-blurb { position: relative; z-index: 1; text-shadow: var(--px) var(--px) 0 #000; }
.map-name { font-family: var(--font-display); font-weight: 700; font-size: 0.6rem; line-height: 1.3; text-transform: uppercase; }
.map-blurb { font-size: 1.05rem; color: #ffffffd0; line-height: 1; }
.map-card:hover:not(:disabled) { border-color: var(--line-2); }

.map-card[aria-pressed="true"] { border-color: var(--gold); box-shadow: 0 0 0 var(--px) var(--gold); }
.map-card:disabled { opacity: 0.35; }
.map-card[aria-pressed="true"]:disabled { opacity: 1; }
.segmented { display: inline-flex; border: var(--px) solid var(--ink); background: var(--panel-2); }
.segmented button { border: 0; background: transparent; padding: 0.3rem 0.8rem; font-size: 1.2rem; color: var(--muted); }
.segmented button + button { border-left: var(--px) solid var(--ink); }
.segmented button[aria-checked="true"] { background: var(--gold); color: var(--ink); }
.segmented button:disabled:not([aria-checked="true"]) { opacity: 0.45; }
.weapon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.5rem; }
.weapon-card { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.65rem 0.7rem; border: var(--px) solid var(--ink); background: var(--panel-2); text-align: left; }
.weapon-card:hover { background: var(--line); }
.weapon-card[aria-pressed="true"] { border-color: var(--gold); background: #4a3a14; }
.weapon-picture { display: block; aspect-ratio: 3 / 1; margin: -0.2rem -0.2rem 0.1rem; background: #0d0a14; }
.weapon-picture img { width: 100%; height: 100%; object-fit: contain; }

.weapon-name { font-family: var(--font-display); font-weight: 700; font-size: 0.6rem; text-transform: uppercase; }
.weapon-grip { font-size: 1.05rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.stat { display: grid; grid-template-columns: 3.6rem 1fr; align-items: center; gap: 0.4rem; font-size: 1.05rem; color: var(--muted); }
.stat-bar { height: calc(var(--px) * 3); background: #0d0a14; border: var(--px) solid var(--ink); box-sizing: content-box; }
.stat-fill { display: block; height: 100%; background: var(--gold); }
.lb-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin: 0 -1.5rem; padding: 0.9rem 1.5rem; border-top: calc(var(--px) * 2) solid var(--ink); background: #0d0a14; }
.lb-status { margin: 0; color: var(--muted); font-size: 1.2rem; flex: 1; min-width: 12rem; }
.lb-actions { display: flex; gap: 0.5rem; }
@media (max-width: 820px) {
  .lb-body { grid-template-columns: 1fr; gap: 0.4rem; }
  .lb-teams { grid-template-columns: 1fr; }
  .lb-vs { flex-direction: row; gap: 0.6rem; }
  .link-input { width: 100%; }
  .menu-card { padding: 1rem 1rem 1.1rem; }
  .lb-footer { margin: 0 -1rem; padding: 0.8rem 1rem; }
  .menu.menu-on-title { background: #0d0a14d0; }
}
@media (max-height: 560px) { .title-screen { justify-content: flex-start; padding-top: 1rem; } .tagline { margin-bottom: 0.8rem; } .nav-item { padding: 0.35rem 0.8rem; } }
@media (pointer: coarse) { .menu .ghost { padding: 0.5rem 0.8rem; } .seat-move { width: 2.4rem; height: 2.4rem; } }
`;
