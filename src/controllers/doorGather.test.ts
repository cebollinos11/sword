import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaOf, createMatch, floorGraph, IDLE_INTENT, inDuel, inExitZone, MAX_TEAM_SIZE, runKit, runSeed, secondsToTicks, stepMatch, withGeneratedArena, type HallRef, type MatchState } from '../sim';
import { createAutopilot, type Autopilot } from './autopilot';
import { createAllyAi } from './allyAi';
import type { Controller } from './controller';
import { lineupAis, type Lineup, type LineupSlot } from './lineup';

/**
 * Four Team 0 Fighters (the most a Run has) gathering at one exit Door of a Cleared Hall, as the dev autopilot (a Player's Fighter) and the
 * Ally AI walk them: each goes to a spot of its own inside the zone, so the last one in is not boxed out by the first (#72). A soak over the
 * Hall Arenas of Floor 1 of the Runs on seeds 1 to DOOR_GATHER_SEEDS (`gen:greybox:<n>`), and of the Run whose Hall 2 jammed (`JAMMED`): every
 * Fight and Elite Hall, every exit of it, the party scattered over the Hall's far side and setting off a few Ticks apart, a few ways round.
 */
const base = loadTuningData();
/** Doors that are never taken, so the party can be watched standing at one. */
const tuning: TuningData = { ...base, dungeon: { ...base.dungeon, doorSeconds: 1000 } };
const ENEMIES: LineupSlot[] = Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: 'Floor' } }));
const OURS = 4;
const LINEUP: Lineup = [...Array.from({ length: OURS }, (): LineupSlot => ({ team: 0, pilot: { kind: 'AI', difficulty: 'Hard' } })), ...ENEMIES];
/** How long the party may take to gather (Ticks). */
const GATHER_TICKS = secondsToTicks(30);
/** How long the party may take when the Player comes in last, after the Allies who follow the first (Ticks). */
const LATE_TICKS = 3 * GATHER_TICKS;
/** How many ways round (where the party starts, and who sets off when) each case is played. */
const TURNS = 4;
/** Run seeds soaked (`gen:greybox:<seed>`, Floor 1's Hall Arenas each); DOOR_GATHER_SEEDS=<n> soaks more. */
const SEEDS = Number(process.env.DOOR_GATHER_SEEDS ?? 2);
/** The Run whose Hall 2 jammed four autopilots at an exit Door (#72). */
const JAMMED = 'gen:greybox:888730:d3';

interface Case {
  readonly run: string;
  readonly at: HallRef;
  /** The Hall Arena the case plays in. */
  readonly arena: string;
}

/** The Fight and Elite Halls of Floor 1 of the Runs on seeds 1 to SEEDS (their Hall Arenas, `gen:greybox:<n>:d<exits + 1>`), and of the jammed Run. */
const CASES: readonly Case[] = [JAMMED, ...Array.from({ length: SEEDS }, (_, s) => `gen:greybox:${s + 1}`)]
  .flatMap((run) =>
    floorGraph(tuning.dungeon, runSeed(run), 1, runKit(tuning, run)).flatMap((row, r) =>
      row.flatMap((hall, i) => (hall.kind === 'Fight' || hall.kind === 'Elite' ? [{ run, at: { floor: 1, row: r, index: i }, arena: hall.arena }] : [])),
    ),
  )
  .filter((c) => !process.env.GATHER_ONLY || c.arena.includes(process.env.GATHER_ONLY));

/** The Hall of `c` with its Cleared phase reached (its enemies felled, one idle step), and `OURS` Players on Team 0. */
function cleared(c: Case): { m: MatchState; t: TuningData; name: string } {
  const t = withGeneratedArena(tuning, c.arena).tuning;
  const players = Array.from({ length: OURS }, (_, i) => i);
  const m = createMatch(t, { format: 'Gauntlet', bestOf: 1, seed: 3, arena: c.run, teams: LINEUP.map((s) => s.team), humans: OURS, players, start: c.at });
  expect(m.arena).toBe(c.arena);
  const felled = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
  const next = stepMatch(felled, felled.duel.fighters.map(() => IDLE_INTENT), t);
  expect(next.run!.phase).toBe('Cleared');
  return { m: next, t, name: `${c.run} Hall ${c.at.row + 1}.${c.at.index} (${c.arena})` };
}

/** The party scattered: Fighter i on Team 1's spawn cell (i + `turn`) % 4 (the Hall's far side), and held `delays` Ticks apart, so they reach the Door one by one. */
function scattered(m: MatchState, t: TuningData, turn: number): { m: MatchState; delays: number[] } {
  const cells = arenaOf(t, m.arena).spawns.filter((c) => c.team === 1);
  const fighters = m.duel.fighters.map((f, i) => {
    const c = cells[(i + turn) % cells.length];
    return i < OURS && c ? { ...f, position: { x: c.position.x, z: c.position.z }, y: c.position.y } : f;
  });
  return { m: { ...m, duel: { ...m.duel, fighters } }, delays: [0, 1, 2, 3].map((i) => ((i * 7 + turn * 3) % 4) * 45) };
}

