/**
 * Generating a judged Floor from (Run seed, Floor) (docs/plans/delver.md, Stage 1): plan a layout, build it and judge it, rerolling
 * from a salted attempt seed (`attemptSeed`) until one passes or `maxAttempts` is reached, as the Arena generator does
 * (`arenaGen/generate.ts`). Deterministic from (seed, Floor) alone: there is no clock, so every peer deals the same Floor.
 */
import type { DelverFloorTuning } from '../../tuning/delver';
import type { TuningData } from '../../tuning';
import type { BuiltFloor } from './build';
import { judgeAttempt, type FloorJudgement } from './judge';
import { galleryFloorTuning, galleryReasons, planFloor, setPieceOf, type FloorPlan, type HallShape } from './plan';
import { floorTuningOf, isBossFloor, tierOf } from './troops';

/** A judged Floor: how many layouts were tried (1 when the first passed) and the verdict on the one returned. */
export interface DelverFloor extends BuiltFloor {
  readonly attempts: number;
  readonly judgement: FloorJudgement;
}

/**
 * The first layout of Floor `floor` of `seed` that builds and passes the judge. Failing all `maxAttempts` (default
 * `delver.floor.maxAttempts`), the built one (rule 1 passed, the source compiled) with the fewest reasons (ties: the first) comes back with `judgement.ok` false and
 * `attempts` = `maxAttempts`. Throws, naming the seed, the Floor and the last reason, if none even built. `opts.judge` stands
 * in for rules 3 to 7 (a test's refusals); a plan rule 1 refuses, or a source that does not compile, is refused all the same. `opts.gallery` (dev only)
 * deals the Set Piece Gallery's Floor instead (`galleryFloorTuning`, never a Boss Floor), refusing a layout where a set piece did not fit.
 */
