/**
 * The pace Mods, `walkSpeed` and `windUp`: the Slow Quirk's body (docs/plans/enemy-behaviours.md, Stage 5). A Slow Fighter walks 0.7× and
 * its Attack Wind-ups last 1.35× (in whole Ticks); its Release, Recovery, Jumps and flight are as anyone's. A Fighter without them stores,
 * hashes and plays exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { attackTimings, createInitialState, DIRECTIONS, duelPlacements, fighterTuning, foldMods, hashValue, hold, IDLE_INTENT, NO_MODS, restore, runScript, setMods, snapshot, step, storedMods, wait, walk, windUpTuning, type Direction, type SimState, type Track } from './index';
import { quirkMods } from './delver';
import { JUMP_SPOTS } from './jumpSpots.testdata';

const tuning = loadTuningData();
/** The Slow Quirk's Mods, as a Fighter stores them. */
const SLOW = storedMods(quirkMods(tuning, ['Slow']));

/** `s` with Fighter `i` given `mods`. */
const withMods = (s: SimState, mods: typeof SLOW, i = 0): SimState => ({ ...s, fighters: s.fighters.map((f, k) => (k === i ? { ...f, mods } : f)) });

/** Two Fighters 6 m apart (out of each other's reach), Fighter 0 wielding `weapon`. */
const apart = (weapon: string) => createInitialState(tuning, 1, duelPlacements(6), [weapon, weapon]);

/** The Ticks Fighter 0 spends in each Attack phase over a run, and its blade on each Tick. */
function phases(states: readonly SimState[]) {
  const ticks = { 'Wind-up': 0, Release: 0, Recovery: 0 };
  for (const s of states.slice(1)) {
    const a = s.fighters[0]!.action;
    if (a.kind === 'Attack') ticks[a.phase]++;
  }
  return ticks;
}

describe('Slow: the Quirk, and its Mods', () => {
  it('is walkSpeed 0.7 and windUp 1.35, stored with the other Mods at their identity', () => {
    expect(SLOW).toEqual({ ...NO_MODS, walkSpeed: 0.7, windUp: 1.35 });
  });

  it("stores a Fighter's Mods without the pace Mods at 1, so every Mods record made before them stores and hashes as it did", () => {
    const old = ['blockImpactTaken', 'damage', 'damageTaken', 'daggerDamage', 'daggers', 'healOnClear', 'healOnKill', 'heavyDamage', 'kickDamage', 'maxHp'].sort();
    const relics = foldMods(tuning.relics.slice(0, 3));
    expect(Object.keys(storedMods(relics)).sort()).toEqual(old);
    const f = createInitialState(tuning, 1).fighters[0]!;
    expect(Object.keys(setMods(f, relics, 100).mods!).sort()).toEqual(old);
    // NO_MODS stores nothing at all.
    expect('mods' in setMods(f, NO_MODS, 100)).toBe(false);
    expect('mods' in setMods(f, storedMods(NO_MODS), 100)).toBe(false);
    // A Fighter without a windUp Mod plays by the standard Tuning Data itself.
    expect(fighterTuning(tuning, f)).toBe(tuning);
    expect(windUpTuning(tuning, 1)).toBe(tuning);
  });
});

describe('Slow: the walk', () => {
  it('walks 0.7× as far each Tick on the ground, forward, sideways and back', () => {
    for (const move of [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }]) {
      const track: Track = walk(40, move);
      const plain = runScript(tuning, apart('Longsword'), [track, []], 40).states;
      const slow = runScript(tuning, withMods(apart('Longsword'), SLOW), [track, []], 40).states;
      for (let k = 2; k <= 40; k++) {
        const d = (s: readonly SimState[]) => Math.hypot(s[k]!.fighters[0]!.position.x - s[k - 1]!.fighters[0]!.position.x, s[k]!.fighters[0]!.position.z - s[k - 1]!.fighters[0]!.position.z);
        expect(d(slow) / d(plain), `${JSON.stringify(move)} Tick ${k}`).toBeCloseTo(0.7, 12);
      }
    }
  });
});