/** Where each of Team 0 stands, as a list for a failure message. */
const where = (m: MatchState) => m.duel.fighters.slice(0, OURS).map((f) => `(${f.position.x.toFixed(2)}, ${f.position.z.toFixed(2)})`).join(' ');

/** Whether any two of the party overlap bodies. */
function overlapping(m: MatchState, t: TuningData): boolean {
  const fs = m.duel.fighters.slice(0, OURS);
  return fs.some((a, i) => fs.slice(i + 1).some((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 2 * t.fighter.radius - 0.05));
}

/**
 * Steps the Team 0 slots with `pilots` (the rest idle; each set off `delays[i]` Ticks late) until all of Team 0 stand in `exit`'s zone for a
 * second, or GATHER_TICKS; the Ticks taken, or null if they never did, with the last Match.
 */
function gather(m: MatchState, t: TuningData, exit: number, pilots: readonly Controller[], delays: readonly number[], limit = GATHER_TICKS): { end: MatchState; ticks: number | null } {
  const idle: Controller = { intent: () => IDLE_INTENT };
  const enemies = lineupAis(t, LINEUP, 'Gauntlet', { arena: m.config.arena });
  const arena = arenaOf(t, m.arena);
  const drive = LINEUP.map((_, i) => pilots[i] ?? enemies[i] ?? idle);
  for (let k = 0; k < limit; k++) {
    if (k % 60 === 59 && m.duel.fighters.slice(0, OURS).every((f) => inExitZone(arena, exit, f))) return { end: m, ticks: k };
    for (const p of pilots) (p as Partial<Autopilot>).watch?.(m);
    m = stepMatch(m, drive.map((c, i) => (k < (delays[i] ?? 0) ? IDLE_INTENT : c.intent(m.duel, i))), t);
  }
  return { end: m, ticks: null };
}

/** Plays every case, exit and turn with the party `pilots` make; the ones that did not all gather in the zone, or ended with bodies overlapping, as messages. */
function soak(pilots: (t: TuningData, exit: number, arena: ReturnType<typeof arenaOf>) => readonly Controller[], limit = GATHER_TICKS): { failures: string[]; played: number; slowest: number } {
  const failures: string[] = [];
  let played = 0;
  let slowest = 0;
  for (const c of CASES) {
    const { m, t, name } = cleared(c);
    const arena = arenaOf(t, m.arena);
    for (let exit = 0; exit < arena.doors.length - 1; exit++) {
      for (let turn = 0; turn < TURNS; turn++) {
        const start = scattered(m, t, turn);
        const { end, ticks } = gather(start.m, t, exit, pilots(t, exit, arena), start.delays, limit);
        played++;
        slowest = Math.max(slowest, ticks ?? limit);
        if (ticks === null) failures.push(`${name} exit ${exit} turn ${turn}: never gathered: ${where(end)}`);
        else if (overlapping(end, t)) failures.push(`${name} exit ${exit} turn ${turn}: bodies overlap: ${where(end)}`);
      }
    }
  }
  if (process.env.GATHER_TRACE) console.log(`gather: ${failures.length} of ${played} failed, slowest ${slowest} Ticks`, failures.slice(0, 8));
  return { failures, played, slowest };
}

describe('four Fighters gathering at an exit Door', { timeout: 900_000 }, () => {
  it('four dev autopilots all end up in the zone of the Door they take, not blocking each other', () => {
    const { failures, played } = soak((t, exit) => Array.from({ length: OURS }, () => createAutopilot(t, 'Hard', [exit])));
    expect(played).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  it('a Player and three Ally AIs: the Player gets in, and the Allies gather at its Door with it', () => {
    // Fighter 0 is the Player (the dev autopilot stands in); 1 to 3 are Ally AIs that go where it goes.
    const { failures } = soak((t, exit) => [createAutopilot(t, 'Hard', [exit]), ...Array.from({ length: OURS - 1 }, () => createAllyAi(t, 'Hard', 'Balanced', [0]))]);
    expect(failures).toEqual([]);
  });

  it('three Ally AIs and a Player who comes in last: the Allies leave the way in clear', () => {
    // Fighter 0 (a Player, the dev autopilot) leads the Allies 1 and 2 to the Door; Fighter 3, a Player too, holds off until all three stand in the zone.
    const { failures } = soak((t, exit, arena) => {
      const late = createAutopilot(t, 'Hard', [exit]);
      // Once it sets off it keeps on (the Allies may turn to another Door while it walks through that Door's zone).
      let go = false;
      const wait: Controller & Pick<Autopilot, 'watch'> = {
        watch: (s) => late.watch(s),
        intent: (s, i) => {
          go ||= s.fighters.slice(0, OURS - 1).every((f) => inExitZone(arena, exit, f));
          return go ? late.intent(s, i) : IDLE_INTENT;
        },
      };
      return [createAutopilot(t, 'Hard', [exit]), createAllyAi(t, 'Hard', 'Balanced', [0, 3]), createAllyAi(t, 'Hard', 'Balanced', [0, 3]), wait];
    }, LATE_TICKS);
    expect(failures).toEqual([]);
  });
});
