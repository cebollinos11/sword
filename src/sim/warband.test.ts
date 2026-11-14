import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import type { DelverTuning } from '../tuning/delver';
import { arenaTuning, deployWarbands, floorArenaName, floorOf, warbandHomes } from './delver';
import { groundOf, soldierHeight } from './battlefield';
import { secondsToTicks } from './constants';
import { stepCrowd, walkDistance, walkField, type CrowdFighter, type CrowdState } from './crowd';
import { battleMapOf, clearanceAt, fieldDistance, fieldToward, inSight, oneField } from './destinations';
import { brainTicks, COLUMN, LOOSE, stepWarbands, warbandBrain } from '.';
import { CHASE, GUARD, PATROL, RETURN, type WarbandState } from './warband';
import { flatFloors } from './delver/flat.testdata';

const tuning = flatFloors(loadTuningData());
const TIMEOUT = 120_000;

/**
 * The bundled Tuning with every guard and patrol template four Soldiers strong (of its first Troop), no elites: the size the Warband tests below that
 * kill part of a Squad, or lead one Soldier off from the rest, assume (the bundled templates are one to five Soldiers now).
 */
const bigWarbands: TuningData = {
  ...tuning,
  delver: {
    ...tuning.delver,
    elitePosts: 0,
    warbands: tuning.delver.warbands.map((tier) => {
      const four = (w: DelverTuning['warbands'][number]['guard'][number]) => ({ ...w, troops: [{ troop: w.troops[0]!.troop, count: 4 }] });
      return { ...tier, guard: tier.guard.map(four), patrol: tier.patrol.map(four) };
    }),
  },
};

/** Floor `floor` of Run `seed` with its Crowd deployed for one human: the Floor's Tuning, map, homes and brain. */
function scene(seed = 1, floor = 1, humans = 1, override: Partial<DelverTuning> = {}, base: TuningData = tuning) {
  const name = floorArenaName(seed, floor);
  const built = floorOf(base, name)!;
  const t = arenaTuning(base, name);
  const map = battleMapOf(t.battle, name);
  const homes = warbandHomes(built.plan);
  const rules = { ...t.delver, ...override };
  return { name, plan: built.plan, t, battle: t.battle, rules, map, field: map.field, homes, brain: warbandBrain(homes, rules), crowd: deployWarbands(t, built.plan, built.field, seed, floor, humans) };
}
type Scene = ReturnType<typeof scene>;

/** A party Fighter (Team 0, Pool slot `slot`) standing on the floor at (x, z). */
function party(s: Scene, x: number, z: number, slot = 0): CrowdFighter {
  return { x, z, y: soldierHeight(s.field, groundOf(s.battle, s.field, x, z, 0), x, z), team: 0, slot };
}

/** Steps the Crowd `ticks` Ticks from Tick `from` (the next to step), the party being `fighters(tick)`; `each` sees every Tick's result. Returns the Crowd and the next Tick. */
function advance(s: Scene, crowd: CrowdState, from: number, ticks: number, fighters: (tick: number) => readonly CrowdFighter[] = () => [], each?: (c: CrowdState, tick: number) => boolean | void) {
  let tick = from;
  for (; tick < from + ticks; tick++) {
    crowd = stepCrowd(crowd, tick, s.battle, fighters(tick), s.map, s.brain);
    if (each?.(crowd, tick) === true) return { crowd, tick: tick + 1 };
  }
  return { crowd, tick };
}

/** Every Warband thinks within this many Ticks. */
const PERIOD = (s: Scene) => brainTicks(s.battle);
const members = (c: CrowdState, q: number) => c.squad.flatMap((sq, i) => (sq === q ? [i] : []));

/** `crowd` with Warband q's brain entries changed. */
function setWarband(crowd: CrowdState, q: number, edit: { [K in 'mode' | 'leg' | 'chased' | 'seen']?: number }): CrowdState {
  const w = crowd.warbands!;
  const next = { ...w } as { -readonly [K in keyof WarbandState]: number[] };
  for (const [key, v] of Object.entries(edit)) {
    next[key as keyof typeof edit] = w[key as keyof typeof edit]!.slice();
    next[key as keyof typeof edit]![q] = v;
  }
  return { ...crowd, warbands: next };
}

