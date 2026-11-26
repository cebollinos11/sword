/**
 * The Lobby drawn, kept to what most Matches need: on the left you (your Body, which opens your look and build in place, and your Weapon
 * as a grid of pictures); on the right the Match (the picked map's picture with the Format and Match length, or a
 * Battle's army size, on it, and the map picker behind "Change map"), the two sides (who fights; the host sets how many
 * with − and +), one AI level for every AI, and "More options" folding away the rest: each Seat's own settings (an AI's
 * Style, Weapon and build; a Seat moved to), the Random Map's seed, a Battle's fighting speed and what each Format means.
 * In a Gauntlet the other side is the Floors; in an offline Battle there are no sides (its armies are its own). Used by
 * the Skirmish setup, the online Room Lobby and the in-game Match setup alike; who may change what follows the Lobby
 * (the host edits Seats and settings, everyone their own Weapon and Seat).
 */
import { ARENA_SEED_RANGE, attackTimings, DIRECTIONS, MATCH_FORMATS, MAX_TEAM_SIZE, OPEN_FIELD, parseGeneratedName, type MatchFormat } from '../sim';
import { armySizeCap, battleMapPicked, DEFAULT_STYLE, RANDOM_PICK, standardArmySize, startingTickets, storedSize, type BattleKnobs, type BattleMapLobby, type Size, type TuningData } from '../tuning';
import { duelTroopTier, resolveTroop, troopLabel, type ResolvedTroop, type TroopRef } from '../sim/delver';
import { teamColour } from '../render/fighterView';
import { PortraitView } from '../render/portrait';
import {
  BEST_OF,
  canSetSeat,
  formatProblem,
  isBattle,
  isGauntlet,
  lobbyFormats,
  MAX_PLAYERS,
  member,
  nextMatchArena,
  runTuning,
  seatOf,
  setFormat,
  setSeat,
  teamSize,
  updateSettings,
  type Lobby,
  type LobbyState,
  type Seat,
  type SeatRef,
} from '../lobby';
import { button, h, hex, select, thumb, thumbImage, weaponThumb } from './dom';

/** How the menu presents each Arena; one missing here shows its file name on a plain card. `hidden` keeps it off the Map picker (it stays the Editor's). */
export const ARENA_INFO: Readonly<Record<string, { label: string; blurb: string; art: string; hidden?: boolean }>> = {
  library: {
    label: 'Library',
    blurb: 'Stacks, ladders and reading tables',
    art: 'radial-gradient(circle at 30% 25%, #f4c77a55, transparent 45%), linear-gradient(160deg, #5b3a1e, #2a180b 60%, #140a04)',
  },
  chamber: {
    label: 'Carbon-freezing chamber',
    blurb: 'A narrow ring above the pit',
    art: 'radial-gradient(circle at 50% 110%, #ff8a3d88, transparent 55%), linear-gradient(180deg, #1d2a38, #0b1118 70%)',
  },
  ship: {
    label: 'Pirate ship',
    blurb: 'Deck, rails and open sea',
    art: 'linear-gradient(180deg, #8ec5e8 0%, #3d7fa8 45%, #1f4f6e 46%, #6b4423 47%, #3b2412 100%)',
  },
  summit: {
    label: 'Snowy summit',
    blurb: 'Mist, snowfall and a long drop',
    art: 'radial-gradient(circle at 70% 20%, #ffffffcc, transparent 40%), linear-gradient(180deg, #c9d8e6, #7f98b0 55%, #3e5267)',
  },
  train: {
    label: 'Wasteland express',
    blurb: 'Bevelled roofs, open gaps, a long way down',
    art: 'radial-gradient(circle at 50% 60%, #ffd08acc, transparent 16%), linear-gradient(180deg, #241c26, #94463e 38%, #c98a56 60%, #4a3236 61%, #8f7f6c 66%, #5a4a3e)',
  },
  circle: {
    label: 'Training circle',
    blurb: 'Open ground, nowhere to hide',
    art: 'radial-gradient(ellipse at 50% 80%, #b9d98a, #5f8a3a 50%, #2d4a1b)',
    hidden: true,
  },
};

/** The Arenas a Match can be played in: every one but those hidden from the picker. */
export function pickableArenas(tuning: TuningData): string[] {
  return Object.keys(tuning.arenas).filter((a) => !ARENA_INFO[a]?.hidden);
}

export function arenaLabel(arena: string): string {
  const seed = mapSeed(arena);
  return seed !== null ? `Random · seed ${seed}` : (ARENA_INFO[arena]?.label ?? arena);
}

/** The Random Map card's picture (public/thumbs/arenas/random.webp) and its painted stand-in. */
const RANDOM_THUMB = 'random';
const RANDOM_ART = 'linear-gradient(160deg, #6f747c, #3a3e45 60%, #1d2024)';
/**
 * The Random Map with `seed`: a Generated Arena of the first Kit (only `greybox` for now, so the Kit is not offered
 * as a choice), named `gen:<kit>:<seed>`, which every peer builds from the name alone (`withGeneratedArena`).
 */
export function randomMap(tuning: TuningData, seed: number): string {
  return `gen:${Object.keys(tuning.kits)[0]}:${seed}`;
}

/** The seed of a Random Map, or null for a hand-made Arena (or a malformed name). */
export function mapSeed(arena: string): number | null {
  try {
    return parseGeneratedName(arena)?.seed ?? null;
  } catch {
    return null;
  }
}

/** A fresh seed for the Random Map (picked by the host, outside the Simulation, so Math.random is fine). */
function pickSeed(): number {
  return Math.floor(Math.random() * ARENA_SEED_RANGE);
}

/** Why a Format the Lobby offers (`MATCH_FORMATS`, in a Skirmish and online alike: a Run online is co-op, every Player on Team 0) cannot be picked now (shown under the toggle), or null: e.g. a Gauntlet with four Players. */
export function formatRefusal(state: LobbyState): string | null {
  for (const f of MATCH_FORMATS) {
    const problem = formatProblem(state, f);
    if (problem) return problem;
  }
  return null;
}

/** What a seated Player who is not in the Match being played waits for: the next Match, or the next Run. */
export function waitingTag(state: LobbyState): string {
  return isGauntlet(state) ? 'Next Run' : 'Next Match';
}

/** The teams whose Seats the Lobby shows: both, or in a Gauntlet only Team 0 (the Floors fill Team 1), or in an offline Battle neither (its one Player is on Team 0). */
export function shownTeams(state: LobbyState, online = false): number[] {
  if (isBattle(state) && !online) return [];
  return isGauntlet(state) ? [0] : state.teams.map((_, team) => team);
}

/** The Map cards besides Random: every pickable Arena, or none in a Gauntlet (a Run is on the Random Map). */
export function shownArenas(tuning: TuningData, state: LobbyState): string[] {
  return isGauntlet(state) || isBattle(state) ? [] : pickableArenas(tuning);
}

/** Whether the Match length (Best of N) is shown: not for a Run. */
export function showsBestOf(state: LobbyState): boolean {
  return !isGauntlet(state) && !isBattle(state);
}

/** What the Random card says under its name: the next Match's seed, or in a Gauntlet the Run seed. */
export function randomBlurb(state: LobbyState, played: string | null | undefined, editable: boolean): string {
  const seed = mapSeed(state.settings.arena) === null ? null : mapSeed(nextMatchArena(state, played ?? undefined));
  if (seed === null) return 'A new Arena every Match';
  const text = isGauntlet(state) ? `Run seed ${seed}` : `Next: seed ${seed}`;
  return editable ? `${text} · pick again to reroll` : text;
}

/** The label beside the Seed field: the Run's seed in a Gauntlet, else the next Match's. */
export function seedLabel(state: LobbyState): string {
  return isGauntlet(state) ? 'Run seed' : 'Next seed';
}

