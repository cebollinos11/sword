/**
 * docs/plans/battle-objectives.md, Stage 3a: Battle maps as `ArenaGeometry`, and the Fort's first shape (ADR 0022). The Fort's map as
 * Tuning Data, its Battlefield (the floor's Walk Surfaces as the ground, Walls round every block, no jump Links), its symmetry, the
 * destination fields round its walls, the crude push that keeps Soldiers out of them, the army size per map, full Fighters routed round
 * the walls by the navmesh, and whole Battles on it: played to their end by Tickets, deterministic, and rolled back to the same state.
 * Stage 4b gave it a raised keep with B on its deck, two ramps and a tunnel under it (a map of several levels): its walk check, its half
 * turn in Walk Surfaces and Walls, B counting only the Soldiers on the keep, Squads in the tunnel and up a ramp, and every Soldier on the
 * right level on every step of whole Battles.
 */
import { describe, expect, it } from 'vitest';
import { createBattlePilot, poolControllers, stepMatchWith } from '../controllers';
import { applyBattleKnobs, armySizeCap, loadTuningData, parseBattle, standardArmySize, type TuningData } from '../tuning';
import {
  arenaOf,
  battlefieldHeight,
  battlefieldOf,
  battleMapName,
  battleMapOf,
  battleNameFor,
  captureTicks,
  corners,
  createCrowd,
  createMatch,
  findPath,
  fieldDistance,
  groundOf,
  hashValue,
  inBlock,
  inDuel,
  inSight,
  isBattleName,
  navMesh,
  onSurface,
  parseBattleName,
  pushOutOfBlocks,
  restore,
  snapshot,
  soldierHeight,
  stepCrowd,
  stepMatch,
  walkCheck,
  type CrowdState,
  type MatchState,
  type Snapshot,
} from '.';
import { checkLevels, joins, placed, unplanned } from './levelChecks.testdata';

const base = loadTuningData();
const fort = base.battle.maps.fort!;
const tuning: TuningData = { ...base, battle: applyBattleKnobs(base.battle, { map: 'fort' }) };
const FORT = 'battle:fort';
const field = battlefieldOf(tuning.battle, FORT)!;

describe('the Fort as Tuning Data', () => {
  it('is a Battle map of the open field size, with five Objectives, two Bases and an army size from its file', () => {
    expect(fort.name).toBe('fort');
    expect(fort.objectives.map((o) => o.id)).toEqual(['D', 'A', 'B', 'C', 'E']);
    expect(fort.objectives.every((o) => o.owner === -1)).toBe(true);
    expect(fort.objectives.filter((o) => o.spawn).map((o) => o.id)).toEqual(['D', 'E']);
    expect(fort.blocks.length).toBeGreaterThan(10);
    expect(fort.armySize.standard).toBeLessThanOrEqual(fort.armySize.max);
    // It parses again as it was parsed.
    expect(parseBattle(base.battle).maps.fort).toEqual(fort);
  });

  it('refuses a map whose floor stops short of a side, whose army does not deploy, or whose name is not its key', () => {
    const raw = (m: object) => ({ ...base.battle, maps: { fort: { ...fort, ...m } } });
    expect(() => parseBattle(raw({ walk: fort.walk.slice(1) }))).toThrow(/must reach every side/);
    expect(() => parseBattle(raw({ armySize: { standard: 200, max: 5000 } }))).toThrow(/must deploy inside the field/);
    expect(() => parseBattle(raw({ armySize: { standard: 300, max: 200 } }))).toThrow(/at most its max/);
    expect(() => parseBattle({ ...base.battle, maps: { keep: fort } })).toThrow(/its key/);
    // A map's own Tickets a Soldier: a positive number or absent.
    for (const bad of [0, -1, '2', null]) expect(() => parseBattle(raw({ ticketsPerSoldier: bad })), `${bad}`).toThrow(/ticketsPerSoldier/);
    expect(parseBattle(raw({ ticketsPerSoldier: 1.5 })).maps.fort!.ticketsPerSoldier).toBe(1.5);
    expect(parseBattle(raw({ ticketsPerSoldier: undefined })).maps.fort!.ticketsPerSoldier).toBeUndefined();
    // Nothing a Squad heads for, nor the front rank, may stand in a wall.
    expect(() => parseBattle(raw({ objectives: fort.objectives.map((o) => (o.id === 'D' ? { ...o, x: -20 } : o)) }))).toThrow(/\(D\) stands inside a block/);
    expect(() => parseBattle(raw({ bases: [{ x: -20, z: -32 }, fort.bases[1]] }))).toThrow(/bases\[0\] stands inside a block/);
    expect(() => parseBattle(raw({ front: 32 }))).toThrow(/front rank .* runs through a block/);
  });

  it('sets the army size per map, held to its cap, and a Battle refuses an army too big for its map', () => {
    expect(tuning.battle.armySize).toBe(fort.armySize.standard);
    expect(standardArmySize(base.battle, fort)).toBe(fort.armySize.standard);
    expect(armySizeCap(base.battle, fort)).toBe(fort.armySize.max);
    expect(applyBattleKnobs(base.battle, { map: 'fort', armySize: 10_000 }).armySize).toBe(fort.armySize.max);
    expect(applyBattleKnobs(base.battle, { map: 'fort', armySize: 50 }).armySize).toBe(50);
    // The Fort starts each Team with fewer Tickets a Soldier than the open field (its file's `ticketsPerSoldier`); the open field keeps its own.
    expect(fort.ticketsPerSoldier).toBe(2.4);
    expect(tuning.battle.tickets.perSoldier).toBe(2.4);
    expect(applyBattleKnobs(base.battle, { armySize: 120 }).tickets.perSoldier).toBe(base.battle.tickets.perSoldier);
    // The open field (no map, or one Tuning Data does not have) keeps its own.
    expect(applyBattleKnobs(base.battle, { map: 'nowhere' })).toBe(base.battle);
    expect(applyBattleKnobs(base.battle, { armySize: 120 }).armySize).toBe(120);
    const tooBig = { ...base, battle: { ...base.battle, armySize: fort.armySize.max + 1 } };
    expect(() => createMatch(tooBig, { format: 'Battle', bestOf: 1, seed: 1, arena: FORT })).toThrow(/holds armies of at most/);
    expect(() => createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: 'battle:keep' })).toThrow(/fought on a Battlefield/);
  });
});

