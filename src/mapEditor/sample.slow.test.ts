/**
 * docs/plans/map-editor.md, Stage 0's Done: the sample Map Source (a keep, two ramps, a bridge over a lava pit, five Objectives), compiled,
 * holds a whole AI-v-AI Battle to its end (the slow tier, `npm run test:slow`).
 */
import { expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, stepMatch } from '../sim';
import { compileMap } from './compile';
import { sampleSource } from './sample.testdata';

const base = loadTuningData();

it('plays a whole AI Battle on the compiled sample to its end', () => {
  const { map } = compileMap(sampleSource(), base.battle);
  const tuning: TuningData = { ...base, battle: { ...base.battle, maps: { ...base.battle.maps, [map.name]: map }, armySize: map.armySize.standard } };
  const t0 = performance.now();
  let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: `battle:${map.name}` });
  while (m.status.status === 'InProgress' && m.tick < 90_000) m = stepMatch(m, [], tuning);
  const c = m.duel.crowd!;
  process.stderr.write(`sample: ${m.status.status} after ${(m.tick / 60).toFixed(0)} s of Battle (${((performance.now() - t0) / 1000).toFixed(0)} s to run), Tickets ${c.tickets.map((x) => x.toFixed(0)).join(' / ')}\n`);
  expect(m.status.status).toBe('Over');
}, 900_000);
