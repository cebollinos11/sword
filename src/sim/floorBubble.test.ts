import { describe, expect, it } from 'vitest';
import { defaultWeaponName, loadTuningData } from '../tuning';
import { arenaOf } from './arena';
import { groundOf, soldierHeight } from './battlefield';
import { createCrowd, floorRingSpots, ringSpots, stepCrowd, walkDistance, walkField, type CrowdFighter, type CrowdState } from './crowd';
import { arenaTuning, deployWarbands, floorArenaName, floorOf, warbandHomes } from './delver';
import { battleMapOf, clearanceAt, fieldDistance, fieldToward, inSight, oneField } from './destinations';
import { stepBubbles, unboundSlot, type BossHold } from './bubble';
import { foldMods } from './mods';
import { BOSS, ELITE } from './warband';
import { warbandBrain } from './warband';
import { hashValue } from './hash';
import { standingFighter } from './step';
import type { FighterState, SimState } from './state';

const tuning = loadTuningData();
const TIMEOUT = 120_000;

/** Floor `floor` (1) of Run `seed`, its Crowd deployed, and a way to make a Duel on it: the party's Fighters at the given spots, then unbound Pool slots. */
function scene(seed = 1, floor = 1) {
  const name = floorArenaName(seed, floor);
  const built = floorOf(tuning, name)!;
  const t = arenaTuning(tuning, name);
  const map = battleMapOf(t.battle, name);
  const crowd = deployWarbands(t, built.plan, built.field, seed, floor, 1);
  const homes = warbandHomes(built.plan);
  const weapon = defaultWeaponName(t);
  const fighter = (x: number, z: number): FighterState => standingFighter(t, arenaOf(t, name), { position: { x, z }, y: soldierHeight(map.field, groundOf(t.battle, map.field, x, z, 0), x, z), facing: 0 }, weapon, 0);
  const duel = (party: readonly { x: number; z: number }[], c: CrowdState = crowd): SimState => ({
    tick: 0,
    arena: name,
    rng: c.rng,
    fighters: [...party.map((p) => fighter(p.x, p.z)), ...Array.from({ length: t.battle.bubble.poolSize - party.length }, () => unboundSlot(t, name))],
    daggers: [],
    duel: { status: 'Fighting' },
    crowd: c,
    events: [],
  });
  return { name, plan: built.plan, t, battle: t.battle, map, field: map.field, crowd, homes, brain: warbandBrain(homes, t.delver), fighter, duel };
}
type Scene = ReturnType<typeof scene>;

/** `crowd` with Soldier i[k] moved to at[k] (standing on the floor). */
function place(s: Scene, crowd: CrowdState, indices: readonly number[], at: readonly { x: number; z: number }[]): CrowdState {
  const x = crowd.x.slice();
  const z = crowd.z.slice();
  const surface = crowd.surface.slice();
  indices.forEach((i, k) => {
    x[i] = at[k]!.x;
    z[i] = at[k]!.z;
    surface[i] = groundOf(s.battle, s.field, at[k]!.x, at[k]!.z, 0);
  });
  return { ...crowd, x, z, surface };
}

/** The Pool slots promoted into a Bubble, as their Soldiers' indices by role. */
const promoted = (state: SimState) => state.fighters.flatMap((f, k) => (f.soldier ? [{ k, s: f.soldier.index, role: f.soldier.role, f }] : []));

/** A party Fighter at (x, z) as the Crowd sees it (a Bubble's centre when `ahead`). */
function partyAt(s: Scene, x: number, z: number, ahead?: number): CrowdFighter {
  return { x, z, y: soldierHeight(s.field, groundOf(s.battle, s.field, x, z, 0), x, z), team: 0, slot: 0, ...(ahead === undefined ? {} : { ahead }) };
}