/** `crowd` with Warband q's anchor and Soldiers moved so the anchor stands at (x, z). */
function teleport(s: Scene, crowd: CrowdState, q: number, x: number, z: number): CrowdState {
  const { x: ax, z: az } = { x: crowd.squads.x[q]!, z: crowd.squads.z[q]! };
  const nx = crowd.x.slice();
  const nz = crowd.z.slice();
  const ns = crowd.surface.slice();
  crowd.squad.forEach((sq, i) => {
    if (sq !== q) return;
    nx[i] = x + (crowd.x[i]! - ax);
    nz[i] = z + (crowd.z[i]! - az);
    ns[i] = groundOf(s.battle, s.field, nx[i]!, nz[i]!, 0);
  });
  const set = (a: readonly number[], v: number) => a.map((u, k) => (k === q ? v : u));
  return { ...crowd, x: nx, z: nz, surface: ns, squads: { ...crowd.squads, x: set(crowd.squads.x, x), z: set(crowd.squads.z, z), surface: set(crowd.squads.surface, groundOf(s.battle, s.field, x, z, 0)) } };
}

/** `crowd` with Soldier `i` dead. */
const kill = (crowd: CrowdState, i: number): CrowdState => ({ ...crowd, alive: crowd.alive.map((a, k) => (k === i ? 0 : a)), hp: crowd.hp.map((h, k) => (k === i ? 0 : h)) });

/** Warband q's home field (its post's or its loop's point `leg`). */
function homeField(s: Scene, crowd: CrowdState, q: number) {
  const w = crowd.warbands!;
  const at = w.post[q]! >= 0 ? s.homes.posts[w.post[q]!]! : s.homes.patrols[w.patrol[q]!]![w.leg[q]!]!;
  return oneField(s.map.fields, fieldToward(s.map.fields, at.x, at.z, groundOf(s.battle, s.field, at.x, at.z, 0)));
}

/** Walking distance (m) from the anchor of Warband q to its home. */
const fromHome = (s: Scene, crowd: CrowdState, q: number, x = crowd.squads.x[q]!, z = crowd.squads.z[q]!): number => walkDistance(homeField(s, crowd, q), x, z, groundOf(s.battle, s.field, x, z, 0));

/** Whether any living Soldier of Warband q in the Crowd sees a party Fighter at (x, z): the brain's rule (flat within `sight`, feet no more than `levels.promote` apart, in sight past the Walls). */
function seen(s: Scene, crowd: CrowdState, q: number, x: number, z: number): boolean {
  const f = party(s, x, z);
  return members(crowd, q).some((i) => {
    if (!crowd.alive[i]) return false;
    const sy = soldierHeight(s.field, crowd.surface[i]!, crowd.x[i]!, crowd.z[i]!);
    return Math.hypot(crowd.x[i]! - x, crowd.z[i]! - z) <= s.rules.sight && Math.abs(sy - f.y!) <= s.battle.levels.promote && inSight(s.map.fields, crowd.x[i]!, crowd.z[i]!, x, z, 0, sy, f.y!);
  });
}

/** Whether `seen` holds for a Soldier of Warband q moved up to 1.5 m either way: a spot a Soldier cannot come to see by settling into its place. */
function seenNear(s: Scene, crowd: CrowdState, q: number, x: number, z: number): boolean {
  for (const dx of [-1.5, 0, 1.5])
    for (const dz of [-1.5, 0, 1.5]) {
      const shifted = { ...crowd, x: crowd.x.map((v, i) => (crowd.squad[i] === q ? v + dx : v)), z: crowd.z.map((v, i) => (crowd.squad[i] === q ? v + dz : v)) };
      if (seen(s, shifted, q, x, z)) return true;
    }
  return false;
}

/**
 * The spots on the floor reachable from Warband q's home with room round them (clearance half a metre), within `radius` of (cx, cz), nearest (cx, cz) first
 * (then lower x, lower z).
 */
function spots(s: Scene, crowd: CrowdState, q: number, cx: number, cz: number, radius: number): { x: number; z: number }[] {
  const home = homeField(s, crowd, q);
  const out: { x: number; z: number; d: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++) {
      const x = Math.round(cx) + dx;
      const z = Math.round(cz) + dz;
      const on = groundOf(s.battle, s.field, x, z, 0);
      if (on < 0 || Math.hypot(x - cx, z - cz) > radius || clearanceAt(s.map.fields, x, z, on) < 0.5 || fieldDistance(home, 0, x, z, on) < 0) continue;
      out.push({ x, z, d: Math.hypot(x - cx, z - cz) });
    }
  return out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
}

/** The first Warband of `mode` in the Crowd. */
const firstOf = (crowd: CrowdState, mode: number): number => crowd.warbands!.mode.indexOf(mode);

