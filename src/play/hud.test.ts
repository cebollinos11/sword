import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, exitDoor, hallBehind, hallOf, IDLE_INTENT, inDuel, MAX_TEAM_SIZE, secondsToTicks, stepMatch, type MatchState } from '../sim';
import { doorLabel, doorMarks, hallBanner, hallFade, hallScore, hpText, runResultLine, runTime } from './hud';

describe('the Run’s HUD text', () => {
  it('names the Floor, the Hall’s row of five and the Run seed; the Boss Hall by its Floor', () => {
    expect(hallBanner({ floor: 2, row: 2 }, 3, 4242)).toBe('Floor 2 · Hall 3 / 5 · seed 4242');
    expect(hallBanner({ floor: 1, row: 0 }, 3, 7)).toBe('Floor 1 · Hall 1 / 5 · seed 7');
    expect(hallBanner({ floor: 2, row: 4 }, 3, 4242)).toBe('Boss · Floor 2 / 3');
    expect(hallScore({ floor: 2, row: 2 }, 3)).toBe('Floor 2 · Hall 3 / 5');
    expect(hallScore({ floor: 3, row: 4 }, 3)).toBe('Boss · Floor 3 / 3');
  });

  it('labels a Door with the kind of Hall behind it, and how many of the party stand in it while it gathers', () => {
    expect(doorLabel('Elite', 0, 3)).toBe('Elite');
    expect(doorLabel('Rest', 2, 3)).toBe('Rest · 2 / 3');
    expect(doorLabel('Fight', 1, 1)).toBe('Fight · 1 / 1');
  });

  it('sums a Run up in one line: the verdict, Floors and Halls cleared, the time and the seed', () => {
    expect(runResultLine({ victory: false, cleared: 1, floors: 3, halls: 7, seconds: 312, seed: 4242 })).toBe('Defeat · 1 / 3 Floors · 7 Halls cleared · 5:12 · Run seed 4242');
    expect(runResultLine({ victory: true, cleared: 3, floors: 3, halls: 1, seconds: 5, seed: 1 })).toBe('Victory · 3 / 3 Floors · 1 Hall cleared · 0:05 · Run seed 1');
  });

  it('gives the Run time as m:ss', () => {
    expect(runTime(0)).toBe('0:00');
    expect(runTime(65.9)).toBe('1:05');
    expect(runTime(754)).toBe('12:34');
  });
});

describe('the Doors’ labels and the fade between Halls', () => {
  const tuning = loadTuningData();
  const ARENA = 'gen:greybox:12';
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  /** A Run with two Players on Team 0. */
  const start = () => createMatch(tuning, { format: 'Gauntlet', arena: ARENA, bestOf: 1, humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const cleared = (m: MatchState) => stepMatch({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } }, idle(m), tuning);
  const inZone = (m: MatchState, i: number, exit: number): MatchState => {
    const zone = arenaOf(tuning, m.arena).doors[exitDoor(exit)]!.zone;
    const at = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    return { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: at, y: zone[0]!.y } : f)) } };
  };

  it('marks every exit Door with the kind behind it, over its doorway, open once the Hall is Cleared, counting the party in it', () => {
    let m = start();
    const hall = hallOf(tuning, ARENA, { floor: 1, row: 0, index: 0 });
    const kinds = hall.exits.map((_, k) => hallOf(tuning, ARENA, hallBehind(tuning, m.config, m.run!, k)!).kind);
    const marks = doorMarks(m, tuning);
    expect(marks.map((d) => [d.exit, d.text, d.open])).toEqual(kinds.map((kind, k) => [k, kind, false]));
    // Over the doorway: above the zone's ground, nearer the Arena's edge than the zone's middle.
    const doors = arenaOf(tuning, m.arena).doors;
    for (const d of marks) {
      const zone = doors[exitDoor(d.exit)]!.zone;
      expect(d.at.y).toBeGreaterThan(zone[0]!.y + 2);
      const c = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
      expect(Math.hypot(d.at.x, d.at.z)).toBeGreaterThan(Math.hypot(c.x, c.z));
    }

    m = cleared(m);
    expect(doorMarks(m, tuning).every((d) => d.open)).toBe(true);
    m = inZone(m, 0, 1);
    expect(doorMarks(m, tuning).map((d) => d.text)).toEqual(kinds.map((kind, k) => (k === 1 ? `${kind} · 1 / 2` : kind)));
    m = inZone(m, 1, 1);
    expect(doorMarks(m, tuning)[1]!.text).toBe(`${kinds[1]} · 2 / 2`);
  });

  it('fades out over the fade once a Door is taken, and back in as the next Hall starts', () => {
    let m = cleared(start());
    expect(hallFade(m, tuning)).toBe(0);
    while (m.run!.phase === 'Cleared') m = stepMatch(inZone(inZone(m, 0, 0), 1, 0), idle(m), tuning);
    const fade = secondsToTicks(tuning.dungeon.hallFadeSeconds);
    expect(hallFade(m, tuning)).toBeCloseTo(1 / fade);
    let last = 0;
    while (m.duelNumber === 1) {
      const f = hallFade(m, tuning);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
      m = stepMatch(m, idle(m), tuning);
    }
    expect(last).toBe(1);
    // The next Hall's first Tick is still dark, then it fades back in.
    expect(hallFade(m, tuning)).toBe(1);
    for (let k = 0; k < fade; k++) m = stepMatch(m, idle(m), tuning);
    expect(hallFade(m, tuning)).toBe(0);
    // A Run's first Hall and Duels never fade.
    expect(hallFade(start(), tuning)).toBe(0);
    // ...nor does a dev start deeper in (its first Hall is not Hall 1).
    const deeper = createMatch(tuning, { format: 'Gauntlet', arena: ARENA, bestOf: 1, humans: 2, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)], start: { floor: 1, row: 2 } });
    expect(deeper.duelNumber).toBeGreaterThan(1);
    expect(hallFade(deeper, tuning)).toBe(0);
    expect(hallFade(stepMatch(deeper, idle(deeper), tuning), tuning)).toBe(0);
    expect(hallFade(createMatch(tuning, { arena: 'library', bestOf: 3 }), tuning)).toBe(0);
  });
});

describe('the HP shown on a bar', () => {
  it('rounds up a part HP, so a Fighter alive never shows 0', () => {
    expect(hpText(42.3)).toBe('43');
    expect(hpText(0.2)).toBe('1');
    expect(hpText(0)).toBe('0');
    expect(hpText(-5)).toBe('0');
  });

  it('a depth-scaled max HP shows as itself, not one over (100 × 1.1 is 110.00000000000001)', () => {
    const tuning = loadTuningData();
    const hp = tuning.fighter.maxHp * (1 + tuning.dungeon.depthHp * 1);
    expect(hp).not.toBe(110);
    expect(hpText(hp)).toBe('110');
  });
});
