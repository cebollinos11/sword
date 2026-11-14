import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { arenaOf } from './arena';
import { groundOf, soldierHeight } from './battlefield';
import { stepCrowd, type CrowdFighter, type CrowdState } from './crowd';
import { battleMapOf } from './destinations';
import { arenaTuning, deployWarbands, floorArenaName, floorOf, warbandHomes } from './delver';
import type { Rect } from '../mapEditor/source';
import type { DelverGallery, DelverHall, FloorPlan } from './delver/plan';
import { treasurePickups, dropSpots } from './delverLoot';
import { inStairs } from './delverRun';
import { runSeed } from './dungeon';
import { hashValue } from './hash';
import { IDLE_INTENT, type Intent } from './intent';
import { createMatch, doorTicksNeeded, MAX_TEAM_SIZE, stepMatch, type MatchState } from './match';
import { restore, snapshot } from './snapshot';
import type { FighterState } from './state';
import { brainTicks, warbandBrain } from '.';
import { CHASE, GUARD, RETURN } from './warband';
import { secondsToTicks } from './constants';

/**
 * The Delver Run on levelled Floors (docs/plans/delver.md, Stage 6, Task 3): the default Tuning, whose Floors have Hall levels, galleries and
 * sloped Passages. Each case searches the Run seeds in a fixed order for a Floor that has what it needs and fails loudly when none of the first
 * `SEARCH` has.
 */
const base = loadTuningData();
/** A short Run with every guard post filled: its Warbands stand on the Floor's levels. */
const full: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 100, patrolFill: 100 } };
/** The same with no Soldiers, for the cases about the party alone. */
const empty: TuningData = { ...base, delver: { ...base.delver, tiers: 1, floorsPerTier: 3, postFill: 0, patrolFill: 0 } };
const MAX = base.fighter.maxHp;
/** How many Run seeds (`gen:greybox:1` on) a search looks through. */
const SEARCH = 80;

const arenaOfSeed = (n: number): string => `gen:greybox:${n}`;
const planOf = (t: TuningData, arena: string, floor = 1): FloorPlan => floorOf(t, floorArenaName(runSeed(arena), floor))!.plan;

/** The first Run seed (in order) whose Floor 1 satisfies `want`: its arena name and plan. Throws when none of the first SEARCH does. */
function find(t: TuningData, what: string, want: (plan: FloorPlan) => boolean): { arena: string; plan: FloorPlan } {
  for (let n = 1; n <= SEARCH; n++) {
    const arena = arenaOfSeed(n);
    const plan = planOf(t, arena);
    if (want(plan)) return { arena, plan };
  }
  throw new Error(`no Floor 1 of the first ${SEARCH} seeds has ${what}`);
}

const start = (t: TuningData, arena: string, own = 1): MatchState =>
  createMatch(t, { format: 'Gauntlet', bestOf: 1, seed: 7, arena, delver: true, teams: [...Array<number>(own).fill(0), ...Array<number>(MAX_TEAM_SIZE).fill(1)], humans: own, players: [...Array(own).keys()] });
const withFighters = (m: MatchState, edit: (f: FighterState, i: number) => FighterState): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map(edit) } });
const put = (m: MatchState, i: number, x: number, z: number, y: number): MatchState => withFighters(m, (f, k) => (k === i ? { ...f, position: { x, z }, y } : f));
const tickOf = (t: TuningData, m: MatchState, by: Record<number, Partial<Intent>> = {}): MatchState => stepMatch(m, m.duel.fighters.map((_, i) => ({ ...IDLE_INTENT, ...by[i] })), t);
const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
/** The facing (radians; 0 faces +z) from a Deck toward its Ramp: the Ramp lies along the wall at the Deck's end. */
const towardRamp = (g: DelverGallery): number => {
  const d = centre(g.deck);
  const r = centre(g.ramp);
  if (r.x > d.x) return Math.PI / 2;
  if (r.x < d.x) return -Math.PI / 2;
  return r.z > d.z ? 0 : Math.PI;
};
/** A Hall with a gallery whose Deck holds a guard's post: the Hall and the post's index. */
const deckPost = (plan: FloorPlan): { hall: DelverHall; post: number } | undefined => {
  const post = plan.markers.posts.findIndex((p) => plan.halls[p.hall]!.gallery?.y === p.y);
  return post < 0 ? undefined : { hall: plan.halls[plan.markers.posts[post]!.hall]!, post };
};