/** The walkable spots (clearance half a metre) of the Floor on a 2 m grid, each with the field to it kept. */
function floorSpots(s: Scene): { x: number; z: number }[] {
  const hs = s.plan.halls;
  const out: { x: number; z: number }[] = [];
  const entrance = hs[s.plan.entrance]!;
  const from = oneField(s.map.fields, fieldToward(s.map.fields, entrance.cx, entrance.cz, groundOf(s.battle, s.field, entrance.cx, entrance.cz, 0)));
  for (let x = Math.min(...hs.map((h) => h.rect.x0)); x <= Math.max(...hs.map((h) => h.rect.x1)); x += 2)
    for (let z = Math.min(...hs.map((h) => h.rect.z0)); z <= Math.max(...hs.map((h) => h.rect.z1)); z += 2) {
      const on = groundOf(s.battle, s.field, x, z, 0);
      if (on >= 0 && fieldDistance(from, 0, x, z, on) >= 0 && clearanceAt(s.map.fields, x, z, on) >= 0.5) out.push({ x, z });
    }
  return out;
}

/** The walk (m) from the point (x, z) on the floor to the Fighter at (px, pz). */
const walkBetween = (s: Scene, x: number, z: number, px: number, pz: number): number => walkDistance(walkField(s.battle, s.map, px, pz, 0), x, z, groundOf(s.battle, s.field, x, z, 0));

/**
 * Seed 1 Floor 1: a Player spot P and a spot S within 9 m flat of it that is a long walk from it (a Wall between), and a Passage spot P2 outside the Hall of S's
 * neighbourhood within `promote` of a Hall's guard by walking: found by search.
 */
function behindWall(s: Scene): { p: { x: number; z: number }; at: { x: number; z: number }; walk: number } {
  for (const p of floorSpots(s)) {
    const field = oneField(s.map.fields, fieldToward(s.map.fields, p.x, p.z, groundOf(s.battle, s.field, p.x, p.z, 0)));
    for (let dx = -9; dx <= 9; dx++)
      for (let dz = -9; dz <= 9; dz++) {
        const x = p.x + dx;
        const z = p.z + dz;
        const on = groundOf(s.battle, s.field, x, z, 0);
        if (on < 0 || Math.hypot(dx, dz) > 9 || clearanceAt(s.map.fields, x, z, on) < 1) continue;
        const w = fieldDistance(field, 0, x, z, on);
        if (w >= 14) return { p, at: { x, z }, walk: w };
      }
  }
  throw new Error('no wall-separated spots on the Floor');
}