/** What the view needs besides the Lobby. */
export interface LobbyViewContext {
  readonly tuning: TuningData;
  readonly lobby: Lobby;
  /** In a Match (the in-game Match setup): changes apply on restart, and nobody readies. */
  readonly inGame: boolean;
  /** The Arena of the Match being played or played last (a Random Map's next Match follows on from it), or null. */
  readonly played?: string | null;
  /** Your look and build controls (the Character screen's), opened from your portrait; absent, the portrait is only a picture. */
  readonly look?: () => { readonly grid: HTMLElement; readonly sliders: HTMLElement };
  /** Dev mode (`devMode()`, `?dev=1`): the host may set an AI Seat to a Delver Troop (docs/plans/enemy-behaviours.md, Stage 0). */
  readonly dev?: boolean;
}

/** The whole Lobby body: you (your look and Weapon) on the left; the Match, the teams and the rest under "More options" on the right. */
export function lobbyBody(ctx: LobbyViewContext): HTMLElement {
  const state = ctx.lobby.state!;
  const load = loadoutBlock(ctx, state);
  const main = h('div', 'lb-main', null, matchHero(ctx, state), sidesBlock(ctx, state), aiLevelRow(ctx, state), moreBlock(ctx, state));
  return h('div', load ? 'lb-body' : 'lb-body lb-body-solo', null, load, main);
}

/** Whether "More options" and the map picker are open: kept across the redraw every Lobby change brings. */
let moreOpen = false;
let mapsOpen = false;
let lookOpen = false;

/** The one live portrait (see PortraitView), made on first need; null where WebGL is not to be had. */
let portrait: PortraitView | null | undefined;
function portraitOf(tuning: TuningData): PortraitView | null {
  if (portrait === undefined) {
    try {
      portrait = new PortraitView(tuning);
    } catch {
      portrait = null;
    }
  }
  return portrait;
}

function section(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h('section', 'lb-section', null, h('h3', 'lb-heading', title), ...children);
}

// --- Teams ---

function teamsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  if (isBattle(state) && !ctx.lobby.online) return section('Armies', armiesCard(runTuning(ctx.tuning, state.settings), state.settings.battle));
  const shown = shownTeams(state, ctx.lobby.online);
  const teams = state.teams.map((_, team) => (shown.includes(team) ? teamCard(ctx, state, team) : floorsCard(ctx, state)));
  const vs = h('div', 'lb-vs', null, h('span', '', `${teamSize(state, 0)}`), h('b', '', 'vs'), h('span', '', `${teamSize(state, 1)}`));
  const grid = h('div', 'lb-teams', null, teams[0]!, vs, teams[1]!);
  const humans = state.members.length;
  const note = ctx.lobby.online
    ? h('p', 'lb-note', `${humans} of ${MAX_PLAYERS} players · Open seats wait for players to join; Empty ones field nobody.`)
    : null;
  return section('Seats', grid, note, isBattle(state) ? armiesCard(runTuning(ctx.tuning, state.settings), state.settings.battle) : null);
}

function teamCard(ctx: LobbyViewContext, state: LobbyState, team: number): HTMLElement {
  const card = h('div', `lb-team lb-team-${team}`);
  card.style.setProperty('--team', hex(teamColour(team, 0)));
  const fighters = teamSize(state, team);
  card.append(h('div', 'lb-team-head', null, h('span', 'lb-team-name', `Team ${team + 1}`), h('span', 'lb-team-count', `${fighters} ${fighters === 1 ? 'Fighter' : 'Fighters'}`)));
  let k = 0;
  for (let index = 0; index < MAX_TEAM_SIZE; index++) {
    const held = state.teams[team]![index]!;
    const seat = shownSeat(state, held);
    // Empty Seats are filled with the side's + (or emptied with its −), so only the filled ones are listed here.
    if (seat.kind === 'Closed') continue;
    const fights = seat.kind === 'Player' || seat.kind === 'AI';
    card.append(seatRow(ctx, state, { team, index }, seat, fights ? teamColour(team, k++) : null));
  }
  return card;
}

/** What the Gauntlet's Floors card says: how deep the Dungeon goes, and how a Run goes down it. */
export function dungeonCard(tuning: Pick<TuningData, 'delver'>): { readonly count: string; readonly note: string } {
  const { tiers, floorsPerTier } = tuning.delver;
  const floors = tiers * floorsPerTier;
  return {
    count: `${floors} ${floors === 1 ? 'Floor' : 'Floors'}`,
    note:
      `A Dungeon of ${floors} generated ${floors === 1 ? 'Floor' : 'Floors'}, past Warbands that guard and patrol. ` +
      `Find the fires and the Stairs, and stand on the Stairs together to go down. HP carries over; a fire heals once and brings back the fallen.`,
  };
}

/** What a Battle's card says: the armies, where they meet (the map `knobs` pick), how it ends, and what happens when you fall. */
export function battleCard(tuning: Pick<TuningData, 'battle'>, knobs?: BattleKnobs): { readonly count: string; readonly note: string } {
  const { armySize, rout } = tuning.battle;
  const where = battleMapChoice(tuning, knobs).where;
  // As many as its map places (a map from the Map Editor may place 1 to 12), the open field's five.
  const n = (battleMapPicked(tuning.battle, knobs)?.objectives ?? tuning.battle.objectives.openField).length;
  return {
    count: `${armySize} v ${armySize}`,
    note:
      `Two armies of ${armySize} meet ${where} and fight over ${n === 1 ? 'one Objective' : `${COUNT_WORDS[n] ?? n} Objectives`}. Each Player fights in their Team's army (Team 1 is yellow, Team 2 blue) with their own Body and Weapon; soldiers near you ` +
      `fight you blade to blade, a few at once, and your allies close by join in. Each army has ${Math.round(startingTickets(tuning.battle))} Tickets: every death costs one, and an army that holds more Objectives than the enemy drains the enemy's. ` +
      `With none left an army stops sending reinforcements, and once it is below ${Math.round(rout.threshold * 100)}% of its soldiers it breaks and flees: the other wins. ` +
      `If you fall, you take over the nearest soldier of your army and fight on; you are out only when your army has none left.`,
  };
}

/** Small counts as the cards spell them. */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** In a Battle, the teams' place: the two armies (`tuning` with the Lobby's `knobs` folded in). */
function armiesCard(tuning: TuningData, knobs: BattleKnobs | undefined): HTMLElement {
  const card = h('div', 'lb-team lb-team-0');
  card.style.setProperty('--team', hex(tuning.battle.soldier.colours[0]));
  const { count, note } = battleCard(tuning, knobs);
  card.append(h('div', 'lb-team-head', null, h('span', 'lb-team-name', 'Battle'), h('span', 'lb-team-count', count)), h('p', 'lb-note', note));
  return card;
}

/** In a Gauntlet, Team 1's place: the Dungeon the Run walks. */
function floorsCard(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const card = h('div', 'lb-team lb-team-1');
  card.style.setProperty('--team', hex(teamColour(1, 0)));
  const { count, note } = dungeonCard(ctx.tuning);
  card.append(h('div', 'lb-team-head', null, h('span', 'lb-team-name', 'The Floors'), h('span', 'lb-team-count', count)), h('p', 'lb-note', note));
  card.append(...traitorRows(ctx, state));
  return card;
}

/** What the Floors card says of the traitors (docs/plans/delver.md, Stage 8a). */
export const TRAITOR_NOTE = 'Traitors play the Warbands: each takes over a Soldier out of the party’s sight, and another after each death.';

/**
 * A Delver Lobby's traitors (offline too: the player alone betrays an all-AI party), on the Floors card: each Player on a Team 1 Seat, and while one is free and you sit on Team 0, a button that
 * moves you to it (`traitorSeat`). Moving back is the party side's Join, or any Team 0 Seat's own move button.
 */
