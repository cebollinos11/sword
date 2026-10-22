import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, hashValue, IDLE_INTENT, inDuel, stepMatch, type Intent, type MatchState, type SimState } from '../sim';
import { controllerIntents, type Controller } from './controller';
import { createFloorAi } from './floorAi';
import { lineupAis, type Lineup } from './lineup';

const tuning = loadTuningData();
const LINEUP: Lineup = [0, 0, 1, 1, 1].map((team) => ({ team, pilot: { kind: 'AI', difficulty: 'Hard' } }));

/**
 * The Duel states a Run's Controllers are asked on, Tick by Tick: `before` Ticks of Floor 1, then every enemy felled,
 * a 10-Tick pause and `after` Ticks of Floor 2. Driven by the Lineup's own AIs (Hard allies, Floor AIs).
 */
function runStates(before: number, after: number): SimState[] {
  const controllers = lineupAis(tuning, LINEUP, 'Gauntlet') as Controller[];
  let m: MatchState = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 5, arena: 'gen:greybox:77', teams: LINEUP.map((s) => s.team), interDuelTicks: 10 });
  const states: SimState[] = [];
  const advance = () => {
    states.push(m.duel);
    m = stepMatch(m, controllerIntents(m.duel, controllers), tuning);
  };
  for (let k = 0; k < before; k++) advance();
  m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f) => (f.team === 1 && inDuel(f) ? { ...f, hp: 0 } : f)) } };
  while (m.run!.floor === 1) advance();
  for (let k = 0; k < after; k++) advance();
  return states;
}

const states = runStates(150, 150);
const change = states.findIndex((s) => s.floor === 2);
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
  it('plays its slot on Floor 1 (it Attacks, moves) and a Benched slot asks for nothing', () => {
    expect(change).toBeGreaterThan(150);
    const { intents } = drive(createFloorAi(tuning, 0));
    expect(intents.slice(0, change).some((h) => h !== hashValue(IDLE_INTENT))).toBe(true);
    // Floor 1 leaves slots 1 and 2 (Fighters 3 and 4) Benched.
    const benched = createFloorAi(tuning, 1);
    expect(states.slice(0, change).every((s) => hashValue(benched.intent(s, 3)) === hashValue(IDLE_INTENT))).toBe(true);
  });

  it('starts each Floor from fresh memory: after a Floor change it acts as a Floor AI that only ever saw that Floor', () => {
    const seasoned = drive(createFloorAi(tuning, 0));
    const fresh = drive(createFloorAi(tuning, 0), change);
    expect(seasoned.intents.slice(change)).toEqual(fresh.intents);
    expect(hashValue(seasoned.saves.at(-1))).toBe(hashValue(fresh.saves.at(-1)));
    expect(seasoned.saves[change]).toMatchObject({ floor: 1 });
    expect(seasoned.saves[change + 1]).toMatchObject({ floor: 2 });
    // Even what a new Duel alone would not clear (the aim it rolled for a throw) is gone on the next Floor.
    const saved = seasoned.saves[change] as { floor: number; memory: { aimError: number } };
    const carrying = createFloorAi(tuning, 0);
    carrying.load!({ ...saved, memory: { ...saved.memory, aimError: 0.2 } });
    expect(drive(carrying, change).saves.slice(1).map((m) => hashValue(m))).toEqual(fresh.saves.slice(1).map((m) => hashValue(m)));
  });

  it('save/load across a Floor change gives the same Intents (Rollback, resync)', () => {
    const ai = createFloorAi(tuning, 0);
    const first = drive(ai);
    // Roll the same Controller back from Floor 2 to before the change, and replay.
    for (const at of [change - 40, change - 1, change, change + 30]) {
      ai.load!(first.saves[at]);
      expect(drive(ai, at).intents, `rolled back to state ${at}`).toEqual(first.intents.slice(at));
      // A fresh Controller loading the same memory (a resync) does the same.
      const other = createFloorAi(tuning, 0);
      other.load!(first.saves[at]);
      expect(drive(other, at).intents, `loaded at state ${at}`).toEqual(first.intents.slice(at));
    }
    // Its memory survives a JSON round trip, as a resync sends it.
    const resynced = createFloorAi(tuning, 0);
    resynced.load!(JSON.parse(JSON.stringify(first.saves[change + 30])));
    expect(drive(resynced, change + 30).intents).toEqual(first.intents.slice(change + 30));
  });

  it('a Floor with no enemy for its slot leaves it idle', () => {
    const lastSlot = createFloorAi(tuning, 2);
    const intents: Intent[] = states.map((s) => lastSlot.intent(s, 4));
    expect(intents.every((i) => hashValue(i) === hashValue(IDLE_INTENT))).toBe(true);
  });
});
