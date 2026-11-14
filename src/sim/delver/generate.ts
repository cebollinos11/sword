/**
 * Generating a judged Floor from (Run seed, Floor) (docs/plans/delver.md, Stage 1): plan a layout, build it and judge it, rerolling
 * from a salted attempt seed (`attemptSeed`) until one passes or `maxAttempts` is reached, as the Arena generator does
 * (`arenaGen/generate.ts`). Deterministic from (seed, Floor) alone: there is no clock, so every peer deals the same Floor.
 */
import type { DelverFloorTuning } from '../../tuning/delver';
import type { TuningData } from '../../tuning';
import type { BuiltFloor } from './build';
import { judgeAttempt, type FloorJudgement } from './judge';
import { planFloor } from './plan';
import { isBossFloor } from './troops';

/** A judged Floor: how many layouts were tried (1 when the first passed) and the verdict on the one returned. */
export interface DelverFloor extends BuiltFloor {
  readonly attempts: number;
  readonly judgement: FloorJudgement;
}

/**
 * The first layout of Floor `floor` of `seed` that builds and passes the judge. Failing all `maxAttempts` (default
 * `delver.floor.maxAttempts`), the built one (rule 1 passed, the source compiled) with the fewest reasons (ties: the first) comes back with `judgement.ok` false and
 * `attempts` = `maxAttempts`. Throws, naming the seed, the Floor and the last reason, if none even built. `opts.judge` stands
 * in for rules 3 to 7 (a test's refusals); a plan rule 1 refuses, or a source that does not compile, is refused all the same.
 */
export function delverFloor(
  tuning: Pick<TuningData, 'battle' | 'delver'>,
  seed: number,
  floor: number,
  opts: { maxAttempts?: number; judge?: (t: DelverFloorTuning, b: BuiltFloor) => string[] } = {},
): DelverFloor {
  const t = tuning.delver.floor;
  const maxAttempts = opts.maxAttempts ?? t.maxAttempts;
  const boss = isBossFloor(tuning.delver, floor);
  let best: { built: BuiltFloor; reasons: string[] } | null = null;
  let last = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const plan = planFloor(t, seed, floor, attempt, boss);
    const { reasons, built } = judgeAttempt(tuning, plan, opts.judge);
    if (!built) {
      last = reasons[reasons.length - 1]!;
      continue;
    }
    if (reasons.length === 0) return { ...built, attempts: attempt + 1, judgement: { ok: true, reasons } };
    if (!best || reasons.length < best.reasons.length) best = { built, reasons };
  }
  if (!best) throw new Error(`No Floor ${floor} of seed ${seed >>> 0} built in ${maxAttempts} attempts: ${last}`);
  return { ...best.built, attempts: maxAttempts, judgement: { ok: false, reasons: best.reasons } };
}

/** One line on a Floor: its layout counts and the verdict. */
export function describeFloor(f: DelverFloor): string {
  const { plan } = f;
  const halls = plan.halls;
  const named = (kind: string) => halls.flatMap((h) => (h.kind === kind ? [h.id] : [])).join(', ');
  const count = (kind: string) => halls.filter((h) => h.kind === kind).length;
  const kinds = [
    `Entrance ${halls[plan.entrance]!.id}`,
    `${halls[plan.stairs]!.kind === 'Boss' ? 'Boss' : 'Stairs'} ${halls[plan.stairs]!.id}`,
    ...(count('Rest') > 0 ? [`Rest ${named('Rest')}`] : []),
    ...(count('Treasure') > 0 ? [`Treasure ${named('Treasure')}`] : []),
    `${count('Fight')} Fight`,
    `${count('Empty')} Empty`,
  ];
  const loops = plan.passages.filter((p) => p.loop).length;
  const levels = halls.map((h) => h.level);
  const galleries = halls.flatMap((h) => (h.gallery ? [h.gallery] : []));
  const stairwells = galleries.filter((g) => g.high).length;
  const sloped = plan.passages.filter((p) => p.ya !== p.yb).length;
  const shapes = { L: plan.passages.filter((p) => p.shape === 'L').length, S: plan.passages.filter((p) => p.shape === 'S').length, Z: plan.passages.filter((p) => p.shape === 'Z').length };
  const vertical = `levels ${Math.min(...levels)} to ${Math.max(...levels)} (${new Set(levels).size} Hall levels), ${galleries.length} galleries (${galleries.length - stairwells} balconies, ${stairwells} stairwells), ${sloped} sloped Passages, ${halls.filter((h) => h.great).length} great halls, ${shapes.L} L, ${shapes.S} S and ${shapes.Z} Z Passages`;
  const verdict = f.judgement.ok ? 'passes the judge' : `fails: ${f.judgement.reasons.join('; ')}`;
  return `Floor ${plan.floor} of seed ${plan.seed >>> 0}, attempt ${plan.attempt + 1}: ${halls.length} Halls (${kinds.join(', ')}), ${plan.passages.length} Passages (${loops} loops), ${plan.markers.patrols.length} patrols, ${vertical}; ${verdict}`;
}
