/**
 * Opt-in: writes Generated Arenas' Kit placements and assembled geometry to a JSON file, for art/render_kit.py's
 * overlay render (the Kit's art drawn with the collision over it). Run with
 *   KIT_DUMP=<file.json> npx vitest run src/render/kitPlacement.dump.test.ts
 * (KIT_SEEDS=1,12,31 picks the seeds).
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT } from '../sim';
import { loadTuningData } from '../tuning';
import { kitPlacements } from './kitPlacement';

const out = process.env.KIT_DUMP;

describe.skipIf(!out)('Kit placement dump', () => {
  it('writes the placements and geometry of each seed', () => {
    const tuning = loadTuningData();
    const seeds = (process.env.KIT_SEEDS ?? '1,12,31').split(',').map(Number);
    const arenas = seeds.map((seed) => {
      const { arena, layout } = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      return { seed, kit: layout.kit, cols: layout.cols, rows: layout.rows, placements: kitPlacements(GREYBOX_KIT, layout), arena };
    });
    writeFileSync(out!, JSON.stringify({ cell: GREYBOX_KIT.cell, arenas }));
  });
});
