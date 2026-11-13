import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, IDLE_INTENT, inDuel, inStairs, MAX_TEAM_SIZE, secondsToTicks, type FighterState, type MatchState } from '../sim';
import { floorOf } from '../sim/delver';
import { createAllyAi, FOLLOW_DISTANCE } from './allyAi';
import { stepMatchWith, type Controller } from './controller';
import { createHallAi } from './hallAi';
import { lineupAis, type Lineup } from './lineup';

const base = loadTuningData();
/** A short Run: one tier of three Floors, with Warbands (the Tuning Data's own). */
const warbanded: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
/** The same on an empty Floor (`postFill` and `patrolFill` 0: still a Crowd, of no Soldiers), for the cases that need no enemy. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0 } };
const ARENA = 'gen:greybox:4242';
/** A Player (Fighter 0), two Ally AIs, and the Gauntlet's four Team 1 slots. */
const LINEUP: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } },
  ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } })),
];

const start = (): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: LINEUP.map((s) => s.team), humans: 1, players: [0] });
/** The Controllers of the lineup: the Player's slot stands (null becomes a scripted idle). */
const controllers = (): Controller[] => lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA, delver: true }).map((c) => c ?? { intent: () => IDLE_INTENT });
const edit = (m: MatchState, i: number, f: (x: FighterState) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((x, k) => (k === i ? f(x) : x)) } });
const dist = (a: FighterState, b: FighterState): number => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

describe('the AI on a Delver Run Floor', { timeout: 60_000 }, () => {
  it('an Ally AI follows a Player standing 10 m off to within the follow distance', () => {
    let m = start();
    // 10 m from the ally's spawn, across the Entrance Hall's floor (the Floor is the same every time).
    const from = m.duel.fighters[1]!.position;
    m = edit(m, 0, (f) => ({ ...f, position: { x: from.x, z: from.z + 10 } }));
    expect(dist(m.duel.fighters[0]!, m.duel.fighters[1]!)).toBeCloseTo(10, 5);
    const cs = controllers();
    for (let t = 0; t < secondsToTicks(10); t++) m = stepMatchWith(m, cs, tuning);
    const [player, ally] = [m.duel.fighters[0]!, m.duel.fighters[1]!];
    expect(dist(ally, player)).toBeLessThanOrEqual(FOLLOW_DISTANCE + 1);
  });

  it('with no Player standing, the allies walk to the Stairs and the Run takes them', () => {
    let m = edit(start(), 0, (f) => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } }));
    const cs = controllers();
    let taken = false;
    for (let t = 0; t < secondsToTicks(120) && !taken; t++) {
      m = stepMatchWith(m, cs, tuning);
      taken = m.events.some((e) => e.type === 'StairsTaken');
    }
    expect(taken).toBe(true);
    expect(m.delver!.phase).toBe('Descending');
    expect(m.score[0]).toBe(1);
  });

  it('an Ally AI asks for no move while the Run is Descending', () => {
    let m = edit(start(), 0, (f) => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } }));
    const cs = controllers();
    while (m.delver!.phase !== 'Descending' && m.tick < secondsToTicks(120)) m = stepMatchWith(m, cs, tuning);
    expect(m.delver!.phase).toBe('Descending');
    const plan = floorOf(tuning, m.arena)!.plan;
    expect(inStairs(plan, m.duel.fighters[1]!)).toBe(true);
    for (const i of [1, 2]) expect(cs[i]!.intent(m.duel, i).move).toEqual({ x: 0, z: 0 });
  });

  it('the Hall AI stands on a Floor', () => {
    const m = start();
    expect(createHallAi(tuning, 0, ARENA).intent(m.duel, 3)).toBe(IDLE_INTENT);
  });

  it('a Delver Gauntlet lineup gives Ally AIs to the party and Pool AIs to the other Pool slots (no Hall AI), and they step a Delver Run', () => {
    const ais = lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA, delver: true });
    expect(ais).toHaveLength(tuning.battle.bubble.poolSize);
    expect(ais[0]).toBeNull();
    expect(ais.slice(1).every((c) => c !== null)).toBe(true);
    // The Hall-graph Gauntlet's lineup is as it was: one entry a slot, a Hall AI on each Team 1 slot.
    expect(lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA })).toHaveLength(LINEUP.length);
    expect(createAllyAi(tuning, 'Hard', 'Balanced', [0])).toBeDefined();
    let m = start();
    const cs = controllers();
    expect(() => {
      for (let t = 0; t < 120; t++) m = stepMatchWith(m, cs, tuning);
    }).not.toThrow();
    expect(m.duel.fighters.filter(inDuel).length).toBe(3);
  });

  describe('with Warbands about', () => {
    const wstart = (): MatchState => createMatch(warbanded, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: LINEUP.map((s) => s.team), humans: 1, players: [0] });
    const wcontrollers = (): Controller[] => lineupAis(warbanded, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA, delver: true }).map((c) => c ?? { intent: () => IDLE_INTENT });
    /** `m` with a Pool slot bound to a Soldier, a promoted enemy standing `dx` m from Fighter `of` (in play at full HP). */
    const promoted = (m: MatchState, of: number, dx: number): MatchState => {
      const at = m.duel.fighters[of]!;
      return edit(m, 5, (f) => ({ ...f, benched: undefined, hp: f.maxHp, position: { x: at.position.x + dx, z: at.position.z }, y: at.y, soldier: { index: 0, since: 0, role: 'Attack' as const } }));
    };

    it('an Ally AI fights a promoted enemy within promote, and follows again once none is near', () => {
      const m = wstart();
      const cs = wcontrollers();
      const ally = cs[1]!;
      const player = m.duel.fighters[0]!.position;
      // The Player stands 10 m off, so the follow is a walk toward it.
      const apart = edit(m, 0, (f) => ({ ...f, position: { x: f.position.x, z: f.position.z + 10 } }));
      const follow = ally.intent(apart.duel, 1);
      expect(player).toBeDefined();
      expect(follow.move.x !== 0 || follow.move.z !== 0).toBe(true);
      const { promote } = warbanded.battle.bubble;
      const near = promoted(apart, 1, promote - 1);
      const fights = createAllyAi(warbanded, 'Hard', 'Balanced', [0]);
      const theAi = createAllyAi(warbanded, 'Hard', 'Balanced', [0]);
      // Its Intent is its AI's own: the same as an Ally AI of its kind asked of a state with nobody to follow (the follow differs).
      expect(fights.intent(near.duel, 1)).not.toEqual(createAllyAi(warbanded, 'Hard', 'Balanced', [0]).intent(apart.duel, 1));
      expect(theAi.intent(near.duel, 1)).toEqual(fights.intent(near.duel, 1));
      // Out of promote, or on another level, or not a promoted enemy: the follow again.
      const far = promoted(apart, 1, promote + 2);
      expect(createAllyAi(warbanded, 'Hard', 'Balanced', [0]).intent(far.duel, 1)).toEqual(follow);
      const other = edit(near, 5, (f) => ({ ...f, y: f.y + warbanded.battle.levels.height + 1 }));
      expect(createAllyAi(warbanded, 'Hard', 'Balanced', [0]).intent(other.duel, 1)).toEqual(follow);
      const unbound = edit(near, 5, (f) => ({ ...f, soldier: undefined }));
      expect(createAllyAi(warbanded, 'Hard', 'Balanced', [0]).intent(unbound.duel, 1)).toEqual(follow);
    });
  });
});
