import { describe, expect, it } from 'vitest';
import { controllerIntents, type Controller } from '../controllers/controller';
import { createDelverPilot } from '../controllers/delverPilot';
import { lineupAis, type Lineup } from '../controllers/lineup';
import { loadTuningData, type TuningData } from '../tuning';
import { groundOf } from './battlefield';
import { walkDistance, walkField, type CrowdState } from './crowd';
import { arenaTuning, deployWarbands, floorOf, warbandHomes } from './delver';
import { battleMapOf, clearanceAt, inSight } from './destinations';
import { floorDuel } from './delverRun';
import { runSeed } from './dungeon';
import { hashValue } from './hash';
import { IDLE_INTENT, type Intent } from './intent';
import { createMatch, doorTicksNeeded, stepMatch, takeOverFighter, type MatchState } from './match';
import { restore, snapshot } from './snapshot';
import type { FighterState } from './state';
import { CHASE, GUARD, PATROL } from './warband';

const base = loadTuningData();
/** Three Floors, one a tier (so Floor 1 is tier 1, Floor 2 tier 2, Floor 3 tier 3), with Warbands at the Tuning Data's own fill. */
const tuning: TuningData = { ...base, delver: { ...base.delver, tiers: 3, floorsPerTier: 1 } };
const ARENA = 'gen:greybox:4242';
const SEED = runSeed(ARENA);
const { attackSlots } = tuning.delver;
const { promote, demote } = tuning.battle.bubble;
const TIMEOUT = 120_000;

/** A Delver Run of `humans` Players (Team 0, the first `humans` slots), on `t`. */
const start = (humans = 1, t: TuningData = tuning): MatchState =>
  createMatch(t, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: Array<number>(humans).fill(0), humans, players: Array.from({ length: humans }, (_, i) => i) });

const idle = (m: MatchState): Intent[] => m.duel.fighters.map(() => IDLE_INTENT);
/** `m` stepped once with every Fighter idle. */
const tick = (m: MatchState): MatchState => stepMatch(m, idle(m), tuning);
const planOf = (m: MatchState) => floorOf(tuning, m.arena)!.plan;
/** Fighter `i` stood at (x, z) on the ground. */
const put = (m: MatchState, i: number, x: number, z: number): MatchState => ({ ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === i ? { ...f, position: { x, z }, y: 0 } : f)) } });
const edit = (m: MatchState, f: (c: CrowdState) => CrowdState): MatchState => ({ ...m, duel: { ...m.duel, crowd: f(m.duel.crowd!) } });
/** The living Soldiers (Crowd indices) of Warband `q`. */
const members = (c: CrowdState, q: number): number[] => c.squad.flatMap((s, i) => (s === q && c.alive[i] ? [i] : []));
/** The Warbands in `mode`, by index. */
const warbandsIn = (c: CrowdState, mode: number): number[] => c.warbands!.mode.flatMap((x, q) => (x === mode ? [q] : []));
/** The Pool slots bound to a Soldier. */
const bound = (m: MatchState): number[] => m.duel.fighters.flatMap((f, k) => (f.soldier ? [k] : []));
/** A guard's post (its Hall's centre). */
const postOf = (m: MatchState, q: number) => warbandHomes(planOf(m)).posts[m.duel.crowd!.warbands!.post[q]!]!;
const maxPromoted = (m: MatchState, ticks: number, role?: string): { m: MatchState; most: number } => {
  let most = 0;
  for (let k = 0; k < ticks; k++) {
    m = tick(m);
    most = Math.max(most, m.duel.fighters.filter((f) => f.soldier && (role === undefined || f.soldier.role === role)).length);
  }
  return { m, most };
};

