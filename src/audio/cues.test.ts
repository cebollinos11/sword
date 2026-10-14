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
