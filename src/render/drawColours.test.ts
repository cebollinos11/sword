import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch } from '../sim';
import { drawColours } from './renderer';
import { fighterColours } from './fighterView';

const tuning = loadTuningData();
const colours = tuning.battle.soldier.colours;

describe('the colours a Renderer dresses the Fighters in', () => {
  it('a Duel has the Duel’s colours', () => {
    const duel = createMatch(tuning, { bestOf: 1 }).duel;
    expect(drawColours(duel, colours)).toEqual(fighterColours(duel.fighters.map((f) => f.team)));
  });

  it('a Battle has each Team’s soldier colour', () => {
    const duel = createMatch(tuning, { format: 'Battle', bestOf: 1, teams: [0] }).duel;
    expect(drawColours(duel, colours).every((c, i) => c === colours[duel.fighters[i]!.team])).toBe(true);
  });

  it('a Delver Run keeps its party in the Duel’s colours and dresses a promoted Soldier in Team 1’s', () => {
    const duel = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, teams: [0, 0] }).duel;
    const promoted = { ...duel, fighters: duel.fighters.map((f, i) => (i === 2 ? { ...f, team: 1 } : f)) };
    const drawn = drawColours(promoted, colours);
    expect(drawn.slice(0, 2)).toEqual(fighterColours([0, 0]));
    expect(drawn[2]).toBe(colours[1]);
  });
});
