/**
 * Interrupting the Whirlwind's spinner (Stage 3): a Thrust, a thrown Throwing Dagger, a Kick's Knockdown and a Kick's Shove each end the Spin
 * (a Shove on the Wind-up does not), a Trade lands both blows, and a Whirlwind among a 4-a-side Duel hits only enemies, deterministically.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type ArenaGeometry, type TuningData } from '../tuning';
import { resolveContacts, type BladeContact, type KickContact } from './combat';
import { createInitialState, hashState, IDLE_INTENT, step, teamPlacements, whirlwindTimings, type FighterState, type Intent, type Placement, type SimEvent, type SimState } from './index';

const base = loadTuningData();
const t = whirlwindTimings(base);
const corner = (x: number, z: number) => ({ x, y: 0, z });
const flat: ArenaGeometry = { name: 'pen', walk: [{ id: 'floor', points: [corner(-20, -20), corner(-20, 20), corner(20, 20), corner(20, -20)] }], walls: [], spawns: [] };
const tuning: TuningData = { ...base, arenas: { ...base.arenas, pen: flat } };

interface Frame {
  /** The Spin Tick this step was given (-1 while arming). */
  readonly at: number;
  readonly state: SimState;
}
type Give = (at: number, s: SimState) => Partial<Intent>[];
interface Scene {
  readonly placements: Placement[];
  readonly weapons?: string[];
  readonly teams: number[];
  /** Everyone's Intent but the spinner's, by Spin Tick and the state before it (index 0 is ignored). */
  readonly give?: Give;
  readonly ticks?: number;
  readonly crouch?: boolean;
  /** The spinner's own Intent from the first Spin Tick (its move steers the Spin, and rules a Kick on it). */
  readonly steer?: Partial<Intent>;
}

