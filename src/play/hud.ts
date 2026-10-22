import type { MatchState } from '../sim';
import type { TuningData } from '../tuning';
import type { Lineup } from '../controllers';
import { fighterColours } from '../render/fighterView';
import { ensurePlayStyles } from './styles';

/** What the HUD needs to know about whose eyes it shows the Match through. */
export interface HudView {
  /** The local player's Fighter (-1 while unknown: then team 0 is shown on the left). */
  readonly localFighter: number;
  /** Who fights, for the labels (null while unknown). */
  readonly lineup: Lineup | null;
  /** Round-trip time in ms (a guest's to the host, the host's to its slowest guest); null offline or until measured. */
  readonly ping?: number | null;
  /** Each Player's name (index = Player number), from the Lobby. */
  readonly names?: readonly string[] | null;
}

/** What the results screen shows at a Run's end. */
export interface RunResult {
  readonly victory: boolean;
  readonly cleared: number;
  readonly floors: number;
  /** Run time, seconds (from `run.startTick` to the Tick it ended). */
  readonly seconds: number;
  readonly seed: number;
}

/** m:ss. */
export function runTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The Floor banner of a Run: `Floor 3 / 7 · seed N`, and `Boss` on the last. */
export function floorBanner(floor: number, floors: number, seed: number): string {
  return `${floor === floors ? 'Boss · ' : ''}Floor ${floor} / ${floors} · seed ${seed}`;
}

/** A Fighter's short HUD label: "You", the other human Player by name, an AI by difficulty, or a Run's enemy by its Floor's difficulty ("Boss" for the boss). */
function label(match: MatchState, tuning: TuningData, lineup: Lineup | null, fighter: number, me: number, names: readonly string[] | null | undefined): string {
  if (fighter === me) return 'You';
  const floor = match.run && match.config.teams[fighter] === 1 ? tuning.gauntlet.floors[match.run.floor - 1] : undefined;
  if (floor) {
    const slot = match.config.teams.slice(0, fighter).filter((t) => t === 1).length;
    const enemy = floor.enemies[slot];
    return floor.boss && slot === 0 ? 'Boss' : enemy ? `${enemy.difficulty} AI` : '';
  }
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
 * Run, the Floor). A Benched Fighter has no bar. A short transient banner
 * announces Duels (or Floors) and the Match result; a Run ends on a results screen.
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
  private bars: { fighter: number; box: HTMLElement; fill: HTMLElement; value: HTMLElement }[] = [];
  /** The local Player's dagger icons (one per dagger a Duel starts with) and Slow tag; empty/null until built. */
  private daggerIcons: HTMLElement[] = [];
  private slowTag: HTMLElement | null = null;
  /** What the bars were built for; they are rebuilt when it changes. */
  private built = '';
  private bannerUntil = 0;

  /** `onMenu`: the player clicked the menu button (the in-game menu; Esc does the same). */
  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
    onMenu: () => void,
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
    this.root.append(...bars, this.top, this.banner, this.stats, this.crosshair, this.menu, this.results);
    this.root.hidden = true;
    container.append(this.root);
  }

  show(): void {
    this.built = '';
    this.results.hidden = true;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.results.hidden = true;
  }

  /** The results screen at a Run's end: Victory or Defeat, Floors cleared, the Run time and the Run seed (to replay or share). */
  showResults(r: RunResult): void {
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
    this.results.replaceChildren(title, line('Floors cleared', `${r.cleared} / ${r.floors}`), line('Run time', runTime(r.seconds)), line('Run seed', String(r.seed)));
    this.banner.classList.remove('visible');
    this.bannerUntil = 0;
    this.results.hidden = false;
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
    const teams = match.config.teams;
    const me = view.localFighter;
    const myTeam = teams[me] ?? 0;
    // A Run's Floor changes who stands in Team 1's slots (and which are Benched): new bars and labels.
    const benched = match.duel.fighters.map((f) => Boolean(f.benched));
    const key = JSON.stringify([teams, me, view.lineup, view.names, match.run?.floor ?? 0, benched]);
    if (key !== this.built) this.build(match, me, myTeam, view.lineup, view.names, key);

    for (const bar of this.bars) {
      const f = match.duel.fighters[bar.fighter];
      const hp = Math.max(0, f?.hp ?? 0);
      const max = f?.maxHp ?? this.tuning.fighter.maxHp;
      bar.fill.style.width = `${Math.min(100, (100 * hp) / max)}%`;
      bar.value.textContent = String(Math.ceil(hp));
      bar.box.classList.toggle('fallen', Boolean(f?.death));
    }
    const mine = match.duel.fighters[me];
    this.daggerIcons.forEach((icon, i) => icon.classList.toggle('spent', i >= (mine?.daggers ?? 0)));
    this.slowTag?.classList.toggle('visible', Boolean(mine?.slow));
    this.score.textContent = match.run ? `Floor ${match.run.floor} / ${match.run.floors}` : `${match.score[myTeam] ?? 0} – ${match.score[1 - myTeam] ?? 0}`;
    this.frames++;
    const now = performance.now();
    if (now - this.statsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.statsAt));
      this.frames = 0;
      this.statsAt = now;
      this.stats.textContent = view.ping == null ? `${this.fps} fps` : `${this.fps} fps · ${Math.round(view.ping)} ms`;
    }
    if (this.bannerUntil && performance.now() > this.bannerUntil) {
      this.banner.classList.remove('visible');
      this.bannerUntil = 0;
    }
  }

  /** The local Player's row under their HP bar: a small icon per dagger and a tag shown while a dagger Hit slows them. */
  private buildDaggers(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'hud-daggers';
    for (let i = 0; i < this.tuning.dagger.count; i++) {
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
      name.textContent = label(match, this.tuning, lineup, fighter, me, names);
      const bar = document.createElement('div');
      bar.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = 'hud-fill';
      fill.style.background = css(colours[fighter]!);
      const value = document.createElement('span');
      value.className = 'hud-hp';
      bar.append(fill, value);
      box.append(name, bar);
      if (fighter === me) box.append(this.buildDaggers());
      return { fighter, box, fill, value };
    });
    this.sides.forEach((side, s) => side.replaceChildren(...this.bars.filter((b) => (teams[b.fighter] === myTeam) === (s === 0)).map((b) => b.box)));
  }
}
