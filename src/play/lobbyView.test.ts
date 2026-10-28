import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { isArenaName, withGeneratedArena } from '../sim';
import { newLobby, setFormat, startMatch, type LobbyState } from '../lobby';
import { arenaLabel, dungeonCard, mapSeed, offeredFormats, pickableArenas, randomBlurb, randomMap, seedLabel, shownArenas, shownTeams, showsBestOf } from './lobbyView';

const tuning = loadTuningData();

describe('the Random Map entry', () => {
  it('names a Generated Arena of the one Kit from the seed the host picked, which every peer can build', () => {
    expect(randomMap(tuning, 1234)).toBe('gen:greybox:1234');
    expect(isArenaName(tuning, randomMap(tuning, 1234))).toBe(true);
    expect(withGeneratedArena(tuning, randomMap(tuning, 5)).layout).toBeDefined();
  });

  it('shows the seed, so a good map can be played again', () => {
    expect(arenaLabel('gen:greybox:1234')).toBe('Random · seed 1234');
    expect(mapSeed('gen:greybox:1234')).toBe(1234);
    expect(mapSeed('library')).toBeNull();
    expect(arenaLabel('library')).toBe('Library');
  });
});

describe('the Lobby view in Gauntlet', () => {
  const weapon = Object.keys(tuning.weapons)[0]!;
  const skirmish = (arena: string): LobbyState =>
    newLobby({ host: { name: 'Host', weapon, body: 'monk' }, settings: { arena, bestOf: 3 }, online: false, ai: { difficulty: 'Normal', weapon } });

  it('offers the Format toggle in a Skirmish only: online stays Duels until the Dungeon\'s co-op (docs/plans/dungeon.md Stage 4)', () => {
    expect(offeredFormats(false)).toEqual(['Duels', 'Gauntlet']);
    expect(offeredFormats(true)).toEqual(['Duels']);
  });

  it('describes the Dungeon on the Floors card: its Floors of Halls, the Doors and the Boss', () => {
    expect(tuning.dungeon.floors).toHaveLength(3);
    const card = dungeonCard(tuning);
    expect(card.count).toBe('3 Floors of Halls');
    expect(card.note).toMatch(/^A Dungeon of 3 Floors, each a map of Halls from an entrance to a Boss\. /);
    expect(card.note).toContain('stand at a Door together');
    expect(dungeonCard({ dungeon: { ...tuning.dungeon, floors: tuning.dungeon.floors.slice(0, 1) } }).count).toBe('1 Floor of Halls');
  });

  it('in Duels shows both teams, every Map, Best of N and the next seed', () => {
    const s = skirmish('gen:greybox:42');
    expect(shownTeams(s)).toEqual([0, 1]);
    expect(shownArenas(tuning, s)).toEqual(pickableArenas(tuning));
    expect(showsBestOf(s)).toBe(true);
    expect(randomBlurb(s, null, false)).toBe('Next: seed 42');
    expect(seedLabel(s)).toBe('Next seed');
  });

  it('in Gauntlet hides Team 1, the hand-made Maps and Best of N, and the Random card reads "Run seed N"', () => {
    const s = setFormat(skirmish('library'), 'Gauntlet', randomMap(tuning, 1234));
    expect(shownTeams(s)).toEqual([0]);
    expect(shownArenas(tuning, s)).toEqual([]);
    expect(showsBestOf(s)).toBe(false);
    expect(randomBlurb(s, null, false)).toBe('Run seed 1234');
    expect(randomBlurb(s, null, true)).toBe('Run seed 1234 · pick again to reroll');
    expect(seedLabel(s)).toBe('Run seed');
    // After a Run, the next Run is on the next seed.
    const after = startMatch(s);
    expect(randomBlurb(after, 'gen:greybox:1234', false)).toBe(`Run seed ${mapSeed('gen:greybox:' + ((1234 + 381967) % 1000000))}`);
  });
});
