/**
 * docs/plans/battle-objectives.md, Stage 5: the Ziggurat, a four-tier stepped temple on rolling hills (ADR 0022). Its map as Tuning Data
 * (four Objectives, two of them over each other and told apart by `y`), its Battlefield (a map of several levels that passes the walk check),
 * its half turn, its 6 m corridors and ramps, and above all that every kind of unit can walk to every Objective: Squads of Soldiers from
 * each Team's Base to each Objective, and full Fighters by the navmesh from each Team's spawns and each Objective to every other.
 */
import { describe, expect, it } from 'vitest';
import { poolControllers, stepMatchWith, type Controller } from '../controllers';
import { battleCard, battleMapChoice, battleMaps } from '../play/lobbyView';
import { applyBattleKnobs, loadTuningData, parseBattle, type TuningData } from '../tuning';
import {
  arenaOf,
  battlefieldHeight,
  battlefieldOf,
  battleMapOf,
  corners,
  createMatch,
  findPath,
  IDLE_INTENT,
  inDuel,
  groundOf,
  navMesh,
  onSurface,
  soldierHeight,
  stepCrowd,
  stepMatch,
  surfaceHeight,
  walkCheck,
  type CrowdState,
} from '.';
import { checkLevels, joins, placed, unplanned } from './levelChecks.testdata';

const base = loadTuningData();
const map = base.battle.maps.ziggurat!;
const tuning: TuningData = { ...base, battle: applyBattleKnobs(base.battle, { map: 'ziggurat' }) };
const ZIG = 'battle:ziggurat';
const field = battlefieldOf(tuning.battle, ZIG)!;
const arena = field.arena;
const lv = tuning.battle.levels;

/** The Ziggurat's Objectives by letter, in the order a Battle numbers them. */
const [A, B, C, D] = [0, 1, 2, 3];