function traitorRows(ctx: LobbyViewContext, state: LobbyState): HTMLElement[] {
  const out: HTMLElement[] = [h('p', 'lb-note', TRAITOR_NOTE)];
  state.teams[1]!.forEach((seat, index) => {
    if (seat.kind === 'Player') out.push(seatRow(ctx, state, { team: 1, index }, seat, teamColour(1, index)));
  });
  // The button that makes you one is on the Floors side (`floorsSide`).
  return out;
}

/** The first Team 1 Seat a Player could move to as a traitor (no Player on it), or null. */
export function traitorSeat(state: LobbyState): number | null {
  const index = state.teams[1]!.findIndex((s) => s.kind !== 'Player');
  return index < 0 ? null : index;
}

function avatar(text: string, colour: number | null): HTMLElement {
  const a = h('span', 'seat-avatar', text);
  if (colour !== null) a.style.background = hex(colour);
  return a;
}

function seatRow(ctx: LobbyViewContext, state: LobbyState, at: SeatRef, seat: Seat, colour: number | null): HTMLElement {
  const { lobby } = ctx;
  const row = h('div', `seat seat-${seat.kind.toLowerCase()}`);
  const me = lobby.me;
  const host = lobby.isHost;
  const mine = seat.kind === 'Player' && seat.member === me;
  if (mine) row.classList.add('seat-mine');

  if (seat.kind === 'Player') {
    const m = member(state, seat.member);
    const name = m?.name ?? '…';
    const tags = h('span', 'seat-tags');
    if (mine) tags.append(h('span', 'tag tag-you', 'You'));
    if (seat.member === 0 && lobby.online) tags.append(h('span', 'tag tag-host', 'Host'));
    const waiting = state.playing && !state.inMatch.includes(seat.member);
    const info = h('div', 'seat-info', null, h('div', 'seat-title', null, h('span', 'seat-name', name), tags), h('div', 'seat-sub', m ? `${m.weapon}${sizeTag(m.size)}` : ''));
    row.append(avatar(name.slice(0, 1).toUpperCase(), colour), info);
    if (lobby.online && !ctx.inGame && seat.member !== 0) {
      row.append(h('span', `seat-ready ${m?.ready ? 'is-ready' : ''}`, m?.ready ? 'Ready' : 'Not ready'));
    } else if (waiting) row.append(h('span', 'seat-ready', waitingTag(state)));
    return row;
  }

  if (seat.kind === 'AI') {
    row.append(avatar('AI', colour));
    const info = h('div', 'seat-info');
    // A Troop (set in dev mode) shows whether or not this peer is in dev mode: it plays all the same. Only Duels field one.
    const troop = seat.troop && !isGauntlet(state) ? seat.troop : undefined;
    if (host) {
      // With a Troop, its own line stands in for the Style, Weapon and build: the Troop sets them.
      const own = troop ? [] : [styleSelect(ctx, at, seat), ...(ctx.dev ? [quirksSelect(ctx, at, seat)] : []), weaponSelect(ctx, at, seat), sizeSelect(ctx, at, seat)];
      const dev = ctx.dev && !isGauntlet(state) ? [troopSelect(ctx, at, seat), troop && troopTierSelect(ctx, at, seat, troop)] : [];
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', 'AI')), h('div', 'seat-controls', null, kindSelect(ctx, state, at, seat), ...dev.filter((e) => e), ...own));
      if (troop) info.append(h('div', 'seat-sub', troopLine(ctx.tuning, troop)));
    } else if (troop) {
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', `${troopName(ctx.tuning, troop)} AI`)), h('div', 'seat-sub', troopLine(ctx.tuning, troop)));
    } else {
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', `${seat.difficulty} AI`)), h('div', 'seat-sub', `${styleLabel(seat.style)}${quirksTag(seat.quirks)} · ${seat.weapon}`));
    }
    row.append(info);
  } else {
    row.append(h('span', 'seat-avatar seat-avatar-empty', seat.kind === 'Open' ? '+' : ''));
    const label = seat.kind === 'Open' ? 'Open seat' : 'Empty';
    const sub = seat.kind === 'Open' ? (lobby.online ? 'Waiting for a player…' : '') : '';
    const info = h('div', 'seat-info', null, h('div', 'seat-title', null, h('span', 'seat-name', label)));
    if (host) info.append(h('div', 'seat-controls', null, kindSelect(ctx, state, at, seat)));
    else if (sub) info.append(h('div', 'seat-sub', sub));
    row.append(info);
  }
  if (me !== null && seatOf(state, me)) {
    const move = button('seat-move', '⇄', () => lobby.moveMe(at));
    move.title = seat.kind === 'AI' ? 'Swap Seats with this AI' : 'Move to this Seat';
    move.setAttribute('aria-label', move.title);
    row.append(move);
  }
  return row;
}

/** The AI difficulties a Seat offers: the human-feeling presets, not the older Easy / Normal / Hard. */
export const SEAT_DIFFICULTIES: readonly string[] = ['Beginner', 'Skilled', 'Expert'];

/** Host: what a non-Player Seat holds: Closed, Open (online, within the Players a Match fields) or an AI at a difficulty. */
function kindSelect(ctx: LobbyViewContext, state: LobbyState, at: SeatRef, seat: Exclude<Seat, { kind: 'Player' }>): HTMLSelectElement {
  // Only the Seat AI difficulties are offered (plus a Seat's own, should it hold another one, so it still shows).
  const difficulties = SEAT_DIFFICULTIES.filter((d) => ctx.tuning.ai.difficulties[d]);
  if (seat.kind === 'AI' && !difficulties.includes(seat.difficulty)) difficulties.push(seat.difficulty);
  const options: [string, string][] = [['Closed', 'Empty']];
  if (ctx.lobby.online && (seat.kind === 'Open' || canSetSeat(state, at, 'Open'))) options.push(['Open', 'Open seat']);
  if (!isBattle(state)) for (const d of difficulties) options.push([`AI:${d}`, `${d} AI`]);
  const value = seat.kind === 'AI' ? `AI:${seat.difficulty}` : seat.kind;
  const weapon = seat.kind === 'AI' ? seat.weapon : Object.keys(ctx.tuning.weapons)[0]!;
  const style = seat.kind === 'AI' && seat.style !== undefined ? { style: seat.style } : {};
  const quirks = seat.kind === 'AI' && seat.quirks !== undefined ? { quirks: seat.quirks } : {};
  const size = seat.kind === 'AI' && seat.size !== undefined ? { size: seat.size } : {};
  const troop = seat.kind === 'AI' && seat.troop !== undefined ? { troop: seat.troop } : {};
  return select('Seat', options, value, (v) => {
    const next: Exclude<Seat, { kind: 'Player' }> = v.startsWith('AI:') ? { kind: 'AI', difficulty: v.slice(3), weapon, ...style, ...quirks, ...size, ...troop } : { kind: v as 'Open' | 'Closed' };
    ctx.lobby.edit((s) => setSeat(s, at, next));
  });
}

/** An AI Seat's Style, as shown: the default when it names none, "Random" for one picked from the Match seed. */
const styleLabel = (style: string | undefined): string => (style === undefined ? DEFAULT_STYLE : style === RANDOM_PICK ? 'Random' : style);

/** Named builds an AI Seat offers (any other Size, such as a Member's own, shows as Custom). */
const SIZE_PRESETS: readonly (readonly [string, Size])[] = [
  ['Standard', { height: 1, thick: 1 }],
  ['Small', { height: 0.75, thick: 0.9 }],
  ['Chubby midget', { height: 0.6, thick: 1.2 }],
  ['Slender', { height: 1.4, thick: 0.9 }],
  ['Giant', { height: 1.4, thick: 1.4 }],
];

const sizeKey = (s: Size | undefined): string => `${s?.height ?? 1},${s?.thick ?? 1}`;

/** A seat's build as a suffix for its subtitle: nothing for the standard body. */
const sizeTag = (s: Size | undefined): string => (storedSize(s) ? ` · ×${s!.height} tall, ×${s!.thick} thick` : '');