describe('a Delver Run on levelled Floors: spawns, Stairs, fires, pedestals', { timeout: 120_000 }, () => {
  it('puts Team 0 at the Entrance\'s y when the Entrance is not at 0', () => {
    const { arena, plan } = find(empty, 'an Entrance off the ground', (p) => p.halls[p.entrance]!.y > 0);
    const m = start(empty, arena, 3);
    expect(plan.markers.spawns[0]!.y).toBe(plan.halls[plan.entrance]!.y);
    m.duel.fighters.slice(0, 3).forEach((f, k) => {
      expect(f.team).toBe(0);
      expect(f.y).toBe(plan.markers.spawns[k]!.y);
      expect(f.y).toBeGreaterThan(0);
    });
  });

  it('counts the Stairs at the Stairs\' y and not 2 m under it', () => {
    const { arena, plan } = find(empty, 'Stairs off the ground', (p) => p.markers.stairs.y >= 2);
    const { zone, y } = plan.markers.stairs;
    const c = centre(zone);
    const f = (at: number): Pick<FighterState, 'position' | 'y'> => ({ position: { x: c.x, z: c.z }, y: at });
    expect(inStairs(plan, f(y))).toBe(true);
    expect(inStairs(plan, f(y + 1.9))).toBe(true);
    expect(inStairs(plan, f(y - 0.4))).toBe(true);
    expect(inStairs(plan, f(y - 2))).toBe(false);
    expect(inStairs(plan, f(0))).toBe(false);
    // The Run takes them: a Player standing there for the doorSeconds.
    let m = put(start(empty, arena), 0, c.x, c.z, y);
    for (let k = 0; k < doorTicksNeeded(empty) + 2; k++) m = tickOf(empty, m);
    expect(m.delver!.phase).toBe('Descending');
  });

  it('heals and revives at a fire\'s y', () => {
    const { arena, plan } = find(empty, 'a fire off the ground', (p) => p.markers.fires.some((f) => f.y >= 2));
    const k = plan.markers.fires.findIndex((f) => f.y >= 2);
    const fire = plan.markers.fires[k]!;
    const m = start(empty, arena, 2);
    // At its y the fire heals; 2 m under it (the floor below) it does not.
    const healed = tickOf(empty, put(withFighters(m, (f, i) => (i === 0 ? { ...f, hp: MAX * 0.4 } : f)), 0, fire.x, fire.z, fire.y));
    expect(healed.delver!.restUsed[k]!.healed).toEqual([0]);
    expect(healed.duel.fighters[0]!.hp).toBeGreaterThan(MAX * 0.4);
    const under = tickOf(empty, put(withFighters(m, (f, i) => (i === 0 ? { ...f, hp: MAX * 0.4 } : f)), 0, fire.x, fire.z, fire.y - 2));
    expect(under.delver!.restUsed[k]!.healed).toEqual([]);
    // It revives the fallen at its y.
    const fallen = withFighters(m, (f, i) => (i === 1 ? { ...f, hp: 0, death: { tick: 0, cause: 'Fall', blow: null } } : f));
    const r = tickOf(empty, put(fallen, 0, fire.x, fire.z, fire.y));
    expect(r.events).toContainEqual({ type: 'Revived', fighter: 1, fire: k });
    expect(r.duel.fighters[1]!.death).toBeUndefined();
    expect(r.duel.fighters[1]!.y).toBe(fire.y);
    expect(r.delver!.restUsed[k]!.revived).toBe(true);
  });

  it('stands the pedestals at their markers\' y', () => {
    const { arena, plan } = find(empty, 'a pedestal off the ground', (p) => p.markers.pedestals.some((m) => m.y > 0));
    const m = start(empty, arena, 2);
    const made = treasurePickups(arenaTuning(empty, m.arena), m.config, plan, runSeed(arena), 1);
    expect(made.length).toBeGreaterThan(0);
    expect(made).toEqual(m.delver!.pickups);
    const per = empty.dungeon.loot.pedestals;
    plan.markers.pedestals.forEach((p, k) => {
      if (k % 3 >= per) return;
      const t = Math.floor(k / 3);
      for (const owner of [0, 1]) expect(made[(t * 2 + owner) * per + (k % 3)]!.at).toEqual({ x: p.x, y: p.y, z: p.z });
    });
    expect(made.some((p) => p.at.y > 0)).toBe(true);
  });
});

