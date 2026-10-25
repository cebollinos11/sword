/**
 * The Lobby drawn: the two teams with their Seats, the Match settings (Format,
 * Map cards, Match length) and your Weapon cards. In a Gauntlet, Team 1's Seats
 * give way to the Floors, the hand-made Maps and the Match length are hidden,
 * and the Random card names the Run seed. Used by the Skirmish setup, the
 * online Room Lobby and the in-game Match setup alike; who may change what
 * follows the Lobby (the host edits Seats and settings, everyone their own
 * Weapon and Seat).
 */
import { ARENA_SEED_RANGE, MATCH_FORMATS, MAX_TEAM_SIZE, parseGeneratedName, type MatchFormat } from '../sim';
import { DEFAULT_STYLE, MAX_FLOOR_ENEMIES, RANDOM_PICK, runDifficultyLadder, type RunKnobs, type TuningData } from '../tuning';
import { teamColour } from '../render/fighterView';
import {
  BEST_OF,
  canSetSeat,
  formatProblem,
  isGauntlet,
  MAX_PLAYERS,
  member,
  nextMatchArena,
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

/** The Formats the Lobby offers: both, in a Skirmish and online (a Run online is co-op: every Player on Team 0). */
export function offeredFormats(_online: boolean): readonly MatchFormat[] {
  return MATCH_FORMATS;
}

/** Why a Format the Lobby offers cannot be picked now (shown under the toggle), or null: e.g. a Gauntlet with four Players. */
export function formatRefusal(state: LobbyState, online: boolean): string | null {
  for (const f of offeredFormats(online)) {
    const problem = formatProblem(state, f);
    if (problem) return problem;
  }
  return null;
}

/** What a seated Player who is not in the Match being played waits for: the next Match, or the next Run. */
export function waitingTag(state: LobbyState): string {
  return isGauntlet(state) ? 'Next Run' : 'Next Match';
}

/** The teams whose Seats the Lobby shows: both, or in a Gauntlet only Team 0 (the Floors fill Team 1). */
export function shownTeams(state: LobbyState): number[] {
  return isGauntlet(state) ? [0] : state.teams.map((_, team) => team);
}

/** The Map cards besides Random: every pickable Arena, or none in a Gauntlet (a Run is on the Random Map). */
export function shownArenas(tuning: TuningData, state: LobbyState): string[] {
  return isGauntlet(state) ? [] : pickableArenas(tuning);
}

/** Whether the Match length (Best of N) is shown: not for a Run. */
export function showsBestOf(state: LobbyState): boolean {
  return !isGauntlet(state);
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
}

/** The whole Lobby body: teams on the left, settings and your Weapon on the right. */
export function lobbyBody(ctx: LobbyViewContext): HTMLElement {
  const state = ctx.lobby.state!;
  const left = h('div', 'lb-main', null, teamsBlock(ctx, state));
  const right = h('div', 'lb-side', null, settingsBlock(ctx, state), isGauntlet(state) ? knobsBlock(ctx, state) : null, weaponBlock(ctx, state));
  return h('div', 'lb-body', null, left, right);
}

function section(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h('section', 'lb-section', null, h('h3', 'lb-heading', title), ...children);
}

// --- Teams ---

function teamsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const shown = shownTeams(state);
  const teams = state.teams.map((_, team) => (shown.includes(team) ? teamCard(ctx, state, team) : floorsCard(ctx)));
  const vs = h('div', 'lb-vs', null, h('span', '', `${teamSize(state, 0)}`), h('b', '', 'vs'), h('span', '', `${teamSize(state, 1)}`));
  const grid = h('div', 'lb-teams', null, teams[0]!, vs, teams[1]!);
  const humans = state.members.length;
  const note = ctx.lobby.online
    ? h('p', 'lb-note', `${humans} of ${MAX_PLAYERS} players · Open seats wait for players to join; Empty ones field nobody.`)
    : null;
  return section('Teams', grid, note);
}

function teamCard(ctx: LobbyViewContext, state: LobbyState, team: number): HTMLElement {
  const card = h('div', `lb-team lb-team-${team}`);
  card.style.setProperty('--team', hex(teamColour(team, 0)));
  const fighters = teamSize(state, team);
  card.append(h('div', 'lb-team-head', null, h('span', 'lb-team-name', `Team ${team + 1}`), h('span', 'lb-team-count', `${fighters} ${fighters === 1 ? 'Fighter' : 'Fighters'}`)));
  let k = 0;
  for (let index = 0; index < MAX_TEAM_SIZE; index++) {
    const seat = state.teams[team]![index]!;
    const fights = seat.kind === 'Player' || seat.kind === 'AI';
    card.append(seatRow(ctx, state, { team, index }, seat, fights ? teamColour(team, k++) : null));
  }
  return card;
}