/** A spot in sight of all Warband q's Soldiers, `lo` to `hi` m (flat) from its anchor. */
function inView(s: Scene, crowd: CrowdState, q: number, lo: number, hi: number): { x: number; z: number } {
  const ax = crowd.squads.x[q]!;
  const az = crowd.squads.z[q]!;
  const found = spots(s, crowd, q, ax, az, hi).find((p) => Math.hypot(p.x - ax, p.z - az) >= lo && members(crowd, q).every((i) => seen(s, { ...crowd, alive: crowd.alive.map((a, k) => (k === i ? a : 0)) }, q, p.x, p.z)));
  if (!found) throw new Error(`no spot ${lo} to ${hi} m in view of Warband ${q}`);
  return found;
}

describe('the Warband brain', { timeout: TIMEOUT }, () => {
  it('a guard that sees the party chases it, nearest first, walking up to closeIn of it', () => {
    const s = scene(1);
    const q = firstOf(s.crowd, GUARD);
    const at = inView(s, s.crowd, q, 8, 12);
    const fighters = () => [party(s, at.x, at.z, 3)];
    const { crowd } = advance(s, s.crowd, 1, 2 * PERIOD(s), fighters);
    const w = crowd.warbands!;
    expect([w.mode[q], w.chased[q]]).toEqual([CHASE, 3]);
    expect(w.seen[q]!).toBeGreaterThan(0);
    // It walks at the Fighter and halts within closeIn of it by the field, in a line.
    const walk = walkField(s.battle, s.map, at.x, at.z, party(s, at.x, at.z).y);
    const start = walkDistance(walk, s.crowd.squads.x[q]!, s.crowd.squads.z[q]!, s.crowd.squads.surface[q]!);
    const end = advance(s, crowd, 2 * PERIOD(s) + 1, 15 * 60, fighters).crowd;
    const near = walkDistance(walk, end.squads.x[q]!, end.squads.z[q]!, end.squads.surface[q]!);
    expect(start).toBeGreaterThan(s.rules.closeIn);
    expect(near).toBeLessThanOrEqual(s.rules.closeIn + 0.5);
    expect(end.squads.speed[q]).toBe(0);
    expect(end.squads.shape[q]).toBe(1);
  });

  it('keeps no one in sight through a Wall: a Fighter within sight flat but behind a Hall wall is not chased', () => {
    // Seeds 1 to 3 of Floor 1 have such a spot (14 to 16 m from a post, in the next Hall or a Passage's far end) for most guards.
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const s = scene(seed);
      for (let q = 0; q < s.crowd.warbands!.mode.length && checked < 4; q++) {
        if (s.crowd.warbands!.mode[q] !== GUARD) continue;
        const ax = s.crowd.squads.x[q]!;
        const az = s.crowd.squads.z[q]!;
        const near = (p: { x: number; z: number }) => members(s.crowd, q).some((i) => Math.hypot(s.crowd.x[i]! - p.x, s.crowd.z[i]! - p.z) <= s.rules.sight);
        const hidden = spots(s, s.crowd, q, ax, az, 17).find((p) => near(p) && !seenNear(s, s.crowd, q, p.x, p.z));
        if (!hidden) continue;
        checked++;
        const { crowd } = advance(s, s.crowd, 1, 3 * PERIOD(s), () => [party(s, hidden.x, hidden.z)]);
        expect(crowd.warbands!.mode[q]).toBe(GUARD);
        expect([crowd.squads.x[q], crowd.squads.z[q]]).toEqual([ax, az]);
      }
    }
    expect(checked).toBeGreaterThan(1);
  });

  it('returns past the Leash and then guards at its post', () => {
    // A short Leash (5 m by walking) so the chase passes it within the Hall.
    const s = scene(1, 1, 1, { leash: 5 });
    const q = firstOf(s.crowd, GUARD);
    const post = s.homes.posts[s.crowd.warbands!.post[q]!]!;
    const at = inView(s, s.crowd, q, 11, 13);
    const fighters = () => [party(s, at.x, at.z)];
    // Chasing it, the Warband returns once its anchor is more than 5 m (walking) from the post; never before.
    const out = advance(s, s.crowd, 1, 15 * 60, fighters, (c) => {
      if (c.warbands!.mode[q] === RETURN) return true;
      // Still chasing, it is no more than a brain period's walk past the Leash.
      expect(fromHome(s, c, q)).toBeLessThan(5 + 2);
    });
    const w = out.crowd.warbands!;
    expect([w.mode[q], w.chased[q], w.seen[q]]).toEqual([RETURN, -1, -1]);
    expect(fromHome(s, out.crowd, q)).toBeGreaterThan(5);
    // The default Leash (45 m) holds it in the same chase.
    const long = scene(1);
    const kept = advance(long, long.crowd, 1, 15 * 60, fighters);
    expect(kept.crowd.warbands!.mode[q]).toBe(CHASE);
    // Deaf to the Fighter still in sight, it walks home and guards there, facing the post's facing.
    const back = advance(s, out.crowd, out.tick, 90 * 60, fighters, (c) => c.warbands!.mode[q] === GUARD);
    expect(back.crowd.warbands!.mode[q]).toBe(GUARD);
    expect(Math.hypot(back.crowd.squads.x[q]! - post.x, back.crowd.squads.z[q]! - post.z)).toBeLessThanOrEqual(s.rules.arrive);
    expect(back.crowd.squads.fall[q]).toBe(0);
    const faced = advance(s, back.crowd, back.tick, 5 * 60);
    expect(faced.crowd.squads.aim[q]).toBe(post.facing);
    expect(Math.abs(Math.sin((faced.crowd.squads.heading[q]! - post.facing) / 2))).toBeLessThan(1e-6);
  });

  it('gives up after forgetSeconds without seeing its quarry, and not before', () => {
    // Blind (sight 0.5 m) it never sees the Fighter it follows to within closeIn, so only the forgetting ends the chase.
    const s = scene(1, 1, 1, { sight: 0.5 });
    const q = firstOf(s.crowd, GUARD);
    const at = spots(s, s.crowd, q, s.crowd.squads.x[q]!, s.crowd.squads.z[q]!, 12).find((p) => Math.hypot(p.x - s.crowd.squads.x[q]!, p.z - s.crowd.squads.z[q]!) >= 8)!;
    expect(at).toBeDefined();
    const forget = secondsToTicks(s.rules.forgetSeconds);
    const period = PERIOD(s);
    const start = setWarband(s.crowd, q, { mode: CHASE, chased: 0, seen: 11 });
    let gaveUp = -1;
    const ran = advance(s, start, 1, forget + 3 * period, () => [party(s, at.x, at.z)], (c, tick) => {
      if (c.warbands!.mode[q] !== CHASE && gaveUp < 0) gaveUp = tick;
    });
    expect(ran.crowd.warbands!.chased[q]).toBe(-1);
    // Not before `seen + forget`, and at its first thought after.
    expect(gaveUp).toBeGreaterThanOrEqual(11 + forget);
    expect(gaveUp).toBeLessThan(11 + forget + period);
    expect(ran.crowd.warbands!.seen[q]).toBe(-1);
  });

  it('switches to the other party Fighter it sees when its own is gone, and returns when none is left', () => {
    const s = scene(1);
    const q = firstOf(s.crowd, GUARD);
    const near = inView(s, s.crowd, q, 6, 9);
    const far = spots(s, s.crowd, q, s.crowd.squads.x[q]!, s.crowd.squads.z[q]!, 14).find((p) => Math.hypot(p.x - s.crowd.squads.x[q]!, p.z - s.crowd.squads.z[q]!) >= 11 && seen(s, s.crowd, q, p.x, p.z))!;
    expect(far).toBeDefined();
    const both = [party(s, near.x, near.z, 2), party(s, far.x, far.z, 5)];
    // It chases the nearer (slot 2) first.
    let run = advance(s, s.crowd, 1, PERIOD(s), () => both);
    expect(run.crowd.warbands!.chased[q]).toBe(2);
    // Slot 2 falls (leaves `fighters`): it takes slot 5, in sight.
    run = advance(s, run.crowd, run.tick, PERIOD(s), () => [both[1]!]);
    expect(run.crowd.warbands!.mode[q]).toBe(CHASE);
    expect(run.crowd.warbands!.chased[q]).toBe(5);
    // Slot 5 falls too: no one to chase, it returns (to its post, which it is not far from).
    run = advance(s, run.crowd, run.tick, PERIOD(s), () => []);
    const w = run.crowd.warbands!;
    expect([w.chased[q], w.seen[q]]).toEqual([-1, -1]);
    expect(w.mode[q]).not.toBe(CHASE);
    // And a Fighter in play but out of its sight, while another is seen: it switches to the one it sees.
    const hidden = spots(s, s.crowd, q, s.crowd.squads.x[q]!, s.crowd.squads.z[q]!, 12).find((p) => Math.hypot(p.x - s.crowd.squads.x[q]!, p.z - s.crowd.squads.z[q]!) >= 6 && !seen(s, s.crowd, q, p.x, p.z))!;
    expect(hidden).toBeDefined();
    const switched = advance(s, setWarband(s.crowd, q, { mode: CHASE, chased: 7, seen: 1 }), 1, PERIOD(s), () => [party(s, hidden.x, hidden.z, 7), both[0]!]);
    expect(switched.crowd.warbands!.chased[q]).toBe(2);
  });

  it('a patrol walks its loop with no party: the leg advances at each point and the loop completes', () => {
    const s = scene(1);
    const q = firstOf(s.crowd, PATROL);
    expect(q).toBeGreaterThanOrEqual(0);
    const points = s.homes.patrols[s.crowd.warbands!.patrol[q]!]!;
    const first = s.crowd.warbands!.leg[q]!;
    const legs: number[] = [first];
    // Each leg's advance happens at the point it walked to.
    const ran = advance(s, s.crowd, 1, 400 * 60, () => [], (c) => {
      const leg = c.warbands!.leg[q]!;
      if (leg !== legs[legs.length - 1]) {
        const reached = points[legs[legs.length - 1]!]!;
        expect(Math.hypot(c.squads.x[q]! - reached.x, c.squads.z[q]! - reached.z)).toBeLessThanOrEqual(s.rules.arrive + 0.5);
        legs.push(leg);
      }
      return legs.length > points.length;
    });
    expect(ran.crowd.warbands!.mode[q]).toBe(PATROL);
    expect(legs.length).toBeGreaterThan(points.length);
    legs.forEach((leg, k) => expect(leg).toBe((first + k) % points.length));
  });

  it("a patrol's Chase ends with a Return to its nearest point by walking, and then it patrols", () => {
    const s = scene(1);
    const q = firstOf(s.crowd, PATROL);
    const w0 = s.crowd.warbands!;
    const points = s.homes.patrols[w0.patrol[q]!]!;
    // Two points on from its leg: the anchor stands in that Hall by its point (the nearest by walking).
    const target = (w0.leg[q]! + 1) % points.length;
    const at = points[target]!;
    const away = { x: at.x + 4, z: at.z };
    const moved = setWarband(teleport(s, s.crowd, q, away.x, away.z), q, { mode: CHASE, chased: 0, seen: 1 });
    // Its Fighter is gone at once: it returns, its leg becoming the nearest point by walking.
    const run = advance(s, moved, 1, PERIOD(s));
    const w = run.crowd.warbands!;
    expect([w.mode[q], w.chased[q], w.seen[q]]).toEqual([RETURN, -1, -1]);
    const walks = points.map((p) => walkDistance(oneField(s.map.fields, fieldToward(s.map.fields, p.x, p.z, groundOf(s.battle, s.field, p.x, p.z, 0))), away.x, away.z, groundOf(s.battle, s.field, away.x, away.z, 0)));
    expect(w.leg[q]).toBe(walks.indexOf(Math.min(...walks)));
    expect(w.leg[q]).toBe(target);
    const back = advance(s, run.crowd, run.tick, 60 * 60, () => [], (c) => c.warbands!.mode[q] === PATROL);
    expect(back.crowd.warbands!.mode[q]).toBe(PATROL);
    expect(back.crowd.warbands!.leg[q]).toBe(target);
    // On the loop again: its leg moves on.
    const on = advance(s, back.crowd, back.tick, 30 * 60, () => [], (c) => c.warbands!.leg[q] !== target);
    expect(on.crowd.warbands!.leg[q]).toBe((target + 1) % points.length);
  });
});