describe('a Delver Run on levelled Floors: drops', { timeout: 120_000 }, () => {
  const { arena, plan } = find(empty, 'a Hall with a gallery', (p) => p.halls.some((h) => h.gallery !== undefined));
  const hall = plan.halls.find((h) => h.gallery !== undefined)!;
  const g = hall.gallery!;
  const t = arenaTuning(empty, floorArenaName(runSeed(arena), 1));
  const geometry = arenaOf(t, floorArenaName(runSeed(arena), 1));
  const lv = t.battle.levels;

  it('lies on the Deck for a fall on the Deck, and on the floor beside it', () => {
    const d = centre(g.deck);
    expect(dropSpots(plan, geometry, lv, d.x, d.z, g.y, 1)[0]).toEqual({ x: d.x, y: g.y, z: d.z });
    // One metre off the Deck's front edge, on the Hall's floor.
    const front = { n: { x: d.x, z: g.deck.z0 - 1 }, s: { x: d.x, z: g.deck.z1 + 1 }, e: { x: g.deck.x0 - 1, z: d.z }, w: { x: g.deck.x1 + 1, z: d.z } }[g.side];
    expect(dropSpots(plan, geometry, lv, front.x, front.z, hall.y, 1)[0]).toEqual({ x: front.x, y: hall.y, z: front.z });
    // Falls from the Deck's height, but off it, lie on the floor under.
    expect(dropSpots(plan, geometry, lv, front.x, front.z, g.y, 1)[0]!.y).toBe(hall.y);
  });

  it('lays a wiped Deck Warband\'s drops on the Deck, and its WarbandWiped at the Deck\'s y', () => {
    const found = find(full, 'a Deck post', (p) => deckPost(p) !== undefined);
    const dp = deckPost(found.plan)!;
    let m = start(full, found.arena, 2);
    const crowd = m.duel.crowd!;
    const q = crowd.warbands!.post.indexOf(dp.post);
    expect(q).toBeGreaterThanOrEqual(0);
    const soldiers = crowd.squad.flatMap((sq, s) => (sq === q ? [s] : []));
    const dead = (a: readonly number[]) => a.map((v, s) => (soldiers.includes(s) ? 0 : v));
    m = { ...m, duel: { ...m.duel, crowd: { ...crowd, alive: dead(crowd.alive), hp: dead(crowd.hp) } } };
    const firstId = m.delver!.pickups.length;
    const r = tickOf(full, m);
    expect(r.delver!.wiped).toContain(q);
    const wiped = r.events.find((e) => e.type === 'WarbandWiped' && e.warband === q)!;
    expect(wiped).toMatchObject({ at: { y: dp.hall.gallery!.y } });
    expect(r.delver!.pickups[firstId]!.at.y).toBe(dp.hall.gallery!.y);
  });
});

