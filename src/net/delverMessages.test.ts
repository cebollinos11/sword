/**
 * Peer message validation for a Delver Run (docs/plans/delver.md, Stage 2 follow-up): its Match options, and its state in a resync. A Delver Run is a Gauntlet
 * whose `run` is null, whose `delver` is the Floor's progress, and whose Duel names the Floor (`duel.delver`) in place of a Hall.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, MAX_SQUAD_PLACES, MAX_TROOPS, type TuningData } from '../tuning';
import { createMatch, IDLE_INTENT, MAX_TEAM_SIZE, runSeed, stepMatch, takeOverFighter, type MatchState } from '../sim';
import { FLOOR_DIFFICULTY, lineupAis, lineupMatch, type Lineup } from '../controllers';
import { floorArenaName } from '../sim/delver/world';
import { arenaTuning, floorOf, warbandPools, warbandsFit } from '../sim/delver';
import type { CrowdState } from '../sim';
import { PATROL } from '../sim/warband';
import { MAX_FLOOR_TROOPS, parseNetMessage, PROTOCOL_VERSION } from './messages';

const tuning = loadTuningData();
const RUN = 'gen:greybox:4242';
const lineup: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 0, pilot: { kind: 'Player', player: 1 } },
  ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
];
const OPTIONS = { bestOf: 1, arena: RUN, seed: 3, format: 'Gauntlet' as const, delver: true as const };
const hello = (match: unknown) => ({ type: 'hello', protocol: 1, tuningHash: 'abcd1234', match, lineup, weapons: ['Halberd', 'Halberd'], player: 1 });
const resync = (state: unknown, ai: unknown[] = []) => ({ type: 'resync', tick: 40, state, ai, streams: [{ player: 0, from: 38, intents: [IDLE_INTENT, IDLE_INTENT, IDLE_INTENT] }] });

/** A real Delver Run `ticks` Ticks in, with its AIs' memory, as the host would send it in a resync. */
function delverResync(ticks: number): { state: MatchState; ai: unknown[] } {
  const ais = lineupAis(tuning, lineup, 'Gauntlet', OPTIONS);
  let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Halberd', 'Halberd'], OPTIONS));
  for (let t = 0; t < ticks; t++) m = stepMatch(m, lineup.map((s, i) => (s.pilot.kind === 'AI' ? ais[i]!.intent(m.duel, i) : IDLE_INTENT)), tuning);
  return JSON.parse(JSON.stringify({ state: m, ai: ais.map((a) => a?.save?.() ?? null) })) as { state: MatchState; ai: unknown[] };
}