/** Host: an AI Seat's build (height and thickness). */
function sizeSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const options: [string, string][] = SIZE_PRESETS.map(([name, size]) => [sizeKey(size), name]);
  if (!SIZE_PRESETS.some(([, size]) => sizeKey(size) === sizeKey(seat.size))) options.push([sizeKey(seat.size), `Custom ×${seat.size!.height} / ×${seat.size!.thick}`]);
  return select('AI build', options, sizeKey(seat.size), (v) => {
    const { size: _old, ...rest } = seat;
    const size = SIZE_PRESETS.find(([, p]) => sizeKey(p) === v)?.[1];
    ctx.lobby.edit((s) => setSeat(s, at, size && storedSize(size) ? { ...rest, size } : rest));
  });
}

/** Host: an AI Seat's Style (how it fights), or Random (picked from each Match's seed, the same on every peer). */
function styleSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const styles: [string, string][] = [...Object.keys(ctx.tuning.ai.styles).map((s) => [s, s] as [string, string]), [RANDOM_PICK, 'Random']];
  return select('AI Style', styles, seat.style ?? DEFAULT_STYLE, (v) => {
    const { style: _old, ...rest } = seat;
    ctx.lobby.edit((s) => setSeat(s, at, v === DEFAULT_STYLE ? rest : { ...rest, style: v }));
  });
}

/** An AI's Quirks as a suffix (" + Dumb + Hopper"), nothing for none. */
const quirksTag = (quirks: readonly string[] | undefined): string => (quirks ?? []).map((q) => ` + ${q}`).join('');

/** The most Quirks `quirkChoices` combines: past it, only one Quirk at a time is offered. */
const QUIRK_COMBOS_UP_TO = 4;

/**
 * The Quirk lists a plain AI Seat may play, in dev mode (docs/plans/enemy-behaviours.md, Stage 4): none, then every non-empty combination
 * of `ai.quirks` in file order (one Quirk at a time when there are more than QUIRK_COMBOS_UP_TO). Each is [select value, label, list].
 */
export function quirkChoices(tuning: TuningData): readonly (readonly [string, string, readonly string[]])[] {
  const names = Object.keys(tuning.ai.quirks);
  const lists: string[][] = [];
  if (names.length > QUIRK_COMBOS_UP_TO) lists.push(...names.map((n) => [n]));
  else for (let mask = 1; mask < 1 << names.length; mask++) lists.push(names.filter((_, k) => mask & (1 << k)));
  lists.sort((a, b) => a.length - b.length);
  return [['', 'No Quirks', []], ...lists.map((l) => [l.join('+'), l.join(' + '), l] as const)];
}

/** Host, dev mode: a plain AI Seat's Quirks (hard rules on top of its Style), or none. */
function quirksSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const choices = quirkChoices(ctx.tuning);
  const options: [string, string][] = choices.map(([value, label]) => [value, label]);
  const value = (seat.quirks ?? []).join('+');
  // A list the choices lack (another order, or a Quirk this build lacks) still shows, so the select says what the Seat holds.
  if (!choices.some(([v]) => v === value)) options.push([value, (seat.quirks ?? []).join(' + ')]);
  return select('AI Quirks', options, value, (v) => {
    const { quirks: _old, ...rest } = seat;
    const list = choices.find(([key]) => key === v)?.[2] ?? seat.quirks ?? [];
    ctx.lobby.edit((s) => setSeat(s, at, list.length > 0 ? { ...rest, quirks: [...list] } : rest));
  });
}

/** The Troop select's value for no Troop. */
export const NO_TROOP = '';

/** The Troop select's value for a ref (its Prefab and Variant names; never NO_TROOP). */
const troopKey = (ref: Pick<TroopRef, 'prefab' | 'variant'>): string => JSON.stringify([ref.prefab, ref.variant]);

/**
 * The Troops an AI Seat may fight as, in dev mode (docs/plans/enemy-behaviours.md, Stage 0): "(none)", then every Variant of every Prefab of
 * `delver.troops` in order, Boss Variants too ("Uruk · Beginner", "Uruk · Warden (Boss)"). Each is [select value, label, ref].
 */
export function troopChoices(tuning: TuningData): readonly (readonly [string, string, TroopRef | null])[] {
  const list: [string, string, TroopRef | null][] = [[NO_TROOP, '(none)', null]];
  for (const p of tuning.delver.troops) for (const v of p.variants) list.push([troopKey({ prefab: p.name, variant: v.name }), troopLabel(p, v), { prefab: p.name, variant: v.name }]);
  return list;
}

/** A Troop's short name ("Uruk · Beginner"), or its ref as given when Tuning Data lacks it. */
export function troopName(tuning: TuningData, ref: TroopRef): string {
  const p = tuning.delver.troops.find((x) => x.name === ref.prefab);
  const v = p?.variants.find((x) => x.name === ref.variant);
  return p && v ? troopLabel(p, v) : `${ref.prefab} · ${ref.variant}`;
}

/**
 * What an AI Seat with a Troop fights as, read-only, in place of its own Style, Weapon and build: its Body, Weapon, HP (and the Floor tier it
 * is scaled as, or Boss), AI difficulty, Style and Quirks, and Relics (`resolveTroop`). A Troop Tuning Data lacks says so instead.
 */
export function troopLine(tuning: TuningData, ref: TroopRef): string {
  let t: ResolvedTroop;
  try {
    t = resolveTroop(tuning, ref);
  } catch {
    return `Unknown Troop ${ref.prefab} · ${ref.variant}`;
  }
  const hp = `${Math.round(t.maxHp)} HP ${t.troop.boss ? '(Boss)' : `(Floor tier ${t.tier})`}`;
  const relics = t.relics.length > 0 ? t.relics.join(', ') : 'no Relics';
  return `${t.body} · ${t.weapon} · ${hp} · ${t.difficulty} ${t.style}${quirksTag(t.quirks)} · ${relics}`;
}

/** Host, dev mode: the Delver Troop an AI Seat fights as, or none (its own settings again). */
function troopSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const choices = troopChoices(ctx.tuning);
  const options: [string, string][] = choices.map(([value, label]) => [value, label]);
  const value = seat.troop ? troopKey(seat.troop) : NO_TROOP;
  // A Troop this build lacks (a stale Seat) still shows, so the select says what the Seat holds.
  if (seat.troop && !choices.some(([v]) => v === value)) options.push([value, troopName(ctx.tuning, seat.troop)]);
  return select('AI Troop', options, value, (v) => {
    const { troop: old, ...rest } = seat;
    const ref = choices.find(([key]) => key === v)?.[2];
    // A new Troop keeps the Floor tier the Seat had.
    ctx.lobby.edit((s) => setSeat(s, at, ref ? { ...rest, troop: { ...ref, ...(old?.tier === undefined ? {} : { tier: old.tier }) } } : rest));
  });
}

/** Host, dev mode: the Floor tier a Troop's HP is scaled as (1 to `delver.tiers`; a Boss's HP is whole, so a Boss Troop has none). */
function troopTierSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>, troop: TroopRef): HTMLSelectElement | null {
  const p = ctx.tuning.delver.troops.find((x) => x.name === troop.prefab);
  if (!p || p.variants.find((v) => v.name === troop.variant)?.boss) return null;
  const tiers = Array.from({ length: ctx.tuning.delver.tiers }, (_, k) => [String(k + 1), `Floor tier ${k + 1}`] as [string, string]);
  const fallback = duelTroopTier(ctx.tuning.delver);
  return select('Troop Floor tier', tiers, String(troop.tier ?? fallback), (v) => {
    const { tier: _old, ...ref } = troop;
    const tier = Number(v);
    ctx.lobby.edit((s) => setSeat(s, at, { ...seat, troop: tier === fallback ? ref : { ...ref, tier } }));
  });
}

function weaponSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const weapons = Object.keys(ctx.tuning.weapons).map((w) => [w, w] as const);
  return select('AI Weapon', weapons, seat.weapon, (w) => ctx.lobby.edit((s) => setSeat(s, at, { ...seat, weapon: w })));
}

