import { arenaOf, doorCounters, exitDoor, FLOOR_ROWS, hallBehind, hallOf, hallRoster, inExitZone, runHall, secondsToTicks, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import type { Lineup } from '../controllers';
import { fighterColours } from '../render/fighterView';
import { doorwayMiddle } from '../render/doorway';
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
  /** The Tuning Data the Match is played with, when not the HUD's own (a Run with knobs: its enemies' difficulties). */
  readonly tuning?: TuningData;
  /** Where a point of the Arena is drawn on screen (CSS px from the top left), or null when it is behind the camera: for the Door labels. */
  readonly project?: (p: { readonly x: number; readonly y: number; readonly z: number }) => { readonly x: number; readonly y: number } | null;
}

/** What the results screen shows at a Run's end. */
export interface RunResult {
  readonly victory: boolean;
  /** Floors cleared (their Boss beaten). */
  readonly cleared: number;
  readonly floors: number;
  /** Halls cleared, Bosses included. */
  readonly halls: number;
  /** Run time, seconds (from `run.startTick` to the Tick it ended). */
  readonly seconds: number;
  readonly seed: number;
}

/** m:ss. */
export function runTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Where a Run's party stands, for the HUD: its Floor (1-based) and the Hall's row (0-based, FLOOR_ROWS − 1 the Boss). */
export interface HallAt {
  readonly floor: number;
  readonly row: number;
}

/** A Hall's banner as the party enters it: `Floor 2 · Hall 3 / 5 · seed N` (Hall counted by row), the Boss's `Boss · Floor 2 / 3`. */
export function hallBanner(at: HallAt, floors: number, seed: number): string {
  return at.row === FLOOR_ROWS - 1 ? `Boss · Floor ${at.floor} / ${floors}` : `${hallScore(at, floors)} · seed ${seed}`;
}

/** Where the party stands, under the top of the screen: `Floor 2 · Hall 3 / 5`, the Boss's `Boss · Floor 2 / 3`. */
export function hallScore(at: HallAt, floors: number): string {
  return at.row === FLOOR_ROWS - 1 ? `Boss · Floor ${at.floor} / ${floors}` : `Floor ${at.floor} · Hall ${at.row + 1} / ${FLOOR_ROWS}`;
}

/** An exit Door's label: the kind of Hall behind it, and while the party gathers in its zone how many of those who count stand there (`2 / 3`). */
export function doorLabel(kind: string, gathered: number, party: number): string {
  return gathered > 0 ? `${kind} · ${gathered} / ${party}` : kind;
}

/**
 * The HP a bar shows: rounded up, so a Fighter still standing never reads 0. Rounded to a millionth first, so a max HP
 * scaled by depth (100 × 1.1 = 110.00000000000001) reads 110, not 111.
 */
export function hpText(hp: number): string {
  return String(Math.ceil(Math.round(Math.max(0, hp) * 1e6) / 1e6));
}

/** A Run's end in one line (the Lobby's note after it): verdict, Floors and Halls cleared, time and seed. */
export function runResultLine(r: RunResult): string {
  const halls = `${r.halls} ${r.halls === 1 ? 'Hall' : 'Halls'} cleared`;
  return `${r.victory ? 'Victory' : 'Defeat'} · ${r.cleared} / ${r.floors} Floors · ${halls} · ${runTime(r.seconds)} · Run seed ${r.seed}`;
}

/** How high over a Door zone's ground (m) its label floats: above the doorway. */
const DOOR_LABEL_HEIGHT = 2.7;

/** An exit Door's label: where it floats (over the doorway), its text, and whether the Door is open (the Hall Cleared). */
export interface DoorMark {
  /** The exit (0-based, as `Hall.exits`; Arena Door `exit + 1`). */
  readonly exit: number;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly text: string;
  readonly open: boolean;
}

/**
 * The labels over a Run's current Hall's exit Doors: each names the Hall behind it (a Boss Hall's, the next Floor), and once
 * the Hall is Cleared counts the party gathering in its zone (`doorCounters`, as the Simulation counts). None in Duels.
 */
export function doorMarks(match: MatchState, tuning: TuningData): DoorMark[] {
  const run = match.run;
  if (!run || match.status.status === 'Over') return [];
  const arena = arenaOf(tuning, match.duel.arena);
  const fighters = match.duel.fighters;
  const open = run.phase !== 'Fighting';
  const counting = open ? doorCounters(match.config, fighters) : [];
  return hallOf(tuning, match.config.arena, runHall(run)).exits.flatMap((_, exit): DoorMark[] => {
    const door = arena.doors[exitDoor(exit)];
    const to = hallBehind(tuning, match.config, run, exit);
    if (!door || !to) return [];
    const kind = to.floor > run.floor ? `Floor ${to.floor}` : hallOf(tuning, match.config.arena, to).kind;
    const gathered = counting.filter((i) => inExitZone(arena, exit, fighters[i]!)).length;
    // Over the doorway (the Wall its zone stands before).
    const middle = doorwayMiddle(door);
    const at = { x: middle.x, y: middle.y + DOOR_LABEL_HEIGHT, z: middle.z };
    return [{ exit, at, text: doorLabel(kind, gathered, counting.length), open }];
  });
}

