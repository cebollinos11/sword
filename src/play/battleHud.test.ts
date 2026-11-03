import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, type CrowdState, type MatchState } from '../sim';
import { armyStrengths, battleResult, battleResultLine, playerStatus } from './battleHud';
import { battleBodies } from './battleScreen';
import { minimapHeading, minimapPoint } from '../render/minimap';

const tuning = loadTuningData();
const army = tuning.battle.armySize;
const battle = () => createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, teams: [0] });

function withCrowd(match: MatchState, edit: (c: CrowdState) => CrowdState): MatchState {
  return { ...match, duel: { ...match.duel, crowd: edit(match.duel.crowd!) } };
}
const killed = (alive: readonly number[], team: number, count: number) => alive.map((a, s) => (Math.floor(s / army) === team && s % army < count ? 0 : a));
const fallen = (match: MatchState): MatchState => ({ ...match, duel: { ...match.duel, fighters: match.duel.fighters.map((f, k) => (k === 0 ? { ...f, hp: 0, death: { tick: 0, cause: 'Hit' as const, blow: null } } : f)) } });

describe("The Battle's HUD", () => {
  it("reads each army's strength and whether it routed", () => {
    const m = withCrowd(battle(), (c) => ({ ...c, alive: killed(c.alive, 1, army / 2), rout: { team: 1, tick: 5 } }));
    expect(armyStrengths(m.duel.crowd!, tuning.battle)).toEqual([
      { alive: army, share: 1, routed: false },
      { alive: army / 2, share: 0.5, routed: true },
    ]);
  });

  it('says the Player fights, has fallen (an ally left to take over), or is out (none left)', () => {
    expect(playerStatus(battle().duel, 0)).toBe('Fighting');
    expect(playerStatus(fallen(battle()).duel, 0)).toBe('Fallen');
    expect(playerStatus(withCrowd(fallen(battle()), (c) => ({ ...c, alive: killed(c.alive, 0, army) })).duel, 0)).toBe('Out');
  });

  it("tells the result from the Player's side, with their kills and takeovers", () => {
    const m = battle();
    expect(battleResult(m, 0)).toBeNull();
    const over: MatchState = withCrowd({ ...m, status: { status: 'Over', winner: 0, tick: 3000 } }, (c) => ({ ...c, players: [{ soldier: 7, taken: 2, kills: 5, corpse: 3 }] }));
    const r = battleResult(over, 0)!;
    expect(r).toEqual({ victory: true, winner: 0, kills: 5, taken: 2, left: [army, army], seconds: 50 });
    expect(battleResultLine(r)).toBe('Victory: the red army won · 5 kills · 2 soldiers taken over');
    expect(battleResult({ ...over, status: { status: 'Over', winner: 1, tick: 3000 } }, 0)!.victory).toBe(false);
  });

  it("dresses the Player's slot in their own Body until they take over a Soldier, and their corpse in it after", () => {
    const m = battle();
    const own = battleBodies(m.duel, 0, 'male', 'female');
    expect(own.player).toBe('male');
    expect(own.others.slice(1).every((b) => b === 'female')).toBe(true);
    const taken = withCrowd(m, (c) => ({ ...c, players: [{ soldier: 4, taken: 1, kills: 0, corpse: 2 }] }));
    const b = battleBodies(taken.duel, 0, 'male', 'female');
    expect(b.player).toBe('female');
    expect(b.others[2]).toBe('male');
    expect(b.others[3]).toBe('female');
  });
});

describe('The minimap', () => {
  it('puts the field in the square, the Player army at the bottom, +x to the left as the camera shows it', () => {
    expect(minimapPoint(0, 0, 200, 180)).toEqual({ x: 90, y: 90 });
    expect(minimapPoint(0, -100, 200, 180)).toEqual({ x: 90, y: 180 });
    expect(minimapPoint(0, 100, 200, 180)).toEqual({ x: 90, y: 0 });
    expect(minimapPoint(100, 0, 200, 180)).toEqual({ x: 0, y: 90 });
  });

  it('points the way a Fighter faces', () => {
    const up = minimapHeading(0);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    const left = minimapHeading(Math.PI / 2);
    expect(left.x).toBeCloseTo(-1);
    expect(left.y).toBeCloseTo(0);
  });
});
