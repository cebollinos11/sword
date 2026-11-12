import { describe, expect, it } from 'vitest';
import { loadTuningData, spinUpChargeTicks, weaponByName, whirlTurns, withWeapon } from '../tuning';
import { attack, createInitialState, duelPlacements, hold, IDLE_INTENT, runDuel, step, wait, type Intent, type SimState, type Track } from '../sim';
import { arenaSurface, matchCues, soundCues, type SoundCue } from './cues';
import { CHEST } from './spatial';
import { stockFor } from './stock';

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
      { sound: 'Hit', defender: 1, zone: 'head', strength: expect.any(Number), by: 'Edge', at: expect.any(Object) },
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
    expect(kick).toEqual([{ sound: 'Hit', defender: 1, zone: 'torso', strength: expect.any(Number), by: 'Kick', at: point }]);
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
      { sound: 'Jump', fighter: 1, surface: 'snow', at: expect.any(Object) },
      { sound: 'Land', fighter: 1, strength: expect.any(Number), surface: 'snow', at: expect.any(Object) },
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
      { sound: 'Kick', fighter: 0, at: expect.any(Object) },
      { sound: 'BodyFall', fighter: 1, surface: 'wood', at: expect.any(Object) },
      { sound: 'Death', fighter: 1, cause: 'Water', at: expect.any(Object) },
    ]);
  });

  it('the blow that ends a Duel sounds before the Death, and the Death before the Duel ends', () => {
    const run = runDuel(withWeapon(tuning, { damage: 10_000 }), { distance: 1.2, a: attack('Overhead'), b: [] });
    const cues = run.states.flatMap((s) => soundCues(s.events, s)).map((c) => c.sound);
    expect(cues).toEqual(['Swing', 'Hit', 'Death', 'DuelEnd']);
  });
});

