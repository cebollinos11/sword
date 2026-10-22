import { describe, expect, it } from 'vitest';
import { loadTuningData, RANDOM_PICK } from '../tuning';
import { createInitialState, duelPlacements, hashValue, type SimState } from '../sim';
import { createAiController } from './ai';
import { runControllers, scriptedController, type Controller } from './controller';
import { checkLineup, lineupAis, lineupStyle, type Lineup } from './lineup';

const tuning = loadTuningData();
const vsAi = (style?: string): Lineup => [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'AI', difficulty: 'Skilled', ...(style === undefined ? {} : { style }) } },
];

describe('Lineup: AI Styles', () => {
  it('accepts a Style of ai.styles, "random" or none, and refuses an unknown one', () => {
    for (const style of [undefined, 'Counter', RANDOM_PICK]) expect(() => checkLineup(tuning, vsAi(style), 1), String(style)).not.toThrow();
    expect(() => checkLineup(tuning, vsAi('Sneaky'), 1)).toThrow(/Unknown AI Style "Sneaky"/);
  });

  it('a random Style is a pure pick from the Match seed and the Fighter: the same on every peer, varying from Match to Match', () => {
    const styles = Object.keys(tuning.ai.styles);
    expect(lineupStyle(tuning, RANDOM_PICK, 9, 1)).toBe(lineupStyle(tuning, RANDOM_PICK, 9, 1));
    const picks = Array.from({ length: 24 }, (_, seed) => lineupStyle(tuning, RANDOM_PICK, seed, 1));
    for (const p of picks) expect(styles).toContain(p);
    expect(new Set(picks).size).toBeGreaterThan(2);
    expect(lineupStyle(tuning, undefined, 9, 1)).toBe('Balanced');
    expect(lineupStyle(tuning, 'Tricky', 9, 1)).toBe('Tricky');
  });

  it("lineupAis builds each AI with its Style, a random one picked from the Match's seed", () => {
    const run = runControllers(tuning, createInitialState(tuning, 3, duelPlacements(3)), [scriptedController([]), createAiController(tuning, 'Skilled')], 400);
    const intents = (ai: Controller) => run.states.map((s: SimState) => hashValue(ai.intent(s, 1)));
    const seed = 77;
    const picked = lineupStyle(tuning, RANDOM_PICK, seed, 1);
    expect(intents(lineupAis(tuning, vsAi(RANDOM_PICK), 'Duels', { seed })[1]!)).toEqual(intents(createAiController(tuning, 'Skilled', picked)));
    expect(intents(lineupAis(tuning, vsAi('Aggressive'))[1]!)).toEqual(intents(createAiController(tuning, 'Skilled', 'Aggressive')));
    expect(intents(lineupAis(tuning, vsAi())[1]!)).toEqual(intents(createAiController(tuning, 'Skilled')));
  });
});
