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
    const duel = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0] }).duel;
    const promoted = { ...duel, fighters: duel.fighters.map((f, i) => (i === 2 ? { ...f, team: 1 } : f)) };
    const drawn = drawColours(promoted, colours);
    expect(drawn.slice(0, 2)).toEqual(fighterColours([0, 0]));
    expect(drawn[2]).toBe(colours[1]);
  });
});

describe('a Delver Soldier’s full model (docs/plans/delver-troops.md)', () => {
  it('wears its Troop’s skill tint while it holds a Pool slot, and Team 1’s colour without one', async () => {
    const { floorTroops } = await import('../sim/delver');
    const { troops, plain } = floorTroops(tuning.delver);
    const duel = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0] }).duel;
    const crowd = duel.crowd!;
    const expert = plain[0]![2]!;
    const held = { ...duel, fighters: duel.fighters.map((f, i) => (i === 2 || i === 3 ? { ...f, team: 1 } : f)), crowd: { ...crowd, slot: crowd.slot.map((_, s) => (s === 0 ? 2 : -1)), troop: crowd.troop.map((t, s) => (s === 0 ? expert : t)) } };
    const drawn = drawColours(held, colours, troops);
    expect(drawn[2]).toBe(tuning.delver.skillTints.Expert);
    expect(drawn[3]).toBe(colours[1]);
    // Without the Troops (a Battle's Renderer), Team 1's colour.
    expect(drawColours(held, colours)[2]).toBe(colours[1]);
  });
});
