/**
 * The golden test: Easy, Normal and Hard must never change (docs/plans/ai-behaviour.md). AI vs AI Matches recorded
 * before any AI behaviour Stage, with the hash of the Match state at every Tick, must play out the same Tick for Tick.
 *
 * Re-record (only when the Simulation itself is meant to change, never for an AI change): RECORD_AI_GOLDEN=1 npx vitest run src/controllers/aiGolden.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, hashValue } from '../sim';
import { createAiController, runMatch } from './index';

const repo = loadTuningData();
const FIXTURE = fileURLToPath(new URL('aiGolden.testdata.json', import.meta.url));
const RECORD = process.env.RECORD_AI_GOLDEN === '1';
/** Each Match is played for at most this many Ticks (50 s). */
const TICKS = 3000;

/** The Matches: a 1 v 1 in the library, a 2 v 2 on a Generated Arena, a 1 v 3 in the chamber, with a mix of Weapons. */
const SETUPS = [
  { name: '1v1 library', arena: 'library', teams: [0, 1], weapons: ['Arming Sword', 'Longsword'], seed: 11 },
  { name: '2v2 generated', arena: 'gen:greybox:5', teams: [0, 0, 1, 1], weapons: ['Halberd', 'Arming Sword', 'Sledge Hammer', 'Longsword'], seed: 12 },
  { name: '1v3 chamber', arena: 'chamber', teams: [0, 1, 1, 1], weapons: ['Longsword', 'Arming Sword', 'Halberd', 'Sledge Hammer'], seed: 13 },
] as const;

/** Every Tick's Match hash, concatenated (8 hex chars a Tick). */
function play(difficulty: string, setup: (typeof SETUPS)[number]): string {
  const start = createMatch(repo, { bestOf: 3, seed: setup.seed, arena: setup.arena, teams: [...setup.teams], weapons: [...setup.weapons] });
  const ais = setup.teams.map(() => createAiController(repo, difficulty));
  return runMatch(repo, start, ais, TICKS)
    .matches.map((m) => hashValue(m))
    .join('');
}

describe('AI golden: Easy, Normal and Hard play exactly as recorded', { timeout: 300_000 }, () => {
  const recorded: Record<string, string> = RECORD ? {} : JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const cases = ['Easy', 'Normal', 'Hard'].flatMap((difficulty) => SETUPS.map((setup) => ({ key: `${difficulty} ${setup.name}`, difficulty, setup })));

  for (const { key, difficulty, setup } of cases) {
    it(`${key}: the same hash at every Tick`, () => {
      const hashes = play(difficulty, setup);
      if (RECORD) {
        recorded[key] = hashes;
        return;
      }
      const want = recorded[key];
      expect(want, `${key} was never recorded`).toBeDefined();
      // The first Tick that differs, for a readable failure.
      let tick = 0;
      while (tick * 8 < Math.max(hashes.length, want!.length) && hashes.slice(tick * 8, tick * 8 + 8) === want!.slice(tick * 8, tick * 8 + 8)) tick++;
      expect(tick * 8 >= Math.max(hashes.length, want!.length) ? 'identical' : `first differs at Tick ${tick}`).toBe('identical');
    });
  }

  if (RECORD) {
    it('writes the recording', () => {
      writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 1)}\n`);
    });
  }
});
