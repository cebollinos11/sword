import type { MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { ensurePlayStyles } from './styles';

export interface HudNames {
  /** Display name per Fighter index, e.g. ['You', 'AI (Normal)']. */
  readonly fighters: readonly string[];
  /** The Fighter the local player drives (its bar is on the left). */
  readonly localFighter: number;
}

/**
 * The in-match HUD: an HP bar per Fighter and the round score, nothing else.
 * Deliberately no Direction indicator: Directions are read from poses.
 * A short banner announces Duels and the Match result.
 */
export class Hud {
  readonly root = document.createElement('div');
  private readonly bars: { fill: HTMLElement; name: HTMLElement; value: HTMLElement }[] = [];
  private readonly score = document.createElement('div');
  private readonly duel = document.createElement('div');
  private readonly banner = document.createElement('div');
  private order: number[] = [0, 1];
  private bannerUntil = 0;

  constructor(
    container: HTMLElement,
    private readonly tuning: TuningData,
  ) {
    ensurePlayStyles();
    this.root.className = 'hud';
    const top = document.createElement('div');
    top.className = 'hud-top';
    const centre = document.createElement('div');
    centre.className = 'hud-centre';
    this.score.className = 'hud-score';
    this.duel.className = 'hud-duel';
    centre.append(this.score, this.duel);
    for (let side = 0; side < 2; side++) {
      const box = document.createElement('div');
      box.className = `hud-fighter hud-side-${side}`;
      const name = document.createElement('div');
      name.className = 'hud-name';
      const bar = document.createElement('div');
      bar.className = 'hud-bar';
      const fill = document.createElement('div');
      fill.className = 'hud-fill';
      const value = document.createElement('span');
      value.className = 'hud-hp';
      bar.append(fill, value);
      box.append(name, bar);
      this.bars.push({ fill, name, value });
      top.append(box);
      if (side === 0) top.append(centre);
    }
    this.banner.className = 'hud-banner';
    this.root.append(top, this.banner);
    this.root.hidden = true;
    container.append(this.root);
  }

  show(names: HudNames): void {
    this.order = names.localFighter === 0 ? [0, 1] : [1, 0];
    this.order.forEach((fighter, side) => {
      const bar = this.bars[side]!;
      bar.name.textContent = names.fighters[fighter] ?? `Fighter ${fighter + 1}`;
      bar.fill.dataset.fighter = String(fighter);
    });
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

  update(match: MatchState): void {
    const max = this.tuning.fighter.maxHp;
    this.order.forEach((fighter, side) => {
      const hp = Math.max(0, match.duel.fighters[fighter]?.hp ?? 0);
      const bar = this.bars[side]!;
      bar.fill.style.width = `${(100 * hp) / max}%`;
      bar.value.textContent = String(Math.ceil(hp));
    });
    const [a, b] = this.order.map((f) => match.score[f] ?? 0);
    this.score.textContent = `${a} – ${b}`;
    this.duel.textContent = `Duel ${match.duelNumber} · best of ${match.config.bestOf}`;
    if (this.bannerUntil && performance.now() > this.bannerUntil) {
      this.banner.classList.remove('visible');
      this.bannerUntil = 0;
    }
  }
}
