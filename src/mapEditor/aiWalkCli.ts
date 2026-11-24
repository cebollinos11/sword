/**
 * The AI check of generated Delver Floors from the command line (`npm run ai-walk`, tools/ai-walk/ai-walk.mjs): for each (seed, Floor), the
 * Floor as a Run deals it (`delverFloor`), its navmesh probed (`navProbe.ts`) and one AI walked to every Hall centre and marker
 * (`navWalk.ts`). It prints one line a Floor and, for a Floor with a problem, each problem and the Map Editor link that opens the Floor and
 * walks it again (`?aiwalk=1`), to look at the traces. Pure of the DOM and of clocks: the same arguments print the same report.
 */
import { loadTuningData } from '../tuning';
import { delverFloor } from '../sim/delver';
import { checkMap } from './checks';
import { floorTargets, navIssues, probeRoutes, type NavIssue } from './navProbe';
import { walkAll, walkIssues, type AiWalkOptions } from './navWalk';

export interface AiWalkArgs extends AiWalkOptions {
  readonly seeds: readonly number[];
  readonly floors: readonly number[];
  /** Print every Floor's issues, notes included (default: errors and warnings only). */
  readonly notes?: boolean;
}

export interface FloorAiReport {
  readonly seed: number;
  readonly floor: number;
  readonly legs: number;
  /** Legs by how they ended. */
  readonly outcomes: Readonly<Record<string, number>>;
  readonly issues: readonly NavIssue[];
  /** The longest leg's time over its route's walking time. */
  readonly worstRatio: number;
  readonly link: string;
}

/** The Map Editor link (on `npm run dev`) that opens Floor `floor` of `seed` and walks the AI over it. */
export const editorLink = (seed: number, floor: number): string => `http://localhost:5173/sword/#/mapeditor?dev=1&delverSeed=${seed}&delverFloor=${floor}&aiwalk=1`;

/** The AI check of each Floor asked for, and the report's text. */
export function aiWalkFloors(args: AiWalkArgs): { reports: FloorAiReport[]; text: string; problems: number } {
  const tuning = loadTuningData();
  // The walk check's reach (the Soldiers'), at the Floor's flow cell, so the probe says where the navmesh and the Soldiers part.
  const checkTuning = { ...tuning, battle: { ...tuning.battle, crowd: { ...tuning.battle.crowd, flowCell: tuning.delver.flowCell } } };
  const last = tuning.delver.tiers * tuning.delver.floorsPerTier;
  const lines: string[] = [];
  const reports: FloorAiReport[] = [];
  const totals: Record<string, number> = {};
  let problems = 0;
  for (const seed of args.seeds)
    for (const floor of args.floors) {
      if (floor < 1 || floor > last) continue;
      const f = delverFloor(tuning, seed >>> 0, floor);
      const { start, targets } = floorTargets(f.plan);
      const arena = f.field.arena;
      const probe = probeRoutes(arena, tuning, start, targets);
      const legs = walkAll(tuning, arena, start, targets, args);
      const issues = [...navIssues(arena, tuning, probe, checkMap(f.source, checkTuning).reach), ...walkIssues(legs)];
      const outcomes: Record<string, number> = {};
      for (const l of legs) {
        outcomes[l.outcome] = (outcomes[l.outcome] ?? 0) + 1;
        totals[l.outcome] = (totals[l.outcome] ?? 0) + 1;
      }
      const timed = legs.filter((l) => l.outcome === 'arrived' && l.expected >= 3);
      const worstRatio = timed.reduce((m, l) => Math.max(m, l.seconds / l.expected), 0);
      const report = { seed, floor, legs: legs.length, outcomes, issues, worstRatio, link: editorLink(seed, floor) };
      reports.push(report);
      const shown = issues.filter((i) => args.notes || i.severity !== 'note');
      const bad = issues.filter((i) => i.severity !== 'note').length;
      if (bad) problems++;
      const counts = Object.entries(outcomes)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      lines.push(`${bad ? '✗' : '✓'} seed ${seed} Floor ${floor}: ${legs.length} legs (${counts}), slowest ${worstRatio.toFixed(2)}× its route${bad ? `, ${bad} problems` : ''}`);
      for (const i of shown) lines.push(`    ${i.severity === 'error' ? '✗' : i.severity === 'warning' ? '!' : '·'} ${i.message}`);
      if (shown.length) lines.push(`    ${report.link}`);
    }
  const sum = Object.entries(totals)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
  lines.push('', `${reports.length} Floors, ${problems} with problems; legs: ${sum || 'none'}.`);
  return { reports, text: lines.join('\n'), problems };
}
