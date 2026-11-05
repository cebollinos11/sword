/**
 * A Battle's HUD (docs/plans/big-battle.md, Stage 5; docs/plans/battle-objectives.md, Stage 2b): each army's Tickets (and, under
 * them, its Soldiers against the Rout threshold), what the Player's army is doing ("your army is attacking B"), the Player's HP (and
 * whether they fight as their own Fighter or as a Soldier they took over), the minimap in a corner, banners (a Rout, a fall, a
 * takeover, being out) and the results screen (the winner, Tickets left, Objectives held, the Player's kills, the Soldiers they took over).
 * Render only: it reads the Match state each frame.
 */
import {
  battlefieldOf,
  crowdAlive,
  inDuel,
  owned,
  RESPAWN,
  TICK_SECONDS,
  type BattlePlayer,
  type CrowdState,
  type MapObjective,
  type MatchState,
  type SimState,
} from '../sim';
import { startingTickets, type BattleTuning } from '../tuning';
import { Minimap } from '../render/minimap';
import { objectiveLetter } from '../render/objectiveMarks';

/** One army's strength: its Tickets (and their share of the start), Soldiers living (and their share of the army), and whether it has routed. */
export interface ArmyStrength {
  readonly tickets: number;
  readonly ticketShare: number;
  readonly alive: number;
  readonly share: number;
  readonly routed: boolean;
}

/** Each army's strength, [Team 0, Team 1]. */
export function armyStrengths(crowd: CrowdState, battle: BattleTuning): [ArmyStrength, ArmyStrength] {
  const alive = crowdAlive(crowd);
  const start = startingTickets(battle);
  const of = (team: 0 | 1): ArmyStrength => {
    const tickets = Math.ceil(crowd.tickets[team]!);
    return { tickets, ticketShare: Math.min(1, tickets / start), alive: alive[team], share: alive[team] / battle.armySize, routed: crowd.rout?.team === team };
  };
  return [of(0), of(1)];
}

/** What an Objective is called to Team `team`: its letter, or, for a Home Objective, whose it is. */
export function objectiveName(site: MapObjective, team: number): string {
  return objectiveLetter(site) === 'H' ? (site.owner === team ? 'your Home' : 'the enemy Home') : site.id;
}

/**
 * What Team `team`'s army is doing, for the HUD's line (flavour only): the Objective most of its Squads are sent to, as "attacking B" or
 * "defending your Home", then the next most, if any; "regrouping" when none is on its way. Squads that are empty, falling back or
 * awaiting Orders count for nothing. A tie goes to the lower Objective. It attacks what it does not own and defends what it does.
 */
export function armyPlan(crowd: CrowdState, sites: readonly MapObjective[], team: number): string {
  const s = crowd.squads;
  const sent = sites.map(() => 0);
  for (let q = 0; q < s.team.length; q++) {
    if (s.team[q] !== team || s.living[q] === 0 || s.fall[q] || s.order[q] === RESPAWN || s.target[q]! >= sites.length) continue;
    sent[s.target[q]!]!++;
  }
  const ranked = sent.flatMap((n, k) => (n > 0 ? [k] : [])).sort((a, b) => sent[b]! - sent[a]! || a - b);
  if (ranked.length === 0) return 'regrouping';
  const phrase = (k: number) => `${crowd.objectives.owner[k] === team ? 'defending' : 'attacking'} ${objectiveName(sites[k]!, team)}`;
  return ranked.length === 1 ? phrase(ranked[0]!) : `${phrase(ranked[0]!)} and ${phrase(ranked[1]!)}`;
}

/** Where the Player stands: fighting (their own Fighter or a Soldier), fallen (about to take over an ally), or out (their army has no Soldier left). */
export type PlayerStatus = 'Fighting' | 'Fallen' | 'Out';

export function playerStatus(state: SimState, me: number): PlayerStatus {
  const f = state.fighters[me];
  if (!f || inDuel(f)) return 'Fighting';
  const crowd = state.crowd;
  return crowd && crowdAlive(crowd)[f.team as 0 | 1] > 0 ? 'Fallen' : 'Out';
}

