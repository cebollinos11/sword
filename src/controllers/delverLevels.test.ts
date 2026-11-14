import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, IDLE_INTENT, inStairs, MAX_TEAM_SIZE, runSeed, secondsToTicks, type FighterState, type MatchState } from '../sim';
import { floorArenaName, floorOf } from '../sim/delver';
import { stepMatchWith, type Controller } from './controller';
import { createDelverPilot } from './delverPilot';
import { lineupAis, type Lineup } from './lineup';

/**
 * The Delver pilot and the Ally AI on levelled Floors (docs/plans/delver.md, Stage 6, Task 3): the default Tuning, empty Floors, a fire or the Stairs
 * off the ground. Each case searches the Run seeds in a fixed order and fails loudly when none of the first `SEARCH` has what it needs.
 */
const base = loadTuningData();
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0, floor: { ...base.delver.floor, treasures: 0 } } };
const SEARCH = 60;

const LINEUP: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } },
  ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } })),
];

const planOf = (arena: string) => floorOf(tuning, floorArenaName(runSeed(arena), 1))!.plan;
/** The first Run (seed order) whose Floor 1 has `what`. */
function find(what: string, want: (plan: ReturnType<typeof planOf>) => boolean): string {
  for (let n = 1; n <= SEARCH; n++) if (want(planOf(`gen:greybox:${n}`))) return `gen:greybox:${n}`;
  throw new Error(`no Floor 1 of the first ${SEARCH} seeds has ${what}`);
}
const solo = (arena: string): MatchState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena, delver: true, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)], humans: 1, players: [0] });
const edit = (m: MatchState, i: number, f: (x: FighterState) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((x, k) => (k === i ? f(x) : x)) } });

describe('the Delver pilot and the Ally AI on levelled Floors', { timeout: 120_000 }, () => {
  it('the pilot walks to every fire at its y, the one off the ground included, and then to the Stairs', () => {
    const arena = find('a fire off the ground', (p) => p.markers.fires.some((f) => f.y >= 2));
    const plan = planOf(arena);
    let m = solo(arena);
    const pilot = createDelverPilot(tuning);
    const ais = lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena, delver: true });
    const cs: Controller[] = ais.map((c, i) => c ?? (i === 0 ? pilot : { intent: () => IDLE_INTENT }));
    const healed = new Set<number>();
    for (let t = 0; t < secondsToTicks(150) && m.delver!.floor === 1; t++) {
      m = stepMatchWith(m, cs, tuning);
      m.delver!.restUsed.forEach((u, k) => u.healed.includes(0) && healed.add(k));
    }
    expect([...healed].sort()).toEqual(plan.markers.fires.map((_, k) => k));
    expect(m.delver!.floor).toBe(2);
  });

  it('an Ally AI with no Player standing walks to its spot in the Stairs zone at the zone\'s y', () => {
    const arena = find('Stairs off the ground', (p) => p.markers.stairs.y >= 2);
    const plan = planOf(arena);
    let m = edit(solo(arena), 0, (f) => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } }));
    const cs: Controller[] = lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena, delver: true }).map((c) => c ?? { intent: () => IDLE_INTENT });
    let counted = false;
    for (let t = 0; t < secondsToTicks(150) && !counted; t++) {
      m = stepMatchWith(m, cs, tuning);
      counted = inStairs(plan, m.duel.fighters[1]!);
    }
    expect(counted).toBe(true);
    expect(m.duel.fighters[1]!.y).toBeGreaterThanOrEqual(plan.markers.stairs.y - 0.5);
  });
});
