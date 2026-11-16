import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaTuning, floorArenaName, floorOf, parseFloorArena } from '../sim/delver';
import { arenaOf, createMatch, DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, IDLE_INTENT, MAX_TEAM_SIZE, navMesh, runSeed, stepMatch, type MatchState } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena } from './arenaWorlds';
import { flatFloors } from '../sim/delver/flat.testdata';

describe('the Arena the Renderer draws, by the Match state’s Arena name', () => {
  const tuning = loadTuningData();

  it('follows a Rematch onto the next Random Map: its geometry is the one the Simulation fights on, with its Layout', () => {
    const world = createArenaWorlds(tuning);
    const matchTuning = world('gen:greybox:12').tuning;
    let m: MatchState = createMatch(matchTuning, { arena: 'gen:greybox:12', bestOf: 1, rematchTicks: 3 });
    m = { ...m, score: [1, 0], status: { status: 'Over', winner: 0, tick: m.tick } };
    while (m.matchNumber === 1) m = stepMatch(m, [IDLE_INTENT, IDLE_INTENT], matchTuning);
    const drawn = world(m.duel.arena);
    expect(m.duel.arena).toBe('gen:greybox:381979');
    expect(arenaOf(drawn.tuning, m.duel.arena)).toBe(arenaOf(matchTuning, m.duel.arena));
    expect(drawn.layout).toStrictEqual(generateArena(GREYBOX_KIT, 381979, DEFAULT_GEN_PARAMS, tuning).layout);
  });

  it('builds a name it has dropped again, the same Arena and Layout', () => {
    const world = createArenaWorlds(tuning);
    const first = world('gen:greybox:50');
    for (let seed = 51; seed <= 54; seed++) world(`gen:greybox:${seed}`);
    const again = world('gen:greybox:50');
    expect(again.tuning.arenas['gen:greybox:50']).toStrictEqual(first.tuning.arenas['gen:greybox:50']);
    expect(again.layout).toStrictEqual(first.layout);
  });

  it('draws a hand-made Arena from Tuning Data itself, with no Layout', () => {
    expect(createArenaWorlds(tuning)('library')).toEqual({ tuning });
  });
});

describe('the Arena worlds in Duels', () => {
  const tuning = loadTuningData();

  it('in Duels warms only a Rematch’s next Random Map, while the result shows', () => {
    const matchTuning = createArenaWorlds(tuning)('gen:greybox:12').tuning;
    const m = createMatch(matchTuning, { arena: 'gen:greybox:12', bestOf: 1, rematchTicks: 3 });
    expect(arenaToWarm(m)).toBeNull();
    const over: MatchState = { ...m, status: { status: 'Over', winner: 0, tick: 0 } };
    expect(arenaToWarm(over)).toBe('gen:greybox:381979');
    expect(arenaToWarm({ ...over, config: { ...over.config, rematchTicks: null } })).toBeNull();
    const library = createMatch(tuning, { arena: 'library', bestOf: 1, rematchTicks: 3 });
    expect(arenaToWarm({ ...library, status: { status: 'Over', winner: 0, tick: 0 } })).toBeNull();
  });
});

describe('the Arena worlds across a Delver Run’s Floor change', () => {
  const base = flatFloors(loadTuningData());
  /** A short Run: one tier of three Floors. */
  const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
  const ARENA = 'gen:greybox:4242';
  const seed = runSeed(ARENA);
  const start = () => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);

  it('gives a Floor the Tuning Data the Simulation reads it under, the very object, and any other name as before', () => {
    const world = createArenaWorlds(tuning);
    const name = floorArenaName(seed, 1);
    expect(parseFloorArena(name)).not.toBeNull();
    expect(world(name)).toEqual({ tuning: arenaTuning(tuning, name) });
    expect(world(name).tuning).toBe(arenaTuning(tuning, name));
    expect(world(name).tuning).not.toBe(tuning);
    expect(arenaOf(world(name).tuning, name)).toBe(arenaOf(arenaTuning(tuning, name), name));
    expect(world('library')).toEqual({ tuning });
  });

  it('warms the next Floor from a Floor’s first Tick, nothing on the last Floor, in the fade or once Over', () => {
    let m = start();
    const next = floorArenaName(seed, 2);
    expect(arenaToWarm(m)).toBe(next);
    m = stepMatch(m, idle(m), tuning);
    expect(arenaToWarm(m)).toBe(next);
    // Descending (the fade): still the next Floor's, until the Floor changes.
    const fading: MatchState = { ...m, nextDuelTick: m.tick + 2, delver: { ...m.delver!, phase: 'Descending' } };
    expect(arenaToWarm(fading)).toBe(next);
    const two: MatchState = { ...m, delver: { ...m.delver!, floor: 2 } };
    expect(arenaToWarm(two)).toBe(floorArenaName(seed, 3));
    const last: MatchState = { ...m, delver: { ...m.delver!, floor: m.delver!.floors } };
    expect(arenaToWarm(last)).toBeNull();
    const over: MatchState = { ...m, status: { status: 'Over', winner: 1, tick: m.tick } };
    expect(arenaToWarm(over)).toBeNull();
  });

  it('builds the next Floor ahead: the Floor change reads the caches, the navmesh and the world', () => {
    const world = createArenaWorlds(tuning);
    const next = floorArenaName(seed, 2);
    warmArena(world, tuning, next);
    const t = arenaTuning(tuning, next);
    const mesh = navMesh(arenaOf(t, next), t);
    const drawn = world(next);
    expect(drawn.tuning).toBe(t);
    expect(floorOf(tuning, next)).toBe(floorOf(t, next));
    expect(navMesh(arenaOf(drawn.tuning, next), drawn.tuning)).toBe(mesh);
  });
});