describe('Peer message validation: a Delver Run', () => {
  it('is protocol 29', () => {
    expect(PROTOCOL_VERSION).toBe(29);
  });

  it("accepts a Delver Run's start message, and refuses `delver` that is not true or is not a Gauntlet's", () => {
    for (const match of [OPTIONS, { ...OPTIONS, humans: 2 }]) expect(parseNetMessage(hello(match)), JSON.stringify(match)).toEqual(hello(match));
    for (const match of [
      { ...OPTIONS, format: 'Duels', arena: 'library' },
      { ...OPTIONS, format: undefined },
      { ...OPTIONS, format: 'Duels' },
      { ...OPTIONS, delver: false },
      { ...OPTIONS, delver: 1 },
      { ...OPTIONS, delver: 'yes' },
      { ...OPTIONS, delver: null },
      { bestOf: 1, arena: RUN, delver: true },
    ]) {
      expect(parseNetMessage(hello(match)), JSON.stringify(match)).toBeNull();
    }
  });

  it("carries a Delver Run's state at Tick 0 and some Ticks in through a resync", () => {
    for (const ticks of [0, 1, 40, 200]) {
      const { state, ai } = delverResync(ticks);
      expect(state.run, `run @${ticks}`).toBeNull();
      expect(state.delver).toMatchObject({ floor: 1, phase: 'Exploring' });
      expect(state.duel.delver).toMatchObject({ floor: 1, phase: 'Exploring' });
      expect(state.duel.hall).toBeUndefined();
      const m = resync(state, ai);
      expect(parseNetMessage(m), `@${ticks}`).toEqual(m);
    }
  });

  it("carries a Delver Run's later states: Descending, a deeper Floor, spent fires, pickups and an AI Takeover", () => {
    const { state, ai } = delverResync(10);
    const run = state.delver!;
    const at = { x: 1, y: 0, z: 2 };
    const pickups = [
      { id: 0, owner: null, kind: 'weapon', item: 'Halberd', at, taken: false, by: 0 },
      { id: 1, owner: null, kind: 'relic', item: 'Whetstone', at, taken: true },
    ];
    const second = floorArenaName(runSeed(RUN), 2);
    const withRun = (patch: object, duel: object = {}): MatchState => ({ ...state, delver: { ...run, ...patch }, duel: { ...state.duel, delver: { ...state.duel.delver!, ...duel } } }) as MatchState;
    for (const m of [
      withRun({ phase: 'Descending', stairsTicks: 30 }, { phase: 'Descending' }),
      { ...withRun({ floor: 2 }, { floor: 2 }), arena: second, duel: { ...withRun({ floor: 2 }, { floor: 2 }).duel, arena: second } } as MatchState,
      withRun({ restUsed: [{ revived: true, healed: [0, 1] }, { revived: false, healed: [] }, { revived: false, healed: [1] }] }),
      withRun({ pickups }, { pickups }), // Stage 4: the Duel's mirror must carry the Run's pickups.
    ]) {
      const message = resync(m, ai);
      expect(parseNetMessage(message), JSON.stringify(m.delver).slice(0, 80)).toEqual(message);
    }
    const gone = resync(takeOverFighter(state, 1), ai);
    expect(parseNetMessage(gone)).toEqual(gone);
    expect(takeOverFighter(state, 1).delver!.away).toEqual([1]);
  });

  it('refuses a Delver state with a Run, a Hall, a Duel that does not mirror the Run, or a malformed progress', () => {
    const { state, ai } = delverResync(10);
    const run = state.delver!;
    const pickup = { id: 0, owner: 0, kind: 'relic', item: 'Whetstone', at: { x: 1, y: 0, z: 2 }, taken: false };
    const progress = (patch: object) => ({ ...state, delver: { ...run, ...patch } });
    const duel = (patch: object) => ({ ...state, duel: { ...state.duel, ...patch } });
    const broken: unknown[] = [
      // A Run beside it, a Hall in its Duel, or no Delver at all.
      { ...state, run: { floors: 1, floor: 1, row: 0, hall: 0, path: [{ floor: 1, row: 0, index: 0 }], phase: 'Fighting', doorTicks: [0], rested: [], pickups: [], startTick: 0 } },
      duel({ hall: { floor: 1, row: 0, index: 0, kind: 'Fight', phase: 'Fighting' } }),
      { ...state, delver: undefined },
      { ...state, delver: null },
      duel({ delver: undefined }),
      // The Duel must mirror the Run's Floor, phase and away.
      duel({ delver: { floor: 2, phase: 'Exploring' } }),
      duel({ delver: { floor: 1, phase: 'Descending' } }),
      duel({ delver: { floor: 1, phase: 'Exploring', away: [1] } }),
      { ...progress({ away: [1] }) },
      // ...and be on that Floor's Arena, for the Run's seed.
      { ...state, arena: 'library' },
      { ...state, arena: RUN },
      { ...state, arena: floorArenaName(runSeed(RUN), 2) },
      { ...state, arena: floorArenaName(runSeed(RUN) + 1, 1) },
      duel({ arena: floorArenaName(runSeed(RUN), 2) }),
      // The progress itself.
      progress({ floor: 0 }),
      progress({ floor: run.floors + 1 }),
      progress({ floors: 0 }),
      progress({ floors: 1.5 }),
      progress({ phase: 'Resting' }),
      progress({ phase: 'Cleared' }),
      progress({ stairsTicks: -1 }),
      progress({ stairsTicks: 1.5 }),
      progress({ stairsTicks: 'long' }),
      progress({ restUsed: 'fires' }),
      progress({ restUsed: [{ revived: 'yes', healed: [] }] }),
      progress({ restUsed: [{ revived: false }] }),
      progress({ restUsed: [{ revived: false, healed: [1, 0] }] }),
      progress({ restUsed: [{ revived: false, healed: [0, 0] }] }),
      progress({ restUsed: [{ revived: false, healed: [2] }] }),
      progress({ restUsed: [{ revived: false, healed: [-1] }] }),
      progress({ restUsed: Array.from({ length: 100 }, () => ({ revived: false, healed: [] })) }),
      progress({ pickups: 'loot' }),
      progress({ pickups: undefined }),
      progress({ pickups: [{ ...pickup, id: 1 }] }),
      progress({ pickups: [{ ...pickup, owner: 9 }] }),
      progress({ pickups: [{ ...pickup, owner: 3 }] }),
      progress({ pickups: [{ ...pickup, kind: 'gold' }] }),
      progress({ pickups: Array.from({ length: 300 }, (_, id) => ({ ...pickup, id })) }),
      progress({ startTick: 'then' }),
      progress({ startTick: -1 }),
      progress({ away: [] }),
      progress({ away: [1, 0] }),
      progress({ away: [2] }),
      // The Match config: no Delver Run outside a Gauntlet, and no Rematch.
      { ...state, config: { ...state.config, delver: false } },
      { ...state, config: { ...state.config, format: 'Duels', arena: 'library' } },
      { ...state, config: { ...state.config, rematchTicks: 300 } },
      { ...state, config: { ...state.config, delver: undefined } },
    ];
    for (const bad of broken) expect(parseNetMessage(resync(bad, ai)), JSON.stringify(bad).slice(0, 100)).toBeNull();
  });

  it("carries a Delver Run's wiped Warbands and the pickups its Duel mirrors, and refuses a bad `wiped` or a mirror that differs", () => {
    const { state, ai } = delverResync(10);
    const run = state.delver!;
    const squads = (state.duel.crowd!.squads.team as unknown[]).length;
    expect(squads).toBeGreaterThan(2);
    expect(run.wiped).toEqual([]);
    const at = { x: 1, y: 0, z: 2 };
    const pickups = [
      { id: 0, owner: 0, kind: 'relic', item: 'Whetstone', at, taken: false },
      { id: 1, owner: 1, kind: 'relic', item: 'Whetstone', at, taken: true },
    ];
    const lay = (wiped: unknown, mirror: unknown = pickups, own: unknown = pickups): MatchState =>
      ({ ...state, delver: { ...run, wiped, pickups: own }, duel: { ...state.duel, delver: { ...state.duel.delver!, pickups: mirror } } }) as unknown as MatchState;
    for (const good of [lay([]), lay([0]), lay([0, squads - 1]), lay([1, 2], [], [])]) {
      const message = resync(good, ai);
      expect(parseNetMessage(message), JSON.stringify(good.delver).slice(0, 80)).toEqual(message);
    }
    for (const bad of [
      lay([1, 0]),
      lay([1, 1]),
      lay([-1]),
      lay([1.5]),
      lay(['a']),
      lay(0),
      lay(undefined),
      lay([squads]),
      lay([256]),
      // The mirror must be the Run's pickups, and itself well-formed.
      lay([], []),
      lay([], pickups.slice(0, 1)),
      lay([], [{ ...pickups[0], taken: true }, pickups[1]]),
      lay([], 'loot', 'loot'),
      lay([], [{ ...pickups[0], id: 1 }], [{ ...pickups[0], id: 1 }]),
      lay([], null),
    ]) {
      expect(parseNetMessage(resync(bad, ai)), JSON.stringify([bad.delver!.wiped, bad.duel.delver!.pickups, bad.delver!.pickups])).toBeNull();
    }
  });

  it('refuses a Delver mark on a Match that is not one: a Duels state, and a Hall-graph Run', () => {
    const { state } = delverResync(10);
    const duels = JSON.parse(JSON.stringify(createMatch(tuning, { bestOf: 3, seed: 3 }))) as MatchState;
    expect(parseNetMessage(resync(duels))).not.toBeNull();
    expect(parseNetMessage(resync({ ...duels, delver: state.delver }))).toBeNull();
    expect(parseNetMessage(resync({ ...duels, duel: { ...duels.duel, delver: state.duel.delver } }))).toBeNull();
    const halls = JSON.parse(JSON.stringify(createMatch(tuning, lineupMatch(tuning, lineup, ['Halberd', 'Halberd'], { ...OPTIONS, delver: undefined })))) as MatchState;
    expect(halls.run).not.toBeNull();
    expect(parseNetMessage(resync(halls, lineupAis(tuning, lineup, 'Gauntlet', OPTIONS).map((a) => a?.save?.() ?? null)))).not.toBeNull();
    expect(parseNetMessage(resync({ ...halls, delver: state.delver }, []))).toBeNull();
    expect(parseNetMessage(resync({ ...halls, duel: { ...halls.duel, delver: state.duel.delver } }, []))).toBeNull();
  });

  it("carries a Delver Run's Floor with Warbands, and refuses a malformed Crowd or Pool", () => {
    const { state, ai } = delverResync(10);
    const crowd = state.duel.crowd!;
    expect(crowd.warbands, 'the Floor has Warbands').toBeDefined();
    expect(crowd.warbands!.mode.length).toBeGreaterThan(1);
    expect(state.duel.fighters.length).toBeGreaterThan(state.config.teams.length);
    const message = resync(state, ai);
    expect(parseNetMessage(message)).toEqual(message);
    const crowdOf = (patch: object): MatchState => ({ ...state, duel: { ...state.duel, crowd: { ...crowd, ...patch } } }) as MatchState;
    const warbands = (patch: object): MatchState => crowdOf({ warbands: { ...crowd.warbands!, ...patch } });
    const n = crowd.warbands!.mode.length;
    const soldier = { index: 0, since: 0, role: 'Attack' as const };
    const withFighter = (k: number, patch: object, slot: Record<number, number> = {}): MatchState => {
      const slots = crowd.slot.slice();
      for (const [s, v] of Object.entries(slot)) slots[Number(s)] = v;
      return { ...state, duel: { ...state.duel, crowd: { ...crowd, slot: slots }, fighters: state.duel.fighters.map((f, i) => (i === k ? { ...f, ...patch } : f)) } } as MatchState;
    };
    const k = state.config.teams.length;
    // A bound Pool slot is fine (Soldier 0 is in slot k, and back).
    const bound = withFighter(k, { soldier }, { 0: k });
    expect(parseNetMessage(resync(bound, ai)), 'a Soldier promoted into a Pool slot').not.toBeNull();
    const { crowd: _crowd, ...bare } = state.duel;
    const battleCrowd = { ...crowd, warbands: undefined, maxHp: undefined, objectives: { progress: [0], owner: [-1] }, players: [] };
    const broken: [string, unknown][] = [
      ['no Crowd', { ...state, duel: bare }],
      ['no warbands', crowdOf({ warbands: undefined })],
      ['no maxHp', crowdOf({ maxHp: undefined })],
      ['a Battle Crowd', crowdOf(battleCrowd)],
      ['a bad mode', warbands({ mode: crowd.warbands!.mode.map((m, q) => (q === 0 ? 4 : m)) })],
      ['a fractional mode', warbands({ mode: crowd.warbands!.mode.map((m, q) => (q === 0 ? 0.5 : m)) })],
      ['post and patrol both -1', warbands({ post: crowd.warbands!.post.map((p, q) => (q === 0 ? -1 : p)), patrol: crowd.warbands!.patrol.map((p, q) => (q === 0 ? -1 : p)) })],
      ['post and patrol both set', warbands({ post: crowd.warbands!.post.map((p, q) => (q === 0 ? 0 : p)), patrol: crowd.warbands!.patrol.map((p, q) => (q === 0 ? 0 : p)) })],
      ['a negative leg', warbands({ leg: crowd.warbands!.leg.map((l, q) => (q === 0 ? -1 : l)) })],
      ['a chased past the party', warbands({ chased: crowd.warbands!.chased.map((c, q) => (q === 0 ? 4 : c)) })],
      ['a seen below -1', warbands({ seen: crowd.warbands!.seen.map((c, q) => (q === 0 ? -2 : c)) })],
      ['a size of 0', warbands({ size: crowd.warbands!.size.map((c, q) => (q === 0 ? 0 : c)) })],
      ['a size past a Formation', warbands({ size: crowd.warbands!.size.map((c, q) => (q === 0 ? MAX_SQUAD_PLACES + 1 : c)) })],
      ['a negative encounter', warbands({ encounter: crowd.warbands!.encounter.map((c, q) => (q === 0 ? -1 : c)) })],
      ['a short array', warbands({ size: crowd.warbands!.size.slice(1) })],
      ['a short mode', warbands({ mode: crowd.warbands!.mode.slice(0, n - 1) })],
      ['a maxHp of the wrong length', crowdOf({ maxHp: crowd.maxHp!.slice(1) })],
      ['a maxHp of 0', crowdOf({ maxHp: crowd.maxHp!.map((h, s) => (s === 0 ? 0 : h)) })],
      ['a Rout', crowdOf({ rout: { team: 1, tick: 5 } })],
      ['tickets', crowdOf({ tickets: [1, 0] })],
      ['a Player record', crowdOf({ players: [{ soldier: -1, taken: 0, kills: 0, corpse: -1 }] })],
      ['an Objective', crowdOf({ objectives: { progress: [0], owner: [-1] } })],
      ['a Team 0 Squad', crowdOf({ squads: { ...crowd.squads, team: crowd.squads.team.map((t, q) => (q === 0 ? 0 : t)) } })],
      ['a bound party slot', withFighter(0, { soldier }, { 0: 0 })],
      ['a bound party slot, one side', withFighter(0, { soldier })],
      ['a Soldier pointing at an unbound slot', withFighter(k, {}, { 0: k })],
      ['a Soldier pointing at the wrong slot', withFighter(k, { soldier }, { 0: k + 1 })],
      ['a slot bound to no Soldier', withFighter(k, { soldier })],
      ['a Pool as small as the party', { ...state, duel: { ...state.duel, fighters: state.duel.fighters.slice(0, k) } }],
      ['a Pool past 64', { ...state, duel: { ...state.duel, fighters: [...state.duel.fighters, ...Array.from({ length: 70 }, () => state.duel.fighters[k])] } }],
      ['a Team 1 in the party', { ...state, config: { ...state.config, teams: state.config.teams.map((t, i) => (i === 0 ? 1 : t)) } }],
    ];
    for (const [name, bad] of broken) expect(parseNetMessage(resync(bad, ai)), name).toBeNull();
  });

  it("refuses a Floor Crowd on a Battle state (and on any other Format's)", () => {
    const { state } = delverResync(10);
    const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
    const two: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, { team: 1, pilot: { kind: 'Player', player: 1 } }];
    const battle = JSON.parse(JSON.stringify(createMatch(small, lineupMatch(small, two, ['Halberd', 'Halberd'], { format: 'Battle', bestOf: 1, seed: 5 })))) as MatchState;
    expect(battle.duel.crowd, 'a Battle has a Crowd').toBeDefined();
    expect(parseNetMessage(resync(battle))).not.toBeNull();
    const floorCrowd = state.duel.crowd!;
    expect(parseNetMessage(resync({ ...battle, duel: { ...battle.duel, crowd: floorCrowd } }))).toBeNull();
    expect(parseNetMessage(resync({ ...battle, duel: { ...battle.duel, crowd: { ...battle.duel.crowd!, warbands: floorCrowd.warbands } } }))).toBeNull();
    // ...and no other Format has a Crowd.
    const duels = JSON.parse(JSON.stringify(createMatch(tuning, { bestOf: 3, seed: 3 }))) as MatchState;
    expect(parseNetMessage(resync({ ...duels, duel: { ...duels.duel, crowd: floorCrowd } }))).toBeNull();
  });
});