// --- The Match: the map picture with the Format and length on it ---

/** A map's look: its picture (public/thumbs) and the painted stand-in shown while it loads (or if it is missing). */
interface MapArt {
  readonly picture: string;
  readonly art: string;
}

const arenaArt = (arena: string): MapArt => ({ picture: thumb('arenas', arena), art: ARENA_INFO[arena]?.art ?? PLAIN_ART });
const randomArt = (): MapArt => ({ picture: thumb('arenas', RANDOM_THUMB), art: RANDOM_ART });
const battleArt = (choice: { id: string; art: string }): MapArt => ({ picture: thumb('battlemaps', choice.id), art: choice.art });

/**
 * Paint a map's picture over its stand-in as `el`'s background, under `over` (a shade, say). A map file's `art` the
 * browser cannot read would drop the whole declaration: then the picture over the plain stand-in.
 */
function paintMap(el: HTMLElement, { picture, art }: MapArt, over = ''): void {
  const layers = (stand: string) => `${over ? `${over}, ` : ''}url("${picture}") center / cover no-repeat, ${stand}`;
  el.style.background = layers(art);
  if (!el.style.background) el.style.background = layers(PLAIN_ART);
}

/** The picked map's name, picture and (for the Random Map) its seed line. */
function pickedMap(ctx: LobbyViewContext, state: LobbyState): { label: string; look: MapArt; sub: string | null } {
  if (isBattle(state)) {
    const choice = battleMapChoice(ctx.tuning, state.settings.battle);
    return { label: choice.label, look: battleArt(choice), sub: null };
  }
  const arena = state.settings.arena;
  if (mapSeed(arena) !== null) return { label: 'Random', look: randomArt(), sub: randomBlurb(state, ctx.played, false) };
  return { label: arenaLabel(arena), look: arenaArt(arena), sub: null };
}

/** A setting on the map picture: a dropdown for the host, plain text for everyone else. */
function token(editable: boolean, label: string, options: readonly (readonly [string, string])[], value: string, onPick: (v: string) => void, disabled: (v: string) => string | null = () => null): HTMLElement {
  if (!editable) return h('span', 'lb-token', options.find(([v]) => v === value)?.[1] ?? value);
  const s = select(label, options, value, onPick);
  s.className = 'lb-token';
  for (const o of s.options) {
    const problem = disabled(o.value);
    if (problem && o.value !== value) {
      o.disabled = true;
      o.title = problem;
    }
  }
  return s;
}

function matchHero(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const editable = ctx.lobby.isHost;
  const { label, look, sub } = pickedMap(ctx, state);
  const tokens: HTMLElement[] = [];
  const formats = lobbyFormats();
  if (formats.length > 1) {
    const options = formats.map((f) => [f, f] as const);
    tokens.push(token(editable, 'Format', options, state.settings.format ?? 'Duels', (f) => ctx.lobby.edit((s) => setFormat(s, f as MatchFormat, randomMap(ctx.tuning, pickSeed()))), (f) => formatProblem(state, f as MatchFormat)));
  }
  if (showsBestOf(state)) {
    const options = BEST_OF.map((n) => [String(n), `Best of ${n}`] as const);
    tokens.push(token(editable, 'Match length', options, String(state.settings.bestOf), (n) => ctx.lobby.edit((s) => updateSettings(s, { bestOf: Number(n) }))));
  }
  if (isBattle(state)) {
    const row = battleKnobRows(ctx.tuning, state.settings.battle)[0]!;
    const current = runTuning(ctx.tuning, state.settings).battle.armySize;
    const options = row.choices.map(([n, text]) => [String(n), `${text} a side`] as const);
    tokens.push(token(editable, row.label, options, String(current), (n) => ctx.lobby.edit((s) => updateSettings(s, { battle: withBattleKnob(s.settings.battle, row, Number(n)) }))));
  }
  const line = h('div', 'lb-hero-line');
  tokens.forEach((t, i) => line.append(...(i > 0 ? [h('span', 'lb-dot', '·'), t] : [t])));
  if (sub) line.append(h('span', 'lb-hero-sub', sub));

  const hero = h('div', 'lb-hero', null, h('div', 'lb-hero-name', label), line);
  paintMap(hero, look, 'linear-gradient(180deg, #0d0a1420, #0d0a14e6 85%)');

  const picker = mapPicker(ctx, state);
  if (editable && isGauntlet(state)) {
    // A Run is always on the Random Map: the one choice is a fresh seed.
    hero.append(button('ghost small lb-hero-change', 'New seed', () => ctx.lobby.edit((s) => updateSettings(s, { arena: randomMap(ctx.tuning, pickSeed()) }))));
  } else if (editable && picker) {
    picker.hidden = !mapsOpen;
    const change = button('ghost small lb-hero-change', mapsOpen ? 'Close' : 'Change map', () => {
      mapsOpen = !mapsOpen;
      picker.hidden = !mapsOpen;
      change.textContent = mapsOpen ? 'Close' : 'Change map';
    });
    change.setAttribute('aria-expanded', String(mapsOpen));
    hero.append(change);
    // The picture itself opens the picker too (not its dropdowns or button).
    hero.classList.add('lb-hero-pickable');
    hero.title = 'Change map';
    hero.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('select, button')) change.click();
    });
  }
  // Why a Format cannot be picked, in sight of the Format dropdown (its options' tooltips do not show on touch screens).
  const refusal = editable ? formatRefusal(state) : null;
  return h('div', 'lb-match', null, hero, refusal ? h('p', 'lb-note', refusal) : null, editable ? picker : null);
}

/** The host's map picker, under the map picture: every map as a picture with its name. */
function mapPicker(ctx: LobbyViewContext, state: LobbyState): HTMLElement | null {
  if (isGauntlet(state)) return null;
  const grid = h('div', 'map-grid lb-map-picker');
  const card = (name: string, look: MapArt, picked: boolean, pick: () => void) => {
    const c = h('button', 'map-card', null, h('span', 'map-art'), h('span', 'map-name', name));
    paintMap(c.firstChild as HTMLElement, look);
    c.setAttribute('aria-pressed', String(picked));
    c.addEventListener('click', () => {
      mapsOpen = false;
      pick();
    });
    return c;
  };
  if (isBattle(state)) {
    const picked = battleMapChoice(ctx.tuning, state.settings.battle).id;
    for (const choice of battleMaps(ctx.tuning)) {
      grid.append(card(choice.label, battleArt(choice), choice.id === picked, () =>
        ctx.lobby.edit((s) => updateSettings(s, { battle: withBattleMap(s.settings.battle, choice.id) })),
      ));
    }
    return grid;
  }
  for (const a of shownArenas(ctx.tuning, state)) {
    grid.append(card(arenaLabel(a), arenaArt(a), a === state.settings.arena, () => ctx.lobby.edit((s) => updateSettings(s, { arena: a }))));
  }
  // Picking Random (again) rolls a fresh seed.
  if (Object.keys(ctx.tuning.kits).length > 0) {
    grid.append(card('Random', randomArt(), mapSeed(state.settings.arena) !== null, () =>
      ctx.lobby.edit((s) => updateSettings(s, { arena: randomMap(ctx.tuning, pickSeed()) })),
    ));
  }
  return grid;
}

// --- The two sides: who fights, and how many, set with − and + ---

/** The Seat a side shows: a Battle's AI Seat fields nobody, so it is Empty. */
const shownSeat = (state: LobbyState, seat: Seat): Seat => (seat.kind === 'AI' && isBattle(state) ? { kind: 'Closed' } : seat);

/** How many places a side has filled: its Players, AIs and (online) Open Seats. */
export function sideCount(state: LobbyState, team: number): number {
  return state.teams[team]!.filter((s) => shownSeat(state, s).kind !== 'Closed').length;
}

