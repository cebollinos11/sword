/**
 * docs/plans/battle-objectives.md, Stage 3a: Battle maps as `ArenaGeometry`, and the Fort's first shape (ADR 0022). The Fort's map as
 * Tuning Data, its Battlefield (the floor's Walk Surfaces as the ground, Walls round every block, no jump Links), its symmetry, the
 * destination fields round its walls, the crude push that keeps Soldiers out of them, the army size per map, full Fighters routed round
 * the walls by the navmesh, and whole Battles on it: played to their end by Tickets, deterministic, and rolled back to the same state.
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
  corners,
  createMatch,
  findPath,
  fieldDistance,
  hashValue,
  inBlock,
  inDuel,
  inSight,
  isBattleName,
  navMesh,
  parseBattleName,
  pushOutOfBlocks,
  restore,
  snapshot,
  stepMatch,
  type MatchState,
  type Snapshot,
} from '.';

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
    for (const [x, z] of [[0, 0], [60, 0], [0, -32], [-90, 90]] as const) expect(battlefieldHeight(field.heights, x, z)).toBe(0);
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

/** An AI-v-AI Battle on the Fort, from `seed`, to its end (or `cap` Ticks): its last state, and any living Soldier ever found inside a block on a Crowd step. */
function war(seed: number, cap = 60_000): { m: MatchState; inside: number } {
  let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed, arena: FORT });
  let inside = 0;
  while (m.status.status === 'InProgress' && m.tick < cap) {
    m = stepMatch(m, [], tuning);
    const c = m.duel.crowd!;
    if (m.tick % tuning.battle.crowd.stagger === 0) for (let i = 0; i < c.x.length; i++) if (c.alive[i] && c.slot[i]! < 0 && inBlock(field, c.x[i]!, c.z[i]!)) inside++;
  }
  return { m, inside };
}

describe('Battles on the Fort', () => {
  it('play to their end by Tickets in about 6 to 8 minutes, no Soldier ever standing inside a wall', () => {
    for (const seed of [1, 2]) {
      const { m, inside } = war(seed);
      const c = m.duel.crowd!;
      expect(m.status.status, `seed ${seed}`).toBe('Over');
      expect(c.rout, `seed ${seed}`).not.toBeNull();
      const seconds = c.rout!.tick / 60;
      process.stderr.write(`Fort seed ${seed}: routed at ${seconds.toFixed(0)} s, Tickets ${c.tickets.map((t) => t.toFixed(0)).join(' / ')}\n`);
      expect(seconds).toBeGreaterThan(5 * 60);
      expect(seconds).toBeLessThan(10 * 60);
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
    for (let t = 0; t < 6000 && m.status.status === 'InProgress'; t++) {
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
