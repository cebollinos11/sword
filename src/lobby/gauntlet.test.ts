import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { checkLineup, FLOOR_DIFFICULTY, lineupAis, lineupMatch } from '../controllers';
import { createMatch, IDLE_INTENT, MAX_TEAM_SIZE } from '../sim';
import { playerVsAi } from '../play/driver';
import {
  formatProblem,
  isGauntlet,
  join,
  lobbyLineup,
  moveMember,
  newLobby,
  nextMatchArena,
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

describe('Gauntlet Lobby: Players on Team 0, traitors on Team 1', () => {
  it('moves a Player sitting on Team 1 to Team 0', () => {
    let s = newLobby(options(false));
    s = moveMember(s, 0, { team: 1, index: 2 });
    expect(seatOf(s, 0)).toEqual({ team: 1, index: 2 });
    s = gauntlet(s);
    expect(seatOf(s, 0)?.team).toBe(0);
  });

  it('lets a Player move to Team 1 (a traitor, docs/plans/delver.md, Stage 8a), and seats a joining guest on Team 0', () => {
    let s = gauntlet(newLobby(options(true)));
    expect(seatOf(moveMember(s, 0, { team: 1, index: 0 }), 0)).toEqual({ team: 1, index: 0 });
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

  it('is accepted by checkLineup for a Gauntlet (and only there), and builds a Run: the party, then Pool AIs past it', () => {
    const { lineup, weapons } = lobbyLineup(gauntlet(newLobby(options(false))));
    expect(() => checkLineup(tuning, lineup, 1, 'Gauntlet')).not.toThrow();
    expect(() => checkLineup(tuning, lineup, 1)).toThrow();
    const m = createMatch(tuning, lineupMatch(tuning, lineup, weapons, { format: 'Gauntlet', bestOf: 1, arena: FRESH }));
    expect(m.delver).toMatchObject({ floor: 1, floors: tuning.delver.tiers * tuning.delver.floorsPerTier });
    expect(m.config.humans).toBe(1);
    expect(m.config.players).toEqual([0]);
    expect(m.config.teams).toEqual([0]);
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    expect(ais).toHaveLength(tuning.battle.bubble.poolSize);
    expect(ais[0]).toBeNull();
    expect(ais.slice(1).every((ai) => ai !== null)).toBe(true);
  });

  it('a Duels Lineup is refused as a Gauntlet’s', () => {
    const { lineup } = lobbyLineup(newLobby(options(false)));
    expect(() => checkLineup(tuning, lineup, 1, 'Gauntlet')).toThrow();
  });

  it('the Skirmish driver plays it as a Run on its first Floor', () => {
    const { lineup, weapons } = lobbyLineup(gauntlet(newLobby(options(false))));
    const d = playerVsAi(tuning, { lineup, weapon: weapons[0]!, format: 'Gauntlet', bestOf: 1, arena: FRESH, seed: 3 });
    for (let t = 0; t < 60; t++) d.tick(IDLE_INTENT);
    expect(d.state!.config.format).toBe('Gauntlet');
    expect(d.state!.delver).toMatchObject({ floor: 1, phase: 'Exploring' });
  });

  it('with the dev autopilot the Player’s Fighter moves on its own (the local Intents idle)', () => {
    const { lineup, weapons } = lobbyLineup(gauntlet(newLobby(options(false))));
    const run = (autopilot?: boolean) => {
      const d = playerVsAi(tuning, { lineup, weapon: weapons[0]!, format: 'Gauntlet', bestOf: 1, arena: FRESH, seed: 3, ...(autopilot ? { autopilot } : {}) });
      const start = d.state!.duel.fighters[d.localFighter]!.position;
      for (let t = 0; t < 120; t++) d.tick(IDLE_INTENT);
      const now = d.state!.duel.fighters[d.localFighter]!.position;
      return Math.hypot(now.x - start.x, now.z - start.z);
    };
    expect(run()).toBeLessThan(0.01);
    expect(run(true)).toBeGreaterThan(0.5);
  });
});
