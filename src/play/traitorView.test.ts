/** What a Delver traitor sees (docs/plans/delver.md, Stage 8a): the whole Floor with no fog, its own arrow, and when it takes over next. */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, TICK_SECONDS, type MatchState } from '../sim';
import { flatFloors } from '../sim/delver/flat.testdata';
import { floorOf } from '../sim/delver';
import { fullReveal, isRevealed, revealBits } from '../sim/delver/reveal';
import { delverMapLayout, delverMapStatus, viewReveal } from './floorMap';
import { traitorLine, traitorWatchLine } from './hud';

const base = flatFloors(loadTuningData());
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 2, tierRooms: [7] } };
const m: MatchState = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', teams: [0, 0], humans: 2, players: [0, 1], traitors: [{}] });
const plan = floorOf(tuning, m.arena)!.plan;

describe("a Delver traitor's view", () => {
  it('reveals every Hall and Passage, and nothing past them', () => {
    const all = fullReveal(plan);
    for (let b = 0; b < revealBits(plan); b++) expect(isRevealed(all, b), `bit ${b}`).toBe(true);
    expect(isRevealed(all, revealBits(plan))).toBe(false);
    expect(fullReveal({ halls: new Array(32), passages: [] })).toEqual([0xffff_ffff]);
  });

  it('shows the traitor the whole Floor and the party only what it has revealed', () => {
    expect(viewReveal(m, plan, 2)).toEqual(fullReveal(plan));
    expect(viewReveal(m, plan, 0)).toBe(m.delver!.revealed);
  });

  it("draws the traitor's own arrow on its Floor Map once it plays a Soldier, and the party's", () => {
    const fighters = m.duel.fighters.map((f, i) => (i === 2 ? { ...f, benched: undefined, hp: 50 } : f));
    const layout = delverMapLayout(plan, fullReveal(plan), fighters, 2, delverMapStatus(m, plan));
    expect(layout.arrows.map((a) => [a.fighter, a.me])).toEqual([[0, false], [1, false], [2, true]]);
    // The party sees no arrow for it.
    expect(delverMapLayout(plan, fullReveal(plan), fighters, 0, delverMapStatus(m, plan)).arrows.map((a) => a.fighter)).toEqual([0, 1]);
  });

  it('tells a watching traitor when it takes over, and nobody else anything', () => {
    const next = m.delver!.traitors![0]!.next;
    expect(traitorWatchLine(m, 2)).toBe(`Taking over a Soldier in ${Math.ceil(next * TICK_SECONDS)} s`);
    expect(traitorWatchLine(m, 0)).toBeNull();
    const late = { ...m, duel: { ...m.duel, tick: next + 5 } };
    expect(traitorWatchLine(late, 2)).toBe('Looking for a Soldier out of sight…');
    expect(traitorLine({ name: 'T', kills: 1, deaths: 2 })).toBe('1 kill · 2 deaths');
  });
});