describe('Where sounds happen', () => {
  it("a Fighter's own sounds come from its chest, and a contact's from where the blades or bodies met", () => {
    const state = createInitialState(tuning, 1, duelPlacements(2));
    const b = state.fighters[1]!;
    const point = { x: 0.3, y: 1.5, z: 0.6 };
    const [swing, hit] = soundCues(
      [
        { type: 'AttackPhase', fighter: 1, direction: 'Left', phase: 'Release' },
        { type: 'Hit', attacker: 1, defender: 0, direction: 'Left', zone: 'torso', point, bladeSpeed: 8, head: true, heavy: false, damage: 10 },
      ],
      state,
    );
    expect(swing!.sound === 'Swing' && swing!.at).toEqual({ x: b.position.x, y: b.y + CHEST, z: b.position.z });
    expect(hit!.sound === 'Hit' && hit!.at).toEqual(point);
  });

  it("without the state, a Fighter's sounds have no place (heard as if at the ears)", () => {
    const [swing] = soundCues([{ type: 'AttackPhase', fighter: 0, direction: 'Left', phase: 'Release' }]);
    expect(swing!.sound === 'Swing' && swing!.at).toBeUndefined();
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
      { sound: 'Hit', defender: 1, zone: 'torso', strength: expect.any(Number), by: 'Dagger', at: point },
    ]);
    expect(soundCues([{ type: 'DaggerBlocked', thrower: 0, defender: 1, point }])).toEqual([
      { sound: 'Clink', defender: 1, at: point },
      { sound: 'Ricochet', defender: 1, at: point },
    ]);
    expect(soundCues([{ type: 'DaggerStuck', point, direction: { x: 0, y: 0, z: 1 } }])).toEqual([{ sound: 'Thunk', point, surface: 'stone', at: point }]);
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
      { sound: 'Sheathe', fighter: 0, weight: expect.any(Number), at: expect.any(Object) },
      { sound: 'Draw', fighter: 0, weight: expect.any(Number), at: expect.any(Object) },
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

describe('the Flail’s sounds (docs/plans/flail.md, Stage 3)', () => {
  const flail = weaponByName(tuning, 'Flail');
  const FULL = spinUpChargeTicks(flail);
  const solo = (a: Track, weapon = 'Flail') => runDuel(tuning, { placements: [{ position: { x: 0, z: 0 }, facing: 0 }], weapons: [weapon], a });
  const whirls = (run: { states: readonly SimState[] }) =>
    run.states.flatMap((s, k) => soundCues(s.events, s, tuning).flatMap((c) => (c.sound === 'Whirl' ? [{ ...c, k }] : [])));

  it('whooshes once each time the whirl passes a whole turn, on the Tick it does, louder and higher with the charge', () => {
    const held = FULL + 150;
    const run = solo([...attack('Left', held), ...wait(80)]);
    const cues = whirls(run);
    // Wind-up state k (Tick k) has charge k - 1 (to full): a whoosh wherever its angle passes a whole turn from the last Tick's, and
    // nowhere else (not as the Wind-up starts, not in Release or Recovery).
    const turns = (k: number) => whirlTurns(flail, run.states[k]!.tick, Math.min(k - 1, FULL));
    const expected = Array.from({ length: held + 1 }, (_, k) => k).filter((k) => k >= 2 && Math.floor(turns(k)) > Math.floor(turns(k - 1)));
    expect(cues.map((c) => c.k)).toEqual(expected);
    expect(cues.length).toBe(Math.floor(turns(held)) - Math.floor(turns(1)));
    expect(cues.length).toBeGreaterThan(5);
    // Its charge is the Spin-up's share of full: rising, then held at 1.
    for (const c of cues) {
      const a = run.states[c.k]!.fighters[0]!.action;
      expect(c.charge).toBeCloseTo(Math.min(1, (a.kind === 'Attack' ? a.charge! : 0) / FULL), 12);
      expect(c).toMatchObject({ sound: 'Whirl', fighter: 0 });
    }
    for (let j = 1; j < cues.length; j++) expect(cues[j]!.charge).toBeGreaterThanOrEqual(cues[j - 1]!.charge);
    expect(cues[0]!.charge).toBeLessThan(0.6);
    expect(cues[cues.length - 1]!.charge).toBe(1);
    // The whooshes come quicker as the charge builds, and evenly once full.
    const gaps = cues.slice(1).map((c, j) => c.k - cues[j]!.k);
    expect(gaps[0]!).toBeGreaterThan(gaps[gaps.length - 1]!);
    const full = cues.filter((c) => c.charge === 1).slice(1);
    const fullGaps = full.slice(1).map((c, j) => c.k - full[j]!.k);
    expect(Math.max(...fullGaps) - Math.min(...fullGaps)).toBeLessThanOrEqual(1);
  });

  it('a tap whirls less than a turn and makes no whoosh; an Attack Feint carries the whirl on without a stray whoosh', () => {
    expect(whirls(solo([...attack('Overhead', 1), ...wait(80)]))).toEqual([]);
    const straight = whirls(solo([...attack('Left', FULL + 40), ...wait(60)]));
    const feinted = whirls(solo([...hold(50, { attack: true, direction: 'Left' }), ...hold(FULL - 10, { attack: true, direction: 'Right' }), ...wait(60)]));
    expect(feinted.map((c) => c.k)).toEqual(straight.map((c) => c.k));
  });

  it('is heard only with the Tuning Data to know the Weapon by, and never from another Weapon', () => {
    const run = solo([...attack('Left', FULL + 60), ...wait(20)]);
    expect(run.states.flatMap((s) => soundCues(s.events, s)).filter((c) => c.sound === 'Whirl')).toEqual([]);
    for (const weapon of Object.keys(tuning.weapons).filter((w) => w !== 'Flail')) expect(whirls(solo([...attack('Left', 200), ...wait(20)], weapon)), weapon).toEqual([]);
  });

  it('its ball lands with a heavy spiked thud, its shaft as any shaft; its Block and WallStrike rattle its chain', () => {
    const at = (d: number, weapons: [string, string], b: Track = wait(1)) =>
      runDuel(tuning, {
        placements: [
          { position: { x: 0, z: 0 }, facing: 0 },
          { position: { x: 0, z: d }, facing: Math.PI },
        ],
        weapons,
        a: attack('Overhead', 30),
        b,
        ticks: 160,
      });
    const cuesOf = (run: { states: readonly SimState[] }) => run.states.flatMap((s) => soundCues(s.events, s, tuning)).filter((c) => c.sound !== 'Whirl');
    const ball = cuesOf(at(1.9, ['Flail', 'Arming Sword'])).find((c) => c.sound === 'Hit');
    expect(ball).toMatchObject({ sound: 'Hit', by: 'Ball' });
    const shaft = cuesOf(at(1.1, ['Flail', 'Arming Sword'])).find((c) => c.sound === 'Hit');
    expect(shaft).toMatchObject({ sound: 'Hit', by: 'Shaft' });
    const blocked = cuesOf(at(2.2, ['Flail', 'Arming Sword'], hold(150, { block: true, direction: 'Overhead' }))).find((c) => c.sound === 'Block');
    expect(blocked).toMatchObject({ sound: 'Block', chain: true });
    // A WallStrike by the Flail (its event, against the Flail's state).
    const state = at(2.2, ['Flail', 'Arming Sword']).final;
    const wall = soundCues([{ type: 'WallStrike', attacker: 0, direction: 'Left', point: { x: 0, y: 1, z: 1 }, bladeSpeed: 8 }], state, tuning);
    expect(wall).toEqual([{ sound: 'WallStrike', strength: expect.any(Number), surface: 'stone', at: { x: 0, y: 1, z: 1 }, chain: true }]);
    // Defending with a Flail is no Flail blow: the attacker's Weapon decides.
    const defended = cuesOf(at(1.3, ['Arming Sword', 'Flail'], hold(150, { block: true, direction: 'Overhead' }))).find((c) => c.sound === 'Block');
    expect(defended && 'chain' in defended).toBe(false);
    // Played: the ball's thud from the deep stock blow, pitched down; its shaft as before.
    expect(stockFor(ball!)).toMatchObject({ clip: 'heavy-hit' });
    expect(stockFor(ball!)!.rate).toBeLessThan(1);
  });

  it('every other Weapon sounds exactly as before, with the Tuning Data or without', () => {
    for (const weapon of Object.keys(tuning.weapons).filter((w) => w !== 'Flail')) {
      const runs = [
        runDuel(tuning, { distance: 1.3, weapons: [weapon, 'Arming Sword'], a: [...attack('Overhead', 40), ...wait(40), ...attack('Left', 10)], b: [...wait(70), ...hold(60, { block: true, direction: 'Right' })] }),
        runDuel(tuning, { distance: 1.3, weapons: [weapon, 'Flail'], a: attack('Right', 20), b: [] }),
      ];
      for (const run of runs) {
        const plain = run.states.flatMap((s) => soundCues(s.events, s));
        expect(run.states.flatMap((s) => soundCues(s.events, s, tuning)), weapon).toEqual(plain);
        expect(plain.length, weapon).toBeGreaterThan(0);
        expect(plain.some((c) => 'chain' in c || (c.sound === 'Hit' && c.by === 'Ball')), weapon).toBe(false);
      }
    }
  });
});