/** The difficulty and Weapon a newly added AI takes: the first AI's, else Skilled with the first Weapon. */
function newAi(tuning: TuningData, state: LobbyState): Extract<Seat, { kind: 'AI' }> {
  const first = state.teams.flat().find((s): s is Extract<Seat, { kind: 'AI' }> => s.kind === 'AI');
  const difficulty = first?.difficulty ?? (SEAT_DIFFICULTIES.find((d) => d === 'Skilled' && tuning.ai.difficulties[d]) ?? SEAT_DIFFICULTIES.find((d) => tuning.ai.difficulties[d]) ?? Object.keys(tuning.ai.difficulties)[0]!);
  return { kind: 'AI', difficulty, weapon: first?.weapon ?? Object.keys(tuning.weapons)[0]! };
}

/**
 * The host's + on a side: fill its first Empty Seat. Offline with an AI; online with an Open Seat for a player (one at a
 * time: a side that already has one gets an AI), and in a Battle, where AIs field nobody, only ever an Open Seat. Unchanged when it cannot.
 */
export function addToSide(tuning: TuningData, state: LobbyState, team: number, online: boolean): LobbyState {
  const index = state.teams[team]!.findIndex((s) => shownSeat(state, s).kind === 'Closed');
  if (index < 0) return state;
  const at = { team, index };
  const hasOpen = state.teams[team]!.some((s) => s.kind === 'Open');
  const open = online && canSetSeat(state, at, 'Open') && (isBattle(state) || !hasOpen);
  if (open) return setSeat(state, at, { kind: 'Open' });
  return isBattle(state) ? state : setSeat(state, at, newAi(tuning, state));
}

/** The host's − on a side: empty its last AI or Open Seat (never a Player's). Unchanged when it has none. */
export function removeFromSide(state: LobbyState, team: number): LobbyState {
  const row = state.teams[team]!;
  for (let index = row.length - 1; index >= 0; index--) {
    const kind = shownSeat(state, row[index]!).kind;
    if (kind === 'AI' || kind === 'Open') return setSeat(state, { team, index }, { kind: 'Closed' });
  }
  return state;
}

function sidesBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement | null {
  const shown = shownTeams(state, ctx.lobby.online);
  if (shown.length === 0) return null;
  const me = ctx.lobby.me;
  const mine = me === null ? null : seatOf(state, me);
  const title = (team: number) => (mine ? (team === mine.team ? 'Your team' : 'Opponents') : `Team ${team + 1}`);
  const sides = shown.map((team) => sideCard(ctx, state, team, isGauntlet(state) ? 'Your party' : title(team), mine));
  if (isGauntlet(state)) sides.push(floorsSide(ctx, state));
  return h('div', 'lb-sides', null, ...sides);
}

function sideCard(ctx: LobbyViewContext, state: LobbyState, team: number, title: string, mine: SeatRef | null): HTMLElement {
  const { lobby } = ctx;
  const card = h('div', 'lb-side');
  card.style.setProperty('--team', hex(teamColour(team, 0)));
  const count = sideCount(state, team);
  let control: HTMLElement;
  if (lobby.isHost) {
    const less = button('', '−', () => lobby.edit((s) => removeFromSide(s, team)));
    const more = button('', '+', () => lobby.edit((s) => addToSide(ctx.tuning, s, team, lobby.online)));
    less.setAttribute('aria-label', `Fewer on ${title}`);
    more.setAttribute('aria-label', `More on ${title}`);
    less.disabled = removeFromSide(state, team) === state;
    more.disabled = addToSide(ctx.tuning, state, team, lobby.online) === state;
    control = h('div', 'lb-stepper', null, less, h('span', '', String(count)), more);
  } else control = h('span', 'lb-side-count', String(count));
  const head = h('div', 'lb-side-head', null, h('span', 'lb-side-name', title));
  // Change sides: take this side's first place that is not another Player's.
  const free = joinSeat(state, team);
  // In a Gauntlet only the party is a side like this, so a traitor finds the way back here.
  if (mine && mine.team !== team && free >= 0) head.append(button('lb-join', 'Join', () => lobby.moveMe({ team, index: free })));
  head.append(control);
  const list = h('div', 'lb-who');
  let k = 0;
  state.teams[team]!.forEach((held) => {
    const seat = shownSeat(state, held);
    if (seat.kind === 'Closed') return;
    const colour = seat.kind === 'Open' ? null : teamColour(team, k++);
    list.append(whoRow(ctx, state, seat, colour));
  });
  if (count === 0) list.append(h('div', 'lb-who-row lb-who-none', 'Nobody'));
  card.append(head, list);
  return card;
}

/**
 * The Seat you take when you Join `team`: its first that is not another Player's, so in Duels you swap places with an AI
 * there. A Gauntlet's traitor rejoining the party takes an Empty or Open Seat first, so no party AI is swapped onto the
 * Floors, where it would field nobody. -1 when the side is all Players.
 */
export function joinSeat(state: LobbyState, team: number): number {
  const row = state.teams[team]!;
  const empty = isGauntlet(state) ? row.findIndex((s) => s.kind === 'Closed' || s.kind === 'Open') : -1;
  return empty >= 0 ? empty : row.findIndex((s) => s.kind !== 'Player');
}

/** One line of a side: a Player (with You, Host and Ready), an AI, or an Open Seat. */
function whoRow(ctx: LobbyViewContext, state: LobbyState, seat: Exclude<Seat, { kind: 'Closed' }>, colour: number | null): HTMLElement {
  const { lobby } = ctx;
  if (seat.kind === 'Player') {
    const m = member(state, seat.member);
    const name = m?.name ?? '…';
    const row = h('div', 'lb-who-row', null, avatar(name.slice(0, 1).toUpperCase(), colour), h('span', 'lb-who-name', name));
    if (seat.member === lobby.me) row.append(h('span', 'tag tag-you', 'You'));
    if (seat.member === 0 && lobby.online) row.append(h('span', 'tag tag-host', 'Host'));
    if (lobby.online && !ctx.inGame && seat.member !== 0) row.append(h('span', `lb-ready ${m?.ready ? 'is-ready' : ''}`, m?.ready ? 'Ready' : 'Not ready'));
    else if (state.playing && !state.inMatch.includes(seat.member)) row.append(h('span', 'lb-ready', waitingTag(state)));
    return row;
  }
  if (seat.kind === 'AI') {
    // A Duel Troop is named, not its Seat's own (ignored) difficulty.
    const name = seat.troop && !isGauntlet(state) ? troopName(ctx.tuning, seat.troop) : seat.difficulty;
    return h('div', 'lb-who-row', null, avatar('AI', colour), h('span', 'lb-who-name', `${name} AI`));
  }
  return h('div', 'lb-who-row lb-who-open', null, h('span', 'seat-avatar seat-avatar-empty', '+'), h('span', 'lb-who-name', 'Open for a player'));
}

/** In a Gauntlet, the other side: the Dungeon's Floors, and the way to play a traitor. */
function floorsSide(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const card = h('div', 'lb-side');
  card.style.setProperty('--team', hex(teamColour(1, 0)));
  card.append(h('div', 'lb-side-head', null, h('span', 'lb-side-name', 'The Floors'), h('span', 'lb-side-count', dungeonCard(ctx.tuning).count)));
  const list = h('div', 'lb-who');
  state.teams[1]!.forEach((seat, index) => {
    if (seat.kind === 'Player') list.append(whoRow(ctx, state, seat, teamColour(1, index)));
  });
  const me = ctx.lobby.me;
  const at = me === null ? null : seatOf(state, me);
  const free = traitorSeat(state);
  if (at && at.team === 0 && free !== null) list.append(button('lb-join', 'Play as a traitor', () => ctx.lobby.moveMe({ team: 1, index: free })));
  card.append(list);
  return card;
}