export function delverFloor(
  tuning: Pick<TuningData, 'battle' | 'delver'>,
  seed: number,
  floor: number,
  opts: { maxAttempts?: number; judge?: (t: DelverFloorTuning, b: BuiltFloor) => string[]; gallery?: boolean } = {},
): DelverFloor {
  if (opts.gallery) tuning = galleryTuning(tuning);
  const t = floorTuningOf(tuning.delver, floor);
  const maxAttempts = opts.maxAttempts ?? t.maxAttempts;
  const boss = !opts.gallery && isBossFloor(tuning.delver, floor);
  let best: { built: BuiltFloor; reasons: string[] } | null = null;
  let last = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const plan = planFloor(t, seed, floor, attempt, boss, tierOf(tuning.delver, floor));
    const judged = judgeAttempt(tuning, plan, opts.judge);
    const built = judged.built;
    const reasons = built ? [...judged.reasons, ...galleryReasons(t, plan)] : judged.reasons;
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

const galleries = new WeakMap<object, Pick<TuningData, 'battle' | 'delver'>>();

/** `tuning` with the Set Piece Gallery's Floor Tuning for every Floor (`floorTuningOf` gives it): what a gallery Floor is planned and judged under. The same object for the same `tuning`. */
function galleryTuning(tuning: Pick<TuningData, 'battle' | 'delver'>): Pick<TuningData, 'battle' | 'delver'> {
  let g = galleries.get(tuning);
  if (!g) {
    const { tierRooms: _, ...delver } = tuning.delver;
    galleries.set(tuning, (g = { ...tuning, delver: { ...delver, floor: galleryFloorTuning(tuning.delver.floor) } }));
  }
  return g;
}

/**
 * The Map Editor's list of a Floor's set pieces (docs/plans/delver.md, Stage 7f), one line each in Hall order: the Hall, its kind and what it is (an
 * Uphill's rise and high end, a Spiral's base wall, turn and well level, a Lava Bridge's arms, a drawn room's name, frame, level and shift (Stage 7g)); 'none' for a Floor with none.
 */
export function setPieceLines(plan: FloorPlan): string[] {
  const out = plan.halls.flatMap((h) => {
    const sp = setPieceOf(h);
    if (!sp) return [];
    const f = h.feature;
    const what =
      f?.kind === 'uphill' ? `Uphill, ${f.rise} level${f.rise === 1 ? '' : 's'} up to its ${f.up} end`
      : f?.kind === 'spiral' ? `Spiral, base ${f.base}, ${f.turn === 0 ? 'counter-clockwise' : 'clockwise'}, well on level ${h.level}`
      : f?.kind === 'room' ? `drawn room ${f.name}, frame ${f.frame}, on level ${h.level}${f.shift[0] || f.shift[1] ? `, shifted (${f.shift.join(', ')})` : ''}`
      : `Lava Bridge, ${h.lava!.bridges.length} arm${h.lava!.bridges.length === 1 ? '' : 's'} (${h.lava!.walls.join(' ')})${h.great ? ', great hall' : ''}`;
    return [`${h.id} (${h.kind}): ${what}`];
  });
  return out.length > 0 ? out : ['none'];
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
  const feats = halls.flatMap((h) => (h.feature ? [h.feature] : []));
  const splits = feats.flatMap((f) => (f.kind === 'split' ? [f] : []));
  const pits = feats.flatMap((f) => (f.kind === 'pit' ? [f] : []));
  const daises = halls.filter((h) => h.feature?.kind === 'dais');
  const wraps = galleries.flatMap((g) => (g.wrap ? [g.wrap] : []));
  const sloped = plan.passages.filter((p) => p.ya !== p.yb).length;
  const shapes = { L: plan.passages.filter((p) => p.shape === 'L').length, S: plan.passages.filter((p) => p.shape === 'S').length, Z: plan.passages.filter((p) => p.shape === 'Z').length };
  const shaped = (s: HallShape) => halls.filter((h) => h.shape === s).length;
  const pillared = halls.filter((h) => h.pillars.length > 0);
  const lavas = halls.flatMap((h) => (h.lava ? [h.lava] : []));
  const rivers = lavas.filter((l) => l.kind === 'river');
  const pieces = halls.flatMap((h) => (setPieceOf(h) ? [setPieceOf(h)!] : []));
  const vertical = `levels ${Math.min(...levels)} to ${Math.max(...levels)} (${new Set(levels).size} Hall levels), ${galleries.length} galleries (${galleries.length - stairwells} balconies, ${stairwells} stairwells), ${sloped} sloped Passages, ${halls.filter((h) => h.great).length} great halls, ${shapes.L} L, ${shapes.S} S and ${shapes.Z} Z Passages, ${halls.filter((h) => h.shape !== 'rect').length} shaped Halls (${shaped('L')} L, ${shaped('T')} T, ${shaped('cross')} cross, ${shaped('ring')} ring), ${halls.reduce((n, h) => n + h.pillars.length, 0)} pillars in ${pillared.length} Halls (${pillared.filter((h) => h.layout === 'colonnade').length} colonnades, ${pillared.filter((h) => h.layout === 'grid').length} grids), ${splits.length} split Halls (${splits.filter((f) => f.tiers.length === 2).length} two-tier, ${splits.filter((f) => f.tiers.length === 3).length} three-tier), ${pits.length} pits (${pits.filter((f) => f.depth === 2).length} 2 m, ${pits.filter((f) => f.depth === 4).length} 4 m), ${daises.length} daises (${daises.filter((h) => h.kind === 'Boss').length} thrones, ${daises.filter((h) => h.kind === 'Treasure').length} altars), ${wraps.length} wrapped galleries (${wraps.filter((w) => w.walls.length === 1).length} L, ${wraps.filter((w) => w.walls.length === 2).length} U), ${lavas.filter((l) => l.kind !== 'cross' && l.kind !== 'room').length} lava Halls (${lavas.filter((l) => l.kind === 'pit').length} pits, ${rivers.length} rivers with ${rivers.reduce((n, l) => n + l.bridges.length, 0)} bridges, ${lavas.filter((l) => l.kind === 'trough').length} trough Halls), ${pieces.length} set pieces (${pieces.filter((k) => k === 'cross').length} crosses, ${pieces.filter((k) => k === 'uphill').length} uphills, ${pieces.filter((k) => k === 'spiral').length} spirals, ${pieces.filter((k) => k === 'room').length} drawn rooms)`;
  const verdict = f.judgement.ok ? 'passes the judge' : `fails: ${f.judgement.reasons.join('; ')}`;
  return `Floor ${plan.floor} of seed ${plan.seed >>> 0}, attempt ${plan.attempt + 1}: ${halls.length} Halls (${kinds.join(', ')}), ${plan.passages.length} Passages (${loops} loops), ${plan.markers.patrols.length} patrols, ${vertical}; ${verdict}`;
}
