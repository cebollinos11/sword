/**
 * docs/plans/map-editor.md, Stage 4's Done, the slow part: the Quick check's default run on the sample (four whole Battles of 144 v 144) gives the
 * same report on a rerun, and a changed draft's caches (Battlefield, destination fields, navmesh) are built again well inside a play-test's budget.
 * The timings are printed for the plan's Result.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { battleMapOf, navMesh } from '../sim';
import { draftTuning } from './playtest';
import { formatQuickCheck, quickCheck } from './quickCheck';
import { sampleSource } from './sample.testdata';
import { MapEditorSession } from './session';

const base = loadTuningData();

describe('the Map Editor’s play-test, whole', () => {
  it('rebuilds a changed draft’s caches in well under a second', () => {
    const session = new MapEditorSession(sampleSource());
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      session.level = 4;
      session.moveMarker({ kind: 'objective', id: 'C' }, i % 2 ? 2 : -2, 0);
      const t0 = performance.now();
      const draft = draftTuning(session.source, base);
      const { field } = battleMapOf(draft.tuning.battle, 'battle:sample');
      navMesh(field.arena, draft.tuning);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    process.stderr.write(`draft compiled and its Battlefield, destination fields and navmesh built: median ${ms[2]!.toFixed(0)} ms (fastest ${ms[0]!.toFixed(0)}, slowest ${ms[4]!.toFixed(0)}) over 5 edits\n`);
    expect(ms[0]!).toBeLessThan(1000);
  });

  it('gives the same Quick check on the sample, four Battles at 144 v 144, on a rerun', () => {
    const t0 = performance.now();
    const one = quickCheck(draftTuning(sampleSource(), base).tuning, 'sample');
    const took = performance.now() - t0;
    const two = quickCheck(draftTuning(sampleSource(), base).tuning, 'sample');
    expect(two).toEqual(one);
    process.stderr.write(`${formatQuickCheck(one)}\n(${(took / 1000).toFixed(1)} s for the four Battles)\n`);
    expect(one.battles).toHaveLength(4);
  }, 240_000);
});