/** The host's one AI level for every AI (each can still be set apart under More options). Shown while there is an AI. */
function aiLevelRow(ctx: LobbyViewContext, state: LobbyState): HTMLElement | null {
  if (!ctx.lobby.isHost || isBattle(state)) return null;
  const aisOf = (s: LobbyState) =>
    s.teams.flatMap((row, team) => row.flatMap((seat, index) => (seat.kind === 'AI' ? [{ seat, at: { team, index } }] : [])));
  const ais = aisOf(state);
  if (ais.length === 0) return null;
  const levels = SEAT_DIFFICULTIES.filter((d) => ctx.tuning.ai.difficulties[d]);
  const group = h('div', 'segmented');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'AI level');
  for (const d of levels) {
    const b = button('', d, () =>
      // The AIs as they are when clicked (a Seat may have moved since this was drawn).
      ctx.lobby.edit((s) => aisOf(s).reduce((acc, { seat, at }) => setSeat(acc, at, { ...seat, difficulty: d }), s)),
    );
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(ais.every(({ seat }) => seat.difficulty === d)));
    group.append(b);
  }
  return h('div', 'lb-row', null, h('span', 'lb-label', 'AI level'), group);
}

/** Everything else, folded away: each Seat's own settings, the seed, a Battle's options and what each Format means. */
function moreBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const editable = ctx.lobby.isHost;
  const seed = mapSeed(nextMatchArena(state, ctx.played ?? undefined));
  const seedRow = seed !== null && editable && !isBattle(state) ? h('div', 'lb-row', null, h('span', 'lb-label', seedLabel(state)), seedInput(ctx, seed)) : null;
  const details = h('details', 'lb-more');
  details.open = moreOpen;
  details.addEventListener('toggle', () => (moreOpen = details.open));
  const hint = isBattle(state) ? (editable ? 'fighting speed · how a Battle goes' : 'how a Battle goes') : editable ? "each AI's style, Weapon and build · seed" : 'seats and details';
  details.append(
    h('summary', '', null, h('span', '', 'More options'), h('span', 'lb-more-hint', hint)),
    h('div', 'lb-more-body', null, seedRow, teamsBlock(ctx, state), isBattle(state) ? battleKnobsBlock(ctx, state) : null),
  );
  return details;
}

/** Host: type a seed in to play a Random Map again (the next Match is on it). */
function seedInput(ctx: LobbyViewContext, seed: number): HTMLInputElement {
  const input = h('input', 'lb-seed');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.value = String(seed);
  input.setAttribute('aria-label', 'Random Map seed');
  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (Number.isSafeInteger(next) && next >= 0) ctx.lobby.edit((s) => updateSettings(s, { arena: randomMap(ctx.tuning, next) }));
    else input.value = String(seed);
  });
  return input;
}

// --- Battle options ---

/** A Battle map as the Lobby offers it: `id` is the `map` knob's value (`open`: none), `where` how the Battle card says where the armies meet. */
export interface BattleMapChoice {
  readonly id: string;
  readonly label: string;
  readonly where: string;
  readonly blurb: string;
  readonly art: string;
}

/**
 * The Battle maps the Lobby knows by name (docs/plans/battle-objectives.md, Stage 3a): the open field, then the hand-built maps' cards as
 * they were before a map file carried its own (docs/plans/map-editor.md, Stage 3). A map file's `lobby` wins over its entry here.
 */
export const BATTLE_MAPS: readonly BattleMapChoice[] = [
  { id: OPEN_FIELD, label: 'Open field', where: 'on an open field', blurb: 'Gentle hills, fresh each Battle', art: 'linear-gradient(180deg, #8fb4d8, #cfdcc0 45%, #6f9a47 46%, #3b5f25)' },
  { id: 'fort', label: 'Fort', where: 'round a ruined fort, its walls broken by gates and breaches,', blurb: 'A ruined fort, its walls breached', art: 'linear-gradient(180deg, #9db3c8, #c9c3b0 50%, #6b6a5a 51%, #3d4a2c)' },
  { id: 'ziggurat', label: 'Ziggurat', where: 'on and in an ancient stepped temple above the jungle,', blurb: 'A stepped temple over the jungle', art: 'linear-gradient(180deg, #c9d8a8, #7fa55a 45%, #8a7a58 46%, #2f4a22)' },
  { id: 'city', label: 'City', where: 'over the streets and rooftops of a hill town under its castle,', blurb: 'Streets and rooftops under a castle', art: 'linear-gradient(180deg, #a8bccf, #d8c6a4 45%, #8f6f55 46%, #4a3a30)' },
  { id: 'cavern', label: 'Cavern', where: 'in a cavern of cut basalt, over a river of lava,', blurb: 'Lava river, bridges and platforms', art: 'linear-gradient(180deg, #2a2224, #3b2d2b 45%, #ff6a1a 46%, #6a1d08)' },
];

/** The card of a map with neither a `lobby` of its own nor an entry in BATTLE_MAPS: its name, and a plain gradient. */
const PLAIN_ART = 'linear-gradient(180deg, #9aa8b8, #b9b8a8 45%, #6f7466 46%, #3a4034)';

/** Map `id`'s card from its file's `lobby` card: each part from it, else from its BATTLE_MAPS entry, else plain (its name capitalised). The Map Editor previews it. */
export function battleMapCard(id: string, lobby: BattleMapLobby | undefined): BattleMapChoice {
  const known = BATTLE_MAPS.find((m) => m.id === id);
  const label = lobby?.label ?? known?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
  return {
    id,
    label,
    where: lobby?.where ?? known?.where ?? `on ${label},`,
    blurb: lobby?.blurb ?? known?.blurb ?? 'A hand-built Battle map',
    art: lobby?.art ?? known?.art ?? PLAIN_ART,
  };
}

/**
 * The Battle maps this Tuning Data has, as the Lobby offers them: the open field, the maps BATTLE_MAPS knows in its order, then every other
 * map of `battle.maps` in its order (a map saved from the Map Editor into `data/battlemaps/` appears with no code change).
 */
export function battleMaps(tuning: Pick<TuningData, 'battle'>): readonly BattleMapChoice[] {
  const maps = tuning.battle.maps;
  const known = BATTLE_MAPS.filter((m) => m.id !== OPEN_FIELD && Object.hasOwn(maps, m.id)).map((m) => m.id);
  const others = Object.keys(maps).filter((id) => id !== OPEN_FIELD && !known.includes(id));
  return [BATTLE_MAPS[0]!, ...[...known, ...others].map((id) => battleMapCard(id, maps[id]!.lobby))];
}

/** The Battle map `knobs` pick, as the Lobby offers it (the open field for none, or one this Tuning Data does not have). */
export const battleMapChoice = (tuning: Pick<TuningData, 'battle'>, knobs: BattleKnobs | undefined): BattleMapChoice => battleMaps(tuning).find((m) => m.id === knobs?.map) ?? BATTLE_MAPS[0]!;

/** `knobs` with the map `id` picked (`open` drops the key), the army size back to that map's standard. */
export function withBattleMap(knobs: BattleKnobs | undefined, id: string): BattleKnobs {
  const { map: _map, armySize: _army, ...rest } = knobs ?? {};
  return id === OPEN_FIELD ? rest : { ...rest, map: id };
}

/** One Battle knob as the Lobby offers it: its choices (value, label) and the value that leaves Tuning Data as it is. */
interface BattleKnobRow {
  readonly key: keyof BattleKnobs;
  readonly label: string;
  readonly standard: number;
  readonly choices: readonly (readonly [number, string])[];
}

/** The Battle options the Lobby offers on the map `knobs` pick, each with its standard choice: the army sizes up to that map's cap, its own standard among them. */
export function battleKnobRows(tuning: Pick<TuningData, 'battle'>, knobs?: BattleKnobs): BattleKnobRow[] {
  const map = battleMapPicked(tuning.battle, knobs);
  const standard = standardArmySize(tuning.battle, map);
  const cap = armySizeCap(tuning.battle, map);
  const sizes = [...new Set([10, 25, 50, 100, 200, 300, standard])].filter((n) => n <= cap).sort((a, b) => a - b);
  return [
    { key: 'armySize', label: 'Soldiers a side', standard, choices: sizes.map((n) => [n, String(n)] as const) },
    { key: 'hitRate', label: 'Fighting speed', standard: 1, choices: [[0.25, '¼×'], [0.5, '½×'], [0.75, '¾×'], [1, '1×'], [1.5, '1½×']] },
  ];
}