/** In a Gauntlet, Team 1's place: the Floors the Run fights through. */
function floorsCard(ctx: LobbyViewContext): HTMLElement {
  const card = h('div', 'lb-team lb-team-1');
  card.style.setProperty('--team', hex(teamColour(1, 0)));
  const floors = ctx.tuning.gauntlet.floors.length;
  card.append(
    h('div', 'lb-team-head', null, h('span', 'lb-team-name', 'The Floors'), h('span', 'lb-team-count', `${floors} ${floors === 1 ? 'Floor' : 'Floors'}`)),
    h('p', 'lb-note', `Clear each Floor's enemies to go on to the next, on a new Random Arena. The last Floor is the boss. HP carries over; fallen allies return on the next Floor.`),
  );
  return card;
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
    const info = h('div', 'seat-info', null, h('div', 'seat-title', null, h('span', 'seat-name', name), tags), h('div', 'seat-sub', m ? m.weapon : ''));
    row.append(avatar(name.slice(0, 1).toUpperCase(), colour), info);
    if (lobby.online && !ctx.inGame && seat.member !== 0) {
      row.append(h('span', `seat-ready ${m?.ready ? 'is-ready' : ''}`, m?.ready ? 'Ready' : 'Not ready'));
    } else if (waiting) row.append(h('span', 'seat-ready', waitingTag(state)));
    return row;
  }

  if (seat.kind === 'AI') {
    row.append(avatar('AI', colour));
    const info = h('div', 'seat-info');
    if (host) {
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', 'AI')), h('div', 'seat-controls', null, kindSelect(ctx, state, at, seat), styleSelect(ctx, at, seat), weaponSelect(ctx, at, seat)));
    } else {
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', `${seat.difficulty} AI`)), h('div', 'seat-sub', `${styleLabel(seat.style)} · ${seat.weapon}`));
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

/** Host: what a non-Player Seat holds: Closed, Open (online, within the Players a Match fields) or an AI at a difficulty. */
function kindSelect(ctx: LobbyViewContext, state: LobbyState, at: SeatRef, seat: Exclude<Seat, { kind: 'Player' }>): HTMLSelectElement {
  const difficulties = Object.keys(ctx.tuning.ai.difficulties);
  const options: [string, string][] = [['Closed', 'Empty']];
  if (ctx.lobby.online && (seat.kind === 'Open' || canSetSeat(state, at, 'Open'))) options.push(['Open', 'Open seat']);
  for (const d of difficulties) options.push([`AI:${d}`, `${d} AI`]);
  const value = seat.kind === 'AI' ? `AI:${seat.difficulty}` : seat.kind;
  const weapon = seat.kind === 'AI' ? seat.weapon : Object.keys(ctx.tuning.weapons)[0]!;
  const style = seat.kind === 'AI' && seat.style !== undefined ? { style: seat.style } : {};
  return select('Seat', options, value, (v) => {
    const next: Exclude<Seat, { kind: 'Player' }> = v.startsWith('AI:') ? { kind: 'AI', difficulty: v.slice(3), weapon, ...style } : { kind: v as 'Open' | 'Closed' };
    ctx.lobby.edit((s) => setSeat(s, at, next));
  });
}

/** An AI Seat's Style, as shown: the default when it names none, "Random" for one picked from the Match seed. */
const styleLabel = (style: string | undefined): string => (style === undefined ? DEFAULT_STYLE : style === RANDOM_PICK ? 'Random' : style);

/** Host: an AI Seat's Style (how it fights), or Random (picked from each Match's seed, the same on every peer). */
function styleSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const styles: [string, string][] = [...Object.keys(ctx.tuning.ai.styles).map((s) => [s, s] as [string, string]), [RANDOM_PICK, 'Random']];
  return select('AI Style', styles, seat.style ?? DEFAULT_STYLE, (v) => {
    const { style: _old, ...rest } = seat;
    ctx.lobby.edit((s) => setSeat(s, at, v === DEFAULT_STYLE ? rest : { ...rest, style: v }));
  });
}

function weaponSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const weapons = Object.keys(ctx.tuning.weapons).map((w) => [w, w] as const);
  return select('AI Weapon', weapons, seat.weapon, (w) => ctx.lobby.edit((s) => setSeat(s, at, { ...seat, weapon: w })));
}

// --- Settings ---

function settingsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const editable = ctx.lobby.isHost;
  const arenas = shownArenas(ctx.tuning, state);
  const maps = h('div', 'map-grid');
  for (const a of arenas) {
    const info = ARENA_INFO[a];
    const card = h('button', 'map-card', null, h('span', 'map-art'), h('span', 'map-name', arenaLabel(a)), info ? h('span', 'map-blurb', info.blurb) : null);
    // The Arena's picture, over its painted stand-in while it loads (or if it is missing).
    (card.firstChild as HTMLElement).style.background = `url("${thumb('arenas', a)}") center / cover no-repeat, ${info?.art ?? 'linear-gradient(160deg, #3a4654, #1a222b)'}`;
    card.setAttribute('aria-pressed', String(a === state.settings.arena));
    card.disabled = !editable && a !== state.settings.arena;
    if (editable) card.addEventListener('click', () => ctx.lobby.edit((s) => updateSettings(s, { arena: a })));
    maps.append(card);
  }
  if (Object.keys(ctx.tuning.kits).length > 0) maps.append(randomCard(ctx, state, editable));
  const seed = mapSeed(nextMatchArena(state, ctx.played ?? undefined));
  const length = h('div', 'segmented');
  length.setAttribute('role', 'radiogroup');
  length.setAttribute('aria-label', 'Match length');
  for (const n of BEST_OF) {
    const b = button('', `Best of ${n}`, () => ctx.lobby.edit((s) => updateSettings(s, { bestOf: n })));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(n === state.settings.bestOf));
    b.disabled = !editable;
    length.append(b);
  }
  const hint = editable ? null : h('p', 'lb-note', 'The host picks the Map and the Match length.');
  const seedRow = seed !== null && editable ? h('div', 'lb-row', null, h('span', 'lb-label', seedLabel(state)), seedInput(ctx, seed)) : null;
  const lengthRow = showsBestOf(state) ? h('div', 'lb-row', null, h('span', 'lb-label', 'Match'), length) : null;
  return section('Map', formatRow(ctx, state, editable), maps, seedRow, lengthRow, hint);
}

/** The Format toggle (Duels or Gauntlet), when the Lobby offers more than one. */
function formatRow(ctx: LobbyViewContext, state: LobbyState, editable: boolean): HTMLElement | null {
  const formats = offeredFormats(ctx.lobby.online);
  if (formats.length < 2) return null;
  const current = state.settings.format ?? 'Duels';
  const group = h('div', 'segmented');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Format');
  for (const f of formats) {
    const b = button('', f, () => ctx.lobby.edit((s) => setFormat(s, f, randomMap(ctx.tuning, pickSeed()))));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(f === current));
    const problem = formatProblem(state, f);
    b.disabled = !editable || problem !== null;
    if (problem) b.title = problem;
    group.append(b);
  }
  const refusal = editable ? formatRefusal(state, ctx.lobby.online) : null;
  const row = h('div', 'lb-row', null, h('span', 'lb-label', 'Format'), group);
  return refusal ? h('div', '', null, row, h('p', 'lb-note', refusal)) : row;
}

