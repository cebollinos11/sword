import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash } from '../tuning';
import { checkLineup, FLOOR_DIFFICULTY, lineupAis, lineupMatch } from '../controllers';
import { createMatch, floorRoster, IDLE_INTENT, MAX_TEAM_SIZE } from '../sim';
import { playerVsAi } from '../play/driver';
import {
  formatProblem,
  isGauntlet,
  join,
  lobbyLineup,
  moveMember,
  newLobby,
  nextMatchArena,
  runTuning,
  seatOf,
  setFormat,
  setSeat,
  startMatch,
  startProblem,
  teamSize,
  updateSettings,
  type LobbyState,
  type NewLobbyOptions,
} from './lobby';
import { parseLobbyMessage } from './messages';

const tuning = loadTuningData();
const weapon = Object.keys(tuning.weapons)[0]!;
const other = Object.keys(tuning.weapons)[1] ?? weapon;
const options = (online: boolean, arena = 'library'): NewLobbyOptions => ({
  host: { name: 'Host', weapon, body: 'monk' },
  settings: { arena, bestOf: 3 },
  online,
  ai: { difficulty: 'Normal', weapon: other },
});
const FRESH = 'gen:greybox:777';
const gauntlet = (s: LobbyState) => setFormat(s, 'Gauntlet', FRESH);
const guest = (id: number) => ({ id, name: `Guest ${id}`, weapon: other, body: 'snake', ready: false });

describe('Gauntlet Lobby: the Map is a Random Map', () => {
  it('picking Gauntlet with a hand-made Map selected switches to Random with the fresh seed given', () => {
    const s = gauntlet(newLobby(options(false, 'library')));
    expect(isGauntlet(s)).toBe(true);
    expect(s.settings.arena).toBe(FRESH);
    expect(nextMatchArena(s)).toBe(FRESH);
  });

  it('keeps a Random Map already selected (its seed is the Run seed)', () => {
    let s = newLobby(options(false, 'gen:greybox:42'));
    s = startMatch(s);
    const before = nextMatchArena(s);
    s = gauntlet(s);
    expect(s.settings.arena).toBe('gen:greybox:42');
    // The run of Arenas goes on: the next Run starts where the last Match left off.
    expect(nextMatchArena(s)).toBe(before);
  });

  it('ignores a hand-made Map while in Gauntlet, takes another Random seed, and back in Duels takes any Map again', () => {
    let s = gauntlet(newLobby(options(false)));
    expect(updateSettings(s, { arena: 'library' })).toBe(s);
    s = updateSettings(s, { arena: 'gen:greybox:9' });
    expect(s.settings.arena).toBe('gen:greybox:9');
    s = setFormat(s, 'Duels', FRESH);
    expect(s.settings).toEqual({ arena: 'gen:greybox:9', bestOf: 3, format: 'Duels' });
    expect(updateSettings(s, { arena: 'library' }).settings.arena).toBe('library');
  });
});

describe('Gauntlet Lobby: Players only on Team 0', () => {
  it('moves a Player sitting on Team 1 to Team 0', () => {
    let s = newLobby(options(false));
    s = moveMember(s, 0, { team: 1, index: 2 });
    expect(seatOf(s, 0)).toEqual({ team: 1, index: 2 });
    s = gauntlet(s);
    expect(seatOf(s, 0)?.team).toBe(0);
  });

  it('refuses a move to Team 1, and seats a joining guest on Team 0', () => {
    let s = gauntlet(newLobby(options(true)));
    expect(moveMember(s, 0, { team: 1, index: 0 })).toBe(s);
    s = join(s, guest(1))!;
    expect(seatOf(s, 1)).toEqual({ team: 0, index: 1 });
    // The switch moved Team 1's Open Seats beside the host (Stage 4), so the second and third guests join there too.
    s = join(s, guest(2))!;
    expect(seatOf(s, 2)).toEqual({ team: 0, index: 2 });
    s = join(s, guest(3))!;
    expect(seatOf(s, 3)).toEqual({ team: 0, index: 3 });
    // The Room is full, and Team 1 kept no Open Seat.
    expect(s.teams[1]!.some((x) => x.kind === 'Open')).toBe(false);
    expect(join(s, guest(4))).toBeNull();
  });

  it('can switch to Gauntlet with a full Room: Team 0 holds every Player', () => {
    let s = newLobby(options(true));
    for (let id = 1; id <= 3; id++) s = join(s, guest(id))!;
    expect(formatProblem(s, 'Gauntlet')).toBeNull();
    s = gauntlet(s);
    for (const id of [0, 1, 2, 3]) expect(seatOf(s, id)?.team).toBe(0);
    expect(teamSize(s, 0)).toBe(MAX_TEAM_SIZE);
    expect(formatProblem(s, 'Duels')).toBeNull();
  });
});

