import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, type CrowdState, type MatchState } from '../sim';
import { armyPlan, armyStrengths, battleResult, battleResultLine, objectiveName, playersBySlot, playerStatus } from './battleHud';
import { battlefieldOf, RESPAWN } from '../sim';
import { startingTickets } from '../tuning';
import { join, lobbyLineup, moveMember, newLobby, setFormat, startMatch } from '../lobby/lobby';
import { battleBodies } from './battleScreen';
import { minimapHeading, minimapPoint, playerMarkers } from '../render/minimap';
import * as THREE from 'three';
import { ObjectiveMarks, objectiveLetter } from '../render/objectiveMarks';

const tuning = loadTuningData();
const army = tuning.battle.armySize;
const battle = () => createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, teams: [0] });
/** Four Players, two a Team (Fighter slots 0 and 1 on Team 0, 2 and 3 on Team 1). */
const four = () => createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, teams: [0, 0, 1, 1] });
const withPlayers = (match: MatchState, players: CrowdState['players']): MatchState => withCrowd(match, (c) => ({ ...c, players }));

function withCrowd(match: MatchState, edit: (c: CrowdState) => CrowdState): MatchState {
  return { ...match, duel: { ...match.duel, crowd: edit(match.duel.crowd!) } };
}
const killed = (alive: readonly number[], team: number, count: number) => alive.map((a, s) => (Math.floor(s / army) === team && s % army < count ? 0 : a));
const fallen = (match: MatchState): MatchState => ({ ...match, duel: { ...match.duel, fighters: match.duel.fighters.map((f, k) => (k === 0 ? { ...f, hp: 0, death: { tick: 0, cause: 'Hit' as const, blow: null } } : f)) } });

describe("The Battle's HUD", () => {
  it("reads each army's Tickets and strength and whether it routed", () => {
    const start = startingTickets(tuning.battle);
    const m = withCrowd(battle(), (c) => ({ ...c, alive: killed(c.alive, 1, army / 2), tickets: [start, start / 4 - 0.4], rout: { team: 1, tick: 5 } }));
    expect(armyStrengths(m.duel.crowd!, tuning.battle)).toEqual([
      { tickets: start, ticketShare: 1, alive: army, share: 1, routed: false },
      { tickets: start / 4, ticketShare: 0.25, alive: army / 2, share: 0.5, routed: true },
    ]);
  });

  it("says what an army is doing: the Objectives most of its Squads are sent to, attacking what it does not own and defending what it does", () => {
    const c = battle().duel.crowd!;
    const sites = battlefieldOf(tuning.battle, battle().arena)!.objectives;
    const per = c.squads.team.length / 2;
    const send = (team: number, to: (q: number) => number | null): typeof c => {
      const s = c.squads;
      const target = s.target.map((t, q) => (s.team[q] === team ? (to(q - team * per) ?? t) : t));
      const order = s.order.map((o, q) => (s.team[q] === team ? (to(q - team * per) === null ? RESPAWN : o) : o));
      return { ...c, squads: { ...s, target, order } };
    };
    // Everyone to B (index 2), which nobody owns: attacking B.
    expect(armyPlan(send(0, () => 2), sites, 0)).toBe('attacking B');
    // Ten Squads to B, six to its own Home (index 0): attacking B and defending your Home.
    expect(armyPlan(send(0, (k) => (k < 10 ? 2 : 0)), sites, 0)).toBe('attacking B and defending your Home');
    // Team 1 sees Team 0's Home as the enemy's; and Squads sent to its own Home defend it.
    expect(armyPlan(send(1, (k) => (k < 10 ? 0 : 4)), sites, 1)).toBe('attacking the enemy Home and defending your Home');
    // Squads with no Order, empty or falling count for nothing.
    expect(armyPlan(send(0, () => null), sites, 0)).toBe('regrouping');
    const fall = send(0, () => 2);
    expect(armyPlan({ ...fall, squads: { ...fall.squads, fall: fall.squads.fall.map(() => 1) } }, sites, 0)).toBe('regrouping');
    expect(armyPlan({ ...fall, squads: { ...fall.squads, living: fall.squads.living.map(() => 0) } }, sites, 0)).toBe('regrouping');
    // Taking B turns "attacking" into "defending" with no new Order.
    const owned = { ...send(0, () => 2), objectives: { ...c.objectives, owner: c.objectives.owner.map((o, k) => (k === 2 ? 0 : o)) } };
    expect(armyPlan(owned, sites, 0)).toBe('defending B');
    expect(objectiveName(sites[1]!, 0)).toBe('A');
    expect(objectiveName(sites[0]!, 1)).toBe('the enemy Home');
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
    const start = startingTickets(tuning.battle);
    expect(r).toEqual({ victory: true, winner: 0, kills: 5, taken: 2, left: [army, army], tickets: [start, start], held: [1, 1], seconds: 50 });
    expect(battleResultLine(r)).toBe(`Victory: the red army won · ${start} v ${start} Tickets · 5 kills · 2 soldiers taken over`);
    expect(battleResult({ ...over, status: { status: 'Over', winner: 1, tick: 3000 } }, 0)!.victory).toBe(false);
  });

  it("dresses the Player's slot in their own Body until they take over a Soldier, and their corpse in it after", () => {
    const m = battle();
    const own = battleBodies(m.duel, 0, ['male'], 'female');
    expect(own.player).toBe('male');
    expect(own.others.slice(1).every((b) => b === 'female')).toBe(true);
    const taken = withCrowd(m, (c) => ({ ...c, players: [{ soldier: 4, taken: 1, kills: 0, corpse: 2 }] }));
    const b = battleBodies(taken.duel, 0, ['male'], 'female');
    expect(b.player).toBe('female');
    expect(b.others[2]).toBe('male');
    expect(b.others[3]).toBe('female');
  });
});

