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
 * Optionally SOAK_FROM / SOAK_TO pick the seeds.
 */
const repo = loadTuningData();
/** The longest a Duel may run (Ticks): two minutes. */
const TICK_CAP = 120 * 60;
/** Fighters further apart than this (m, from above) are not fighting: stuck, or circling. */
const APART = 8;

interface Soak {
  readonly label: string;
  readonly ended: boolean;
  readonly ticks: number;
  readonly apart: number;
  readonly abyss: number;
  readonly deaths: string;
  readonly attempts: number;
}

/** One Duel, Hard against Hard, in the Arena `tuning.arena.editor`. */
function soak(label: string, tuning: TuningData, seed: number, attempts: number): Soak {
  const arena = tuning.arenas[tuning.arena.editor]!;
  const floor = Math.min(...arena.walk.filter((s) => !s.abyss).flatMap((s) => s.points.map((p) => p.y)));
  const controllers = [createAiController(tuning, 'Hard'), createAiController(tuning, 'Hard')];
  let m = createMatch(tuning, { bestOf: 1, seed, arena: arena.name });
  let apart = 0;
  let abyss = 0;
  const deaths: string[] = [];
  while (m.duel.duel.status === 'Fighting' && m.duel.tick < TICK_CAP) {
    m = stepMatchWith(m, controllers, tuning);
    const [a, b] = m.duel.fighters;
    if (Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z) > APART) apart++;
    for (const e of m.duel.events) {
      if (e.type !== 'Death') continue;
      // A Fall that ends below every floor is the Abyss; one that ends on a floor is a landing too hard.
      const inAbyss = e.cause === 'Fall' && m.duel.fighters[e.fighter]!.y < floor - 1;
      if (inAbyss) abyss++;
      deaths.push(`${e.fighter}:${inAbyss ? 'Abyss' : e.cause}`);
    }
  }
  return { label, ended: m.duel.duel.status === 'Over', ticks: m.duel.tick, apart, abyss, deaths: deaths.join(' '), attempts };
}

it.skipIf(!process.env.SOAK_ARENAS)('soak: Hard vs Hard on Generated Arenas', () => {
  const from = Number(process.env.SOAK_FROM ?? 1);
  const to = Number(process.env.SOAK_TO ?? 50);
  const t0 = performance.now();
  const rows: Soak[] = [soak('circle', repo, 1, 0)];
  for (let seed = from; seed <= to; seed++) {
    const { arena, attempts } = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, repo);
    rows.push(soak(String(seed), withArena(repo, arena), seed, attempts));
  }
  const seconds = (performance.now() - t0) / 1000;

  const gen = rows.slice(1);
  const sorted = gen.map((r) => r.ticks).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  /** Why a row stands out: no end, a Duel three times the median, mostly apart, or anyone into the Abyss. */
  const flags = (r: Soak) =>
    [!r.ended && 'NO END', r.ended && r.ticks > 3 * median && 'LONG', r.apart > r.ticks / 2 && 'APART', r.abyss > 0 && 'ABYSS'].filter(Boolean).join(' ');
  const out = ['| seed | attempts | ended | seconds | apart > 8 m | Abyss deaths | deaths | flags |', '|---|---|---|---|---|---|---|---|'];
  for (const r of rows)
    out.push(`| ${r.label} | ${r.attempts} | ${r.ended ? 'yes' : 'no'} | ${(r.ticks / 60).toFixed(1)} | ${((100 * r.apart) / Math.max(1, r.ticks)).toFixed(0)}% | ${r.abyss} | ${r.deaths} | ${flags(r)} |`);
  const ended = gen.filter((r) => r.ended).length;
  const flagged = gen.filter((r) => flags(r)).length;
  const apart = gen.reduce((s, r) => s + r.apart, 0) / Math.max(1, gen.reduce((s, r) => s + r.ticks, 0));
  out.push(
    '',
    `seeds ${from}-${to}: ${ended}/${gen.length} Duels ended; median ${(median / 60).toFixed(1)} s; ${(apart * 100).toFixed(0)}% of Ticks apart > ${APART} m; ` +
      `${gen.filter((r) => r.abyss > 0).length} with an Abyss death; ${flagged} flagged; ran in ${seconds.toFixed(0)} s`,
  );
  console.log(out.join('\n'));
}, 3_600_000);