describe('the Bubble on a Floor', { timeout: TIMEOUT }, () => {
  it('does not promote a Soldier within promote flat but through a Wall, nor send it to the ring', () => {
    const s = scene(1);
    const { p, at, walk } = behindWall(s);
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeLessThanOrEqual(s.battle.bubble.promote);
    expect(walk).toBeGreaterThan(s.battle.bubble.promote);
    // One Soldier of the first Warband stands at `at`, the Player at p.
    // The others are out of the way (fallen), so only that Soldier could be promoted.
    const crowd: CrowdState = { ...place(s, s.crowd, [0], [at]), alive: s.crowd.alive.map((a, k) => (k === 0 ? a : 0)) };
    const next = stepBubbles(s.duel([p], crowd), 1, 1, s.t);
    expect(promoted(next)).toEqual([]);
    expect(next.crowd!.slot[0]).toBe(-1);
    // The ring: with the Player a Bubble's centre (`ahead`) the Crowd is stepped just as if it were an ordinary Fighter of the party: nobody waits for it.
    const stepped = (ahead?: number) => {
      let c = crowd;
      for (let tick = 1; tick <= 180; tick++) c = stepCrowd(c, tick, s.battle, [partyAt(s, p.x, p.z, ahead)], s.map, s.brain);
      return c;
    };
    expect(stepped(0)).toEqual(stepped(undefined));
  });

  it('promotes a Soldier round a doorway within promote by walking, and sends a waiting one to the ring', () => {
    const s = scene(1);
    // The first Warband's post: its Hall's doorway leads to a Passage; a Player standing in it, a few metres from the Hall's wall.
    const q = s.crowd.warbands!.post.findIndex((k) => k >= 0);
    const post = s.homes.posts[s.crowd.warbands!.post[q]!]!;
    const hall = s.plan.halls[s.plan.markers.posts[s.crowd.warbands!.post[q]!]!.hall]!;
    const i = s.crowd.squad.indexOf(q);
    const inPassage = floorSpots(s).filter((p) => (p.x < hall.rect.x0 - 1 || p.x > hall.rect.x1 + 1 || p.z < hall.rect.z0 - 1 || p.z > hall.rect.z1 + 1) && walkBetween(s, s.crowd.x[i]!, s.crowd.z[i]!, p.x, p.z) <= s.battle.bubble.promote - 1 && Math.hypot(p.x - s.crowd.x[i]!, p.z - s.crowd.z[i]!) <= s.battle.bubble.promote);
    expect(inPassage.length).toBeGreaterThan(0);
    const p = inPassage[0]!;
    // A distinctive max HP on that Soldier: its Fighter takes it.
    const crowd: CrowdState = { ...s.crowd, maxHp: s.crowd.maxHp!.map((m, k) => (k === i ? 123.5 : m)), hp: s.crowd.hp.map((h, k) => (k === i ? 77 : h)) };
    const next = stepBubbles(s.duel([p], crowd), 1, 1, s.t);
    const got = promoted(next).find((f) => f.s === i);
    expect(got).toBeDefined();
    expect(got!.role).toBe('Attack');
    expect([got!.f.maxHp, got!.f.hp]).toEqual([123.5, 77]);
    expect(next.crowd!.slot[i]).toBe(got!.k);
    // Others of the Warband that the walk does not bring within promote are not promoted: each promoted Soldier is within promote by walking.
    for (const f of promoted(next)) expect(walkBetween(s, crowd.x[f.s]!, crowd.z[f.s]!, p.x, p.z)).toBeLessThanOrEqual(s.battle.bubble.promote);
    // And a Soldier within promote by walking waits on the ring: the Crowd steps differently for a Bubble's centre than for any other Fighter.
    const waiting = (ahead?: number) => {
      let c = crowd;
      for (let tick = 1; tick <= 120; tick++) c = stepCrowd(c, tick, s.battle, [partyAt(s, p.x, p.z, ahead)], s.map, s.brain);
      return c;
    };
    expect(waiting(0)).not.toEqual(waiting(undefined));
    expect(post).toBeDefined();
  });

  /** Soldiers on a ring round (cx, cz) in the Hall centre, `n` of them, each 3 to 6 m out and clear. */
  function crowded(s: Scene, n: number) {
    const hall = s.plan.halls[s.plan.mainPath[1]!]!;
    const centre = { x: hall.cx, z: hall.cz };
    const at = Array.from({ length: n }, (_, k) => ({ x: centre.x + (3 + (k % 2)) * Math.sin((k * 2 * Math.PI) / n), z: centre.z + (3 + (k % 2)) * Math.cos((k * 2 * Math.PI) / n) }));
    return { centre, at, crowd: place(s, s.crowd, Array.from({ length: n }, (_, k) => k), at) };
  }

  it('holds 4 Attack Slots with one Bubble and 3 each with two', () => {
    const s = scene(1);
    const { centre, crowd } = crowded(s, 10);
    const one = stepBubbles(s.duel([centre], crowd), 1, 1, s.t);
    expect(promoted(one).filter((f) => f.role === 'Attack')).toHaveLength(s.t.delver.attackSlots[0]!);
    expect(s.t.delver.attackSlots[0]).toBe(4);
    // Two Bubbles 2 m apart in the same Hall: 3 slots each, 6 in all.
    const second = { x: centre.x + 2, z: centre.z };
    const two = stepBubbles(s.duel([centre, second], crowd), 2, 1, s.t);
    const mine = [0, 0];
    for (const f of promoted(two)) {
      expect(f.role).toBe('Attack');
      const a = Math.hypot(f.f.position.x - centre.x, f.f.position.z - centre.z);
      const b = Math.hypot(f.f.position.x - second.x, f.f.position.z - second.z);
      mine[a <= b ? 0 : 1]!++;
    }
    expect(promoted(two)).toHaveLength(6);
    expect(mine).toEqual([3, 3]);
    // No ally slot is ever filled: nobody of Team 0 is in the Crowd.
    expect(crowd.team.every((t) => t === 1)).toBe(true);
    for (const state of [one, two]) expect(promoted(state).some((f) => f.role === 'Ally')).toBe(false);
  });

  it('demotes a promoted Soldier once the Player is further than demote by walking, and not before', () => {
    const s = scene(1);
    // One Soldier near a Hall's centre, the rest fallen, promoted by a Player beside it.
    const { centre, crowd: all } = crowded(s, 1);
    const crowd: CrowdState = { ...all, alive: all.alive.map((a, k) => (k === 0 ? a : 0)) };
    const first = stepBubbles(s.duel([centre], crowd), 1, 1, s.t);
    const held = promoted(first);
    expect(held).toHaveLength(1);
    const minTicks = Math.round(s.battle.bubble.minPromotedSeconds * 60);
    const soldier = held[0]!.f;
    // The Player now stands between promote and demote by walking: it keeps the Soldier. Then further than demote: the Soldier goes back to the Crowd.
    const spots = floorSpots(s);
    const at = (lo: number, hi: number) => spots.find((p) => walkBetween(s, soldier.position.x, soldier.position.z, p.x, p.z) > lo && walkBetween(s, soldier.position.x, soldier.position.z, p.x, p.z) <= hi)!;
    const between = at(s.battle.bubble.promote + 1, s.battle.bubble.demote - 1);
    const beyond = at(s.battle.bubble.demote + 1, 200);
    expect(between).toBeDefined();
    expect(beyond).toBeDefined();
    const moved = (p: { x: number; z: number }, tick: number, state: SimState) => stepBubbles({ ...state, fighters: state.fighters.map((f, k) => (k === 0 ? s.fighter(p.x, p.z) : f)) }, 1, tick, s.t);
    const late = 1 + minTicks + 5;
    const kept = moved(between, late, first);
    expect(promoted(kept).map((f) => f.s)).toEqual([held[0]!.s]);
    const gone = moved(beyond, late, first);
    expect(promoted(gone)).toEqual([]);
    expect(gone.crowd!.slot[held[0]!.s]).toBe(-1);
    // It stands where its Fighter stood, with its HP.
    expect([gone.crowd!.x[held[0]!.s], gone.crowd!.z[held[0]!.s]]).toEqual([soldier.position.x, soldier.position.z]);
  });

  it('measures the walk to a Fighter from its field: 0 at the Fighter, Infinity where unreached', () => {
    const s = scene(1);
    const { centre } = crowded(s, 2);
    const walk = walkField(s.battle, s.map, centre.x, centre.z, 0);
    expect(walkDistance(walk, centre.x, centre.z, groundOf(s.battle, s.field, centre.x, centre.z, 0))).toBe(0);
    // Far out in the rock nothing is reached.
    const rock = { x: s.field.heights.size / 2 - 5, z: s.field.heights.size / 2 - 5 };
    expect(walkDistance(walk, rock.x, rock.z, groundOf(s.battle, s.field, rock.x, rock.z, 0))).toBe(Infinity);
  });
});