describe('Battlefield names', () => {
  it('names the open field by its seed and a hand-built map by its name', () => {
    expect(parseBattleName(FORT)).toBeNull();
    expect(battleMapName(FORT)).toBe('fort');
    expect(battleMapName('battle:7')).toBeNull();
    expect(battleMapName('library')).toBeNull();
    expect(isBattleName(FORT) && isBattleName('battle:7')).toBe(true);
    expect(isBattleName('battle:07') || isBattleName('battle:Fort') || isBattleName('battle:open') || isBattleName('library')).toBe(false);
    expect(battleNameFor('fort', 5)).toBe(FORT);
    expect(battleNameFor(undefined, 5)).toBe('battle:5');
    expect(battleNameFor('open', 5)).toBe('battle:5');
  });
});

describe("the Fort's Battlefield", () => {
  it("is an ArenaGeometry: its floor's Walk Surfaces as the ground, a Wall on every side of every block, and no jump Links", () => {
    const arena = arenaOf(tuning, FORT);
    expect(arena).toBe(field.arena);
    expect(arena.jumpLinks).toBe(false);
    expect(arena.walk).toHaveLength(fort.walk.length);
    expect(arena.walls).toHaveLength(fort.walls.length + 4 * fort.blocks.length);
    expect(navMesh(arena, tuning).links.some((l) => l.kind === 'jump')).toBe(false);
    expect(navMesh(arena, tuning).links.length).toBeGreaterThan(fort.walk.length);
    // The ground is the floor wherever it is, read from the Walk Surfaces; inside a block, the flat samples under it.
    expect(field.heights.walk).toBe(arena);
    for (const [x, z] of [[60, 0], [0, -32], [-90, 90]] as const) expect(battlefieldHeight(field.heights, x, z)).toBe(0);
    // The keep stands over the middle: the highest ground there is its deck.
    expect(battlefieldHeight(field.heights, 0, 0)).toBe(4);
    expect(inBlock(field, -20, -32)).toBe(true);
    expect(battlefieldHeight(field.heights, -20, -32)).toBe(0);
    // Each Team's Players spawn behind its army, outside the walls.
    for (const s of arena.spawns) expect(inBlock(field, s.position.x, s.position.z)).toBe(false);
  });

  it('is its own half turn: block k mirrors block n - 1 - k, Objective k mirrors Objective 4 - k, and the Bases mirror each other', () => {
    const { blocks, objectives, bases } = field;
    blocks.forEach((b, k) => {
      const m = blocks[blocks.length - 1 - k]!;
      expect([m.minX, m.maxX, m.minZ, m.maxZ, m.top]).toEqual([-b.maxX, -b.minX, -b.maxZ, -b.minZ, b.top]);
    });
    objectives.forEach((o, k) => {
      const m = objectives[objectives.length - 1 - k]!;
      expect([m.x, m.z, m.weight, m.owner, m.spawn]).toEqual([-o.x + 0, -o.z + 0, o.weight, o.owner, o.spawn]);
    });
    expect([bases[1].x, bases[1].z]).toEqual([-bases[0].x + 0, -bases[0].z]);
  });

  it('blocks the destination fields under its walls, routes round them, and gives both Teams mirrored path lengths', () => {
    const map = battleMapOf(tuning.battle, FORT);
    const f = map.fields;
    expect(f.blocked.some((b) => b === 1)).toBe(true);
    const mid = (f.side - 1) / 2;
    for (let c = 0; c < f.side * f.side; c++) expect(f.blocked[c]).toBe(inBlock(field, ((c % f.side) - mid) * f.cell, (Math.floor(c / f.side) - mid) * f.cell) ? 1 : 0);
    // From outside the south wall's middle to B the field goes round through a gate or a breach: longer than the straight line.
    expect(fieldDistance(f, 2, -20, -45)).toBeGreaterThan(45 + 4);
    expect(inSight(f, -20, -45, 0, 0)).toBe(false);
    expect(inSight(f, 0, -45, 0, 0)).toBe(true);
    // Team 0 to Objective k from any open cell is as far as Team 1 to Objective 4 - k from its half turn.
    for (let c = 0; c < f.side * f.side; c++) {
      if (f.blocked[c]) continue;
      const x = ((c % f.side) - mid) * f.cell;
      const z = (Math.floor(c / f.side) - mid) * f.cell;
      for (let k = 0; k < 5; k++) expect(fieldDistance(f, k, x, z)).toBeCloseTo(fieldDistance(f, 4 - k, -x, -z), 6);
    }
  });

  it('pushes a body out of a block by its shallowest side, each Team the mirror of the other, and leaves the open field alone', () => {
    const out: [number, number] = [0, 0];
    // In the south curtain (z -34 to -30), nearer its inner face.
    expect(pushOutOfBlocks(field, -20, -30.5, 0.45, 0, out)).toBe(true);
    expect(out[0]).toBe(-20);
    expect(out[1]).toBeCloseTo(-29.55, 9);
    // In the middle of its thickness, a tie: Team 1 in the north curtain at the half turn goes the half turn of Team 0's way.
    for (const [x, z] of [[-20, -32], [-31.7, -20], [9, -32], [32, 15]] as const) {
      pushOutOfBlocks(field, x, z, 0.45, 0, out);
      const mine = [out[0], out[1]];
      pushOutOfBlocks(field, -x, -z, 0.45, 1, out);
      expect([out[0], out[1]], `from (${x}, ${z})`).toEqual([-mine[0]!, -mine[1]!]);
      expect(inBlock(field, mine[0]!, mine[1]!)).toBe(false);
    }
    expect(pushOutOfBlocks(field, 0, -50, 0.45, 0, out)).toBe(false);
    expect(out).toEqual([0, -50]);
    const open = battlefieldOf(base.battle, 'battle:1')!;
    expect(pushOutOfBlocks(open, 10, 10, 0.45, 0, out)).toBe(false);
    expect(open.blocks).toEqual([]);
  });

  it('routes a full Fighter round the walls by the navmesh: from outside the south wall into the courtyard, every leg of its path clear of the blocks', () => {
    const arena = field.arena;
    const from = { x: -20, y: 0, z: -45 };
    const to = { x: -20, y: 0, z: -20 };
    const path = findPath(arena, tuning, from, to, { jumps: false })!;
    expect(path).not.toBeNull();
    const legs = [{ x: from.x, z: from.z }, ...corners(arena, tuning, path, from, to), { x: to.x, z: to.z }];
    let length = 0;
    for (let k = 1; k < legs.length; k++) {
      const a = legs[k - 1]!;
      const b = legs[k]!;
      length += Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= 20; s++) expect(inBlock(field, a.x + ((b.x - a.x) * s) / 20, a.z + ((b.z - a.z) * s) / 20), `leg ${k}`).toBe(false);
    }
    // Round the wall through a gap in it, not straight through it (25 m).
    expect(legs.length).toBeGreaterThan(2);
    expect(length).toBeGreaterThan(25 + 5);
  });
});

