import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { floorArenaName, floorOf } from './delver/world';
import { fireAt, inStairs } from './delverRun';
import { hashValue } from './hash';
import { restore, snapshot } from './snapshot';
import { runSeed } from './dungeon';
import { secondsToTicks } from './constants';
import { inDuel } from './duel';
import { createMatch, doorTicksNeeded, MAX_TEAM_SIZE, stepMatch, takeOverFighter, type MatchOptions, type MatchState } from './match';
import { IDLE_INTENT, type Intent } from './intent';
import { holdInventory, startingInventory, withStartingRelics, wieldedWeapon } from './inventory';
import type { FighterState } from './state';

const base = loadTuningData();
/** A short Run: one tier of three Floors. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
const ARENA = 'gen:greybox:4242';
const MAX = tuning.fighter.maxHp;
const { revive } = tuning.dungeon;

/** A Delver Run: Team 0's `own` Fighters (the first `humans` Players), then the MAX_TEAM_SIZE Team 1 slots. */
const delver = (options: Partial<MatchOptions> = {}, own = 3): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [...Array<number>(own).fill(0), ...Array<number>(MAX_TEAM_SIZE).fill(1)], ...options });

const idle = (m: MatchState): Intent[] => m.duel.fighters.map(() => IDLE_INTENT);
const planOf = (m: MatchState) => floorOf(tuning, m.arena)!.plan;
const team0 = (m: MatchState): FighterState[] => m.duel.fighters.filter((f) => f.team === 0);
const withFighters = (m: MatchState, edit: (f: FighterState, i: number) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map(edit) } });
const fell = (f: FighterState): FighterState => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } });

describe('a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);

  it('starts on Floor 1 at the Entrance', () => {
    expect(m.config.delver).toBe(true);
    expect(m.arena).toBe(floorArenaName(runSeed(ARENA), 1));
    expect(m.duel.arena).toBe(m.arena);
    expect(m.run).toBeNull();
    expect(m.duelNumber).toBe(1);
    expect(m.score).toEqual([0, 0]);
    expect(m.nextDuelTick).toBeNull();
    expect(m.events).toEqual([{ type: 'DuelStart', duelNumber: 1 }]);
    expect(m.delver).toEqual({
      floor: 1,
      floors: 3,
      phase: 'Exploring',
      stairsTicks: 0,
      restUsed: plan.markers.fires.map(() => ({ revived: false, healed: [] })),
      pickups: [],
      startTick: 0,
    });
    expect(m.duel.delver).toEqual({ floor: 1, phase: 'Exploring' });
    expect(m.duel.hall).toBeUndefined();
  });

  it('puts Team 0 at the spawns in order, facing into the Entrance Passage, and Benches Team 1', () => {
    const { doors } = plan.halls[plan.entrance]!;
    const side = (['n', 'e', 's', 'w'] as const).find((s) => (doors[s] ?? 0) > 0)!;
    const facing = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 }[side];
    team0(m).forEach((f, k) => {
      expect(f.position).toEqual({ x: plan.markers.spawns[k]!.x, z: plan.markers.spawns[k]!.z });
      expect(f.y).toBe(0);
      expect(f.facing).toBe(facing);
    });
    expect(team0(m)).toHaveLength(3);
    const { zone } = plan.markers.stairs;
    for (const f of m.duel.fighters.filter((x) => x.team === 1)) {
      expect(f.benched).toBe(true);
      expect(f.hp).toBe(0);
      expect(f.position).toEqual({ x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 });
    }
  });

  it('is refused with Duels, with Battle and with a start Hall', () => {
    expect(() => createMatch(tuning, { bestOf: 1, delver: true })).toThrow(RangeError);
    expect(() => createMatch(tuning, { format: 'Battle', bestOf: 1, delver: true })).toThrow();
    expect(() => delver({ start: { floor: 1, row: 1 } })).toThrow(RangeError);
  });

  it('leaves a Hall-graph Gauntlet with no delver key anywhere', () => {
    const hall = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 1, 1, 1, 1] });
    const next = stepMatch(hall, hall.duel.fighters.map(() => IDLE_INTENT), tuning);
    for (const x of [hall, next]) {
      expect('delver' in x.config).toBe(false);
      expect('delver' in x).toBe(false);
      expect('delver' in x.duel).toBe(false);
    }
  });

  it('gives a Player the dev Relics, equipped as withStartingRelics does', () => {
    const relics = tuning.relics.slice(0, 2).map((r) => r.name);
    const r = delver({ relics });
    expect(r.duel.fighters[0]!.inventory).toEqual(withStartingRelics(startingInventory(r.config.weapons[0]!), relics, tuning));
    expect(r.duel.fighters[1]!.inventory).toBeUndefined();
    expect(() => delver({ relics: ['No such relic'] })).toThrow(RangeError);
  });

  it('fades to the next Floor with HP, Inventory and the fallen carried', () => {
    const hurt = withFighters(m, (f, i) => (i === 0 ? { ...f, hp: MAX * 0.5 } : i === 1 ? fell(f) : f));
    const set: MatchState = { ...hurt, nextDuelTick: hurt.tick + 2, delver: { ...hurt.delver!, pickups: [{ id: 0, kind: 'weapon', item: 'x', owner: null, at: { x: 0, y: 0, z: 0 }, taken: false }], stairsTicks: 5 } };
    const mid = stepMatch(set, idle(set), tuning);
    expect(mid.duelNumber).toBe(1);
    const next = stepMatch(mid, idle(mid), tuning);
    expect(next.arena).toBe(floorArenaName(runSeed(ARENA), 2));
    expect(next.duelNumber).toBe(2);
    expect(next.events).toEqual([{ type: 'DuelStart', duelNumber: 2 }]);
    expect(next.nextDuelTick).toBeNull();
    const plan2 = planOf(next);
    team0(next).forEach((f, k) => expect(f.position).toEqual({ x: plan2.markers.spawns[k]!.x, z: plan2.markers.spawns[k]!.z }));
    expect(next.duel.fighters[0]!.hp).toBe(MAX * 0.5);
    expect(next.duel.fighters[1]!.hp).toBe(revive * MAX);
    expect(inDuel(next.duel.fighters[1]!)).toBe(true);
    expect(next.duel.fighters[2]!.hp).toBe(MAX);
    expect(next.delver!.floor).toBe(2);
    expect(next.delver!.pickups).toEqual([]);
    expect(next.delver!.stairsTicks).toBe(0);
    expect(next.delver!.restUsed).toHaveLength(plan2.markers.fires.length);
    expect(next.duel.delver).toEqual({ floor: 2, phase: 'Exploring' });
    expect(wieldedWeapon(next.duel.fighters[0]!.inventory!)).toBe(next.duel.fighters[0]!.weapon);
  });

  it('keeps the Inventory a Player held', () => {
    const relics = tuning.relics.slice(0, 1).map((r) => r.name);
    const r = delver({ relics });
    const inv = r.duel.fighters[0]!.inventory!;
    const set: MatchState = { ...r, nextDuelTick: r.tick + 1 };
    const next = stepMatch(set, idle(set), tuning);
    expect(next.duel.fighters[0]!.inventory).toEqual(inv);
    expect(holdInventory(next.duel.fighters[0]!, inv, tuning).mods).toEqual(next.duel.fighters[0]!.mods);
  });

  it('is a Defeat when Team 0 is wiped out, and steps no further', () => {
    const wiped = withFighters(m, (f) => (f.team === 0 ? fell(f) : f));
    const over = stepMatch(wiped, idle(wiped), tuning);
    expect(over.status).toEqual({ status: 'Over', winner: 1, tick: over.tick });
    expect(over.events).toContainEqual({ type: 'RunEnd', winner: 1, cleared: 0, floors: 3, halls: 0 });
    expect(over.nextDuelTick).toBeNull();
    // The Run is over: no fade follows.
    const later = stepMatch(over, idle(over), tuning);
    expect(later.arena).toBe(over.arena);
    expect(later.duelNumber).toBe(1);
    expect(later.status).toEqual(over.status);
  });

  it('marks a Player away on a Takeover, idempotently, and leaves an AI ally alone', () => {
    const once = takeOverFighter(m, 0);
    expect(once.delver!.away).toEqual([0]);
    expect(once.duel.delver!.away).toEqual([0]);
    expect(takeOverFighter(once, 0)).toBe(once);
    expect(takeOverFighter(m, 1)).toBe(m);
    const stepped = stepMatch(once, idle(once), tuning);
    expect(stepped.duel.delver!.away).toEqual([0]);
    const next = stepMatch({ ...stepped, nextDuelTick: stepped.tick + 1 }, idle(stepped), tuning);
    expect(next.delver!.away).toEqual([0]);
    expect(next.duel.delver!.away).toEqual([0]);
  });

  it('keeps the phase and the Floor on the Duel each Tick', () => {
    const next = stepMatch(m, idle(m), tuning);
    expect(next.tick).toBe(1);
    expect(next.duel.delver).toEqual({ floor: 1, phase: 'Exploring' });
    expect(next.delver!.phase).toBe('Exploring');
    expect(secondsToTicks(tuning.dungeon.hallFadeSeconds)).toBeGreaterThan(0);
  });
});