/** The Player's record in a Battle (none outside one). */
export function playerRecord(state: SimState, me: number): BattlePlayer | null {
  return state.crowd?.players[me] ?? null;
}

/** A finished Battle as the results screen tells it. */
export interface BattleResult {
  readonly victory: boolean;
  /** The winning army: 0 red, 1 blue. */
  readonly winner: number;
  readonly kills: number;
  readonly taken: number;
  /** Each army's Soldiers left standing. */
  readonly left: readonly [number, number];
  /** Each army's Tickets left, and the Objectives each holds at the end. */
  readonly tickets: readonly [number, number];
  readonly held: readonly [number, number];
  readonly seconds: number;
}

/** The result of a Battle that is over, from Fighter `me`'s side, or null while it goes on. */
export function battleResult(match: MatchState, me: number): BattleResult | null {
  if (match.status.status !== 'Over' || !match.duel.crowd) return null;
  const team = match.config.teams[me] ?? 0;
  const record = playerRecord(match.duel, me);
  return {
    victory: match.status.winner === team,
    winner: match.status.winner,
    kills: record?.kills ?? 0,
    taken: record?.taken ?? 0,
    left: crowdAlive(match.duel.crowd),
    tickets: [Math.ceil(match.duel.crowd.tickets[0]!), Math.ceil(match.duel.crowd.tickets[1]!)],
    held: [owned(match.duel.crowd.objectives, 0), owned(match.duel.crowd.objectives, 1)],
    seconds: match.status.tick * TICK_SECONDS,
  };
}

export const ARMY_NAMES = ['red', 'blue'] as const;

/**
 * What each Player has (a name, a Body), by Fighter slot: a Battle's Lineup names only its Players, so slot k is Lineup entry k, whose
 * Player number says which of the Lobby's `perPlayer` entries it is. The Lobby's Lineup orders the Fighters Team by Team, so a Player's
 * number and slot differ whenever Team 1's Player sits before Team 0's in the Members' order (the host on Team 2, say).
 */
export function playersBySlot<T>(lineup: readonly { readonly pilot: { readonly kind: string; readonly player?: number } }[], perPlayer: readonly T[]): (T | undefined)[] {
  return lineup.map((slot) => (slot.pilot.kind === 'Player' ? perPlayer[slot.pilot.player!] : undefined));
}

/** One line for the Lobby after a Battle. */
export function battleResultLine(r: BattleResult): string {
  return `${r.victory ? 'Victory' : 'Defeat'}: the ${ARMY_NAMES[r.winner]} army won · ${r.tickets[0]} v ${r.tickets[1]} Tickets · ${r.kills} ${r.kills === 1 ? 'kill' : 'kills'} · ${r.taken} ${r.taken === 1 ? 'soldier' : 'soldiers'} taken over`;
}

export const BATTLE_HUD_CSS = `
.battle-armies { position: absolute; top: 0.8rem; left: 50%; transform: translateX(-50%); width: min(30rem, 70vw); display: flex; flex-direction: column; gap: 0.3rem; }
.battle-army { position: relative; height: 1.1rem; background: #0008; border: 1px solid #fff4; border-radius: 4px; overflow: hidden; }
.battle-army-fill { position: absolute; inset: 0 auto 0 0; background: var(--army); transition: width 200ms; }
.battle-army.routed .battle-army-fill { opacity: 0.45; }
.battle-army-men { position: absolute; inset: auto 0 0 0; height: 3px; background: #0006; }
.battle-army-men-fill { position: absolute; inset: 0 auto 0 0; background: #fffc; transition: width 200ms; }
.battle-army-rout { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; box-shadow: 0 0 2px #000; }
.battle-plan { text-align: center; font-size: 0.78rem; text-shadow: 0 1px 2px #000; opacity: 0.9; }
.battle-army-label { position: absolute; inset: 0; padding: 0 0.4rem; font-size: 0.72rem; line-height: 1.1rem; text-shadow: 0 1px 2px #000; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
.battle-me { position: absolute; left: 1rem; bottom: 1rem; width: min(16rem, 40vw); display: flex; flex-direction: column; gap: 0.25rem; text-shadow: 0 1px 2px #000a; }
.battle-me-who { font-size: 0.8rem; opacity: 0.85; }
.battle-me .hud-bar { position: relative; height: 1.1rem; background: #0008; border: 1px solid #fff4; border-radius: 4px; overflow: hidden; }
.battle-me .hud-fill { position: absolute; inset: 0 auto 0 0; background: #e8c547; }
.battle-map { position: absolute; right: 1rem; bottom: 1rem; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px #0008; }
.battle-map-key { position: absolute; right: 1rem; bottom: calc(1rem + 182px); font-size: 0.65rem; opacity: 0.7; text-shadow: 0 1px 2px #000; }
@media (max-width: 640px) { .battle-map canvas { width: 120px !important; height: 120px !important; } .battle-map-key { bottom: calc(1rem + 122px); } }
`;

