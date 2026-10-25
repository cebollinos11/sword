import { describe, expect, it } from 'vitest';
import { IDLE_INTENT, type Intent } from '../sim';
import { loadTuningData } from '../tuning';
import type { Lineup } from '../controllers';
import { playerVsAi } from './driver';

const tuning = loadTuningData();
const weapon = 'Arming Sword';

/** The classic Player vs AI Duel: Player 0 against one AI at `difficulty`. */
const versus = (difficulty: string): Lineup => [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'AI', difficulty } },
];

/** Drive a Player vs AI Match with a per-Tick local Intent, counting the AI's Blocks of the player's Attacks. */
function play(difficulty: string, local: (tick: number) => Intent, ticks: number) {
  const driver = playerVsAi(tuning, { arena: 'circle', lineup: versus(difficulty), weapon, bestOf: 3, seed: 7 });
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
    const driver = playerVsAi(tuning, { arena: 'circle', lineup: versus('Normal'), weapon, bestOf: 3 });
    expect(driver.localFighter).toBe(0);
    expect(driver.state).toMatchObject({ tick: 0, duelNumber: 1, score: [0, 0], config: { bestOf: 3 } });
    expect(driver.tick(IDLE_INTENT)).toEqual({ advanced: true });
    expect(driver.state!.tick).toBe(1);
  });

  it('the local Intent drives Fighter 0', () => {
    const driver = playerVsAi(tuning, { arena: 'circle', lineup: versus('Normal'), weapon, bestOf: 1 });
    const z0 = driver.state!.duel.fighters[0]!.position.z;
    for (let t = 0; t < 10; t++) driver.tick({ ...IDLE_INTENT, move: { x: 0, z: -1 } });
    expect(driver.state!.duel.fighters[0]!.position.z).toBeLessThan(z0);
  });

  it('the difficulty changes how the AI defends: Hard is hit by fewer of the same Attacks than Easy', () => {
    // Step in to 1.3 m, then tap an Overhead every 90 Ticks.
    const local = (t: number): Intent =>
      t < 12 ? { ...IDLE_INTENT, move: { x: 0, z: 1 } } : { ...IDLE_INTENT, attack: t % 90 === 0 };
    const easy = play('Easy', local, 2400);
    const hard = play('Hard', local, 2400);
    expect(easy.hits).toBeGreaterThan(0);
    expect(hard.hits).toBeLessThan(easy.hits);
  });

  it('rejects an unknown difficulty', () => {
    expect(() => playerVsAi(tuning, { arena: 'circle', lineup: versus('Impossible'), weapon, bestOf: 3 })).toThrow();
  });

  it('fields a team battle: the player with an AI ally against three AIs, each with its own difficulty and Weapon', () => {
    const lineup: Lineup = [
      { team: 1, pilot: { kind: 'AI', difficulty: 'Easy' }, weapon: 'Halberd' },
      { team: 0, pilot: { kind: 'AI', difficulty: 'Hard' }, weapon: 'Longsword' },
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } },
    ];
    const driver = playerVsAi(tuning, { arena: 'circle', lineup, weapon: 'Longsword', bestOf: 1, seed: 3 });
    expect(driver.localFighter).toBe(2);
    expect(driver.state!.config.teams).toEqual([1, 0, 0, 1, 1]);
    expect(driver.state!.config.weapons).toEqual(['Halberd', 'Longsword', 'Longsword', 'Arming Sword', 'Arming Sword']);
    // The AIs fight on their own: someone falls, and in time a team wins the Duel.
    for (let t = 0; t < 60 * 120 && driver.state!.duel.duel.status === 'Fighting'; t++) driver.tick(IDLE_INTENT);
    expect(driver.state!.duel.fighters.some((f) => f.death)).toBe(true);
  });

  it('rejects a Lineup without the player, or with a team of five', () => {
    const noPlayer: Lineup = [
      { team: 0, pilot: { kind: 'AI', difficulty: 'Normal' } },
      { team: 1, pilot: { kind: 'AI', difficulty: 'Normal' } },
    ];
    expect(() => playerVsAi(tuning, { arena: 'circle', lineup: noPlayer, weapon, bestOf: 1 })).toThrow(/Player 0/);
    const five: Lineup = [...versus('Normal'), ...Array.from({ length: 4 }, () => versus('Normal').slice(1)).flat()];
    expect(() => playerVsAi(tuning, { arena: 'circle', lineup: five, weapon, bestOf: 1 })).toThrow(/Team 1/);
  });
});