/** Fighter `i` stood at ground point (x, z), y 0. */
const put = (m: MatchState, i: number, x: number, z: number, y = 0): MatchState => withFighters(m, (f, k) => (k === i ? { ...f, position: { x, z }, y } : f));
/** Fighter `i` hurt to `hp`. */
const hurt = (m: MatchState, i: number, hp: number): MatchState => withFighters(m, (f, k) => (k === i ? { ...f, hp } : f));
/** `m` stepped once with every Fighter idle but those `by` overrides. */
const tick = (m: MatchState, by: Record<number, Partial<Intent>> = {}): MatchState => stepMatch(m, m.duel.fighters.map((_, i) => ({ ...IDLE_INTENT, ...by[i] })), tuning);
const times = (m: MatchState, n: number, by: Record<number, Partial<Intent>> = {}): MatchState => {
  for (let k = 0; k < n; k++) m = tick(m, by);
  return m;
};
const centre = (plan: ReturnType<typeof planOf>) => {
  const { zone } = plan.markers.stairs;
  return { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
};
/** A spot on Floor `plan` that is no fire's and not in the Stairs: the Entrance's first spawn. */
const away = (plan: ReturnType<typeof planOf>) => ({ x: plan.markers.spawns[0]!.x, z: plan.markers.spawns[0]!.z });
const ZONE_Y = 2;
const NEED = doorTicksNeeded(tuning);
const FADE = Math.max(1, secondsToTicks(tuning.dungeon.hallFadeSeconds));
const RADIUS = tuning.delver.fireRadius;
const RESTED = tuning.dungeon.restHeal;

describe('the Stairs of a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);
  const c = centre(plan);

  it('knows its zone, edges included, and its height window', () => {
    const { zone } = plan.markers.stairs;
    expect(inStairs(plan, { position: c, y: 0 })).toBe(true);
    expect(inStairs(plan, { position: { x: zone.x0, z: zone.z1 }, y: 0 })).toBe(true);
    expect(inStairs(plan, { position: { x: zone.x1 + 0.01, z: c.z }, y: 0 })).toBe(false);
    expect(inStairs(plan, { position: c, y: 1.9 })).toBe(true);
    expect(inStairs(plan, { position: c, y: 2 })).toBe(false);
    expect(inStairs(plan, { position: c, y: -0.5 })).toBe(false);
  });

  it('takes the party down once the Player has stood in the zone for doorSeconds', () => {
    let r = put(m, 0, c.x, c.z);
    r = times(r, NEED - 1);
    expect(r.delver!.stairsTicks).toBe(NEED - 1);
    expect(r.delver!.phase).toBe('Exploring');
    const took = tick(r);
    expect(took.delver!.phase).toBe('Descending');
    expect(took.duel.delver!.phase).toBe('Descending');
    expect(took.events).toContainEqual({ type: 'StairsTaken', floor: 1 });
    expect(took.nextDuelTick).toBe(took.tick + FADE);
    expect(took.score).toEqual([1, 0]);
  });

  it('resets when the Player steps out', () => {
    let r = times(put(m, 0, c.x, c.z), NEED - 1);
    r = tick(put(r, 0, away(plan).x, away(plan).z));
    expect(r.delver!.stairsTicks).toBe(0);
    r = times(put(r, 0, c.x, c.z), NEED - 1);
    expect(r.delver!.phase).toBe('Exploring');
  });

  it('counts an AI ally alone in the zone for nothing while the Player lives elsewhere', () => {
    const r = times(put(m, 1, c.x, c.z), NEED + 3);
    expect(r.delver!.stairsTicks).toBe(0);
    expect(r.delver!.phase).toBe('Exploring');
  });

  it('counts the living AI allies once the Player has fallen', () => {
    let r = withFighters(m, (f, i) => (i === 0 ? fell(f) : f));
    r = put(put(r, 1, c.x, c.z), 2, c.x, c.z);
    r = times(r, NEED - 1);
    expect(r.delver!.phase).toBe('Exploring');
    r = tick(r);
    expect(r.delver!.phase).toBe('Descending');
    // One ally outside: nothing counts.
    let r2 = withFighters(m, (f, i) => (i === 0 ? fell(f) : f));
    r2 = times(put(put(r2, 1, c.x, c.z), 2, away(plan).x, away(plan).z), NEED + 2);
    expect(r2.delver!.stairsTicks).toBe(0);
  });

  it('counts nothing more while Descending, then enters Floor 2 after the fade', () => {
    let r = times(put(m, 0, c.x, c.z), NEED);
    expect(r.delver!.phase).toBe('Descending');
    r = times(r, FADE - 1);
    expect(r.delver!.stairsTicks).toBe(NEED);
    expect(r.score).toEqual([1, 0]);
    expect(r.events).toEqual([]);
    expect(r.duelNumber).toBe(1);
    r = tick(r);
    expect(r.duelNumber).toBe(2);
    expect(r.delver!.floor).toBe(2);
    expect(r.delver!.phase).toBe('Exploring');
    expect(r.score).toEqual([1, 0]);
  });
});

