import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { createInitialState, hashState, IDLE_INTENT, restore, snapshot, spinFacing, spinSign, step, steerHeading, TICK_SECONDS, whirlwindTimings, type FighterState, type Intent, type SimState } from './index';
import { whirlwindLowMotion, whirlwindSpinMotion } from './actions';
import { applyCrouch, fighterPose } from './pose';
import { motionTargets, playbackTargets } from './motion';
import { solveSkeleton, NO_GAIT } from './skeleton';

const tuning = loadTuningData();
const t = whirlwindTimings(tuning);
const WEAPONS = ['Arming Sword', 'Longsword', 'Halberd'];
const fresh = (weapon: string): SimState => createInitialState(tuning, 1, undefined, [weapon]);
const tick = (s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
const ticks = (s: SimState, n: number, intent: Partial<Intent> = {}): SimState => {
  for (let i = 0; i < n; i++) s = tick(s, intent);
  return s;
};
const me = (s: SimState): FighterState => s.fighters[0]!;

/** Hold G (and C, if `crouch`) until armed, then let go of G (keeping C): the Tick the Spin begins. */
function spinning(weapon: string, direction: 'Left' | 'Right', crouch: boolean): SimState {
  const g: Partial<Intent> = { whirlwind: true, direction, crouch };
  let s = ticks(fresh(weapon), t.armTicks + 1 + (crouch ? 20 : 0), g);
  s = tick(s, { direction, crouch });
  expect(me(s).action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
  return s;
}

/** The lowest and highest point of the blade (hilt and tip). */
const heights = (f: FighterState): { low: number; high: number } => {
  const ys = [f.blade.hilt.y, f.blade.tip.y];
  return { low: Math.min(...ys), high: Math.max(...ys) };
};

describe('Whirlwind Spin pose', () => {
  it('plays WhirlwindSpinRight or WhirlwindSpinLeft, held at its last Tick, once released', () => {
    for (const direction of ['Right', 'Left'] as const) {
      const s = spinning(WEAPONS[0]!, direction, false);
      const last = Math.round(tuning.motions[whirlwindSpinMotion(direction)]!.duration * 60);
      expect(me(s).motion).toMatchObject({ name: `WhirlwindSpin${direction}`, tick: last });
      expect(me(ticks(s, 10)).motion).toMatchObject({ name: whirlwindSpinMotion(direction), tick: last });
    }
  });

  it('has four Motions with the contract shape', () => {
    for (const name of ['WhirlwindSpinLeft', 'WhirlwindSpinRight', 'WhirlwindLowLeft', 'WhirlwindLowRight']) {
      const m = tuning.motions[name]!;
      expect(m.loop).toBe(false);
      expect(m.duration).toBeCloseTo(0.1);
      expect(m.poseKeys).toHaveLength(2);
      expect(m.markers ?? {}).toEqual({});
    }
    expect(whirlwindLowMotion('Left')).toBe('WhirlwindLowLeft');
  });

  for (const direction of ['Right', 'Left'] as const) {
    it.each(WEAPONS)(`standing, the ${direction} blade lies above 1.3 m once the Motion Blend settles (%s)`, (weapon) => {
      const s = ticks(spinning(weapon, direction, false), 20);
      expect(heights(me(s)).low).toBeGreaterThan(1.3);
    });

    it.each(WEAPONS)(`fully crouched, the ${direction} blade lies below 0.5 m (%s)`, (weapon) => {
      const s = ticks(spinning(weapon, direction, true), 20, { crouch: true });
      expect(me(s).crouch).toBe(1);
      expect(heights(me(s)).high).toBeLessThan(0.5);
    });
  }

  it.each(WEAPONS)('half crouched, the blade lies between the two (%s)', (weapon) => {
    const standing = heights(me(ticks(spinning(weapon, 'Right', false), 20)));
    const s = ticks(spinning(weapon, 'Right', false), 25);
    const half = me(ticks(s, 5, { crouch: true }));
    expect(half.crouch).toBeCloseTo(0.5);
    const crouched = heights(me(ticks(spinning(weapon, 'Right', true), 20, { crouch: true })));
    const h = heights(half);
    expect(h.low).toBeLessThan(standing.low);
    expect(h.low).toBeGreaterThan(crouched.low);
    expect(h.high).toBeLessThan(standing.high);
    expect(h.high).toBeGreaterThan(crouched.high);
  });

  it('a Fighter that is not spinning poses as the crouch alone gives', () => {
    const s = ticks(fresh(WEAPONS[0]!), 20, { crouch: true });
    const f = me(s);
    expect(f.crouch).toBe(1);
    expect(f.action.kind).toBe('Idle');
    const expected = solveSkeleton(
      { ...applyCrouch(playbackTargets(tuning, f.weapon, f.motion), f.crouch, tuning), leftFoot: motionTargets(tuning, f.weapon, 'Idle', 0).leftFoot, rightFoot: motionTargets(tuning, f.weapon, 'Idle', 0).rightFoot },
      tuning.skeleton,
      tuning.weapons[f.weapon]!,
      f,
      NO_GAIT,
    );
    const pose = fighterPose(f, tuning);
    expect(pose.blade.hilt.y).toBeCloseTo(expected.blade.hilt.y, 6);
    expect(pose.blade.tip.y).toBeCloseTo(expected.blade.tip.y, 6);
  });
});

// --- Turning, drive, air and Gait (Stage 2, Task 2) ---

const spinOf = (s: SimState) => {
  const a = me(s).action;
  if (a.kind !== 'Whirlwind') throw new Error(`not a Whirlwind: ${a.kind}`);
  return a;
};
const heading = (s: SimState): number => spinOf(s).heading!;
const wrap = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const DEG = Math.PI / 180;
const isSpin = (s: SimState): boolean => me(s).action.kind === 'Whirlwind' && (me(s).action as { phase: string }).phase === 'Spin';

describe('Whirlwind Spin turning', () => {
  it('lasts spinTicks, then Recovery lasts recoveryTicks', () => {
    let s = spinning(WEAPONS[0]!, 'Right', false);
    let spin = 1;
    while (isSpin(tick(s))) {
      s = tick(s);
      spin++;
    }
    expect(spin).toBe(t.spinTicks);
    s = tick(s);
    expect(spinOf(s)).toMatchObject({ phase: 'Recovery', ticks: 0 });
    let rec = 1;
    for (; me(tick(s)).action.kind === 'Whirlwind'; rec++) s = tick(s);
    expect(rec).toBe(t.recoveryTicks);
  });

  it('is entered with the heading on the facing, absent in the Wind-up, kept through Recovery', () => {
    let s = ticks(fresh(WEAPONS[0]!), t.armTicks + 1, { whirlwind: true, face: 0.5 });
    expect(spinOf(s)).not.toHaveProperty('heading');
    const f0 = me(s).facing;
    s = tick(s, { face: f0 });
    expect(heading(s)).toBe(f0);
    s = ticks(s, t.spinTicks);
    const h = heading(s);
    expect(spinOf(s).phase).toBe('Recovery');
    expect(heading(tick(s))).toBe(h);
  });

  for (const direction of ['Right', 'Left'] as const) {
    it(`${direction}: facing moves ${spinSign(direction) * 20} degrees a Tick, is on the heading at each turn's end, and exactly on it as Recovery begins`, () => {
      let s = spinning(WEAPONS[0]!, direction, false);
      const h = heading(s);
      expect(me(s).facing).toBe(h);
      for (let n = 1; n <= t.spinTicks; n++) {
        const before = me(s).facing;
        s = tick(s, { face: h });
        const a = spinOf(s);
        const moved = wrap(me(s).facing - before) / DEG;
        if (n < t.spinTicks) {
          expect(moved).toBeCloseTo(spinSign(direction) * 20, 6);
          if (a.ticks % t.turnTicks === 0) expect(Math.abs(wrap(me(s).facing - h))).toBeLessThan(1e-9);
        } else {
          expect(a).toMatchObject({ phase: 'Recovery', ticks: 0 });
          expect(me(s).facing).toBe(h);
        }
      }
    });
  }

  it('exports a facing closed in the Spin tick', () => {
    const s = spinning(WEAPONS[0]!, 'Right', false);
    expect(Math.abs(wrap(spinFacing({ ...spinOf(s), ticks: 9 }, tuning) - heading(s) - Math.PI))).toBeLessThan(1e-9);
    expect(steerHeading(1, null, tuning)).toBe(1);
    expect(steerHeading(0, 0.01, tuning)).toBe(0.01);
  });

  it.each(WEAPONS)('over one turn the blade tip bearing covers all eight 45 degree sectors (%s)', (weapon) => {
    let s = spinning(weapon, 'Right', false);
    s = ticks(s, 10); // the Motion Blend settles
    const sectors = new Set<number>();
    for (let n = 0; n < t.turnTicks; n++) {
      s = tick(s);
      const f = me(s);
      const bearing = Math.atan2(f.blade.tip.x - f.position.x, f.blade.tip.z - f.position.z);
      sectors.add(Math.floor((bearing + Math.PI) / (Math.PI / 4)) % 8);
    }
    expect(sectors.size).toBe(8);
  });
});

describe('Whirlwind Spin drive', () => {
  it('covers driveSpeed x spinTicks x TICK_SECONDS along the heading, ignoring move, with no sideways drift', () => {
    let s = ticks(fresh(WEAPONS[0]!), t.armTicks + 1, { whirlwind: true, direction: 'Right' });
    const start = { ...me(s).position };
    s = tick(s, { direction: 'Right', move: { x: 1, z: 0 } }); // the Spin's entering Tick drives too
    const h = heading(s);
    const feet = (x: SimState) => me(x).position;
    for (let n = 0; n < t.spinTicks - 1; n++) s = tick(s, { move: { x: 1, z: 0 }, face: h });
    s = tick(s, { move: { x: 1, z: 0 }, face: h }); // enters Recovery: no drive on this Tick
    const dx = feet(s).x - start.x;
    const dz = feet(s).z - start.z;
    const along = dx * Math.sin(h) + dz * Math.cos(h);
    const side = dx * Math.cos(h) - dz * Math.sin(h);
    const expected = tuning.whirlwind.driveSpeed * t.spinTicks * TICK_SECONDS;
    expect(expected).toBeCloseTo(4.5, 9);
    expect(Math.abs(along - expected) / expected).toBeLessThan(0.01);
    expect(Math.abs(side)).toBeLessThan(0.01);
  });

  it('steers the heading by at most 1.5 degrees a Tick, 135 degrees over the Spin, and the path arcs', () => {
    let s = spinning(WEAPONS[0]!, 'Right', false);
    const h0 = heading(s);
    const start = { ...me(s).position };
    for (let n = 0; n < t.spinTicks; n++) {
      const before = heading(s);
      s = tick(s, { face: wrap(h0 + Math.PI) });
      expect(Math.abs(wrap(heading(s) - before))).toBeLessThanOrEqual(1.5 * DEG + 1e-9);
    }
    expect(Math.abs(wrap(heading(s) - h0)) / DEG).toBeCloseTo(135, 3);
    const dx = me(s).position.x - start.x;
    const dz = me(s).position.z - start.z;
    expect(Math.hypot(dx, dz)).toBeLessThan(4.5 - 0.1);
    expect(Math.abs(dx)).toBeGreaterThan(0.5);
  });

  it('the feet stay planted under the body: no Step events while spinning on the ground', () => {
    let s = spinning(WEAPONS[0]!, 'Right', false);
    for (let n = 0; n < t.spinTicks - 1; n++) {
      s = tick(s, { face: n < 40 ? 2 : -2 });
      expect(s.events.some((e) => e.type === 'Step')).toBe(false);
      expect(me(s).gait.left.step).toBeNull();
      expect(me(s).gait.right.step).toBeNull();
    }
  });
});

const floorAt = (y: number, x0 = -10, x1 = 10, z0 = -10, z1 = 10) => ({ id: `WALK_${y}_${z0}`, points: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]] as [number, number, number][] });
const withArena = (walk: ReturnType<typeof floorAt>[], walls: { id: string; a: { x: number; z: number }; b: { x: number; z: number }; bottom: number; top: number }[] = []): TuningData => ({
  ...tuning,
  arenas: { ...tuning.arenas, spin: parseArena({ name: 'spin', walk: walk as never, walls: walls as never }, 'spin') },
});
const start = (tn: TuningData, x: number, z: number, y = 0): SimState => createInitialState(tn, 1, [{ position: { x, z }, facing: 0, y }, { position: { x: -9, z: -9 }, facing: 0 }], [WEAPONS[0]!, WEAPONS[0]!], [], 'spin');
const stepWith = (tn: TuningData, s: SimState, intent: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...intent }, IDLE_INTENT], tn);

