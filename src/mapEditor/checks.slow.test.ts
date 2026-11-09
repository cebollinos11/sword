/**
 * docs/plans/map-editor.md, Stage 2: the live checks (compile, the walk check and every check but the edges' runs and the fields' clearance, which only their overlays need) run on every edit,
 * so they must stay well under 100 ms on a source the size of the City. Timed here, not in the fast suite, as a busy machine slows it.
 */
import { expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { checkMap, fieldClearance } from './checks';
import { citySizedSource } from './sample.testdata';

const tuning = loadTuningData();

/** The fastest and the median (ms) of `n` runs of `f`. */
function timed(n: number, f: () => void): { best: number; median: number } {
  const times: number[] = [];
  for (let k = 0; k < n; k++) {
    const t0 = performance.now();
    f();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { best: times[0]!, median: times[Math.floor(n / 2)]! };
}
const ms = (t: { best: number; median: number }) => `${t.best.toFixed(0)} / ${t.median.toFixed(0)} ms`;

it('checks a City-sized source in well under 100 ms', () => {
  const s = citySizedSource();
  const first = checkMap(s, tuning);
  expect(first.ok).toBe(true);
  const { walk, walls } = first.draft!.map;
  const checks = timed(9, () => checkMap(s, tuning));
  const edges = timed(5, () => checkMap(s, tuning, { edges: true }));
  const clearance = timed(3, () => fieldClearance(checkMap(s, tuning), tuning.battle));
  process.stderr.write(`City-sized source (${walk.length} Walk Surfaces, ${walls.length} Walls): checks ${ms(checks)}, with the edges ${ms(edges)}, with the fields' clearance ${ms(clearance)} (fastest / median)\n`);
  // The fastest run is the checks' own cost; the median also carries whatever else the machine is running (the slow suite runs its files side by side).
  expect(checks.best).toBeLessThan(100);
});
