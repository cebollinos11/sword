import { inDuel, secondsToTicks, TICK_SECONDS, traitorOf, type Item, type MatchState } from '../sim';
import { floorOf } from '../sim/delver';
import { isBossFloor, tierOf } from '../sim/delver/troops';
import { RARITIES, type DelverTuning, type TuningData } from '../tuning';
import type { Lineup } from '../controllers';
import type { Ping } from '../net';
import { fighterColours } from '../render/fighterView';
import { Minimap } from '../render/minimap';
import { pickupLabels, type PickupView } from '../render/pickupView';
import { rarityClass } from '../render/rarityColours';
import { delverMapStatus, viewReveal } from './floorMap';
import { FloorMapView } from './floorMapView';
import { itemIconId, relicIcon, weaponIcon } from './icons';
import { pickupInfoLines } from './inventoryView';
import { daggerCapacity, type RunBuild } from './runBuilds';
import { ensurePlayStyles } from './styles';

/** What the HUD needs to know about whose eyes it shows the Match through. */
export interface HudView {
  /** The local player's Fighter (-1 while unknown: then team 0 is shown on the left). */
  readonly localFighter: number;
  /** Who fights, for the labels (null while unknown). */
  readonly lineup: Lineup | null;
  /** Round-trip time, split into network and CPU (a guest's to the host, the host's to its slowest guest); null offline or until measured. */
  readonly ping?: Ping | null;
  /** Each Player's name (index = Player number), from the Lobby. */
  readonly names?: readonly string[] | null;
  /** The Tuning Data the Match is played with, when not the HUD's own (a Run with knobs: its enemies' difficulties). */
  readonly tuning?: TuningData;
  /** How the pickups are drawn this frame (`pickupViews`): the one labelled shows its name. Absent: none. */
  readonly pickups?: readonly PickupView[];
  /** Where a point of the Arena is drawn on screen (CSS px from the top left), or null when it is behind the camera: for the pickup labels. */
  readonly project?: (p: { readonly x: number; readonly y: number; readonly z: number }) => { readonly x: number; readonly y: number } | null;
}

/** What the results screen shows at a Run's end. */
export interface RunResult {
  readonly victory: boolean;
  readonly floors: number;
  /** The Bosses beaten (`RunEnd.bosses`) of `bossTotal` (the tiers with a Boss); absent in a Run whose Tuning has no Boss: no Bosses part is shown. */
  readonly bosses?: number;
  readonly bossTotal?: number;
  /** The Floor the party reached (1-based; the last Floor's, in a Victory): "Floors reached". */
  readonly reached: number;
  /** The Warbands beaten (`RunEnd.warbands`). */
  readonly warbands: number;
  /** Run time, seconds (from `run.startTick` to the Tick it ended). */
  readonly seconds: number;
  readonly seed: number;
  /** Each Player's build at the Run's end (`runBuilds`), under the numbers; absent or empty: none shown. */
  readonly builds?: readonly RunBuild[];
  /** A Delver Run's traitors (docs/plans/delver.md, Stage 8a): each one's name, kills and deaths, under the builds; absent or empty: none shown. */
  readonly traitors?: readonly TraitorResult[];
}

/** One traitor's line on a Delver Run's results screen. */
export interface TraitorResult {
  readonly name: string;
  readonly kills: number;
  readonly deaths: number;
}

/** A traitor's results line: its kills and deaths. */
export const traitorLine = (t: TraitorResult): string => `${t.kills} ${t.kills === 1 ? 'kill' : 'kills'} · ${t.deaths} ${t.deaths === 1 ? 'death' : 'deaths'}`;

/**
 * What a watching traitor reads (docs/plans/delver.md, Stage 8a): the seconds until it takes over a Soldier, or that it is looking for one;
 * null for anyone else, and for a traitor whose Fighter is in the Duel (or who left). Render only.
 */