describe('regrouping', { timeout: TIMEOUT }, () => {
  it("a patrol walks through a guard's file standing in its way: gen:greybox:4242 Floor 3, patrol 10 and the guard of post 8 in the doorway", () => {
    // The loop's second point is the guard's post, and the guard's single file reaches into the 3 m doorway of the Passage the patrol is bound for.
    // Soldiers of two Warbands of one Team used to push each other apart there, and the patrol's Soldiers stood behind the guard's for ever.
    const s = scene(4242, 3);
    const q = 10;
    const guard = 6;
    const w = s.crowd.warbands!;
    expect([w.patrol[q], w.post[guard]]).toEqual([0, 8]);
    const mine = members(s.crowd, q);
    const theirs = members(s.crowd, guard);
    const surfaceAt = (z: number) => groundOf(s.battle, s.field, -75, z, 0);
    const x = s.crowd.x.slice();
    const z = s.crowd.z.slice();
    const surface = s.crowd.surface.slice();
    mine.forEach((i, k) => ([x[i], z[i], surface[i]] = [-75, -6.2 - 0.9 * k, 29]));
    theirs.forEach((i, k) => ([x[i], z[i], surface[i]] = [-75, -5.3 + 0.9 * k, surfaceAt(-5.3 + 0.9 * k)]));
    const place = (a: readonly number[], at: Record<number, number>) => a.map((v, k) => at[k] ?? v);
    const crowd: CrowdState = {
      ...s.crowd,
      x,
      z,
      surface,
      squads: {
        ...s.crowd.squads,
        x: place(s.crowd.squads.x, { [q]: -75, [guard]: -75 }),
        z: place(s.crowd.squads.z, { [q]: -1.4, [guard]: -8.8 }),
        surface: place(s.crowd.squads.surface, { [q]: surfaceAt(-1.4), [guard]: 29 }),
        heading: place(s.crowd.squads.heading, { [q]: 0, [guard]: Math.PI }),
      },
      warbands: { ...w, leg: w.leg.map((l, k) => (k === q ? 2 : l)) },
    };
    const run = advance(s, crowd, 1, 30 * 60, () => [], (c) => c.warbands!.leg[q] !== 2);
    expect(run.crowd.warbands!.leg[q]).toBe(3);
    expect(run.tick).toBeLessThan(1 + 20 * 60);
  });

  it('a Warband whose anchor is 8 m from its Soldiers (round a Wall) regroups onto its nearest Soldier at its next brain step, and then walks on to its next patrol point', () => {
    const s = scene(1);
    const q = firstOf(s.crowd, PATROL);
    const ax = s.crowd.squads.x[q]!;
    const az = s.crowd.squads.z[q]!;
    // A spot 8 to 10 m from the anchor, preferably out of sight of it (round a doorway post), standing on the floor.
    const around = spots(s, s.crowd, q, ax, az, 10).filter((p) => Math.hypot(p.x - ax, p.z - az) >= 8);
    const hidden = around.find((p) => !inSight(s.map.fields, ax, az, p.x, p.z, 0, 0, 0)) ?? around[0]!;
    const on = groundOf(s.battle, s.field, hidden.x, hidden.z, 0);
    const edited = { ...s.crowd, squads: { ...s.crowd.squads, x: s.crowd.squads.x.map((v, k) => (k === q ? hidden.x : v)), z: s.crowd.squads.z.map((v, k) => (k === q ? hidden.z : v)), surface: s.crowd.squads.surface.map((v, k) => (k === q ? on : v)) } };
    const soldiers = members(edited, q);
    const nearest = (c: CrowdState) => Math.min(...soldiers.map((i) => Math.hypot(c.x[i]! - c.squads.x[q]!, c.z[i]! - c.squads.z[q]!)));
    expect(nearest(edited)).toBeGreaterThan(s.battle.squad.lag);
    // Its next brain step (within PERIOD Ticks): the anchor stands on a Soldier's spot, and walked nowhere this step.
    let regrouped = -1;
    const run = advance(s, edited, 1, PERIOD(s), () => [], (c, tick) => {
      if (nearest(c) < 1.5 && regrouped < 0) regrouped = tick;
    });
    expect(regrouped).toBeGreaterThan(0);
    expect(nearest(run.crowd)).toBeLessThan(s.battle.squad.lag);
    // Then it walks its loop again: the leg advances within a minute and a half.
    const leg = run.crowd.warbands!.leg[q]!;
    const on2 = advance(s, run.crowd, run.tick, 90 * 60, () => [], (c) => c.warbands!.leg[q] !== leg);
    expect(on2.crowd.warbands!.leg[q]).not.toBe(leg);
    expect(on2.crowd.warbands!.mode[q]).toBe(PATROL);
  });
});

