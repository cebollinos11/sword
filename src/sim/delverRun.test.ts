import { describe, expect, it } from 'vitest';
import { descendTicks } from './delverRun';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaOf } from './arena';
import { storedMods } from './mods';
import { floorNear } from './levels';
import { LAVA_KEEP } from './delver/plan';
import { arenaTuning, floorArenaName, floorOf } from './delver/world';
import { emptyReveal, fullReveal, isRevealed, revealBits, withReveal } from './delver/reveal';
import { dropSpots, treasurePickups, warbandDrops } from './delverLoot';
import { pickItemAt } from './pickups';
import { countStats, fireAt, inStairs, NO_STATS, REVIVE_MARGIN, STONE_REVIVE } from './delverRun';
import { hashValue } from './hash';
import { restore, snapshot } from './snapshot';
import { runSeed } from './dungeon';
import { secondsToTicks } from './constants';
import { inDuel } from './duel';
import { createMatch, stairsTicksNeeded, MAX_TEAM_SIZE, stepMatch, takeOverFighter, type MatchOptions, type MatchState } from './match';
import { IDLE_INTENT, type Intent } from './intent';
import { addItem, commonItem, holdInventory, inventoryMods, startingInventory, useInventory, withStartingRelics, wieldedWeapon } from './inventory';
import type { FighterState } from './state';
import { flatFloors, noSetPieces } from './delver/flat.testdata';

const base = flatFloors(loadTuningData());
/** `t` with every tier's Boss removed: its last Floor is an ordinary Floor, whose Stairs are the Victory. */
const noBosses = (t: TuningData): TuningData => ({ ...t, delver: { ...t.delver, warbands: t.delver.warbands.map(({ boss: _b, ...tier }) => tier) } });
/** A short Run: one tier of three Floors, with Warbands (the Tuning Data's own). */
const warbanded: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3 } };
/** The same on an empty Floor (`postFill` and `patrolFill` 0: still a Crowd, of no Soldiers), for the cases that assert on the party alone. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0 } };
const ARENA = 'gen:greybox:4242';
const MAX = tuning.fighter.maxHp;
const { revive, restRevive } = tuning.dungeon;

/** A Delver Run: Team 0's `own` Fighters (the first `humans` Players), then the MAX_TEAM_SIZE Team 1 slots. */
const delver = (options: Partial<MatchOptions> = {}, own = 3): MatchState =>
  createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [...Array<number>(own).fill(0), ...Array<number>(MAX_TEAM_SIZE).fill(1)], ...options });

const idle = (m: MatchState): Intent[] => m.duel.fighters.map(() => IDLE_INTENT);
const planOf = (m: MatchState) => floorOf(tuning, m.arena)!.plan;
const team0 = (m: MatchState): FighterState[] => m.duel.fighters.filter((f) => f.team === 0);
const withFighters = (m: MatchState, edit: (f: FighterState, i: number) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map(edit) } });
/** The pedestals Floor `m` is on holds from its start (`treasurePickups` under the Floor's Tuning Data). */
const floorPedestals = (m: MatchState) => treasurePickups(arenaTuning(tuning, m.arena), m.config, planOf(m), runSeed(ARENA), m.delver!.floor, m.delver!.away);
const fell = (f: FighterState): FighterState => ({ ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } });

