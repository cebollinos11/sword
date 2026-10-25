import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, floorRoster, MAX_TEAM_SIZE, withGeneratedArena } from '../sim';
import { hashValue } from '../hash';
import { runMatch, type Controller } from './controller';
import { checkLineup, FLOOR_DIFFICULTY, lineupAis, lineupMatch, type Lineup } from './lineup';

const tuning = loadTuningData();
const FOUR_V_FOUR = [0, 0, 0, 0, 1, 1, 1, 1];

describe('Four a side', () => {
  it('fields four Fighters a team', () => {
    expect(MAX_TEAM_SIZE).toBe(4);
  });

  it('starts a 4 v 4 Match at the spawns of every hand-made Arena that has them', () => {
    for (const name of Object.keys(tuning.arenas)) {
      const { spawns } = arenaOf(tuning, name);
      if (spawns.length === 0) continue;
      const m = createMatch(tuning, { bestOf: 1, teams: FOUR_V_FOUR, arena: name });
      const at = (team: number, slot: number) => spawns.find((s) => s.team === team && s.slot === slot)!.position;
      expect(m.duel.fighters.map((f) => [f.position.x, f.position.z]), name).toEqual(FOUR_V_FOUR.map((team, i) => [at(team, i % 4).x, at(team, i % 4).z]));
    }
  });

  it('plays a 4 v 4 AI Match on a Random Map to its end, the same way every time', { timeout: 120_000 }, () => {
    const arena = 'gen:greybox:21';
    const { tuning: built } = withGeneratedArena(tuning, arena);
    const lineup: Lineup = FOUR_V_FOUR.map((team) => ({ team, pilot: { kind: 'AI', difficulty: 'Skilled' } }));
    const play = () => runMatch(built, createMatch(built, lineupMatch(built, lineup, [], { bestOf: 1, seed: 5, arena })), lineupAis(built, lineup, 'Duels', { seed: 5, arena }) as Controller[], 30_000);
    const one = play();
    expect(one.final.status.status).toBe('Over');
    expect(hashValue(play().final)).toBe(hashValue(one.final));
  });

  it('a Gauntlet with four humans on Team 0 meets the Floor enemies listed for a full team', () => {
    const arena = 'gen:greybox:4242';
    const lineup: Lineup = [
      ...([0, 1, 2, 3] as const).map((player) => ({ team: 0, pilot: { kind: 'Player', player } }) as const),
      ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
    ];
    expect(() => checkLineup(tuning, lineup, 4, 'Gauntlet')).not.toThrow();
    const weapon = Object.keys(tuning.weapons)[0]!;
    const m = createMatch(tuning, lineupMatch(tuning, lineup, Array<string>(4).fill(weapon), { format: 'Gauntlet', bestOf: 1, arena }));
    expect(m.config.humans).toBe(4);
    const enemies = m.duel.fighters.slice(4);
    const listed = tuning.gauntlet.floors[0]!.enemies;
    expect(enemies.filter((f) => !f.benched)).toHaveLength(listed.length);
    // A smaller Team 0 leaves the full-team enemies' slots Benched.
    const solo = floorRoster(tuning, { ...m.config, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] }, 1);
    expect(solo.filter((e) => e !== null)).toHaveLength(listed.filter((e) => (e.minTeam ?? 0) <= 1).length);
  });
});
