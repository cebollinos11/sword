import { describe, expect, it } from 'vitest';
import { arenaOf, createMatch, exitDoor, hallBehind, hallOf, inDuel, IDLE_INTENT, MAX_TEAM_SIZE, runHall, stepMatch, type MatchState } from '../sim';
import { loadTuningData } from '../tuning';
import { doorMarkView, doorParty, doorRun } from './doorMarks';

describe('doorMarkView', () => {
  const exits = [{ exit: 0, kind: 'Elite' as const }, { exit: 1, kind: 'Fight' as const, floor: 2 }];
  const hall = (phase: 'Fighting' | 'Cleared' | 'Leaving') => ({ floor: 1, row: 4, index: 0, kind: 'Boss' as const, phase });

  it('gives each exit Door its Hall kind’s icon, and no mark for the entrance', () => {
    const marks = doorMarkView(hall('Fighting'), exits, { gathered: [0, 0], party: 2 });
    expect(marks.map((d) => [d.exit, d.icon])).toEqual([[0, 'Elite'], [1, 'Fight']]);
    expect(marks).toHaveLength(exits.length);
    expect(doorMarkView(undefined, exits, { gathered: [], party: 0 })).toEqual([]);
  });

  it('names the next Floor after a Boss', () => {
    const marks = doorMarkView(hall('Fighting'), exits, { gathered: [0, 0], party: 2 });
    expect(marks.map((d) => d.label)).toEqual(['', 'Floor 2']);
  });

  it('draws the gate closed while Fighting and open once Cleared or Leaving', () => {
    const gates = (phase: 'Fighting' | 'Cleared' | 'Leaving') => doorMarkView(hall(phase), exits, { gathered: [0, 0], party: 2 }).map((d) => d.gate);
    expect(gates('Fighting')).toEqual(['closed', 'closed']);
    expect(gates('Cleared')).toEqual(['open', 'open']);
    expect(gates('Leaving')).toEqual(['open', 'open']);
  });

  it('counts the party gathering in a Door’s zone, as text', () => {
    const marks = doorMarkView(hall('Cleared'), exits, { gathered: [0, 2], party: 3 });
    expect(marks.map((d) => d.count)).toEqual(['', '2 / 3']);
  });

  it('numbers the marks by exit, not by place in the list, when an exit is left out', () => {
    // Exit 0 has no Hall behind it: exit 1's mark is for Arena Door 2, its count is its own.
    const marks = doorMarkView(hall('Cleared'), [exits[1]!], { gathered: [3, 2], party: 3 });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ exit: 1, icon: 'Fight', label: 'Floor 2', count: '2 / 3' });
  });
});

describe('doorRun', () => {
  const tuning = loadTuningData();
  const ARENA = 'gen:greybox:12';
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  const start = () => createMatch(tuning, { format: 'Gauntlet', arena: ARENA, bestOf: 1, humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const cleared = (m: MatchState) => stepMatch({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } }, idle(m), tuning);
  const inZone = (m: MatchState, i: number, exit: number): MatchState => {
    const zone = arenaOf(tuning, m.arena).doors[exitDoor(exit)]!.zone;
    const at = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: at, y: zone[0]!.y } : f)) } };
  };

  it('lists the Hall behind each exit, and counts who gathers once the Hall is Cleared', () => {
    let m = start();
    const run = m.run!;
    const behind = hallOf(tuning, ARENA, runHall(run)).exits.map((_, k) => hallOf(tuning, ARENA, hallBehind(tuning, m.config, run, k)!).kind);
    expect(doorRun(m, tuning)!.exits.map((e) => e.kind)).toEqual(behind);
    expect(doorRun(m, tuning)!.exits.map((e) => e.exit)).toEqual(behind.map((_, k) => k));
    expect(doorRun(m, tuning)!.players.gathered.every((g) => g === 0)).toBe(true);
    m = inZone(inZone(cleared(m), 0, 1), 1, 1);
    const { players } = doorRun(m, tuning)!;
    expect(players.party).toBe(2);
    expect(players.gathered[1]).toBe(2);
  });

  it('is none in a Duel', () => {
    expect(doorRun(createMatch(tuning, { format: 'Duels', arena: ARENA, bestOf: 1, humans: 1, teams: [0, 1] }), tuning)).toBeNull();
  });
});

describe('the Door count with two Players', () => {
  const tuning = loadTuningData();
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  const run = () => {
    const m = createMatch(tuning, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
    return stepMatch({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } }, idle(m), tuning);
  };
  const inZone = (m: MatchState, i: number, exit: number): MatchState => {
    const zone = arenaOf(tuning, m.arena).doors[exitDoor(exit)]!.zone;
    const at = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: at, y: zone[0]!.y } : f)) } };
  };
  const count = (m: MatchState) => {
    const d = doorRun(m, tuning)!;
    return doorMarkView(m.duel.hall, d.exits, d.players).find((v) => v.exit === 1)!.count;
  };

  it('names who counts through one function: the Run’s Players still in the Duel', () => {
    expect(doorParty(run())).toEqual([0, 1]);
  });

  it('reads "1 / 2" with only Fighter 1 (the second Player) in the zone, then "2 / 2"', () => {
    let m = inZone(run(), 1, 1);
    expect(count(m)).toBe('1 / 2');
    m = inZone(m, 0, 1);
    expect(count(m)).toBe('2 / 2');
  });
});