describe('Warbands on levelled Floors', { timeout: 120_000 }, () => {
  it('deploys a Deck post\'s Warband on the Deck, facing its Ramp', () => {
    const { arena, plan } = find(full, 'a Deck post', (p) => deckPost(p) !== undefined);
    const dp = deckPost(plan)!;
    const g = dp.hall.gallery!;
    const name = floorArenaName(runSeed(arena), 1);
    const built = floorOf(full, name)!;
    const tt = arenaTuning(full, name);
    const crowd = deployWarbands(tt, plan, built.field, runSeed(arena), 1, 1);
    const q = crowd.warbands!.post.indexOf(dp.post);
    expect(q).toBeGreaterThanOrEqual(0);
    const home = warbandHomes(plan).posts[dp.post]!;
    expect(home.y).toBe(g.y);
    expect(home.facing).toBe(towardRamp(g));
    const deckSurface = groundOf(tt.battle, built.field, plan.markers.posts[dp.post]!.x, plan.markers.posts[dp.post]!.z, g.y);
    const members = crowd.squad.flatMap((sq, i) => (sq === q ? [i] : []));
    expect(members.length).toBeGreaterThan(0);
    expect(crowd.squads.surface[q]).toBe(deckSurface);
    for (const i of members) {
      expect(crowd.surface[i]).toBe(deckSurface);
      expect(soldierHeight(built.field, crowd.surface[i]!, crowd.x[i]!, crowd.z[i]!)).toBe(g.y);
      expect(crowd.heading[i]).toBe(towardRamp(g));
      expect(crowd.x[i]).toBeGreaterThanOrEqual(g.deck.x0);
      expect(crowd.x[i]).toBeLessThanOrEqual(g.deck.x1);
      expect(crowd.z[i]).toBeGreaterThanOrEqual(g.deck.z0);
      expect(crowd.z[i]).toBeLessThanOrEqual(g.deck.z1);
    }
  });

  /** Floor `n`'s scene for the brain: Tuning, map, homes and the Crowd. */
  function scene(arena: string, floor = 1) {
    const name = floorArenaName(runSeed(arena), floor);
    const built = floorOf(full, name)!;
    const t = arenaTuning(full, name);
    const map = battleMapOf(t.battle, name);
    const homes = warbandHomes(built.plan);
    return { plan: built.plan, t, map, homes, brain: warbandBrain(homes, t.delver), crowd: deployWarbands(t, built.plan, built.field, runSeed(arena), floor, 1), field: map.field };
  }
  type Scene = ReturnType<typeof scene>;
  const run = (s: Scene, crowd: CrowdState, ticks: number, party: (tick: number) => CrowdFighter[], from = 1): CrowdState => {
    for (let tick = from; tick < from + ticks; tick++) crowd = stepCrowd(crowd, tick, s.t.battle, party(tick), s.map, s.brain);
    return crowd;
  };
  const anchorY = (s: Scene, c: CrowdState, q: number): number => soldierHeight(s.field, c.squads.surface[q]!, c.squads.x[q]!, c.squads.z[q]!);

  it('sees a Player standing on its Hall\'s gallery Deck above it, and not one 4 m up', () => {
    // A Warband on the floor of a Hall with a gallery, whose Deck's centre is within reach of its sight.
    let hit: { arena: string; q: number; at: { x: number; z: number }; hall: DelverHall } | undefined;
    for (let n = 1; n <= SEARCH && !hit; n++) {
      const arena = arenaOfSeed(n);
      if (!planOf(full, arena).halls.some((h) => h.gallery)) continue;
      const s = scene(arena);
      for (let q = 0; q < s.crowd.squads.team.length && !hit; q++) {
        const ax = s.crowd.squads.x[q]!;
        const az = s.crowd.squads.z[q]!;
        const hall = s.plan.halls.find((h) => h.gallery && ax > h.rect.x0 && ax < h.rect.x1 && az > h.rect.z0 && az < h.rect.z1 && anchorY(s, s.crowd, q) === h.y);
        if (!hall) continue;
        const d = centre(hall.gallery!.deck);
        if (Math.hypot(d.x - ax, d.z - az) > 12) continue;
        const onDeck = (y: number) => [{ x: d.x, z: d.z, y, team: 0, slot: 0 }];
        const chased = run(s, s.crowd, brainTicks(s.t.battle) * 3, () => onDeck(hall.gallery!.y));
        if (chased.warbands!.mode[q] === CHASE) hit = { arena, q, at: d, hall };
      }
    }
    if (!hit) throw new Error(`no Warband of the first ${SEARCH} seeds stands on a gallery Hall's floor in sight of its Deck`);
    const s = scene(hit.arena);
    const g = hit.hall.gallery!;
    const watch = (y: number) => run(s, s.crowd, brainTicks(s.t.battle) * 3, () => [{ x: hit!.at.x, z: hit!.at.z, y, team: 0, slot: 0 }]);
    expect(s.crowd.warbands!.mode[hit.q]).not.toBe(CHASE);
    expect(watch(g.y).warbands!.mode[hit.q]).toBe(CHASE);
    // 4 m over the Hall's floor (2 m over the Deck, falling too little in the Ticks watched to matter): out of the 2.5 m reach.
    expect(watch(hit.hall.y + 4).warbands!.mode[hit.q]).not.toBe(CHASE);
  });

  it('walks home on a Hall that is not at level 0: a Warband walked off returns to its post', () => {
    let found: { arena: string; q: number; dx: number; dz: number } | undefined;
    for (let n = 1; n <= SEARCH && !found; n++) {
      const arena = arenaOfSeed(n);
      const plan = planOf(full, arena);
      if (!plan.markers.posts.some((p) => p.y >= 2 && plan.halls[p.hall]!.gallery?.y !== p.y)) continue;
      const s = scene(arena);
      const w = s.crowd.warbands!;
      for (let q = 0; q < w.post.length && !found; q++) {
        if (w.post[q]! < 0) continue;
        const post = s.homes.posts[w.post[q]!]!;
        if (post.y < 2) continue;
        const hall = s.plan.halls[s.plan.markers.posts[w.post[q]!]!.hall]!;
        if (hall.gallery?.y === post.y) continue;
        // 3 m to the side of the post (inside the Hall, the same floor).
        for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
          const px = post.x + dx;
          const pz = post.z + dz;
          const on = groundOf(s.t.battle, s.field, px, pz, post.y);
          if (on >= 0 && soldierHeight(s.field, on, px, pz) === post.y && px > hall.rect.x0 + 1 && px < hall.rect.x1 - 1 && pz > hall.rect.z0 + 1 && pz < hall.rect.z1 - 1) {
            found = { arena, q, dx, dz };
            break;
          }
        }
      }
    }
    if (!found) throw new Error(`no guard post of the first ${SEARCH} seeds stands on a floor above level 0`);
    const s = scene(found.arena);
    const { q, dx, dz } = found;
    const w = s.crowd.warbands!;
    const post = s.homes.posts[w.post[q]!]!;
    // Move the whole Warband off its post, returning (deaf).
    const move = (v: readonly number[], d: number) => v.map((u, i) => (s.crowd.squad[i] === q ? u + d : u));
    const surfaceAt = (x: number, z: number) => groundOf(s.t.battle, s.field, x, z, post.y);
    const off: CrowdState = {
      ...s.crowd,
      x: move(s.crowd.x, dx),
      z: move(s.crowd.z, dz),
      surface: s.crowd.surface.map((u, i) => (s.crowd.squad[i] === q ? surfaceAt(s.crowd.x[i]! + dx, s.crowd.z[i]! + dz) : u)),
      squads: {
        ...s.crowd.squads,
        x: s.crowd.squads.x.map((u, k) => (k === q ? u + dx : u)),
        z: s.crowd.squads.z.map((u, k) => (k === q ? u + dz : u)),
        surface: s.crowd.squads.surface.map((u, k) => (k === q ? surfaceAt(post.x + dx, post.z + dz) : u)),
      },
      warbands: { ...w, mode: w.mode.map((u, k) => (k === q ? RETURN : u)) },
    };
    const back = run(s, off, secondsToTicks(20), () => []);
    expect(back.warbands!.mode[q]).toBe(GUARD);
    expect(Math.hypot(back.squads.x[q]! - post.x, back.squads.z[q]! - post.z)).toBeLessThanOrEqual(s.t.delver.arrive + 0.5);
    expect(anchorY(s, back, q)).toBe(post.y);
  });
});