describe("a Floor's waiting ring", { timeout: TIMEOUT }, () => {
  it('hands out only spots in sight of the Fighter, in fill order, fewer when Walls hide them', () => {
    const s = scene(1);
    let hidden = 0;
    for (const p of floorSpots(s).filter((_, k) => k % 7 === 0)) {
      const f = partyAt(s, p.x, p.z, 0);
      const all = ringSpots(s.battle, p.x, p.z, 0, 24);
      const spots = floorRingSpots(s.battle, s.map, f, 8);
      expect(spots.length).toBeLessThanOrEqual(16);
      const sees = (x: number, z: number) => inSight(s.map.fields, p.x, p.z, x, z, s.battle.crowd.separation / 2, f.y!, f.y!);
      for (let k = 0; k < spots.length; k += 2) expect(sees(spots[k]!, spots[k + 1]!)).toBe(true);
      // The first 8 of those in sight among the first 24 of the ring, in order.
      const want: number[] = [];
      for (let k = 0; k < all.length && want.length < 16; k += 2) if (sees(all[k]!, all[k + 1]!)) want.push(all[k]!, all[k + 1]!);
      expect(spots).toEqual(want);
      if (all.slice(0, 16).some((_, k) => k % 2 === 0 && !sees(all[k]!, all[k + 1]!))) hidden++;
    }
    // Some Player stands where a Wall hides part of the ring.
    expect(hidden).toBeGreaterThan(0);
  });
});

