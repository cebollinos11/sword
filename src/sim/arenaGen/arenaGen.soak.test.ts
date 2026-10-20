import { it } from 'vitest';
import { loadTuningData, type TuningData } from '../../tuning';
import { createAiController, stepMatchWith } from '../../controllers';
import { withArena } from '../../editor/arenaLab';
import { createMatch } from '../match';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT } from './index';

/**
 * The generator's balance report (docs/plans/generated-arenas.md, Stage 3): Hard against Hard, one Duel on each of
 * seeds 1-50, headless. Skipped in the normal suite; run
 *   SOAK_ARENAS=1 npx vitest run src/sim/arenaGen/arenaGen.soak.test.ts --silent=false
 * SOAK_FROM / SOAK_TO pick the seeds, and SOAK_DUELS fights more Duels per seed (each from its own Match seed).
 */
const repo = loadTuningData();
/** The longest a Duel may run (Ticks): two minutes. */
const TICK_CAP = 120 * 60;
/** Fighters further apart than this (m, from above) are not fighting: on their way, stuck, or circling. */
const APART = 8;
/** A Death this soon (Ticks) after a Kick Knocked it down was the Kick's doing. */
const KICKED = 180;

interface Soak {
  readonly label: string;
  readonly ended: boolean;
  readonly ticks: number;
  /** The first Tick the two came within APART (the walk to the fight), or `ticks` if never. */
  readonly contact: number;
  /** Ticks after `contact` spent more than APART apart. */
  readonly apart: number;
  readonly abyss: number;
  /** Each Death: `fighter:cause`, with `Abyss` for a Fall into it, and `Kick>` before a Death a Kick Knockdown led to. */
  readonly deaths: string;
  readonly attempts: number;
}

/** One Duel, Hard against Hard, in the Arena `tuning.arena.editor`. */
function soak(label: string, tuning: TuningData, seed: number, attempts: number): Soak {
  const arena = tuning.arenas[tuning.arena.editor]!;
  const floor = Math.min(...arena.walk.filter((s) => !s.abyss).flatMap((s) => s.points.map((p) => p.y)));
  const controllers = [createAiController(tuning, 'Hard'), createAiController(tuning, 'Hard')];
  let m = createMatch(tuning, { bestOf: 1, seed, arena: arena.name });
  let contact = -1;
  let apart = 0;
  let abyss = 0;
  const kicked = [-Infinity, -Infinity];
  const deaths: string[] = [];
  while (m.duel.duel.status === 'Fighting' && m.duel.tick < TICK_CAP) {
    m = stepMatchWith(m, controllers, tuning);
    const { tick, fighters } = m.duel;
    const [a, b] = fighters;
    const far = Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z) > APART;
    if (contact < 0 && !far) contact = tick;
    if (contact >= 0 && far) apart++;
    for (const e of m.duel.events) {
      if (e.type === 'KickLanded' && e.outcome === 'Knockdown') kicked[e.defender] = tick;
      if (e.type !== 'Death') continue;
      // A Fall that ends below every floor is the Abyss; one that ends on a floor is a landing too hard.
      const inAbyss = e.cause === 'Fall' && fighters[e.fighter]!.y < floor - 1;
      if (inAbyss) abyss++;
      deaths.push(`${e.fighter}:${tick - kicked[e.fighter]! <= KICKED ? 'Kick>' : ''}${inAbyss ? 'Abyss' : e.cause}`);
    }
  }
  const ticks = m.duel.tick;
  return { label, ended: m.duel.duel.status === 'Over', ticks, contact: contact < 0 ? ticks : contact, apart, abyss, deaths: deaths.join(' '), attempts };
}

it.skipIf(!process.env.SOAK_ARENAS)('soak: Hard vs Hard on Generated Arenas', () => {
  const from = Number(process.env.SOAK_FROM ?? 1);
  const to = Number(process.env.SOAK_TO ?? 50);
  const duels = Number(process.env.SOAK_DUELS ?? 1);
  const t0 = performance.now();
  const rows: Soak[] = [];
  for (let d = 0; d < duels; d++) rows.push(soak('circle', repo, 1 + 1000 * d, 0));
  const circle = rows.length;
  for (let seed = from; seed <= to; seed++) {
    const { arena, attempts } = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, repo);
    const tuning = withArena(repo, arena);
    for (let d = 0; d < duels; d++) rows.push(soak(String(seed), tuning, seed + 1000 * d, attempts));
  }
  const seconds = (performance.now() - t0) / 1000;

  const gen = rows.slice(circle);
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const medianTicks = median(gen.map((r) => r.ticks));
  /** Why a row stands out: no end, a Duel three times the median, a third of the fight apart, or a Death in the Abyss. */
  const flags = (r: Soak) =>
    [
      !r.ended && 'NO END',
      r.ended && r.ticks > 3 * medianTicks && 'LONG',
      r.apart > (r.ticks - r.contact) / 3 && 'APART',
      r.abyss > 0 && 'ABYSS',
    ]
      .filter(Boolean)
      .join(' ');
  const s = (ticks: number) => (ticks / 60).toFixed(1);
  const out = ['| seed | attempts | ended | seconds | to contact (s) | apart after (%) | deaths | flags |', '|---|---|---|---|---|---|---|---|'];
  for (const r of rows)
    out.push(
      `| ${r.label} | ${r.attempts} | ${r.ended ? 'yes' : 'no'} | ${s(r.ticks)} | ${s(r.contact)} | ${((100 * r.apart) / Math.max(1, r.ticks - r.contact)).toFixed(0)} | ${r.deaths} | ${flags(r)} |`,
    );
  const sum = (f: (r: Soak) => number) => gen.reduce((t, r) => t + f(r), 0);
  const kickDeaths = gen.flatMap((r) => r.deaths.split(' ')).filter((d) => d.includes('Kick>')).length;
  out.push(
    '',
    `seeds ${from}-${to} x ${duels}: ${gen.filter((r) => r.ended).length}/${gen.length} Duels ended; median ${s(medianTicks)} s (circle ${s(median(rows.slice(0, circle).map((r) => r.ticks)))} s); ` +
      `median ${s(median(gen.map((r) => r.contact)))} s to contact; ${((100 * sum((r) => r.apart)) / Math.max(1, sum((r) => r.ticks - r.contact))).toFixed(0)}% of the fight apart > ${APART} m; ` +
      `${gen.filter((r) => r.abyss > 0).length} with an Abyss death; ${kickDeaths} deaths after a Kick Knockdown; ${gen.filter((r) => flags(r)).length} flagged; ran in ${seconds.toFixed(0)} s`,
  );
  console.log(out.join('\n'));
}, 3_600_000);