describe('Whirlwind Spin in the air and at edges', () => {
  it('armed and released in a held Jump, it spins in the air, lands still spinning, and drives again', () => {
    let s = createInitialState(tuning, 1, undefined, [WEAPONS[0]!]);
    const hold: Partial<Intent> = { whirlwind: true, jump: true, jumpHeld: true };
    s = tick(s, hold);
    for (let n = 0; n < t.armTicks; n++) s = tick(s, { whirlwind: true, jumpHeld: true });
    s = tick(s, { jumpHeld: true });
    expect(me(s).air).toBeDefined();
    expect(spinOf(s).phase).toBe('Spin');
    const h = heading(s);
    let landedAt = -1;
    for (let n = 0; n < 60 && me(s).action.kind === 'Whirlwind' && spinOf(s).phase === 'Spin'; n++) {
      s = tick(s, { jumpHeld: true, face: h });
      if (!me(s).air) {
        landedAt = n;
        break;
      }
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(spinOf(s).phase).toBe('Spin');
    const p = { ...me(s).position };
    s = tick(s, { face: h });
    s = tick(s, { face: h });
    expect(Math.hypot(me(s).position.x - p.x, me(s).position.z - p.z)).toBeGreaterThan(0.9 * 2 * tuning.whirlwind.driveSpeed * TICK_SECONDS);
  });

  it('Space during a grounded Spin Jumps: still a Whirlwind in the air, take-off speed is the drive, lands spinning', () => {
    let s = ticks(spinning(WEAPONS[0]!, 'Right', false), 5);
    s = tick(s, { jump: true });
    expect(me(s).air?.jumped).toBe(true);
    expect(spinOf(s).phase).toBe('Spin');
    // The same Tick's flight (locked, so no steering) bleeds a little of it to `fall.airControl`.
    expect(Math.hypot(me(s).air!.vx, me(s).air!.vz) / tuning.whirlwind.driveSpeed).toBeGreaterThan(0.97);
    expect(Math.hypot(me(s).air!.vx, me(s).air!.vz)).toBeLessThanOrEqual(tuning.whirlwind.driveSpeed);
    while (me(s).air) s = tick(s);
    expect(spinOf(s).phase).toBe('Spin');
  });

  it('driving off a ledge goes airborne still spinning and falls', () => {
    const tn = withArena([floorAt(0), floorAt(1, -3, 3, -3, 0)]);
    let s = start(tn, 0, -2.5, 1);
    s = ticks(s, 0);
    for (let n = 0; n < t.armTicks + 1; n++) s = stepWith(tn, s, { whirlwind: true });
    s = stepWith(tn, s);
    let sawAir = false;
    let landed = false;
    for (let n = 0; n < t.spinTicks - 1 && !landed; n++) {
      s = stepWith(tn, s);
      if (me(s).air) {
        sawAir = true;
        expect(spinOf(s).phase).toBe('Spin');
      } else if (sawAir) landed = s.events.some((e) => e.type === 'Land');
    }
    expect(sawAir).toBe(true);
    expect(landed).toBe(true);
    expect(me(s).y).toBe(0);
  });

  it('driving onto an Abyss is a Death', () => {
    const tn = withArena([floorAt(0, -10, 10, -3, 0), { ...floorAt(-1, -10, 10, 0, 20), abyss: true } as never]);
    let s = start(tn, 0, -2.5);
    for (let n = 0; n < t.armTicks + 1; n++) s = stepWith(tn, s, { whirlwind: true });
    for (let n = 0; n < t.spinTicks + 60 && !me(s).death; n++) s = stepWith(tn, s);
    expect(me(s).death).toBeDefined();
  });

  it('driving into a Wall stops the body', () => {
    const tn = withArena([floorAt(0)], [{ id: 'w', a: { x: -5, z: 2 }, b: { x: 5, z: 2 }, bottom: 0, top: 3 }]);
    let s = start(tn, 0, 0);
    for (let n = 0; n < t.armTicks + 1; n++) s = stepWith(tn, s, { whirlwind: true });
    let maxZ = -Infinity;
    for (let n = 0; n < t.spinTicks; n++) {
      s = stepWith(tn, s);
      maxZ = Math.max(maxZ, me(s).position.z);
    }
    expect(maxZ).toBeLessThan(2);
    expect(maxZ).toBeGreaterThan(1);
  });

  it('snapshot -> restore mid-Spin and mid-spinning-Jump hashes identically forward', () => {
    const run = (s: SimState, n: number): string[] => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        s = tick(s, { face: 1 });
        out.push(hashState(s));
      }
      return out;
    };
    const mid = ticks(spinning(WEAPONS[0]!, 'Left', false), 20, { face: 1 });
    expect(run(restore(snapshot(mid)), 40)).toEqual(run(mid, 40));
    const jumping = ticks(tick(mid, { jump: true }), 5, { face: 1 });
    expect(me(jumping).air).toBeDefined();
    expect(run(restore(snapshot(jumping)), 60)).toEqual(run(jumping, 60));
  });
});
