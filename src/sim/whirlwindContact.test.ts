/**
 * The Whirlwind's blade (Stage 3): the Spin's Blade Sweep meets Fighters per turn (a hit set), Hits for half damage and knocks down,
 * is Blocked without Staggering the spinner, Staggers and pushes aside an ally, and is stopped by no Wall (ADR 0029).
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, weaponByName, withWeapon, type ArenaGeometry, type TuningData, type WallSegment } from '../tuning';
import { createInitialState, hashState, IDLE_INTENT, step, whirlwindTimings, type BlockEvent, type FighterState, type HitEvent, type Intent, type SimEvent, type SimState } from './index';
import { hitDamage, resolveContacts, type BladeContact } from './combat';
import { startBlockImpact } from './actions';

const base = loadTuningData();
const t = whirlwindTimings(base);
const corner = (x: number, z: number) => ({ x, y: 0, z });
const point3 = (x: number, y: number, z: number) => ({ x, y, z });
const floor = { id: 'floor', points: [corner(-20, -20), corner(-20, 20), corner(20, 20), corner(20, -20)] };
const arenaWith = (walls: WallSegment[]): TuningData => ({ ...base, arenas: { ...base.arenas, pen: { name: 'pen', walk: [floor], walls, spawns: [] } as ArenaGeometry } });
const wall = (id: string, ax: number, az: number, bx: number, bz: number): WallSegment => ({ id, a: { x: ax, z: az }, b: { x: bx, z: bz }, bottom: 0, top: 3 });
/** Stops the spinner (at the origin, heading +z) where it stands, so its blade keeps working one spot. */
const NORTH = wall('north', -5, 0.45, 5, 0.45);
/** Stops a defender at x = 1 from being pushed away from the spinner. */
const EAST = wall('east', 1.35, -5, 1.35, 5);

/** `intent` may depend on the Spin's Tick (-1 before the Spin begins, 0 for the first Tick after it has). */
type Who = { x: number; z: number; facing?: number; intent?: Partial<Intent> | ((spinTick: number) => Partial<Intent>); weapon?: string; team?: number };
interface Seen {
  readonly state: SimState;
  /** The spinner's Whirlwind turn the Tick's segment belongs to (`prev.turn`), when it was in a Spin. */
  readonly turn: number | null;
}
interface Spin {
  readonly seen: Seen[];
  readonly events: readonly SimEvent[];
  readonly hits: HitEvent[];
  readonly blocks: BlockEvent[];
  readonly final: SimState;
}

const intent = (i: Partial<Intent>): Intent => ({ ...IDLE_INTENT, ...i });

/**
 * Fighter 0 (`weapon`) at the origin facing +z holds G to arm and lets go (crouched throughout when `crouch`), then spins to the end of its
 * Recovery (steering nowhere); `others` stand about it (facing the spinner unless told), each giving its fixed Intent.
 * `setup` may change the state when the Spin has begun.
 */
