import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { attack, createInitialState, createMatch, duelPlacements, hold, IDLE_INTENT, wait } from '../sim';
import { createAiController, scriptedController, type Controller } from '../controllers';
import { createSandboxSession, duelSandbox, matchSandbox, type Sandbox } from './sandboxSession';
import { compareReplay, parseReplay, recordingSandbox, recordReplay, ReplayError, runReplay, serializeReplay } from './replay';

const tuning = loadTuningData();

/** Play a sandbox session through a recorder to the end (or `ticks`) and record it as a replay. */
function playAndRecord<S extends object>(sandbox: Sandbox<S>, initial: S, controllers: Controller[], ticks: number) {
  const recorder = recordingSandbox(sandbox);
  const session = createSandboxSession(recorder, initial, controllers);
  while (!session.over && session.frontier < ticks) session.advance();
  return { session, replay: recordReplay(tuning, session.history as never, recorder.intentsOf(session.history)) };
}

/** The Exchange-style scripted Duel at 1.3 m: an Overhead Blocked, then an Overhead landing through a Block in the wrong Direction. */
function scriptedDuel(t: TuningData = tuning) {
  const a = [...wait(20), ...attack('Overhead'), ...wait(101), ...attack('Overhead')];
  const b = [...hold(105, { block: true, direction: 'Overhead' as const }), ...wait(5), ...hold(100, { block: true, direction: 'Left' as const })];
  return playAndRecord(duelSandbox(t), createInitialState(t, 1, duelPlacements(1.3)), [scriptedController(a), scriptedController(b)], 300);
}

const aiMatch = () =>
  playAndRecord(matchSandbox(tuning), createMatch(tuning, { bestOf: 1, seed: 11 }), [createAiController(tuning, 'Hard'), createAiController(tuning, 'Normal')], 60 * 60 * 5);

describe('Recording a sandbox Duel', () => {
  it('captures the seed, the starting placements and one Intent per Fighter per Tick', () => {
    const { session, replay } = scriptedDuel();
    expect(replay.setup).toEqual({ kind: 'Duel', seed: 1, placements: [
      { position: { x: 0, z: -0.65 }, facing: 0 },
      { position: { x: 0, z: 0.65 }, facing: Math.PI },
    ] });
    expect(replay.ticks).toBe(session.frontier);
    expect(replay.ticks).toBe(300);
  });

  it('records the outcome that happened: one Block, one Hit by Fighter 0, no winner yet', () => {
    const { replay } = scriptedDuel();
    expect(replay.outcome.winner).toBe('Undecided');
    expect(replay.outcome.hits).toHaveLength(1);
    expect(replay.outcome.hits[0]).toMatchObject({ attacker: 0, defender: 1 });
    expect(replay.outcome.damageDealt[0]).toBeGreaterThan(20);
    expect(replay.outcome.damageDealt[1]).toBe(0);
  });
});

describe('Replaying with unchanged Tuning Data', () => {
  it('reproduces a scripted Duel exactly', () => {
    const { replay } = scriptedDuel();
    const report = compareReplay(parseReplay(serializeReplay(replay)), tuning);
    expect(report.tuningChanged).toBe(false);
    expect(report.differences).toEqual([]);
    expect(report.identical).toBe(true);
    expect(report.replayed).toEqual(replay.outcome);
  });

  it('reproduces an AI vs AI Match from the recorded Intents alone, without the AI', () => {
    const { session, replay } = aiMatch();
    expect(session.over).toBe(true);
    expect(replay.setup).toEqual({ kind: 'Match', seed: 11, config: { bestOf: 1, distance: 2, interDuelTicks: 120 } });
    expect(replay.outcome.winner).not.toBe('Undecided');
    expect(replay.outcome.hits.length).toBeGreaterThan(0);
    const run = runReplay(parseReplay(serializeReplay(replay)), tuning);
    expect(run.outcome).toEqual(replay.outcome);
  }, 30_000);

  it('records the Intents actually fed after a scrub-back and a different branch', () => {
    const recorder = recordingSandbox(duelSandbox(tuning));
    let pressing = false;
    const toggle: Controller = { intent: () => ({ ...IDLE_INTENT, attack: pressing }) };
    const session = createSandboxSession(recorder, createInitialState(tuning, 1, duelPlacements(1.3)), [toggle, scriptedController([])]);
    for (let t = 0; t < 120; t++) session.advance();
    session.seek(10);
    pressing = true;
    session.advance();
    pressing = false;
    for (let t = 0; t < 100; t++) session.advance();
    const intents = recorder.intentsOf(session.history);
    expect(intents).toHaveLength(111);
    expect(intents[10]![0]!.attack).toBe(true);
    const replay = recordReplay(tuning, session.history, intents);
    expect(replay.outcome.hits).toHaveLength(1);
    expect(compareReplay(replay, tuning).identical).toBe(true);
  });
});

describe('Replaying after a Tuning Data change', () => {
  it('reports the changed damage and hits', () => {
    const { replay } = scriptedDuel();
    const stronger: TuningData = { ...tuning, weapon: { ...tuning.weapon, damage: tuning.weapon.damage * 2 } };
    const report = compareReplay(replay, stronger);
    expect(report.tuningChanged).toBe(true);
    expect(report.identical).toBe(false);
    expect(report.replayed.damageDealt[0]).toBeCloseTo(replay.outcome.damageDealt[0]! * 2, 6);
    expect(report.differences.some((d) => d.startsWith('Damage dealt by Fighter 0'))).toBe(true);
    expect(report.differences.some((d) => d.startsWith('Hit 1'))).toBe(true);
  });

  it('reports a changed winner', () => {
    const { replay } = scriptedDuel();
    const lethal: TuningData = { ...tuning, weapon: { ...tuning.weapon, damage: 10_000 } };
    const report = compareReplay(replay, lethal);
    expect(report.replayed.winner).toBe(0);
    expect(report.differences).toContain('Winner: Undecided → Fighter 0');
  });

  it('reports a hit that no longer lands (the Hit Zones shrank to nothing)', () => {
    const { replay } = scriptedDuel();
    const tiny = Object.fromEntries(Object.entries(tuning.hitZones).map(([k, z]) => [k, { ...z, radius: 0.0001 }]));
    const report = compareReplay(replay, { ...tuning, hitZones: tiny as TuningData['hitZones'] });
    expect(report.replayed.hits.length).toBeLessThan(replay.outcome.hits.length);
    expect(report.differences).toContain(`Hits: ${replay.outcome.hits.length} → ${report.replayed.hits.length}`);
  });
});

describe('Replay files', () => {
  it('rejects a file that is not a replay, naming the problem', () => {
    expect(() => parseReplay('{"format":"something-else"}')).toThrow(ReplayError);
    expect(() => parseReplay('not json')).toThrow(ReplayError);
    const { replay } = scriptedDuel();
    const broken = JSON.parse(serializeReplay(replay));
    broken.intents[0].intents = 'nope';
    expect(() => parseReplay(JSON.stringify(broken))).toThrow(/intents\[0\]/);
  });

  it('stores runs of repeated Intents compactly', () => {
    const { replay } = scriptedDuel();
    const file = JSON.parse(serializeReplay(replay));
    expect(file.intents.length).toBeLessThan(40);
  });
});
