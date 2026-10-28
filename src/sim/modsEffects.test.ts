/**
 * A Fighter's `mods` (docs/plans/dungeon.md, Stage 2): every combat number reads the Fighter's own. Each effect changes exactly
 * its number, for a Fighter given those Mods directly through `setMods`; with none (`NO_MODS`) nothing is stored and nothing changes.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry, type RelicEffect } from '../tuning';
import {
  attack,
  createInitialState,
  duelPlacements,
  hashState,
  hold,
  IDLE_INTENT,
  isNoMods,
  mirrorDirection,
  modsOf,
  NO_MODS,
  runScript,
  setMods,
  step,
  type BlockEvent,
  type Direction,
  type HitEvent,
  type Intent,
  type Mods,
  type Placement,
  type ScriptRun,
  type SimState,
  type Track,
} from './index';
import type { DaggerState } from './state';
import { restore, snapshot } from './snapshot';

const base = loadTuningData();
const corner = (x: number, z: number) => ({ x, y: 0, z });
const flat: ArenaGeometry = { name: 'mods', walk: [{ id: 'floor', points: [corner(-60, -60), corner(-60, 60), corner(60, 60), corner(60, -60)] }], walls: [], spawns: [], doors: [] };
const tuning = { ...base, arenas: { ...base.arenas, mods: flat } };
const { dagger, kick, fighter, hitZones } = tuning;

/** Mods that change only the numbers given. */
const mods = (m: Partial<Record<RelicEffect, number>>): Mods => ({ ...NO_MODS, ...m });
/** `s` with Fighter `i` given `m` (max HP from `fighter.maxHp`). */
const armed = (s: SimState, i: number, m: Partial<Record<RelicEffect, number>>): SimState => ({ ...s, fighters: s.fighters.map((f, k) => (k === i ? setMods(f, mods(m), fighter.maxHp) : f)) });
const tick = (s: SimState, per: Record<number, Partial<Intent>> = {}): SimState => step(s, s.fighters.map((_, i) => ({ ...IDLE_INTENT, ...per[i] })), tuning);

describe('setMods', () => {
  const [f] = createInitialState(tuning, 1, duelPlacements(2)).fighters;

  it('stores nothing for NO_MODS, so a Fighter without Relics is exactly what it was', () => {
    const same = setMods(f!, NO_MODS, fighter.maxHp);
    expect(same).toEqual(f);
    expect('mods' in same).toBe(false);
    expect(modsOf(same)).toBe(NO_MODS);
    expect(isNoMods(mods({ damage: 1, daggers: 0 }))).toBe(true);
    expect(isNoMods(mods({ damage: 1.1 }))).toBe(false);
  });

  it('sets max HP to base × (1 + maxHp), keeps HP (never above it), and moves daggers by the change in `daggers`', () => {
    const s = setMods(f!, mods({ maxHp: 0.25, daggers: 2 }), fighter.maxHp);
    expect(s.maxHp).toBe(fighter.maxHp * 1.25);
    expect(s.hp).toBe(fighter.maxHp);
    expect(s.daggers).toBe(dagger.count + 2);
    expect(s.mods).toEqual(mods({ maxHp: 0.25, daggers: 2 }));
    // Taking them off again undoes it: a lower max HP clamps HP, the daggers go back, and `mods` is absent again.
    const full = { ...s, hp: s.maxHp };
    const off = setMods(full, NO_MODS, fighter.maxHp);
    expect(off).toMatchObject({ maxHp: fighter.maxHp, hp: fighter.maxHp, daggers: dagger.count });
    expect('mods' in off).toBe(false);
    // Daggers already thrown are not refilled by an equip.
    expect(setMods({ ...s, daggers: 1 }, mods({ daggers: 3 }), fighter.maxHp).daggers).toBe(2);
    expect(setMods({ ...f!, daggers: 0 }, mods({ daggers: 1 }), fighter.maxHp).daggers).toBe(1);
  });

  it('uses the base max HP it is given (an enemy\'s scaled one), and never mutates what it is given', () => {
    const frozen = mods({ maxHp: 0.5 });
    const s = setMods({ ...f!, hp: 30 }, frozen, 200);
    expect(s).toMatchObject({ maxHp: 300, hp: 30 });
    s.mods!.maxHp;
    expect(s.mods).not.toBe(frozen);
    expect(NO_MODS.maxHp).toBe(0);
  });
});