/** The Fort's raised Walk Surfaces, as `checkLevels` tallies crossings: the keep's deck and its ramps (the tunnel's floor and the courtyard are ground). */
const raised = (id: string) => id.startsWith('WALK_deck') || id.startsWith('WALK_ramp');

/**
 * An AI-v-AI Battle on the Fort, from `seed`, to its end (or `cap` Ticks), with the level check (`checkLevels`) on every Tick: its last state,
 * any living Soldier ever found inside a block on a Crowd step, and how many times a Soldier stepped onto or off the keep or a ramp.
 */
function war(seed: number, cap = 60_000): { m: MatchState; inside: number; crossed: number } {
  const linked = joins(tuning, FORT);
  let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed, arena: FORT });
  let inside = 0;
  let crossed = 0;
  while (m.status.status === 'InProgress' && m.tick < cap) {
    const before = m.duel.crowd!;
    m = stepMatch(m, [], tuning);
    const c = m.duel.crowd!;
    crossed += checkLevels(tuning, FORT, linked, before, c, m.tick, raised);
    if (m.tick % tuning.battle.crowd.stagger === 0) for (let i = 0; i < c.x.length; i++) if (c.alive[i] && c.slot[i]! < 0 && inBlock(field, c.x[i]!, c.z[i]!)) inside++;
  }
  return { m, inside, crossed };
}

