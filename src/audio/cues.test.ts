import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon } from '../tuning';
import { attack, createInitialState, duelPlacements, hold, IDLE_INTENT, runDuel, step, type Intent, type SimState } from '../sim';
import { arenaSurface, matchCues, soundCues, type SoundCue } from './cues';

const tuning = loadTuningData();

describe('soundCues', () => {
  it('an Attack entering Release plays the swing sound, and a Block plays the Block sound', () => {
    const run = runDuel(tuning, { distance: 1.3, a: attack('Overhead'), b: hold(120, { block: true, direction: 'Overhead' }) });
    const cues = run.states.flatMap((s) => soundCues(s.events));
    expect(cues.map((c) => c.sound)).toEqual(['Swing', 'Block']);
  });

  it('a Hit plays the hit sound, louder for a harder Hit', () => {
    // From 1.2 m, 0.2 m to the sword side, an Overhead hits the head; 0.2 m to the other side it only clips a limb.
    const head = runDuel(tuning, {
      placements: [
        { position: { x: 0, z: 0 }, facing: 0 },
        { position: { x: -0.2, z: 1.2 }, facing: Math.PI },
      ],
      a: attack('Overhead'),
      b: [],
    });
    const limb = runDuel(tuning, {
      placements: [
        { position: { x: 0, z: 0 }, facing: 0 },
        { position: { x: 0.2, z: 1.2 }, facing: Math.PI },
      ],
      a: attack('Overhead'),
      b: [],
    });
    const headCues = head.states.flatMap((s) => soundCues(s.events));
    const limbCues = limb.states.flatMap((s) => soundCues(s.events));
    expect(headCues).toEqual([
      { sound: 'Swing', fighter: 0, direction: 'Overhead', weight: expect.any(Number) },
      { sound: 'Hit', defender: 1, zone: 'head', strength: expect.any(Number), by: 'Edge' },
    ]);
    expect(limbCues[1]).toMatchObject({ sound: 'Hit', zone: 'limbs' });
    const strength = (c: (typeof headCues)[number] | undefined) => (c?.sound === 'Hit' ? c.strength : NaN);
    expect(strength(headCues[1])).toBeLessThanOrEqual(1);
    expect(strength(limbCues[1])).toBeGreaterThan(0);
    expect(strength(headCues[1])).toBeGreaterThan(strength(limbCues[1]));
  });

  it('Wind-up and Recovery and Stagger make no sound of their own', () => {
    expect(
      soundCues([
        { type: 'AttackPhase', fighter: 0, direction: 'Left', phase: 'Wind-up' },
        { type: 'AttackPhase', fighter: 0, direction: 'Left', phase: 'Recovery' },
        { type: 'Stagger', fighter: 1, cause: 'Hit' },
      ]),
    ).toEqual([]);
  });

  it('a heavier Weapon swings heavier', () => {
    const weight = (weapon: string) => {
      const run = runDuel(tuning, { distance: 4, weapons: [weapon, weapon], a: attack('Overhead'), b: [] });
      const swing = run.states.flatMap((s) => soundCues(s.events, s)).find((c) => c.sound === 'Swing');
      return swing?.sound === 'Swing' ? swing.weight : NaN;
    };
    expect(weight('Halberd')).toBeGreaterThan(weight('Longsword'));
    expect(weight('Longsword')).toBeGreaterThanOrEqual(weight('Arming Sword'));
    expect(weight('Halberd')).toBeLessThanOrEqual(1);
    expect(weight('Arming Sword')).toBeGreaterThanOrEqual(0);
  });

  it('a Chamber clashes, a Feint flicks, a Kick that fells knocks down, a shaft whacks, and the Duel ending sounds', () => {
    const point = { x: 0, y: 1, z: 0 };
    expect(
      soundCues([
        { type: 'Chamber', chamberer: 1, attacker: 0, direction: 'Left', point },
        { type: 'Feint', fighter: 0, from: 'Left', into: { kind: 'Block', direction: 'Left' } },
        { type: 'KickLanded', attacker: 0, defender: 1, outcome: 'Knockdown', zone: 'torso', point, damage: 5 },
        { type: 'Hit', attacker: 0, defender: 1, direction: 'Left', zone: 'limbs', point, bladeSpeed: 8, head: false, heavy: false, damage: 6 },
        { type: 'DuelEnd', winner: 0 },
      ]).map((c) => c.sound),
    ).toEqual(['Chamber', 'Feint', 'Hit', 'Knockdown', 'Hit', 'DuelEnd']);
    const kick = soundCues([{ type: 'KickLanded', attacker: 0, defender: 1, outcome: 'Shove', zone: 'torso', point, damage: 1 }]);
    expect(kick).toEqual([{ sound: 'Hit', defender: 1, zone: 'torso', strength: expect.any(Number), by: 'Kick' }]);
    const shaft = soundCues([{ type: 'Hit', attacker: 0, defender: 1, direction: 'Left', zone: 'limbs', point, bladeSpeed: 8, head: false, heavy: false, damage: 6 }]);
    expect(shaft[0]).toMatchObject({ by: 'Shaft' });
  });
});