describe('the hash and Rollback', () => {
  const s0 = createInitialState(tuning, 1, duelPlacements(2));

  it('hashes differently for Fighters with different Mods, and the same for the same', () => {
    expect(hashState(armed(s0, 0, { damage: 1.1 }))).not.toBe(hashState(s0));
    expect(hashState(armed(s0, 0, { damage: 1.1 }))).not.toBe(hashState(armed(s0, 0, { damage: 1.2 })));
    expect(hashState(armed(s0, 0, { damage: 1.1 }))).not.toBe(hashState(armed(s0, 1, { damage: 1.1 })));
    expect(hashState(armed(s0, 0, { damage: 1.1 }))).toBe(hashState(armed(s0, 0, { damage: 1.1 })));
    expect(hashState(armed(s0, 0, {}))).toBe(hashState(s0));
  });

  it('a snapshot restores the Mods, and re-simulating from it matches', () => {
    let s = armed(armed(s0, 0, { damage: 1.5, healOnKill: 4, daggers: 1 }), 1, { damageTaken: 0.8 });
    const intents = (n: number): Partial<Intent>[] => [{ attack: n === 3, direction: 'Overhead' }, {}];
    for (let n = 0; n < 20; n++) s = tick(s, { 0: intents(n)[0]! });
    const snap = snapshot(s);
    const back = restore(snap);
    expect(back.fighters[0]!.mods).toEqual(s.fighters[0]!.mods);
    expect(back.fighters[1]!.mods).toEqual(s.fighters[1]!.mods);
    expect(hashState(back)).toBe(hashState(s));
    // The restored copy is independent of the original, and steps on to the same state.
    let a = s;
    let b = back;
    for (let n = 20; n < 120; n++) {
      a = tick(a, { 0: intents(n)[0]! });
      b = tick(b, { 0: intents(n)[0]! });
      expect(hashState(b)).toBe(hashState(a));
    }
  });
});

