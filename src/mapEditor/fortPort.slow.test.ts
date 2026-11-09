/**
 * docs/plans/map-editor.md, Stage 6's Done, the slow part: whole AI Battles on the Fort ported into a Map Source land within the Fort's
 * measured length (docs/plans/battle-objectives.md, Stage 4b: 96 Battles at 144 v 144, 331 to 532 s), and the Quick check gives the same
 * report on the port as on the shipped Fort, seed by seed. The reports are printed for the plan's Result.
 */
import { describe, expect, it } from 'vitest';
import { applyBattleKnobs, loadTuningData } from '../tuning';
import { fortPortSource } from './fortPort.testdata';
import { draftTuning } from './playtest';
import { formatQuickCheck, quickCheck } from './quickCheck';

const base = loadTuningData();
/**
 * The Fort's measured Battle length at 144 v 144 (s): the shortest and longest of Stage 4b's soak. The soak came before the 2026-11-06 retune
 * (idle garrisons), which shortened Battles a little: the shipped Fort's seed 3 now ends at 330 s, so the floor is let down 5 s.
 */
const FORT_LENGTH = [331, 532] as const;

describe('the ported Fort, whole Battles', () => {
  it('lands within the Fort’s measured length, and plays the shipped Fort’s Battles', () => {
    const t0 = performance.now();
    const port = quickCheck(draftTuning(fortPortSource(), base).tuning, 'fortport');
    const took = performance.now() - t0;
    const fort = quickCheck({ ...base, battle: applyBattleKnobs(base.battle, { map: 'fort' }) }, 'fort');
    process.stderr.write(`${formatQuickCheck(port)}\n(${(took / 1000).toFixed(1)} s for the four Battles)\n${formatQuickCheck(fort)}\n`);
    for (const b of port.battles) {
      expect(b.endedBy).toBe('tickets');
      expect(b.seconds).toBeGreaterThanOrEqual(FORT_LENGTH[0] - 5);
      expect(b.seconds).toBeLessThanOrEqual(FORT_LENGTH[1]);
    }
    // Seed by seed, the same Battle: its length, winner, captures, Ticket curve and stall (only the map's name differs).
    expect({ ...port, map: 'fort' }).toEqual(fort);
  }, 300_000);
});