describe("Each Player's slot online", () => {
  it("lists each Player's name and Body by Fighter slot, which is the Lobby's Team by Team order, not the Members'", () => {
    const options = { host: { name: 'Host', weapon: 'Longsword', body: 'male' }, settings: { arena: 'circle', bestOf: 3 }, online: true, ai: { difficulty: 'Normal', weapon: 'Longsword' } };
    let s = setFormat(newLobby(options), 'Battle', 'gen:greybox:1');
    s = join(s, { id: 1, name: 'Guest', weapon: 'Longsword', body: 'monk', ready: true })!;
    // The host sits on Team 2 and the guest on Team 1: Fighter slot 0 is the guest's, though they are Player 1.
    s = moveMember(s, 0, { team: 1, index: 1 });
    s = moveMember(s, 1, { team: 0, index: 0 });
    const lobby = lobbyLineup(startMatch(s));
    expect(lobby.lineup.map((l) => [l.team, l.pilot.kind === 'Player' ? l.pilot.player : -1])).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(playersBySlot(lobby.lineup, lobby.names)).toEqual(['Guest', 'Host']);
    expect(playersBySlot(lobby.lineup, lobby.bodies)).toEqual(['monk', 'male']);
    expect(playersBySlot([{ pilot: { kind: 'AI' } }], ['x'])).toEqual([undefined]);
  });

  it("dresses each Player's slot in the Body they chose, and a Soldier they took over in the generic one, from any local slot", () => {
    const m = four();
    const chosen = ['male', 'female', 'monk', 'snake'];
    const b = battleBodies(m.duel, 2, chosen, 'soldier');
    expect(b.player).toBe('monk');
    expect(b.others.map((o, k) => (k < 4 ? o : null)).slice(0, 4)).toEqual(['male', 'female', undefined, 'snake']);
    expect(b.others.slice(4).every((o) => o === 'soldier')).toBe(true);
    // Player 1 took over a Soldier, its own Fighter lying in slot 6; Player 2 (the local one) is still itself.
    const taken = withPlayers(m, m.duel.crowd!.players.map((r, k) => (k === 1 ? { ...r, soldier: 9, taken: 1, corpse: 6 } : r)));
    const t = battleBodies(taken.duel, 2, chosen, 'soldier');
    expect(t.player).toBe('monk');
    expect(t.others[1]).toBe('soldier');
    expect(t.others[6]).toBe('female');
    expect(t.others[5]).toBe('soldier');
  });

  it('marks every other Player standing, not the local one, one who has fallen, or one who left', () => {
    const m = four();
    expect(playerMarkers(m.duel, 0).map((p) => [p.fighter, p.team])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect(playerMarkers(m.duel, 3).map((p) => p.fighter)).toEqual([0, 1, 2]);
    const fell: MatchState = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === 1 ? { ...f, hp: 0, death: { tick: 0, cause: 'Hit' as const, blow: null } } : f)) } };
    expect(playerMarkers(fell.duel, 0).map((p) => p.fighter)).toEqual([2, 3]);
    const left = withPlayers(m, m.duel.crowd!.players.map((r, k) => (k === 2 ? { ...r, away: true as const } : r)));
    expect(playerMarkers(left.duel, 0).map((p) => p.fighter)).toEqual([1, 3]);
    // A one-Player Battle has nobody else to mark.
    expect(playerMarkers(battle().duel, 0)).toEqual([]);
  });

  it('marks a Player at their Fighter, wherever it stands and whatever Soldier it is', () => {
    const m = four();
    const mark = playerMarkers(m.duel, 0).find((p) => p.fighter === 2)!;
    expect(mark.position).toEqual({ x: m.duel.fighters[2]!.position.x, y: m.duel.fighters[2]!.y, z: m.duel.fighters[2]!.position.z });
    expect(mark.facing).toBe(m.duel.fighters[2]!.facing);
  });
});