describe('a blade Hit', () => {
  const run = (a: Partial<Record<RelicEffect, number>>, b: Partial<Record<RelicEffect, number>>, weapon: string, d: Direction, distance: number, defence?: Track): ScriptRun => {
    const initial = armed(armed(createInitialState(tuning, 1, duelPlacements(distance), [weapon, 'Arming Sword']), 0, a), 1, b);
    return runScript(tuning, initial, [attack(d), defence ?? []]);
  };
  const hit = (r: ScriptRun): HitEvent => r.events.find((e): e is HitEvent & { tick: number } => e.type === 'Hit')!;

  it('damage multiplies the attacker\'s damage, and nothing else about the blow', () => {
    const plain = run({}, {}, 'Arming Sword', 'Overhead', 1.2);
    const strong = run({ damage: 1.5 }, {}, 'Arming Sword', 'Overhead', 1.2);
    expect(hit(plain).damage).toBeGreaterThan(0);
    expect(hit(strong).damage).toBeCloseTo(hit(plain).damage * 1.5, 9);
    expect(hit(strong)).toMatchObject({ bladeSpeed: hit(plain).bladeSpeed, zone: hit(plain).zone, heavy: hit(plain).heavy });
    expect(strong.final.fighters[1]!.hp).toBeCloseTo(fighter.maxHp - hit(strong).damage, 9);
  });

  it('heavyDamage multiplies a Heavy Blow only', () => {
    const plain = run({}, {}, 'Sledge Hammer', 'Overhead', 1.4);
    const heavy = run({ heavyDamage: 2 }, {}, 'Sledge Hammer', 'Overhead', 1.4);
    expect(hit(plain).heavy).toBe(true);
    expect(hit(heavy).damage).toBeCloseTo(hit(plain).damage * 2, 9);
    // The same Mods on a Hit that is not a Heavy Blow: no change.
    const light = run({}, {}, 'Longsword', 'Overhead', 1.2);
    const lightWith = run({ heavyDamage: 2 }, {}, 'Longsword', 'Overhead', 1.2);
    expect(hit(light).heavy).toBe(false);
    expect(hit(lightWith).damage).toBe(hit(light).damage);
    // And `damage` multiplies both.
    expect(hit(run({ damage: 1.5, heavyDamage: 2 }, {}, 'Sledge Hammer', 'Overhead', 1.4)).damage).toBeCloseTo(hit(plain).damage * 3, 9);
  });

  it('damageTaken multiplies the defender\'s damage taken, and the attacker\'s own is not read', () => {
    const plain = run({}, {}, 'Arming Sword', 'Overhead', 1.2);
    expect(hit(run({}, { damageTaken: 0.5 }, 'Arming Sword', 'Overhead', 1.2)).damage).toBeCloseTo(hit(plain).damage * 0.5, 9);
    expect(hit(run({ damageTaken: 0.5 }, {}, 'Arming Sword', 'Overhead', 1.2)).damage).toBe(hit(plain).damage);
  });

  it('a Hit on a teammate still deals nothing', () => {
    const initial = armed(createInitialState(tuning, 1, duelPlacements(1.2), [], [0, 0]), 0, { damage: 3 });
    const r = runScript(tuning, initial, [attack('Overhead'), []]);
    expect(r.final.fighters[1]!.hp).toBe(fighter.maxHp);
  });

  it('blockImpactTaken multiplies the Block Impact the defender takes, and no damage is dealt', () => {
    const block = hold(150, { block: true, direction: mirrorDirection('Overhead') });
    const strength = (r: ScriptRun): number => {
      const e = r.events.find((x): x is BlockEvent & { tick: number } => x.type === 'Block')!;
      return r.states[e.tick]!.fighters[1]!.blockImpact!.strength;
    };
    const plain = run({}, {}, 'Sledge Hammer', 'Overhead', 1.45, block);
    expect(strength(run({}, { blockImpactTaken: 0.5 }, 'Sledge Hammer', 'Overhead', 1.45, block))).toBeCloseTo(strength(plain) * 0.5, 9);
    expect(strength(run({ blockImpactTaken: 0.5 }, {}, 'Sledge Hammer', 'Overhead', 1.45, block))).toBe(strength(plain));
    expect(plain.final.fighters[1]!.hp).toBe(fighter.maxHp);
  });

  it('healOnKill heals the attacker by its HP, only for the Hit that fells, never above its max HP', () => {
    const felled = (a: Partial<Record<RelicEffect, number>>, hp0: number, hp1: number): ScriptRun => {
      const s = armed(createInitialState(tuning, 1, duelPlacements(1.2), ['Arming Sword', 'Arming Sword']), 0, a);
      return runScript(tuning, { ...s, fighters: s.fighters.map((f, i) => ({ ...f, hp: i === 0 ? hp0 : hp1 })) }, [attack('Overhead'), []]);
    };
    const kill = felled({ healOnKill: 10 }, 50, 1);
    expect(kill.final.fighters[1]!.death).toBeDefined();
    expect(kill.final.fighters[0]!.hp).toBe(60);
    expect(felled({ healOnKill: 10 }, 95, 1).final.fighters[0]!.hp).toBe(fighter.maxHp);
    expect(felled({}, 50, 1).final.fighters[0]!.hp).toBe(50);
    // A Hit that wounds without felling heals nothing.
    const wound = felled({ healOnKill: 10 }, 50, 100);
    expect(wound.final.fighters[1]!.hp).toBeLessThan(100);
    expect(wound.final.fighters[1]!.death).toBeUndefined();
    expect(wound.final.fighters[0]!.hp).toBe(50);
  });
});

