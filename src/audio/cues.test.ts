import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { attack, hold, runDuel } from '../sim';
import { soundCues } from './cues';

const tuning = loadTuningData();

describe('soundCues', () => {
  it('an Attack entering Release plays the swing sound, and a Block plays the Block sound', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    const cues = run.states.flatMap((s) => soundCues(s.events));
    expect(cues.map((c) => c.sound)).toEqual(['Swing', 'Block']);
  });

  it('a Hit plays the hit sound, louder for a harder Hit', () => {
    // From 1.2 m an Overhead hits the head; offset 0.3 m sideways it only clips a limb.
    const head = runDuel(tuning, { distance: 1.2, a: attack('Overhead'), b: [] });
    const limb = runDuel(tuning, {
      placements: [
        { position: { x: 0, z: 0 }, facing: 0 },
        { position: { x: 0.3, z: 1.2 }, facing: Math.PI },
      ],
      a: attack('Overhead'),
      b: [],
    });
    const headCues = head.states.flatMap((s) => soundCues(s.events));
    const limbCues = limb.states.flatMap((s) => soundCues(s.events));
    expect(headCues).toEqual([
      { sound: 'Swing', fighter: 0, direction: 'Overhead' },
      { sound: 'Hit', defender: 1, zone: 'head', strength: expect.any(Number) },
    ]);
    expect(limbCues[1]).toMatchObject({ sound: 'Hit', zone: 'limbs' });
    const strength = (c: (typeof headCues)[number] | undefined) => (c?.sound === 'Hit' ? c.strength : NaN);
    expect(strength(headCues[1])).toBeLessThanOrEqual(1);
    expect(strength(limbCues[1])).toBeGreaterThan(0);
    expect(strength(headCues[1])).toBeGreaterThan(strength(limbCues[1]));
  });

  it('Wind-up and Recovery, Stagger and the end of the Duel make no sound of their own', () => {
    expect(
      soundCues([
        { type: 'AttackPhase', fighter: 0, direction: 'Left', phase: 'Wind-up' },
        { type: 'AttackPhase', fighter: 0, direction: 'Left', phase: 'Recovery' },
        { type: 'Stagger', fighter: 1, cause: 'Hit' },
        { type: 'DuelEnd', winner: 0 },
      ]),
    ).toEqual([]);
  });
});

describe('Landing sounds', () => {
  it('a Landing thuds, harder for a deeper drop; a tiny drop is silent', () => {
    const land = (height: number) => soundCues([{ type: 'Land', fighter: 1, height, damage: 0 }]);
    expect(land(0.1)).toEqual([]);
    const soft = land(0.8)[0]!;
    const hard = land(4)[0]!;
    expect(soft).toMatchObject({ sound: 'Land', fighter: 1 });
    expect(hard.sound === 'Land' && soft.sound === 'Land' && hard.strength > soft.strength).toBe(true);
    expect(land(30)[0]).toMatchObject({ strength: 1 });
  });
});

describe('Dagger sounds', () => {
  const point = { x: 1, y: 1, z: 2 };
  it('a thrown dagger whooshes, a Hit thumps like any Hit, a Block clinks and a stuck dagger thunks', () => {
    expect(soundCues([{ type: 'DaggerThrown', thrower: 1 }])).toEqual([{ sound: 'Throw', fighter: 1 }]);
    expect(soundCues([{ type: 'DaggerHit', thrower: 0, defender: 1, zone: 'torso', point, damage: 5 }])).toEqual([
      { sound: 'Hit', defender: 1, zone: 'torso', strength: expect.any(Number) },
    ]);
    expect(soundCues([{ type: 'DaggerBlocked', thrower: 0, defender: 1, point }])).toEqual([{ sound: 'Clink', defender: 1 }]);
    expect(soundCues([{ type: 'DaggerStuck', point, direction: { x: 0, y: 0, z: 1 } }])).toEqual([{ sound: 'Thunk', point }]);
  });

  it('a harder dagger Hit is not quieter than a lighter one, and none is louder than the maximum', () => {
    const strength = (damage: number) => {
      const c = soundCues([{ type: 'DaggerHit', thrower: 0, defender: 1, zone: 'head', point, damage }])[0]!;
      return c.sound === 'Hit' ? c.strength : NaN;
    };
    expect(strength(10)).toBeGreaterThanOrEqual(strength(5));
    expect(strength(500)).toBe(1);
  });
});
