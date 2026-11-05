import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, IDLE_INTENT, inDuel, inExitZone, MAX_TEAM_SIZE, secondsToTicks, stepMatch, type MatchState, type RunStart } from '../sim';
import { createAutopilot, type Autopilot } from './autopilot';
import type { Controller } from './controller';
import { lineupAis, type Lineup, type LineupSlot } from './lineup';

const tuning = loadTuningData();
const ENEMIES: LineupSlot[] = Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: 'Floor' } }));
const LINEUP: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, ...ENEMIES];

const match = (arena: string, start?: RunStart, relics?: string[]): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 3, arena, teams: LINEUP.map((s) => s.team), humans: 1, players: [0], ...(start ? { start } : {}), ...(relics ? { relics } : {}) });

/** Every enemy felled and one idle step: the Hall is Cleared. */
function cleared(m: MatchState): MatchState {
  const felled = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
  return stepMatch(felled, felled.duel.fighters.map(() => IDLE_INTENT), tuning);
}

/** Steps the Player's slot with `pilot`, the rest with the Lineup's own AIs, until `until` or `ticks`. */
function play(m: MatchState, pilot: Controller, ticks: number, until: (m: MatchState) => boolean): MatchState[] {
  const drive = lineupAis(tuning, LINEUP, 'Gauntlet', { arena: m.config.arena }).map((c) => c ?? pilot);
  const out = [m];
  for (let k = 0; k < ticks && !until(m); k++) {
    (pilot as Partial<Autopilot>).watch?.(m);
    m = stepMatch(m, drive.map((c, i) => c.intent(m.duel, i)), tuning);
    out.push(m);
  }
  return out;
}

const taken = (states: MatchState[]) => states.flatMap((s) => s.events).find((e) => e.type === 'DoorTaken');

describe('dev autopilot (the Player Seat on an AI, for checks in the browser)', { timeout: 120_000 }, () => {
  it('in a Cleared Hall it walks to the chosen Door of its row, and the Run takes it', () => {
    const start = cleared(match('gen:greybox:4242'));
    expect(start.run!.phase).toBe('Cleared');
    const exits = arenaOf(tuning, start.arena).doors.length - 1;
    expect(exits).toBeGreaterThan(1);
    for (const exit of [0, exits - 1]) {
      const states = play(start, createAutopilot(tuning, 'Hard', [exit]), secondsToTicks(30), (m) => m.run!.phase === 'Leaving');
      expect(taken(states), `exit ${exit}`).toMatchObject({ type: 'DoorTaken', exit });
    }
  });

  it('a Door past the Hall\'s last is its last; rows past the list use the list\'s last', () => {
    const start = cleared(match('gen:greybox:4242'));
    const exits = arenaOf(tuning, start.arena).doors.length - 1;
    const states = play(start, createAutopilot(tuning, 'Hard', [9]), secondsToTicks(30), (m) => m.run!.phase === 'Leaving');
    expect(taken(states)).toMatchObject({ exit: exits - 1 });
  });

  it('in a Rest Hall it takes the fire before it leaves', () => {
    const rest = [0, 1].map((index) => match('gen:greybox:4242', { floor: 1, row: 3, index })).find((m) => m.duel.hall?.kind === 'Rest');
    expect(rest).toBeDefined();
    const hurt = { ...rest!, duel: { ...rest!.duel, fighters: rest!.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: 20 } : f)) } };
    const states = play(hurt, createAutopilot(tuning, 'Hard', [0]), secondsToTicks(60), (m) => m.run!.phase === 'Leaving');
    const restedAt = states.findIndex((s) => s.events.some((e) => e.type === 'Rested'));
    expect(restedAt).toBeGreaterThan(0);
    expect(states.at(-1)!.run!.phase).toBe('Leaving');
    expect(states.at(-1)!.duel.fighters[0]!.hp).toBeGreaterThan(20);
    expect(inExitZone(arenaOf(tuning, hurt.arena), 0, states.at(-1)!.duel.fighters[0]!)).toBe(true);
  });

  describe('with loot', () => {
    const inv = (m: MatchState) => m.duel.fighters[0]!.inventory!;
    const events = (states: MatchState[], type: string) => states.flatMap((s) => s.events).filter((e) => e.type === type);
    const leaving = (m: MatchState) => m.run!.phase === 'Leaving';

    it('a Fight Hall: it walks onto its drop, takes it and equips it, then leaves', () => {
      const start = cleared(match('gen:greybox:4242'));
      expect(start.run!.pickups.length).toBeGreaterThan(0);
      const states = play(start, createAutopilot(tuning, 'Hard', [0], 'take'), secondsToTicks(60), leaving);
      const end = states.at(-1)!;
      expect(events(states, 'ItemTaken')).toHaveLength(start.run!.pickups.length);
      expect(leaving(end)).toBe(true);
      const held = inv(end);
      expect(held.relics.length + held.weapons.length).toBe(1 + start.run!.pickups.length);
      // A Relic taken is equipped; a Weapon taken is wielded.
      expect(held.equipped.length).toBe(held.relics.length);
      expect(held.weapon).toBe(held.weapons.length - 1);
    });

    it('without the option it leaves the loot lying', () => {
      const start = cleared(match('gen:greybox:4242'));
      const states = play(start, createAutopilot(tuning, 'Hard', [0]), secondsToTicks(60), leaving);
      expect(events(states, 'ItemTaken')).toHaveLength(0);
    });

    it("a Treasure Hall: it takes one of its three pedestals, the rest close", () => {
      const treasure = [1, 2, 3].flatMap((row) =>
        [0, 1, 2].flatMap((index) => {
          try {
            return [match('gen:greybox:4242', { floor: 1, row, index })];
          } catch {
            return [];
          }
        }),
      ).find((m) => m.duel.hall?.kind === 'Treasure');
      expect(treasure).toBeDefined();
      const mine = treasure!.run!.pickups.filter((p) => p.owner === 0);
      expect(mine).toHaveLength(tuning.dungeon.loot.pedestals);
      const states = play(treasure!, createAutopilot(tuning, 'Hard', [0], 'take'), secondsToTicks(60), leaving);
      expect(events(states, 'ItemTaken')).toHaveLength(1);
      expect(states.at(-1)!.run!.pickups.filter((p) => !p.taken)).toHaveLength(0);
    });

    it('drop mode: it drops a carried Relic, steps off it and takes it up again', () => {
      const relics = ['Whetstone', 'Iron Plate', 'Vital Charm', 'Steel Boots'];
      const start = cleared(match('gen:greybox:4242', undefined, relics));
      const states = play(start, createAutopilot(tuning, 'Hard', [0], 'drop'), secondsToTicks(90), leaving);
      const dropped = events(states, 'ItemDropped');
      expect(dropped).toHaveLength(1);
      const took = events(states, 'ItemTaken');
      expect(took.length).toBeGreaterThan(start.run!.pickups.length);
      expect(took.some((e) => 'item' in e && 'item' in dropped[0]! && e.item === dropped[0]!.item)).toBe(true);
      expect(leaving(states.at(-1)!)).toBe(true);
    });
  });
});