describe('the last Stairs of a Delver Run', { timeout: 60_000 }, () => {
  const one: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 1 } };
  const m = createMatch(one, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0, 0, 0, 1, 1, 1, 1] });
  const c = centre(floorOf(one, m.arena)!.plan);
  const go = (r: MatchState): MatchState => stepMatch(r, r.duel.fighters.map(() => IDLE_INTENT), one);

  it('is a Victory: the Run over, a Duel end, no fade', () => {
    let r: MatchState = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: { x: c.x, z: c.z } } : f)) } };
    for (let k = 0; k < NEED - 1; k++) r = go(r);
    expect(r.status.status).toBe('InProgress');
    r = go(r);
    expect(r.status).toEqual({ status: 'Over', winner: 0, tick: r.tick });
    expect(r.events).toContainEqual({ type: 'RunEnd', winner: 0, cleared: 1, floors: 1, halls: 0 });
    expect(r.events.some((e) => e.type === 'StairsTaken')).toBe(false);
    expect(r.duel.duel).toEqual({ status: 'Over', winner: 0, tick: r.duel.tick });
    expect(r.duel.events).toContainEqual({ type: 'DuelEnd', winner: 0 });
    expect(r.nextDuelTick).toBeNull();
    expect(r.delver!.phase).toBe('Exploring');
    const after = go(r);
    expect(after.status).toEqual(r.status);
    expect(after.duelNumber).toBe(1);
    expect(after.events).toEqual([]);
    expect(after.nextDuelTick).toBeNull();
  });
});

