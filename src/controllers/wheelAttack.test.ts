/**
 * Wheel Attack: a mouse wheel notch (up = Overhead, down = Thrust) queues a quick Attack that the Local Controller
 * starts as soon as its Fighter can Attack, run here against the real Simulation.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attackTimings, createInitialState, step, TICK_RATE, type FighterState, type SimState } from '../sim';
import { LocalController, WHEEL_QUEUE_SECONDS } from './local';

const tuning = loadTuningData();
const overhead = attackTimings(tuning, 'arming-sword', 'Overhead');

/** One Fighter alone, driven by a Local Controller; `before(t)` feeds it input before Tick t is sampled. */
function play(ticks: number, before: (local: LocalController, t: number, me: FighterState) => void): FighterState[] {
  const local = new LocalController();
  let s: SimState = createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }]);
  const seen: FighterState[] = [s.fighters[0]!];
  for (let t = 0; t < ticks; t++) {
    before(local, t, s.fighters[0]!);
    s = step(s, [local.intent(s, 0)], tuning);
    seen.push(s.fighters[0]!);
  }
  return seen;
}

/** The Ticks (state indices) an Attack in `direction` enters `phase`. */
function entered(states: readonly FighterState[], direction: string, phase: string): number[] {
  const at: number[] = [];
  states.forEach((f, i) => {
    const was = states[i - 1]?.action;
    const now = f.action;
    const isIt = (a: FighterState['action'] | undefined) => a?.kind === 'Attack' && a.direction === direction && a.phase === phase;
    if (isIt(now) && !(isIt(was) && (was as { phase: string }).phase === phase)) at.push(i);
  });
  return at;
}

describe('Wheel Attack', () => {
  it('from Idle, wheel up starts an Overhead at once and Releases it as soon as the Wind-up reaches its held pose', () => {
    const run = play(120, (local, t) => t === 5 && local.wheel('Overhead'));
    expect(entered(run, 'Overhead', 'Wind-up')).toEqual([6]);
    // A one-Tick click from Tick 5 Releases on the same Tick.
    const click = play(120, (local, t) => {
      if (t === 5) local.buttonDown('attack');
      if (t === 6) local.buttonUp('attack');
    });
    expect(entered(run, 'Overhead', 'Release')).toEqual(entered(click, 'Overhead', 'Release'));
    expect(entered(run, 'Overhead', 'Release')).toEqual([6 + overhead.windUpEnd + 1]);
  });

  it('wheel down starts a Thrust, without changing the aim of the next left click', () => {
    const run = play(200, (local, t) => {
      if (t === 0) local.mouseMove(-40, 0); // aim Left
      if (t === 2) local.wheel('Thrust');
      if (t === 150) local.buttonDown('attack');
      if (t === 151) local.buttonUp('attack');
    });
    expect(entered(run, 'Thrust', 'Wind-up')).toEqual([3]);
    expect(entered(run, 'Left', 'Wind-up')).toEqual([151]);
  });

  it("queued in a swing's Release, it Whiff Chains: it starts the Tick after Release ends", () => {
    const pressAt = 1 + overhead.windUpEnd + 2; // inside the Overhead's Release
    const run = play(200, (local, t) => {
      if (t === 0) local.buttonDown('attack');
      if (t === 1) local.buttonUp('attack');
      if (t === pressAt) local.wheel('Thrust');
    });
    const recovery = entered(run, 'Overhead', 'Recovery')[0]!;
    expect(run[recovery]!.action).toMatchObject({ whiffChain: 'Thrust' });
    expect(entered(run, 'Thrust', 'Wind-up')).toEqual([recovery + 1]);
    expect(entered(run, 'Thrust', 'Release').length).toBe(1);
  });

  it("queued in a swing's Recovery, it Chains: it starts as that Recovery ends", () => {
    let notched = false;
    const run = play(240, (local, t, me) => {
      if (t === 0) local.buttonDown('attack');
      if (t === 1) local.buttonUp('attack');
      // Two Ticks into the Recovery.
      if (!notched && me.action.kind === 'Attack' && me.action.phase === 'Recovery' && me.motion.tick >= overhead.releaseEnd + 2) {
        local.wheel('Thrust');
        notched = true;
      }
    });
    const recovery = entered(run, 'Overhead', 'Recovery')[0]!;
    expect(run.slice(recovery).some((f) => f.action.kind === 'Attack' && f.action.chain?.direction === 'Thrust')).toBe(true);
    expect(entered(run, 'Thrust', 'Wind-up')).toEqual([recovery + (overhead.end - overhead.releaseEnd) + 1]);
  });

  it('a notch during its own Wind-up queues one more to follow it', () => {
    const run = play(300, (local, t) => {
      if (t === 0) local.wheel('Overhead');
      if (t === 2) local.wheel('Thrust');
    });
    expect(entered(run, 'Overhead', 'Wind-up')).toEqual([1]);
    expect(entered(run, 'Overhead', 'Release')).toEqual([1 + overhead.windUpEnd + 1]);
    expect(entered(run, 'Thrust', 'Wind-up').length).toBe(1);
    expect(entered(run, 'Thrust', 'Release').length).toBe(1);
  });

  it(`waits through a Block let go within ${WHEEL_QUEUE_SECONDS} s, and is dropped after a longer one`, () => {
    const window = Math.round(WHEEL_QUEUE_SECONDS * TICK_RATE);
    const blockFor = (ticks: number) =>
      play(200, (local, t) => {
        if (t === 0) local.buttonDown('block');
        if (t === 5) local.wheel('Overhead');
        if (t === 5 + ticks) local.buttonUp('block');
      });
    expect(entered(blockFor(window - 10), 'Overhead', 'Wind-up').length).toBe(1);
    expect(entered(blockFor(window + 10), 'Overhead', 'Wind-up')).toEqual([]);
  });

  it('does nothing while left mouse is held, and pressing left mouse drops one waiting', () => {
    const held = play(200, (local, t) => {
      if (t === 0) local.buttonDown('attack');
      if (t === 3) local.wheel('Thrust');
      if (t === 60) local.buttonUp('attack');
    });
    expect(entered(held, 'Thrust', 'Wind-up')).toEqual([]);
    const dropped = play(200, (local, t) => {
      if (t === 0) local.buttonDown('block');
      if (t === 5) local.wheel('Thrust');
      if (t === 6) local.buttonDown('attack');
      if (t === 7) local.buttonUp('attack');
      if (t === 10) local.buttonUp('block');
    });
    expect(entered(dropped, 'Thrust', 'Wind-up')).toEqual([]);
  });

  it('without a view of its Fighter, a notch is a one-Tick press', () => {
    const local = new LocalController();
    local.wheel('Thrust');
    expect(local.sample()).toMatchObject({ attack: true, direction: 'Thrust' });
    expect(local.sample()).toMatchObject({ attack: false, direction: 'Overhead' });
  });
});
