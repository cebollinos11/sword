import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import {
  arenaOf,
  createMatch,
  exitDoor,
  hashValue,
  IDLE_INTENT,
  inDuel,
  inExitZone,
  MAX_TEAM_SIZE,
  restFire,
  secondsToTicks,
  stepMatch,
  takeOverFighter,
  type Intent,
  type MatchState,
} from '../sim';
import { createAiController } from './ai';
import { createAllyAi, FOLLOW_DISTANCE } from './allyAi';
import type { Controller } from './controller';
import { lineupAis, type Lineup, type LineupSlot } from './lineup';

const base = loadTuningData();
/** Doors that are never taken, so the party can be watched standing at one. */
const tuning: TuningData = { ...base, dungeon: { ...base.dungeon, doorSeconds: 1000 } };
const ENEMIES: LineupSlot[] = Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: 'Floor' } }));
const PLAYER = (player: 0 | 1 | 2): LineupSlot => ({ team: 0, pilot: { kind: 'Player', player } });
const ALLY: LineupSlot = { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } };
/** How long an ally may take to cross a Hall to a Door. */
const WALK_TICKS = secondsToTicks(20);

const match = (lineup: Lineup, arena: string, t: TuningData = tuning): MatchState => {
  const players = lineup.flatMap((s, i) => (s.pilot.kind === 'Player' ? [i] : []));
  return createMatch(t, { format: 'Gauntlet', bestOf: 1, seed: 3, arena, teams: lineup.map((s) => s.team), humans: players.length, players });
};

/** A spot in exit `exit`'s zone of the current Hall (the middle of the zone, nudged by `dx`), or with `exit` null the Rest fire's spot (away from every Door). */
function spot(m: MatchState, exit: number | null, dx = 0): { x: number; y: number; z: number } {
  const arena = arenaOf(tuning, m.arena);
  if (exit === null) return restFire(arena);
  const zone = arena.doors[exitDoor(exit)]!.zone;
  return { x: zone.reduce((s, p) => s + p.x, 0) / zone.length + dx, y: zone[0]!.y, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
}

/** The Match with Fighter `i` moved to `p`. */
const placed = (m: MatchState, i: number, p: { x: number; y: number; z: number }): MatchState => ({
  ...m,
  duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: { x: p.x, z: p.z }, y: p.y } : f)) },
});

/** Every enemy felled and one idle step: the Hall is Cleared. */
function cleared(m: MatchState, t: TuningData = tuning): MatchState {
  const felled = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
  const next = stepMatch(felled, felled.duel.fighters.map(() => IDLE_INTENT), t);
  expect(next.run!.phase).toBe('Cleared');
  return next;
}

/**
 * Step `ticks` Ticks of the Lineup's own Controllers (the Players idle), each Player of `hold` held at its spot every Tick;
 * `until` stops early. Returns every Match stepped to, the first one included.
 */
function play(m: MatchState, lineup: Lineup, hold: ReadonlyMap<number, { x: number; y: number; z: number }>, ticks: number, controllers = lineupAis(tuning, lineup, 'Gauntlet', { arena: m.config.arena }), t: TuningData = tuning): MatchState[] {
  const idle: Controller = { intent: () => IDLE_INTENT };
  const drive = controllers.map((c) => c ?? idle);
  const out: MatchState[] = [];
  for (let k = 0; k < ticks; k++) {
    for (const [i, p] of hold) m = placed(m, i, p);
    out.push(m);
    m = stepMatch(m, drive.map((c, i) => c.intent(m.duel, i)), t);
  }
  out.push(m);
  return out;
}

const SEEDS = [4242, 77, 9, 123];