describe('the fires of a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);
  const [fire] = plan.markers.fires;
  const at = (r: MatchState, i: number, k = 0, dx = 0) => put(r, i, plan.markers.fires[k]!.x + dx, plan.markers.fires[k]!.z);
  const off = away(plan);

  it('finds the fire a Fighter stands within the radius of', () => {
    expect(fire).toBeDefined();
    expect(fireAt(plan, { position: { x: fire!.x, z: fire!.z }, y: 0 }, RADIUS)).toBe(0);
    expect(fireAt(plan, { position: { x: fire!.x + RADIUS, z: fire!.z }, y: 0 }, RADIUS)).toBe(0);
    expect(fireAt(plan, { position: { x: fire!.x + RADIUS + 0.01, z: fire!.z }, y: 0 }, RADIUS)).toBe(-1);
    expect(fireAt(plan, { position: { x: fire!.x, z: fire!.z }, y: ZONE_Y }, RADIUS)).toBe(-1);
    expect(fireAt(plan, { position: off, y: 0 }, RADIUS)).toBe(-1);
  });

  it('heals a Player once per fire, by restHeal of max HP, and marks it healed', () => {
    let r = at(hurt(m, 0, MAX * 0.4), 0);
    r = tick(r);
    expect(r.duel.fighters[0]!.hp).toBeCloseTo(MAX * (0.4 + RESTED));
    expect(r.events).toContainEqual({ type: 'Rested', fighter: 0, healed: r.duel.fighters[0]!.hp - MAX * 0.4 });
    expect(r.delver!.restUsed[0]).toEqual({ revived: true, healed: [0] });
    // Staying heals nothing more; neither does leaving and coming back.
    const hp = r.duel.fighters[0]!.hp;
    r = hurt(times(r, 3), 0, hp);
    r = at(tick(put(r, 0, off.x, off.z)), 0);
    r = tick(r);
    expect(r.duel.fighters[0]!.hp).toBe(hp);
    expect(r.events).toEqual([]);
  });

  it('caps at max HP, and a Player at full HP is still marked healed with 0', () => {
    const r = tick(at(hurt(m, 0, MAX - 1), 0));
    expect(r.duel.fighters[0]!.hp).toBe(MAX);
    const full = tick(at(m, 0));
    expect(full.events).toContainEqual({ type: 'Rested', fighter: 0, healed: 0 });
    expect(full.delver!.restUsed[0]!.healed).toEqual([0]);
  });

  it('never heals an AI ally, and an ally alone spends nothing', () => {
    const r = tick(at(hurt(m, 1, MAX * 0.4), 1));
    expect(r.duel.fighters[1]!.hp).toBe(MAX * 0.4);
    expect(r.delver!.restUsed).toEqual(m.delver!.restUsed);
    expect(r.events).toEqual([]);
  });

  it('heals again at a second fire', () => {
    const two = [...Array(40).keys()].map((k) => `gen:greybox:${k + 1}`).find((arena) => floorOf(tuning, floorArenaName(runSeed(arena), 1))!.plan.markers.fires.length >= 2);
    expect(two).toBeDefined();
    const r0 = delver({ arena: two });
    const p = planOf(r0);
    let r = tick(put(hurt(r0, 0, MAX * 0.2), 0, p.markers.fires[0]!.x, p.markers.fires[0]!.z));
    expect(r.delver!.restUsed.map((u) => u.healed)).toEqual([[0], ...p.markers.fires.slice(1).map(() => [])]);
    const hp1 = r.duel.fighters[0]!.hp;
    expect(hp1).toBeCloseTo(MAX * (0.2 + RESTED));
    r = tick(put(r, 0, p.markers.fires[1]!.x, p.markers.fires[1]!.z));
    expect(r.delver!.restUsed[1]!.healed).toEqual([0]);
    expect(r.duel.fighters[0]!.hp).toBeCloseTo(Math.min(MAX, hp1 + RESTED * MAX));
  });

  it('revives a fallen AI ally at the fire when the Player arrives, at revive of max HP, weapon kept', () => {
    const ally = m.duel.fighters[1]!;
    const r0 = withFighters(m, (f, i) => (i === 1 ? { ...fell(f), weapon: 'Dagger' } : f));
    const r = tick(at(r0, 0));
    const back = r.duel.fighters[1]!;
    expect(back.death).toBeUndefined();
    expect(inDuel(back)).toBe(true);
    expect(back.hp).toBe(revive * MAX);
    expect(back.weapon).toBe('Dagger');
    expect(Math.hypot(back.position.x - fire!.x, back.position.z - fire!.z)).toBeLessThanOrEqual(RADIUS);
    expect(back.position).toEqual({ x: fire!.x - 1.5, z: fire!.z - 1.5 });
    expect(back.facing).toBe(ally.facing);
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 1, fire: 0 });
    expect(r.delver!.restUsed[0]!.revived).toBe(true);
  });

  it('revives a fallen Player, who then heals at once in the same Tick', () => {
    const r0 = withFighters(at(m, 1), (f, i) => (i === 0 ? fell(f) : f));
    expect(inDuel(r0.duel.fighters[0]!)).toBe(false);
    // An AI ally arriving alone revives nobody.
    const alone = tick(r0);
    expect(alone.duel.fighters[0]!.death).toBeDefined();
    expect(alone.delver!.restUsed[0]).toEqual({ revived: false, healed: [] });
    // A fallen Player is revived by another Player arriving, so use a two-Player Run.
    const two = delver({ humans: 2 });
    const p = planOf(two);
    const fallen = withFighters(two, (f, i) => (i === 0 ? fell(f) : f));
    const r = tick(put(fallen, 1, p.markers.fires[0]!.x, p.markers.fires[0]!.z));
    expect(r.duel.fighters[0]!.death).toBeUndefined();
    expect(r.duel.fighters[0]!.hp).toBeCloseTo(Math.min(MAX, (revive + RESTED) * MAX));
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 0, fire: 0 });
    expect(r.events).toContainEqual({ type: 'Rested', fighter: 0, healed: r.duel.fighters[0]!.hp - revive * MAX });
    expect(r.delver!.restUsed[0]!.healed).toEqual([0, 1]);
  });

  it('spends the revive: a second fall at that fire is not revived, but another fire still revives', () => {
    const two = [...Array(40).keys()].map((k) => `gen:greybox:${k + 1}`).find((arena) => floorOf(tuning, floorArenaName(runSeed(arena), 1))!.plan.markers.fires.length >= 2)!;
    const r0 = delver({ arena: two });
    const p = planOf(r0);
    const f0 = p.markers.fires[0]!;
    const f1 = p.markers.fires[1]!;
    let r = tick(put(withFighters(r0, (f, i) => (i === 1 ? fell(f) : f)), 0, f0.x, f0.z));
    expect(r.duel.fighters[1]!.death).toBeUndefined();
    r = withFighters(put(r, 0, off.x, off.z), (f, i) => (i === 1 ? fell(f) : f));
    r = tick(put(r, 0, f0.x, f0.z));
    expect(r.duel.fighters[1]!.death).toBeDefined();
    r = tick(put(r, 0, f1.x, f1.z));
    expect(r.duel.fighters[1]!.death).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 1, fire: 1 });
  });

  it('is spent by the first arrival even with nobody fallen', () => {
    let r = tick(at(m, 0));
    expect(r.delver!.restUsed[0]!.revived).toBe(true);
    r = withFighters(put(r, 0, off.x, off.z), (f, i) => (i === 1 ? fell(f) : f));
    r = tick(at(r, 0));
    expect(r.duel.fighters[1]!.death).toBeDefined();
  });

  it('keeps a fallen Fighter\'s inventory through the revive', () => {
    const relics = tuning.relics.slice(0, 2).map((x) => x.name);
    const r0 = delver({ relics, humans: 2 });
    const p = planOf(r0);
    const inv = r0.duel.fighters[0]!.inventory!;
    const fallen = withFighters(r0, (f, i) => (i === 0 ? fell(f) : f));
    const r = tick(put(fallen, 1, p.markers.fires[0]!.x, p.markers.fires[0]!.z));
    expect(r.duel.fighters[0]!.inventory).toEqual(inv);
    expect(r.duel.fighters[0]!.mods).toEqual(r0.duel.fighters[0]!.mods);
  });

  it('revives several in Fighter order at the corners', () => {
    const r = tick(at(withFighters(m, (f, i) => (i >= 1 ? fell(f) : f)), 0));
    expect(r.duel.fighters[1]!.position).toEqual({ x: fire!.x - 1.5, z: fire!.z - 1.5 });
    expect(r.duel.fighters[2]!.position).toEqual({ x: fire!.x + 1.5, z: fire!.z - 1.5 });
  });
});