export function traitorWatchLine(match: MatchState, me: number): string | null {
  const j = traitorOf(match.config, me);
  const record = j >= 0 ? match.delver?.traitors?.[j] : undefined;
  const f = match.duel.fighters[me];
  if (!record || record.away || !f || (inDuel(f) && !f.death) || match.status.status === 'Over') return null;
  const seconds = Math.ceil((record.next - match.duel.tick) * TICK_SECONDS);
  return seconds > 0 ? `Taking over a Soldier in ${seconds} s` : 'Looking for a Soldier out of sight…';
}

/** m:ss. */
export function runTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The HP a bar shows: rounded up, so a Fighter still standing never reads 0. Rounded to a millionth first, so a max HP
 * scaled by depth (100 × 1.1 = 110.00000000000001) reads 110, not 111.
 */
/** The HUD's corner counter: frames per second, and online the ping with its network and CPU parts (ms) and the Input Delay (Ticks). */
export function statsText(fps: number, ping: Ping | null | undefined): string {
  if (ping == null) return `${fps} fps`;
  return `${fps} fps · ${Math.round(ping.total)} ms (net ${Math.round(ping.network)} · cpu ${Math.round(ping.cpu)}) · delay ${ping.inputDelay}`;
}

export function hpText(hp: number): string {
  return String(Math.ceil(Math.round(Math.max(0, hp) * 1e6) / 1e6));
}

/**
 * A Delver Run's line under the top of the screen: `Floor 2 of tier 1 (2 / 9)`, and `Boss Floor` after it on a Boss Floor (the last of a tier
 * that has a Boss). `floor` is 1-based, the Floors of a tier `delver.floorsPerTier`.
 */
export function delverScore(delver: DelverTuning, floor: number, floors: number): string {
  const inTier = ((floor - 1) % delver.floorsPerTier) + 1;
  const line = `Floor ${inTier} of tier ${tierOf(delver, floor)} (${floor} / ${floors})`;
  return isBossFloor(delver, floor) ? `${line} · Boss Floor` : line;
}

/** A Run's Bosses part of its results, "Bosses b / B", or none (a Tuning without a Boss). */
const bossesPart = (r: RunResult): string[] => (r.bosses === undefined || r.bossTotal === undefined ? [] : [`Bosses ${r.bosses} / ${r.bossTotal}`]);

/** A Run's end in one line (the Lobby's note after it): verdict, Floor reached, Warbands and Bosses beaten, time and seed. */
export function runResultLine(r: RunResult): string {
  return [r.victory ? 'Victory' : 'Defeat', `Floor ${r.reached} / ${r.floors}`, `Warbands ${r.warbands}`, ...bossesPart(r), runTime(r.seconds), `Run seed ${r.seed}`].join(' · ');
}

/**
 * How dark the screen is for the fade between Floors, 0 to 1: rising over `dungeon.fadeSeconds` once the Stairs are taken (`nextDuelTick`,
 * fully dark on the fade's last Tick), then falling over as long as the next Floor starts. 0 in Duels and on the Floor a Run starts on.
 */
export function floorFade(match: MatchState, tuning: TuningData): number {
  const first = match.delver?.startTick;
  if (first === undefined) return 0;
  const ticks = Math.max(1, secondsToTicks(tuning.dungeon.fadeSeconds));
  if (match.nextDuelTick !== null) return Math.min(1, Math.max(0, (ticks - (match.nextDuelTick - match.tick) + 1) / ticks));
  // The Run's first Floor (Floor 1, or a dev start's deeper one) began on the Run's start Tick: no fade before it.
  if (match.tick - match.duel.tick <= first) return 0;
  return Math.max(0, 1 - match.duel.tick / ticks);
}

/** A Fighter's short HUD label: "You", the other human Player by name, or an AI by difficulty. */
function label(lineup: Lineup | null, fighter: number, me: number, names: readonly string[] | null | undefined): string {
  if (fighter === me) return 'You';
  const pilot = lineup?.[fighter]?.pilot;
  if (!pilot) return '';
  return pilot.kind === 'Player' ? (names?.[pilot.player] ?? `Player ${pilot.player + 1}`) : `${pilot.difficulty} AI`;
}