describe('The minimap', () => {
  it("turns the map half a turn for a Team 1 Player, whose army stands at +z and who looks along -z", () => {
    expect(minimapPoint(0, 100, 200, 180, true)).toEqual({ x: 90, y: 180 });
    expect(minimapPoint(0, -100, 200, 180, true)).toEqual({ x: 90, y: 0 });
    expect(minimapPoint(100, 0, 200, 180, true)).toEqual({ x: 180, y: 90 });
    // Facing -z (yaw π) points up the turned map, as facing +z does the other.
    const up = minimapHeading(Math.PI, true);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    const m = four();
    expect(minimapPoint(0, m.duel.fighters[2]!.position.z, 200, 180, true).y).toBeGreaterThan(90);
  });

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

describe('The Objectives on the field', () => {
  const sites = () => battlefieldOf(tuning.battle, battle().arena)!;

  it('letters a Home Objective H and the others by their id', () => {
    expect(sites().objectives.map((o) => objectiveLetter(o))).toEqual(['H', 'A', 'B', 'C', 'H']);
  });

  it("draws a ring, a capture arc, a pole, a flag and a letter for each, in the Owner's colour and filled to the progress", () => {
    const field = sites();
    const marks = new ObjectiveMarks(field.objectives, field.heights, tuning.battle.soldier.colours);
    expect(marks.root.children).toHaveLength(5);
    marks.update({ progress: [1, 0.5, 0, -0.25, -1], owner: [0, -1, -1, -1, 1] });
    const [home, a, b, c, away] = marks.root.children as THREE.Group[];
    const rim = (g: THREE.Group) => ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
    const capture = (g: THREE.Group) => (g.children[1] as THREE.Mesh).geometry.drawRange.count;
    expect(rim(home!)).toBe(tuning.battle.soldier.colours[0]);
    expect(rim(away!)).toBe(tuning.battle.soldier.colours[1]);
    expect(rim(a!)).not.toBe(tuning.battle.soldier.colours[0]);
    const full = capture(home!);
    expect(capture(a!)).toBe(full / 2);
    expect(capture(b!)).toBe(0);
    expect(capture(c!)).toBe(full / 4);
    expect(((c!.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex()).toBe(tuning.battle.soldier.colours[1]);
    marks.dispose();
  });
});