describe('the Inventory of a Delver Run', { timeout: 60_000 }, () => {
  const relics = tuning.relics.slice(0, 2).map((x) => x.name);
  const m = delver({ relics });
  const plan = planOf(m);
  const fire = plan.markers.fires[0]!;
  const off = away(plan);
  const equip = { equip: { kind: 'relic' as const, slot: 0 } };
  const equipped = (r: MatchState) => r.duel.fighters[0]!.inventory!.equipped;

  it('refuses an equip away from every fire', () => {
    const r = tick(put(m, 0, off.x, off.z), { 0: equip });
    expect(equipped(r)).toEqual(equipped(m));
  });

  it('takes an equip within the fire radius, not just outside it', () => {
    const inside = tick(put(m, 0, fire.x + RADIUS, fire.z), { 0: equip });
    expect(equipped(inside)).not.toEqual(equipped(m));
    const outside = tick(put(m, 0, fire.x + RADIUS + 0.01, fire.z), { 0: equip });
    expect(equipped(outside)).toEqual(equipped(m));
  });

  it('refuses an equip while Descending', () => {
    const d: MatchState = { ...put(m, 0, fire.x, fire.z), delver: { ...m.delver!, phase: 'Descending' }, nextDuelTick: m.tick + 50 };
    expect(equipped(tick(d, { 0: equip }))).toEqual(equipped(m));
  });

  it('lays a drop at a fire as a shared pickup, taken back anywhere once stepped off and on', () => {
    const drop = { drop: { kind: 'relic' as const, slot: 1 } };
    let r = tick(put(m, 0, fire.x, fire.z), { 0: drop });
    expect(r.events).toContainEqual({ type: 'ItemDropped', fighter: 0, kind: 'relic', item: relics[1]!, at: { x: fire.x, y: 0, z: fire.z } });
    expect(r.delver!.pickups).toHaveLength(1);
    expect(r.delver!.pickups[0]).toMatchObject({ id: 0, kind: 'relic', item: relics[1], owner: null, taken: false });
    expect(r.duel.fighters[0]!.inventory!.relics).toEqual([relics[0]]);
    // Standing on it does not take it back; stepping off, then on again away from the fire does.
    r = tick(r);
    expect(r.delver!.pickups[0]!.taken).toBe(false);
    r = tick(put(r, 0, off.x, off.z));
    expect(r.delver!.pickups[0]!.taken).toBe(false);
    r = tick(put(r, 0, fire.x, fire.z));
    expect(r.delver!.pickups[0]!.taken).toBe(true);
    expect(r.events).toContainEqual({ type: 'ItemTaken', fighter: 0, id: 0, kind: 'relic', item: relics[1]! });
    expect(r.duel.fighters[0]!.inventory!.relics).toEqual([relics[0], relics[1]]);
  });

  it('takes a pickup anywhere, with no fire near', () => {
    const lying = { id: 0, kind: 'relic' as const, item: relics[1]!, owner: null, at: { x: off.x, y: 0, z: off.z }, taken: false };
    const r = tick(put({ ...m, delver: { ...m.delver!, pickups: [lying] } }, 0, off.x, off.z));
    expect(r.delver!.pickups[0]!.taken).toBe(true);
  });
});

