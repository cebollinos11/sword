/**
 * docs/plans/battle-objectives.md, Stage 2a: Objectives, Tickets and the Commander in the Simulation. The open field's five Objectives
 * and the static destination fields to them; capture (a Player counting 3); Tickets (a death costs 1, the drain, the limit, the Rout
 * only at none); Squads respawning into dead slots; the Commander's Orders (every Objective, the hold, symmetry); and the state's
 * determinism: the same seed gives the same hash, a snapshot continues identically, a Rollback across a capture and across a respawn
 * lands on the same state, and the state survives a JSON resync.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, startingTickets, type TuningData } from '../tuning';
import {
  ATTACK,
  battleMapOf,
  captureTicks,
  createCrowd,
  createMatch,
  DEFEND,
  destinationFields,
  drainTickets,
  fieldDistance,
  hashValue,
  limitLoser,
  limitTicks,
  owned,
  planTicks,
  orderSpot,
  RESPAWN,
  respawnTicks,
  restore,
  secondsToTicks,
  snapshot,
  steerToward,
  stepCrowd,
  stepMatch,
  stepObjectives,
  battlefieldHeight,
  type CrowdFighter,
  type CrowdState,
  type MatchState,
  type ObjectiveState,
  type SquadState,
} from '.';

const tuning = loadTuningData();
const battle = tuning.battle;
/** Three Squads a side (13, 13 and 14 Soldiers), close together. */
const small: TuningData = { ...tuning, battle: { ...battle, armySize: 40, deploy: { ...battle.deploy, front: 10, perRank: 10 } } };
const map = battleMapOf(battle, 'battle:1');
const smallMap = battleMapOf(small.battle, 'battle:1');
const O = map.field.objectives.length;
const hold = secondsToTicks(battle.commander.holdSeconds);

const start = (t: TuningData = tuning, seed = 1): MatchState => createMatch(t, { format: 'Battle', bestOf: 1, seed, teams: [] });
const advance = (m: MatchState, ticks: number, t: TuningData = tuning): MatchState => {
  for (let k = 0; k < ticks; k++) m = stepMatch(m, [], t);
  return m;
};
/** `m` with its Crowd replaced by `edit`'s result (the edit works on a copy of each array it takes). */
function withCrowd(m: MatchState, edit: (c: CrowdState) => Partial<CrowdState>): MatchState {
  const c = m.duel.crowd!;
  return { ...m, duel: { ...m.duel, crowd: { ...c, ...edit(c) } } };
}
const squadEdit = (s: SquadState, to: { [K in keyof SquadState]?: number[] }): SquadState => ({ ...s, ...to });
/** Kills every living Soldier of Squad `q`. */
const wipe = (m: MatchState, q: number): MatchState =>
  withCrowd(m, (c) => ({
    alive: c.alive.map((a, i) => (c.squad[i] === q ? 0 : a)),
    hp: c.hp.map((h, i) => (c.squad[i] === q ? 0 : h)),
  }));
const living = (c: CrowdState, q: number): number[] => c.squad.flatMap((s, i) => (s === q && c.alive[i] ? [i] : []));