describe('a Throwing Dagger', () => {
  const lineup = (teams = [0, 1]): SimState => {
    const placements: Placement[] = [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 5 }, facing: Math.PI }];
    return createInitialState(tuning, 1, placements, [], teams, 'mods');
  };
  /** A dagger from Fighter 0 just behind Fighter 1's torso, flying at it. */
  const dart = (s: SimState): DaggerState => {
    const t = s.fighters[1]!;
    return { owner: 0, team: 0, thrownAt: 0, position: { x: t.position.x, y: t.y + 1.1, z: t.position.z - 0.15 }, velocity: { x: 0, y: 0, z: 18 }, ticks: 3 };
  };
  const hits = (s: SimState) => tick({ ...s, daggers: [dart(s)] });
  const damageOf = (s: SimState): number => (s.events.find((e) => e.type === 'DaggerHit') as { damage: number }).damage;

  it('the count is dagger.count + daggers, from a Hall\'s start', () => {
    expect(armed(lineup(), 0, { daggers: 2 }).fighters[0]!.daggers).toBe(dagger.count + 2);
    // And every one of them can be thrown.
    let s = armed(lineup(), 0, { daggers: 1 });
    let thrown = 0;
    for (let n = 0; n < 600; n++) {
      s = tick(s, { 0: { throw: n % 60 === 0 } });
      thrown += s.events.filter((e) => e.type === 'DaggerThrown').length;
    }
    expect(thrown).toBe(dagger.count + 1);
    expect(s.fighters[0]!.daggers).toBe(0);
  });

  it('daggerDamage multiplies the thrower\'s dagger damage, damageTaken the defender\'s', () => {
    const plain = hits(lineup());
    const zone = (plain.events.find((e) => e.type === 'DaggerHit') as { zone: keyof typeof hitZones }).zone;
    expect(damageOf(plain)).toBeCloseTo(dagger.damage * hitZones[zone].multiplier, 9);
    const strong = hits(armed(lineup(), 0, { daggerDamage: 1.4 }));
    expect(damageOf(strong)).toBeCloseTo(damageOf(plain) * 1.4, 9);
    expect(strong.fighters[1]!.hp).toBeCloseTo(fighter.maxHp - damageOf(strong), 9);
    expect(damageOf(hits(armed(lineup(), 1, { daggerDamage: 1.4 })))).toBe(damageOf(plain));
    expect(damageOf(hits(armed(lineup(), 1, { damageTaken: 0.5 })))).toBeCloseTo(damageOf(plain) * 0.5, 9);
    // Blade Mods leave a dagger alone.
    expect(damageOf(hits(armed(lineup(), 0, { damage: 2, heavyDamage: 2 })))).toBe(damageOf(plain));
  });

  it('blockImpactTaken scales the Block Impact of a Blocked dagger too', () => {
    const blocking = (m: Partial<Record<RelicEffect, number>>): SimState => {
      let s = armed(lineup(), 1, m);
      for (let n = 0; n < 10; n++) s = tick(s, { 1: { block: true, direction: 'Overhead' } });
      return tick({ ...s, daggers: [{ ...dart(s), thrownAt: 0 }] }, { 1: { block: true, direction: 'Overhead' } });
    };
    const plain = blocking({});
    expect(plain.events.some((e) => e.type === 'DaggerBlocked')).toBe(true);
    expect(blocking({ blockImpactTaken: 0.5 }).fighters[1]!.blockImpact!.strength).toBeCloseTo(plain.fighters[1]!.blockImpact!.strength * 0.5, 9);
  });

  it('healOnKill heals the thrower when its dagger fells, not when it only wounds, and not a thrower already down', () => {
    const withHp = (s: SimState, hp0: number, hp1: number): SimState => ({ ...s, fighters: s.fighters.map((f, i) => ({ ...f, hp: i === 0 ? hp0 : hp1 })) });
    const mod = { healOnKill: 7 };
    expect(hits(withHp(armed(lineup(), 0, mod), 50, 1)).fighters[0]!.hp).toBe(57);
    expect(hits(withHp(armed(lineup(), 0, mod), 50, 100)).fighters[0]!.hp).toBe(50);
    expect(hits(withHp(armed(lineup(), 0, mod), 50, 1)).fighters[1]!.hp).toBe(0);
    expect(hits(withHp(armed(lineup(), 0, mod), 0, 1)).fighters[0]!.hp).toBe(0);
  });
});