function spin(others: Who[], opts: { tuning?: TuningData; crouch?: boolean; weapon?: string; ticks?: number; setup?: (s: SimState) => SimState } = {}): Spin {
  const tuning = opts.tuning ?? base;
  const weapon = opts.weapon ?? 'Arming Sword';
  const crouch = opts.crouch ?? false;
  const placements = [{ position: { x: 0, z: 0 }, facing: 0 }, ...others.map((o) => ({ position: { x: o.x, z: o.z }, facing: o.facing ?? Math.atan2(-o.x, -o.z) }))];
  const teams = [0, ...others.map((o) => o.team ?? 1)];
  let s = createInitialState(tuning, 1, placements, [weapon, ...others.map((o) => o.weapon ?? weapon)], teams, tuning === base ? undefined : 'pen');
  const go = (a: Partial<Intent>, at: number): void => {
    const theirs = others.map((o) => intent(typeof o.intent === 'function' ? o.intent(at) : (o.intent ?? {})));
    s = step(s, [intent({ direction: 'Right', crouch, ...a }), ...theirs], tuning);
  };
  for (let i = 0; i < t.armTicks + 1 + (crouch ? 20 : 0); i++) go({ whirlwind: true }, -1);
  go({}, -1);
  expect(s.fighters[0]!.action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin' });
  if (opts.setup) s = opts.setup(s);
  const seen: Seen[] = [];
  const events: SimEvent[] = [];
  for (let i = 0; i < (opts.ticks ?? t.spinTicks + 4); i++) {
    const prev = s.fighters[0]!.action;
    go({}, i);
    seen.push({ state: s, turn: prev.kind === 'Whirlwind' && prev.phase === 'Spin' ? prev.turn : null });
    events.push(...s.events);
  }
  return { seen, events, hits: events.filter((e): e is HitEvent => e.type === 'Hit'), blocks: events.filter((e): e is BlockEvent => e.type === 'Block'), final: s };
}

/** The turn of the spinner's segment on the Tick that emitted `e`. */
const turnOf = (r: Spin, e: SimEvent): number | null => r.seen.find((x) => x.state.events.includes(e))!.turn;
const spinner = (s: SimState): FighterState => s.fighters[0]!;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const ref = (w = 'Arming Sword') => weaponByName(base, w);

describe('Whirlwind contacts: Hits', () => {
  it('Hits a standing enemy in reach, knocks it down and pushes it about knockdownSlide away', () => {
    const r = spin([{ x: 1.0, z: 0.3 }]);
    expect(r.hits).toHaveLength(1);
    const hit = r.hits[0]!;
    expect(hit).toMatchObject({ attacker: 0, defender: 1, heavy: false, whirlwind: true });
    const at = r.seen.find((x) => x.state.events.includes(hit))!.state;
    expect(at.fighters[1]!.action.kind).toBe('Knockdown');
    expect(spinner(at).action.kind).toBe('Whirlwind');
    const from = at.fighters[1]!.position;
    const to = r.final.fighters[1]!.position;
    const away = { x: from.x - spinner(at).position.x, z: from.z - spinner(at).position.z };
    const along = ((to.x - from.x) * away.x + (to.z - from.z) * away.z) / Math.hypot(away.x, away.z);
    expect(along).toBeGreaterThan(base.whirlwind.knockdownSlide * 0.8);
    expect(along).toBeLessThan(base.whirlwind.knockdownSlide * 1.05);
  });

  it('deals the reference-speed Hit damage times damageFactor: on a torso (standing spin) and on the legs (crouched spin)', () => {
    const zones = new Set<string>();
    for (const crouch of [false, true]) {
      const r = spin([{ x: 0.9, z: 0.4 }], { crouch });
      const hit = r.hits[0]!;
      zones.add(hit.zone);
      expect(hit.bladeSpeed).toBe(ref().speed);
      expect(hit.damage).toBeCloseTo(hitDamage(base, ref(), hit.zone, ref().speed, hit.head) * base.whirlwind.damageFactor, 9);
      expect(r.seen.find((x) => x.state.events.includes(hit))!.state.fighters[1]!.hp).toBeCloseTo(base.fighter.maxHp - hit.damage, 9);
    }
    // The level blade at the shoulder does not reach a head, and a low one sweeps the shins: two Hit Zones, two multipliers.
    expect([...zones].sort()).toEqual(['legs', 'torso']);
    expect(base.hitZones.legs.multiplier).not.toBe(base.hitZones.torso.multiplier);
  });

  it('meets a defender at most once a turn, and at most five times over the Spin, however long it stays in reach', () => {
    // A downed Fighter pinned in reach (a crouched spin sweeps the floor), the spinner held to its spot by a Wall.
    const r = spin([{ x: 1.0, z: 0, intent: {} }], { tuning: arenaWith([NORTH, EAST]), crouch: true });
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
    expect(r.hits.length).toBeLessThanOrEqual(t.spinTicks / t.turnTicks);
    const turns = r.hits.map((h) => turnOf(r, h));
    expect(new Set(turns).size).toBe(turns.length);
  });

  it('Hits a Fighter already down again on a later turn, pushing it again without restarting its Knockdown', () => {
    const r = spin([{ x: 1.0, z: 0 }], { tuning: arenaWith([NORTH, EAST]), crouch: true });
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
    const [first, second] = r.hits.map((h) => r.seen.find((x) => x.state.events.includes(h))!.state);
    expect(first!.fighters[1]!.action.kind).toBe('Knockdown');
    const before = r.seen[r.seen.indexOf(r.seen.find((x) => x.state === second)!) - 1]!.state.fighters[1]!;
    const after = second!.fighters[1]!;
    expect(before.action.kind).toBe('Knockdown');
    expect(after.action.kind).toBe('Knockdown');
    // Restarting would set its Knockdown clock back to the start; it only goes on.
    expect(after.motion.name).toBe(before.motion.name);
    expect(after.motion.tick).toBeGreaterThan(before.motion.tick);
    expect(after.slide).toBeDefined();
    expect(second!.fighters[1]!.hp).toBeLessThan(first!.fighters[1]!.hp);
  });

  it('never meets the spinner itself, and nobody at all when none is in reach', () => {
    const r = spin([{ x: 8, z: 8 }]);
    expect(r.hits).toEqual([]);
    expect(r.blocks).toEqual([]);
    expect(spinner(r.final).hp).toBe(base.fighter.maxHp);
    expect(r.events.some((e) => e.type === 'Hit' && e.defender === 0)).toBe(false);
    expect(spinner(r.seen[0]!.state).action).not.toHaveProperty('met');
  });

  it('records the Fighters met in the turn on the spinner, and starts a new set next turn', () => {
    const r = spin([{ x: 1.0, z: 0 }], { tuning: arenaWith([NORTH, EAST]), crouch: true });
    const hit = r.hits[0]!;
    const turn = turnOf(r, hit)!;
    const after = spinner(r.seen.find((x) => x.state.events.includes(hit))!.state).action;
    expect(after).toMatchObject({ kind: 'Whirlwind', met: { turn, fighters: [1] } });
  });

  it('a crouched Fighter ducks a standing spin, which Hits the same Fighter standing', () => {
    expect(spin([{ x: 0.9, z: 0.4 }]).hits).toHaveLength(1);
    expect(spin([{ x: 0.9, z: 0.4, intent: { crouch: true } }]).hits).toEqual([]);
  });

  it('a crouched spin sweeps the legs of a Fighter standing, but not one high in a Jump', () => {
    const who = { x: 0.9, z: 0.4 };
    expect(spin([who], { crouch: true }).hits.map((h) => h.zone)).toEqual(['legs']);
    const r = spin([{ ...who, intent: (at) => ({ jump: at === 0, jumpHeld: at >= 0 && at < 30 }) }], { crouch: true });
    expect(r.hits).toEqual([]);
    expect(r.seen[9]!.state.fighters[1]!.y).toBeGreaterThan(0.5);
  });
});

describe('Whirlwind contacts: Blocks', () => {
  const blocking: Partial<Intent> = { block: true, direction: 'Left' };

  it('a Right spin Blocked by a Left Block deals no damage, pushes the defender about blockSlide and gives it a Block Impact, the spinner going on', () => {
    const r = spin([{ x: 1.0, z: 0, intent: blocking }], { tuning: arenaWith([NORTH]) });
    expect(r.hits).toEqual([]);
    const block = r.blocks[0]!;
    expect(block).toMatchObject({ attacker: 0, defender: 1, heavy: false, whirlwind: true, bladeSpeed: ref().speed });
    expect(block.broken).toBeUndefined();
    const k = r.seen.findIndex((x) => x.state.events.includes(block));
    const at = r.seen[k]!.state;
    expect(at.fighters[1]!.blockImpact).toEqual(startBlockImpact(at.fighters[0]!, at.fighters[1]!, 'Left', ref().speed, base));
    expect(at.fighters[1]!.hp).toBe(base.fighter.maxHp);
    const from = r.seen[k - 1]!.state.fighters[1]!.position;
    const settled = r.seen[k + base.whirlwind.blockSlideTicks + 1]!.state;
    expect(dist(settled.fighters[1]!.position, from)).toBeGreaterThan(base.whirlwind.blockSlide * 0.8);
    expect(dist(settled.fighters[1]!.position, from)).toBeLessThan(base.whirlwind.blockSlide * 1.1);
    expect(settled.fighters[1]!.position.x).toBeGreaterThan(from.x);
    // Not Staggered: the Whirlwind carries on, with the Block in its hit set.
    expect(at.events.some((e) => e.type === 'Stagger' && e.fighter === 0)).toBe(false);
    expect(spinner(at).action).toMatchObject({ kind: 'Whirlwind', phase: 'Spin', met: { fighters: [1] } });
    expect(r.events.some((e) => e.type === 'Stagger')).toBe(false);
  });

  it('meets the Blocking defender again on every turn, once each, while it stays in reach', () => {
    const r = spin([{ x: 1.0, z: 0, intent: blocking }], { tuning: arenaWith([NORTH, EAST]) });
    expect(r.blocks).toHaveLength(t.spinTicks / t.turnTicks);
    expect(r.blocks.map((b) => turnOf(r, b))).toEqual([0, 1, 2, 3, 4]);
    expect(r.hits).toEqual([]);
  });

  it('a Dagger Blocking a Whirlwind blow strong enough to break it is Block Broken as usual: knocked down, no damage, the spinner unharmed', () => {
    // A Whirlwind blow counts at the Weapon's reference speed, so its strength is `dealt` × `taken`. A Longsword's (1.56) stays under
    // the Dagger's bar: lower the bar just under it, as the Block Break tests do for a swing, and the rule is the usual one.
    const attacker = 'Longsword';
    const who: Who = { x: 1.0, z: 0, weapon: 'Dagger', intent: blocking };
    const plain = spin([who], { weapon: attacker, tuning: arenaWith([NORTH]) });
    expect(plain.blocks[0]!.broken).toBeUndefined();
    const held = plain.seen.find((x) => x.state.events.includes(plain.blocks[0]!))!.state;
    const strength = startBlockImpact(held.fighters[0]!, held.fighters[1]!, 'Left', weaponByName(base, attacker).speed, base).strength;
    const dagger = { ...base.weapons.Dagger!, blockImpact: { ...base.weapons.Dagger!.blockImpact, breakAt: strength - 0.01 } };
    const tuning = withWeapon(arenaWith([NORTH]), dagger, 'Dagger');
    const probe = spin([who], { weapon: attacker, tuning });
    const block = probe.blocks[0]!;
    const at = probe.seen.find((x) => x.state.events.includes(block))!.state;
    expect(block.broken).toBe(true);
    expect(at.fighters[1]!.action.kind).toBe('Knockdown');
    expect(at.fighters[1]!.hp).toBe(base.fighter.maxHp);
    expect(probe.hits).toEqual([]);
    expect(spinner(at).action.kind).toBe('Whirlwind');
  });

  it('at the default bar, a Halberd or Sledge Hammer Whirlwind (2.34) breaks a Dagger Block, a Longsword one (1.56) does not', () => {
    const who: Who = { x: 1.0, z: 0, weapon: 'Dagger', intent: blocking };
    for (const [weapon, breaks] of [['Halberd', true], ['Sledge Hammer', true], ['Longsword', undefined]] as const) {
      expect(spin([who], { weapon, tuning: arenaWith([NORTH]) }).blocks[0]!.broken, weapon).toBe(breaks);
    }
  });
});

describe('Whirlwind contacts: allies, Walls, determinism', () => {
  it('Staggers a teammate with no damage, and pushes it sideways off the heading, on the side it stands', () => {
    for (const side of [1, -1]) {
      const r = spin([{ x: side * 0.9, z: 0, team: 0 }], { tuning: arenaWith([NORTH]) });
      const hit = r.hits[0]!;
      expect(hit).toMatchObject({ attacker: 0, defender: 1, damage: 0, heavy: false, whirlwind: true });
      const k = r.seen.findIndex((x) => x.state.events.includes(hit));
      const at = r.seen[k]!.state;
      expect(at.events).toContainEqual(expect.objectContaining({ type: 'Stagger', fighter: 1, cause: 'Hit' }));
      expect(at.fighters[1]!.hp).toBe(base.fighter.maxHp);
      expect(spinner(at).action.kind).toBe('Whirlwind');
      const from = { x: side * 0.9, z: 0 }; // where it stood: it does nothing of its own
      const to = r.seen[k + base.whirlwind.allySlideTicks + 1]!.state.fighters[1]!.position;
      // The spinner is held to the heading (+z): aside is along x, away from where the ally stands.
      expect((to.x - from.x) * side).toBeGreaterThan(base.whirlwind.allySlide * 0.8);
      expect(Math.abs(to.z - from.z)).toBeLessThan(0.05);
      expect(spinner(at).action).toMatchObject({ met: { fighters: [1] } });
    }
  });

  it('pushes an ally diagonally ahead of the spinner perpendicular to the heading, not along spinner to ally', () => {
    const r = spin([{ x: 0.9, z: 0.3, team: 0 }], { tuning: arenaWith([NORTH]) });
    const hit = r.hits[0]!;
    expect(hit).toMatchObject({ attacker: 0, defender: 1, damage: 0, whirlwind: true });
    const k = r.seen.findIndex((x) => x.state.events.includes(hit));
    const from = r.seen[k]!.state.fighters[1]!.position;
    const to = r.seen[k + base.whirlwind.allySlideTicks + 1]!.state.fighters[1]!.position;
    // The heading is +z: aside is along +x (the ally stands on that side), whatever angle the ally is at from the spinner.
    expect(to.x - from.x).toBeGreaterThan(base.whirlwind.allySlide * 0.8);
    expect(Math.abs(to.z - from.z)).toBeLessThan(0.05);
  });

  it('an ally lying in a Knockdown, swept by its teammate\'s spin, no longer carries the chain it was in', () => {
    // Resolved directly: a Fighter lying down loses its `knockedBy` between Ticks, so a scripted Spin never meets one that still carries it.
    const spun = spin([{ x: 0.9, z: 0, team: 0 }, { x: 0, z: -3, team: 1 }], { tuning: arenaWith([NORTH]), ticks: 3 }).final.fighters;
    const fighters = spun.map((f, i) => (i === 1 ? { ...f, action: { kind: 'Knockdown' as const, phase: 'Down' as const, ticks: 0, guard: null }, knockedBy: 2 } : f));
    const point = point3(0.5, 1, 0);
    const contact: BladeContact = { attacker: 0, defender: 1, direction: 'Right', point, bladeSpeed: ref().speed, onHead: true, blade: { hilt: point, tip: point3(0.5, 1, 1) }, travel: point3(1, 0, 0), whirlwind: true, turn: 0, blocked: false, zone: 'torso' };
    const out = resolveContacts(fighters, [contact], fighters.map(() => IDLE_INTENT), base, () => undefined);
    expect(out[1]!.action.kind).toBe('Knockdown');
    expect(out[1]!.slide).toBeDefined();
    expect(out[1]!.knockedBy).toBeUndefined();
  });

  it('is stopped by no Wall: a defender behind one within reach is Hit, and no WallStrike is emitted', () => {
    const r = spin([{ x: 1.0, z: 0.3 }], { tuning: arenaWith([wall('between', 0.5, -5, 0.5, 5)]) });
    expect(r.hits).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'WallStrike')).toBe(false);
    expect(r.events.some((e) => e.type === 'Stagger' && e.fighter === 0)).toBe(false);
  });

  it('is the same on a re-run', () => {
    const go = () => spin([{ x: 1.0, z: 0, intent: { block: true, direction: 'Left' } }, { x: -0.9, z: 0.2, team: 0 }, { x: 0.3, z: 1.0 }], { tuning: arenaWith([NORTH, EAST]) });
    const [a, b] = [go(), go()];
    expect(a.seen.map((x) => hashState(x.state))).toEqual(b.seen.map((x) => hashState(x.state)));
    expect(a.events).toEqual(b.events);
    expect(a.hits.length + a.blocks.length).toBeGreaterThan(0);
  });
});