describe('a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);

  it('starts on Floor 1 at the Entrance', () => {
    expect(m.config.format).toBe('Gauntlet');
    expect('delver' in m.config).toBe(false);
    expect(m.arena).toBe(floorArenaName(runSeed(ARENA), 1));
    expect(m.duel.arena).toBe(m.arena);
    expect('run' in m).toBe(false);
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
      wiped: [], // Stage 4: no Warband is wiped at the Floor's start.
      beaten: 0, // Stage 5: no Floor before it.
      pickups: floorPedestals(m), // Stage 4: the Floor's Treasure Halls hold their pedestals from its start.
      revealed: withReveal(emptyReveal(plan), plan.entrance), // Stage 5: the Entrance starts revealed.
      startTick: 0,
      stats: m.config.teams.map(() => NO_STATS), // Run stats: nothing counted yet.
    });
    expect(m.duel.delver).toEqual({ floor: 1, phase: 'Exploring', pickups: m.delver!.pickups }); // Stage 4: the mirror carries the Run's pickups.
    expect('hall' in m.duel).toBe(false);
  });

  it('puts the party at the spawns in order, facing into the Entrance Passage, then the Fighter Pool unbound, and the Floor Crowd deployed', () => {
    const w = createMatch(warbanded, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 0, 1, 1, 1, 1] });
    const wplan = floorOf(warbanded, w.arena)!.plan;
    const { doors } = wplan.halls[wplan.entrance]!;
    const side = (['n', 'e', 's', 'w'] as const).find((s) => (doors[s] ?? 0) > 0)!;
    const facing = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 }[side];
    const { poolSize } = warbanded.battle.bubble;
    expect(w.config.teams).toEqual([0, 0, 0]);
    expect(w.config.weapons).toHaveLength(3);
    expect(w.duel.fighters).toHaveLength(poolSize);
    w.duel.fighters.slice(0, 3).forEach((f, k) => {
      expect(f.team).toBe(0);
      expect(f.position).toEqual({ x: wplan.markers.spawns[k]!.x, z: wplan.markers.spawns[k]!.z });
      expect(f.y).toBe(0);
      expect(f.facing).toBe(facing);
      expect(f.benched).toBeUndefined();
    });
    for (const f of w.duel.fighters.slice(3)) {
      expect(f.team).toBe(1);
      expect(f.benched).toBe(true);
      expect(f.hp).toBe(0);
      expect(f.soldier).toBeUndefined();
    }
    const crowd = w.duel.crowd!;
    expect(crowd.warbands).toBeDefined();
    expect(crowd.squads.team.length).toBe(crowd.warbands!.mode.length);
    expect(crowd.squads.team.length).toBeGreaterThan(0);
    expect(crowd.team.every((t) => t === 1)).toBe(true);
    expect(crowd.players).toEqual([]);
    expect(crowd.maxHp).toHaveLength(crowd.x.length);
    // The empty Floor still has a Crowd, of no Soldiers.
    const empty = m.duel.crowd!;
    expect(empty.x).toHaveLength(0);
    expect(empty.squads.team).toHaveLength(0);
    expect(team0(m)).toHaveLength(3);
    expect(m.duel.fighters).toHaveLength(poolSize);
  });

  it('drops the Team 1 slots of the teams it is given, and refuses Team 1 Fighters inside the party', () => {
    expect(m.config.teams).toEqual([0, 0, 0]);
    expect(m.config.weapons).toHaveLength(3);
    const alone = delver({ teams: [0, 0, 0] });
    expect(alone.config.teams).toEqual([0, 0, 0]);
    expect(alone.duel.fighters).toHaveLength(tuning.battle.bubble.poolSize);
    expect(delver({ teams: [0, 1, 1, 1, 1] }, 1).config.teams).toEqual([0]);
    expect(() => delver({ teams: [0, 1, 0, 1, 1, 1, 1] })).toThrow(RangeError);
    expect(() => delver({ teams: [0, 0, 1] })).toThrow(RangeError);
    expect(() => delver({ teams: [0, 0, 0, 0, 0] })).toThrow(RangeError);
    expect(() => delver({ teams: [1, 1, 1, 1] })).toThrow(RangeError);
    expect(() => delver({ teams: [] })).toThrow(RangeError);
  });

  it('keeps its start Floor and traitors to a Gauntlet', () => {
    expect(() => createMatch(tuning, { bestOf: 1, delverStart: 1 })).toThrow(RangeError);
    expect(() => createMatch(tuning, { bestOf: 1, traitors: [{}] })).toThrow(RangeError);
    expect(() => createMatch(tuning, { format: 'Battle', bestOf: 1, delverStart: 1 })).toThrow();
  });

  it('leaves a Duels Match with no Run key anywhere', () => {
    const duels = createMatch(tuning, { bestOf: 1, seed: 7 });
    const next = stepMatch(duels, duels.duel.fighters.map(() => IDLE_INTENT), tuning);
    for (const x of [duels, next]) {
      expect('delver' in x.config).toBe(false);
      expect('delver' in x).toBe(false);
      expect('run' in x).toBe(false);
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
    const set: MatchState = { ...hurt, nextDuelTick: hurt.tick + 2, delver: { ...hurt.delver!, pickups: [{ id: 0, kind: 'weapon', item: commonItem('x'), owner: null, at: { x: 0, y: 0, z: 0 }, taken: false }], stairsTicks: 5 } };
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
    expect(next.delver!.pickups).toEqual(floorPedestals(next)); // Stage 4: the new Floor starts with its own pedestals only.
    expect(next.delver!.stairsTicks).toBe(0);
    expect(next.delver!.restUsed).toHaveLength(plan2.markers.fires.length);
    expect(next.duel.delver).toEqual({ floor: 2, phase: 'Exploring', pickups: next.delver!.pickups }); // Stage 4: the mirror carries the Run's pickups.
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
    expect(over.events).toContainEqual({ type: 'RunEnd', winner: 1, floors: 3, bosses: 0, warbands: 0 });
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
    expect(next.duel.delver).toEqual({ floor: 1, phase: 'Exploring', pickups: next.delver!.pickups }); // Stage 4: the mirror carries the Run's pickups.
    expect(next.delver!.phase).toBe('Exploring');
    expect(secondsToTicks(tuning.dungeon.fadeSeconds)).toBeGreaterThan(0);
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
const NEED = stairsTicksNeeded(tuning);
const FADE = descendTicks(tuning); // the fade and the dark between Floors
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

  it('takes the party down once the Player has stood in the zone for stairsSeconds', () => {
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

  it('stands the Floor still once the screen is fully dark (delver.descendSeconds), until the next Floor', () => {
    let r = times(put(m, 0, c.x, c.z), NEED);
    const fade = Math.max(1, secondsToTicks(tuning.dungeon.fadeSeconds));
    expect(r.nextDuelTick).toBe(r.tick + fade + secondsToTicks(tuning.delver.descendSeconds));
    r = times(r, fade);
    const dark = r.duel;
    const walk = (x: MatchState): Intent[] => x.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, move: { x: 1, z: 0 } } : IDLE_INTENT));
    while (r.nextDuelTick !== null && r.tick + 1 < r.nextDuelTick) {
      r = stepMatch(r, walk(r), tuning);
      expect(r.duel.tick).toBe(dark.tick);
      expect(r.duel.fighters).toBe(dark.fighters);
      expect(r.duel.crowd).toBe(dark.crowd);
    }
    r = tick(r);
    expect(r.delver!.floor).toBe(2);
  });

  it('counts a revive for each Fighter fallen when the party takes the Stairs (Run stats)', () => {
    let r = withFighters(m, (f, i) => (i === 1 ? fell(f) : f));
    r = times(put(r, 0, c.x, c.z), NEED + FADE);
    expect(r.delver!.floor).toBe(2);
    expect(r.delver!.stats[1]!.revived).toBe(1);
    expect(r.delver!.stats[0]!.revived).toBe(0);
    expect(r.delver!.stats[2]!.revived).toBe(0);
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
  const one: TuningData = noBosses({ ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 1 } });
  const m = createMatch(one, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 0, 1, 1, 1, 1] });
  const c = centre(floorOf(one, m.arena)!.plan);
  const go = (r: MatchState): MatchState => stepMatch(r, r.duel.fighters.map(() => IDLE_INTENT), one);

  it('is a Victory: the Run over, a Duel end, no fade', () => {
    let r: MatchState = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: { x: c.x, z: c.z } } : f)) } };
    for (let k = 0; k < NEED - 1; k++) r = go(r);
    expect(r.status.status).toBe('InProgress');
    r = go(r);
    expect(r.status).toEqual({ status: 'Over', winner: 0, tick: r.tick });
    expect(r.events).toContainEqual({ type: 'RunEnd', winner: 0, floors: 1, bosses: 0, warbands: 0 });
    expect(r.score[0]).toBe(1);
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
    expect(r.duel.fighters[0]!.hp).toBeCloseTo(Math.min(MAX, MAX * (0.4 + RESTED)));
    expect(r.events).toContainEqual({ type: 'Rested', fighter: 0, healed: r.duel.fighters[0]!.hp - MAX * 0.4 });
    expect(r.delver!.restUsed[0]).toEqual({ revived: false, healed: [0] });
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
    expect(hp1).toBeCloseTo(Math.min(MAX, MAX * (0.2 + RESTED)));
    r = tick(put(r, 0, p.markers.fires[1]!.x, p.markers.fires[1]!.z));
    expect(r.delver!.restUsed[1]!.healed).toEqual([0]);
    expect(r.duel.fighters[0]!.hp).toBeCloseTo(Math.min(MAX, hp1 + RESTED * MAX));
  });

  it('revives a fallen AI ally at the fire when the Player arrives, at restRevive of max HP, weapon kept', () => {
    const ally = m.duel.fighters[1]!;
    const r0 = withFighters(m, (f, i) => (i === 1 ? { ...fell(f), weapon: 'Dagger' } : f));
    const r = tick(at(r0, 0));
    const back = r.duel.fighters[1]!;
    expect(back.death).toBeUndefined();
    expect(inDuel(back)).toBe(true);
    expect(back.hp).toBe(restRevive * MAX);
    expect(back.weapon).toBe('Dagger');
    expect(Math.hypot(back.position.x - fire!.x, back.position.z - fire!.z)).toBeLessThanOrEqual(RADIUS);
    expect(back.position).toEqual({ x: fire!.x - 1.5, z: fire!.z - 1.5 });
    expect(back.facing).toBe(ally.facing);
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 1, fire: 0 });
    expect(r.delver!.restUsed[0]!.revived).toBe(true);
    expect(r.delver!.stats[1]).toEqual({ ...NO_STATS, revived: 1 }); // Run stats: a revive.
    expect(r.delver!.stats[0]).toEqual(NO_STATS);
  });

  it('revives a fallen Player at restRevive of max HP, who takes no heal at that fire, while the Player there heals', () => {
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
    expect(r.duel.fighters[0]!.hp).toBeCloseTo(restRevive * MAX);
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 0, fire: 0 });
    expect(r.events.some((e) => e.type === 'Rested' && e.fighter === 0)).toBe(false);
    expect(r.events).toContainEqual({ type: 'Rested', fighter: 1, healed: 0 });
    expect(r.delver!.restUsed[0]!.healed).toEqual([0, 1]);
    // Staying at the fire heals the revived Player no further.
    expect(tick(r).duel.fighters[0]!.hp).toBeCloseTo(restRevive * MAX);
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

  it('is not spent by a Player passing with nobody fallen; it revives, and is spent, when an ally has fallen by the next visit', () => {
    let r = tick(at(m, 0));
    expect(r.delver!.restUsed[0]).toEqual({ revived: false, healed: [0] });
    r = withFighters(put(r, 0, off.x, off.z), (f, i) => (i === 1 ? fell(f) : f));
    r = tick(at(r, 0));
    expect(r.duel.fighters[1]!.death).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 1, fire: 0 });
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

  it('takes an equip away from every fire', () => {
    const r = tick(put(m, 0, off.x, off.z), { 0: equip });
    expect(equipped(r)).not.toEqual(equipped(m));
  });

  it('refuses an equip while Descending', () => {
    const d: MatchState = { ...put(m, 0, fire.x, fire.z), delver: { ...m.delver!, phase: 'Descending' }, nextDuelTick: m.tick + 50 };
    expect(equipped(tick(d, { 0: equip }))).toEqual(equipped(m));
  });

  it('lays a drop at a fire as a shared pickup, taken back anywhere once stepped off and on', () => {
    const drop = { drop: { kind: 'relic' as const, slot: 1 } };
    // Stage 4: the Floor's pedestals lie first, so the drop is the pickup after them (its id is their count).
    const lying = m.delver!.pickups.length;
    let r = tick(put(m, 0, fire.x, fire.z), { 0: drop });
    expect(r.events).toContainEqual({ type: 'ItemDropped', fighter: 0, kind: 'relic', item: commonItem(relics[1]!), at: { x: fire.x, y: 0, z: fire.z } });
    expect(r.delver!.pickups).toHaveLength(lying + 1);
    expect(r.delver!.pickups[lying]).toMatchObject({ id: lying, kind: 'relic', item: commonItem(relics[1]!), owner: null, taken: false });
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([relics[0]]);
    // Standing on it does not take it back; stepping off, then on again away from the fire does.
    r = tick(r);
    expect(r.delver!.pickups[lying]!.taken).toBe(false);
    r = tick(put(r, 0, off.x, off.z));
    expect(r.delver!.pickups[lying]!.taken).toBe(false);
    r = tick(put(r, 0, fire.x, fire.z));
    expect(r.delver!.pickups[lying]!.taken).toBe(true);
    expect(r.events).toContainEqual({ type: 'ItemTaken', fighter: 0, id: lying, kind: 'relic', item: commonItem(relics[1]!) });
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([relics[0], relics[1]]);
  });

  it('takes a pickup anywhere, with no fire near', () => {
    const lying = { id: 0, kind: 'relic' as const, item: commonItem(relics[1]!), owner: null, at: { x: off.x, y: 0, z: off.z }, taken: false };
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

describe('a Player equipping another Weapon mid-Floor', { timeout: 60_000 }, () => {
  const twoWeapons = (): MatchState => {
    const start = delver();
    const c = centre(planOf(start));
    const inventory = { ...startingInventory('Dagger'), weapons: [commonItem('Dagger'), commonItem('Arming Sword')] };
    return put(withFighters(start, (f, i) => (i === 0 ? holdInventory(f, inventory, tuning) : f)), 0, c.x, c.z);
  };
  const EQUIP_AT = 10;
  /** Idle Intents but Player 0's `equip` of Weapon slot 1 on Tick `EQUIP_AT`, for 40 Ticks. */
  const play = (): { states: MatchState[]; intents: Intent[][] } => {
    let m = twoWeapons();
    const states = [m];
    const intents: Intent[][] = [];
    for (let k = 0; k < 40; k++) {
      const these = m.duel.fighters.map((_, i) => (i === 0 && k === EQUIP_AT ? { ...IDLE_INTENT, equip: { kind: 'weapon' as const, slot: 1 } } : IDLE_INTENT));
      intents.push(these);
      m = stepMatch(m, these, tuning);
      states.push(m);
    }
    return { states, intents };
  };

  it('changes the Mods at the equip, and a replay from a snapshot taken before it ends with the same hashState', () => {
    const { states, intents } = play();
    expect(states[EQUIP_AT]!.duel.fighters[0]!.mods).toMatchObject({ daggers: 1, daggerDamage: 1.25 });
    const after = states.at(-1)!.duel.fighters[0]!;
    expect(after.weapon).toBe('Arming Sword');
    expect(after.mods).toMatchObject({ daggers: 0, daggerDamage: 1, blockImpactTaken: 0.85 });
    expect(after.mods).toEqual(storedMods(inventoryMods(tuning, after.inventory!)));
    for (const back of [0, EQUIP_AT - 1, EQUIP_AT]) {
      let r = restore(snapshot(states[back]!));
      for (let k = back; k < states.length - 1; k++) r = stepMatch(r, intents[k]!, tuning);
      expect(hashValue(r)).toBe(hashValue(states.at(-1)!));
    }
  });
});

describe('an enemy never sees a Weapon\'s effects', { timeout: 60_000 }, () => {
  /** The Soldiers bound to Fighters once Player 0 stands among them, by Soldier index: their Weapon and Mods. */
  const soldiersOf = (t: TuningData): Map<number, { weapon: string; mods: FighterState['mods'] }> => {
    let m = createMatch(t, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 0, 1, 1, 1, 1] });
    const crowd = m.duel.crowd!;
    m = put(m, 0, crowd.x[0]!, crowd.z[0]!);
    for (let k = 0; k < 5; k++) m = stepMatch(m, idle(m), t);
    return new Map(m.duel.fighters.flatMap((f) => (f.soldier ? [[f.soldier.index, { weapon: f.weapon, mods: f.mods }] as const] : [])));
  };
  const daggered: TuningData = { ...warbanded, delver: { ...warbanded.delver, troops: warbanded.delver.troops.map((p) => ({ ...p, weapon: 'Dagger' })) } };

  it('has the same Mods wielding the Dagger as with its Prefab\'s own Weapon, and no Throwing Dagger from it', () => {
    const own = soldiersOf(warbanded);
    const dagger = soldiersOf(daggered);
    expect(own.size).toBeGreaterThan(0);
    expect([...dagger.keys()]).toEqual([...own.keys()]);
    for (const [index, e] of dagger) {
      expect(e.weapon, `Soldier ${index}`).toBe('Dagger');
      expect(e.mods, `Soldier ${index}`).toEqual(own.get(index)!.mods);
      expect(e.mods?.daggers ?? 0).toBe(0);
    }
    // The Prefabs of the Floor really wield other Weapons, so the comparison is not of like with like.
    expect([...own.values()].some((e) => e.weapon !== 'Dagger')).toBe(true);
  });
});