/**
 * How dark the screen is for the fade between Halls, 0 to 1: rising over `dungeon.hallFadeSeconds` once a Door is taken
 * (fully dark on the fade's last Tick), then falling over as long as the next Hall starts. 0 in Duels and in the Hall a Run starts in.
 */
export function hallFade(match: MatchState, tuning: TuningData): number {
  if (!match.run) return 0;
  const ticks = Math.max(1, secondsToTicks(tuning.dungeon.hallFadeSeconds));
  if (match.nextDuelTick !== null) return Math.min(1, Math.max(0, (ticks - (match.nextDuelTick - match.tick) + 1) / ticks));
  // The Run's first Hall (Hall 1, or a dev start's deeper one) began on the Run's start Tick: no fade before it.
  if (match.tick - match.duel.tick <= match.run.startTick) return 0;
  return Math.max(0, 1 - match.duel.tick / ticks);
}

/** A Fighter's short HUD label: "You", the other human Player by name, an AI by difficulty, or a Run's enemy by its Hall's Encounter's difficulty ("Boss" for a Boss). */
function label(match: MatchState, tuning: TuningData, lineup: Lineup | null, fighter: number, me: number, names: readonly string[] | null | undefined): string {
  if (fighter === me) return 'You';
  if (match.run && match.config.teams[fighter] === 1) {
    const slot = match.config.teams.slice(0, fighter).filter((t) => t === 1).length;
    const enemy = hallRoster(tuning, match.config, runHall(match.run))[slot];
    return match.duel.hall?.kind === 'Boss' && slot === 0 ? 'Boss' : enemy ? `${enemy.difficulty} AI` : '';
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
 * Run, the Floor and Hall). A Benched Fighter has no bar. A short transient banner
 * announces Duels (or Halls) and the Match result; a Run ends on a results screen.
 * In a Run, a label floats over each exit Door, and the screen fades to black between Halls.
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
  /** A Run's Door labels (one element per exit, reused) and the black of the fade between Halls. */
  private readonly doorLayer = document.createElement('div');
  private doorTags: HTMLElement[] = [];
  private readonly fade = document.createElement('div');
  private bars: { fighter: number; box: HTMLElement; fill: HTMLElement; value: HTMLElement }[] = [];
  /** The local Player's dagger icons (one per dagger a Duel starts with) and Slow tag; empty/null until built. */
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
    this.doorLayer.className = 'hud-doors';
    this.fade.className = 'hud-fade';
    // The fade between Halls goes over the Door labels, the letterbox, the HP bars and the crosshair (the next Hall's
    // banner, the menu button and the results screen stay over it).
    this.root.append(this.doorLayer, ...bars, this.top, this.stats, this.crosshair, this.fade, this.banner, this.menu, this.results);
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

  /**
   * The results screen at a Run's end: Victory or Defeat, Floors and Halls cleared, the Run time and the Run seed (to replay or
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
    this.results.replaceChildren(title, line('Floors cleared', `${r.cleared} / ${r.floors}`), line('Halls cleared', String(r.halls)), line('Run time', runTime(r.seconds)), line('Run seed', String(r.seed)));
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
    // A Run's Hall changes who stands in Team 1's slots (and which are Benched): new bars and labels.
    const benched = match.duel.fighters.map((f) => Boolean(f.benched));
    const key = JSON.stringify([teams, me, view.lineup, view.names, match.run ? runHall(match.run) : 0, benched]);
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
    this.score.textContent = match.run ? hallScore(match.run, match.run.floors) : `${match.score[myTeam] ?? 0} – ${match.score[1 - myTeam] ?? 0}`;
    this.updateDoors(match, view);
    this.fade.style.opacity = String(hallFade(match, this.matchTuning ?? this.tuning));
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

  /** A Run's labels over its exit Doors, where the camera sees them (placeholder for Stage 3's Door marks). */
  private updateDoors(match: MatchState, view: HudView): void {
    const marks = view.project ? doorMarks(match, this.matchTuning ?? this.tuning) : [];
    while (this.doorTags.length < marks.length) {
      const tag = document.createElement('div');
      tag.className = 'hud-door';
      this.doorLayer.append(tag);
      this.doorTags.push(tag);
    }
    this.doorTags.forEach((tag, i) => {
      const mark = marks[i];
      const at = mark && view.project!(mark.at);
      tag.hidden = !at;
      if (!mark || !at) return;
      if (tag.textContent !== mark.text) tag.textContent = mark.text;
      tag.classList.toggle('open', mark.open);
      tag.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
    });
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
      name.textContent = label(match, this.matchTuning ?? this.tuning, lineup, fighter, me, names);
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
