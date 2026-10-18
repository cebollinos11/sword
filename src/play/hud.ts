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
  /** Round-trip time to the opponent in ms; null offline or until measured. */
  readonly ping?: number | null;
  /** Each Player's name (index = Player number), from the Lobby. */
  readonly names?: readonly string[] | null;
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
 * label; the score reads your team's Duels first. A short transient banner
 * announces Duels and the Match result.
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
    this.root.append(this.top, this.banner, this.stats, this.crosshair, this.menu);
    this.root.hidden = true;
    container.append(this.root);
  }

  show(): void {
    this.built = '';
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
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
    const key = JSON.stringify([teams, me, view.lineup, view.names]);
    if (key !== this.built) this.build(teams, me, myTeam, view.lineup, view.names, key);

    const max = this.tuning.fighter.maxHp;
    for (const bar of this.bars) {
      const f = match.duel.fighters[bar.fighter];
      const hp = Math.max(0, f?.hp ?? 0);
      bar.fill.style.width = `${(100 * hp) / max}%`;
      bar.value.textContent = String(Math.ceil(hp));
      bar.box.classList.toggle('fallen', Boolean(f?.death));
    }
    const mine = match.duel.fighters[me];
    this.daggerIcons.forEach((icon, i) => icon.classList.toggle('spent', i >= (mine?.daggers ?? 0)));
    this.slowTag?.classList.toggle('visible', Boolean(mine?.slow));
    this.score.textContent = `${match.score[myTeam] ?? 0} – ${match.score[1 - myTeam] ?? 0}`;
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

  private build(teams: readonly number[], me: number, myTeam: number, lineup: Lineup | null, names: readonly string[] | null | undefined, key: string): void {
    this.built = key;
    const colours = fighterColours(teams);
    // Left: your team, you first; right: the enemy team. Otherwise in Fighter order.
    const order = teams.map((_, i) => i).sort((a, b) => Number(b === me) - Number(a === me) || a - b);
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
      if (fighter === me) box.append(this.buildDaggers());
      return { fighter, box, fill, value };
    });
    this.sides.forEach((side, s) => side.replaceChildren(...this.bars.filter((b) => (teams[b.fighter] === myTeam) === (s === 0)).map((b) => b.box)));
  }
}
