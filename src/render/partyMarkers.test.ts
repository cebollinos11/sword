/** The party's other Players an online Delver Run tags (docs/plans/delver.md, Stage 8): `partyMarkers`. */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createMatch, MAX_TEAM_SIZE, takeOverFighter, type MatchState } from '../sim';
import { flatFloors } from '../sim/delver/flat.testdata';
import { partyMarkers } from './minimap';

const base = flatFloors(loadTuningData());
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0 } };

/** A Delver Run of four on Team 0, the first `humans` of them Players. */
const delver = (humans: number): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, humans, teams: [0, 0, 0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });

const marked = (m: MatchState, me: number) => partyMarkers(m.config, m.duel, me).map((p) => p.fighter);

describe('partyMarkers', () => {
  it('marks every other Player of the party, never the local one nor an AI ally', () => {
    const m = delver(3);
    expect(marked(m, 0)).toEqual([1, 2]);
    expect(marked(m, 2)).toEqual([0, 1]);
    const f = m.duel.fighters[1]!;
    expect(partyMarkers(m.config, m.duel, 0)[0]).toEqual({ fighter: 1, team: 0, position: { x: f.position.x, y: f.y, z: f.position.z }, facing: f.facing });
  });

  it('leaves out a Player who left (an AI drives that Fighter now) and one who has fallen', () => {
    const left = takeOverFighter(delver(3), 2);
    expect(marked(left, 0)).toEqual([1]);
    const m = delver(3);
    const fell = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 1 ? { ...f, hp: 0, death: { tick: 1, cause: 'Hit' as const, blow: null } } : f)) } } as MatchState;
    expect(marked(fell, 0)).toEqual([2]);
  });

  it('marks nobody outside a Delver Run', () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
    expect(partyMarkers(m.config, m.duel, 0)).toEqual([]);
  });

  it("marks a traitor's whole living party, Players and AI allies, and marks no traitor for Team 0 (Stage 8a)", () => {
    const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: 'gen:greybox:4242', delver: true, humans: 1, players: [0], teams: [0, 0, 0], traitors: [{}] });
    // The traitor's slot is 3, right after the party.
    expect(marked(m, 3)).toEqual([0, 1, 2]);
    // The party marks no traitor (its slot holds a Team 1 Fighter, like any promoted Soldier).
    expect(marked(m, 0)).toEqual([]);
    const fell = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 1 ? { ...f, hp: 0, death: { tick: 1, cause: 'Hit' as const, blow: null } } : f)) } } as MatchState;
    expect(marked(fell, 3)).toEqual([0, 2]);
  });
});
