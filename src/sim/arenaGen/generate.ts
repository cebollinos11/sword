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
/** How many times MAX_ATTEMPTS a Hall Arena (one with Doors) may try for a Layout that passes. */
export const HALL_ATTEMPTS_FACTOR = 5;
/** The most Layouts a Hall Arena draws for one that holds every Door; no Kit and seed is known to need near this many. */
const MAX_HALL_LAYOUTS = 10_000;
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

/**
 * The first Layout from `seed`'s attempt seeds whose Arena passes the judge; failing all `maxAttempts` (tests lower it),
 * the one with the fewest reasons (ties: the first). A Hall Arena (`params.doors`) never ends short of its Doors (a Hall
 * with an exit but no Door to it could never be left): it goes on through further attempt seeds, up to
 * HALL_ATTEMPTS_FACTOR times as many, for one that passes, judging only Layouts that hold every Door; failing that, it
 * ends on the best of those, drawing more Layouts (unjudged) only until one holds every Door. Deterministic all the same.
 */
export function generateArena(kit: Kit, seed: number, params: GenParams, tuning: TuningData, maxAttempts = MAX_ATTEMPTS): GeneratedArena {
  const doors = params.doors ?? 0;
  const name = generatedName(kit, seed, doors);
  const layoutAt = (attempt: number) => generateLayout(kit, (seed + attempt * ATTEMPT_STRIDE) >>> 0, params);
  const judged = (layout: Layout, attempt: number): GeneratedArena => {
    const arena = assembleArena(kit, layout, name);
    return { arena, layout, attempts: attempt + 1, report: judgeArena(arena, tuning, { minOpenFloor: params.minOpenFloor, doors }) };
  };
  let best: GeneratedArena | null = null;
  const consider = (tried: GeneratedArena) => {
    if (!best || tried.report.reasons.length < best.report.reasons.length) best = tried;
  };
  if (!doors) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const tried = judged(layoutAt(attempt), attempt);
      if (tried.report.ok) return tried;
      consider(tried);
    }
    return { ...best!, attempts: maxAttempts };
  }
  // A Layout short of its Doors never passes (the judge counts them), so it is not judged at all.
  const holdsDoors = (layout: Layout) => layout.placements.filter((p) => p.piece === 'door').length === doors;
  let attempt = 0;
  for (; attempt < maxAttempts * HALL_ATTEMPTS_FACTOR; attempt++) {
    const layout = layoutAt(attempt);
    if (!holdsDoors(layout)) continue;
    const tried = judged(layout, attempt);
    if (tried.report.ok) return tried;
    consider(tried);
  }
  for (; !best; attempt++) {
    if (attempt >= MAX_HALL_LAYOUTS) throw new Error(`Generated Arena "${name}": no Layout holds ${doors} Doors`);
    const layout = layoutAt(attempt);
    if (holdsDoors(layout)) consider(judged(layout, attempt));
  }
  return { ...(best as GeneratedArena), attempts: attempt };
}