const css = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/**
 * The in-match HUD: an HP bar per Fighter, the round score and a centre dot
 * crosshair (purely visual), nothing else (story 19): no Duel counter, and deliberately no Direction indicator
 * (Directions are read from poses). Your team stands on the left (you first),
 * the enemy team on the right, each bar in its Fighter's colour with a short
 * label, filled to its own max HP; the score reads your team's Duels first (in a
 * Run, the Floor and its tier). A Benched Fighter has no bar. A short transient banner
 * announces Duels (or Floors) and the Match result; a Run ends on a results screen.
 * In a Run the screen fades to black between Floors.
 */
export class Hud {
  readonly root = document.createElement('div');
  private readonly top = document.createElement('div');
  private readonly sides = [document.createElement('div'), document.createElement('div')];
  private readonly score = document.createElement('div');
  private readonly stats = document.createElement('div');
  private frames = 0;
  private statsAt = 0;
  private fps = 0;
  private readonly banner = document.createElement('div');
  private readonly crosshair = document.createElement('div');
  private readonly menu = document.createElement('button');
  private readonly results = document.createElement('div');
  /** A Run's pickup labels (one element per pickup seen, reused). */
  private readonly pickupLayer = document.createElement('div');
  /** The pickup labels, pooled: each one's box, name and info lines, and what it last showed (`kind|name|rarity`), to redraw only on change. */
  private pickupTags: { readonly tag: HTMLElement; readonly name: HTMLElement; readonly info: HTMLElement; key: string }[] = [];
  /** The Floor map screen (`M`, or the map button on touch) and that button. */
  readonly map = new FloorMapView();
  private readonly mapButton = document.createElement('button');
  private readonly fade = document.createElement('div');
  /** A Delver Run's minimap (revealed Halls only), drawn in a corner; hidden outside a Delver Run. */
  private readonly delverMap = document.createElement('div');
  private minimap: Minimap | null = null;
  private wasDescending = false;
  private bars: { fighter: number; box: HTMLElement; fill: HTMLElement; value: HTMLElement }[] = [];
  /** The local Player's dagger icons (one per dagger the Fighter starts a Duel with, its `mods.daggers` counted; rebuilt when that changes) and Slow tag; empty/null until built. */
  private daggerIcons: HTMLElement[] = [];
  private slowTag: HTMLElement | null = null;
  /** What the bars were built for; they are rebuilt when it changes. */
  private built = '';
  /** The Tuning Data the Match is played with (`HudView.tuning`), for the labels; null: the HUD's own. */
  private matchTuning: TuningData | null = null;
  private bannerUntil = 0;

