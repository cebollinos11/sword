import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { landingDamage } from './air';
import { createInitialState, IDLE_INTENT, step, TICK_SECONDS, type Intent, type SimState } from './index';
import type { FighterState, KnockdownAction } from './state';

const repo = loadTuningData();

/**
 * A platform (y 0, z -3..0.4) with a pit 3 m deep in front of it (z 0.4 on), and a tall spire (y 10) on the platform
 * to jump off. Fighter 0 stands on the platform; Fighter 1, in front, is held hovering at the platform's height, as at
 * the top of a Jump, until something hits it.
 */
const tuning: TuningData = {
  ...repo,
  arenas: {
    ...repo.arenas,
    pit: parseArena(
      {
        name: 'pit',
        walk: [
          { id: 'WALK_platform', points: [[-3, 0, -3], [3, 0, -3], [3, 0, 0.4], [-3, 0, 0.4]] },
          { id: 'WALK_pit', points: [[-10, -3, 0.4], [10, -3, 0.4], [10, -3, 20], [-10, -3, 20]] },
          { id: 'WALK_spire', points: [[-10, 10, -10], [-8, 10, -10], [-8, 10, -8], [-10, 10, -8]] },
          { id: 'WALK_floor', points: [[-20, 0, -20], [-3, 0, -20], [-3, 0, 20], [-20, 0, 20]] },
        ],
        walls: [],
      },
      'pit',
    ),
    abyss: parseArena(
      {
        name: 'abyss',
        walk: [
          { id: 'WALK_ledge', points: [[-3, 0, -3], [3, 0, -3], [3, 0, 0], [-3, 0, 0]] },
          { id: 'WALK_abyss', abyss: true, points: [[-10, -1, 0], [10, -1, 0], [10, -1, 20], [-10, -1, 20]] },
        ],
        walls: [],
      },
      'abyss',
    ),
  },
};
const { kick, fall } = tuning;

const GAP = 0.95;
const facing = (teams = [0, 1]): SimState => createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: GAP }, facing: Math.PI }], [], teams, 'pit');
const tick = (s: SimState, a: Partial<Intent> = {}, b: Partial<Intent> = {}): SimState => step(s, [{ ...IDLE_INTENT, ...a }, { ...IDLE_INTENT, ...b }], tuning);

/** Fighter 1 hovering with its feet at the platform's height, at the top of a Jump still boosting. */
const hover = (s: SimState): SimState => ({
  ...s,
  fighters: s.fighters.map((f, i): FighterState => (i === 1 ? { ...f, position: { x: 0, z: GAP }, y: 0, air: { vx: 0, vz: 0, vy: 0, peakY: 0, ticks: 10, jumped: true, launchY: 0, boost: 10 } } : f)),
});

/** Fighter 0 acts with `a` (its first Tick only) while Fighter 1 hovers, until a Hit, DaggerHit or KickLanded lands on it. */
function hitWhileHovering(a: Partial<Intent>, teams?: number[]): SimState {
  let s = hover(facing(teams));
  for (let n = 0; n < 200; n++) {
    s = tick(s, n === 0 ? a : {}, { jumpHeld: true });
    if (s.events.some((e) => e.type === 'Hit' || e.type === 'DaggerHit' || e.type === 'KickLanded')) return s;
    s = hover(s);
  }
  throw new Error('Nothing ever hit the hovering Fighter');
}

const victim = (s: SimState): FighterState => s.fighters[1]!;
const knockdownSpeed = kick.knockdownSlide / (kick.knockdownSlideTicks * TICK_SECONDS);

describe('Fall damage after a Jump', () => {
  it('a Jump off a 10 m spire lands without fall damage, without a Stagger', () => {
    let s = createInitialState(tuning, 1, [{ position: { x: -8.3, z: -9 }, facing: Math.PI / 2 }], [], [], 'pit');
    s = { ...s, fighters: [{ ...s.fighters[0]!, y: 10 }] };
    const jumped = step(s, [{ ...IDLE_INTENT, jump: true, move: { x: 1, z: 0 } }], tuning);
    expect(jumped.fighters[0]!.air?.jumped).toBe(true);
    let at = jumped;
    for (let n = 0; n < 300 && !at.events.some((e) => e.type === 'Land'); n++) at = step(at, [{ ...IDLE_INTENT, move: { x: 1, z: 0 } }], tuning);
    const land = at.events.find((e) => e.type === 'Land');
    expect(land).toMatchObject({ damage: 0 });
    expect(land?.type === 'Land' && land.height).toBeGreaterThan(fall.safeHeight);
    expect(at.fighters[0]!.hp).toBe(tuning.fighter.maxHp);
    expect(at.fighters[0]!.action.kind).toBe('Idle');
    expect(at.events.some((e) => e.type === 'Stagger')).toBe(false);
  });

  it('a Jump onto an Abyss is a Death by Fall, though the drop alone would not hurt', () => {
    let s = createInitialState(tuning, 1, [{ position: { x: 0, z: -0.3 }, facing: 0 }, { position: { x: 0, z: -2.5 }, facing: 0 }], [], [], 'abyss');
    s = step(s, [{ ...IDLE_INTENT, jump: true, move: { x: 0, z: 1 } }, IDLE_INTENT], tuning);
    for (let n = 0; n < 200 && !s.fighters[0]!.death; n++) s = step(s, [{ ...IDLE_INTENT, move: { x: 0, z: 1 } }, IDLE_INTENT], tuning);
    expect(s.fighters[0]!.death?.cause).toBe('Fall');
  });
});