describe("a Floor's Warbands against its plan (a resync's check)", () => {
  const { state } = delverResync(0);
  const crowd = state.duel.crowd!;
  const plan = floorOf(tuning, state.duel.arena)!.plan;
  const party = state.config.teams.length;
  const troops = arenaTuning(tuning, state.duel.arena).battle.troops.length;
  const pools = warbandPools(tuning.delver, 1);
  const fits = (c: CrowdState) => warbandsFit(c, plan, party, troops, pools);
  const w = crowd.warbands!;
  const guard = w.post.findIndex((p) => p >= 0);
  const patrol = w.patrol.findIndex((p) => p >= 0);
  /** The Crowd with Warband `q`'s array `key` set to `v` there. */
  const warband = (key: keyof typeof w, q: number, v: number): CrowdState => ({ ...crowd, warbands: { ...w, [key]: w[key].map((e, k) => (k === q ? v : e)) } });

  it('accepts the state a Floor deals', () => {
    expect(guard, 'a guard stands').toBeGreaterThanOrEqual(0);
    expect(patrol, 'a patrol walks').toBeGreaterThanOrEqual(0);
    expect(fits(crowd)).toBe(true);
  });

  it('refuses a post, loop, leg, mode, quarry, Squad or Troop that names nothing', () => {
    const points = (q: number) => plan.markers.patrols[w.patrol[q]!]!.points.length;
    expect(fits(warband('post', guard, plan.markers.posts.length))).toBe(false);
    expect(fits(warband('patrol', patrol, plan.markers.patrols.length))).toBe(false);
    expect(fits(warband('leg', patrol, points(patrol)))).toBe(false);
    expect(fits(warband('leg', patrol, -1))).toBe(false);
    expect(fits(warband('leg', guard, 1))).toBe(false);
    expect(fits(warband('mode', guard, PATROL))).toBe(false);
    expect(fits(warband('mode', patrol, 4))).toBe(false);
    expect(fits(warband('chased', patrol, party))).toBe(false);
    expect(fits(warband('chased', patrol, -2))).toBe(false);
    expect(fits(warband('chased', patrol, party - 1))).toBe(true);
    expect(fits({ ...crowd, squad: crowd.squad.map((q, i) => (i === 0 ? crowd.squads.team.length : q)) })).toBe(false);
    expect(fits({ ...crowd, troop: crowd.troop.map((t, i) => (i === 0 ? troops : t)) })).toBe(false);
    expect(fits({ ...crowd, warbands: { ...w, mode: w.mode.slice(1) } })).toBe(false);
  });
});