describe('the loot of a Delver Run', { timeout: 60_000 }, () => {
  const SEED = runSeed(ARENA);
  /** Two Players (Fighters 0 and 1) and an AI ally (2) on a Floor with Warbands. */
  const wdelver = (): MatchState =>
    createMatch(warbanded, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0, 0, 1, 1, 1, 1], humans: 2, players: [0, 1] });
  const wtick = (m: MatchState): MatchState => stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), warbanded);
  const w = wdelver();
  const wplan = floorOf(warbanded, w.arena)!.plan;
  const wt = arenaTuning(warbanded, w.arena);
  const crowd = w.duel.crowd!;
  const q = crowd.warbands!.rank.indexOf(0);
  const soldiers = crowd.squad.flatMap((sq, s) => (sq === q ? [s] : []));
  /** `m` with every Soldier of Warband `q` dead. */
  const slain = (m: MatchState): MatchState => {
    const c = m.duel.crowd!;
    const dead = (a: readonly number[]) => a.map((v, s) => (soldiers.includes(s) ? 0 : v));
    return { ...m, duel: { ...m.duel, crowd: { ...c, alive: dead(c.alive), hp: dead(c.hp) } } };
  };
  const fallAt = (m: MatchState) => ({ x: m.duel.crowd!.x[soldiers[0]!]!, y: 0, z: m.duel.crowd!.z[soldiers[0]!]! });
  const firstId = w.delver!.pickups.length;

  it('starts the Floor with the pedestals for each Player, nobody wiped, and the mirror the Run\'s own pickups', () => {
    expect(w.delver!.wiped).toEqual([]);
    expect(w.delver!.pickups).toEqual(treasurePickups(wt, w.config, wplan, SEED, 1));
    expect(firstId).toBe(2 * warbanded.dungeon.loot.pedestals * (wplan.markers.pedestals.length / 3));
    expect(w.duel.delver!.pickups).toBe(w.delver!.pickups);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(soldiers.length).toBeGreaterThan(0);
  });

  it('lays a wiped Warband\'s drops for each present Player where its last Soldier fell, once', () => {
    const quiet = wtick(w);
    expect(quiet.delver!.wiped).toEqual([]);
    expect(quiet.events.some((e) => e.type === 'WarbandWiped')).toBe(false);

    const r = wtick(slain(w));
    const fall = fallAt(r);
    const expected = warbandDrops(wt, r.config, wplan, arenaOf(wt, w.arena), r.duel.crowd!, q, fall, SEED, 1, firstId);
    expect(expected.length).toBeGreaterThan(0);
    expect(r.delver!.wiped).toEqual([q]);
    expect(r.events).toContainEqual({ type: 'WarbandWiped', warband: q, rank: 0, at: { x: fall.x, y: 0, z: fall.z } });
    expect(r.delver!.pickups.slice(firstId)).toEqual(expected);
    expect(new Set(expected.map((d) => d.owner))).toEqual(new Set([0, 1]));
    expect(r.duel.delver!.pickups).toBe(r.delver!.pickups);

    const again = wtick(r);
    expect(again.delver!.wiped).toEqual([q]);
    expect(again.events.some((e) => e.type === 'WarbandWiped')).toBe(false);
    expect(again.delver!.pickups).toHaveLength(r.delver!.pickups.length);
    expect(again.duel.delver!.pickups).toBe(again.delver!.pickups);
  });

  it('lets a Player standing on its drop take it that Tick, and leaves another Player\'s on the same spot', () => {
    const sample = wtick(slain(w));
    const mine = sample.delver!.pickups.slice(firstId).find((p) => p.owner === 0)!;
    const theirs = sample.delver!.pickups.slice(firstId).find((p) => p.owner === 1 && p.at.x === mine.at.x && p.at.z === mine.at.z)!;
    expect(theirs).toBeDefined();
    const inventory = w.duel.fighters[0]!.inventory!;
    expect(addItem(inventory, mine, warbanded.dungeon.inventory)).not.toBeNull();
    const r = wtick(put(slain(w), 0, mine.at.x, mine.at.z));
    expect(r.events).toContainEqual({ type: 'ItemTaken', fighter: 0, id: mine.id, kind: mine.kind, item: mine.item });
    expect(r.delver!.pickups[mine.id]!.taken).toBe(true);
    expect(r.delver!.pickups[theirs.id]!.taken).toBe(false);
    expect(r.duel.fighters[1]!.inventory).toEqual(inventory);
    expect(r.duel.delver!.pickups).toBe(r.delver!.pickups);
  });

  it('starts the next Floor with only its pedestals and nobody wiped', () => {
    const c = centre(wplan);
    let r = wtick(slain(w));
    expect(r.delver!.pickups.length).toBeGreaterThan(firstId);
    r = [0, 1, 2].reduce((m, i) => put(m, i, c.x, c.z), r);
    for (let k = 0; k < NEED + FADE + 2 && r.duelNumber === 1; k++) r = wtick(r);
    expect(r.duelNumber).toBe(2);
    const plan2 = floorOf(warbanded, r.arena)!.plan;
    expect(r.delver!.wiped).toEqual([]);
    expect(r.delver!.pickups).toEqual(treasurePickups(arenaTuning(warbanded, r.arena), r.config, plan2, SEED, 2));
    expect(r.duel.delver!.pickups).toBe(r.delver!.pickups);
  });

  it('lays the drops where a promoted last Soldier\'s Fighter fell, not where its Soldier stood', () => {
    // Warband q keeps one Soldier, s; a Player beside it promotes it into the Pool.
    const s = soldiers[0]!;
    const c = w.duel.crowd!;
    const lone = (a: readonly number[]) => a.map((v, i) => (soldiers.includes(i) && i !== s ? 0 : v));
    let m: MatchState = { ...w, duel: { ...w.duel, crowd: { ...c, alive: lone(c.alive), hp: lone(c.hp) } } };
    m = put(m, 0, c.x[s]! + 2, c.z[s]!);
    const slot = (x: MatchState) => x.duel.fighters.findIndex((f) => f.soldier?.index === s);
    for (let k = 0; k < 20 && slot(m) < 0; k++) m = wtick(m);
    expect(slot(m), 'promoted').toBeGreaterThanOrEqual(0);
    expect(m.delver!.wiped).toEqual([]);
    // It fell a few metres off its Soldier's place: the Bubble writes the Fighter's position back to the Soldier.
    const at = { x: c.x[s]! - 3, z: c.z[s]! };
    const j = slot(m);
    m = withFighters(m, (f, i) => (i === j ? { ...fell(f), position: at } : f));
    let r = m;
    for (let k = 0; k < 40 && r.delver!.wiped.length === 0; k++) r = wtick(r);
    expect(r.delver!.wiped).toEqual([q]);
    const wipe = r.events.find((e) => e.type === 'WarbandWiped')!;
    expect(wipe).toMatchObject({ warband: q, at: { x: at.x, z: at.z } });
    const laid = r.delver!.pickups.slice(firstId);
    expect(laid.length).toBeGreaterThan(0);
    const spots = dropSpots(wplan, arenaOf(wt, w.arena), wt.battle.levels, at.x, at.z, 0, laid.filter((p) => p.owner === 0).length);
    expect(laid.filter((p) => p.owner === 0).map((p) => p.at)).toEqual(spots);
  });

  it('gives an away Player nothing', () => {
    const r = wtick(slain(takeOverFighter(w, 1)));
    const drops = r.delver!.pickups.slice(firstId);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((p) => p.owner === 0)).toBe(true);
  });

  it('is deterministic across a wipe, and re-simulates from a snapshot taken before it', () => {
    const play = (): MatchState[] => {
      let m = slain(w);
      const out = [m];
      for (let k = 0; k < 30; k++) {
        const intents = m.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, move: { x: 1, z: 0 } } : IDLE_INTENT));
        m = stepMatch(m, intents, warbanded);
        out.push(m);
      }
      return out;
    };
    const one = play();
    const two = play();
    expect(one.map((x) => hashValue(x))).toEqual(two.map((x) => hashValue(x)));
    expect(one[1]!.delver!.wiped).toEqual([q]);
    let r = restore(snapshot(one[0]!));
    for (let k = 0; k < 30; k++) {
      const intents = r.duel.fighters.map((_, i) => (i === 0 ? { ...IDLE_INTENT, move: { x: 1, z: 0 } } : IDLE_INTENT));
      r = stepMatch(r, intents, warbanded);
      expect(hashValue(r)).toBe(hashValue(one[k + 1]!));
    }
  });
});

