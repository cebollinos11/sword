import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, exitDoor } from '../sim';
import { exitDoorSpawn } from './doorSpot';

const tuning = loadTuningData();

describe('exit door spawn', () => {
  const m = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 3, arena: 'gen:greybox:4242', teams: [0, 0, 0, 1, 1, 1, 1], humans: 1, players: [0] });
  const arena = arenaOf(tuning, m.arena);
  // Only the teams matter here, and a Run's line-up lists Team 0 first, so interleave them by hand.
  const state = { fighters: [0, 0, 1, 0, 1].map((team, i) => ({ ...m.duel.fighters[i]!, team })) };
  const { spawns } = arena.doors[exitDoor(0)]!;

  it("is the Fighter's rank among its team's Fighters before it, as a slot", () => {
    // Fighters 0, 1 and 3 are Team 0 (slots 0, 1 and 2); Fighters 2 and 4 are Team 1 (slots 0 and 1).
    expect(exitDoorSpawn(arena, 0, state, 0)).toBe(spawns.find((s) => s.slot === 0));
    expect(exitDoorSpawn(arena, 0, state, 1)).toBe(spawns.find((s) => s.slot === 1));
    expect(exitDoorSpawn(arena, 0, state, 3)).toBe(spawns.find((s) => s.slot === 2));
    expect(exitDoorSpawn(arena, 0, state, 4)).toBe(spawns.find((s) => s.slot === 1));
  });

  it("falls back to the Door's first spawn when it has none for the slot", () => {
    const one = { ...arena, doors: [arena.doors[0]!, { ...arena.doors[exitDoor(0)]!, spawns: spawns.slice(0, 1) }] };
    expect(exitDoorSpawn(one, 0, state, 3)).toBe(spawns[0]);
  });
});
