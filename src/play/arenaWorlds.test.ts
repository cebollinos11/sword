import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { arenaOf, createMatch, DEFAULT_GEN_PARAMS, generateArena, GREYBOX_KIT, IDLE_INTENT, stepMatch, type MatchState } from '../sim';
import { createArenaWorlds } from './arenaWorlds';

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