describe('the Gauntlet Lineup', () => {
  it('fields Team 0 from its Seats, then MAX_TEAM_SIZE Floor slots, whatever Team 1’s Seats hold', () => {
    let s = newLobby(options(false));
    s = setSeat(s, { team: 0, index: 1 }, { kind: 'AI', difficulty: 'Hard', weapon: other });
    s = gauntlet(s);
    const { lineup, weapons, members } = lobbyLineup(s);
    expect(lineup).toEqual([
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' }, weapon: other },
      ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } })),
    ]);
    expect(weapons).toEqual([weapon]);
    expect(members).toEqual([0]);
    expect(teamSize(s, 1)).toBe(MAX_TEAM_SIZE);
    expect(startProblem(s, false)).toBeNull();
  });

  it('is accepted by checkLineup for a Gauntlet (and only there), and builds a Run with a Floor AI on every Team 1 slot', () => {
    const { lineup, weapons } = lobbyLineup(gauntlet(newLobby(options(false))));
    expect(() => checkLineup(tuning, lineup, 1, 'Gauntlet')).not.toThrow();
    expect(() => checkLineup(tuning, lineup, 1)).toThrow();
    const m = createMatch(tuning, lineupMatch(tuning, lineup, weapons, { format: 'Gauntlet', bestOf: 1, arena: FRESH }));
    expect(m.run).toMatchObject({ floor: 1, floors: tuning.gauntlet.floors.length });
    expect(m.config.humans).toBe(1);
    const benched = m.duel.fighters.map((f) => Boolean(f.benched));
    expect(benched).toEqual([false, ...floorRoster(tuning, m.config, 1).map((e) => e === null)]);
    expect(benched.filter((b) => !b)).toHaveLength(1 + tuning.gauntlet.floors[0]!.enemies.filter((e) => (e.minTeam ?? 0) <= 1).length);
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    expect(ais[0]).toBeNull();
    expect(ais.slice(1).every((ai) => ai !== null)).toBe(true);
  });

  it('a Duels Lineup is refused as a Gauntlet’s', () => {
    const { lineup } = lobbyLineup(newLobby(options(false)));
    expect(() => checkLineup(tuning, lineup, 1, 'Gauntlet')).toThrow();
  });

  it('the Skirmish driver plays it as a Run: Floor AIs move the enemies, Benched slots stay put', () => {
    const { lineup, weapons } = lobbyLineup(gauntlet(newLobby(options(false))));
    const d = playerVsAi(tuning, { lineup, weapon: weapons[0]!, format: 'Gauntlet', bestOf: 1, arena: FRESH, seed: 3 });
    const start = d.state!;
    for (let t = 0; t < 120; t++) d.tick(IDLE_INTENT);
    const now = d.state!;
    expect(now.config.format).toBe('Gauntlet');
    const enemy = 1;
    const moved = Math.hypot(now.duel.fighters[enemy]!.position.x - start.duel.fighters[enemy]!.position.x, now.duel.fighters[enemy]!.position.z - start.duel.fighters[enemy]!.position.z);
    expect(moved).toBeGreaterThan(0.5);
    for (let i = 2; i <= MAX_TEAM_SIZE; i++) {
      if (start.duel.fighters[i]!.benched) expect(now.duel.fighters[i]!.position).toEqual(start.duel.fighters[i]!.position);
    }
  });
});

describe('Gauntlet Lobby: Run knobs', () => {
  it('a Run with knobs plays the knobbed Gauntlet (a new Tuning Data hash); Duels and a Run without them keep Tuning Data', () => {
    let s = gauntlet(newLobby(options(false)));
    expect(runTuning(tuning, s.settings)).toBe(tuning);
    s = updateSettings(s, { run: { maxEnemies: 1, enemyHp: 0.5 } });
    const t = runTuning(tuning, s.settings);
    expect(t.gauntlet.floors.every((f) => f.enemies.length === 1)).toBe(true);
    expect(tuningDataHash(t)).not.toBe(tuningDataHash(tuning));
    expect(runTuning(tuning, { ...s.settings, format: 'Duels' })).toBe(tuning);
    // Floor 1 lists more than one enemy; with one a Floor, only the first stands.
    const { lineup, weapons } = lobbyLineup(s);
    const match = createMatch(t, lineupMatch(t, lineup, weapons, { bestOf: 1, arena: s.settings.arena, format: 'Gauntlet' }));
    expect(match.duel.fighters.filter((f) => f.team === 1 && !f.benched).map((f) => f.maxHp)).toEqual([tuning.fighter.maxHp * 0.5]);
  });

  it('a lobby message carries the knobs, and refuses ones that are not numbers or not knobs', () => {
    const state = updateSettings(gauntlet(newLobby(options(true))), { run: { difficulty: -1, heal: 0.6 } });
    const m = { type: 'lobby', state, you: 0, ack: 0 } as const;
    expect(parseLobbyMessage(m)).toEqual(m);
    for (const run of [{ difficulty: 'easy' }, { lives: 3 }, [1], { heal: Infinity }])
      expect(parseLobbyMessage({ ...m, state: { ...state, settings: { ...state.settings, run } } })).toBeNull();
  });
});
