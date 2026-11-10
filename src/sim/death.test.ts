import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, withWeapon, type TuningData } from '../tuning';
import { attack, createInitialState, duelPlacements, IDLE_INTENT, runDuel, step, type Direction, type HitEvent, type Intent, type Placement, type SimState } from './index';
import { add, dot, length, lerp, normalize, scale, sub, type Vec3 } from './vec';

/** One clean Overhead hit decides a Duel. */
const tuning: TuningData = withWeapon(loadTuningData(), { damage: 10_000 });
const attackIntent: Intent = { ...IDLE_INTENT, attack: true, direction: 'Overhead' };

/** Fighter 0 taps Overhead until the Duel ends. */
function fell(): SimState {
  let s = createInitialState(tuning, 1, duelPlacements(1.3));
  for (let i = 0; i < 2000 && s.duel.status === 'Fighting'; i++) s = step(s, [i % 2 === 0 ? attackIntent : IDLE_INTENT, IDLE_INTENT], tuning);
  if (s.duel.status !== 'Over') throw new Error('the Duel never ended');
  return s;
}

describe('Death', () => {
  it('records the blow that felled a Fighter on the Tick the Duel ends', () => {
    const s = fell();
    const hit = s.events.find((e) => e.type === 'Hit')!;
    expect(s.fighters[0]!.death).toBeUndefined();
    expect(s.fighters[1]!.death).toEqual({
      tick: s.tick,
      cause: 'Hit',
      blow: {
        point: hit.point,
        bladeSpeed: hit.bladeSpeed,
        direction: 'Overhead',
        from: { x: s.fighters[0]!.position.x, z: s.fighters[0]!.position.z },
        cut: { hilt: hit.blade!.hilt, tip: hit.blade!.tip, travel: hit.travel! },
      },
    });
  });

  it('raises a Death event on that Tick, after the blow and before the Duel ends, and never again', () => {
    const s = fell();
    const types = s.events.map((e) => e.type).filter((t) => ['Hit', 'Death', 'DuelEnd'].includes(t));
    expect(types).toEqual(['Hit', 'Death', 'DuelEnd']);
    expect(s.events).toContainEqual({ type: 'Death', fighter: 1, cause: 'Hit' });
    const later = step(s, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(later.events.some((e) => e.type === 'Death')).toBe(false);
  });

  it('stops simulating the fallen Fighter: it stays exactly as it fell', () => {
    const s = fell();
    let later = s;
    for (let i = 0; i < 60; i++) later = step(later, [IDLE_INTENT, IDLE_INTENT], tuning);
    expect(later.fighters[1]).toEqual(s.fighters[1]);
    expect(later.fighters[0]!.motion).not.toEqual(s.fighters[0]!.motion);
  });
});

/** Every Weapon deals a killing blow, Head or shaft. */
const deadly = Object.keys(tuning.weapons).reduce((t, name) => withWeapon(t, { damage: 10_000 }, name), tuning);

/** Fighter 0 swings `direction` once with `weapon` at Fighter 1: the Tick before Fighter 1 fell, the Tick it fell, and the Hit. */
function kill(weapon: string, direction: Direction, placements: readonly Placement[] = duelPlacements(1.3)) {
  const run = runDuel(deadly, { placements, weapons: [weapon, 'Arming Sword'], a: attack(direction), b: [] });
  const k = run.states.findIndex((s) => s.fighters[1]!.death);
  if (k < 1) throw new Error(`${weapon} ${direction} never felled Fighter 1`);
  const at = run.states[k]!;
  const hit = at.events.find((e): e is HitEvent => e.type === 'Hit' && e.defender === 1)!;
  return { before: run.states[k - 1]!, at, hit, blow: at.fighters[1]!.death!.blow! };
}

const near = (a: Vec3, b: Vec3, eps = 1e-9) => expect(length(sub(a, b))).toBeLessThan(eps);

describe('Death: the cut', () => {
  it.each([
    ['Arming Sword', 'Overhead'],
    ['Arming Sword', 'Left'],
    ['Arming Sword', 'Right'],
    ['Longsword', 'Overhead'],
    ['Halberd', 'Overhead'],
  ] as const)('a killing %s %s with the Head records the blade at contact as the cut', (weapon, direction) => {
    const { before, at, hit, blow } = kill(weapon, direction, weapon === 'Halberd' ? [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: -0.2, z: 1.75 }, facing: Math.PI }] : undefined);
    expect(hit.head).toBe(true);
    expect(blow.cut).toEqual({ hilt: hit.blade!.hilt, tip: hit.blade!.tip, travel: hit.travel! });
    const cut = blow.cut!;
    const [from, to] = [before.fighters[0]!.blade, at.fighters[0]!.blade];
    // The blade at contact lies on the Blade Sweep: last Tick's blade moved the same fraction `s` of the way to this Tick's, at hilt and tip alike.
    const path = sub(to.hilt, from.hilt);
    const s = dot(sub(cut.hilt, from.hilt), path) / dot(path, path);
    expect(s).toBeGreaterThanOrEqual(-1e-9);
    expect(s).toBeLessThanOrEqual(1 + 1e-9);
    near(cut.hilt, lerp(from.hilt, to.hilt, s), 1e-6);
    near(cut.tip, lerp(from.tip, to.tip, s), 1e-6);
    // The contact point is on that blade, and `travel` is the unit direction that point of the blade was moving.
    const axis = sub(cut.tip, cut.hilt);
    const along = dot(sub(hit.point, cut.hilt), axis) / dot(axis, axis);
    near(hit.point, add(cut.hilt, scale(axis, along)), 1e-6);
    expect(length(cut.travel)).toBeCloseTo(1, 9);
    near(cut.travel, normalize(sub(lerp(to.hilt, to.tip, along), lerp(from.hilt, from.tip, along))), 1e-6);
  });

  it('every blade Hit carries the blade at contact and its travel, cutting or not', () => {
    const { hit } = kill('Arming Sword', 'Thrust');
    expect(hit.blade).toBeDefined();
    expect(length(hit.travel!)).toBeCloseTo(1, 9);
  });

  it('a Thrust does not cut', () => {
    const { blow } = kill('Arming Sword', 'Thrust');
    expect(blow.direction).toBe('Thrust');
    expect(blow).not.toHaveProperty('cut');
  });

  it('a Sledge Hammer does not cut, even with its Head', () => {
    expect(deadly.weapons['Sledge Hammer']!.cuts).toBe(false);
    const { hit, blow } = kill('Sledge Hammer', 'Overhead');
    expect(hit.head).toBe(true);
    expect(blow).not.toHaveProperty('cut');
  });

  it('a Hit with the shaft behind the Head does not cut', () => {
    const { hit, blow } = kill('Halberd', 'Overhead', [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: -0.2, z: 1.1 }, facing: Math.PI }]);
    expect(hit.head).toBe(false);
    expect(blow).not.toHaveProperty('cut');
  });

  it('a Throwing Dagger does not cut', () => {
    let s = createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 5 }, facing: 0 }]);
    s = { ...s, fighters: s.fighters.map((f, i) => (i === 1 ? { ...f, hp: 1 } : f)) };
    const t = s.fighters[1]!;
    const dagger = { owner: 0, team: s.fighters[0]!.team, thrownAt: 0, position: { x: t.position.x, y: t.y + 1.1, z: t.position.z - 0.15 }, velocity: { x: 0, y: 0, z: 18 }, ticks: 3 };
    s = step({ ...s, daggers: [dagger] }, [IDLE_INTENT, IDLE_INTENT], tuning);
    const blow = s.fighters[1]!.death!.blow!;
    expect(blow.direction).toBe('Thrust');
    expect(blow).not.toHaveProperty('cut');
  });

  it('a Fall does not cut: it has no blow at all', () => {
    // A ledge with an Abyss in front of it: Fighter 0 jumps off it.
    const ledge = parseArena(
      {
        name: 'abyss',
        walk: [
          { id: 'WALK_ledge', points: [[-3, 0, -3], [3, 0, -3], [3, 0, 0], [-3, 0, 0]] },
          { id: 'WALK_abyss', abyss: true, points: [[-10, -1, 0], [10, -1, 0], [10, -1, 20], [-10, -1, 20]] },
        ],
        walls: [],
      },
      'abyss',
    );
    const t = { ...tuning, arenas: { ...tuning.arenas, abyss: ledge } };
    let s = createInitialState(t, 1, [{ position: { x: 0, z: -0.3 }, facing: 0 }, { position: { x: 0, z: -2.5 }, facing: 0 }], [], [], 'abyss');
    s = step(s, [{ ...IDLE_INTENT, jump: true, move: { x: 0, z: 1 } }, IDLE_INTENT], t);
    for (let n = 0; n < 200 && !s.fighters[0]!.death; n++) s = step(s, [{ ...IDLE_INTENT, move: { x: 0, z: 1 } }, IDLE_INTENT], t);
    expect(s.fighters[0]!.death).toMatchObject({ cause: 'Fall', blow: null });
  });

  it('a Weapon made not to cut does not cut', () => {
    const blunt = withWeapon(deadly, { cuts: false });
    const run = runDuel(blunt, { distance: 1.3, a: attack('Overhead'), b: [] });
    const blow = run.final.fighters[1]!.death!.blow!;
    expect(blow).not.toHaveProperty('cut');
  });
});
