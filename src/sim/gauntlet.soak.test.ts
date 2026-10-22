import { it } from 'vitest';
import { loadTuningData } from '../tuning';
import { lineupAis, stepMatchWith, type Controller, type Lineup } from '../controllers';
import { inDuel } from './duel';
import { createMatch, type MatchState } from './match';

/**
 * The Gauntlet's soak (docs/plans/gauntlet.md, Stage 1): three Hard AI allies against the Floors, one Run on each of
 * seeds 1-50 (`gen:greybox:<seed>`), headless. Skipped in the normal suite; run
 *   SOAK_GAUNTLET=1 npx vitest run src/sim/gauntlet.soak.test.ts --silent=false
 * SOAK_FROM / SOAK_TO pick the seeds.
 */
const tuning = loadTuningData();
/** The longest a Floor may run (Ticks): three minutes. One that runs longer hangs, and its Run is stopped there. */
const FLOOR_CAP = 180 * 60;
/** Fighters of the two Teams further apart than this (m, from above) are not fighting yet. */
const NEAR = 8;

/** Three Hard allies on Team 0, the three Floor AI slots on Team 1 (their pilots are ignored: the Floors decide). */
const LINEUP: Lineup = [0, 0, 0, 1, 1, 1].map((team) => ({ team, pilot: { kind: 'AI', difficulty: 'Hard' } }));

interface Floor {
  readonly ticks: number;
  /** Ticks until a Team 0 and a Team 1 Fighter first came within NEAR, or `ticks` if never. */
  readonly contact: number;
  readonly winner: number | null | 'hang';
  /** Team 0's HP when the Floor ended (fallen: 0). */
  readonly hp: readonly number[];
}

interface Run {
  readonly seed: number;
  readonly ended: boolean;
  readonly won: boolean;
  readonly cleared: number;
  readonly floors: readonly Floor[];
  readonly ticks: number;
}

function soak(seed: number): Run {
  const controllers = lineupAis(tuning, LINEUP, 'Gauntlet') as Controller[];
  let m: MatchState = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed, arena: `gen:greybox:${seed}`, teams: LINEUP.map((s) => s.team) });
  const floors: Floor[] = [];
  let contact = -1;
  for (;;) {
    m = stepMatchWith(m, controllers, tuning);
    const { duel } = m;
    if (contact < 0 && duel.duel.status === 'Fighting') {
      const own = duel.fighters.filter((f) => f.team === 0 && inDuel(f));
      const them = duel.fighters.filter((f) => f.team === 1 && inDuel(f));
      if (own.some((a) => them.some((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= NEAR))) contact = duel.tick;
    }
    const ended = duel.events.some((e) => e.type === 'DuelEnd');
    const hang = duel.duel.status === 'Fighting' && duel.tick >= FLOOR_CAP;
    if (ended || hang) {
      const winner = hang ? 'hang' : duel.duel.status === 'Over' ? duel.duel.winner : null;
      floors.push({ ticks: duel.tick, contact: contact < 0 ? duel.tick : contact, winner, hp: duel.fighters.filter((f) => f.team === 0).map((f) => (inDuel(f) ? f.hp : 0)) });
      contact = -1;
    }
    if (hang || m.status.status === 'Over') break;
  }
  const { status } = m;
  return { seed, ended: status.status === 'Over', won: status.status === 'Over' && status.winner === 0, cleared: m.run!.cleared, floors, ticks: m.tick };
}

it.skipIf(!process.env.SOAK_GAUNTLET)('soak: three Hard allies against the Gauntlet', () => {
  const from = Number(process.env.SOAK_FROM ?? 1);
  const to = Number(process.env.SOAK_TO ?? 50);
  const t0 = performance.now();
  const runs: Run[] = [];
  for (let seed = from; seed <= to; seed++) runs.push(soak(seed));
  const seconds = (performance.now() - t0) / 1000;

  const s = (ticks: number) => (ticks / 60).toFixed(1);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const out = ['| seed | ended | result | cleared | Run (s) | Floors (s, contact s, team HP at the end) |', '|---|---|---|---|---|---|'];
  for (const r of runs)
    out.push(
      `| ${r.seed} | ${r.ended ? 'yes' : 'no'} | ${r.won ? 'Victory' : 'Defeat'} | ${r.cleared} | ${s(r.ticks)} | ${r.floors
        .map((f, k) => `${k + 1}: ${s(f.ticks)} (${s(f.contact)}) [${f.hp.map((h) => Math.round(h)).join('/')}]${f.winner === 'hang' ? ' HANG' : f.winner === null ? ' DRAW' : ''}`)
        .join('; ')} |`,
    );
  const total = tuning.gauntlet.floors.length;
  const reached = Array.from({ length: total }, (_, k) => runs.filter((r) => r.floors.length > k).length);
  const floorTicks = Array.from({ length: total }, (_, k) => runs.flatMap((r) => (r.floors[k] ? [r.floors[k]!.ticks] : [])));
  const contacts = runs.flatMap((r) => r.floors.map((f) => f.contact));
  const lost = Array.from({ length: total }, (_, k) => runs.filter((r) => r.floors.length === k + 1 && !r.won).length);
  out.push(
    '',
    `seeds ${from}-${to}: ${runs.filter((r) => r.ended).length}/${runs.length} Runs ended; ${runs.filter((r) => r.won).length} won; ` +
      `median ${median(runs.map((r) => r.cleared))} Floors cleared; median Run ${s(median(runs.map((r) => r.ticks)))} s; ` +
      `${runs.flatMap((r) => r.floors).filter((f) => f.winner === 'hang').length} Floors hung; ${runs.flatMap((r) => r.floors).filter((f) => f.winner === null).length} drawn; ` +
      `median ${s(median(contacts))} s to contact, longest ${s(Math.max(...contacts))} s; ran in ${seconds.toFixed(0)} s`,
    `reached Floor k: ${reached.join(' / ')}; lost on Floor k: ${lost.join(' / ')}`,
    `median Floor length (s): ${floorTicks.map((t) => s(median(t))).join(' / ')}; longest: ${floorTicks.map((t) => (t.length ? s(Math.max(...t)) : '-')).join(' / ')}`,
  );
  console.log(out.join('\n'));
}, 7_200_000);