describe("the open field's Objectives", () => {
  it('has five: a Home Objective owned by each army, and three neutral ones across the centre line', () => {
    const sites = map.field.objectives;
    expect(sites.map((s) => s.id)).toEqual(['H0', 'A', 'B', 'C', 'H1']);
    expect(sites.map((s) => s.owner)).toEqual([0, -1, -1, -1, 1]);
    expect(sites.filter((s) => s.spawn).map((s) => s.id)).toEqual(['H0', 'H1']);
    const c = createCrowd(battle, 1);
    expect(c.objectives).toEqual({ progress: [1, 0, 0, 0, -1], owner: [0, -1, -1, -1, 1] });
    expect(c.tickets).toEqual([700, 700]);
    expect(startingTickets(battle)).toBe(700);
    expect(map.field.bases.map((b) => [b.x, b.z])).toEqual([[0, -85], [0, 85]]);
  });

  it('puts the centre Objective on the highest ground within its search of the middle, along the line across the armies', () => {
    for (const seed of [1, 2, 3, 7]) {
      const f = battleMapOf(battle, `battle:${seed}`).field;
      const b = f.objectives[2]!;
      const hf = f.heights;
      const half = hf.size / 2;
      const row = Math.round(half / hf.cell);
      let top = -Infinity;
      for (let c = 0; c < hf.side; c++) if (Math.abs(-half + c * hf.cell) <= 15) top = Math.max(top, hf.heights[row * hf.side + c]!);
      expect(battlefieldHeight(hf, b.x, b.z), `seed ${seed}`).toBeCloseTo(top, 9);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(15);
      // Both armies stay as far from it: it never leaves the line across the middle.
      expect(b.z, `seed ${seed}`).toBe(0);
    }
  });

  it('builds the destination fields once per map and keeps them out of the state', () => {
    expect(destinationFields(battle, map.field)).toBe(map.fields);
    expect(battleMapOf(battle, 'battle:1').fields).toBe(map.fields);
    expect(map.fields.dist).toHaveLength(O + 2);
    for (let d = 0; d < O + 2; d++) {
      const at = d < O ? map.field.objectives[d]! : map.field.bases[d - O]!;
      expect(fieldDistance(map.fields, d, at.x, at.z)).toBe(0);
    }
    // No Walls: a path is within the grid's error of the straight line.
    for (const [x, z] of [[-80, -90], [60, 70], [0, 40]] as const) {
      const b = map.field.objectives[2]!;
      const path = fieldDistance(map.fields, 2, x, z);
      const line = Math.hypot(x - b.x, z - b.z);
      expect(path).toBeGreaterThan(line * 0.9);
      expect(path).toBeLessThan(line * 1.1 + 6);
    }
    expect(map.fields.dist.every((f) => f.every((v) => v >= 0))).toBe(true);
    expect(JSON.stringify(createCrowd(battle, 1))).not.toContain('"dist"');
  });

  it('steers straight at a destination when nothing blocks the way, and down the field when something does', () => {
    expect(steerToward(map.fields, 2, -60, -60, 0, 0)).toBeCloseTo(Math.atan2(60, 60), 12);
    // A wall of blocked cells across the way: the line is blocked, and the lowest neighbour in the field leads on.
    const side = map.fields.side;
    const blocked = new Uint8Array(map.fields.blocked);
    for (let cx = 0; cx < side; cx++) blocked[((side - 1) / 2) * side + cx] = 1;
    const walled = { ...map.fields, blocked };
    const way = steerToward(walled, 2, 0, -20, 0, 20);
    expect(way).not.toBeNull();
    expect(Math.cos(way!)).toBeGreaterThan(0.5);
  });
});

describe('capture', () => {
  const state = (progress: number[], owner: number[]): ObjectiveState => ({ progress, owner });
  const inside = (a: number[], b: number[]): [number[], number[]] => [a, b];
  const dt = captureTicks(battle) / 60;

  it('moves progress toward the Team with more Soldiers inside, at a rate that grows with the difference and is capped', () => {
    const { rate, maxRate } = battle.objectives;
    const one = stepObjectives(state([0], [-1]), inside([3], [1]), battle);
    expect(one.progress[0]).toBeCloseTo(2 * rate * dt, 12);
    const toward1 = stepObjectives(state([0], [-1]), inside([0], [4]), battle);
    expect(toward1.progress[0]).toBeCloseTo(-4 * rate * dt, 12);
    const capped = stepObjectives(state([0], [-1]), inside([100], [0]), battle);
    expect(capped.progress[0]).toBeCloseTo(maxRate * dt, 12);
    const same = state([0.3], [-1]);
    expect(stepObjectives(same, inside([5], [5]), battle)).toBe(same);
    expect(stepObjectives(same, inside([0], [0]), battle)).toBe(same);
  });

  it('is owned at +1 or -1; the Owner keeps it while both are inside until the progress crosses 0, then it is nobody\'s until the other reaches the end', () => {
    expect(stepObjectives(state([0.99], [-1]), inside([20], [0]), battle)).toEqual(state([1], [0]));
    expect(stepObjectives(state([-0.99], [-1]), inside([0], [20]), battle)).toEqual(state([-1], [1]));
    // Team 0 owns it at full progress; outnumbered it loses ground but keeps the Owner while above 0.
    const held = stepObjectives(state([1], [0]), inside([3], [10]), battle);
    expect(held.progress[0]).toBeLessThan(1);
    expect(held.owner[0]).toBe(0);
    const lost = stepObjectives(state([0.01], [0]), inside([0], [20]), battle);
    expect(lost.progress[0]).toBeLessThan(0);
    expect(lost.owner[0]).toBe(-1);
    // Keeps rising for its taker from there.
    expect(stepObjectives(lost, inside([0], [20]), battle).progress[0]).toBeLessThan(lost.progress[0]!);
    expect(owned(state([1, 0, -1, -1], [0, -1, 1, 1]), 1)).toBe(2);
  });

  it('counts a Player as 3 Soldiers on an Objective and any other full Fighter as 1', () => {
    const c = createCrowd(battle, 1);
    const b = map.field.objectives[2]!;
    const tick = captureTicks(battle) * 7;
    const at = (f: Partial<CrowdFighter>): CrowdFighter => ({ x: b.x, z: b.z, team: 0, ...f });
    const progress = (fighters: CrowdFighter[]) => stepCrowd(c, tick, battle, fighters, map).objectives.progress[2]!;
    const { rate } = battle.objectives;
    expect(progress([])).toBe(0);
    expect(progress([at({})])).toBeCloseTo(rate * dt, 12);
    expect(progress([at({ ahead: 0 })])).toBeCloseTo(3 * battle.objectives.rate * dt, 12);
    expect(progress([at({ team: 1, ahead: 0 })])).toBeCloseTo(-3 * rate * dt, 12);
    expect(progress([at({ ahead: 0 }), at({ team: 1 }), at({ team: 1 })])).toBeCloseTo(rate * dt, 12);
    // Off the circle it counts nowhere.
    expect(progress([at({ x: b.x + b.radius + 1, ahead: 0 })])).toBe(0);
    // Only on a capture step.
    expect(stepCrowd(c, tick + 1, battle, [at({ ahead: 0 })], map).objectives).toBe(c.objectives);
  });
});