describe('a Takeover in a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);
  const c = centre(plan);
  const fire = plan.markers.fires[0]!;

  it('counts an away Player at neither the Stairs, the heal nor the revive', () => {
    const gone = takeOverFighter(m, 0);
    // Only the AI allies count, so the Player standing in the zone alone counts for nothing.
    const stairs = times(put(gone, 0, c.x, c.z), NEED + 2);
    expect(stairs.delver!.stairsTicks).toBe(0);
    // With no present Player, the living AI allies count (the away Player among them), so all three in the zone take the Stairs.
    const allies = times(put(put(put(gone, 0, c.x, c.z), 1, c.x, c.z), 2, c.x, c.z), NEED);
    expect(allies.delver!.phase).toBe('Descending');
    const healed = tick(put(hurt(gone, 0, MAX * 0.5), 0, fire.x, fire.z));
    expect(healed.duel.fighters[0]!.hp).toBe(MAX * 0.5);
    expect(healed.delver!.restUsed[0]).toEqual({ revived: false, healed: [] });
    const revived = tick(put(withFighters(gone, (f, i) => (i === 1 ? fell(f) : f)), 0, fire.x, fire.z));
    expect(revived.duel.fighters[1]!.death).toBeDefined();
  });
});

describe('a Delver Run: deterministic, and Rollback across a Floor change', { timeout: 60_000 }, () => {
  /** A scripted Run: the Player starts in the Stairs, takes them, and turns about on Floor 2 for 40 Ticks. */
  function play(): { states: MatchState[]; intents: Intent[][] } {
    const start = delver();
    const c = centre(planOf(start));
    let m = put(hurt(start, 1, MAX * 0.5), 0, c.x, c.z);
    const states = [m];
    const intents: Intent[][] = [];
    let changed = -1;
    for (let k = 0; k < 600 && (changed < 0 || k < changed + 40); k++) {
      const these = m.duel.fighters.map((_, i) => (i === 0 && m.duelNumber === 2 ? { ...IDLE_INTENT, move: { x: 1, z: 0 }, face: 1 } : i === 2 ? { ...IDLE_INTENT, move: { x: 0, z: 0.5 } } : IDLE_INTENT));
      intents.push(these);
      m = stepMatch(m, these, tuning);
      states.push(m);
      if (changed < 0 && m.duelNumber === 2) changed = k;
    }
    return { states, intents };
  }

  it('gives the same hash at every Tick for the same Intents, across a Floor change', () => {
    const one = play();
    const two = play();
    expect(one.states.map((x) => hashValue(x))).toEqual(two.states.map((x) => hashValue(x)));
    expect(one.states.at(-1)!.duelNumber).toBe(2);
  });

  it('re-simulates to the same state from a snapshot taken before the Floor change', () => {
    const { states, intents } = play();
    const change = states.findIndex((x) => x.duelNumber === 2);
    for (const back of [change - 1, change - Math.floor(FADE / 2), change - FADE, change - FADE - 20]) {
      let r = restore(snapshot(states[back]!));
      for (let k = back; k < states.length - 1; k++) {
        r = stepMatch(r, intents[k]!, tuning);
        expect(hashValue(r)).toBe(hashValue(states[k + 1]!));
      }
    }
  });
});