describe('Battles unchanged', { timeout: TIMEOUT }, () => {
  it('a Battle Crowd stepped 300 Ticks with no brain, and with `undefined` passed as the brain, is the same state and carries no Floor keys', () => {
    const battle = tuning.battle;
    const map = battleMapOf(battle, 'battle:1');
    let a = createCrowd(battle, 1);
    let b = a;
    for (let tick = 1; tick <= 300; tick++) {
      a = stepCrowd(a, tick, battle, [], map);
      b = stepCrowd(b, tick, battle, [], map, undefined);
    }
    expect(b).toEqual(a);
    expect(hashValue(b)).toBe(hashValue(a));
    expect(Object.keys(a)).not.toContain('maxHp');
    expect(Object.keys(a)).not.toContain('warbands');
    expect(a.tickets).not.toEqual(createCrowd(battle, 1).tickets.map(() => 0));
  });
});

/** `t` with a Bubble's Attack Slots `enemies` for one Bubble and `shared` for two (Tuning Data's slots, on the Floor's Battle). */
const withSlots = (t: ReturnType<typeof scene>['t'], enemies: number, shared: number): typeof t => ({ ...t, battle: { ...t.battle, slots: { ...t.battle.slots, enemies, shared: [{ enemies: shared, allies: 0 }] } } });