describe('Battles on the Fort', () => {
  it('play to their end by Tickets in about 6 to 8 minutes, no Soldier ever standing inside a wall or on the wrong level', () => {
    for (const seed of [1, 2]) {
      const { m, inside, crossed } = war(seed);
      const c = m.duel.crowd!;
      expect(m.status.status, `seed ${seed}`).toBe('Over');
      expect(c.rout, `seed ${seed}`).not.toBeNull();
      const seconds = c.rout!.tick / 60;
      process.stderr.write(`Fort seed ${seed}: routed at ${seconds.toFixed(0)} s, Tickets ${c.tickets.map((t) => t.toFixed(0)).join(' / ')}, onto or off the keep or a ramp ${crossed} times\n`);
      expect(seconds).toBeGreaterThan(5 * 60);
      expect(seconds).toBeLessThan(10 * 60);
      expect(crossed).toBeGreaterThan(100);
      expect(c.tickets.some((t) => t <= 0)).toBe(true);
      expect(inside, `seed ${seed}`).toBe(0);
    }
  }, 300_000);

  it('give the same hash every Tick from the same seed, and a snapshot and a Rollback continue it identically', () => {
    let a = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 3, arena: FORT });
    let b = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 3, arena: FORT });
    const saved = new Map<number, Snapshot<MatchState>>();
    const hashes = new Map<number, string>();
    for (let t = 1; t <= 6000; t++) {
      a = stepMatch(a, [], tuning);
      b = stepMatch(b, [], tuning);
      hashes.set(t, hashValue(a));
      if (t % 250 === 0) expect(hashes.get(t), `Tick ${t}`).toBe(hashValue(b));
      if (t % 500 === 0) saved.set(t, snapshot(a));
    }
    // From each snapshot, 15 Ticks re-simulated (a Rollback's depth) land where the Battle did, through the march, the walls and the fight.
    for (const [t, s] of saved) {
      if (t + 15 > 6000) continue;
      let r = restore(s);
      for (let k = 0; k < 15; k++) r = stepMatch(r, [], tuning);
      expect(hashValue(r), `from Tick ${t}`).toBe(hashes.get(t + 15));
    }
  }, 120_000);

  it("promotes Soldiers round a Player into full Fighters that the walls stop: none ever stands inside a block", () => {
    const pilot = createBattlePilot(tuning, 'Hard');
    const controllers = poolControllers(tuning, [pilot]);
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 4, arena: FORT, teams: [0], weapons: ['Longsword'] });
    let promoted = 0;
    let moved = 0;
    for (let t = 0; t < 12000 && m.status.status === 'InProgress'; t++) {
      const before = m.duel.fighters.map((f) => f.position);
      m = stepMatchWith(m, controllers, tuning);
      m.duel.fighters.forEach((f, k) => {
        if (!inDuel(f)) return;
        if (f.soldier) promoted++;
        if (Math.hypot(f.position.x - before[k]!.x, f.position.z - before[k]!.z) > 1e-6) moved++;
        // A capsule is pushed out of the Walls round each block: its centre never inside one.
        expect(inBlock(field, f.position.x, f.position.z), `Fighter ${k} at Tick ${m.tick}`).toBe(false);
      });
    }
    expect(promoted).toBeGreaterThan(100);
    expect(moved).toBeGreaterThan(1000);
  }, 300_000);
});

