import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaTuning, floorArenaName, floorOf, parseFloorArena } from '../sim/delver';
import { arenaOf, createMatch, DEFAULT_GEN_PARAMS, exitDoor, generateArena, GREYBOX_KIT, hallBehind, hallOf, IDLE_INTENT, inDuel, MAX_TEAM_SIZE, navMesh, parseGeneratedName, runSeed, stepMatch, type MatchState } from '../sim';
import { arenasToWarm, arenaToWarm, createArenaWorlds, warmArena, warmingWaits } from './arenaWorlds';
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

describe('the Arena worlds across a Run’s Hall change', () => {
  const tuning = loadTuningData();
  const idle = (m: MatchState) => m.duel.fighters.map(() => IDLE_INTENT);
  /** A Run on `gen:greybox:12`, Team 0 one Fighter. */
  const start = (matchTuning: typeof tuning) => createMatch(matchTuning, { format: 'Gauntlet', arena: 'gen:greybox:12', bestOf: 1, teams: [0, 1, 1, 1, 1] });
  /** Fell every enemy and step once: the Hall is Cleared. */
  function clear(m: MatchState, matchTuning: typeof tuning): MatchState {
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
    return stepMatch(m, idle(m), matchTuning);
  }
  /** Clear the Hall if need be, then stand Fighter 0 in exit `exit`'s zone until the party takes it (the fade has begun). */
  function takeDoor(m: MatchState, matchTuning: typeof tuning, exit = 0): MatchState {
    if (m.run!.phase === 'Fighting') m = clear(m, matchTuning);
    expect(arenaToWarm(m, matchTuning)).toBeNull();
    const zone = arenaOf(matchTuning, m.arena).doors[exitDoor(exit)]!.zone;
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

  it('once the Hall is Cleared and the Final Blow Shot is over, warms every exit; the Hall change reads them whichever Door is taken', () => {
    const exits = hallOf(tuning, 'gen:greybox:12', { floor: 1, row: 0, index: 0 }).exits;
    expect(exits.length).toBeGreaterThan(1);
    for (const exit of exits.keys()) {
      const world = createArenaWorlds(tuning);
      const matchTuning = world('gen:greybox:12').tuning;
      let m = start(matchTuning);
      // Nothing while the Hall is fought.
      expect(arenasToWarm(m, matchTuning)).toEqual([]);
      m = clear(m, matchTuning);
      expect(m.run!.phase).toBe('Cleared');
      const names = exits.map((_, k) => hallOf(matchTuning, 'gen:greybox:12', hallBehind(matchTuning, m.config, m.run!, k)!).arena);
      expect(new Set(names).size).toBe(exits.length);
      expect(arenasToWarm(m, matchTuning)).toEqual(names);
      // The game waits for the Final Blow Shot, and builds as soon as it is over.
      expect(warmingWaits(m, true)).toBe(true);
      expect(warmingWaits(m, false)).toBe(false);
      for (const name of arenasToWarm(m, matchTuning)) warmArena(world, matchTuning, name);
      const ahead = names.map((name) => ({ arena: arenaOf(matchTuning, name), world: world(name) }));
      const meshes = ahead.map((a) => navMesh(a.arena, matchTuning));

      m = takeDoor(m, matchTuning, exit);
      expect(m.run!.phase).toBe('Leaving');
      // While Leaving, the taken Door's Hall comes first.
      expect(arenasToWarm(m, matchTuning)[0]).toBe(names[exit]);
      while (m.duelNumber === 1) m = stepMatch(m, idle(m), matchTuning);
      expect(m.arena).toBe(names[exit]);
      expect(arenaOf(matchTuning, m.duel.arena)).toBe(ahead[exit]!.arena);
      expect(navMesh(arenaOf(matchTuning, m.duel.arena), matchTuning)).toBe(meshes[exit]);
      expect(world(m.duel.arena)).toBe(ahead[exit]!.world);
      // The new Hall is fought: nothing more to build until it is cleared.
      expect(arenasToWarm(m, matchTuning)).toEqual([]);
    }
  });

  it('keeps the Hall being drawn while its exits are warmed after it', () => {
    const world = createArenaWorlds(tuning);
    const hall = world('gen:greybox:7:d4');
    for (let seed = 100; seed < 112; seed++) {
      world(`gen:greybox:${seed}:d2`);
      // The Renderer asks for the Hall it draws every frame.
      expect(world('gen:greybox:7:d4')).toBe(hall);
    }
  });

  it('warms nothing once the Run is over', () => {
    const matchTuning = createArenaWorlds(tuning)('gen:greybox:12').tuning;
    let m = start(matchTuning);
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 0 ? { ...f, hp: 0 } : f)) } };
    while (m.status.status === 'InProgress') m = stepMatch(m, idle(m), matchTuning);
    expect(arenaToWarm(m, matchTuning)).toBeNull();
    expect(arenasToWarm(m, matchTuning)).toEqual([]);
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

describe('the Arena worlds across a Delver Run’s Floor change', () => {
  const base = flatFloors(loadTuningData());
  /** A short Run: one tier of three Floors. */
  const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
  const ARENA = 'gen:greybox:4242';
  const seed = runSeed(ARENA);
  const start = () => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
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
    expect(arenasToWarm(m, tuning)).toEqual([next]);
    expect(arenaToWarm(m, tuning)).toBe(next);
    m = stepMatch(m, idle(m), tuning);
    expect(arenasToWarm(m, tuning)).toEqual([next]);
    // Descending (the fade): still the next Floor's, until the Floor changes.
    const fading: MatchState = { ...m, nextDuelTick: m.tick + 2, delver: { ...m.delver!, phase: 'Descending' } };
    expect(arenasToWarm(fading, tuning)).toEqual([next]);
    const two: MatchState = { ...m, delver: { ...m.delver!, floor: 2 } };
    expect(arenasToWarm(two, tuning)).toEqual([floorArenaName(seed, 3)]);
    const last: MatchState = { ...m, delver: { ...m.delver!, floor: m.delver!.floors } };
    expect(arenasToWarm(last, tuning)).toEqual([]);
    expect(arenaToWarm(last, tuning)).toBeNull();
    const over: MatchState = { ...m, status: { status: 'Over', winner: 1, tick: m.tick } };
    expect(arenasToWarm(over, tuning)).toEqual([]);
  });

  it('never waits for the Final Blow Shot to build ahead', () => {
    const m = start();
    expect(warmingWaits(m, true)).toBe(false);
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
