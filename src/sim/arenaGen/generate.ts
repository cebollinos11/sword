/**
 * Generating a judged Arena from a seed: generate a Layout, assemble it and judge it, rerolling from attempt
 * seeds derived from the seed (`seed`, `seed + ATTEMPT_STRIDE`, ...) until one passes or MAX_ATTEMPTS is
 * reached. Deterministic from the seed alone: the judge is run without a clock, so the verdict never hangs
 * on a machine's speed.
 */
import type { ArenaGeometry, TuningData } from '../../tuning';
import { assembleArena } from './assemble';
import type { Layout } from './grid';
import { judgeArena, type Judgement } from './judge';
import type { Kit } from './kit';
import { generateLayout, type GenParams } from './layout';

/** The most Layouts tried for one seed. */
export const MAX_ATTEMPTS = 20;
/** How far apart the attempt seeds of one seed are. */
const ATTEMPT_STRIDE = 0x9e3779b9;

export interface GeneratedArena {
  readonly arena: ArenaGeometry;
  readonly layout: Layout;
  /** How many Layouts were tried (1 when the first passed). */
  readonly attempts: number;
  readonly report: Judgement;
}

/** The name a Generated Arena carries: how it was made (its Doors too, if any), so the same name always builds the same Arena. */
export const generatedName = (kit: Kit, seed: number, doors = 0) => `gen:${kit.name}:${seed}${doors ? `:d${doors}` : ''}`;

/** The first Layout from `seed`'s attempt seeds whose Arena passes the judge; failing all, the one with the fewest reasons (ties: the first). */
export function generateArena(kit: Kit, seed: number, params: GenParams, tuning: TuningData): GeneratedArena {
  const doors = params.doors ?? 0;
  const name = generatedName(kit, seed, doors);
  let best: GeneratedArena | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const layout = generateLayout(kit, (seed + attempt * ATTEMPT_STRIDE) >>> 0, params);
    const arena = assembleArena(kit, layout, name);
    const report = judgeArena(arena, tuning, { minOpenFloor: params.minOpenFloor, doors });
    const tried: GeneratedArena = { arena, layout, attempts: attempt + 1, report };
    if (report.ok) return tried;
    if (!best || report.reasons.length < best.report.reasons.length) best = tried;
  }
  return { ...best!, attempts: MAX_ATTEMPTS };
}
