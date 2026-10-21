import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, weaponMotion, type TuningData } from '../tuning';
import { secondsToTicks } from './constants';
import { attack, createInitialState, hold, runScript, wait, walk, type Placement, type ScriptRun, type Track } from './index';

const repo = loadTuningData();

/**
 * A floor (x, z -10..10 at 0) with three blocks to drop from, all with open ledges:
 *   - ledge:  x -1..1,  z 4..6   at 1   (a soft Landing)
 *   - tower:  x 2..4,   z -1..1  at 2.5 (a hard one)
 *   - spire:  x -6..-4, z -1..1  at 10  (a fatal one)
 */
const tuning: TuningData = {
  ...repo,
  arenas: {
    ...repo.arenas,
    drops: parseArena(
      {
        name: 'drops',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
          { id: 'WALK_ledge', points: [[-1, 1, 4], [1, 1, 4], [1, 1, 6], [-1, 1, 6]] },
          { id: 'WALK_tower', points: [[2, 2.5, -1], [4, 2.5, -1], [4, 2.5, 1], [2, 2.5, 1]] },
          { id: 'WALK_spire', points: [[-6, 10, -1], [-4, 10, -1], [-4, 10, 1], [-6, 10, 1]] },
        ],
        walls: [],
      },
      'drops',
    ),
  },
};
const fall = tuning.fall;

function run(placement: Placement, track: Track, ticks: number): ScriptRun {
  return runScript(tuning, createInitialState(tuning, 1, [placement], [], [], 'drops'), [track], ticks);
}

/** Walk east off the block a Fighter stands in the middle of. */
const walkOff = (x: number, z: number, y: number) => run({ position: { x, z }, facing: Math.PI / 2, y }, walk(40, { x: 1, z: 0 }), 240);

const landing = (r: ScriptRun) => r.events.find((e) => e.type === 'Land')!;

describe('Falling and Landing', () => {
  it('a drop within the safe height lands softly: no damage, and the Fall ends in Idle', () => {
    const r = walkOff(0, 5, 1);
    const land = landing(r);
    expect(land).toMatchObject({ fighter: 0, damage: 0 });
    expect(land.type === 'Land' && land.height).toBeCloseTo(1, 9);
    const after = r.states[land.tick]!.fighters[0]!;
    expect(after.hp).toBe(repo.fighter.maxHp);
    expect(after.action.kind).toBe('Idle');
    expect(r.events.some((e) => e.type === 'Stagger')).toBe(false);
  });

  it('a deeper drop does not hurt, but Staggers the Fighter (Landed)', () => {
    const r = walkOff(3, 0, 2.5);
    const land = landing(r);
    expect(land).toMatchObject({ fighter: 0, damage: 0 });
    const after = r.states[land.tick]!.fighters[0]!;
    expect(after.hp).toBe(repo.fighter.maxHp);
    expect(after.action).toEqual({ kind: 'Stagger', cause: 'Landed' });
    expect(after.motion.name).toBe('Land');
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 0, cause: 'Landed', tick: land.tick }));
  });

  it('walking off a 10 m spire lands unhurt: only a Knockdown Landing deals fall damage', () => {
    const r = walkOff(-5, 0, 10);
    const land = landing(r);
    expect(land.type === 'Land' && land.height).toBeGreaterThan(9);
    expect(land).toMatchObject({ fighter: 0, damage: 0 });
    const after = r.states[land.tick]!;
    expect(after.fighters[0]!.hp).toBe(repo.fighter.maxHp);
    expect(after.fighters[0]!.death).toBeUndefined();
    expect(after.fighters[0]!.action).toEqual({ kind: 'Stagger', cause: 'Landed' });
  });

  it('walking off a ledge Falls only after the fall delay', () => {
    const r = walkOff(3, 0, 2.5);
    const off = r.states.findIndex((s) => s.fighters[0]!.air);
    const fell = r.states.findIndex((s) => s.fighters[0]!.action.kind === 'Fall');
    expect(off).toBeGreaterThan(0);
    expect(fell - off).toBe(secondsToTicks(fall.fallDelay));
  });

  it('a Jump rises about jumpSpeed² / 2·gravity, Falls all the way, and lands where it took off', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, hold(1, { jump: true }), 120);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'Jump', fighter: 0, tick: 1 }));
    const apex = Math.max(...r.states.map((s) => s.fighters[0]!.y));
    expect(apex).toBeCloseTo(fall.jumpSpeed ** 2 / (2 * fall.gravity), 1);
    const land = landing(r);
    for (let t = 1; t < land.tick; t++) expect(r.states[t]!.fighters[0]!.action.kind, `Tick ${t}`).toBe('Fall');
    const after = r.states[land.tick]!.fighters[0]!;
    expect(after.y).toBe(0);
    expect(after.action.kind).toBe('Idle');
    expect(land.type === 'Land' && land.damage).toBe(0);
  });

  it('holding Jump boosts it higher, and still lands softly on level ground', () => {
    const plain = fall.jumpSpeed ** 2 / (2 * fall.gravity);
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true, jumpHeld: true } }, { ticks: 239, intent: { jumpHeld: true } }], 240);
    const apex = Math.max(...r.states.map((s) => s.fighters[0]!.y));
    expect(apex).toBeGreaterThan(fall.safeHeight + plain);
    const land = landing(r);
    expect(land.type === 'Land' && land.damage).toBe(0);
    expect(r.states[land.tick]!.fighters[0]!.action.kind).toBe('Idle');
  });

  it('a tap (let go within jumpBoostDelay) is a plain hop, and holding Jump again does not resume the boost', () => {
    const tapTicks = secondsToTicks(fall.jumpBoostDelay) - 1;
    const tap = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true, jumpHeld: true } }, { ticks: tapTicks - 1, intent: { jumpHeld: true } }], 120);
    const regrip = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true, jumpHeld: true } }, { ticks: tapTicks - 1, intent: { jumpHeld: true } }, { ticks: 1, intent: {} }, { ticks: 30, intent: { jumpHeld: true } }], 120);
    const apex = (r: ScriptRun) => Math.max(...r.states.map((s) => s.fighters[0]!.y));
    expect(apex(tap)).toBeCloseTo(fall.jumpSpeed ** 2 / (2 * fall.gravity), 1);
    expect(apex(regrip)).toBeCloseTo(apex(tap), 9);
  });

  it('a Jump carries the walk with it', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true, move: { x: 0, z: 1 } } }, ...walk(119, { x: 0, z: 1 })], 120);
    const land = landing(r);
    const z = r.states[land.tick]!.fighters[0]!.position.z;
    const airborne = land.tick - 1;
    expect(z).toBeCloseTo((repo.fighter.walkSpeed * airborne) / 60, 1);
  });

  it('a jumper can Attack in the air, but cannot Jump again', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true } }, { ticks: 20, intent: { attack: true, direction: 'Overhead', jump: true } }], 21);
    expect(r.states[5]!.fighters[0]!.action.kind).toBe('Attack');
    expect(r.states[5]!.fighters[0]!.air).toBeDefined();
    expect(r.events.filter((e) => e.type === 'Jump')).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'AttackPhase')).toBe(true);
  });

  it('a jumper can Block in the air', () => {
    const r = run({ position: { x: 0, z: 0 }, facing: 0 }, [{ ticks: 1, intent: { jump: true } }, { ticks: 10, intent: { block: true, direction: 'Overhead' } }], 11);
    expect(r.states[5]!.fighters[0]!.action.kind).toBe('Block');
    expect(r.states[5]!.fighters[0]!.air).toBeDefined();
  });

  it('a Fighter can Jump out of an Attack, which carries on in the air', () => {
    const r = run(
      { position: { x: 0, z: 0 }, facing: 0 },
      [{ ticks: 3, intent: { attack: true, direction: 'Overhead' } }, { ticks: 1, intent: { attack: true, direction: 'Overhead', jump: true } }, { ticks: 5, intent: {} }],
      9,
    );
    const jumped = r.events.find((e) => e.type === 'Jump')!;
    expect(r.states[jumped.tick]!.fighters[0]!.action.kind).toBe('Attack');
    expect(r.states[jumped.tick]!.fighters[0]!.air).toBeDefined();
  });

  it('a Fighter that walked off a ledge still cannot Attack in the air', () => {
    const r = run({ position: { x: 3.9, z: 0 }, facing: Math.PI / 2, y: 2.5 }, [...walk(10, { x: 1, z: 0 }), { ticks: 30, intent: { attack: true, direction: 'Overhead', move: { x: 1, z: 0 } } }], 40);
    const off = r.states.findIndex((s) => s.fighters[0]!.air);
    expect(off).toBeGreaterThan(0);
    for (let t = off; t < r.states.length; t++) {
      const f = r.states[t]!.fighters[0]!;
      if (f.air) expect(f.action.kind, `Tick ${t}`).not.toBe('Attack');
    }
  });
});