describe('a Kick', () => {
  const GAP = 0.95;
  const facing = (teams = [0, 1]): SimState => createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: GAP }, facing: Math.PI }], [], teams);
  /** Press kick, the victim walking away (a Knockdown) or standing (a Shove), until the Kick lands. */
  function kicked(s: SimState, victimMoves: boolean): SimState {
    s = tick(s, { 0: { kick: true }, 1: victimMoves ? { move: { x: 0, z: -1 } } : {} });
    for (let n = 0; n < 200 && !s.events.some((e) => e.type === 'KickLanded'); n++) s = tick(s, { 1: victimMoves ? { move: { x: 0, z: -1 } } : {} });
    if (!s.events.some((e) => e.type === 'KickLanded')) throw new Error('The Kick never landed');
    return s;
  }
  const damageOf = (s: SimState): number => (s.events.find((e) => e.type === 'KickLanded') as { damage: number }).damage;

  it('kickDamage multiplies a Knockdown\'s damage and leaves a Shove\'s alone', () => {
    expect(damageOf(kicked(facing(), true))).toBe(kick.knockdownDamage);
    const strong = kicked(armed(facing(), 0, { kickDamage: 1.5 }), true);
    expect(damageOf(strong)).toBeCloseTo(kick.knockdownDamage * 1.5, 9);
    expect(strong.fighters[1]!.hp).toBeCloseTo(fighter.maxHp - kick.knockdownDamage * 1.5, 9);
    expect(damageOf(kicked(armed(facing(), 0, { kickDamage: 1.5 }), false))).toBe(kick.shoveDamage);
    expect(damageOf(kicked(armed(facing(), 1, { kickDamage: 1.5 }), true))).toBe(kick.knockdownDamage);
  });

  it('damageTaken multiplies a Kick\'s damage, a Shove\'s too', () => {
    expect(damageOf(kicked(armed(facing(), 1, { damageTaken: 0.5 }), true))).toBeCloseTo(kick.knockdownDamage * 0.5, 9);
    expect(damageOf(kicked(armed(facing(), 1, { damageTaken: 0.5 }), false))).toBeCloseTo(kick.shoveDamage * 0.5, 9);
    expect(damageOf(kicked(armed(facing([0, 0]), 0, { kickDamage: 3 }), true))).toBe(0);
  });

  it('healOnKill heals the kicker when its Kick fells', () => {
    const low = (s: SimState): SimState => ({ ...s, fighters: s.fighters.map((f, i) => ({ ...f, hp: i === 0 ? 50 : 1 })) });
    expect(kicked(low(armed(facing(), 0, { healOnKill: 6 })), true).fighters[0]!.hp).toBe(56);
    expect(kicked(low(facing()), true).fighters[0]!.hp).toBe(50);
  });
});

describe('with NO_MODS', () => {
  it('a Fighter carries no `mods` field, so every state hashes as before Mods existed', () => {
    const s = createInitialState(tuning, 1, duelPlacements(2));
    expect(s.fighters.every((f) => !('mods' in f))).toBe(true);
    let t = s;
    for (let n = 0; n < 60; n++) t = tick(t, { 0: { attack: n === 0 } });
    expect(t.fighters.every((f) => !('mods' in f))).toBe(true);
  });
});
