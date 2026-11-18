import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attackTimings, DIRECTIONS, isArenaName, MATCH_FORMATS, MAX_TEAM_SIZE, withGeneratedArena } from '../sim';
import { moveMember, newLobby, runTuning, setFormat, startMatch, type LobbyState } from '../lobby';
import { addToSide, arenaLabel, joinSeat, removeFromSide, sideCount, traitorSeat, swingSpeedBars, battleCard, battleKnobRows, battleMapChoice, battleMaps, dungeonCard, formatRefusal, mapSeed, pickableArenas, randomBlurb, randomMap, seedLabel, shownArenas, shownTeams, showsBestOf, withBattleKnob, withBattleMap } from './lobbyView';

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

  it('offers the Format toggle in a Skirmish and online (a Run online is co-op, every Player on Team 0)', () => {
    expect(MATCH_FORMATS).toEqual(['Duels', 'Gauntlet']);
    // Neither a Skirmish nor an online Lobby of one Player refuses either of them.
    expect(formatRefusal(skirmish('library'))).toBeNull();
  });

  it('online, a Lobby with more Players than Team 0 holds refuses the Gauntlet, with the existing text', () => {
    const online = newLobby({ host: { name: 'Host', weapon, body: 'monk' }, settings: { arena: 'library', bestOf: 3 }, online: true, ai: { difficulty: 'Normal', weapon } });
    expect(formatRefusal(online)).toBeNull();
    const seat = (member: number) => ({ kind: 'Player' as const, member });
    const five: LobbyState = {
      ...online,
      members: [0, 1, 2, 3, 4].map((id) => ({ id, name: `P${id}`, weapon, body: 'monk', ready: false })),
      teams: [[seat(0), seat(1), seat(2), seat(3)], [seat(4), { kind: 'Open' }, { kind: 'Closed' }, { kind: 'Closed' }]],
    };
    expect(formatRefusal(five)).toBe(`Switching to a Gauntlet seats every player on Team 0, which holds ${MAX_TEAM_SIZE}; this Lobby has 5.`);
    expect(setFormat(five, 'Gauntlet', 'gen:greybox:5')).toBe(five);
  });

  it('describes the Dungeon on the Floors card: its generated Floors, the Warbands, the fires and the Stairs', () => {
    const floors = tuning.delver.tiers * tuning.delver.floorsPerTier;
    const card = dungeonCard(tuning);
    expect(card.count).toBe(`${floors} Floors`);
    expect(card.note).toMatch(new RegExp(`^A Dungeon of ${floors} generated Floors, past Warbands`));
    expect(card.note).toContain('stand on the Stairs together');
    expect(dungeonCard({ delver: { ...tuning.delver, tiers: 1, floorsPerTier: 1 } }).count).toBe('1 Floor');
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

describe("the Lobby's Battle map picker (docs/plans/battle-objectives.md, Stage 3a)", () => {
  const fort = tuning.battle.maps.fort!;

  it('offers the open field and the Fort; picking a map sets the army size back to its standard', () => {
    expect(battleMaps(tuning).map((m) => m.label)).toEqual(['Open field', 'Fort', 'Ziggurat', 'City', 'Cavern']);
    expect(battleMapChoice(tuning, undefined).id).toBe('open');
    expect(battleMapChoice(tuning, { map: 'fort' }).label).toBe('Fort');
    expect(battleMapChoice(tuning, { map: 'nowhere' }).id).toBe('open');
    expect(withBattleMap({ armySize: 50, hitRate: 0.5 }, 'fort')).toEqual({ map: 'fort', hitRate: 0.5 });
    expect(withBattleMap({ map: 'fort', armySize: 50 }, 'open')).toEqual({});
  });

  it("holds the army size row to the map's most, its standard the map's own, and folds the map into the Battle", () => {
    const [army] = battleKnobRows(tuning, { map: 'fort' });
    expect(army!.standard).toBe(fort.armySize.standard);
    expect(Math.max(...army!.choices.map(([n]) => n))).toBeLessThanOrEqual(fort.armySize.max);
    expect(withBattleKnob({ map: 'fort' }, army!, fort.armySize.standard)).toEqual({ map: 'fort' });
    // The open field keeps its own sizes, 300 among them.
    expect(battleKnobRows(tuning)[0]!.choices.map(([n]) => n)).toContain(300);
    const settings = { arena: 'library', bestOf: 3, format: 'Battle' as const, battle: { map: 'fort', armySize: 300 } };
    expect(runTuning(tuning, settings).battle.armySize).toBe(Math.min(300, fort.armySize.max));
    expect(battleCard(runTuning(tuning, settings), settings.battle).note).toMatch(/ruined fort/);
    expect(battleCard(tuning).note).toMatch(/open field/);
  });
});

describe("the Weapon cards' Speed bar (docs/plans/flail.md, Stage 6)", () => {
  it('shows how fast each Weapon swings: the inverse of its Wind-up plus Release Ticks, the fastest full', () => {
    const bars = swingSpeedBars(tuning);
    expect(Object.keys(bars).sort()).toEqual(Object.keys(tuning.weapons).sort());
    expect(Math.max(...Object.values(bars))).toBe(1);
    // The Flail (`speed` 45, the roster's highest reference Blade Speed) is the slowest to swing: no longer the fullest bar.
    for (const [name, bar] of Object.entries(bars)) if (name !== 'Flail') expect(bars.Flail!, name).toBeLessThan(bar);
    // Its bar is the fastest Weapon's mean Wind-up plus Release Ticks over its own (the Flail swings only Overhead, Left and Right).
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ticks = (name: string) => mean((name === 'Flail' ? (['Overhead', 'Left', 'Right'] as const) : DIRECTIONS).map((d) => attackTimings(tuning, name, d).releaseEnd));
    const fastest = Math.min(...Object.keys(tuning.weapons).map(ticks));
    expect(bars.Flail).toBeCloseTo(fastest / ticks('Flail'), 9);
  });

  it('reads Tempo: a slower Wind-up shortens the bar', () => {
    const sword = tuning.weapons['Arming Sword']!;
    const slowed = { ...tuning, weapons: { ...tuning.weapons, 'Arming Sword': { ...sword, tempo: { ...sword.tempo, windUp: 2 } } } };
    expect(swingSpeedBars(slowed)['Arming Sword']).toBeLessThan(swingSpeedBars(tuning)['Arming Sword']!);
  });
});

describe("the Lobby's sides: how many fight, set with − and +", () => {
  const weapon = Object.keys(tuning.weapons)[0]!;
  const host = { name: 'Host', weapon, body: 'monk' };
  const skirmish = newLobby({ host, settings: { arena: 'library', bestOf: 3 }, online: false, ai: { difficulty: 'Expert', weapon } });
  const room = newLobby({ host, settings: { arena: 'library', bestOf: 3 }, online: true, ai: { difficulty: 'Expert', weapon } });

  it('offline, + adds an AI like the first one, − takes the last AI away but never a Player', () => {
    expect([sideCount(skirmish, 0), sideCount(skirmish, 1)]).toEqual([1, 1]);
    const more = addToSide(tuning, skirmish, 0, false);
    expect(more.teams[0]![1]).toEqual({ kind: 'AI', difficulty: 'Expert', weapon });
    expect(sideCount(more, 0)).toBe(2);
    expect(removeFromSide(more, 0)).toEqual(skirmish);
    expect(removeFromSide(skirmish, 0)).toBe(skirmish);
    const full = [0, 1, 2].reduce((s) => addToSide(tuning, s, 1, false), skirmish);
    expect(sideCount(full, 1)).toBe(MAX_TEAM_SIZE);
    expect(addToSide(tuning, full, 1, false)).toBe(full);
  });

  it('online, + opens a Seat for a player, then adds AIs while that one waits; − closes the last first', () => {
    expect(room.teams[1]!.map((s) => s.kind)).toEqual(['Open', 'Open', 'Closed', 'Closed']);
    const more = addToSide(tuning, room, 1, true);
    expect(more.teams[1]![2]!.kind).toBe('AI');
    expect(removeFromSide(more, 1)).toEqual(room);
  });

  it('in a Battle, where an AI Seat fields nobody, an AI counts as Empty and + never adds one', () => {
    const battle = setFormat(room, 'Battle', randomMap(tuning, 1));
    const withAi: LobbyState = { ...battle, teams: [battle.teams[0]!, battle.teams[1]!.map((s, i) => (i === 3 ? { kind: 'AI' as const, difficulty: 'Expert', weapon } : s))] };
    expect(sideCount(withAi, 1)).toBe(sideCount(battle, 1));
    const offline = setFormat(skirmish, 'Battle', randomMap(tuning, 1));
    expect(addToSide(tuning, offline, 0, false)).toBe(offline);
  });
});

describe("Join: changing sides from the Lobby's sides", () => {
  const weapon = Object.keys(tuning.weapons)[0]!;
  const skirmish = newLobby({ host: { name: 'Host', weapon, body: 'monk' }, settings: { arena: 'library', bestOf: 3 }, online: false, ai: { difficulty: 'Expert', weapon } });

  it('in Duels takes the AI\'s Seat, so the two swap sides', () => {
    expect(joinSeat(skirmish, 1)).toBe(0);
  });

  it("in a Gauntlet, a traitor rejoins the party on an Empty Seat, leaving the party's AI where it is", () => {
    const run = addToSide(tuning, setFormat(skirmish, 'Gauntlet', randomMap(tuning, 1)), 0, false);
    const traitor = moveMember(run, 0, { team: 1, index: traitorSeat(run)! });
    expect(traitor.teams[0]![0]!.kind).not.toBe('Player');
    const back = moveMember(traitor, 0, { team: 0, index: joinSeat(traitor, 0) });
    const ais = (s: LobbyState, team: number) => s.teams[team]!.filter((seat) => seat.kind === 'AI').length;
    expect(back.teams[0]!.some((s) => s.kind === 'Player')).toBe(true);
    expect([ais(back, 0), ais(back, 1)]).toEqual([ais(traitor, 0), ais(traitor, 1)]);
  });
});
