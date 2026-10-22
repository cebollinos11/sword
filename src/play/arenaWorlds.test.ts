import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, IDLE_INTENT, inDuel, navMesh, nextArenaName, stepMatch, type MatchState } from '../sim';
import { arenaToWarm, createArenaWorlds, warmArena } from './arenaWorlds';

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

describe('the Arena worlds across a Run’s Floor change', () => {
  const tuning = loadTuningData();
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  /** A Run on `gen:greybox:12`, Team 0 one Fighter, a short pause between Floors. */
  const start = (matchTuning: typeof tuning) =>
    createMatch(matchTuning, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1], interDuelTicks: 5 });
  /** Fell every enemy and step until the Floor is cleared (the pause before the next has begun, or the Run is won). */
  function clear(m: MatchState, matchTuning: typeof tuning): MatchState {
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
    while (m.nextDuelTick === null && m.status.status === 'InProgress') m = stepMatch(m, idle(m), matchTuning);
    return m;
  }
  /** Step on to the next Floor's first Tick, returning the Match state just before it too. */
  function nextFloor(m: MatchState, matchTuning: typeof tuning): { before: MatchState; after: MatchState } {
    const floor = m.run!.floor;
    let before = m;
    while (m.run!.floor === floor) {
      before = m;
      m = stepMatch(m, idle(m), matchTuning);
    }
    return { before, after: m };
  }
  const clearFloor = (m: MatchState, matchTuning: typeof tuning) => nextFloor(clear(m, matchTuning), matchTuning);

  it('warms the next Floor’s Arena once a Floor is cleared; the Floor change only reads it, and the Renderer draws the same geometry', () => {
    const world = createArenaWorlds(tuning);
    const matchTuning = world('gen:greybox:12').tuning;
    let m = start(matchTuning);
    const next = nextArenaName('gen:greybox:12');
    // While the Floor is fought, nothing to build; once it is cleared, the next Floor's Arena.
    expect(arenaToWarm(m)).toBeNull();
    m = clear(m, matchTuning);
    expect(arenaToWarm(m)).toBe(next);
    warmArena(world, matchTuning, next);
    const warmed = arenaOf(matchTuning, next);
    const mesh = navMesh(warmed, matchTuning);
    const drawnAhead = world(next);

    const { before, after } = nextFloor(m, matchTuning);
    m = after;
    // The Arena switches only on the next Floor's first Tick (the Final Blow Shot draws the Floor just ended).
    expect(before.arena).toBe('gen:greybox:12');
    expect(before.duel.arena).toBe('gen:greybox:12');
    expect(m.run!.floor).toBe(2);
    expect(m.arena).toBe(next);
    expect(m.duel.arena).toBe(next);
    // The Floor change read the cache: the very same Arena and navmesh, and the Renderer's world for it.
    expect(arenaOf(matchTuning, m.duel.arena)).toBe(warmed);
    expect(navMesh(arenaOf(matchTuning, m.duel.arena), matchTuning)).toBe(mesh);
    const drawn = world(m.duel.arena);
    expect(drawn).toBe(drawnAhead);
    expect(arenaOf(drawn.tuning, m.duel.arena)).toBe(warmed);
    expect(drawn.layout).toStrictEqual(generateArena(GREYBOX_KIT, 381979, DEFAULT_GEN_PARAMS, tuning).layout);
    // Floor 2, once cleared, warms Floor 3's.
    expect(arenaToWarm(m)).toBeNull();
    expect(arenaToWarm(clear(m, matchTuning))).toBe(nextArenaName(next));
  });

  it('warms nothing on the last Floor or once the Run is over', () => {
    const world = createArenaWorlds(tuning);
    const matchTuning = world('gen:greybox:12').tuning;
    let m = start(matchTuning);
    while (m.run!.floor < m.run!.floors) m = clearFloor(m, matchTuning).after;
    expect(arenaToWarm(m)).toBeNull();
    expect(arenaToWarm(clear(m, matchTuning))).toBeNull();
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 0 ? { ...f, hp: 0 } : f)) } };
    while (m.status.status === 'InProgress') m = stepMatch(m, idle(m), matchTuning);
    expect(arenaToWarm(m)).toBeNull();
  });

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