describe('a Floor Crowd\'s Troops and ranks', () => {
  const { state, ai } = delverResync(10);
  const crowd = state.duel.crowd!;
  const withCrowd = (patch: object): MatchState => ({ ...state, duel: { ...state.duel, crowd: { ...crowd, ...patch } } }) as MatchState;
  const withRank = (rank: unknown): MatchState => withCrowd({ warbands: { ...crowd.warbands!, rank } });

  it('accepts a Troop index of a Floor Troop past the Battles\' 8, and refuses one at MAX_FLOOR_TROOPS or beyond', () => {
    expect(MAX_TROOPS).toBe(8);
    for (const troop of [MAX_TROOPS, MAX_TROOPS + 3, MAX_FLOOR_TROOPS - 1]) expect(parseNetMessage(resync(withCrowd({ troop: crowd.troop.map((t, s) => (s === 0 ? troop : t)) }), ai)), `troop ${troop}`).not.toBeNull();
    for (const troop of [MAX_FLOOR_TROOPS, -1, 1.5]) expect(parseNetMessage(resync(withCrowd({ troop: crowd.troop.map((t, s) => (s === 0 ? troop : t)) }), ai)), `troop ${troop}`).toBeNull();
  });

  it('keeps a Battle Crowd to the Battles\' MAX_TROOPS', () => {
    const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
    const two: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, { team: 1, pilot: { kind: 'Player', player: 1 } }];
    const battle = JSON.parse(JSON.stringify(createMatch(small, lineupMatch(small, two, ['Halberd', 'Halberd'], { format: 'Battle', bestOf: 1, seed: 5 })))) as MatchState;
    const troop = (v: number): MatchState => ({ ...battle, duel: { ...battle.duel, crowd: { ...battle.duel.crowd!, troop: battle.duel.crowd!.troop.map((t, s) => (s === 0 ? v : t)) } } }) as MatchState;
    expect(parseNetMessage(resync(troop(MAX_TROOPS - 1)))).not.toBeNull();
    expect(parseNetMessage(resync(troop(MAX_TROOPS)))).toBeNull();
  });

  it('accepts the ranks 0 to 2 and refuses a rank that is missing, short, fractional or out of range', () => {
    const rank = crowd.warbands!.rank;
    expect(rank.length).toBe(crowd.warbands!.mode.length);
    for (const v of [0, 1, 2]) expect(parseNetMessage(resync(withRank(rank.map((r, q) => (q === 0 ? v : r))), ai)), `rank ${v}`).not.toBeNull();
    for (const v of [3, -1, 0.5]) expect(parseNetMessage(resync(withRank(rank.map((r, q) => (q === 0 ? v : r))), ai)), `rank ${v}`).toBeNull();
    expect(parseNetMessage(resync(withRank(undefined), ai))).toBeNull();
    expect(parseNetMessage(resync(withRank(rank.slice(1)), ai))).toBeNull();
    expect(parseNetMessage(resync(withRank(rank.concat(0)), ai))).toBeNull();
  });
});