describe('the Bubble with elites and a Boss', { timeout: TIMEOUT }, () => {
  /** Boss Floor 3 of seed 1: the Boss Warband's Soldiers (the Boss first) and the first guard Soldier, all else fallen; a Player spot in the Boss Hall. */
  function bossScene() {
    const s = scene(1, 3);
    const q = s.crowd.warbands!.rank.indexOf(BOSS);
    const ids = s.crowd.squad.flatMap((sq, i) => (sq === q ? [i] : []));
    const hall = s.plan.halls[s.plan.stairs]!;
    const centre = { x: hall.cx, z: hall.cz };
    const alive = s.crowd.alive.map((a, i) => (ids.includes(i) ? a : 0));
    /** The Boss and the first guard Soldier at distances (m) east of `centre`; the rest of the Warband fallen. */
    const stand = (boss: number, guard: number): CrowdState => ({ ...place(s, s.crowd, [ids[0]!, ids[1]!], [{ x: centre.x + boss, z: centre.z }, { x: centre.x + guard, z: centre.z }]), alive: alive.map((a, i) => (i === ids[0] || i === ids[1] ? a : 0)) });
    return { s, ids, hall, centre, stand };
  }

  it('gives a promoted elite its Relics\' Mods on top of its base Troop\'s (Whetstone\'s damage folded with the Battle\'s half damage)', () => {
    const s = scene(1, 1);
    const w = s.crowd.warbands!;
    const q = w.rank.indexOf(ELITE);
    const ids = s.crowd.squad.flatMap((sq, i) => (sq === q ? [i] : []));
    const post = s.homes.posts[w.post[q]!]!;
    const crowd: CrowdState = { ...s.crowd, alive: s.crowd.alive.map((a, i) => (i === ids[0] ? a : 0)) };
    const next = stepBubbles(s.duel([{ x: post.x + 3, z: post.z }], crowd), 1, 1, s.t);
    const got = promoted(next).find((f) => f.s === ids[0])!;
    expect(got).toBeDefined();
    const troop = s.battle.troops[crowd.troop[ids[0]!]!]!;
    expect(troop.relics).toEqual(['Whetstone']);
    const base = foldMods([{ effects: troop.mods }]);
    expect(base.damage).toBeCloseTo(0.5);
    expect(got.f.mods!.damage).toBeCloseTo(base.damage * 1.1);
    expect(got.f.mods).toEqual(foldMods([{ effects: troop.mods }, { effects: { damage: 1.1 } }]));
  });

  it('gives a promoted Boss no half-damage Mod, and a guard of its Warband the Battle\'s', () => {
    const { s, ids, centre, stand } = bossScene();
    const next = stepBubbles(s.duel([centre], stand(3, 4)), 1, 1, s.t, [], { soldier: ids[0]!, hold: false });
    const boss = promoted(next).find((f) => f.s === ids[0])!;
    const guard = promoted(next).find((f) => f.s === ids[1])!;
    expect(boss).toBeDefined();
    expect(s.battle.troops[s.crowd.troop[ids[0]!]!]!.boss).toBe(true);
    expect(boss.f.mods).toBeUndefined();
    expect(guard.f.mods!.damage).toBeCloseTo(0.5);
  });

  it('gives the Boss the one free Attack Slot over a nearer guard Soldier, and the nearer one without a BossHold', () => {
    const { s, ids, centre, stand } = bossScene();
    const t = withSlots(s.t, 1, 1);
    const crowd = stand(7, 3);
    const first = (boss?: BossHold) => promoted(stepBubbles(s.duel([centre], crowd), 1, 1, t, [], boss)).map((f) => f.s);
    expect(first()).toEqual([ids[1]]);
    expect(first({ soldier: -1, hold: true })).toEqual([ids[1]]);
    expect(first({ soldier: ids[0]!, hold: false })).toEqual([ids[0]]);
  });

  it('does not let the Boss\' Fighter go when the share shrinks, though a nearer guard Fighter holds a slot too', () => {
    const { s, ids, centre, stand } = bossScene();
    const t = withSlots(s.t, 1, 1);
    // Both promoted at once (2 slots), then the share shrinks to 1: the Boss keeps it though the farther.
    const two = stepBubbles(s.duel([centre], stand(7, 3)), 1, 1, withSlots(s.t, 2, 1), [], { soldier: ids[0]!, hold: false });
    expect(promoted(two).map((f) => f.s).sort()).toEqual(ids.slice(0, 2).sort());
    const after = stepBubbles(two, 1, 2, t, [], { soldier: ids[0]!, hold: false });
    const roles = Object.fromEntries(promoted(after).map((f) => [f.s, f.role]));
    expect(roles[ids[0]!]).toBe('Attack');
    expect(roles[ids[1]!]).toBe('Waiting');
    // Without the BossHold the farther one lets its slot go.
    const plain = Object.fromEntries(promoted(stepBubbles(two, 1, 2, t)).map((f) => [f.s, f.role]));
    expect(plain[ids[0]!]).toBe('Waiting');
    expect(plain[ids[1]!]).toBe('Attack');
  });

  it('keeps the Boss\' Fighter promoted past `demote` while a Player holds the Hall, and demotes it when none does', () => {
    const { s, ids, centre, stand } = bossScene();
    const first = stepBubbles(s.duel([centre], stand(3, 4)), 1, 1, s.t, [], { soldier: ids[0]!, hold: true });
    const boss = promoted(first).find((f) => f.s === ids[0])!;
    expect(boss).toBeDefined();
    const spots = floorSpots(s);
    const beyond = spots.find((p) => walkBetween(s, boss.f.position.x, boss.f.position.z, p.x, p.z) > s.battle.bubble.demote + 1)!;
    expect(beyond).toBeDefined();
    const late = 1 + Math.round(s.battle.bubble.minPromotedSeconds * 60) + 5;
    const gone = (hold: BossHold | undefined) => stepBubbles({ ...first, fighters: first.fighters.map((f, k) => (k === 0 ? s.fighter(beyond.x, beyond.z) : f)) }, 1, late, s.t, [], hold);
    expect(promoted(gone({ soldier: ids[0]!, hold: true })).map((f) => f.s)).toContain(ids[0]);
    expect(promoted(gone({ soldier: ids[0]!, hold: false })).map((f) => f.s)).not.toContain(ids[0]);
    expect(promoted(gone(undefined)).map((f) => f.s)).not.toContain(ids[0]);
    // The guard Soldier is let go either way: only the Boss is held.
    expect(promoted(gone({ soldier: ids[0]!, hold: true })).map((f) => f.s)).not.toContain(ids[1]);
  });

  it('steps a Floor the same with no BossHold, with a BossHold of no Soldier, and with an undefined one', () => {
    const { s, centre, stand } = bossScene();
    const state = s.duel([centre], stand(3, 4));
    const plain = stepBubbles(state, 1, 1, s.t);
    expect(stepBubbles(state, 1, 1, s.t, [], undefined)).toEqual(plain);
    expect(stepBubbles(state, 1, 1, s.t, [], { soldier: -1, hold: true })).toEqual(plain);
  });
});
