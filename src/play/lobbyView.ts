/**
 * The Lobby drawn: the two teams with their Seats, the Match settings (Map
 * cards, Match length) and your Weapon cards. Used by the Skirmish setup, the
 * online Room Lobby and the in-game Match setup alike; who may change what
 * follows the Lobby (the host edits Seats and settings, everyone their own
 * Weapon and Seat).
 */
import { MAX_TEAM_SIZE } from '../sim';
import type { TuningData } from '../tuning';
import { teamColour } from '../render/fighterView';
import {
  BEST_OF,
  canSetSeat,
  MAX_PLAYERS,
  member,
  seatOf,
  setSeat,
  SUPPORTED_PLAYERS,
  teamSize,
  updateSettings,
  type Lobby,
  type LobbyState,
  type Seat,
  type SeatRef,
} from '../lobby';
import { button, h, hex, select, thumb, thumbImage, weaponThumb } from './dom';

/** How the menu presents each Arena; one missing here shows its file name on a plain card. */
export const ARENA_INFO: Readonly<Record<string, { label: string; blurb: string; art: string }>> = {
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
  circle: {
    label: 'Training circle',
    blurb: 'Open ground, nowhere to hide',
    art: 'radial-gradient(ellipse at 50% 80%, #b9d98a, #5f8a3a 50%, #2d4a1b)',
  },
};

export function arenaLabel(arena: string): string {
  return ARENA_INFO[arena]?.label ?? arena;
}

/** What the view needs besides the Lobby. */
export interface LobbyViewContext {
  readonly tuning: TuningData;
  readonly lobby: Lobby;
  /** In a Match (the in-game Match setup): changes apply on restart, and nobody readies. */
  readonly inGame: boolean;
}

/** The whole Lobby body: teams on the left, settings and your Weapon on the right. */
export function lobbyBody(ctx: LobbyViewContext): HTMLElement {
  const state = ctx.lobby.state!;
  const left = h('div', 'lb-main', null, teamsBlock(ctx, state));
  const right = h('div', 'lb-side', null, settingsBlock(ctx, state), weaponBlock(ctx, state));
  return h('div', 'lb-body', null, left, right);
}

function section(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h('section', 'lb-section', null, h('h3', 'lb-heading', title), ...children);
}

// --- Teams ---

function teamsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const teams = state.teams.map((_, team) => teamCard(ctx, state, team));
  const vs = h('div', 'lb-vs', null, h('span', '', `${teamSize(state, 0)}`), h('b', '', 'vs'), h('span', '', `${teamSize(state, 1)}`));
  const grid = h('div', 'lb-teams', null, teams[0]!, vs, teams[1]!);
  const humans = state.members.length;
  const note = ctx.lobby.online
    ? h('p', 'lb-note', `${humans} of ${SUPPORTED_PLAYERS} players · Rooms will hold up to ${MAX_PLAYERS} players in a later version.`)
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
    } else if (waiting) row.append(h('span', 'seat-ready', 'Next Match'));
    return row;
  }

  if (seat.kind === 'AI') {
    row.append(avatar('AI', colour));
    const info = h('div', 'seat-info');
    if (host) {
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', 'AI')), h('div', 'seat-controls', null, kindSelect(ctx, state, at, seat), weaponSelect(ctx, at, seat)));
    } else {
      info.append(h('div', 'seat-title', null, h('span', 'seat-name', `${seat.difficulty} AI`)), h('div', 'seat-sub', seat.weapon));
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
  return select('Seat', options, value, (v) => {
    const next: Exclude<Seat, { kind: 'Player' }> = v.startsWith('AI:') ? { kind: 'AI', difficulty: v.slice(3), weapon } : { kind: v as 'Open' | 'Closed' };
    ctx.lobby.edit((s) => setSeat(s, at, next));
  });
}

function weaponSelect(ctx: LobbyViewContext, at: SeatRef, seat: Extract<Seat, { kind: 'AI' }>): HTMLSelectElement {
  const weapons = Object.keys(ctx.tuning.weapons).map((w) => [w, w] as const);
  return select('AI Weapon', weapons, seat.weapon, (w) => ctx.lobby.edit((s) => setSeat(s, at, { ...seat, weapon: w })));
}

// --- Settings ---

function settingsBlock(ctx: LobbyViewContext, state: LobbyState): HTMLElement {
  const editable = ctx.lobby.isHost;
  const arenas = Object.keys(ctx.tuning.arenas);
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
  return section('Map', maps, h('div', 'lb-row', null, h('span', 'lb-label', 'Match'), length), hint);
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