/** The Battle's HUD over the game's canvas. */
export class BattleHud {
  readonly root = document.createElement('div');
  private readonly armies: { bar: HTMLElement; fill: HTMLElement; men: HTMLElement; label: HTMLElement; count: HTMLElement }[] = [];
  private readonly plan = document.createElement('div');
  /** The map's Objectives, found once (the Battlefield never changes): for the plan's line. */
  private sites: { readonly arena: string; readonly objectives: readonly MapObjective[] } | null = null;
  private readonly who = document.createElement('div');
  private readonly hpFill = document.createElement('div');
  private readonly hpText = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly results = document.createElement('div');
  private readonly map = document.createElement('div');
  private readonly minimap: Minimap;
  private bannerUntil = 0;
  private mapShown = true;
  private readonly stats = document.createElement('div');
  private frames = 0;
  private statsAt = 0;

  constructor(
    container: HTMLElement,
    private readonly battle: BattleTuning,
  ) {
    this.root.className = 'hud battle-hud';
    const strip = document.createElement('div');
    strip.className = 'battle-armies';
    for (const team of [0, 1]) {
      const bar = document.createElement('div');
      bar.className = 'battle-army';
      bar.style.setProperty('--army', `#${battle.soldier.colours[team]!.toString(16).padStart(6, '0')}`);
      const fill = document.createElement('div');
      fill.className = 'battle-army-fill';
      // Under the Tickets, a thin strip of the army's Soldiers; its mark is the Rout threshold, which bites only once the Tickets are gone.
      const men = document.createElement('div');
      men.className = 'battle-army-men';
      const menFill = document.createElement('div');
      menFill.className = 'battle-army-men-fill';
      men.append(menFill);
      const rout = document.createElement('div');
      rout.className = 'battle-army-rout';
      rout.style.left = `${battle.rout.threshold * 100}%`;
      rout.title = 'Rout: an army with no Tickets left breaks when its Soldiers fall below this';
      men.append(rout);
      const label = document.createElement('div');
      label.className = 'battle-army-label';
      const name = document.createElement('span');
      const count = document.createElement('span');
      label.append(name, count);
      bar.append(fill, men, label);
      strip.append(bar);
      this.armies.push({ bar, fill, men: menFill, label: name, count });
    }
    this.plan.className = 'battle-plan';
    strip.append(this.plan);
    const me = document.createElement('div');
    me.className = 'battle-me';
    this.who.className = 'battle-me-who';
    const bar = document.createElement('div');
    bar.className = 'hud-bar';
    this.hpFill.className = 'hud-fill';
    this.hpText.className = 'hud-hp';
    bar.append(this.hpFill, this.hpText);
    me.append(this.who, bar);
    this.banner.className = 'hud-banner';
    this.results.className = 'hud-results';
    this.results.hidden = true;
    this.minimap = new Minimap(battle);
    this.map.className = 'battle-map';
    this.map.append(this.minimap.canvas);
    const key = document.createElement('div');
    key.className = 'battle-map-key';
    key.textContent = 'N: map';
    this.stats.className = 'hud-stats';
    this.root.append(strip, me, this.map, key, this.stats, this.banner, this.results);
    container.append(this.root);
  }

  /** Show or hide the minimap (N). */
  toggleMap(): void {
    this.mapShown = !this.mapShown;
    this.map.hidden = !this.mapShown;
  }