describe('morale and wiping', { timeout: TIMEOUT }, () => {
  it('a chasing Warband killed below the threshold returns loose, falling back, and then guards', () => {
    const s = scene(1, 1, 1, {}, bigWarbands);
    const q = firstOf(s.crowd, GUARD);
    const at = inView(s, s.crowd, q, 10, 13);
    const fighters = () => [party(s, at.x, at.z)];
    let run = advance(s, s.crowd, 1, 4 * 60, fighters);
    expect(run.crowd.warbands!.mode[q]).toBe(CHASE);
    // All but one fall: below moraleThreshold of what it deployed with.
    const ms = members(run.crowd, q);
    let crowd = run.crowd;
    for (const i of ms.slice(1)) crowd = kill(crowd, i);
    expect(1).toBeLessThan(s.battle.squad.moraleThreshold * s.crowd.warbands!.size[q]!);
    let loose = false;
    run = advance(s, crowd, run.tick, PERIOD(s), fighters, (c) => {
      loose ||= c.squads.shape[q] === LOOSE && c.squads.fall[q] === 1 && c.warbands!.mode[q] === RETURN;
    });
    expect(loose).toBe(true);
    expect(run.crowd.warbands!.chased[q]).toBe(-1);
    const back = advance(s, run.crowd, run.tick, 120 * 60, fighters, (c) => c.warbands!.mode[q] === GUARD);
    expect(back.crowd.warbands!.mode[q]).toBe(GUARD);
    expect(back.crowd.squads.fall[q]).toBe(0);
    expect(back.crowd.squads.shape[q]).toBe(COLUMN);
    // Broken, it does not chase again though the party stands in sight of it.
    const after = advance(s, back.crowd, back.tick, 4 * PERIOD(s), () => [party(s, back.crowd.squads.x[q]! + 0, back.crowd.squads.z[q]! + 0, 0)]);
    expect(after.crowd.warbands!.mode[q]).toBe(GUARD);
  });

  it('a broken Warband does not chase what it sees', () => {
    const s = scene(1, 1, 1, {}, bigWarbands);
    const q = firstOf(s.crowd, GUARD);
    const at = inView(s, s.crowd, q, 6, 9);
    let crowd = s.crowd;
    for (const i of members(crowd, q).slice(1)) crowd = kill(crowd, i);
    const run = advance(s, crowd, 1, 4 * PERIOD(s), () => [party(s, at.x, at.z)]);
    expect(run.crowd.warbands!.mode[q]).toBe(GUARD);
    expect(run.crowd.warbands!.chased[q]).toBe(-1);
  });

  it('a broken patrol turns guard at its point', () => {
    const s = scene(1, 1, 2);
    const q = firstOf(s.crowd, PATROL);
    let crowd = s.crowd;
    for (const i of members(crowd, q).slice(1)) crowd = kill(crowd, i);
    const run = advance(s, crowd, 1, 2 * PERIOD(s));
    expect(run.crowd.warbands!.mode[q]).toBe(GUARD);
    expect(run.crowd.warbands!.patrol[q]).toBeGreaterThanOrEqual(0);
    // It holds the point it was walking to: it goes there and stands.
    const point = s.homes.patrols[run.crowd.warbands!.patrol[q]!]![run.crowd.warbands!.leg[q]!]!;
    const there = advance(s, run.crowd, run.tick, 60 * 60, () => [], (c) => Math.hypot(c.squads.x[q]! - point.x, c.squads.z[q]! - point.z) <= s.rules.arrive);
    expect(Math.hypot(there.crowd.squads.x[q]! - point.x, there.crowd.squads.z[q]! - point.z)).toBeLessThanOrEqual(s.rules.arrive);
    expect(there.crowd.warbands!.mode[q]).toBe(GUARD);
  });

  it('a wiped Warband stays dead: living 0, its anchor still, nothing respawns over 60 s', () => {
    const s = scene(1);
    const q = firstOf(s.crowd, GUARD);
    let crowd = s.crowd;
    for (const i of members(crowd, q)) crowd = kill(crowd, i);
    const at = { x: crowd.squads.x[q]!, z: crowd.squads.z[q]! };
    // The party walks right up to it.
    const near = inView(s, s.crowd, q, 5, 7);
    const run = advance(s, crowd, 1, 60 * 60, () => [party(s, near.x, near.z)]);
    expect(run.crowd.squads.living[q]).toBe(0);
    expect([run.crowd.squads.x[q], run.crowd.squads.z[q], run.crowd.squads.speed[q]]).toEqual([at.x, at.z, 0]);
    for (const i of members(run.crowd, q)) expect(run.crowd.alive[i]).toBe(0);
    expect(run.crowd.warbands!.mode[q]).toBe(GUARD);
    // Its lead is null; the others' are fields.
    const step = stepWarbands(run.crowd, run.tick, s.battle, s.map, [], s.homes, s.rules);
    expect(step.lead!(q)).toBeNull();
    expect(crowd.squads.team.map((_, k) => step.lead!(k)).filter((l) => l !== null)).toHaveLength(crowd.squads.team.length - 1);
    expect(step.spawned).toEqual([]);
  });
});