describe('the Ziggurat as Tuning Data', () => {
  it('is a Battle map with four Objectives (B in the plaza and C on the summit over it), two Bases and no blocks', () => {
    expect(map.name).toBe('ziggurat');
    expect(map.objectives.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(map.objectives.every((o) => o.owner === -1 && !o.spawn)).toBe(true);
    expect(map.objectives.map((o) => o.y)).toEqual([undefined, 0, 16, undefined]);
    expect(map.blocks).toEqual([]);
    expect(map.armySize.standard).toBeLessThanOrEqual(map.armySize.max);
    expect(parseBattle(base.battle).maps.ziggurat).toEqual(map);
    expect(tuning.battle.armySize).toBe(map.armySize.standard);
    expect(() => parseBattle({ ...base.battle, maps: { ziggurat: { ...map, objectives: map.objectives.map((o) => (o.id === 'B' ? { ...o, y: 'high' } : o)) } } })).toThrow(/\.y must be a number/);
  });

  it('is its own half turn: every Walk Surface and Wall has its half turn among them, the Objectives and Bases mirror in x and z', () => {
    const key = (pts: readonly { x: number; y: number; z: number }[], sign: number) =>
      pts
        .map((p) => `${(sign * p.x + 0).toFixed(3)},${p.y.toFixed(3)},${(sign * p.z + 0).toFixed(3)}`)
        .sort()
        .join(' ');
    const walks = new Set(map.walk.map((w) => key(w.points, 1)));
    for (const w of map.walk) expect(walks.has(key(w.points, -1)), w.id).toBe(true);
    const wall = (w: { a: { x: number; z: number }; b: { x: number; z: number }; bottom: number; top: number }, sign: number) =>
      [[w.a.x, w.a.z], [w.b.x, w.b.z]]
        .map(([x, z]) => `${(sign * x! + 0).toFixed(3)},${(sign * z! + 0).toFixed(3)}`)
        .sort()
        .join(' ') + ` ${w.bottom} ${w.top}`;
    const walls = new Set(map.walls.map((w) => wall(w, 1)));
    for (const w of map.walls) expect(walls.has(wall(w, -1)), w.id).toBe(true);
    const o = map.objectives;
    expect([o[A]!.x, o[A]!.z]).toEqual([-o[D]!.x + 0, -o[D]!.z + 0]);
    expect([o[B]!.x, o[B]!.z]).toEqual([o[C]!.x, o[C]!.z]);
    expect([map.bases[1].x, map.bases[1].z]).toEqual([-map.bases[0].x + 0, -map.bases[0].z]);
  });
});

describe('the Lobby', () => {
  it('offers the Ziggurat beside the Fort and the open field, at its own army size', () => {
    expect(battleMaps(base).map((m) => m.id)).toEqual(['open', 'fort', 'ziggurat', 'city']);
    expect(battleMapChoice(base, { map: 'ziggurat' }).label).toBe('Ziggurat');
    expect(battleCard(tuning, { map: 'ziggurat' }).note).toMatch(/stepped temple/);
  });
});

describe("the Ziggurat's Battlefield", () => {
  it('is a map of several levels that passes the walk check, with its Objectives on the right floors', () => {
    expect(arenaOf(tuning, ZIG)).toBe(arena);
    expect(arena.jumpLinks).toBe(false);
    expect(field.layered).toBe(true);
    expect(walkCheck(arena, lv)).toBeNull();
    const height = (k: number) => soldierHeight(field, field.objectiveSurfaces[k]!, field.objectives[k]!.x, field.objectives[k]!.z);
    expect([A, B, C, D].map(height)).toEqual([8, 0, 16, 8]);
    // The summit lies over the plaza, so the highest ground at B's place is the summit's: only `y` puts B on the floor.
    expect(battlefieldHeight(field.heights, 0, 0)).toBe(16);
    expect(field.objectiveSurfaces[B]).not.toBe(field.objectiveSurfaces[C]);
    // Soldiers deploy and respawn on the hills' floor at each Base and at the front rank, clear of the temple.
    for (const team of [0, 1]) expect(groundOf(tuning.battle, field, field.bases[team]!.x, field.bases[team]!.z)).toBeGreaterThanOrEqual(0);
  });

  it('has 6 m corridors and ramps, four floors up (4, 8, 12 and 16 m), and ground rolling above 2 m beyond the apron', () => {
    const levels = new Set(arena.walk.flatMap((w) => w.points.map((p) => p.y)).filter((y) => Number.isInteger(y)));
    expect([...levels].filter((y) => y > 3.9 && y % 4 === 0).sort((a, b) => a - b)).toEqual([4, 8, 12, 16]);
    const ramps = arena.walk.filter((w) => w.id.startsWith('WALK_ramp'));
    expect(ramps).toHaveLength(2 * 2 + 16);
    for (const r of ramps) {
      const xs = r.points.map((p) => p.x);
      const zs = r.points.map((p) => p.z);
      const [dx, dz] = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
      expect([dx, dz].some((d) => Math.abs(d - 6) < 1e-6), `${r.id} is 6 m wide`).toBe(true);
      expect(Math.abs(Math.max(...r.points.map((p) => p.y)) - Math.min(...r.points.map((p) => p.y))) > 3.9).toBe(true);
    }
    expect(Math.max(...arena.walk.filter((w) => w.id.startsWith('WALK_h')).flatMap((w) => w.points.map((p) => p.y)))).toBeGreaterThan(2);
    // No Soldier ever needs to drop: nothing is a step down of more than a drop but the rails and faces stop it.
    expect(Math.min(...arena.walk.flatMap((w) => w.points.map((p) => p.y)))).toBe(0);
  });

  it('has the ground, the plaza floor and every terrace under their own Walk Surfaces at the places that matter', () => {
    const at = (x: number, z: number) =>
      arena.walk
        .map((_, i) => i)
        .filter((i) => onSurface(arena, i, x, z))
        .map((i) => surfaceHeight(arena, i, x, z))
        .sort((a, b) => a - b);
    expect(at(3, -75)).toEqual([0]);
    expect(at(0, 0)).toEqual([0, 16]);
    expect(at(30, 30)).toEqual([8]);
    expect(at(-42, -42)).toEqual([4]);
    // Inside the first tier's mass there is no ground: the hall and its corridors are the only way in.
    expect(at(-30, 9)).toEqual([8]);
    expect(at(12, -40)).toEqual([0, 4]);
  });
});

/** Where each Team's Squad 0 stands to march from: at its Base, in column, facing the enemy. */
const marches = [
  { team: 0, x: 0, z: -88, heading: 0 },
  { team: 1, x: 0, z: 88, heading: Math.PI },
];

describe('every Soldier can walk to every Objective', () => {
  const t = unplanned(tuning);
  const linked = joins(t, ZIG);
  const m = battleMapOf(t.battle, ZIG);
  const crowd0 = placed(t, ZIG, []);
  const squadOf = (team: number): number => crowd0.squads.team.findIndex((tm) => tm === team);

  for (const { team, x, z, heading } of marches) {
    for (const target of [A, B, C, D]) {
      const letter = map.objectives[target]!.id;
      it(`Team ${team}'s Squad marches from its Base to ${letter} and stands on its floor`, () => {
        const q = squadOf(team);
        let c: CrowdState = placed(t, ZIG, [{ q, x, z, heading, target }]);
        const members = c.squad.flatMap((s, i) => (s === q ? [i] : []));
        const site = field.objectives[target]!;
        const floor = soldierHeight(field, field.objectiveSurfaces[target]!, site.x, site.z);
        const there = (i: number) => Math.hypot(c.x[i]! - site.x, c.z[i]! - site.z) <= site.radius && Math.abs(soldierHeight(field, c.surface[i]!, c.x[i]!, c.z[i]!) - floor) < lv.height;
        let arrived = -1;
        for (let tick = 1; tick <= 240 * 60 && arrived < 0; tick++) {
          const next = stepCrowd(c, tick, t.battle, [], m);
          checkLevels(t, ZIG, linked, c, next, tick, (id) => !id.startsWith('WALK_h') && !id.startsWith('WALK_L00'));
          c = next;
          if (members.every(there)) arrived = tick;
        }
        process.stderr.write(`Ziggurat: Team ${team}'s Squad stood on ${letter} after ${(arrived / 60).toFixed(0)} s\n`);
        expect(arrived).toBeGreaterThan(0);
      }, 120_000);
    }
  }
});

describe('every full Fighter can walk to every Objective', () => {
  const mesh = navMesh(arena, tuning);
  const spots = [
    ...arena.spawns.map((s) => ({ name: `Team ${s.team} spawn ${s.slot}`, x: s.position.x, z: s.position.z, y: s.position.y })),
    ...field.objectives.map((o, k) => ({ name: `Objective ${o.id}`, x: o.x, z: o.z, y: soldierHeight(field, field.objectiveSurfaces[k]!, o.x, o.z) })),
  ];

  it('has no jump Link and links every Walk Surface to the next', () => {
    expect(mesh.links.some((l) => l.kind === 'jump')).toBe(false);
    expect(mesh.links.length).toBeGreaterThan(arena.walk.length);
  });

  it('finds a path by walking from every spawn and every Objective to every Objective', () => {
    for (const from of spots) {
      for (const [k, o] of field.objectives.entries()) {
        const to = { x: o.x, y: soldierHeight(field, field.objectiveSurfaces[k]!, o.x, o.z), z: o.z };
        const path = findPath(arena, tuning, { x: from.x, y: from.y, z: from.z }, to, { jumps: false });
        expect(path, `${from.name} to ${o.id}`).not.toBeNull();
      }
    }
  });
});

/** A Player's Controller that walks its Fighter by the navmesh to each of `goals` in turn (x, y, z), and never attacks. */
function walker(goals: readonly { x: number; y: number; z: number }[], reached: number[]): Controller {
  return {
    intent(state, fighter) {
      const self = state.fighters[fighter];
      const goal = goals[reached.length];
      if (!self || !inDuel(self) || !goal) return IDLE_INTENT;
      const here = { x: self.position.x, y: self.y, z: self.position.z };
      if (Math.hypot(goal.x - here.x, goal.z - here.z) < 2.5 && Math.abs(goal.y - here.y) < 1.5) {
        reached.push(state.tick);
        return IDLE_INTENT;
      }
      const path = findPath(arena, tuning, here, goal, { jumps: false });
      if (!path) return IDLE_INTENT;
      const next = corners(arena, tuning, path, here, goal)[0] ?? goal;
      const d = Math.hypot(next.x - here.x, next.z - here.z) || 1;
      return { ...IDLE_INTENT, move: { x: (next.x - here.x) / d, z: (next.z - here.z) / d }, face: Math.atan2(next.x - here.x, next.z - here.z) };
    },
  };
}

describe('a Fighter a Player drives walks the whole temple', () => {
  it('walks from its spawn to A on the second terrace, down to B in the plaza, up to the summit C, and on to D, never leaving the floors', () => {
    // A small army whose Soldiers barely hurt, so the walk is not cut short.
    const knobs = applyBattleKnobs(base.battle, { map: 'ziggurat', armySize: 12 });
    const harmless = { ...tuning, battle: { ...knobs, tickets: { ...knobs.tickets, perSoldier: 1000, limitSeconds: 100_000 }, soldier: { ...base.battle.soldier, mods: { damage: 0.001 } } } };
    const at = (k: number) => ({ x: field.objectives[k]!.x, y: soldierHeight(field, field.objectiveSurfaces[k]!, field.objectives[k]!.x, field.objectives[k]!.z), z: field.objectives[k]!.z });
    const goals = [at(A), at(B), at(C), at(D), at(B)];
    const reached: number[] = [];
    const controllers = poolControllers(harmless, [walker(goals, reached)]);
    let m = createMatch(harmless, { format: 'Battle', bestOf: 1, seed: 5, arena: ZIG, teams: [0], weapons: ['Longsword'] });
    let lowest = Infinity;
    for (let tick = 0; tick < 15 * 60 * 60 && reached.length < goals.length && m.status.status === 'InProgress'; tick++) {
      m = stepMatchWith(m, controllers, harmless);
      const f = m.duel.fighters[0]!;
      if (inDuel(f)) lowest = Math.min(lowest, f.y);
    }
    process.stderr.write(`Ziggurat: a Fighter reached its goals at ${reached.map((t) => (t / 60).toFixed(0)).join(', ')} s
`);
    expect(reached).toHaveLength(goals.length);
    expect(lowest).toBeGreaterThan(-0.5);
  }, 300_000);
});

describe('a Battle on the Ziggurat', () => {
  it('plays to its end by Tickets with every Soldier on the right level on every Tick, and the armies crossing between floors', () => {
    const linked = joins(tuning, ZIG);
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: ZIG });
    let crossed = 0;
    while (m.status.status === 'InProgress' && m.tick < 60_000) {
      const before = m.duel.crowd!;
      m = stepMatch(m, [], tuning);
      crossed += checkLevels(tuning, ZIG, linked, before, m.duel.crowd!, m.tick, (id) => !id.startsWith('WALK_h') && !id.startsWith('WALK_L00'));
    }
    const seconds = m.tick / 60;
    process.stderr.write(`Ziggurat war: ${m.status.status} after ${seconds.toFixed(0)} s, ${crossed} crossings between floors
`);
    expect(m.status.status).toBe('Over');
    expect(crossed).toBeGreaterThan(100);
  }, 600_000);

  it('starts and runs a minute of Ticks, every Soldier on a Walk Surface of the map', () => {
    let match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: ZIG });
    for (let k = 0; k < 3600; k++) match = stepMatch(match, [], tuning);
    const c = match.duel.crowd!;
    for (let i = 0; i < c.x.length; i++) if (c.alive[i] && c.slot[i]! < 0) expect(onSurface(arena, c.surface[i]!, c.x[i]!, c.z[i]!), `Soldier ${i}`).toBe(true);
    expect(c.alive.some((a) => a)).toBe(true);
  }, 120_000);
});
