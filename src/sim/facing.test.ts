import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { blocksAttack, createInitialState, hold, IDLE_INTENT, runDuel, step, TICK_RATE, wait, attack, type SimState } from './index';

const tuning = loadTuningData();
const lone = () => createInitialState(tuning, 1);
const DEG = Math.PI / 180;
/** Degrees the Fighter turns per Tick at full turn speed. */
const perTick = tuning.fighter.turnSpeed / TICK_RATE;

function turnFor(state: SimState, ticks: number, face: number | null): SimState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = step(s, [{ ...IDLE_INTENT, face }], tuning);
  return s;
}

describe('Facing (Intent.face)', () => {
  it('repo Tuning Data turns a Fighter at 360 degrees per second', () => {
    expect(tuning.fighter.turnSpeed).toBe(360);
  });

  it('a null face keeps the current facing', () => {
    expect(turnFor(lone(), 30, null).fighters[0]!.facing).toBe(0);
    expect(IDLE_INTENT.face).toBeNull();
  });

  it('turns toward the requested yaw at turn speed, then stops exactly on it', () => {
    const one = turnFor(lone(), 1, 90 * DEG);
    expect(one.fighters[0]!.facing).toBeCloseTo(perTick * DEG, 10);
    const done = turnFor(lone(), 60, 90 * DEG);
    expect(done.fighters[0]!.facing).toBeCloseTo(90 * DEG, 10);
  });

  it('takes the shorter way round (and normalises yaw into (-π, π])', () => {
    const s = turnFor(lone(), 1, 350 * DEG);
    expect(s.fighters[0]!.facing).toBeCloseTo(-perTick * DEG, 10);
    const behind = turnFor(lone(), 60, 270 * DEG);
    expect(behind.fighters[0]!.facing).toBeCloseTo(-90 * DEG, 10);
  });

  it('a Staggered Fighter cannot turn', () => {
    // Fighter 1 is hit (Stagger), then asks to turn during it.
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: [...wait(40), ...hold(20, { face: 0 })] });
    const staggered = run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Stagger');
    expect(staggered).toBeGreaterThan(0);
    expect(staggered).toBeLessThan(40);
    expect(run.states[staggered + 10]!.fighters[1]!.facing).toBe(Math.PI);
  });

  it('turning to face an attacker lets a Block count (the facing rule)', () => {
    // Fighter 1 starts facing away (+z) and turns round to face Fighter 0 before blocking.
    const placements = [
      { position: { x: 0, z: -0.65 }, facing: 0 },
      { position: { x: 0, z: 0.65 }, facing: 0 },
    ];
    const away = runDuel(tuning, { placements, a: [...wait(40), ...attack('Overhead')], b: hold(100, { block: true }) });
    expect(away.events.some((e) => e.type === 'Hit' && e.defender === 1)).toBe(true);

    const turned = runDuel(tuning, {
      placements,
      a: [...wait(40), ...attack('Overhead')],
      b: hold(100, { block: true, face: Math.PI }),
    });
    expect(turned.events.some((e) => e.type === 'Block' && e.defender === 1)).toBe(true);
    expect(blocksAttack(turned.states[60]!.fighters[1]!, turned.states[60]!.fighters[0]!, 'Overhead', tuning)).toBe(true);
  });
});
