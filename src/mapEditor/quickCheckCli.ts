/**
 * The Quick check from the command line (`npm run quick-check -- <map>.source.json`, tools/quick-check.mjs): a Map Source's text, its draft
 * put in the bundled Tuning Data (`draftTuning`), the Battles run (`quickCheck`) and the report printed. Pure of the DOM; it reads no file
 * itself (the script does) and no clock, so the same text, seeds and armies give the same output.
 */
import { loadTuningData } from '../tuning';
import { draftTuning } from './playtest';
import { formatQuickCheck, quickCheck, QUICK_SEEDS, type QuickCheckReport } from './quickCheck';
import { parseMapSource } from './source';

export interface QuickCheckArgs {
  readonly seeds?: readonly number[];
  /** Soldiers a side, in place of the map's standard (a smaller army runs faster). */
  readonly armySize?: number;
}

/** The Quick check of the Map Source in `text`. Throws the parser's or the compiler's error. */
export function quickCheckSource(text: string, args: QuickCheckArgs = {}): { report: QuickCheckReport; text: string } {
  const source = parseMapSource(JSON.parse(text));
  const draft = draftTuning(source, loadTuningData(), args.armySize === undefined ? {} : { armySize: args.armySize });
  const report = quickCheck(draft.tuning, draft.map, { seeds: args.seeds ?? QUICK_SEEDS });
  return { report, text: formatQuickCheck(report) };
}