describe('the Reveal of a Delver Run', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);
  const bits = (r: MatchState) => Array.from({ length: revealBits(plan) }, (_, b) => b).filter((b) => isRevealed(r.delver!.revealed, b));
  /** The Passage out of the Entrance Hall: its bit, its middle, and the Hall it leads to. */
  const out = (() => {
    const k = plan.passages.findIndex((p) => p.a === plan.entrance || p.b === plan.entrance);
    const p = plan.passages[k]!;
    return { bit: plan.halls.length + k, x: (p.rect.x0 + p.rect.x1) / 2, z: (p.rect.z0 + p.rect.z1) / 2, hall: p.a === plan.entrance ? p.b : p.a };
  })();

  it('starts with only the Entrance Hall revealed', () => {
    expect(bits(m)).toEqual([plan.entrance]);
    expect(bits(tick(m))).toEqual([plan.entrance]);
  });

  it('reveals a Passage, then the next Hall, once a Player\'s Fighter stands inside them, and keeps them revealed', () => {
    let r = tick(put(m, 0, out.x, out.z));
    expect(bits(r)).toEqual([plan.entrance, out.bit].sort((a, b) => a - b));
    const h = plan.halls[out.hall]!;
    r = tick(put(r, 0, h.cx, h.cz));
    expect(bits(r)).toEqual([plan.entrance, out.hall, out.bit].sort((a, b) => a - b));
    r = tick(put(r, 0, plan.halls[plan.entrance]!.cx, plan.halls[plan.entrance]!.cz));
    expect(bits(r)).toHaveLength(3);
  });

  it('allocates nothing on a Tick that reveals nothing new', () => {
    const r = tick(m);
    expect(tick(r).delver!.revealed).toBe(r.delver!.revealed);
  });

  it('is revealed by a Player alone: an AI ally walking alone, a Player who is away or fallen, reveal nothing', () => {
    const ally = tick(put(m, 1, out.x, out.z));
    expect(bits(ally)).toEqual([plan.entrance]);
    const gone = tick(put(takeOverFighter(m, 0), 0, out.x, out.z));
    expect(bits(gone)).toEqual([plan.entrance]);
    const dead = tick(withFighters(put(m, 0, out.x, out.z), (f, i) => (i === 0 ? fell(f) : f)));
    expect(bits(dead)).toEqual([plan.entrance]);
  });

  it('resets on a new Floor, with its Entrance revealed', () => {
    let r = tick(put(m, 0, out.x, out.z));
    r = times(put(r, 0, centre(plan).x, centre(plan).z), NEED + 1);
    expect(r.delver!.phase).toBe('Descending');
    r = times(r, FADE + 1);
    expect(r.delver!.floor).toBe(2);
    const plan2 = planOf(r);
    expect(r.delver!.revealed).toEqual(withReveal(emptyReveal(plan2), plan2.entrance));
  });

  it('gives the same bytes for the same seed, and survives a snapshot round trip', () => {
    const play = (): MatchState[] => {
      let r = put(m, 0, out.x, out.z);
      const all: MatchState[] = [];
      for (let k = 0; k < 20; k++) all.push((r = tick(r, { 0: { move: { x: 1, z: 0 } } })));
      return all;
    };
    const one = play();
    const two = play();
    expect(one.map((x) => hashValue(x))).toEqual(two.map((x) => hashValue(x)));
    const back = restore(snapshot(one[9]!));
    expect(back.delver!.revealed).toEqual(one[9]!.delver!.revealed);
    expect(hashValue(back)).toBe(hashValue(one[9]!));
  });
});