/** Fighter 0 arms and releases a Whirlwind (Right), then steers nowhere; every Frame from the first Spin Tick on is returned. */
function run(scene: Scene): Frame[] {
  let s = createInitialState(tuning, 1, scene.placements, scene.weapons ?? [], scene.teams, 'pen');
  const go = (at: number, mine: Partial<Intent>): void => {
    const others = scene.give && at >= 0 ? scene.give(at, s) : scene.teams.map(() => ({}));
    s = step(s, scene.teams.map((_, i) => ({ ...IDLE_INTENT, ...(i === 0 ? { direction: 'Right' as const, crouch: scene.crouch ?? false, ...mine, ...(at >= 0 ? scene.steer : {}) } : others[i]) })), tuning);
  };
  for (let i = 0; i < t.armTicks + 1; i++) go(-1, { whirlwind: true });
  go(-1, {});
  expect(s.fighters[0]!.action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
  const frames: Frame[] = [];
  for (let at = 0; at < (scene.ticks ?? t.spinTicks + 4); at++) {
    go(at, {});
    frames.push({ at, state: s });
  }
  return frames;
}

const events = (fs: Frame[]): SimEvent[] => fs.flatMap((f) => f.state.events);
const spinner = (s: SimState): FighterState => s.fighters[0]!;

/** The Spin Tick on which the spinner is no longer in a Whirlwind (-1 if it never stops within the frames). */
const endedAt = (fs: Frame[]): number => fs.findIndex((f) => spinner(f.state).action.kind !== 'Whirlwind');
const in1 = (x: number, z: number, facing: number): Placement => ({ position: { x, z }, facing });
const SPINNER = in1(0, 0, 0);

/** A Fighter 2 m to the side of the spinner's path, Halberd in hand and facing it; its Thrust from Spin Tick `k` lands as the spinner passes. */
const thruster = (k: number): Scene => ({
  placements: [SPINNER, in1(2.0, 2, -Math.PI / 2)],
  weapons: ['Arming Sword', 'Halberd'],
  teams: [0, 1],
  give: (at) => [{}, { direction: 'Thrust', attack: at >= k && at < k + 12 }],
});
/** A thrower (Fighter 1) far down the spinner's path, at Spin Tick `k` throwing a Throwing Dagger at it. */
const thrower = (k: number): Scene => ({
  placements: [SPINNER, in1(0, 6, Math.PI)],
  teams: [0, 1],
  give: (at) => [{}, { throw: at === k, face: Math.PI }],
});
/** A kicker (Fighter 1) the spinner drives onto; it kicks on Spin Tick 5, before the blade has reached it. */
const kicker = (steer?: Partial<Intent>): Scene => ({ placements: [SPINNER, in1(0, 3.0, Math.PI)], teams: [0, 1], steer, give: (at) => [{}, { kick: at === 5 }] });

describe('Interrupting the spinner', () => {
  it('a Thrust landing on the spinner mid-Spin Staggers it, ending the Whirlwind', () => {
    const fs = run(thruster(12));
    const hit = events(fs).find((e) => e.type === 'Hit' && e.defender === 0);
    expect(hit).toMatchObject({ attacker: 1, defender: 0, direction: 'Thrust' });
    // The spinner's blade met nobody first: only the Thrust landed.
    expect(events(fs).filter((e) => e.type === 'Hit')).toHaveLength(1);
    const k = fs.findIndex((f) => f.state.events.includes(hit!));
    expect(spinner(fs[k - 1]!.state).action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
    expect(fs[k]!.state.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 0, cause: 'Hit' }));
    expect(endedAt(fs)).toBe(k);
    expect(k).toBeLessThan(t.spinTicks - t.turnTicks);
    expect(spinner(fs[k]!.state).action.kind).toBe('Stagger');
    expect(spinner(fs[k]!.state).hp).toBeLessThan(base.fighter.maxHp);
  });

  it('a thrown Throwing Dagger hitting the spinner ends the Whirlwind', () => {
    const fs = run(thrower(4));
    const hit = events(fs).find((e) => e.type === 'DaggerHit');
    expect(hit).toMatchObject({ thrower: 1, defender: 0 });
    const k = fs.findIndex((f) => f.state.events.includes(hit!));
    expect(spinner(fs[k - 1]!.state).action.kind).toBe('Whirlwind');
    expect(fs[k]!.state.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 0, cause: 'Hit' }));
    expect(endedAt(fs)).toBe(k);
    expect(k).toBeLessThan(t.spinTicks);
  });

  it("a Kick's Knockdown (the spinner steering) knocks the spinner down, ending the Whirlwind", () => {
    const fs = run(kicker({ move: { x: 0, z: 1 } }));
    const kick = events(fs).find((e) => e.type === 'KickLanded');
    expect(kick).toMatchObject({ attacker: 1, defender: 0, outcome: 'Knockdown' });
    const k = fs.findIndex((f) => f.state.events.includes(kick!));
    expect(spinner(fs[k - 1]!.state).action.kind).toBe('Whirlwind');
    expect(spinner(fs[k]!.state).action.kind).toBe('Knockdown');
    expect(endedAt(fs)).toBe(k);
  });

  it("a Kick's Shove (the spinner giving no move) Staggers the spinner, ending the Whirlwind, with the Shove's own damage and Slide", () => {
    const fs = run(kicker());
    const kick = events(fs).find((e) => e.type === 'KickLanded');
    expect(kick).toMatchObject({ attacker: 1, defender: 0, outcome: 'Shove', damage: base.kick.shoveDamage });
    expect(events(fs).filter((e) => e.type === 'Hit')).toHaveLength(0);
    const k = fs.findIndex((f) => f.state.events.includes(kick!));
    expect(spinner(fs[k - 1]!.state).action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
    expect(fs[k]!.state.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 0, cause: 'Hit' }));
    expect(spinner(fs[k]!.state).action.kind).toBe('Stagger');
    expect(spinner(fs[k]!.state).hp).toBeCloseTo(base.fighter.maxHp - base.kick.shoveDamage, 9);
    expect(spinner(fs[k]!.state).slide).toBeDefined();
    expect(endedAt(fs)).toBe(k);
  });

  it("a Kick's Shove does not turn a Knockdown that landed earlier on the same Tick into a Stagger", () => {
    // A scripted repro is impractical (a Kick's outcome follows the spinner's own Intent, so two Kicks on it are both Knockdowns or both Shoves),
    // so the contacts are resolved directly: a rival's Whirlwind blade knocks the spinner down, and then Fighter 1's Shove arrives.
    const spun = run({ placements: [SPINNER, in1(3, 3, Math.PI), in1(-3, 3, Math.PI)], teams: [0, 1, 1], ticks: 3 }).at(-1)!.state.fighters;
    const fighters = spun.map((f, i) => (i === 2 ? { ...f, action: spun[0]!.action } : i === 1 ? { ...f, action: { kind: 'Kick' as const, phase: 'Release' as const, landed: false } } : f));
    const blade: BladeContact = { attacker: 2, defender: 0, direction: 'Right', point: { x: 0, y: 1, z: 0 }, bladeSpeed: 1, onHead: true, blade: { hilt: { x: 0, y: 1, z: 0 }, tip: { x: 0, y: 1, z: 1 } }, travel: { x: 1, y: 0, z: 0 }, whirlwind: true, turn: 0, blocked: false, zone: 'torso' };
    const shove: KickContact = { kick: true, attacker: 1, defender: 0, zone: 'torso', point: { x: 0, y: 1, z: 0 } };
    expect(fighters[0]!.action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
    const emitted: SimEvent[] = [];
    const out = resolveContacts(fighters, [blade, shove], [IDLE_INTENT, IDLE_INTENT, IDLE_INTENT], tuning, (e) => emitted.push(e));
    expect(emitted).toContainEqual(expect.objectContaining({ type: 'KickLanded', outcome: 'Shove', defender: 0 }));
    expect(out[0]!.action.kind).toBe('Knockdown');
    expect(emitted.some((e) => e.type === 'Stagger' && e.fighter === 0)).toBe(false);
  });

  it("a Kick's Shove on the Wind-up does not end the hold", () => {
    let s = createInitialState(tuning, 1, [SPINNER, in1(0, 0.95, Math.PI)], [], [0, 1], 'pen');
    const tick = (mine: Partial<Intent>, theirs: Partial<Intent>): void => {
      s = step(s, [{ ...IDLE_INTENT, direction: 'Right', whirlwind: true, ...mine }, { ...IDLE_INTENT, ...theirs }], tuning);
    };
    tick({}, { kick: true });
    let landed: SimEvent | undefined;
    for (let i = 0; i < 40 && !landed; i++) {
      tick({}, {});
      landed = s.events.find((e) => e.type === 'KickLanded');
    }
    expect(landed).toMatchObject({ outcome: 'Shove', defender: 0 });
    expect(s.fighters[0]!.action).toMatchObject({ kind: 'Whirlwind', phase: 'Wind-up' });
    expect(s.events.some((e) => e.type === 'Stagger')).toBe(false);
    for (let i = 0; i < 5; i++) tick({}, {});
    expect(s.fighters[0]!.action).toMatchObject({ kind: 'Whirlwind', phase: 'Wind-up' });
  });

  it('a Trade of the spinner\'s blade and a Thrust on one Tick lands both, and the Spin ends', () => {
    const fs = run({
      placements: [SPINNER, in1(0, 2.0, Math.PI)],
      weapons: ['Dagger', 'Quarterstaff'],
      teams: [0, 1],
      give: (at) => [{}, { direction: 'Thrust', attack: at < 12 }],
    });
    const hits = events(fs).filter((e) => e.type === 'Hit');
    expect(hits.map((h) => (h.type === 'Hit' ? [h.attacker, h.defender] : []))).toEqual([[0, 1], [1, 0]]);
    const k = fs.findIndex((f) => f.state.events.some((e) => e.type === 'Hit'));
    expect(fs[k]!.state.events.filter((e) => e.type === 'Hit')).toHaveLength(2);
    expect(fs[k]!.state.fighters[0]!.hp).toBeLessThan(base.fighter.maxHp);
    expect(fs[k]!.state.fighters[1]!.hp).toBeLessThan(base.fighter.maxHp);
    expect(spinner(fs[k - 1]!.state).action.kind).toBe('Whirlwind');
    expect(endedAt(fs)).toBe(k);
  });
});