describe('a Delver Run on levelled Floors: deterministic, and Rollback across a Floor change', () => {
  const FADE = secondsToTicks(full.dungeon.hallFadeSeconds);
  /** A scripted Run on levelled Floors with their Warbands: the Player starts in the Stairs, takes them, and walks about on Floor 2 for 40 Ticks. */
  function play(arena: string): { states: MatchState[]; intents: Intent[][] } {
    const first = start(full, arena, 3);
    const { zone, y } = planOf(full, arena).markers.stairs;
    const c = centre(zone);
    let m = put(put(put(first, 0, c.x, c.z, y), 1, c.x + 1, c.z, y), 2, c.x - 1, c.z, y);
    const states = [m];
    const intents: Intent[][] = [];
    let changed = -1;
    for (let k = 0; k < 900 && (changed < 0 || k < changed + 40); k++) {
      const these = m.duel.fighters.map((_, i) => (i === 0 && m.duelNumber === 2 ? { ...IDLE_INTENT, move: { x: 1, z: 0 }, face: 1 } : i === 2 ? { ...IDLE_INTENT, move: { x: 0, z: 0.5 } } : IDLE_INTENT));
      intents.push(these);
      m = stepMatch(m, these, full);
      states.push(m);
      if (changed < 0 && m.duelNumber === 2) changed = k;
    }
    return { states, intents };
  }
  const { arena } = find(full, 'Floors 1 and 2 levelled', (p) => new Set(p.halls.map((h) => h.level)).size >= 2);

  it('gives the same hash at every Tick for the same Intents, across a Floor change', () => {
    const one = play(arena);
    const two = play(arena);
    expect(one.states.map((x) => hashValue(x))).toEqual(two.states.map((x) => hashValue(x)));
    expect(one.states.at(-1)!.duelNumber).toBe(2);
  });

  it('re-simulates to the same state from a snapshot taken before the Floor change', () => {
    const { states, intents } = play(arena);
    const change = states.findIndex((x) => x.duelNumber === 2);
    expect(change).toBeGreaterThan(0);
    for (const back of [change - 1, change - Math.floor(FADE / 2), change - FADE]) {
      let r = restore(snapshot(states[back]!));
      for (let k = back; k < states.length - 1; k++) {
        r = stepMatch(r, intents[k]!, full);
        expect(hashValue(r)).toBe(hashValue(states[k + 1]!));
      }
    }
  });
});