describe('the Consumables of a Delver Run (Stage 10)', { timeout: 60_000 }, () => {
  const m = delver();
  const plan = planOf(m);
  const POTION = 'Health Potion';
  const MAP = 'Map';
  const STONE = 'Resurrection Stone';
  /** `r` with Player 0 holding `relics` in its Relic slots (Relics and Consumables), the Relics among them equipped as `withStartingRelics` does. */
  const holding = (r: MatchState, relics: readonly string[]): MatchState =>
    withFighters(r, (f, i) => (i === 0 ? holdInventory(f, withStartingRelics(startingInventory(f.weapon), relics, tuning), tuning) : f));
  const use = (slot: number): Partial<Intent> => ({ use: { kind: 'relic', slot } });
  const used = (r: MatchState) => r.events.filter((e) => e.type === 'ItemUsed');

  it('is Tuning Data: three Consumables, none sharing a Relic\'s name, and a loot weight of 2', () => {
    expect(tuning.consumables.map((c) => [c.name, c.effect])).toEqual([
      [POTION, 'healFull'],
      [MAP, 'revealFloor'],
      [STONE, 'reviveFallen'],
    ]);
    expect(tuning.dungeon.loot.weights.Consumable).toBe(2);
  });

  it('heals the user to full HP with a Health Potion, which leaves its slot (later slots close up, the equipped Relic with them)', () => {
    const r0 = hurt(holding(m, [POTION, 'Whetstone']), 0, MAX * 0.3);
    expect(r0.duel.fighters[0]!.inventory!.equipped).toEqual([1]);
    const r = tick(r0, { 0: use(0) });
    const f = r.duel.fighters[0]!;
    expect(f.hp).toBe(f.maxHp);
    expect(f.inventory!.relics.map((r) => r.name)).toEqual(['Whetstone']);
    expect(f.inventory!.equipped).toEqual([0]);
    expect(used(r)).toEqual([{ type: 'ItemUsed', fighter: 0, item: commonItem(POTION), effect: 'healFull' }]);
  });

  it('refuses a Health Potion at full HP, and keeps it', () => {
    const r = tick(holding(m, [POTION]), { 0: use(0) });
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([POTION]);
    expect(used(r)).toEqual([]);
  });

  it('is used mid-Action too: no Action stops it', () => {
    let r = hurt(holding(m, [POTION]), 0, MAX * 0.5);
    r = times(r, 3, { 0: { attack: true } });
    expect(r.duel.fighters[0]!.action.kind).toBe('Attack');
    r = tick(r, { 0: { attack: true, ...use(0) } });
    expect(r.duel.fighters[0]!.hp).toBe(r.duel.fighters[0]!.maxHp);
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([]);
  });

  it('is never equipped: a number key on its slot does nothing', () => {
    const r = tick(holding(m, [POTION]), { 0: { equip: { kind: 'relic', slot: 0 } } });
    expect(r.duel.fighters[0]!.inventory!.equipped).toEqual([]);
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([POTION]);
  });

  it('refuses a use on a Relic\'s slot, an empty slot or a fallen user', () => {
    const relic = tick(holding(m, ['Whetstone']), { 0: use(0) });
    expect(relic.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual(['Whetstone']);
    const empty = tick(holding(m, [MAP]), { 0: use(3) });
    expect(empty.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([MAP]);
    const dead = tick(withFighters(holding(m, [MAP]), (f, i) => (i === 0 ? fell(f) : f)), { 0: use(0) });
    expect(dead.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([MAP]);
    expect([relic, empty, dead].flatMap(used)).toEqual([]);
  });

  it('reveals the whole Floor with a Map, and refuses a second one there', () => {
    let r = tick(holding(m, [MAP, MAP]), { 0: use(0) });
    expect(r.delver!.revealed).toEqual(fullReveal(plan));
    for (let b = 0; b < revealBits(plan); b++) expect(isRevealed(r.delver!.revealed, b), `bit ${b}`).toBe(true);
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([MAP]);
    r = tick(r, { 0: use(0) });
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([MAP]);
    expect(used(r)).toEqual([]);
  });

  it('brings back every fallen ally round the user with a Resurrection Stone, inside the user\'s Hall, at revive of max HP', () => {
    const r0 = withFighters(holding(m, [STONE]), (f, i) => (i === 1 || i === 2 ? fell(f) : f));
    const r = tick(r0, { 0: use(0) });
    const user = r.duel.fighters[0]!;
    const hall = plan.halls[plan.entrance]!;
    for (const i of [1, 2]) {
      const back = r.duel.fighters[i]!;
      expect(back.death).toBeUndefined();
      expect(inDuel(back)).toBe(true);
      expect(back.hp).toBe(revive * MAX);
      expect(Math.hypot(back.position.x - user.position.x, back.position.z - user.position.z)).toBeLessThan(2.5);
      expect(hall.rects.some((rect) => back.position.x > rect.x0 && back.position.x < rect.x1 && back.position.z > rect.z0 && back.position.z < rect.z1)).toBe(true);
      expect(r.events).toContainEqual({ type: 'Revived', fighter: i, fire: STONE_REVIVE });
    }
    expect(user.inventory!.relics.map((r) => r.name)).toEqual([]);
    expect(used(r)).toEqual([{ type: 'ItemUsed', fighter: 0, item: commonItem(STONE), effect: 'reviveFallen' }]);
  });

  it('refuses a Resurrection Stone with nobody fallen', () => {
    const r = tick(holding(m, [STONE]), { 0: use(0) });
    expect(r.duel.fighters[0]!.inventory!.relics.map((r) => r.name)).toEqual([STONE]);
    expect(used(r)).toEqual([]);
  });

  it('drops as a shared Consumable pickup, which takes a Relic slot when taken', () => {
    const r = tick(holding(m, [MAP]), { 0: { drop: { kind: 'relic', slot: 0 } } });
    const dropped = r.delver!.pickups.at(-1)!;
    expect(dropped).toMatchObject({ kind: 'consumable', item: commonItem(MAP), owner: null });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'ItemDropped', kind: 'consumable', item: commonItem(MAP) }));
    const sizes = tuning.dungeon.inventory;
    const inv = withStartingRelics(startingInventory('Halberd'), ['Whetstone'], tuning);
    expect(addItem(inv, { kind: 'consumable', item: commonItem(POTION) }, sizes)!.relics).toEqual([commonItem('Whetstone'), commonItem(POTION)]);
    const full = withStartingRelics(startingInventory('Halberd'), Array<string>(sizes.relics).fill(POTION), tuning);
    expect(full.equipped).toEqual([]);
    expect(addItem(full, { kind: 'relic', item: commonItem('Whetstone') }, sizes)).toBeNull();
  });

  it('is picked as loot by its weight', () => {
    const only: TuningData = { ...tuning, dungeon: { ...tuning.dungeon, loot: { ...tuning.dungeon.loot, weights: { Relic: 0, Weapon: 0, Consumable: 1 } } } };
    const picks = [...Array(40).keys()].map((k) => pickItemAt(only, 7, 1, k, [], { tier: 1, rank: 'Fight' }));
    expect(new Set(picks.map((p) => p.kind))).toEqual(new Set(['consumable']));
    expect(new Set(picks.map((p) => p.item.name))).toEqual(new Set([POTION, MAP, STONE]));
    const none: TuningData = { ...tuning, dungeon: { ...tuning.dungeon, loot: { ...tuning.dungeon.loot, weights: { Relic: 1, Weapon: 1, Consumable: 0 } } } };
    expect([...Array(40).keys()].some((k) => pickItemAt(none, 7, 1, k, [], { tier: 1, rank: 'Fight' }).kind === 'consumable')).toBe(false);
  });

  it('is deterministic, and re-simulates the same from a snapshot', () => {
    const start = withFighters(holding(m, [STONE, MAP]), (f, i) => (i === 1 ? fell(f) : f));
    const run = () => {
      let r = tick(start, { 0: use(0) });
      r = tick(r, { 0: use(0) });
      return r;
    };
    expect(hashValue(run())).toBe(hashValue(run()));
    expect(hashValue(restore(snapshot(run())))).toBe(hashValue(run()));
  });
});