describe('a Floor with Warbands', { timeout: TIMEOUT }, () => {
  it('has its Warbands at their posts and patrols, a guard at each filled post and a patrol on each filled loop', () => {
    const m = start();
    const c = m.duel.crowd!;
    const plan = planOf(m);
    const homes = warbandHomes(plan);
    const w = c.warbands!;
    expect(w.mode.length).toBe(Math.ceil((plan.markers.posts.length * tuning.delver.postFill) / 100) + Math.ceil((plan.markers.patrols.length * tuning.delver.patrolFill) / 100));
    expect(warbandsIn(c, GUARD).length).toBeGreaterThan(0);
    expect(warbandsIn(c, PATROL).length).toBeGreaterThan(0);
    for (let q = 0; q < w.mode.length; q++) {
      const home = w.mode[q] === GUARD ? homes.posts[w.post[q]!]! : homes.patrols[w.patrol[q]!]![(w.leg[q]! - 1 + homes.patrols[w.patrol[q]!]!.length) % homes.patrols[w.patrol[q]!]!.length]!;
      const them = members(c, q);
      expect(them.length).toBe(w.size[q]);
      for (const i of them) expect(Math.hypot(c.x[i]! - home.x, c.z[i]! - home.z)).toBeLessThan(16);
    }
  });

  it('sizes its Warbands by the humans (1 and 3), each held to the Squad size', () => {
    const one = start(1).duel.crowd!;
    const three = start(3).duel.crowd!;
    expect(three.warbands!.mode).toEqual(one.warbands!.mode);
    let bigger = 0;
    for (let q = 0; q < one.warbands!.size.length; q++) {
      expect(three.warbands!.size[q]!).toBeGreaterThanOrEqual(one.warbands!.size[q]!);
      expect(three.warbands!.size[q]!).toBeLessThanOrEqual(tuning.battle.squad.size);
      expect(members(three, q)).toHaveLength(three.warbands!.size[q]!);
      if (three.warbands!.size[q]! > one.warbands!.size[q]!) bigger++;
    }
    expect(bigger).toBeGreaterThan(0);
  });

  it('gives its Soldiers HP by tier alone: a Floor of tier 1 against tier 2 and 3', () => {
    const m = start();
    const hpOf = (floor: number): number[] => {
      const crowd = floorDuel(tuning, m.config, floor, null, m.duel.rng).crowd!;
      const tier = Math.ceil(floor / tuning.delver.floorsPerTier);
      const scales = tuning.delver.warbands[tier - 1]!.guard.concat(tuning.delver.warbands[tier - 1]!.patrol).map((t) => t.hpScale);
      expect(crowd.warbands!.mode.length).toBeGreaterThan(0);
      return crowd.maxHp!.map((max, i) => {
        expect(crowd.hp[i]).toBe(max);
        const ratio = max / (tuning.battle.troops[crowd.troop[i]!]!.hp * tuning.delver.tierHp[tier - 1]!);
        expect(scales.some((s) => Math.abs(s - ratio) < 1e-9)).toBe(true);
        return max / tuning.battle.troops[crowd.troop[i]!]!.hp;
      });
    };
    const [one, two, three] = [1, 2, 3].map(hpOf);
    expect(Math.max(...one!)).toBeLessThan(Math.max(...two!));
    expect(Math.max(...two!)).toBeLessThan(Math.max(...three!));
    expect(tuning.delver.tierHp[1]).toBeGreaterThan(tuning.delver.tierHp[0]!);
  });

  it('does not hurt a full Fighter by an unpromoted Soldier: the Player among a Warband for 600 Ticks (no Promotion possible)', () => {
    const none: TuningData = { ...tuning, battle: { ...tuning.battle, bubble: { ...tuning.battle.bubble, promote: 0 } } };
    let m = start(1, none);
    const q = warbandsIn(m.duel.crowd!, GUARD)[0]!;
    const home = warbandHomes(floorOf(none, m.arena)!.plan).posts[m.duel.crowd!.warbands!.post[q]!]!;
    m = put(m, 0, home.x, home.z);
    const full = m.duel.fighters[0]!.hp;
    let chased = false;
    for (let k = 0; k < 600; k++) {
      m = stepMatch(m, idle(m), none);
      expect(m.duel.fighters[0]!.hp).toBe(full);
      expect(bound(m)).toEqual([]);
      if (m.duel.crowd!.warbands!.mode[q] === CHASE) chased = true;
    }
    expect(chased).toBe(true);
    expect(m.status.status).toBe('InProgress');
  });

  it('promotes the Soldiers of a guarded Hall the Player walks into, at most attackSlots[0] holding Attack Slots solo and 3 each with two', () => {
    const solo = (() => {
      const m = start(1);
      const q = warbandsIn(m.duel.crowd!, GUARD).sort((a, b) => members(m.duel.crowd!, b).length - members(m.duel.crowd!, a).length)[0]!;
      const home = postOf(m, q);
      return { m: put(m, 0, home.x, home.z), q };
    })();
    const soloRun = maxPromoted(solo.m, 300, 'Attack');
    expect(soloRun.most).toBeGreaterThan(0);
    expect(soloRun.most).toBeLessThanOrEqual(attackSlots[0]!);

    const pair = start(2);
    const q = warbandsIn(pair.duel.crowd!, GUARD).sort((a, b) => members(pair.duel.crowd!, b).length - members(pair.duel.crowd!, a).length)[0]!;
    const home = postOf(pair, q);
    const two = maxPromoted(put(put(pair, 0, home.x, home.z), 1, home.x + 1, home.z + 1), 300, 'Attack');
    expect(two.most).toBeGreaterThan(0);
    expect(two.most).toBeLessThanOrEqual(2 * attackSlots[1]!);
    // Every promoted Soldier is of the Warband the party walked into (or another beside it): a bound Fighter is a Team 1 enemy.
    for (const k of bound(two.m)) expect(two.m.duel.fighters[k]!.team).toBe(1);
  });

  it('promotes nobody through a Wall: a Soldier within promote flat of the Player, a long walk away round a Wall', () => {
    const m0 = start();
    const t = arenaTuning(tuning, m0.arena);
    const map = battleMapOf(t.battle, m0.arena);
    const plan = planOf(m0);
    const spawn = plan.markers.spawns[0]!;
    const fromSpawn = walkField(t.battle, map, spawn.x, spawn.z, 0);
    // A spot P the party can walk to, and a spot S within promote flat of it, out of its sight, a long walk from it.
    let found: { p: { x: number; z: number }; s: { x: number; z: number } } | null = null;
    const xs = plan.halls.map((h) => h.rect);
    search: for (let px = Math.min(...xs.map((r) => r.x0)); px <= Math.max(...xs.map((r) => r.x1)); px += 2)
      for (let pz = Math.min(...xs.map((r) => r.z0)); pz <= Math.max(...xs.map((r) => r.z1)); pz += 2) {
        const on = groundOf(t.battle, map.field, px, pz, 0);
        if (on < 0 || clearanceAt(map.fields, px, pz, on) < 1 || !Number.isFinite(walkDistance(fromSpawn, px, pz, on))) continue;
        const from = walkField(t.battle, map, px, pz, 0);
        for (let dx = -9; dx <= 9; dx++)
          for (let dz = -9; dz <= 9; dz++) {
            const sx = px + dx;
            const sz = pz + dz;
            const at = groundOf(t.battle, map.field, sx, sz, 0);
            if (at < 0 || Math.hypot(dx, dz) > promote - 1 || clearanceAt(map.fields, sx, sz, at) < 1 || !Number.isFinite(walkDistance(fromSpawn, sx, sz, at))) continue;
            if (walkDistance(from, sx, sz, at) >= promote + 6 && !inSight(map.fields, sx, sz, px, pz, 0, 0, 0)) {
              found = { p: { x: px, z: pz }, s: { x: sx, z: sz } };
              break search;
            }
          }
      }
    expect(found).not.toBeNull();
    const { p, s } = found!;
    expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThanOrEqual(promote);
    // One Soldier of the first guard stands at S, the rest of its Warband fallen, so only that Soldier could be promoted (and a lone remnant never chases).
    const c = m0.duel.crowd!;
    const q = warbandsIn(c, GUARD)[0]!;
    const them = members(c, q);
    const ground = groundOf(t.battle, map.field, s.x, s.z, 0);
    let m = edit(m0, (cc) => ({
      ...cc,
      x: cc.x.map((x, i) => (i === them[0] ? s.x : x)),
      z: cc.z.map((z, i) => (i === them[0] ? s.z : z)),
      surface: cc.surface.map((v, i) => (i === them[0] ? ground : v)),
      alive: cc.alive.map((a, i) => (them.includes(i) && i !== them[0] ? 0 : a)),
      hp: cc.hp.map((h, i) => (them.includes(i) && i !== them[0] ? 0 : h)),
    }));
    m = put(m, 0, p.x, p.z);
    const toPlayer = walkField(t.battle, map, p.x, p.z, 0);
    for (let k = 0; k < 150; k++) {
      m = stepMatch(m, idle(m), tuning);
      // Promoted only by walking: a bound Fighter of that Warband is within promote of the Player by the walk, never by the ground across.
      for (const f of m.duel.fighters) {
        if (f.soldier?.index !== them[0]) continue;
        expect(walkDistance(toPlayer, f.position.x, f.position.z, groundOf(t.battle, map.field, f.position.x, f.position.z, f.y))).toBeLessThanOrEqual(promote + 1);
      }
      if (k < 20) expect(bound(m)).toEqual([]);
    }
    expect(m.status.status).toBe('InProgress');
  });

  it('demotes the promoted when the Player is far away, their HP written back to the Crowd', () => {
    let m = start();
    const plan = planOf(m);
    const t = arenaTuning(tuning, m.arena);
    const map = battleMapOf(t.battle, m.arena);
    const spawn = plan.markers.spawns[0]!;
    const fromSpawn = walkField(t.battle, map, spawn.x, spawn.z, 0);
    // The guarded Hall furthest by walking from the Entrance, so the spawn is past `demote` from all of it.
    const c0 = m.duel.crowd!;
    const q = warbandsIn(c0, GUARD).sort((a, b) => walkDistance(fromSpawn, c0.x[members(c0, b)[0]!]!, c0.z[members(c0, b)[0]!]!, 0) - walkDistance(fromSpawn, c0.x[members(c0, a)[0]!]!, c0.z[members(c0, a)[0]!]!, 0))[0]!;
    const i0 = members(c0, q)[0]!;
    expect(walkDistance(fromSpawn, c0.x[i0]!, c0.z[i0]!, c0.surface[i0]!)).toBeGreaterThan(demote + 2);
    const home = postOf(m, q);
    m = put(m, 0, home.x, home.z);
    for (let k = 0; k < 120 && bound(m).length === 0; k++) m = tick(m);
    const was = bound(m);
    expect(was.length).toBeGreaterThan(0);
    const soldiers = new Map(was.map((k) => [k, m.duel.fighters[k]!.soldier!.index]));
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k): FighterState => (soldiers.has(k) ? { ...f, hp: 17 } : f)) } };
    m = put(m, 0, spawn.x, spawn.z);
    for (let k = 0; k < 600 && bound(m).length > 0; k++) m = tick(m);
    expect(bound(m)).toEqual([]);
    for (const [k, i] of soldiers) {
      expect(m.duel.fighters[k]!.soldier).toBeUndefined();
      expect(m.duel.crowd!.slot[i]).toBe(-1);
      expect(m.duel.crowd!.alive[i]).toBe(1);
      expect(m.duel.crowd!.hp[i]).toBeCloseTo(17, 5);
    }
  });

  it('keeps a wiped Warband dead for the Floor, and deals the next Floor its own Warbands', () => {
    let m = start();
    const q = warbandsIn(m.duel.crowd!, GUARD)[0]!;
    const dead = members(m.duel.crowd!, q);
    m = edit(m, (c) => ({ ...c, alive: c.alive.map((a, i) => (dead.includes(i) ? 0 : a)), hp: c.hp.map((h, i) => (dead.includes(i) ? 0 : h)) }));
    const wipeTicks = 60 * 60;
    for (let k = 0; k < wipeTicks; k++) {
      m = tick(m);
      if (k % 600 === 0) for (const i of dead) expect(m.duel.crowd!.alive[i]).toBe(0);
    }
    for (const i of dead) expect(m.duel.crowd!.alive[i]).toBe(0);
    expect(m.duel.crowd!.squads.living[q]).toBe(0);
    expect(m.status.status).toBe('InProgress');
    // The next Floor: its own Crowd, every Warband alive.
    m = { ...m, nextDuelTick: m.tick + 1 };
    m = tick(m);
    expect(m.delver!.floor).toBe(2);
    const t2 = arenaTuning(tuning, m.arena);
    const built = floorOf(tuning, m.arena)!;
    expect(m.duel.crowd).toEqual(deployWarbands(t2, built.plan, built.field, SEED, 2, 1));
    expect(m.duel.crowd!.alive.every((a) => a === 1)).toBe(true);
  });

  it('heals at a fire with a Warband chasing nearby', () => {
    let m = start();
    const fire = planOf(m).markers.fires[0]!;
    const q = warbandsIn(m.duel.crowd!, PATROL)[0]!;
    const them = members(m.duel.crowd!, q);
    const t = arenaTuning(tuning, m.arena);
    const map = battleMapOf(t.battle, m.arena);
    const spots = [4, -4, 5, -5, 3, -3].flatMap((dx) => [0, 3, -3].map((dz) => ({ x: fire.x + dx, z: fire.z + dz }))).filter((p) => {
      const on = groundOf(t.battle, map.field, p.x, p.z, 0);
      return on >= 0 && clearanceAt(map.fields, p.x, p.z, on) >= 0.5;
    });
    expect(spots.length).toBeGreaterThanOrEqual(them.length);
    m = edit(m, (c) => ({
      ...c,
      x: c.x.map((x, i) => (them.includes(i) ? spots[them.indexOf(i)]!.x : x)),
      z: c.z.map((z, i) => (them.includes(i) ? spots[them.indexOf(i)]!.z : z)),
      surface: c.surface.map((s, i) => (them.includes(i) ? groundOf(t.battle, map.field, spots[them.indexOf(i)]!.x, spots[them.indexOf(i)]!.z, 0) : s)),
    }));
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, position: { x: fire.x, z: fire.z }, y: 0, hp: f.maxHp / 2 } : f)) } };
    let chased = false;
    let rested = false;
    for (let k = 0; k < 120; k++) {
      m = tick(m);
      if (m.duel.crowd!.warbands!.mode[q] === CHASE) chased = true;
      if (m.events.some((e) => e.type === 'Rested')) rested = true;
    }
    expect(chased).toBe(true);
    expect(rested).toBe(true);
    expect(m.duel.fighters[0]!.hp).toBeGreaterThan(m.duel.fighters[0]!.maxHp / 2);
    expect(m.delver!.restUsed[0]!.healed).toEqual([0]);
  });

  it('completes the Stairs dwell while promoted enemies stand by', () => {
    let m = start();
    const { zone } = planOf(m).markers.stairs;
    const cx = (zone.x0 + zone.x1) / 2;
    const cz = (zone.z0 + zone.z1) / 2;
    const q = warbandsIn(m.duel.crowd!, GUARD)[0]!;
    const them = members(m.duel.crowd!, q);
    const t = arenaTuning(tuning, m.arena);
    const map = battleMapOf(t.battle, m.arena);
    const at = (i: number) => ({ x: cx + 3 + (i % 3) * 0.8, z: cz + 3 + Math.floor(i / 3) * 0.8 });
    expect(groundOf(t.battle, map.field, at(0).x, at(0).z, 0)).toBeGreaterThanOrEqual(0);
    m = edit(m, (c) => ({
      ...c,
      x: c.x.map((x, i) => (them.includes(i) ? at(them.indexOf(i)).x : x)),
      z: c.z.map((z, i) => (them.includes(i) ? at(them.indexOf(i)).z : z)),
      surface: c.surface.map((s, i) => (them.includes(i) ? groundOf(t.battle, map.field, at(them.indexOf(i)).x, at(them.indexOf(i)).z, 0) : s)),
    }));
    m = put(m, 0, cx, cz);
    let sawPromoted = false;
    for (let k = 0; k < doorTicksNeeded(tuning) + 5 && m.delver!.phase === 'Exploring'; k++) {
      m = tick(m);
      if (bound(m).length > 0) sawPromoted = true;
    }
    expect(sawPromoted).toBe(true);
    expect(m.delver!.phase).toBe('Descending');
    expect(m.events.some((e) => e.type === 'StairsTaken') || m.score[0] === 1).toBe(true);
  });

  it('is a Defeat when promoted enemies wipe the party', () => {
    let m = start();
    const LINEUP: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, ...Array.from({ length: 4 }, () => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } }))];
    const idlePlayer: Controller = { intent: () => IDLE_INTENT };
    const cs = lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA, delver: true }).map((c) => c ?? idlePlayer);
    const q = warbandsIn(m.duel.crowd!, GUARD)[0]!;
    const home = postOf(m, q);
    m = put(m, 0, home.x, home.z);
    m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: 3 } : f)) } };
    const ended: string[] = [];
    for (let k = 0; k < 20 * 60 && m.status.status === 'InProgress'; k++) {
      m = stepMatch(m, controllerIntents(m.duel, cs), tuning);
      for (const e of m.events) if (e.type === 'RunEnd') ended.push(`${e.winner}`);
    }
    expect(m.status).toMatchObject({ status: 'Over', winner: 1 });
    expect(ended).toEqual(['1']);
    expect(m.duel.fighters[0]!.death).toBeDefined();
  });

  it('is deterministic across a Floor change with Warbands, and re-simulates from a snapshot taken before a Promotion', () => {
    const LINEUP: Lineup = [{ team: 0, pilot: { kind: 'Player', player: 0 } }, ...Array.from({ length: 4 }, () => ({ team: 1, pilot: { kind: 'AI' as const, difficulty: 'Floor' } }))];
    const FLOOR_CHANGE = 400;
    const TICKS = 700;
    const initial = (): MatchState => {
      let m = start();
      const q = warbandsIn(m.duel.crowd!, GUARD)[0]!;
      const home = postOf(m, q);
      m = put(m, 0, home.x, home.z);
      // A Fighter that outlasts the fight, and the Floor changing at a fixed Tick: no Descent needed.
      return { ...m, nextDuelTick: FLOOR_CHANGE, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? { ...f, hp: 100_000, maxHp: 100_000 } : f)) } };
    };
    const states: MatchState[] = [];
    const intents: Intent[][] = [];
    {
      let m = initial();
      const cs: Controller[] = lineupAis(tuning, LINEUP, 'Gauntlet', { seed: 7, arena: ARENA, delver: true }).map((c) => c ?? createDelverPilot(tuning));
      states.push(m);
      for (let k = 0; k < TICKS; k++) {
        const these = controllerIntents(m.duel, cs);
        intents.push(these);
        m = stepMatch(m, these, tuning);
        states.push(m);
      }
    }
    expect(states.some((s) => bound(s).length > 0)).toBe(true);
    expect(states.at(-1)!.delver!.floor).toBe(2);
    expect(states.at(-1)!.duel.crowd!.warbands!.mode.length).toBeGreaterThan(0);
    // The same Intents, again: the same hash at every Tick.
    let m = initial();
    states.forEach((s, k) => {
      expect(hashValue(m)).toBe(hashValue(s));
      if (k < intents.length) m = stepMatch(m, intents[k]!, tuning);
    });
    // A snapshot restored before the first Promotion re-simulates the same hashes.
    const first = states.findIndex((s) => bound(s).length > 0);
    for (const back of [Math.max(0, first - 2), Math.max(0, first - 30), first]) {
      let r = restore(snapshot(states[back]!));
      for (let k = back; k < states.length - 1; k += 1) {
        r = stepMatch(r, intents[k]!, tuning);
        expect(hashValue(r)).toBe(hashValue(states[k + 1]!));
      }
    }
  });

  it('keeps every Warband its size across an AI Takeover, and into the next Floor', () => {
    const a = start(2);
    const b = takeOverFighter(a, 1);
    expect(b.delver!.away).toEqual([1]);
    expect(b.duel.crowd).toBe(a.duel.crowd);
    let ra = a;
    let rb = b;
    for (let k = 0; k < 120; k++) {
      ra = tick(ra);
      rb = tick(rb);
    }
    expect(rb.duel.crowd!.warbands!.size).toEqual(ra.duel.crowd!.warbands!.size);
    expect(rb.duel.crowd).toEqual(ra.duel.crowd);
    for (const m of [ra, rb]) expect(m.config.humans).toBe(2);
    const next = (m: MatchState) => tick({ ...m, nextDuelTick: m.tick + 1 });
    const [na, nb] = [next(ra), next(rb)];
    expect(nb.delver!.floor).toBe(2);
    expect(nb.duel.crowd).toEqual(na.duel.crowd);
    expect(nb.duel.crowd!.warbands!.size).toEqual(na.duel.crowd!.warbands!.size);
  });
});
