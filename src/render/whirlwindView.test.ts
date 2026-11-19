import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, IDLE_INTENT, step, whirlwindTimings, type FighterState, type Intent, type SimState } from '../sim';
import { ARMED_GLOW, armedFlash, FLASH_TICKS, TRAIL_ARC, TRAIL_FADE_TICKS, TRAIL_INNER, TRAIL_SEGMENTS, trailFan, whirlTrail } from './whirlwindView';

const tuning = loadTuningData();
const t = whirlwindTimings(tuning);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const me = (s: SimState): FighterState => s.fighters[0]!;
const fresh = (): SimState => createInitialState(tuning, 1, undefined, ['Arming Sword']);
const DEG = Math.PI / 180;

/** Hold the Whirlwind `n` Ticks toward `direction`. */
const held = (direction: 'Left' | 'Right', n: number): SimState => ticks(fresh(), n, { whirlwind: true, direction });
/** The Tick the Spin begins (Spin ticks 0). */
const spinStart = (direction: 'Left' | 'Right'): SimState => tick(held(direction, t.armTicks + 1), { direction });

/** Every state from the Spin's entering Tick through the whole Recovery, each with the one before it. */
function runThrough(direction: 'Left' | 'Right'): { prev: SimState; curr: SimState }[] {
  const out: { prev: SimState; curr: SimState }[] = [];
  let prev = spinStart(direction);
  for (let n = 0; n < t.spinTicks + t.recoveryTicks; n++) {
    const curr = tick(prev);
    out.push({ prev, curr });
    prev = curr;
  }
  return out;
}

describe('whirlTrail', () => {
  it('is null outside a Whirlwind', () => {
    const s = fresh();
    expect(whirlTrail(s, s, 0, 0.5, tuning)).toBeNull();
  });

  it('is null in the Wind-up', () => {
    const s = held('Right', t.armTicks + 1);
    expect(me(s).action).toMatchObject({ kind: 'Whirlwind', phase: 'Wind-up' });
    expect(whirlTrail(s, s, 0, 0.5, tuning)).toBeNull();
  });

  it("is null on the Spin's entering Tick at alpha 0", () => {
    const prev = held('Right', t.armTicks + 1);
    const s = spinStart('Right');
    expect(me(s).action).toMatchObject({ phase: 'Spin', ticks: 0 });
    expect(whirlTrail(prev, s, 0, 0, tuning)).toBeNull();
  });

  it('grows 20 degrees a Tick up to TRAIL_ARC and stays there', () => {
    const a = spinStart('Right');
    const after = ticks(a, 12);
    expect(whirlTrail(ticks(a, 11), after, 0, 0, tuning)).toMatchObject({ arc: TRAIL_ARC, opacity: 1 });
    const later = ticks(a, 40);
    expect(whirlTrail(ticks(a, 39), later, 0, 0.7, tuning)!.arc).toBe(TRAIL_ARC);
  });

  it('grows 20 degrees a Tick (alpha adds the fraction)', () => {
    const s0 = spinStart('Right');
    const s3 = ticks(s0, 3);
    expect(whirlTrail(ticks(s0, 2), s3, 0, 0, tuning)!.arc).toBeCloseTo(40 * DEG, 9);
    expect(whirlTrail(ticks(s0, 2), s3, 0, 0.5, tuning)!.arc).toBeCloseTo(50 * DEG, 9);
  });

  it('fades over TRAIL_FADE_TICKS in the Recovery, then is null', () => {
    const rec = runThrough('Right').filter(({ curr }) => {
      const a = me(curr).action;
      return a.kind === 'Whirlwind' && a.phase === 'Recovery';
    });
    expect(rec.length).toBeGreaterThan(TRAIL_FADE_TICKS);
    rec.forEach(({ prev, curr }, n) => {
      const a = me(curr).action as { ticks: number };
      const trail = whirlTrail(prev, curr, 0, 0.5, tuning);
      if (a.ticks < TRAIL_FADE_TICKS) {
        expect(trail!.arc).toBe(TRAIL_ARC);
        expect(trail!.opacity).toBeCloseTo(1 - (a.ticks + 0.5) / TRAIL_FADE_TICKS, 9);
        expect(trail!.opacity).toBeGreaterThan(0);
      } else expect(trail, `recovery tick ${n}`).toBeNull();
    });
    const first = rec[0]!;
    expect(whirlTrail(first.prev, first.curr, 0, 0, tuning)!.opacity).toBeCloseTo(1, 9);
  });

  it('has sign +1 for Right and -1 for Left', () => {
    const r = spinStart('Right');
    const l = spinStart('Left');
    expect(whirlTrail(r, ticks(r, 5), 0, 0, tuning)!.sign).toBe(1);
    expect(whirlTrail(l, ticks(l, 5), 0, 0, tuning)!.sign).toBe(-1);
  });

  it('is null for a Fighter that is dead', () => {
    const r = spinStart('Right');
    const s = ticks(r, 5);
    const dead = { ...s, fighters: [{ ...me(s), death: {} as never }] } as SimState;
    expect(whirlTrail(r, dead, 0, 0, tuning)).toBeNull();
  });
});