describe('Slow: the Wind-up', () => {
  it("lasts 1.35× in whole Ticks for every Weapon's every Attack; its Release and Recovery are Tick for Tick the same, and so is its blade", () => {
    for (const weapon of Object.keys(tuning.weapons))
      for (const direction of (tuning.weapons[weapon]!.attacks ?? DIRECTIONS) as Direction[]) {
        const track: Track = hold(1, { attack: true, direction });
        const plain = runScript(tuning, apart(weapon), [track, []], 120).states;
        const slow = runScript(tuning, withMods(apart(weapon), SLOW), [track, []], 120).states;
        const p = phases(plain);
        const s = phases(slow);
        const what = `${weapon} ${direction}`;
        // The Wind-up's Ticks (its playhead's, `windUpEnd`, at its Weapon's own Tempo) times 1.35, rounded. The phase is seen on one Tick
        // more than that: the Tick it starts on, at playhead 0.
        const w = attackTimings(tuning, weapon, direction).windUpEnd;
        expect(p['Wind-up'], what).toBe(w + 1);
        expect(s['Wind-up'] - 1, what).toBe(Math.round(w * 1.35));
        expect(Math.abs((s['Wind-up'] - 1) / w - 1.35), what).toBeLessThanOrEqual(0.5 / w);
        expect(s.Release, what).toBe(p.Release);
        expect(s.Recovery, what).toBe(p.Recovery);
        // attackTimings (what the AI and the drawing read) agrees with what was played.
        const t = attackTimings(fighterTuning(tuning, slow[0]!.fighters[0]!), weapon, direction);
        expect(t.windUpEnd - attackTimings(tuning, weapon, direction).windUpEnd, what).toBe(s['Wind-up'] - p['Wind-up']);
        // From the end of the Wind-up on, the blade is where it would be, the extra Ticks later, bit for bit (the held Wind-up pose, then
        // the whole Release and Recovery).
        const shift = s['Wind-up'] - p['Wind-up'];
        for (let k = p['Wind-up']; k <= p['Wind-up'] + p.Release + p.Recovery; k++) expect(slow[k + shift]!.fighters[0]!.blade, `${what} Tick ${k}`).toEqual(plain[k]!.fighters[0]!.blade);
      }
  });

  it("lands its Hits with the same Blade Speed for every Weapon's every Attack, a Flail let go at once with the same Spin-up charge", () => {
    for (const weapon of Object.keys(tuning.weapons))
      for (const direction of (tuning.weapons[weapon]!.attacks ?? DIRECTIONS) as Direction[]) {
        const near = createInitialState(tuning, 1, duelPlacements(weapon === 'Dagger' ? 0.9 : 1.3), [weapon, weapon]);
        const track: Track = hold(1, { attack: true, direction });
        // The normal one presses the extra Wind-up Ticks later, so both Releases meet the same (idly swaying) target on the same Tick.
        const shift = attackTimings(windUpTuning(tuning, 1.35), weapon, direction).windUpEnd - attackTimings(tuning, weapon, direction).windUpEnd;
        const hitOf = (initial: SimState, t: Track) => runScript(tuning, initial, [t, []], 120).events.find((e) => e.type === 'Hit');
        const plain = hitOf(near, [...wait(shift), ...track]);
        const slow = hitOf(withMods(near, SLOW), track);
        const what = `${weapon} ${direction}`;
        expect(plain, what).toBeDefined();
        const lastWindUp = (initial: SimState) => runScript(tuning, initial, [track, []], 60).states.filter((st) => st.fighters[0]!.action.kind === 'Attack' && (st.fighters[0]!.action as { phase: string }).phase === 'Wind-up').at(-1)!.fighters[0]!.action;
        expect((lastWindUp(withMods(near, SLOW)) as { charge?: number }).charge, what).toBe((lastWindUp(near) as { charge?: number }).charge);
        expect(slow?.type === 'Hit' && [slow.tick, slow.bladeSpeed, slow.damage], what).toEqual(plain?.type === 'Hit' && [plain.tick, plain.bladeSpeed, plain.damage]);
      }
  });

  it('leaves a Kick, a Throw and a Feint-free Block exactly as they were (only an Attack Motion plays at a Tempo)', () => {
    for (const intent of [{ kick: true }, { throw: true }, { block: true }]) {
      const track: Track = hold(30, intent);
      const plain = runScript(tuning, apart('Longsword'), [track, []], 90).states;
      const slow = runScript(tuning, withMods(apart('Longsword'), SLOW), [track, []], 90).states;
      expect(slow.map((st) => [st.fighters[0]!.action, st.fighters[0]!.blade]), JSON.stringify(intent)).toEqual(plain.map((st) => [st.fighters[0]!.action, st.fighters[0]!.blade]));
    }
  });
});

describe('Slow: Jumping is unchanged', () => {
  /** A Fighter at a held-Jump spot of docs/jump-reach.md jumping as the spot says: its flight, and the height it lands at. */
  function leap(t: TuningData, s: (typeof JUMP_SPOTS)[number], mods?: typeof SLOW) {
    const start = createInitialState(t, 1, [{ position: { x: s.x, z: s.z }, y: s.y, facing: Math.atan2(s.move.x, s.move.z) }], [], [0], s.arena);
    let st = mods ? withMods(start, mods) : start;
    const flight: SimState['fighters'][number][] = [];
    for (let k = 0; k < 240; k++) {
      st = step(st, [{ ...IDLE_INTENT, move: s.move, jump: k === 0, jumpHeld: k <= s.hold }], t);
      const f = st.fighters[0]!;
      flight.push(f);
      if (k > 0 && !f.air) break;
    }
    return flight;
  }

  it('takes off and flies Tick for Tick as a normal Fighter does from every held-Jump spot, and lands on the same lid', () => {
    for (const s of JUMP_SPOTS) {
      const plain = leap(tuning, s);
      const slow = leap(tuning, s, SLOW);
      const where = `${s.arena}: ${s.spot}`;
      expect(slow.map((f) => [f.position, f.y, f.air]), where).toEqual(plain.map((f) => [f.position, f.y, f.air]));
      expect(slow.at(-1)!.y, where).toBeCloseTo(s.lid, 6);
    }
  });
});

describe('Slow: rollback and the hash', () => {
  it('a snapshot of a Slow Fighter restores to the same hash and steps on to the same states; the hash tells it from a normal one', () => {
    const plain = apart('Longsword');
    const slow = withMods(plain, SLOW);
    expect(hashValue(slow)).not.toBe(hashValue(plain));
    const intents = [{ ...IDLE_INTENT, move: { x: 0, z: 1 }, attack: true }, IDLE_INTENT];
    let a = slow;
    for (let k = 0; k < 10; k++) a = step(a, intents, tuning);
    let b = restore(snapshot(a));
    expect(hashValue(b)).toBe(hashValue(a));
    for (let k = 0; k < 40; k++) {
      a = step(a, intents, tuning);
      b = step(b, intents, tuning);
    }
    expect(hashValue(b)).toBe(hashValue(a));
    expect(a.fighters[0]!.mods).toEqual(SLOW);
  });
});