describe('Whirlwind among teams', () => {
  const teams = [0, 1, 0, 1, 0, 1, 0, 1];
  // Two lines of four, close enough that the spinner (the first of team 0) drives into them.
  const scene = (): Scene => ({ placements: teamPlacements(teams, 2.2, 0.9), teams });
  const spinning = (): Frame[] => {
    return run({ ...scene(), ticks: t.spinTicks + 4 });
  };

  it('Hits only enemies, Staggers every ally it meets with no damage, and is the same on a re-run', () => {
    const a = spinning();
    const hits = events(a).filter((e) => e.type === 'Hit');
    const meets = hits.filter((e) => e.type === 'Hit' && e.attacker === 0);
    expect(meets.length).toBeGreaterThan(0);
    const allies = meets.filter((e) => e.type === 'Hit' && teams[e.defender] === 0);
    const enemies = meets.filter((e) => e.type === 'Hit' && teams[e.defender] === 1);
    expect(allies.length).toBeGreaterThan(0);
    expect(enemies.length).toBeGreaterThan(0);
    for (const e of allies) expect(e.type === 'Hit' && e.damage).toBe(0);
    for (const e of enemies) expect(e.type === 'Hit' && e.damage).toBeGreaterThan(0);
    // Damage only ever lands on the other Team; every ally keeps its full hit points.
    for (const f of a.at(-1)!.state.fighters) if (f.team === 0) expect(f.hp).toBe(base.fighter.maxHp);
    for (const e of allies) {
      const k = a.findIndex((f) => f.state.events.includes(e));
      expect(a[k]!.state.events).toContainEqual(expect.objectContaining({ type: 'Stagger', cause: 'Hit', fighter: e.type === 'Hit' ? e.defender : -1 }));
    }
    const b = spinning();
    expect(a.map((f) => hashState(f.state))).toEqual(b.map((f) => hashState(f.state)));
  });
});

describe('Whirlwind Knockdown chain', () => {
  it('a Fighter knocked down by the blade into another enemy behind it brings a ChainKnockdown with the spinner as its source', () => {
    // The first enemy stands to the spinner's side, the second right behind it (touching), both on the blade's side of the Spin.
    const fs = run({ placements: [SPINNER, in1(1.0, 0.3, Math.PI / 2 + 0.3), in1(1.85, 0.3, Math.PI / 2)], teams: [0, 1, 1] });
    const hit = events(fs).find((e) => e.type === 'Hit' && e.defender === 1);
    expect(hit).toMatchObject({ attacker: 0, whirlwind: true });
    const chain = events(fs).find((e) => e.type === 'ChainKnockdown');
    expect(chain).toMatchObject({ by: 1, fighter: 2, source: 0 });
    expect(chain && chain.type === 'ChainKnockdown' && chain.damage).toBeGreaterThan(0);
    expect(fs.at(-1)!.state.fighters[2]!.action.kind).toBe('Knockdown');
  });
});