/** `knobs` with `row`'s key set to `value`, or dropped when that is its standard. */
export function withBattleKnob(knobs: BattleKnobs | undefined, row: BattleKnobRow, value: number): BattleKnobs {
  const { [row.key]: _old, ...rest } = knobs ?? {};
  return value === row.standard ? rest : { ...rest, [row.key]: value };
}

/** A Battle's options (army size and how often soldiers land blows): the host sets them, everyone sees them. */
function battleKnobsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const editable = ctx.lobby.isHost;
  const knobs = state.settings.battle;
  const rows = battleKnobRows(ctx.tuning, knobs).map((row) => {
    // The army size as the Battle will have it: held to the map's cap.
    const current = row.key === 'armySize' ? runTuning(ctx.tuning, state.settings).battle.armySize : (knobs?.[row.key] ?? row.standard);
    const group = h('div', 'segmented');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', row.label);
    for (const [value, text] of row.choices) {
      const b = button('', text, () => ctx.lobby.edit((s) => updateSettings(s, { battle: withBattleKnob(s.settings.battle, row, value) })));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(value === current));
      if (value === row.standard) b.title = 'Standard';
      b.disabled = !editable;
      group.append(b);
    }
    return h('div', 'lb-row lb-knob', null, h('span', 'lb-label', row.label), group);
  });
  // Back to standard: the army size and fighting speed, on the map picked.
  const changed = knobs !== undefined && Object.keys(knobs).some((k) => k !== 'map');
  const reset =
    editable && changed ? button('lb-reset', 'Back to standard', () => ctx.lobby.edit((s) => updateSettings(s, { battle: s.settings.battle?.map === undefined ? {} : { map: s.settings.battle.map } }))) : null;
  const note = h('p', 'lb-note', `Fighting speed scales how often soldiers land blows on each other: slower means longer battles. ${editable ? '' : 'The host sets these.'}`);
  return section('Battle options', ...rows, note, reset);
}

// --- Your Weapon ---

/**
 * Each Weapon's Speed bar on its card (0..1, the fastest 1): how fast it swings, the inverse of its mean Wind-up plus
 * Release Ticks (`attackTimings`, so its Motions and Tempo) over the Directions it attacks in. Not `speed`, the reference
 * Blade Speed damage is read against, which says nothing of how soon a swing lands (the Flail's is the roster's highest).
 * A Spin-up held longer is not counted: this is the swing at its quickest.
 */
export function swingSpeedBars(tuning: TuningData): Readonly<Record<string, number>> {
  const known = swingBars.get(tuning);
  if (known) return known;
  const swing = (name: string): number => {
    const ticks = (tuning.weapons[name]!.attacks ?? DIRECTIONS).map((d) => attackTimings(tuning, name, d).releaseEnd);
    return 1 / (ticks.reduce((a, b) => a + b, 0) / ticks.length);
  };
  const speeds = Object.keys(tuning.weapons).map((name) => [name, swing(name)] as const);
  const top = Math.max(...speeds.map(([, v]) => v));
  const bars = Object.fromEntries(speeds.map(([name, v]) => [name, v / top]));
  swingBars.set(tuning, bars);
  return bars;
}
/** The bars for each Tuning Data seen: they depend on nothing else, and the Lobby redraws on every pick. */
const swingBars = new WeakMap<TuningData, Readonly<Record<string, number>>>();

// --- You: your look and your Weapon ---

/** Your Body (click it to change your look and build, right here) and your Weapon as a grid of pictures, its name and grip under it. */
function loadoutBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement | null {
  const me = ctx.lobby.me;
  const mine = me === null ? undefined : member(state, me);
  if (!mine) return null;
  const portrait = h('button', 'lb-portrait', null, h('span', 'lb-portrait-name', mine.name), ctx.look ? h('span', 'lb-portrait-edit', lookOpen ? 'Done' : 'Edit') : null);
  portrait.style.backgroundImage = `url("${thumb('bodies', mine.body)}")`;
  // Drawn live over the picture (which shows until then, or for good where there is no WebGL).
  const at = me === null ? null : seatOf(state, me);
  // Your colour as the Match gives it: your Team's, by how many fight before you on it.
  // (as the sides number them: a Battle's AI Seats field nobody, so they are not counted).
  const before = at ? state.teams[at.team]!.slice(0, at.index).filter((s) => shownSeat(state, s).kind === 'Player' || shownSeat(state, s).kind === 'AI').length : 0;
  const live = portraitOf(ctx.tuning);
  if (live) {
    live.attach(portrait, { body: mine.body, weapon: mine.weapon, size: mine.size, colour: teamColour(at?.team ?? 0, before) });
    portrait.classList.add('is-live');
  }
  // The look panel, built only once opened (the Lobby redraws on every change, and it holds a picture per Body).
  const panel = h('div', 'lb-look');
  panel.hidden = true;
  const showLook = (look: NonNullable<LobbyViewContext['look']>) => {
    if (lookOpen && !panel.firstChild) {
      const { grid, sliders } = look();
      panel.append(grid, sliders);
    }
    panel.hidden = !lookOpen;
  };
  if (ctx.look) {
    const look = ctx.look;
    showLook(look);
    portrait.title = 'Change your look, height and weight';
    portrait.setAttribute('aria-expanded', String(lookOpen));
    portrait.addEventListener('click', () => {
      lookOpen = !lookOpen;
      showLook(look);
      portrait.setAttribute('aria-expanded', String(lookOpen));
      portrait.querySelector('.lb-portrait-edit')!.textContent = lookOpen ? 'Done' : 'Edit';
    });
  } else portrait.disabled = true;
  const grid = h('div', 'lb-weapons');
  grid.setAttribute('aria-label', 'Your Weapon');
  const weapons = Object.values(ctx.tuning.weapons);
  for (const w of weapons) {
    const b = h('button', 'lb-weapon', null, thumbImage('', 'weapons', weaponThumb(w.name), w.name));
    b.title = w.name;
    b.setAttribute('aria-label', w.name);
    b.setAttribute('aria-pressed', String(w.name === mine.weapon));
    b.addEventListener('click', () => ctx.lobby.setMine({ weapon: w.name }));
    grid.append(b);
  }
  const picked = ctx.tuning.weapons[mine.weapon];
  const line = h('div', 'lb-weapon-line', null, h('span', 'lb-weapon-name', mine.weapon), picked ? h('span', '', picked.grip === 'twoHanded' ? 'Two-handed' : 'One-handed') : null);
  const stats = picked ? weaponStats(ctx.tuning, picked) : null;
  const note = ctx.inGame ? h('p', 'lb-note', 'Changes apply when the Match restarts.') : null;
  return h('div', 'lb-load', null, portrait, ctx.look ? panel : null, h('div', '', null, grid, line, stats), note);
}

/** The picked Weapon's Reach, Damage and Speed bars, each against the roster's best. */
function weaponStats(tuning: TuningData, w: TuningData['weapons'][string]): HTMLElement {
  const roster = Object.values(tuning.weapons);
  const top = (k: 'length' | 'damage') => Math.max(...roster.map((x) => x[k]));
  const stat = (label: string, value: number, max: number) => {
    const bar = h('span', 'stat-fill');
    bar.style.width = `${Math.round((100 * value) / max)}%`;
    return h('span', 'stat', null, h('span', 'stat-label', label), h('span', 'stat-bar', null, bar));
  };
  return h('div', 'lb-weapon-stats', null, stat('Reach', w.length, top('length')), stat('Damage', w.damage, top('damage')), stat('Speed', swingSpeedBars(tuning)[w.name]!, 1));
}