  announce(text: string, seconds = 2.5): void {
    this.banner.textContent = text;
    this.banner.classList.add('visible');
    this.bannerUntil = performance.now() + seconds * 1000;
  }

  /** Redraw from `match`, Fighter `me` being the Player's slot. */
  update(match: MatchState, me: number, ping: number | null = null): void {
    const duel = match.duel;
    const crowd = duel.crowd;
    if (!crowd) return;
    const myTeam = match.config.teams[me] ?? 0;
    armyStrengths(crowd, this.battle).forEach((a, team) => {
      const row = this.armies[team]!;
      row.fill.style.width = `${(a.ticketShare * 100).toFixed(1)}%`;
      row.men.style.width = `${(a.share * 100).toFixed(1)}%`;
      row.bar.classList.toggle('routed', a.routed);
      row.label.textContent = `${team === myTeam ? 'Your army' : 'The enemy'} (${ARMY_NAMES[team]})${a.routed ? ' · routed' : a.tickets <= 0 ? ' · no reinforcements' : ''}`;
      row.count.textContent = `${a.tickets} ${a.tickets === 1 ? 'Ticket' : 'Tickets'} · ${a.alive} soldiers`;
    });
    if (this.sites?.arena !== match.arena) this.sites = { arena: match.arena, objectives: battlefieldOf(this.battle, match.arena)?.objectives ?? [] };
    this.plan.textContent = crowd.rout ? '' : `Your army is ${armyPlan(crowd, this.sites.objectives, myTeam)}`;
    const f = duel.fighters[me];
    const record = playerRecord(duel, me);
    const status = playerStatus(duel, me);
    const hp = f && inDuel(f) ? f.hp : 0;
    const max = f?.maxHp ?? 1;
    this.who.textContent =
      status === 'Out' ? 'Out: your army has no soldiers left' : status === 'Fallen' ? 'Fallen: taking over a soldier…' : record && record.soldier >= 0 ? `A soldier of your army · ${record.kills} kills` : `You · ${record?.kills ?? 0} kills`;
    this.hpFill.style.width = `${Math.max(0, (hp / max) * 100).toFixed(1)}%`;
    this.hpText.textContent = `${Math.ceil(hp)} / ${max}`;
    if (this.mapShown) this.minimap.draw(duel, me, this.sites.objectives);
    this.frames++;
    const now = performance.now();
    if (now - this.statsAt >= 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.statsAt));
      this.frames = 0;
      this.statsAt = now;
      this.stats.textContent = ping == null ? `${fps} fps` : `${fps} fps · ${Math.round(ping)} ms`;
    }
    if (this.bannerUntil && performance.now() > this.bannerUntil) {
      this.banner.classList.remove('visible');
      this.bannerUntil = 0;
    }
  }

  /** The results screen; `note` says what follows. */
  showResults(r: BattleResult, note: string): void {
    const row = (label: string, value: string) => {
      const el = document.createElement('div');
      el.className = 'hud-results-row';
      const b = document.createElement('b');
      b.textContent = value;
      el.append(label, b);
      return el;
    };
    const title = document.createElement('div');
    title.className = `hud-results-title ${r.victory ? 'victory' : 'defeat'}`;
    title.textContent = r.victory ? 'Victory' : 'Defeat';
    const next = document.createElement('p');
    next.className = 'hud-results-note';
    next.textContent = note;
    const m = Math.floor(r.seconds / 60);
    const s = Math.floor(r.seconds % 60);
    this.results.replaceChildren(
      title,
      row('Winner', `the ${ARMY_NAMES[r.winner]} army`),
      row('Your kills', String(r.kills)),
      row('Soldiers taken over', String(r.taken)),
      row('Tickets left', `${r.tickets[0]} red · ${r.tickets[1]} blue`),
      row('Objectives held', `${r.held[0]} red · ${r.held[1]} blue`),
      row('Left standing', `${r.left[0]} red · ${r.left[1]} blue`),
      row('Battle', `${m}:${String(s).padStart(2, '0')}`),
      next,
    );
    this.results.hidden = false;
  }

  dispose(): void {
    this.root.remove();
  }
}
