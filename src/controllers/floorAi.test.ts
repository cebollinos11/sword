import { describe, expect, it } from 'vitest';
import { loadTuningData, RANDOM_PICK, type TuningData } from '../tuning';
import { arenaOf, createMatch, exitDoor, hallBehind, hallOf, hallRoster, hashValue, IDLE_INTENT, inDuel, stepMatch, type Intent, type MatchState, type SimState } from '../sim';
import { createAiController } from './ai';
import { controllerIntents, type Controller } from './controller';
import { createFloorAi } from './floorAi';
import { lineupAis, type Lineup } from './lineup';

const tuning = loadTuningData();
/** The Run's first Arena. */
const ARENA = 'gen:greybox:77';
const LINEUP: Lineup = [0, 0, 1, 1, 1, 1].map((team) => ({ team, pilot: { kind: 'AI', difficulty: 'Hard' } }));

/** The Run's first exit whose Hall holds an enemy for Team 1's first slot (so the next Hall has someone for the Floor AI to play). */
function fightExit(m: MatchState): number {
  const run = m.run!;
  return hallOf(tuning, ARENA, { floor: 1, row: 0, index: 0 }).exits.findIndex((_, exit) => hallRoster(tuning, m.config, hallBehind(tuning, m.config, run, exit)!)[0] !== null);
}

/**
 * The Duel states a Run's Controllers are asked on, Tick by Tick: `before` Ticks of the first Hall, then every enemy
 * felled and the party put in an exit Door's zone until the next Hall, and `after` Ticks of it. Driven by the Lineup's own
 * AIs (Hard allies, Floor AIs).
 */
function runStates(before: number, after: number): SimState[] {
  const controllers = lineupAis(tuning, LINEUP, 'Gauntlet', { arena: ARENA }) as Controller[];
  let m: MatchState = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 5, arena: ARENA, teams: LINEUP.map((s) => s.team), humans: 2, players: [0, 1] });
  const exit = fightExit(m);
  const states: SimState[] = [];
  const advance = () => {
    if (m.run!.phase === 'Cleared') {
      const zone = arenaOf(tuning, m.arena).doors[exitDoor(exit)]!.zone;
      const c = { x: zone.reduce((s, p) => s + p.x, 0) / zone.length, z: zone.reduce((s, p) => s + p.z, 0) / zone.length };
      m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i < 2 ? { ...f, position: { x: c.x + (i - 0.5), z: c.z }, y: zone[0]!.y } : f)) } };
    }
    states.push(m.duel);
    m = stepMatch(m, controllerIntents(m.duel, controllers), tuning);
  };
  for (let k = 0; k < before; k++) advance();
  m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
  while (m.run!.row === 0) advance();
  for (let k = 0; k < after; k++) advance();
  return states;
}

const states = runStates(150, 150);
const change = states.findIndex((s) => s.hall!.row === 1);
/** Team 1's first slot is Fighter 2. */
const ENEMY = 2;

/** Feed `ai` the states from `from` on, collecting its Intents (as hashes) and its memory before each. */
function drive(ai: Controller, from = 0): { intents: string[]; saves: unknown[] } {
  const intents: string[] = [];
  const saves: unknown[] = [];
  for (const s of states.slice(from)) {
    saves.push(ai.save!());
    intents.push(hashValue(ai.intent(s, ENEMY)));
  }
  return { intents, saves };
}