describe('Footsteps and floors', () => {
  it("each Arena's floor has its own voice; an unknown one is stone", () => {
    expect(arenaSurface('library')).toBe('wood');
    expect(arenaSurface('ship')).toBe('wood');
    expect(arenaSurface('chamber')).toBe('metal');
    expect(arenaSurface('train')).toBe('metal');
    expect(arenaSurface('summit')).toBe('snow');
    expect(arenaSurface('circle')).toBe('stone');
    expect(arenaSurface(undefined)).toBe('stone');
  });

  it('jumps and landings sound on the floor of the Arena, and steps are silent', () => {
    const state = { ...createInitialState(tuning, 1, duelPlacements(2)), arena: 'summit' };
    const cues = soundCues(
      [
        { type: 'Step', fighter: 0, foot: 'left', position: { x: 0, z: 0 } },
        { type: 'Jump', fighter: 1 },
        { type: 'Land', fighter: 1, height: 1, damage: 0 },
      ],
      state,
    );
    expect(cues).toEqual([
      { sound: 'Jump', fighter: 1, surface: 'snow' },
      { sound: 'Land', fighter: 1, strength: expect.any(Number), surface: 'snow' },
    ]);
  });
});

describe('Kicks, Knockdowns and Deaths', () => {
  it('a Kick snapping out, a body hitting the floor and a Death each sound on their event', () => {
    const state = { ...createInitialState(tuning, 1, duelPlacements(2)), arena: 'ship' };
    expect(
      soundCues(
        [
          { type: 'KickPhase', fighter: 0, phase: 'Wind-up' },
          { type: 'KickPhase', fighter: 0, phase: 'Release' },
          { type: 'KickPhase', fighter: 0, phase: 'Recovery' },
          { type: 'KnockdownPhase', fighter: 1, phase: 'Down' },
          { type: 'KnockdownPhase', fighter: 1, phase: 'Rising' },
          { type: 'Death', fighter: 1, cause: 'Water' },
        ],
        state,
      ),
    ).toEqual([
      { sound: 'Kick', fighter: 0 },
      { sound: 'BodyFall', fighter: 1, surface: 'wood' },
      { sound: 'Death', fighter: 1, cause: 'Water' },
    ]);
  });

  it('the blow that ends a Duel sounds before the Death, and the Death before the Duel ends', () => {
    const run = runDuel(withWeapon(tuning, { damage: 10_000 }), { distance: 1.2, a: attack('Overhead'), b: [] });
    const cues = run.states.flatMap((s) => soundCues(s.events, s)).map((c) => c.sound);
    expect(cues).toEqual(['Swing', 'Hit', 'Death', 'DuelEnd']);
  });
});

describe('Match sounds', () => {
  it('a Duel starting and a Match won sound', () => {
    expect(matchCues([{ type: 'DuelStart', duelNumber: 2 }])).toEqual([{ sound: 'DuelStart', duelNumber: 2 }]);
    expect(matchCues([{ type: 'MatchEnd', winner: 1, score: [0, 2] }])).toEqual([{ sound: 'MatchEnd', winner: 1 }]);
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
      { sound: 'Hit', defender: 1, zone: 'torso', strength: expect.any(Number), by: 'Dagger' },
    ]);
    expect(soundCues([{ type: 'DaggerBlocked', thrower: 0, defender: 1, point }])).toEqual([
      { sound: 'Clink', defender: 1 },
      { sound: 'Ricochet', defender: 1 },
    ]);
    expect(soundCues([{ type: 'DaggerStuck', point, direction: { x: 0, y: 0, z: 1 } }])).toEqual([{ sound: 'Thunk', point, surface: 'stone' }]);
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

describe('Sheathe and Draw sounds', () => {
  const step1 = (s: SimState, intent: Partial<Intent> = {}) => step(s, [{ ...IDLE_INTENT, ...intent }], tuning);
  /** Every cue of a Fighter who Sheathes, waits, then Draws (by pressing Attack). */
  const sheatheThenDraw = (weapon: string) => {
    let s = createInitialState(tuning, 1, undefined, [weapon]);
    const cues: SoundCue[] = [];
    const run = (n: number, intent: Partial<Intent> = {}) => {
      for (let i = 0; i < n; i++) {
        s = step1(s, i === 0 ? intent : {});
        cues.push(...soundCues(s.events, s));
      }
    };
    run(120, { sheathe: true });
    expect(s.fighters[0]!.sheathed).toBe(true);
    run(120, { attack: true, direction: 'Overhead' });
    expect(s.fighters[0]!.sheathed).toBe(false);
    return cues;
  };

  it('the Weapon sliding into its slot and out again each sound once, on the swap', () => {
    const cues = sheatheThenDraw('Arming Sword');
    expect(cues).toEqual([
      { sound: 'Sheathe', fighter: 0, weight: expect.any(Number) },
      { sound: 'Draw', fighter: 0, weight: expect.any(Number) },
    ]);
  });

  it('a heavier Weapon slides heavier', () => {
    const weight = (weapon: string) => {
      const c = sheatheThenDraw(weapon)[0]!;
      return c.sound === 'Sheathe' ? c.weight : NaN;
    };
    expect(weight('Halberd')).toBeGreaterThan(weight('Arming Sword'));
  });

  it('the Sheathed and Drawn events map to their cues', () => {
    expect(soundCues([{ type: 'Sheathed', fighter: 1 }, { type: 'Drawn', fighter: 0 }])).toEqual([
      { sound: 'Sheathe', fighter: 1, weight: 0.3 },
      { sound: 'Draw', fighter: 0, weight: 0.3 },
    ]);
  });
});