/** The Random Map's card: picking it (again) rolls a fresh seed; it shows the next Match's seed (each Match moves on to the next), or the Run seed. */
function randomCard(ctx: LobbyViewContext, state: LobbyState, editable: boolean): HTMLButtonElement {
  const seed = mapSeed(state.settings.arena) === null ? null : mapSeed(nextMatchArena(state, ctx.played ?? undefined));
  const blurb = randomBlurb(state, ctx.played, editable);
  const card = h('button', 'map-card', null, h('span', 'map-art'), h('span', 'map-name', 'Random'), h('span', 'map-blurb', blurb));
  (card.firstChild as HTMLElement).style.background = `url("${thumb('arenas', RANDOM_THUMB)}") center / cover no-repeat, ${RANDOM_ART}`;
  card.setAttribute('aria-pressed', String(seed !== null));
  card.disabled = !editable && seed === null;
  if (editable) card.addEventListener('click', () => ctx.lobby.edit((s) => updateSettings(s, { arena: randomMap(ctx.tuning, pickSeed()) })));
  return card;
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

// --- Run difficulty ---

type KnobKey = keyof RunKnobs;

/** One Run knob as the Lobby offers it: its choices (value, label) and the value that leaves Tuning Data as it is. */
interface KnobRow {
  readonly key: KnobKey;
  readonly label: string;
  readonly standard: number;
  readonly choices: readonly (readonly [number, string])[];
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The choices for a share, with Tuning Data's own value among them. */
function shares(values: readonly number[], standard: number, text: (v: number) => string): [number, string][] {
  return [...new Set([...values, standard])].sort((a, b) => a - b).map((v) => [v, text(v)]);
}

/** The Run knobs the Lobby offers, each with Tuning Data's value as its standard choice. */
export function knobRows(tuning: TuningData): KnobRow[] {
  const { heal, perPlayerHp } = tuning.gauntlet;
  return [
    { key: 'difficulty', label: 'Enemy skill', standard: 0, choices: [[-2, 'Easiest'], [-1, 'Easier'], [0, 'Standard'], [1, 'Harder']] },
    { key: 'enemyHp', label: 'Enemy HP', standard: 1, choices: [[0.5, '½×'], [0.75, '¾×'], [1, '1×'], [1.5, '1½×'], [2, '2×']] },
    { key: 'maxEnemies', label: 'Enemies a Floor', standard: MAX_FLOOR_ENEMIES, choices: Array.from({ length: MAX_FLOOR_ENEMIES }, (_, i) => [i + 1, i === 0 ? '1' : `Up to ${i + 1}`] as const) },
    { key: 'heal', label: 'Heal between Floors', standard: heal, choices: shares([0, 0.3, 0.6, 1], heal, (v) => (v === 0 ? 'None' : v === 1 ? 'Full' : percent(v))) },
    { key: 'perPlayerHp', label: 'Enemy HP per extra player', standard: perPlayerHp, choices: shares([0, 0.25, 0.5, 1], perPlayerHp, (v) => `+${percent(v)}`) },
  ];
}

/** `knobs` with `key` set to `value`, or dropped when that is its standard (absent knobs leave Tuning Data as it is). */
export function withKnob(knobs: RunKnobs | undefined, row: KnobRow, value: number): RunKnobs {
  const { [row.key]: _old, ...rest } = knobs ?? {};
  return value === row.standard ? rest : { ...rest, [row.key]: value };
}

/** A Run's difficulty knobs (Gauntlet only): the host sets them, everyone sees them. */
function knobsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const editable = ctx.lobby.isHost;
  const knobs = state.settings.run;
  const rows = knobRows(ctx.tuning).map((row) => {
    const current = knobs?.[row.key] ?? row.standard;
    const group = h('div', 'segmented');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', row.label);
    for (const [value, text] of row.choices) {
      const b = button('', text, () => ctx.lobby.edit((s) => updateSettings(s, { run: withKnob(s.settings.run, row, value) })));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(value === current));
      if (value === row.standard) b.title = 'Standard';
      b.disabled = !editable;
      group.append(b);
    }
    return h('div', 'lb-row lb-knob', null, h('span', 'lb-label', row.label), group);
  });
  const ladder = runDifficultyLadder(ctx.tuning.gauntlet).join(' → ');
  const changed = knobs !== undefined && Object.keys(knobs).length > 0;
  const reset = editable && changed ? button('lb-reset', 'Back to standard', () => ctx.lobby.edit((s) => updateSettings(s, { run: {} }))) : null;
  const note = h('p', 'lb-note', `Enemy skill steps every enemy along ${ladder}. ${editable ? '' : 'The host sets these.'}`);
  return section('Run difficulty', ...rows, note, reset);
}

// --- Your Weapon ---

function weaponBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement | null {
  const me = ctx.lobby.me;
  const mine = me === null ? undefined : member(state, me);
  if (!mine) return null;
  const roster = Object.values(ctx.tuning.weapons);
  const top = (k: 'length' | 'damage' | 'speed') => Math.max(...roster.map((w) => w[k]));
  const grid = h('div', 'weapon-grid');
  for (const w of roster) {
    const stat = (label: string, value: number, max: number) => {
      const bar = h('span', 'stat-fill');
      bar.style.width = `${Math.round((100 * value) / max)}%`;
      return h('span', 'stat', null, h('span', 'stat-label', label), h('span', 'stat-bar', null, bar));
    };
    const card = h(
      'button',
      'weapon-card',
      null,
      h('span', 'weapon-picture', null, thumbImage('', 'weapons', weaponThumb(w.name), w.name)),
      h('span', 'weapon-name', w.name),
      h('span', 'weapon-grip', w.grip === 'twoHanded' ? 'Two-handed' : 'One-handed'),
      stat('Reach', w.length, top('length')),
      stat('Damage', w.damage, top('damage')),
      stat('Speed', w.speed, top('speed')),
    );
    card.setAttribute('aria-pressed', String(w.name === mine.weapon));
    card.addEventListener('click', () => ctx.lobby.setMine({ weapon: w.name }));
    grid.append(card);
  }
  const note = ctx.inGame ? h('p', 'lb-note', 'Changes apply when the Match restarts.') : null;
  return section('Your Weapon', grid, note);
}