describe('Soft Landing', () => {
  const origin: Placement = { position: { x: 0, z: 0 }, facing: 0 };
  const me = (r: ScriptRun, t: number) => r.states[t]!.fighters[0]!;
  /** How many Ticks `LandSoft` plays. */
  const soft = secondsToTicks(weaponMotion(tuning, 'Arming Sword', 'LandSoft')!.duration);

  it('a Jump on level ground lands in LandSoft, which plays out in Idle and hands over to Idle in step', () => {
    const r = run(origin, hold(1, { jump: true }), 120);
    const land = landing(r).tick;
    for (let k = 0; k < soft; k++) {
      expect(me(r, land + k).action.kind, `Tick ${land + k}`).toBe('Idle');
      expect(me(r, land + k).motion).toMatchObject({ name: 'LandSoft', tick: k });
    }
    // Idle takes over at the Tick it would have reached had it started on the Landing, so its sway is not shifted.
    expect(me(r, land + soft).action.kind).toBe('Idle');
    expect(me(r, land + soft).motion).toMatchObject({ name: 'Idle', tick: soft });
    expect(me(r, land + soft + 10).motion).toMatchObject({ name: 'Idle', tick: soft + 10 });
  });

  it('an Attack pressed on the landing Tick, or on any Tick of LandSoft, starts at once and keeps its timing', () => {
    const land = landing(run(origin, hold(1, { jump: true }), 120)).tick;
    /** The Tick the Attack starts and its phases, counted from the press at Tick `press`. */
    const phases = (r: ScriptRun, press: number) => ({
      starts: me(r, press).action.kind,
      phases: r.events.filter((e) => e.type === 'AttackPhase').map((e) => [e.tick - press, e.type === 'AttackPhase' && e.phase]),
    });
    for (const k of [0, 1, 2, Math.floor(soft / 2), soft - 1]) {
      const press = land + k;
      const landed = run(origin, [...hold(1, { jump: true }), ...wait(press - 2), ...attack('Overhead')], press + 90);
      const standing = run(origin, [...wait(press - 1), ...attack('Overhead')], press + 90);
      if (k > 0) expect(me(landed, press - 1).motion.name).toBe('LandSoft');
      expect(phases(landed, press), `pressed ${k} Ticks after the Landing`).toEqual(phases(standing, press));
      expect(phases(landed, press).starts).toBe('Attack');
      expect(phases(landed, press).phases.length).toBeGreaterThan(1);
    }
  });
});