describe('a Resurrection Stone and the Inventory beside lava (Stage 7d)', { timeout: 120_000 }, () => {
  // Stage 7f's set pieces off (`noSetPieces`): these Floors were found on 7d's data.
  const shipped = noSetPieces(loadTuningData());
  const lt: TuningData = { ...shipped, delver: { ...shipped.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0 } };
  const planOf2 = (m: MatchState) => floorOf(lt, m.arena)!.plan;
  const KEEP2 = LAVA_KEEP * LAVA_KEEP;
  const STONE = 'Resurrection Stone';
  const MAXHP = lt.fighter.maxHp;
  /** Found by scanning Run arenas gen:greybox:1 to 40 on the shipped data: Floor 1 of 16 has a river (hall 1, one bridge) and of 35 a trough (hall 2). */
  const river = { arena: 'gen:greybox:16', hall: 1 };
  const trough = { arena: 'gen:greybox:35', hall: 2 };
  const lavaMatch = (arena: string): MatchState => createMatch(lt, { format: 'Gauntlet', bestOf: 1, seed: 7, arena, teams: [0, 0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const step = (m: MatchState, by: Record<number, Partial<Intent>> = {}): MatchState => stepMatch(m, m.duel.fighters.map((_, i) => ({ ...IDLE_INTENT, ...by[i] })), lt);
  const holdingStone = (m: MatchState): MatchState =>
    withFighters(m, (f, i) => (i === 0 ? holdInventory(f, withStartingRelics(startingInventory(f.weapon), [STONE], lt), lt) : f));
  const gap2 = (q: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number) => (x - Math.min(q.x1, Math.max(q.x0, x))) ** 2 + (z - Math.min(q.z1, Math.max(q.z0, z))) ** 2;
  /** `m` with Fighter 0 standing at (x, z) on the Hall's floor and Fighters 1 and 2 fallen, the Stone used. */
  const usedAt = (m: MatchState, x: number, z: number, y: number): MatchState =>
    step(
      withFighters(holdingStone(m), (f, i) => (i === 0 ? { ...f, position: { x, z }, y } : i === 1 || i === 2 ? fell(f) : f)),
      { 0: { use: { kind: 'relic', slot: 0 } } },
    );
  const checkRevived = (r: MatchState, hallIndex: number): void => {
    const p = floorOf(lt, r.arena)!.plan;
    const h = p.halls[hallIndex]!;
    const a = arenaOf(arenaTuning(lt, r.arena), r.arena);
    for (const i of [1, 2]) {
      const back = r.duel.fighters[i]!;
      expect(back.death).toBeUndefined();
      expect(back.hp).toBe(lt.dungeon.revive * MAXHP);
      expect(r.events).toContainEqual({ type: 'Revived', fighter: i, fire: STONE_REVIVE });
      for (const q of h.lava!.rects) expect(gap2(q, back.position.x, back.position.z), `fighter ${i}`).toBeGreaterThanOrEqual(KEEP2 - 1e-9);
      expect(h.rects.some((q) => back.position.x >= q.x0 && back.position.x <= q.x1 && back.position.z >= q.z0 && back.position.z <= q.z1)).toBe(true);
      expect(floorNear(a, back.position.x, back.position.z, h.y)).toBeGreaterThanOrEqual(0);
      expect(back.y).toBeCloseTo(h.y, 6);
    }
  };

  it('raises the fallen at least LAVA_KEEP from the lava when the user stands on a river bridge\'s edge', () => {
    const m = lavaMatch(river.arena);
    const h = planOf2(m).halls[river.hall]!;
    expect(h.lava!.kind).toBe('river');
    const b = h.lava!.bridges[0]!;
    const q = h.lava!.rects[0]!;
    // The bridge point nearest the first rect, 0.3 m inside its edge.
    const nx = Math.min(b.x1, Math.max(b.x0, (q.x0 + q.x1) / 2));
    const nz = Math.min(b.z1, Math.max(b.z0, (q.z0 + q.z1) / 2));
    const x = nx + Math.sign((b.x0 + b.x1) / 2 - nx) * 0.3;
    const z = nz + Math.sign((b.z0 + b.z1) / 2 - nz) * 0.3;
    const r = usedAt(m, x, z, h.y);
    checkRevived(r, river.hall);
  });

  it('raises the fallen at least LAVA_KEEP from the lava when the user stands at a trough\'s lip', () => {
    const m = lavaMatch(trough.arena);
    const h = planOf2(m).halls[trough.hall]!;
    expect(h.lava!.kind).toBe('trough');
    const q = h.lava!.rects[0]!;
    const cx = (q.x0 + q.x1) / 2;
    const cz = (q.z0 + q.z1) / 2;
    const lip = [[q.x0 - 0.3, cz], [q.x1 + 0.3, cz], [cx, q.z0 - 0.3], [cx, q.z1 + 0.3]].find(([x, z]) => h.rects.some((r) => x! >= r.x0 && x! <= r.x1 && z! >= r.z0 && z! <= r.z1) && !h.lava!.rects.some((l) => gap2(l, x!, z!) === 0))!;
    const r = usedAt(m, lip[0]!, lip[1]!, h.y);
    checkRevived(r, trough.hall);
  });

  it('keeps today\'s spots in a Hall without lava: each clamped inside the Hall rect, REVIVE_MARGIN from its edges', () => {
    const m = lavaMatch(river.arena);
    const p = planOf2(m);
    const k = p.halls.findIndex((h, i) => i !== p.entrance && !h.lava && h.rects.length === 1 && h.pillars.length === 0);
    const h = p.halls[k]!;
    const r = usedAt(m, h.cx, h.cz, h.y);
    const rect = h.rects[0]!;
    for (const i of [1, 2]) {
      const back = r.duel.fighters[i]!;
      const j = i - 1;
      const dx = [-1.5, 1.5][j]!;
      expect(back.position.x).toBeCloseTo(Math.min(rect.x1 - REVIVE_MARGIN, Math.max(rect.x0 + REVIVE_MARGIN, h.cx + dx)), 9);
      expect(back.position.z).toBeCloseTo(Math.min(rect.z1 - REVIVE_MARGIN, Math.max(rect.z0 + REVIVE_MARGIN, h.cz - 1.5)), 9);
    }
  });

  it('refuses a drop from a Fighter in the air over lava, or fallen in it: it neither changes its inventory nor lays a pickup', () => {
    const m = lavaMatch(river.arena);
    const h = planOf2(m).halls[river.hall]!;
    const q = h.lava!.rects[0]!;
    const at = { x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2 };
    const drop = { drop: { kind: 'relic' as const, slot: 0 } };
    const air = { vx: 0, vz: 0, vy: 0, peakY: h.y, ticks: 1, jumped: true };
    const held = holdingStone(m);
    const flying = withFighters(held, (f, i) => (i === 0 ? { ...f, position: at, y: h.y, air } : f));
    expect(useInventory(flying.duel.fighters[0]!, drop, lt)).toEqual({ fighter: flying.duel.fighters[0], dropped: null });
    const dead = withFighters(held, (f, i) => (i === 0 ? { ...fell(f), position: at, y: h.lava!.y } : f));
    expect(useInventory(dead.duel.fighters[0]!, drop, lt)).toEqual({ fighter: dead.duel.fighters[0], dropped: null });
    for (const start of [flying, dead]) {
      const r = step(start, { 0: drop });
      expect(r.events.some((e) => e.type === 'ItemDropped')).toBe(false);
      expect(r.delver!.pickups).toEqual(start.delver!.pickups);
    }
  });
});

describe("a Delver Run's stats (countStats)", () => {
  const m = delver();
  const fighters = m.duel.fighters;
  const enemy = fighters.findIndex((f) => f.team === 1);
  const stats = m.config.teams.map(() => NO_STATS);
  const p = { x: 0, y: 0, z: 0 };
  const hit = (attacker: number, defender: number) => ({ type: 'Hit', attacker, defender, direction: 'Left', zone: 'torso', point: p, bladeSpeed: 1, head: true, heavy: false, damage: 1 }) as const;
  const death = (fighter: number) => ({ type: 'Death', fighter, cause: 'Hit' }) as const;

  it('counts nothing on a Tick with nothing to count (the same array)', () => {
    expect(countStats(stats, [], [], fighters, -1)).toBe(stats);
  });

  it("counts an enemy's fall to a party Fighter's blow as its kill, and as a Boss kill when the enemy was the Boss Soldier", () => {
    const bound = fighters.map((f, i) => (i === enemy ? { ...f, soldier: { index: 9, since: 0, role: 'Attack' as const } } : f));
    const out = countStats(stats, [hit(1, enemy), death(enemy)], [], bound, -1);
    expect(out[1]).toEqual({ ...NO_STATS, kills: 1 });
    expect(countStats(stats, [hit(1, enemy), death(enemy)], [], bound, 9)[1]).toEqual({ ...NO_STATS, kills: 1, bosses: 1 });
    // A party Fighter's fall is nobody's kill here (a traitor's are its own record's).
    expect(countStats(stats, [hit(enemy, 0), death(0)], [], bound, 9)).toBe(stats);
  });

  it("counts a party Fighter's Hit or Kick on a teammate as a friendly hit, never an enemy's or its own", () => {
    const kick = { type: 'KickLanded', attacker: 0, defender: 2, outcome: 'Shove', zone: 'torso', point: p, damage: 0 } as const;
    const out = countStats(stats, [hit(0, 1), kick, hit(enemy, 1), hit(1, enemy)], [], fighters, -1);
    expect(out[0]).toEqual({ ...NO_STATS, friendlyHits: 2 });
    expect(out[1]).toEqual(NO_STATS);
  });

  it("counts each party Fighter's Revived", () => {
    const out = countStats(stats, [], [{ type: 'Revived', fighter: 2, fire: 0 }, { type: 'Revived', fighter: 2, fire: STONE_REVIVE }], fighters, -1);
    expect(out[2]).toEqual({ ...NO_STATS, revived: 2 });
  });
});