describe('the brain as a SquadBrain', { timeout: TIMEOUT }, () => {
  it('thinks Warband q on the Ticks where q and the Tick agree modulo brainTicks, and every anchor keeps walking between', () => {
    const s = scene(1);
    const q = firstOf(s.crowd, GUARD);
    const at = inView(s, s.crowd, q, 8, 12);
    const ticks = brainTicks(s.battle);
    const due = (q % ticks) + 2 * ticks;
    // Off its Tick it does not see the Fighter; on it, it does.
    const before = stepCrowd(s.crowd, due - 1, s.battle, [party(s, at.x, at.z)], s.map, s.brain);
    expect(before.warbands!.mode[q]).toBe(GUARD);
    const on = stepCrowd(s.crowd, due, s.battle, [party(s, at.x, at.z)], s.map, s.brain);
    expect(on.warbands!.mode[q]).toBe(CHASE);
    // The next Tick it keeps its speed and aim, walking (an anchor walks every Tick).
    const next = stepCrowd(on, due + 1, s.battle, [party(s, at.x, at.z)], s.map, s.brain);
    expect(next.squads.speed[q]).toBe(on.squads.speed[q]);
    expect(Math.hypot(next.squads.x[q]! - on.squads.x[q]!, next.squads.z[q]! - on.squads.z[q]!)).toBeGreaterThan(0);
  });

  it("a walled-off Soldier of a Squad walks round by the Squad's lead field", () => {
    // Seed 2 Floor 1: for most posts there is a spot 10 to 16 m away behind a Hall wall, 14 m or more to walk.
    const s = scene(2, 1, 1, {}, bigWarbands);
    let q = -1;
    let at = { x: 0, z: 0 };
    for (let k = 0; k < s.crowd.warbands!.mode.length && q < 0; k++) {
      if (s.crowd.warbands!.mode[k] !== GUARD) continue;
      const ax = s.crowd.squads.x[k]!;
      const az = s.crowd.squads.z[k]!;
      const found = spots(s, s.crowd, k, ax, az, 16).find((p) => Math.hypot(p.x - ax, p.z - az) >= 10 && !seenNear(s, s.crowd, k, p.x, p.z) && fromHome(s, s.crowd, k, p.x, p.z) >= 14);
      if (found) [q, at] = [k, found];
    }
    expect(q).toBeGreaterThanOrEqual(0);
    const home = homeField(s, s.crowd, q);
    const i = members(s.crowd, q)[0]!;
    const crowd: CrowdState = { ...s.crowd, x: s.crowd.x.map((v, k) => (k === i ? at.x : v)), z: s.crowd.z.map((v, k) => (k === i ? at.z : v)), surface: s.crowd.surface.map((v, k) => (k === i ? groundOf(s.battle, s.field, at.x, at.z, 0) : v)) };
    const start = walkDistance(home, crowd.x[i]!, crowd.z[i]!, crowd.surface[i]!);
    const left = (c: CrowdState, field = home) => walkDistance(field, c.x[i]!, c.z[i]!, c.surface[i]!);
    const run = advance(s, crowd, 1, 10 * 60);
    expect(left(run.crowd)).toBeLessThan(start - 4);
    // It descends the field the brain gives it: lead another Squad-wide field (a spot further from home) and it walks down that one instead.
    const toward = (p: { x: number; z: number }) => oneField(s.map.fields, fieldToward(s.map.fields, p.x, p.z, groundOf(s.battle, s.field, p.x, p.z, 0)));
    const elsewhere = spots(s, crowd, q, at.x, at.z, 20).find((p) => fromHome(s, crowd, q, p.x, p.z) > start + 8 && Math.hypot(p.x - at.x, p.z - at.z) > 8 && left(crowd, toward(p)) < 60)!;
    expect(elsewhere).toBeDefined();
    const other = toward(elsewhere);
    const led = advance({ ...s, brain: (...args) => ({ ...s.brain(...args), lead: (k: number) => (k === q ? other : null) }) }, crowd, 1, 10 * 60);
    expect(left(led.crowd, other)).toBeLessThan(left(crowd, other) - 4);
    expect(left(led.crowd)).toBeGreaterThan(left(run.crowd) + 4);
  });
});
