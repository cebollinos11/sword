import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, DEFAULT_GEN_PARAMS, exitDoor, generateArena, GREYBOX_KIT, hallBehind, hallOf, IDLE_INTENT, inDuel, navMesh, parseGeneratedName, stepMatch, type MatchState } from '../sim';
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

describe('the Arena worlds across a Run’s Hall change', () => {
  const tuning = loadTuningData();
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  /** A Run on `gen:greybox:12`, Team 0 one Fighter. */
  const start = (matchTuning: typeof tuning) => createMatch(matchTuning, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
  /** Fell every enemy, then stand Fighter 0 in exit 0's zone until the party takes it (the fade has begun). */
  function takeDoor(m: MatchState, matchTuning: typeof tuning): MatchState {
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
    m = stepMatch(m, idle(m), matchTuning);
    expect(arenaToWarm(m, matchTuning)).toBeNull();
    const zone = arenaOf(matchTuning, m.arena).doors[exitDoor(0)]!.zone;
    const at = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
    while (m.run!.phase === 'Cleared') {
      m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: at, y: zone[0]!.y } : f)) } };
      m = stepMatch(m, idle(m), matchTuning);
    }
    return m;
  }

  it('warms the next Hall’s Arena once a Door is taken; the Hall change only reads it, and the Renderer draws the same geometry', () => {
    const world = createArenaWorlds(tuning);
    const matchTuning = world('gen:greybox:12').tuning;
    let m = start(matchTuning);
    const first = m.arena;
    // While the Hall is fought, and once it is cleared, nothing to build; once a Door is taken, the Hall behind it.
    expect(arenaToWarm(m, matchTuning)).toBeNull();
    m = takeDoor(m, matchTuning);
    expect(m.run!.phase).toBe('Leaving');
    const next = hallOf(matchTuning, 'gen:greybox:12', hallBehind(matchTuning, m.config, m.run!, 0)!).arena;
    expect(arenaToWarm(m, matchTuning)).toBe(next);
    warmArena(world, matchTuning, next);
    const warmed = arenaOf(matchTuning, next);
    const mesh = navMesh(warmed, matchTuning);
    const drawnAhead = world(next);

    let before = m;
    while (m.duelNumber === 1) {
      before = m;
      m = stepMatch(m, idle(m), matchTuning);
    }
    // The Arena switches only on the next Hall's first Tick (the fade draws the Hall just left).
    expect([before.arena, before.duel.arena]).toEqual([first, first]);
    expect(m.run!.row).toBe(1);
    expect([m.arena, m.duel.arena]).toEqual([next, next]);
    // The Hall change read the cache: the very same Arena and navmesh, and the Renderer's world for it.
    expect(arenaOf(matchTuning, m.duel.arena)).toBe(warmed);
    expect(navMesh(arenaOf(matchTuning, m.duel.arena), matchTuning)).toBe(mesh);
    const drawn = world(m.duel.arena);
    expect(drawn).toBe(drawnAhead);
    expect(arenaOf(drawn.tuning, m.duel.arena)).toBe(warmed);
    const { seed, doors } = parseGeneratedName(next)!;
    expect(drawn.layout).toStrictEqual(generateArena(GREYBOX_KIT, seed, { ...DEFAULT_GEN_PARAMS, doors }, tuning).layout);
    expect(arenaToWarm(m, matchTuning)).toBeNull();
  });

  it('warms nothing once the Run is over', () => {
    const matchTuning = createArenaWorlds(tuning)('gen:greybox:12').tuning;
    let m = start(matchTuning);
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 0 ? { ...f, hp: 0 } : f)) } };
    while (m.status.status === 'InProgress') m = stepMatch(m, idle(m), matchTuning);
    expect(arenaToWarm(m, matchTuning)).toBeNull();
  });

  it('in Duels warms only a Rematch’s next Random Map, while the result shows', () => {
    const matchTuning = createArenaWorlds(tuning)('gen:greybox:12').tuning;
    const m = createMatch(matchTuning, { arena: 'gen:greybox:12', bestOf: 1, rematchTicks: 3 });
    expect(arenaToWarm(m, matchTuning)).toBeNull();
    const over: MatchState = { ...m, status: { status: 'Over', winner: 0, tick: 0 } };
    expect(arenaToWarm(over, matchTuning)).toBe('gen:greybox:381979');
    expect(arenaToWarm({ ...over, config: { ...over.config, rematchTicks: null } }, matchTuning)).toBeNull();
    const library = createMatch(tuning, { arena: 'library', bestOf: 1, rematchTicks: 3 });
    expect(arenaToWarm({ ...library, status: { status: 'Over', winner: 0, tick: 0 } }, tuning)).toBeNull();
  });
});