describe('Floor AI', { timeout: 60_000 }, () => {
  it('plays its slot in the first Hall (it Attacks, moves) and a Benched slot asks for nothing', () => {
    expect(change).toBeGreaterThan(150);
    const { intents } = drive(createFloorAi(tuning, 0, ARENA));
    expect(intents.slice(0, change).some((h) => h !== hashValue(IDLE_INTENT))).toBe(true);
    // Floor 1's Encounters leave the last slot (Fighter 5) Benched against a Team 0 of two.
    expect(states[0]!.fighters[5]!.benched).toBe(true);
    const benched = createFloorAi(tuning, 3, ARENA);
    expect(states.slice(0, change).every((s) => hashValue(benched.intent(s, 5)) === hashValue(IDLE_INTENT))).toBe(true);
  });

  it('starts each Hall from fresh memory: after a Hall change it acts as a Floor AI that only ever saw that Hall', () => {
    const seasoned = drive(createFloorAi(tuning, 0, ARENA));
    const fresh = drive(createFloorAi(tuning, 0, ARENA), change);
    expect(seasoned.intents.slice(change)).toEqual(fresh.intents);
    expect(hashValue(seasoned.saves.at(-1))).toBe(hashValue(fresh.saves.at(-1)));
    expect(seasoned.saves[change]).toMatchObject({ hall: '1:0:0' });
    expect(seasoned.saves[change + 1]).toMatchObject({ hall: `1:1:${states[change]!.hall!.index}` });
    // Even what a new Duel alone would not clear (the aim it rolled for a throw) is gone in the next Hall.
    const saved = seasoned.saves[change] as { hall: string; memory: { aimError: number } };
    const carrying = createFloorAi(tuning, 0, ARENA);
    carrying.load!({ ...saved, memory: { ...saved.memory, aimError: 0.2 } });
    expect(drive(carrying, change).saves.slice(1).map((m) => hashValue(m))).toEqual(fresh.saves.slice(1).map((m) => hashValue(m)));
  });

  it('save/load across a Hall change gives the same Intents (Rollback, resync)', () => {
    const ai = createFloorAi(tuning, 0, ARENA);
    const first = drive(ai);
    // Roll the same Controller back from the second Hall to before the change, and replay.
    for (const at of [change - 40, change - 1, change, change + 30]) {
      ai.load!(first.saves[at]);
      expect(drive(ai, at).intents, `rolled back to state ${at}`).toEqual(first.intents.slice(at));
      // A fresh Controller loading the same memory (a resync) does the same.
      const other = createFloorAi(tuning, 0, ARENA);
      other.load!(first.saves[at]);
      expect(drive(other, at).intents, `loaded at state ${at}`).toEqual(first.intents.slice(at));
    }
    // Its memory survives a JSON round trip, as a resync sends it.
    const resynced = createFloorAi(tuning, 0, ARENA);
    resynced.load!(JSON.parse(JSON.stringify(first.saves[change + 30])));
    expect(drive(resynced, change + 30).intents).toEqual(first.intents.slice(change + 30));
  });

  it("plays its Hall's Encounter's Style: a named one, or a random one picked from the Run's first Arena (the Run seed)", () => {
    const withStyle = (style: string): TuningData => {
      const [first, ...rest] = tuning.dungeon.floors;
      const fights = first!.encounters.Fight.map((e) => ({ enemies: e.enemies.map((x, k) => (k === 0 ? { ...x, style } : x)) }));
      return { ...tuning, dungeon: { ...tuning.dungeon, floors: [{ ...first!, encounters: { ...first!.encounters, Fight: fights } }, ...rest] } };
    };
    const hall1 = (ai: Controller) => states.slice(0, change).map((s) => hashValue(ai.intent(s, ENEMY)));
    const at = { floor: 1, row: 0, index: 0 };
    const aggressive = withStyle('Aggressive');
    const difficulty = hallRoster(tuning, { arena: ARENA, humans: 1 }, at)[0]!.difficulty;
    expect(hall1(createFloorAi(aggressive, 0, ARENA))).toEqual(hall1(createAiController(aggressive, difficulty, 'Aggressive')));
    expect(hall1(createFloorAi(aggressive, 0, ARENA))).not.toEqual(hall1(createAiController(aggressive, difficulty)));
    const random = withStyle(RANDOM_PICK);
    const picked = hallRoster(random, { arena: ARENA, humans: 1 }, at)[0]!.style!;
    expect(hall1(createFloorAi(random, 0, ARENA))).toEqual(hall1(createAiController(random, difficulty, picked)));
  });

  it('a Hall with no enemy for its slot leaves it idle', () => {
    const lastSlot = createFloorAi(tuning, 3, ARENA);
    const intents: Intent[] = states.map((s) => lastSlot.intent(s, 5));
    expect(intents.every((i) => hashValue(i) === hashValue(IDLE_INTENT))).toBe(true);
  });
});