describe('trailFan', () => {
  const blade = { hilt: { x: 1, y: 1.2, z: 2 }, tip: { x: 2, y: 1.5, z: 3.5 } } as FighterState['blade'];
  const pivot = { x: 0.4, z: 0.9 };
  const dist = (p: { x: number; z: number }) => Math.hypot(p.x - pivot.x, p.z - pivot.z);

  it('slice 0 is exactly the blade as drawn', () => {
    const fan = trailFan(blade, pivot, { arc: TRAIL_ARC, opacity: 0.8, sign: 1 });
    const { hilt, tip } = blade;
    expect(fan.tip[0]).toEqual(tip);
    expect(fan.inner[0]).toEqual({ x: hilt.x + (tip.x - hilt.x) * TRAIL_INNER, y: hilt.y + (tip.y - hilt.y) * TRAIL_INNER, z: hilt.z + (tip.z - hilt.z) * TRAIL_INNER });
    expect(fan.alpha[0]).toBeCloseTo(0.8, 12);
    expect(fan.alpha[TRAIL_SEGMENTS]).toBeCloseTo(0, 12);
  });

  it('keeps every height and horizontal distance from the pivot', () => {
    for (const sign of [1, -1] as const) {
      const fan = trailFan(blade, pivot, { arc: TRAIL_ARC, opacity: 1, sign });
      expect(fan.tip).toHaveLength(TRAIL_SEGMENTS + 1);
      for (let k = 0; k <= TRAIL_SEGMENTS; k++) {
        expect(fan.tip[k]!.y).toBe(blade.tip.y);
        expect(dist(fan.tip[k]!)).toBeCloseTo(dist(fan.tip[0]!), 9);
        expect(dist(fan.inner[k]!)).toBeCloseTo(dist(fan.inner[0]!), 9);
        expect(fan.inner[k]!.y).toBe(fan.inner[0]!.y);
      }
    }
  });

  it('trails behind a real Spin, to the side the tip came from', () => {
    for (const direction of ['Right', 'Left'] as const) {
      const prevPrev = ticks(spinStart(direction), 14);
      const prev = tick(prevPrev);
      const curr = tick(prev);
      const trail = whirlTrail(prev, curr, 0, 0, tuning)!;
      const p = me(curr).position;
      const fan = trailFan(me(curr).blade, p, trail);
      const bearing = (q: { x: number; z: number }) => Math.atan2(q.x - p.x, q.z - p.z);
      const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
      const earlier = wrap(bearing(me(prev).blade.tip) - bearing(me(curr).blade.tip));
      const fanSide = wrap(bearing(fan.tip[1]!) - bearing(fan.tip[0]!));
      expect(Math.abs(earlier)).toBeGreaterThan(0);
      expect(Math.sign(fanSide)).toBe(Math.sign(earlier));
      // The tip sweeps round the pivot, so the fan lies on that side for the first half of its arc (100 degrees, before the far end wraps past half a turn).
      expect(Math.sign(wrap(bearing(fan.tip[TRAIL_SEGMENTS / 2]!) - bearing(fan.tip[0]!)))).toBe(Math.sign(earlier));
    }
  });

  it('is the same for the same inputs (no hidden state)', () => {
    const prev = ticks(spinStart('Right'), 6);
    const curr = tick(prev);
    const draw = () => {
      const trail = whirlTrail(prev, curr, 0, 0.3, tuning)!;
      return [trail, trailFan(me(curr).blade, me(curr).position, trail), armedFlash(prev, curr, 0, 0.3, tuning)];
    };
    const first = draw();
    whirlTrail(curr, prev, 0, 0.9, tuning);
    expect(draw()).toEqual(first);
  });
});

describe('armedFlash', () => {
  const armTick = (): { prev: SimState; curr: SimState } => ({ prev: held('Right', t.armTicks), curr: held('Right', t.armTicks + 1) });

  it('is null before arming', () => {
    for (let n = 1; n <= t.armTicks; n++) {
      const s = held('Right', n);
      expect(me(s).action).toMatchObject({ armed: false });
      expect(armedFlash(s, s, 0, 0.5, tuning)).toBeNull();
    }
  });

  it('is 1 on the arming Tick at alpha 0 and falls to 0 over FLASH_TICKS', () => {
    const { prev, curr } = armTick();
    expect(me(curr).action).toMatchObject({ phase: 'Wind-up', armed: true, ticks: t.armTicks });
    expect(armedFlash(prev, curr, 0, 0, tuning)).toEqual({ flash: 1, glow: ARMED_GLOW });
    expect(armedFlash(prev, curr, 0, 0.5, tuning)!.flash).toBeCloseTo(1 - 0.5 / FLASH_TICKS, 9);
    const later = held('Right', t.armTicks + 1 + FLASH_TICKS);
    expect(armedFlash(later, later, 0, 0, tuning)).toEqual({ flash: 0, glow: ARMED_GLOW });
    const mid = held('Right', t.armTicks + 1 + FLASH_TICKS / 2);
    expect(armedFlash(mid, mid, 0, 0, tuning)!.flash).toBeCloseTo(0.5, 9);
  });

  it('keeps a glow while held armed', () => {
    const s = held('Right', t.armTicks + 61);
    expect(armedFlash(s, s, 0, 0.4, tuning)).toEqual({ flash: 0, glow: ARMED_GLOW });
  });

  it('is null in the Spin', () => {
    const prev = held('Right', t.armTicks + 1);
    const s = spinStart('Right');
    expect(armedFlash(prev, s, 0, 0, tuning)).toBeNull();
    expect(armedFlash(s, ticks(s, 5), 0, 0, tuning)).toBeNull();
  });
});
