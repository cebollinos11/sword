import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { floorArenaName, floorOf } from './delver/world';
import { runSeed } from './dungeon';
import { secondsToTicks } from './constants';
import { inDuel } from './duel';
import { createMatch, MAX_TEAM_SIZE, stepMatch, takeOverFighter, type MatchOptions, type MatchState } from './match';
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