describe('Ally AI', { timeout: 120_000 }, () => {
  it.each(SEEDS)('in a Cleared Hall it walks to the Door the Player stands at (gen:greybox:%i)', (seed) => {
    const lineup = [PLAYER(0), ALLY, ...ENEMIES];
    const start = cleared(match(lineup, `gen:greybox:${seed}`));
    const arena = arenaOf(tuning, start.arena);
    // The last exit, so it is not just the first Door.
    const exit = arena.doors.length - 2;
    expect(exit).toBeGreaterThanOrEqual(0);
    expect(inExitZone(arena, exit, start.duel.fighters[1]!)).toBe(false);
    const states = play(start, lineup, new Map([[0, spot(start, exit)]]), WALK_TICKS);
    const arrived = states.findIndex((m) => inExitZone(arena, exit, m.duel.fighters[1]!));
    expect(arrived, 'reached the Door').toBeGreaterThan(0);
    // ...and stays there.
    expect(states.slice(-30).every((m) => inExitZone(arena, exit, m.duel.fighters[1]!))).toBe(true);
    expect(states.at(-1)!.run!.phase).toBe('Cleared');
  });

  it('goes to the Door with the most Players in its zone, ties to the lowest exit', () => {
    const lineup = [PLAYER(0), PLAYER(1), ALLY, ...ENEMIES];
    const start = cleared(match(lineup, 'gen:greybox:4242'));
    const arena = arenaOf(tuning, start.arena);
    const last = arena.doors.length - 2;
    expect(last).toBeGreaterThan(0);
    const tie = play(start, lineup, new Map([[0, spot(start, last)], [1, spot(start, 0)]]), WALK_TICKS).at(-1)!;
    expect(inExitZone(arena, 0, tie.duel.fighters[2]!)).toBe(true);
    const most = play(start, lineup, new Map([[0, spot(start, last, -0.6)], [1, spot(start, last, 0.6)]]), WALK_TICKS).at(-1)!;
    expect(inExitZone(arena, last, most.duel.fighters[2]!)).toBe(true);
  });

  it.each(SEEDS)('follows a Player who stands at no Door (gen:greybox:%i)', (seed) => {
    const lineup = [PLAYER(0), ALLY, ...ENEMIES];
    const start = cleared(match(lineup, `gen:greybox:${seed}`));
    const arena = arenaOf(tuning, start.arena);
    const at = spot(start, null);
    const end = play(start, lineup, new Map([[0, at]]), WALK_TICKS).at(-1)!;
    const ally = end.duel.fighters[1]!;
    expect(Math.hypot(ally.position.x - at.x, ally.position.z - at.z)).toBeLessThan(FOLLOW_DISTANCE + 0.5);
    expect(arena.doors.slice(1).some((_, exit) => inExitZone(arena, exit, ally))).toBe(false);
  });

  it('with no Player alive it walks to the first exit, and the Run leaves through it', () => {
    const lineup = [PLAYER(0), ALLY, ...ENEMIES];
    const fallen = cleared(match(lineup, 'gen:greybox:4242', base), base);
    const m = { ...fallen, duel: { ...fallen.duel, fighters: fallen.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: 0 } : f)) } };
    const states = play(m, lineup, new Map(), WALK_TICKS, lineupAis(base, lineup, 'Gauntlet', { arena: m.config.arena }), base);
    expect(states.some((s) => s.run!.phase === 'Leaving')).toBe(true);
    expect(states.find((s) => s.events.some((e) => e.type === 'DoorTaken'))!.events).toContainEqual(expect.objectContaining({ type: 'DoorTaken', exit: 0 }));
  });

  // Where two allies stood stuck on a ramp in the soak, the other one already at the Door: [what, seed, start Hall, its
  // Arena, the two allies' spots]. Seed 6, after Floor 2's Boss: Fighter 0 on the ramp, Fighter 2 at its top edge, just
  // above and ahead of it. Seed 10, Floor 1's Rest Hall: Fighter 1 a step above Fighter 0 on a ramp, both on the way down.
  const RAMPS = [
    ['face to face', 6, { floor: 2, row: 4 }, 'gen:greybox:449527:d2', [0, { x: -2.253, y: 2.617, z: -3.735 }], [2, { x: -2.122, y: 3, z: -4.534 }]],
    ['one behind the other', 10, { floor: 1, row: 3, index: 0 }, 'gen:greybox:560098:d2', [0, { x: 1.13, y: 3.95, z: 5.6 }], [1, { x: 0.94, y: 4.31, z: 4.88 }]],
  ] as const;

  it.each(RAMPS)('two allies %s on a ramp get down it to the Door (the soak\'s seed %i)', (_, seed, at, hallArena, [a, pa], [b, pb]) => {
    // A party of AIs, as the soak plays it: Fighter 0 stands for the Player (it counts at a Door), driven by an Ally AI.
    const lineup: Lineup = [ALLY, ALLY, ALLY, ...ENEMIES];
    const arena = `gen:greybox:${seed}`;
    const start = cleared(createMatch(base, { format: 'Gauntlet', bestOf: 1, seed, arena, teams: lineup.map((s) => s.team), start: at }), base);
    expect(start.arena).toBe(hallArena);
    let m = placed(placed(start, a, pa), b, pb);
    const other = [0, 1, 2].find((i) => i !== a && i !== b)!;
    m = placed(m, other, spot(m, 0));
    const states = play(m, lineup, new Map(), WALK_TICKS, lineupAis(base, lineup, 'Gauntlet', { arena }), base);
    expect(states.some((s) => s.events.some((e) => e.type === 'DoorTaken'))).toBe(true);
  });

  it('does not walk to a taken-over Fighter as a Player: it goes where the Player still in the Run stands', () => {
    const lineup = [PLAYER(0), PLAYER(1), ALLY, ...ENEMIES];
    const start = cleared(match(lineup, 'gen:greybox:4242'));
    const arena = arenaOf(tuning, start.arena);
    const last = arena.doors.length - 2;
    expect(last).toBeGreaterThan(0);
    // Fighter 0 stands at the last exit, Fighter 1 at exit 0: a tie, which goes to exit 0 while both are Players...
    const hold = new Map([[0, spot(start, last)], [1, spot(start, 0)]]);
    expect(inExitZone(arena, 0, play(start, lineup, hold, WALK_TICKS).at(-1)!.duel.fighters[2]!)).toBe(true);
    // ...and to the last once Fighter 1 has been taken over (it reads that from the state).
    const gone = takeOverFighter(start, 1);
    const end = play(gone, lineup, hold, WALK_TICKS).at(-1)!;
    expect(inExitZone(arena, last, end.duel.fighters[2]!)).toBe(true);
    expect(inExitZone(arena, 0, end.duel.fighters[2]!)).toBe(false);
  });

  it('follows the Player still in the Run, and gathers at no Door for a taken-over Fighter standing at one', () => {
    const lineup = [PLAYER(0), PLAYER(1), ALLY, ...ENEMIES];
    const start = takeOverFighter(cleared(match(lineup, 'gen:greybox:4242')), 1);
    const arena = arenaOf(tuning, start.arena);
    const at = spot(start, null);
    // Fighter 1 (taken over) stands in exit 0's zone, Fighter 0 (the Player) at the fire, at no Door.
    const end = play(start, lineup, new Map([[0, at], [1, spot(start, 0)]]), WALK_TICKS).at(-1)!;
    const ally = end.duel.fighters[2]!;
    expect(inExitZone(arena, 0, ally)).toBe(false);
    expect(Math.hypot(ally.position.x - at.x, ally.position.z - at.z)).toBeLessThan(FOLLOW_DISTANCE + 0.5);
  });

  it("a taken-over Fighter's own Ally AI, and the others, treat every taken-over Fighter as an ally", () => {
    const lineup = [PLAYER(0), PLAYER(1), PLAYER(2), ...ENEMIES];
    const start = cleared(match(lineup, 'gen:greybox:4242'));
    const arena = arenaOf(tuning, start.arena);
    const last = arena.doors.length - 2;
    expect(last).toBeGreaterThan(0);
    // Fighters 1 and 2 are taken over (Controllers started as the session starts them: walking with the Players still playing); Fighter 0 stays.
    const gone = takeOverFighter(takeOverFighter(start, 1), 2);
    const controllers = [null, createAllyAi(tuning, 'Normal', 'Balanced', [0, 2]), createAllyAi(tuning, 'Normal', 'Balanced', [0, 1])] as (Controller | null)[];
    const hold = new Map([[0, spot(start, last)]]);
    const end = play(gone, lineup, hold, WALK_TICKS, controllers).at(-1)!;
    for (const i of [1, 2]) expect(inExitZone(arena, last, end.duel.fighters[i]!), `Fighter ${i}`).toBe(true);
  });

  it('fights as its own AI while the Hall is Fighting', () => {
    const lineup = [PLAYER(0), ALLY, ...ENEMIES];
    const states = play(match(lineup, 'gen:greybox:77'), lineup, new Map(), 200);
    const ally = lineupAis(tuning, lineup, 'Gauntlet', { arena: 'gen:greybox:77' })[1]!;
    const plain = createAiController(tuning, 'Hard');
    const fighting = states.filter((m) => m.run!.phase === 'Fighting').map((m) => m.duel);
    expect(fighting.length).toBeGreaterThan(150);
    const intents = (c: Controller): string[] => fighting.map((s) => hashValue(c.intent(s, 1)));
    const theirs = intents(ally);
    expect(theirs).toEqual(intents(plain));
    expect(theirs.some((h) => h !== hashValue(IDLE_INTENT))).toBe(true);
  });

  it('save/load mid-walk gives the same Intents (Rollback, resync)', () => {
    const lineup = [PLAYER(0), ALLY, ...ENEMIES];
    const start = cleared(match(lineup, 'gen:greybox:9'));
    const exit = arenaOf(tuning, start.arena).doors.length - 2;
    const states = play(start, lineup, new Map([[0, spot(start, exit)]]), 300).map((m) => m.duel);
    const ai = lineupAis(tuning, lineup, 'Gauntlet', { arena: start.config.arena })[1]!;
    const saves: unknown[] = [];
    const intents: Intent[] = [];
    for (const s of states) {
      saves.push(ai.save!());
      intents.push(ai.intent(s, 1));
    }
    expect(intents.some((i) => i.move.x !== 0 || i.move.z !== 0)).toBe(true);
    for (const at of [1, 60, 150]) {
      const other = lineupAis(tuning, lineup, 'Gauntlet', { arena: start.config.arena })[1]!;
      other.load!(JSON.parse(JSON.stringify(saves[at])));
      expect(states.slice(at).map((s) => hashValue(other.intent(s, 1))), `loaded at ${at}`).toEqual(intents.slice(at).map((i) => hashValue(i)));
    }
  });
});