describe('Tickets', () => {
  it('costs a Team one for each death, and a Squad respawning costs none', () => {
    let m = start(small);
    const startTickets = startingTickets(small.battle);
    const deaths = (c: CrowdState) => [0, 1].map((t) => small.battle.armySize - c.alive.reduce((a, v, i) => a + (v && c.team[i] === t ? 1 : 0), 0));
    let seen = 0;
    // Until the Objectives first change hands there is no drain, so Tickets are exactly the deaths so far (before any respawn is due).
    while (m.tick < respawnTicks(small.battle) && owned(m.duel.crowd!.objectives, 0) === 1 && owned(m.duel.crowd!.objectives, 1) === 1) {
      m = stepMatch(m, [], small);
      const c = m.duel.crowd!;
      expect(c.tickets).toEqual(deaths(c).map((d) => startTickets - d));
      seen = Math.max(seen, ...deaths(c));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('drains the enemy by drain for each Objective more a Team owns, every second, never below 0', () => {
    const { drain } = battle.tickets;
    const objectives = (owner: number[]): ObjectiveState => ({ progress: owner.map((o) => (o === 0 ? 1 : o === 1 ? -1 : 0)), owner });
    expect(drainTickets([400, 400], objectives([0, 0, 0, 1, -1]), battle)).toEqual([400, 400 - 2 * drain]);
    expect(drainTickets([400, 400], objectives([1, 1, 0, -1, -1]), battle)[0]).toBeCloseTo(400 - drain, 12);
    const level = [400, 400];
    expect(drainTickets(level, objectives([0, 1, -1, -1, -1]), battle)).toBe(level);
    expect(drainTickets([0.1, 5], objectives([1, 1, 1, 1, 0]), battle)[0]).toBe(0);
    // Linear: owning all of them is worth no more per Objective.
    expect(drainTickets([400, 400], objectives([0, 0, 0, 0, 0]), battle)[1]).toBeCloseTo(400 - 5 * drain, 12);

    // In the Crowd, on the second's last Tick only.
    const c = withCrowd(start(), () => ({ objectives: objectives([0, 0, 0, 1, 1]) })).duel.crowd!;
    expect(stepCrowd(c, 59, battle, [], map).tickets).toBe(c.tickets);
    expect(stepCrowd(c, 120, battle, [], map).tickets).toEqual([700, 700 - drain]);
  });

  it('does not rout a Team until its Tickets are gone, and then routs it once its Soldiers fall below the threshold', () => {
    const base = start().duel.crowd!;
    const thin = (tickets: number[]): CrowdState => ({ ...base, tickets, alive: base.alive.map((a, i) => (base.team[i] === 0 && i % 5 !== 0 ? 0 : a)) });
    // Team 0 has 40 left of 200: not below the threshold's 40. One fewer.
    const fewer = (tickets: number[]) => {
      const c = thin(tickets);
      const dead = c.alive.findIndex((a, i) => a && c.team[i] === 0);
      return { ...c, alive: c.alive.map((a, i) => (i === dead ? 0 : a)) };
    };
    expect(stepCrowd(fewer([5, 400]), 1, battle, [], map).rout).toBeNull();
    expect(stepCrowd(fewer([0, 400]), 1, battle, [], map).rout).toEqual({ team: 0, tick: 1 });
    expect(stepCrowd(thin([0, 400]), 1, battle, [], map).rout).toBeNull();
  });

  it('ends at the limit: the Team with fewer Tickets routs; on a tie fewer Objectives; then a coin from the Crowd\'s generator', () => {
    const c = start().duel.crowd!;
    const at = limitTicks(battle);
    expect(at).toBe(54000);
    expect(stepCrowd(c, at - 1, battle, [], map).rout).toBeNull();
    expect(stepCrowd({ ...c, tickets: [150, 151] }, at, battle, [], map).rout).toEqual({ team: 0, tick: at });
    expect(stepCrowd({ ...c, tickets: [151, 150] }, at, battle, [], map).rout).toEqual({ team: 1, tick: at });
    const objectives: ObjectiveState = { progress: [1, 1, 1, -1, -1], owner: [0, 0, 0, 1, 1] };
    expect(stepCrowd({ ...c, tickets: [100, 100], objectives }, at, battle, [], map).rout).toEqual({ team: 1, tick: at });
    const coin = stepCrowd({ ...c, tickets: [100, 100] }, at, battle, [], map).rout!;
    expect([0, 1]).toContain(coin.team);
    expect(stepCrowd({ ...c, tickets: [100, 100] }, at, battle, [], map).rout).toEqual(coin);
    const flips = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => stepCrowd(createCrowd(battle, seed), at, battle, [], map).rout!.team));
    expect(flips.size).toBe(2);
    expect(limitLoser([1, 2], objectivesOf(0, 0), () => 0.9)).toBe(0);
  });
});

function objectivesOf(a: number, b: number): ObjectiveState {
  const owner = [...new Array<number>(a).fill(0), ...new Array<number>(b).fill(1)];
  return { progress: owner.map((o) => (o === 0 ? 1 : -1)), owner };
}

describe('respawning', () => {
  /** A Battle at Tick T with Squad `q` wiped out, run on until its respawn is due plus a second. */
  const wiped = (t: TuningData, q: number, edit: (m: MatchState) => MatchState = (m) => m) => {
    let m = edit(wipe(advance(start(t), 30, t), q));
    const deadAt = m.tick;
    // Past the Commander's next plan (every 2.5 s), which sends the empty Squad to a spawn.
    m = advance(m, planTicks(t.battle) + 10, t);
    expect(m.duel.crowd!.squads.living[q]).toBe(0);
    expect(m.duel.crowd!.squads.respawnAt[q]).toBeGreaterThanOrEqual(deadAt + respawnTicks(t.battle));
    return m;
  };

  it('brings a wiped-out Squad back whole into its Team\'s dead slots about 10 s later, at full HP, round the spawn its Order names', () => {
    let m = wiped(small, 0);
    const before = m.duel.crowd!;
    const dead = before.alive.flatMap((a, i) => (!a && before.team[i] === 0 ? [i] : []));
    expect(m.duel.crowd!.squads.order[0]).toBe(RESPAWN);
    const ticksBefore = m.tick;
    m = advance(m, respawnTicks(small.battle) + 40, small);
    const c = m.duel.crowd!;
    expect(m.tick - ticksBefore).toBeGreaterThan(respawnTicks(small.battle));
    const back = living(c, 0);
    expect(back).toHaveLength(small.battle.squad.size);
    // The lowest dead slots of its Team, nobody else's.
    expect(back.every((i) => c.team[i] === 0)).toBe(true);
    expect(back).toEqual(dead.slice(0, back.length));
    expect(new Set(back.map((i) => c.place[i])).size).toBe(back.length);
    expect(back.every((i) => c.hp[i] === small.battle.crowd.hp)).toBe(true);
    expect(c.squads.living[0]).toBe(back.length);
    expect(c.squads.respawnAt[0]).toBe(-1);
  });

  it('costs no Ticket: a respawn changes the Soldiers and the Squad, not the Tickets', () => {
    const b = small.battle;
    const c0 = createCrowd(b, 1);
    const mine = c0.squad.flatMap((q, i) => (q === 0 ? [i] : []));
    const tick = secondsToTicks(b.squad.brainSeconds) * 20;
    const empty: CrowdState = {
      ...c0,
      alive: c0.alive.map((a, i) => (mine.includes(i) ? 0 : a)),
      squads: squadEdit(c0.squads, { living: c0.squads.living.map((l, q) => (q === 0 ? 0 : l)), respawnAt: c0.squads.respawnAt.map((r, q) => (q === 0 ? tick - 1 : r)) }),
      tickets: [77, 88],
    };
    const next = stepCrowd(empty, tick, b, [], smallMap);
    expect(next.tickets).toEqual([77, 88]);
    expect(next.alive.filter((a, i) => a && next.team[i] === 0).length).toBe(c0.alive.filter((_, i) => c0.team[i] === 0).length - mine.length + b.squad.size);
    expect(next.squads.respawnAt[0]).toBe(-1);
    expect(next.squads.living[0]).toBe(b.squad.size);
  });

  it('puts the Soldiers at the spawn on the Tick it respawns, in a column facing the enemy', () => {
    let m = wiped(small, 0);
    let c = m.duel.crowd!;
    const due = c.squads.respawnAt[0]!;
    while (m.tick < due + 40 && c.squads.living[0] === 0) {
      m = stepMatch(m, [], small);
      c = m.duel.crowd!;
    }
    expect(c.squads.living[0]).toBeGreaterThan(0);
    const spot = [c.squads.x[0]!, c.squads.z[0]!];
    const place: [number, number] = [0, 0];
    orderSpot(smallMap, c.squads.target[0]!, 0, 3, small.battle, place);
    expect(spot).toEqual(place);
    for (const i of living(c, 0)) {
      expect(Math.hypot(c.x[i]! - spot[0]!, c.z[i]! - spot[1]!)).toBeLessThan(6);
      expect(c.heading[i]).toBe(0);
    }
    expect(c.squads.order[0]).toBe(RESPAWN);
    expect(c.squads.shape[0]).toBe(0);
  });

  it('spawns at an Objective its Team owns that no enemy is on, and at the Base when it does not own it', () => {
    // Home Objective H0 (index 0) is Team 0's spawn and owned: the Commander picks the spawn nearest what it wants.
    const m = wiped(small, 1);
    const own = m.duel.crowd!;
    const spawns = [O + 0, 0];
    expect(spawns).toContain(own.squads.target[1]);
    // Not owned (and nobody's): only the Base.
    const lost = wiped(small, 1, (x) => withCrowd(x, (c) => ({ objectives: { progress: [0, ...c.objectives.progress.slice(1)], owner: [-1, ...c.objectives.owner.slice(1)] } })));
    expect(lost.duel.crowd!.squads.target[1]).toBe(O + 0);
    const back = advance(lost, respawnTicks(small.battle) + 40, small).duel.crowd!;
    expect(back.squads.living[1]).toBeGreaterThan(0);
  });

  it('uses the Base when an enemy stands on the spawn Objective at the moment of respawn', () => {
    let m = wiped(small, 1);
    const c = m.duel.crowd!;
    const site = smallMap.field.objectives[0]!;
    // Order it to H0, then put an enemy Soldier on H0 when the respawn falls due.
    m = withCrowd(m, (x) => ({ squads: squadEdit(x.squads, { order: x.squads.order.map((o, q) => (q === 1 ? RESPAWN : o)), target: x.squads.target.map((t, q) => (q === 1 ? 0 : t)), since: x.squads.since.map((s, q) => (q === 1 ? m.tick : s)) }) }));
    const foe = c.team.findIndex((t, i) => t === 1 && c.alive[i]);
    m = withCrowd(m, (x) => ({ x: x.x.map((v, i) => (i === foe ? site.x : v)), z: x.z.map((v, i) => (i === foe ? site.z : v)), hp: x.hp.map((h, i) => (i === foe ? 1e9 : h)) }));
    while (m.duel.crowd!.squads.living[1] === 0 && m.tick < 3000) {
      m = withCrowd(stepMatch(m, [], small), (x) => ({ x: x.x.map((v, i) => (i === foe ? site.x : v)), z: x.z.map((v, i) => (i === foe ? site.z : v)), squads: squadEdit(x.squads, { target: x.squads.target.map((t, q) => (q === 1 && x.squads.living[1] === 0 ? 0 : t)), order: x.squads.order.map((o, q) => (q === 1 && x.squads.living[1] === 0 ? RESPAWN : o)) }) }));
    }
    const after = m.duel.crowd!;
    expect(after.squads.living[1]).toBeGreaterThan(0);
    expect([after.squads.x[1], after.squads.z[1]]).toEqual([smallMap.field.bases[0].x, smallMap.field.bases[0].z]);
  });

  it('respawns nothing once its Team has no Tickets, and never takes a promoted or taken-over Soldier\'s slot', () => {
    let m = wiped(small, 0, (x) => withCrowd(x, (c) => ({ tickets: [0, c.tickets[1]!] })));
    m = advance(m, respawnTicks(small.battle) + 120, small);
    expect(m.duel.crowd!.squads.living[0]).toBe(0);
    expect(living(m.duel.crowd!, 0)).toEqual([]);

    // A dead Soldier still held by a Fighter (slot >= 0) is skipped.
    let n = wiped(small, 0);
    const slotted = n.duel.crowd!.alive.findIndex((a, i) => !a && n.duel.crowd!.team[i] === 0);
    n = withCrowd(n, (c) => ({ slot: c.slot.map((s, i) => (i === slotted ? 9 : s)) }));
    n = advance(n, respawnTicks(small.battle) + 120, small);
    const c = n.duel.crowd!;
    expect(c.squads.living[0]).toBeGreaterThan(0);
    expect(c.alive[slotted]).toBe(0);
    expect(c.slot[slotted]).toBe(9);
  });

  it('respawns the dead slots it has when fewer than a Squad are free', () => {
    let m = wiped(small, 0);
    // Only three dead slots of Team 0 are free: the others are other Squads\' living Soldiers (the first 10 revived, as if merged away).
    const dead = m.duel.crowd!.alive.flatMap((a, i) => (!a && m.duel.crowd!.team[i] === 0 ? [i] : []));
    m = withCrowd(m, (c) => ({ alive: c.alive.map((a, i) => (dead.slice(3).includes(i) ? 1 : a)), hp: c.hp.map((h, i) => (dead.slice(3).includes(i) ? 50 : h)), squad: c.squad.map((s, i) => (dead.slice(3).includes(i) ? 1 : s)) }));
    m = advance(m, respawnTicks(small.battle) + 120, small);
    const c = m.duel.crowd!;
    expect(living(c, 0).filter((i) => dead.includes(i))).toEqual(dead.slice(0, 3));
  });
});

describe('the Commander', () => {
  it('gives every Squad an Order at deployment, spread over the Objectives, the two Commanders alike on a symmetric field', () => {
    const flat: TuningData = { ...tuning, battle: { ...battle, field: { ...battle.field, hillHeight: 0 } } };
    const c = createCrowd(flat.battle, 1);
    const s = c.squads;
    expect(s.order.every((o) => o === ATTACK || o === DEFEND)).toBe(true);
    for (const team of [0, 1]) {
      const targets = s.target.slice(team * 16, team * 16 + 16);
      expect(new Set(targets).size).toBeGreaterThanOrEqual(3);
      expect(targets.every((t) => t < O)).toBe(true);
    }
    // Team 1 mirrors Team 0 through the centre: the same Squad k goes to the mirrored Objective (H0 <-> H1, A <-> C, B itself).
    for (let k = 0; k < 16; k++) expect(s.target[16 + k], `Squad ${k}`).toBe(O - 1 - s.target[k]!);
    // A Squad ordered to an Objective its Team owns defends it.
    for (let q = 0; q < 32; q++) expect(s.order[q]).toBe(c.objectives.owner[s.target[q]!] === s.team[q] ? DEFEND : ATTACK);
  });

  it('holds an Order for holdSeconds unless the Squad breaks, over a whole Battle, and logs how often Orders change', () => {
    let m = start(tuning, 3);
    const targets = new Set<number>();
    let changes = 0;
    let prev = m.duel.crowd!.squads;
    const ticksToRun = secondsToTicks(180);
    while (m.tick < ticksToRun && m.status.status === 'InProgress') {
      m = stepMatch(m, [], tuning);
      const s = m.duel.crowd!.squads;
      if (s !== prev) {
        for (let q = 0; q < s.team.length; q++) {
          if (s.order[q] === prev.order[q] && s.target[q] === prev.target[q]) continue;
          if (s.living[q]! > 0 && (s.order[q] === ATTACK || s.order[q] === DEFEND) && s.target[q] !== prev.target[q]) changes++;
          if (prev.living[q]! > 0 && !prev.fall[q] && (prev.order[q] === ATTACK || prev.order[q] === DEFEND) && s.target[q] !== prev.target[q] && s.order[q] !== RESPAWN)
            expect(m.tick - prev.since[q]!, `Squad ${q} switched at Tick ${m.tick} after ${m.tick - prev.since[q]!}`).toBeGreaterThanOrEqual(hold);
        }
        prev = s;
      }
      m.duel.crowd!.squads.target.forEach((t, q) => (m.duel.crowd!.squads.living[q]! > 0 ? targets.add(t) : 0));
    }
    const minutes = m.tick / 3600;
    // eslint-disable-next-line no-console
    console.log(`Commander: ${changes} Order changes over ${minutes.toFixed(1)} min, ${(changes / 32 / minutes).toFixed(2)} per Squad per minute`);
    // Stage 2b's soak (240 Battles) measured 0.23 changes per Squad per minute on average and 0.29 at most over a whole Battle; the first minutes, when every Squad is first sent, run higher.
    expect(changes / 32 / minutes).toBeLessThan(1);
    expect([...targets].filter((t) => t < O).sort()).toEqual([0, 1, 2, 3, 4]);
  }, 60000);

  it('ends a whole 200 v 200 Battle by Tickets in about 6 to 8 minutes, on two seeds', () => {
    for (const seed of [3, 7]) {
      let m = start(tuning, seed);
      let held = [0, 0];
      let samples = 0;
      while (m.status.status === 'InProgress') {
        m = stepMatch(m, [], tuning);
        if (m.tick % 300 === 0) {
          held = [held[0]! + owned(m.duel.crowd!.objectives, 0), held[1]! + owned(m.duel.crowd!.objectives, 1)];
          samples++;
        }
      }
      const c = m.duel.crowd!;
      const seconds = m.tick / 60;
      // eslint-disable-next-line no-console
      console.log(`seed ${seed}: ended after ${seconds.toFixed(0)} s, Tickets ${c.tickets.map(Math.round)}, held on average ${held.map((h) => (h / samples).toFixed(2))}`);
      // Not the 15-minute limit, but Tickets: the loser's are gone.
      expect(m.tick, `seed ${seed}`).toBeLessThan(limitTicks(battle));
      expect(c.tickets[c.rout!.team], `seed ${seed}`).toBe(0);
      expect(seconds, `seed ${seed}`).toBeGreaterThan(300);
      expect(seconds, `seed ${seed}`).toBeLessThan(540);
    }
  }, 120000);

  it('sends an empty Squad to respawn and leaves a falling Squad alone', () => {
    const c = createCrowd(battle, 1);
    const s = c.squads;
    const falling = { ...c, squads: squadEdit(s, { fall: s.fall.map((f, q) => (q === 3 ? 1 : f)), order: s.order.map((o, q) => (q === 3 ? DEFEND : o)), target: s.target.map((t, q) => (q === 3 ? 2 : t)), since: s.since.map((v, q) => (q === 3 ? -1000 : v)) }) };
    const planned = stepCrowd(falling, planTicks(battle) * 4, battle, [], map).squads;
    expect(planned.order[3]).toBe(DEFEND);
    expect(planned.target[3]).toBe(2);
    expect(planned.since[3]).toBe(-1000);
    const gone = { ...c, squads: squadEdit(s, { living: s.living.map((l, q) => (q === 5 ? 0 : l)) }) };
    const after = stepCrowd(gone, planTicks(battle) * 4, battle, [], map).squads;
    expect(after.order[5]).toBe(RESPAWN);
    expect([O + 0, 0]).toContain(after.target[5]);
  });
});

describe('determinism', () => {
  it('gives the same hash every Tick for the same seed, and a snapshot continues identically', () => {
    const a = start(small);
    const b = start(small);
    let x = a;
    let y = b;
    for (let k = 0; k < 400; k++) {
      x = stepMatch(x, [], small);
      y = stepMatch(y, [], small);
      expect(hashValue(x)).toBe(hashValue(y));
    }
    const snap = snapshot(x);
    const again = restore(snap);
    expect(hashValue(advance(x, 200, small))).toBe(hashValue(advance(again, 200, small)));
  });

  it('puts the Objectives, Tickets and Orders in the hash', () => {
    const m = start(small);
    const c = m.duel.crowd!;
    const hashOf = (edit: Partial<CrowdState>) => hashValue({ ...m, duel: { ...m.duel, crowd: { ...c, ...edit } } });
    const base = hashValue(m);
    expect(hashOf({ tickets: [399, 400] })).not.toBe(base);
    expect(hashOf({ objectives: { ...c.objectives, progress: [0.9, ...c.objectives.progress.slice(1)] } })).not.toBe(base);
    expect(hashOf({ objectives: { ...c.objectives, owner: [-1, ...c.objectives.owner.slice(1)] } })).not.toBe(base);
    for (const key of ['order', 'target', 'since', 'respawnAt'] as const) expect(hashOf({ squads: { ...c.squads, [key]: c.squads[key].map((v, q) => (q === 0 ? v + 1 : v)) } })).not.toBe(base);
  });

  /** Steps `m` to `to`, keeping a snapshot of every Tick; then from each of `froms` restores and re-simulates to `to`: the same hash every Tick. */
  function rollsBackTo(m: MatchState, to: number, froms: number[], t: TuningData): void {
    const snaps = new Map<number, ReturnType<typeof snapshot<MatchState>>>([[m.tick, snapshot(m)]]);
    const hashes = new Map<number, string>([[m.tick, hashValue(m)]]);
    while (m.tick < to) {
      m = stepMatch(m, [], t);
      snaps.set(m.tick, snapshot(m));
      hashes.set(m.tick, hashValue(m));
    }
    for (const from of froms) {
      let r = restore(snaps.get(from)!);
      for (let k = from + 1; k <= to; k++) {
        r = stepMatch(r, [], t);
        expect(hashValue(r), `Tick ${k} after a Rollback to ${from}`).toBe(hashes.get(k));
      }
    }
  }

  it('rolls back across a capture to the same state, every Tick', () => {
    // Find the first Tick an Objective changes hands in a small Battle.
    let m = start(small, 2);
    const owners = (x: MatchState) => x.duel.crowd!.objectives.owner.join();
    const first = owners(m);
    let captured = -1;
    for (let k = 0; k < 6000 && captured < 0; k++) {
      m = stepMatch(m, [], small);
      if (owners(m) !== first) captured = m.tick;
    }
    expect(captured, 'an Objective changed hands').toBeGreaterThan(0);
    rollsBackTo(start(small, 2), captured + 20, [captured - 15, captured - 1, 0], small);
  }, 60000);

  it('rolls back across a respawn to the same state, every Tick', () => {
    const m = wipeAndRun();
    const to = m.tick;
    const respawned = m.duel.crowd!.squads.respawnAt[0]!;
    expect(respawned).toBe(-1);
    // `wipeAndRun` returns just after the respawn; roll back from before the wipe, across it and the respawn.
    const base = wipe(advance(start(small), 30, small), 0);
    rollsBackTo(base, to, [base.tick, base.tick + 100, to - 15], small);
  }, 60000);

  function wipeAndRun(): MatchState {
    let m = wipe(advance(start(small), 30, small), 0);
    const wipedAt = m.tick;
    // The brain finds it empty within half a second; then it waits to respawn.
    while ((m.tick < wipedAt + 60 || m.duel.crowd!.squads.living[0] === 0) && m.tick < 5000) m = stepMatch(m, [], small);
    return advance(m, 10, small);
  }

  it('survives a JSON resync: Squads, Objectives, Tickets and Orders round-trip to the same hash and the Battle goes on identically', () => {
    const m = advance(wipe(advance(start(small), 30, small), 0), 700, small);
    const copy = JSON.parse(JSON.stringify(m)) as MatchState;
    expect(hashValue(copy)).toBe(hashValue(m));
    expect(copy.duel.crowd!.squads.order).toEqual(m.duel.crowd!.squads.order);
    expect(hashValue(advance(copy, 300, small))).toBe(hashValue(advance(m, 300, small)));
  });
});
