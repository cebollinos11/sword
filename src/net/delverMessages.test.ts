/**
 * Peer message validation for a Delver Run (docs/plans/delver.md, Stage 2 follow-up): its Match options, and its state in a resync. A Delver Run is a Gauntlet
 * whose `run` is null, whose `delver` is the Floor's progress, and whose Duel names the Floor (`duel.delver`) in place of a Hall.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, IDLE_INTENT, MAX_TEAM_SIZE, runSeed, stepMatch, takeOverFighter, type MatchState } from '../sim';
import { FLOOR_DIFFICULTY, lineupAis, lineupMatch, type Lineup } from '../controllers';
import { floorArenaName } from '../sim/delver/world';
import { parseNetMessage, PROTOCOL_VERSION } from './messages';

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
  it('is protocol 27', () => {
    expect(PROTOCOL_VERSION).toBe(27);
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
      withRun({ pickups }),
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
});
