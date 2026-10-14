import { describe, expect, it } from 'vitest';
import { IDLE_INTENT, type Intent } from '../sim';
import { loadTuningData } from '../tuning';
import { playerVsAi } from './driver';

const tuning = loadTuningData();

/** Drive a Player vs AI Match with a per-Tick local Intent, counting the AI's Blocks of the player's Attacks. */
function play(difficulty: string, local: (tick: number) => Intent, ticks: number) {
  const driver = playerVsAi(tuning, { difficulty, bestOf: 3, seed: 7 });
  let blocks = 0;
  let hits = 0;
  for (let t = 0; t < ticks; t++) {
    driver.tick(local(t));
    for (const e of driver.state!.duel.events) {
      if (e.type === 'Block' && e.defender === 1) blocks++;
      if (e.type === 'Hit' && e.attacker === 0) hits++;
    }
  }
  return { driver, blocks, hits };
}

describe('Player vs AI Match driver', () => {
  it('starts a Match with the local player as Fighter 0 and advances one Match Tick per call', () => {
    const driver = playerVsAi(tuning, { difficulty: 'Normal', bestOf: 3 });
    expect(driver.localFighter).toBe(0);
    expect(driver.state).toMatchObject({ tick: 0, duelNumber: 1, score: [0, 0], config: { bestOf: 3 } });
    expect(driver.tick(IDLE_INTENT)).toEqual({ advanced: true });
    expect(driver.state!.tick).toBe(1);
  });

  it('the local Intent drives Fighter 0', () => {
    const driver = playerVsAi(tuning, { difficulty: 'Normal', bestOf: 1 });
    const z0 = driver.state!.duel.fighters[0]!.position.z;
    for (let t = 0; t < 10; t++) driver.tick({ ...IDLE_INTENT, move: { x: 0, z: -1 } });
    expect(driver.state!.duel.fighters[0]!.position.z).toBeLessThan(z0);
  });

  it('the difficulty changes how the AI defends: Hard blocks more of the same Attacks than Easy', () => {
    // Step in to 1.3 m, then tap an Overhead every 90 Ticks.
    const local = (t: number): Intent =>
      t < 12 ? { ...IDLE_INTENT, move: { x: 0, z: 1 } } : { ...IDLE_INTENT, attack: t % 90 === 0 };
    const easy = play('Easy', local, 2400);
    const hard = play('Hard', local, 2400);
    expect(hard.blocks).toBeGreaterThan(easy.blocks);
  });

  it('rejects an unknown difficulty', () => {
    expect(() => playerVsAi(tuning, { difficulty: 'Impossible', bestOf: 3 })).toThrow();
  });
});