describe("the Fort's keep, ramps and tunnel", () => {
  const arena = field.arena;
  const lv = tuning.battle.levels;
  const keep = (w: { points: readonly { y: number }[] }) => w.points.some((p) => p.y > 0);

  it("is a map of several levels that passes the walk check, with B on the keep's deck, the other Objectives on the ground, and the tunnel a floor of its own", () => {
    expect(field.layered).toBe(true);
    expect(walkCheck(arena, lv)).toBeNull();
    expect(arena.walk[field.objectiveSurfaces[2]!]!.id).toMatch(/^WALK_deck/);
    expect(soldierHeight(field, field.objectiveSurfaces[2]!, 0, 0)).toBe(4);
    for (const k of [0, 1, 3, 4]) expect(soldierHeight(field, field.objectiveSurfaces[k]!, field.objectives[k]!.x, field.objectives[k]!.z), `Objective ${k}`).toBe(0);
    // In the tunnel under B a Soldier stands on the ground, 4 m under the deck: not "the highest ground there".
    const tunnel = groundOf(tuning.battle, field, 0, 0, 0);
    expect(arena.walk[tunnel]!.id).not.toMatch(/^WALK_(deck|ramp)/);
    expect(soldierHeight(field, tunnel, 0, 0)).toBe(0);
    // Two ramps, and never a block under a deck or a ramp (a block pushes Soldiers off): the raised parts stand over no ground.
    expect(arena.walk.filter((w) => w.id.startsWith('WALK_ramp'))).toHaveLength(2);
    for (const w of arena.walk.filter(keep)) {
      const [x0, x1] = [Math.min(...w.points.map((p) => p.x)), Math.max(...w.points.map((p) => p.x))];
      const [z0, z1] = [Math.min(...w.points.map((p) => p.z)), Math.max(...w.points.map((p) => p.z))];
      for (const b of field.blocks) expect(x0 < b.maxX && x1 > b.minX && z0 < b.maxZ && z1 > b.minZ, `${w.id} over ${b.id}`).toBe(false);
    }
    // Over the keep's two halves and the ramps there is no ground at all; over the tunnel there is both the ground and the deck.
    const at = (x: number, z: number) => arena.walk.filter((_, i) => onSurface(arena, i, x, z));
    for (const [x, z] of [[-9, -8], [9, 8], [-20, 0], [20, 0]] as const) expect(at(x, z).every(keep), `(${x}, ${z})`).toBe(true);
    expect(at(0, 0).some(keep) && at(0, 0).some((w) => !keep(w))).toBe(true);
  });

  it('is its own half turn in its Walk Surfaces and its Walls as well as its blocks and Objectives', () => {
    const key = (pts: readonly { x: number; y: number; z: number }[], sign: number) =>
      pts
        .map((p) => `${(sign * p.x + 0).toFixed(3)},${p.y.toFixed(3)},${(sign * p.z + 0).toFixed(3)}`)
        .sort()
        .join(' ');
    const walks = new Set(fort.walk.map((w) => key(w.points, 1)));
    expect(fort.walk.length).toBeGreaterThan(50);
    for (const w of fort.walk) expect(walks.has(key(w.points, -1)), w.id).toBe(true);
    const wall = (w: { a: { x: number; z: number }; b: { x: number; z: number }; bottom: number; top: number }, sign: number) =>
      [[w.a.x, w.a.z], [w.b.x, w.b.z]]
        .map(([x, z]) => `${(sign * x! + 0).toFixed(3)},${(sign * z! + 0).toFixed(3)}`)
        .sort()
        .join(' ') + ` ${w.bottom} ${w.top}`;
    const walls = new Set(fort.walls.map((w) => wall(w, 1)));
    for (const w of fort.walls) expect(walls.has(wall(w, -1)), w.id).toBe(true);
    // And its ramps are each other's half turn, one up the west face and one up the east.
    const [rw, re] = ['WALK_ramp_w', 'WALK_ramp_e'].map((id) => fort.walk.find((w) => w.id === id)!);
    expect(key(rw!.points, -1)).toBe(key(re!.points, 1));
  });

  it('counts B for the Soldiers on the keep only, not for those in the tunnel under it', () => {
    const map = battleMapOf(tuning.battle, FORT);
    const c = createCrowd(tuning.battle, 1, 0, FORT);
    const mine = c.team.flatMap((t, i) => (t === 0 ? [i] : [])).slice(0, 10);
    // B's progress after one capture step with Team 0's first ten Soldiers at the same ten places (inside B's circle and the tunnel's width),
    // on the highest ground there (the deck) or on the ground at 0 m (the tunnel's floor).
    const progress = (y: number): number => {
      const [x, z, surface] = [c.x.slice(), c.z.slice(), c.surface.slice()];
      mine.forEach((i, k) => {
        [x[i], z[i]] = [(k - 4.5) / 2, k - 4.5];
        surface[i] = groundOf(tuning.battle, field, x[i]!, z[i]!, y);
      });
      return stepCrowd({ ...c, x, z, surface }, captureTicks(tuning.battle) * 7, tuning.battle, [], map).objectives.progress[2]!;
    };
    expect(progress(Infinity)).toBeGreaterThan(0);
    expect(progress(0)).toBe(0);
  });

  it('sends a Squad through the tunnel when the field shows it the shorter way, every Soldier on the right level, and round the keep when that is shorter', () => {
    const t = unplanned(tuning);
    const map = battleMapOf(t.battle, FORT);
    const linked = joins(t, FORT);
    const inTunnel = (x: number, z: number, surface: number) => Math.abs(x) < 3 && Math.abs(z) < 14 && soldierHeight(field, surface, x, z) === 0;
    // Squad 0 from the courtyard south of the keep to E, in the north: through the tunnel. Squad 1 from the west of the keep, level with
    // its south wall, to E: up the west side, round the keep.
    const goes = [
      { q: 0, x: 0, z: -24, heading: 0, target: 4 },
      { q: 1, x: -27, z: -10, heading: 0, target: 4 },
    ];
    let c = placed(t, FORT, goes);
    const seen = [0, 1].map(() => ({ anchor: 0, soldiers: new Set<number>(), closest: Infinity }));
    for (let tick = 1; tick <= 120 * 60; tick++) {
      const next = stepCrowd(c, tick, t.battle, [], map);
      checkLevels(t, FORT, linked, c, next, tick, raised);
      c = next;
      for (const q of [0, 1]) {
        if (inTunnel(c.squads.x[q]!, c.squads.z[q]!, c.squads.surface[q]!)) seen[q]!.anchor++;
        seen[q]!.closest = Math.min(seen[q]!.closest, Math.hypot(c.squads.x[q]! - field.objectives[4]!.x, c.squads.z[q]! - field.objectives[4]!.z));
        for (let i = 0; i < c.x.length; i++) if (c.squad[i] === q && inTunnel(c.x[i]!, c.z[i]!, c.surface[i]!)) seen[q]!.soldiers.add(i);
      }
    }
    // How near E each came (a Squad that got there may fall back from the enemy Base's fight before the end).
    const away = (q: number) => seen[q]!.closest;
    process.stderr.write(`Fort tunnel: Squad 0 anchor in the tunnel ${seen[0]!.anchor} Ticks (${seen[0]!.soldiers.size} Soldiers), Squad 1 ${seen[1]!.anchor} Ticks (${seen[1]!.soldiers.size}); they came within ${away(0).toFixed(1)} and ${away(1).toFixed(1)} m of E
`);
    expect(seen[0]!.anchor).toBeGreaterThan(0);
    expect(seen[0]!.soldiers.size).toBeGreaterThanOrEqual(10);
    expect(seen[1]!.anchor).toBe(0);
    expect(away(0)).toBeLessThan(12);
    expect(away(1)).toBeLessThan(12);
  }, 120_000);

  it("walks a Squad up a ramp from outside the east breach onto the keep to B, its Soldiers to their places on the deck, every Soldier on the right level", () => {
    const t = unplanned(tuning);
    const map = battleMapOf(t.battle, FORT);
    const linked = joins(t, FORT);
    let c: CrowdState = placed(t, FORT, [{ q: 0, x: 40, z: 2, heading: -Math.PI / 2, target: 2 }]);
    const members = c.squad.flatMap((s, i) => (s === 0 ? [i] : []));
    let up = -1;
    let ramp = 0;
    for (let tick = 1; tick <= 60 * 60 && up < 0; tick++) {
      const next = stepCrowd(c, tick, t.battle, [], map);
      checkLevels(t, FORT, linked, c, next, tick, raised);
      c = next;
      if (members.some((i) => arena.walk[c.surface[i]!]!.id.startsWith('WALK_ramp'))) ramp++;
      if (members.every((i) => soldierHeight(field, c.surface[i]!, c.x[i]!, c.z[i]!) === 4)) up = tick;
    }
    process.stderr.write(`Fort ramp: a Squad stood on the keep after ${(up / 60).toFixed(1)} s, ${ramp} Ticks with a Soldier on a ramp
`);
    expect(up).toBeGreaterThan(0);
    expect(ramp).toBeGreaterThan(60);
    expect(Math.hypot(c.squads.x[0]! - 0, c.squads.z[0]! - 0)).toBeLessThan(12);
    // B is held by it: a capture step with its Soldiers on the deck moves B toward Team 0.
    expect(stepCrowd(c, captureTicks(t.battle) * 9, t.battle, [], map).objectives.progress[2]!).toBeGreaterThan(0);
  }, 120_000);

  it("walks a Squad that stands pressed against a ramp's rail round to its foot and up, and does not take an enemy across the rail for contact", () => {
    const t = unplanned(tuning);
    const map = battleMapOf(t.battle, FORT);
    const linked = joins(t, FORT);
    // A rail is no block, but a Squad cannot walk through it: an enemy on the ramp, over the rail, is not in sight (at their heights).
    expect(inSight(map.fields, -22, -6.2, -22, -4, 0, 0, 0.44)).toBe(false);
    expect(inSight(map.fields, -22, -6.2, -22, -4)).toBe(true);
    // The Squad's anchor 0.2 m outside the west ramp's south rail, facing north into it, the way the field's cells once pinned it: it goes
    // down and round to the foot (x -23 and beyond), then up the ramp onto the keep.
    let c: CrowdState = placed(t, FORT, [{ q: 0, x: -21.5, z: -5.8, heading: 0, target: 2 }]);
    const members = c.squad.flatMap((s, i) => (s === 0 ? [i] : []));
    let up = -1;
    for (let tick = 1; tick <= 60 * 60 && up < 0; tick++) {
      const next = stepCrowd(c, tick, t.battle, [], map);
      checkLevels(t, FORT, linked, c, next, tick, raised);
      c = next;
      if (members.every((i) => soldierHeight(field, c.surface[i]!, c.x[i]!, c.z[i]!) === 4)) up = tick;
    }
    process.stderr.write(`Fort rail: a Squad pressed against the west ramp's rail stood on the keep after ${(up / 60).toFixed(1)} s
`);
    expect(up).toBeGreaterThan(0);
  }, 120_000);

  it("gives both Teams the same destination fields and clearance node by node, each node's half turn the other's (the tunnel's floor under the deck included)", () => {
    const f = battleMapOf(tuning.battle, FORT).fields;
    const L = f.levels!;
    expect(L.y.some((y) => y === 4) && L.y.some((y) => y === 0)).toBe(true);
    const cells = f.side * f.side;
    let overlapped = 0;
    for (let c = 0; c < cells; c++) {
      const m = cells - 1 - c;
      const n = L.start[c + 1]! - L.start[c]!;
      expect(L.start[m + 1]! - L.start[m]!, `cell ${c}`).toBe(n);
      if (n > 1) overlapped++;
      for (let k = 0; k < n; k++) {
        const [a, b] = [L.start[c]! + k, L.start[m]! + k];
        expect(L.y[b]).toBe(L.y[a]);
        expect(f.clearance![b]!, `cell ${c} node ${k}`).toBeCloseTo(f.clearance![a]!, 9);
        for (let d = 0; d < 5; d++) expect(f.dist[4 - d]![b]!, `cell ${c} node ${k} to ${d}`).toBeCloseTo(f.dist[d]![a]!, 6);
      }
    }
    // Under the keep's deck both levels stand in the same cells: the tunnel and the deck.
    expect(overlapped).toBeGreaterThan(2);
  });
});
