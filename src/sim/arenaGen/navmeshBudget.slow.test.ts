/**
 * ADR 0014's navmesh budget for generated Arenas: timings, so in the slow tier (`npm run test:slow`), where a busy full fast run
 * cannot push a median over the line.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../../tuning';
import { DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, judgeArena } from './index';

const tuning = loadTuningData();

describe("generated Arenas stay within ADR 0014's navmesh budget", () => {
  it('builds their navmesh in under 250 ms (seeds 1-20, timed by the judge on a fresh copy; logged)', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { arena } = generateArena(GREYBOX_KIT, seed, DEFAULT_GEN_PARAMS, tuning);
      const copy = parseArena(JSON.parse(JSON.stringify(arena)), arena.name);
      times.push(judgeArena(copy, tuning, { now: () => performance.now() }).stats.buildMs!);
    }
    times.sort((a, b) => a - b);
    console.log(`generated Arenas 1-20: navmesh builds in ${times[10]!.toFixed(0)} ms (median), ${times[19]!.toFixed(0)} ms at most`);
    // Test files run side by side, so a single build can be slowed: the median holds the line, the slowest only a gross one.
    expect(times[10]).toBeLessThan(250);
    expect(times[19]).toBeLessThan(1000);
  }, 60_000);

  it('build their navmesh in under 250 ms for Hall Arenas (seeds 1-20, :d1 to :d4 in turn, timed by the judge on a fresh copy; logged)', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { arena } = generateArena(GREYBOX_KIT, seed, { ...DEFAULT_GEN_PARAMS, doors: 1 + (seed % 4) }, tuning);
      const copy = parseArena(JSON.parse(JSON.stringify(arena)), arena.name);
      times.push(judgeArena(copy, tuning, { now: () => performance.now(), doors: copy.doors.length }).stats.buildMs!);
    }
    times.sort((a, b) => a - b);
    console.log(`Hall Arenas 1-20: navmesh builds in ${times[10]!.toFixed(0)} ms (median), ${times[19]!.toFixed(0)} ms at most`);
    // As for Random Maps: test files run side by side, so the median holds the line, the slowest only a gross one.
    expect(times[10]).toBeLessThan(250);
    expect(times[19]).toBeLessThan(1000);
  }, 60_000);
});