describe('Hit in the air', () => {
  it('a dagger knocks an airborne Fighter down, pushes it along its flight, and its boost is lost', () => {
    const s = hitWhileHovering({ throw: true });
    const f = victim(s);
    expect(f.action).toMatchObject({ kind: 'Knockdown', phase: 'Falling' });
    expect(f.air?.vz).toBeCloseTo(knockdownSpeed, 1);
    expect(f.air?.boost).toBeUndefined();
  });

  it('a blade Hit knocks an airborne Fighter down and pushes it away from the attacker', () => {
    const s = hitWhileHovering({ attack: true, direction: 'Overhead' });
    expect(s.events.some((e) => e.type === 'Stagger' && e.fighter === 1)).toBe(false);
    expect(victim(s).action.kind).toBe('Knockdown');
    expect(victim(s).air!.vz).toBeCloseTo(knockdownSpeed, 6);
  });

  it('a Kick knocks an airborne Fighter down even with no movement input', () => {
    const s = hitWhileHovering({ kick: true });
    expect(s.events.find((e) => e.type === 'KickLanded')).toMatchObject({ outcome: 'Knockdown', damage: kick.knockdownDamage });
    expect(victim(s).action.kind).toBe('Knockdown');
  });

  it("a teammate's Hit (no damage) Staggers it as on the ground", () => {
    const s = hitWhileHovering({ attack: true, direction: 'Overhead' }, [0, 0]);
    expect(victim(s).action).toMatchObject({ kind: 'Stagger', cause: 'Hit' });
  });
});

describe('Knocked down in the air', () => {
  /** Hit by a dagger while hovering, then left to fall into the pit; the Tick it lands and the Ticks after. */
  function fallen(): { states: SimState[]; landed: number } {
    let s = hitWhileHovering({ throw: true });
    const states = [s];
    for (let n = 0; n < 600; n++) {
      s = tick(s);
      states.push(s);
      if (s.events.some((e) => e.type === 'Land' && e.fighter === 1)) break;
    }
    const landed = states.length - 1;
    for (let n = 0; n < kick.knockdownTicks + 10; n++) states.push((s = tick(s)));
    return { states, landed };
  }

  it('lies in the air until it lands, then for the whole knockdownTicks before it gets up', () => {
    const { states, landed } = fallen();
    for (const s of states.slice(0, landed)) {
      const a = victim(s).action as KnockdownAction;
      expect(a.kind).toBe('Knockdown');
      expect(a.phase === 'Rising' || (a.phase === 'Down' && a.ticks > 0)).toBe(false);
    }
    const rising = states.findIndex((s) => (victim(s).action as KnockdownAction).phase === 'Rising');
    expect(rising - landed).toBeGreaterThanOrEqual(kick.knockdownTicks);
  });

  it('lands taking double fall damage, measured from the real top of the arc, and stays down', () => {
    const { states, landed } = fallen();
    const land = states[landed]!.events.find((e) => e.type === 'Land' && e.fighter === 1)!;
    if (land.type !== 'Land') throw new Error('not a Land');
    // From where it was hit (its boost lifting it a hair above the platform) down the 3 m pit.
    expect(land.height).toBeCloseTo(3, 2);
    expect(land.damage).toBeCloseTo(landingDamage(land.height, tuning) * fall.knockdownDamageFactor, 9);
    expect(fall.knockdownDamageFactor).toBe(2);
    expect(victim(states[landed]!).action.kind).toBe('Knockdown');
    expect(states[landed]!.events.some((e) => e.type === 'Stagger' && e.fighter === 1)).toBe(false);
  });
});

describe('Abyss', () => {
  it("the summit's valley and the ground under the train are an Abyss: a Death by Fall", () => {
    expect(repo.arenas.summit!.walk.filter((w) => w.abyss).map((w) => w.id)).toEqual(['WALK_valley']);
    expect(repo.arenas.train!.walk.filter((w) => w.abyss).map((w) => w.id)).toEqual(['WALK_ground']);
  });

  it('a Walk Surface cannot be both an Abyss and Lava', () => {
    expect(() => parseArena({ name: 'x', walk: [{ id: 'a', lava: true, abyss: true, points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] }] }, 'x')).toThrow(/both lava and abyss/);
  });
});