  /** `onMenu`: the player clicked the menu button (the in-game menu; Esc does the same). */
  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
    onMenu: () => void,
    onMap: () => void = () => undefined,
  ) {
    ensurePlayStyles();
    this.root.className = 'hud';
    this.top.className = 'hud-top';
    const centre = document.createElement('div');
    centre.className = 'hud-centre';
    this.score.className = 'hud-score';
    this.menu.type = 'button';
    this.menu.className = 'hud-menu';
    this.menu.textContent = '☰';
    this.menu.title = 'Menu (Esc)';
    this.menu.setAttribute('aria-label', 'Menu');
    this.menu.addEventListener('click', onMenu);
    this.mapButton.type = 'button';
    this.mapButton.id = 'hud-map-button';
    this.mapButton.className = 'hud-map';
    this.mapButton.textContent = '🗺';
    this.mapButton.title = 'Floor map (M)';
    this.mapButton.setAttribute('aria-label', 'Floor map');
    this.mapButton.hidden = true;
    this.mapButton.addEventListener('click', onMap);
    this.map.onClose = onMap;
    centre.append(this.score);
    this.sides.forEach((side, i) => (side.className = `hud-team hud-side-${i}`));
    this.top.append(this.sides[0]!, centre, this.sides[1]!);
    this.banner.className = 'hud-banner';
    this.stats.className = 'hud-stats';
    this.crosshair.className = 'hud-crosshair';
    const bars = [document.createElement('div'), document.createElement('div')];
    bars.forEach((bar, i) => (bar.className = `hud-letterbox hud-letterbox-${i}`));
    this.results.className = 'hud-results';
    this.results.hidden = true;
    this.pickupLayer.className = 'hud-doors';
    this.fade.className = 'hud-fade';
    this.delverMap.className = 'hud-delver-map';
    this.delverMap.hidden = true;
    // The fade between Floors goes over the letterbox, the HP bars and the crosshair (the next Floor's
    // banner, the menu button and the results screen stay over it).
    this.root.append(this.pickupLayer, ...bars, this.top, this.delverMap, this.stats, this.crosshair, this.map.el, this.fade, this.banner, this.menu, this.mapButton, this.results);
    this.root.hidden = true;
    container.append(this.root);
  }

  show(): void {
    this.built = '';
    this.results.hidden = true;
    this.root.hidden = false;
  }

  /** Show the Floor map, or hide it; it shows only in a Run. Returns whether it is open. */
  setMapOpen(open: boolean): boolean {
    this.map.setOpen(open);
    return this.map.open;
  }

  hide(): void {
    this.map.setOpen(false);
    this.root.hidden = true;
    this.results.hidden = true;
  }

  /**
   * The results screen at a Run's end: Victory or Defeat, Floors reached, Warbands and Bosses beaten, the Run time and the Run seed (to replay or
   * share). `note`: what comes next, online (the host's Restart or the Lobby), under it.
   */
  showResults(r: RunResult, note?: string): void {
    const line = (k: string, v: string) => {
      const row = document.createElement('div');
      row.className = 'hud-results-row';
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('b');
      b.textContent = v;
      row.append(a, b);
      return row;
    };
    const title = document.createElement('div');
    title.className = `hud-results-title ${r.victory ? 'victory' : 'defeat'}`;
    title.textContent = r.victory ? 'Victory' : 'Defeat';
    this.results.replaceChildren(title, line('Floors reached', `${r.reached} / ${r.floors}`), line('Warbands beaten', String(r.warbands)), ...(r.bosses === undefined || r.bossTotal === undefined ? [] : [line('Bosses', `${r.bosses} / ${r.bossTotal}`)]), line('Run time', runTime(r.seconds)), line('Run seed', String(r.seed)));
    if (r.builds?.length) this.results.append(...this.buildRows(r.builds));
    for (const t of r.traitors ?? []) this.results.append(line(`Traitor ${t.name}`, traitorLine(t)));
    if (note) {
      const next = document.createElement('p');
      next.className = 'hud-results-note';
      next.textContent = note;
      this.results.append(next);
    }
    this.banner.classList.remove('visible');
    this.bannerUntil = 0;
    this.results.hidden = false;
  }

  /** The results screen's builds: per Player the Weapon wielded and the Relics equipped (icon and name), the Relics carried smaller. */
  private buildRows(builds: readonly RunBuild[]): HTMLElement[] {
    const tuning = this.matchTuning ?? this.tuning;
    const item = (svg: string, { name, rarity }: Item, small = false) => {
      const el = document.createElement('span');
      el.className = `hud-build-item${small ? ' carried' : ''} ${rarityClass(rarity)}`.trim();
      const icon = document.createElement('i');
      icon.innerHTML = svg;
      el.append(icon, name);
      return el;
    };
    const relic = (it: Item, small = false) => item(relicIcon(itemIconId(tuning, it.name)), it, small);
    return builds.map((b) => {
      const box = document.createElement('div');
      box.className = 'hud-build';
      const who = document.createElement('div');
      who.className = 'hud-build-who';
      who.textContent = builds.length > 1 ? b.name : 'Build';
      const row = document.createElement('div');
      row.className = 'hud-build-row';
      row.append(item(weaponIcon(b.weapon.name), b.weapon), ...b.equipped.map((n) => relic(n)));
      box.append(who, row);
      if (b.carried.length) {
        const carried = document.createElement('div');
        carried.className = 'hud-build-row';
        carried.append(...b.carried.map((n) => relic(n, true)));
        box.append(carried);
      }
      return box;
    });
  }

  /** Letterbox the view and hide the bars and crosshair (the Final Blow Shot), or show them again. */
  cinematic(on: boolean): void {
    this.root.classList.toggle('hud-cinematic', on);
  }

  /** Show a message in the middle of the screen for `seconds` (wall clock, cosmetic only). */
  announce(text: string, seconds = 2): void {
    this.banner.textContent = text;
    this.banner.classList.add('visible');
    this.bannerUntil = performance.now() + seconds * 1000;
  }

  update(match: MatchState, view: HudView): void {
    this.matchTuning = view.tuning ?? null;
    const teams = match.config.teams;
    const me = view.localFighter;
    const myTeam = teams[me] ?? 0;
    // Who is Benched changes the bars and labels.
    const benched = match.duel.fighters.map((f) => Boolean(f.benched));
    const key = JSON.stringify([teams, me, view.lineup, view.names, benched, daggerCapacity(this.matchTuning ?? this.tuning, match.duel.fighters[me])]);
    if (key !== this.built) this.build(match, me, myTeam, view.lineup, view.names, key);

    for (const bar of this.bars) {
      const f = match.duel.fighters[bar.fighter];
      const hp = Math.max(0, f?.hp ?? 0);
      const max = f?.maxHp ?? this.tuning.fighter.maxHp;
      bar.fill.style.width = `${Math.min(100, (100 * hp) / max)}%`;
      bar.value.textContent = hpText(hp);
      bar.box.classList.toggle('fallen', Boolean(f?.death));
    }
    const mine = match.duel.fighters[me];
    this.daggerIcons.forEach((icon, i) => icon.classList.toggle('spent', i >= (mine?.daggers ?? 0)));
    this.slowTag?.classList.toggle('visible', Boolean(mine?.slow));
    const tuning = this.matchTuning ?? this.tuning;
    this.score.textContent = match.delver ? delverScore(tuning.delver, match.delver.floor, match.delver.floors) : `${match.score[myTeam] ?? 0} – ${match.score[1 - myTeam] ?? 0}`;
    this.mapButton.hidden = !match.delver;
    this.map.setMe(me);
    this.map.update(match, tuning);
    this.updateDelverMap(match, me, tuning);
    this.updatePickups(match, view);
    this.fade.style.opacity = String(floorFade(match, this.matchTuning ?? this.tuning));
    this.frames++;
    const now = performance.now();
    if (now - this.statsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.statsAt));
      this.frames = 0;
      this.statsAt = now;
      this.stats.textContent = statsText(this.fps, view.ping);
    }
    if (this.bannerUntil && performance.now() > this.bannerUntil) {
      this.banner.classList.remove('visible');
      this.bannerUntil = 0;
    }
  }

  /** A Delver Run's minimap in its corner (drawn from the Reveal), and the "Descending…" banner as the fade to the next Floor begins. */
  private updateDelverMap(match: MatchState, me: number, tuning: TuningData): void {
    const run = match.delver;
    this.delverMap.hidden = !run || match.status.status === 'Over';
    const descending = run?.phase === 'Descending';
    if (descending && !this.wasDescending) this.announce('Descending…', Math.max(1, tuning.dungeon.fadeSeconds));
    this.wasDescending = descending;
    if (!run || this.delverMap.hidden) return;
    const plan = floorOf(tuning, match.duel.arena)?.plan;
    if (!plan) return;
    if (!this.minimap) {
      this.minimap = new Minimap(tuning.battle, 150);
      this.delverMap.append(this.minimap.canvas);
    }
    this.minimap.drawDelver(plan, viewReveal(match, plan, me), match.duel.fighters, me, delverMapStatus(match, plan));
  }

  /** A Run's labels over the pickups the local Player sees: the one aimed at (or the nearest) shows the item's name, what it is and what it does. */
  private updatePickups(match: MatchState, view: HudView): void {
    const marks = view.project && match.status.status !== 'Over' ? pickupLabels(view.pickups ?? []) : [];
    while (this.pickupTags.length < marks.length) {
      const tag = document.createElement('div');
      tag.className = 'hud-door hud-pickup';
      const name = document.createElement('div');
      name.className = 'hud-pickup-name';
      const info = document.createElement('div');
      info.className = 'hud-pickup-info';
      tag.append(name, info);
      this.pickupLayer.append(tag);
      this.pickupTags.push({ tag, name, info, key: '' });
    }
    const tuning = this.matchTuning ?? this.tuning;
    this.pickupTags.forEach((slot, i) => {
      const { tag } = slot;
      const mark = marks[i];
      const at = mark && view.project!(mark.at);
      tag.hidden = !at;
      if (!mark || !at) return;
      const key = `${mark.kind}|${mark.text}|${mark.rarity}`;
      if (slot.key !== key) {
        slot.key = key;
        slot.name.textContent = mark.text;
        slot.info.replaceChildren(
          ...pickupInfoLines(tuning, mark.kind, mark.text, mark.rarity).map((line) => {
            const el = document.createElement('div');
            el.textContent = line;
            return el;
          }),
        );
      }
      tag.classList.toggle('relic', mark.kind === 'relic');
      for (const r of RARITIES) if (r !== 'Common') tag.classList.toggle(rarityClass(r), r === mark.rarity);
      tag.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
    });
  }

  /** The local Player's row under their HP bar: a small icon per dagger and a tag shown while a dagger Hit slows them. */
  private buildDaggers(count: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'hud-daggers';
    for (let i = 0; i < count; i++) {
      const icon = document.createElement('span');
      icon.className = 'hud-dagger';
      this.daggerIcons.push(icon);
      row.append(icon);
    }
    const slow = document.createElement('span');
    slow.className = 'hud-slow';
    slow.textContent = 'Slowed';
    this.slowTag = slow;
    row.append(slow);
    return row;
  }

  private build(match: MatchState, me: number, myTeam: number, lineup: Lineup | null, names: readonly string[] | null | undefined, key: string): void {
    this.built = key;
    const teams = match.config.teams;
    const colours = fighterColours(teams);
    // Left: your team, you first; right: the enemy team. Otherwise in Fighter order. No bar for a Benched slot.
    const order = teams
      .map((_, i) => i)
      .filter((i) => !match.duel.fighters[i]?.benched)
      .sort((a, b) => Number(b === me) - Number(a === me) || a - b);
    this.daggerIcons = [];
    this.slowTag = null;
    this.bars = order.map((fighter) => {
      const box = document.createElement('div');
      box.className = 'hud-fighter';
      if (fighter === me) box.classList.add('hud-you');
      const name = document.createElement('div');
      name.className = 'hud-label';
      name.textContent = label(lineup, fighter, me, names);
      const bar = document.createElement('div');
      bar.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = 'hud-fill';
      fill.style.background = css(colours[fighter]!);
      const value = document.createElement('span');
      value.className = 'hud-hp';
      bar.append(fill, value);
      box.append(name, bar);
      if (fighter === me) box.append(this.buildDaggers(daggerCapacity(this.matchTuning ?? this.tuning, match.duel.fighters[me])));
      return { fighter, box, fill, value };
    });
    this.sides.forEach((side, s) => side.replaceChildren(...this.bars.filter((b) => (teams[b.fighter] === myTeam) === (s === 0)).map((b) => b.box)));
  }
}
