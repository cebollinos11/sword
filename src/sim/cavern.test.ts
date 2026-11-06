/**
 * The Cavern, a lava-river cave of cube platforms, ramps and bridges (ADR 0022): five Objectives (three up on terraces), 150 a side. Its map as
 * Tuning Data, its Battlefield (several levels, the lava river deadly ground the walk check leaves out), that every kind of unit walks to every
 * Objective, that a Fighter that steps off a bridge dies in the lava, and a whole AI Battle. NOT symmetric; nothing here tests balance.
 */
import { describe, expect, it } from 'vitest';
import { poolControllers, stepMatchWith, type Controller } from '../controllers';
import { battleCard, battleMapChoice, battleMaps } from '../play/lobbyView';
import { applyBattleKnobs, loadTuningData, parseBattle, type TuningData } from '../tuning';
import {
  arenaOf,
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
  walkCheck,
  type CrowdState,
} from '.';
import { checkLevels, joins, placed, unplanned } from './levelChecks.testdata';

const base = loadTuningData();
const map = base.battle.maps.cavern!;
const tuning: TuningData = { ...base, battle: applyBattleKnobs(base.battle, { map: 'cavern' }) };
const CAVERN = 'battle:cavern';
const field = battlefieldOf(tuning.battle, CAVERN)!;
const arena = field.arena;
const lv = tuning.battle.levels;

/** The Cavern's Objectives by letter, in the order a Battle numbers them. */
const [A, B, C, D, E] = [0, 1, 2, 3, 4];
const ALL = [A, B, C, D, E];
/** The floor each stands on, in metres. */
const FLOORS = [4, 4, 12, 8, 8];

describe('the Cavern as Tuning Data', () => {
  it('is a Battle map with five Objectives, two Bases and no blocks', () => {
    expect(map.name).toBe('cavern');
    expect(map.objectives.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(map.objectives.every((o) => o.owner === -1 && !o.spawn)).toBe(true);
    expect(map.blocks).toEqual([]);
    expect(map.armySize.standard).toBeLessThanOrEqual(map.armySize.max);
    expect(parseBattle(base.battle).maps.cavern).toEqual(map);
    expect(tuning.battle.armySize).toBe(map.armySize.standard);
  });
});

describe('the Lobby', () => {
  it('offers the Cavern beside the other maps, at its own army size', () => {
    expect(battleMaps(base).map((m) => m.id)).toContain('cavern');
    expect(battleMapChoice(base, { map: 'cavern' }).label).toBe('Cavern');
    expect(battleCard(tuning, { map: 'cavern' }).note).toMatch(/lava/);
  });
});

describe("the Cavern's Battlefield", () => {
  it('is a map of several levels that passes the walk check, with its Objectives on the right floors', () => {
    expect(arenaOf(tuning, CAVERN)).toBe(arena);
    expect(arena.jumpLinks).toBe(false);
    expect(field.layered).toBe(true);
    expect(walkCheck(arena, lv)).toBeNull();
    const height = (k: number) => soldierHeight(field, field.objectiveSurfaces[k]!, field.objectives[k]!.x, field.objectives[k]!.z);
    expect(ALL.map(height)).toEqual(FLOORS);
    // Every one is up: on a terrace, a dais or the keep.
    expect(ALL.filter((k) => height(k) > 3)).toHaveLength(5);
    // Soldiers deploy and respawn on the avenue's floor at each Base and at the front rank, clear of the town.
    for (const team of [0, 1]) expect(groundOf(tuning.battle, field, field.bases[team]!.x, field.bases[team]!.z)).toBeGreaterThanOrEqual(0);
  });

  it('has terraces at 4, 8 and 12 m and a lava river far below every ledge, with nothing a Soldier can drop into it', () => {
    const lava = arena.walk.filter((w) => w.lava);
    expect(lava.length).toBeGreaterThan(0);
    for (const w of lava) for (const p of w.points) expect(p.y).toBeLessThan(-lv.drop);
    const levels = new Set(arena.walk.filter((w) => !w.lava).flatMap((w) => w.points.map((p) => p.y)));
    expect([...levels].sort((a, b) => a - b)).toEqual([0, 4, 8, 12]);
  });
});

/** Where each Team's Squad 0 stands to march from: at its Base, in column, facing the enemy. */
const marches = [
  { team: 0, x: 0, z: -90, heading: 0 },
  { team: 1, x: 0, z: 90, heading: Math.PI },
];

describe('every Soldier can walk to every Objective', () => {
  const t = unplanned(tuning);
  const linked = joins(t, CAVERN);
  const m = battleMapOf(t.battle, CAVERN);
  const crowd0 = placed(t, CAVERN, []);
  const squadOf = (team: number): number => crowd0.squads.team.findIndex((tm) => tm === team);

  for (const { team, x, z, heading } of marches) {
    for (const target of ALL) {
      const letter = map.objectives[target]!.id;
      it(`Team ${team}'s Squad marches from its Base to ${letter} and stands on its floor`, () => {
        const q = squadOf(team);
        let c: CrowdState = placed(t, CAVERN, [{ q, x, z, heading, target }]);
        const members = c.squad.flatMap((s, i) => (s === q ? [i] : []));
        const site = field.objectives[target]!;
        const floor = soldierHeight(field, field.objectiveSurfaces[target]!, site.x, site.z);
        const there = (i: number) => Math.hypot(c.x[i]! - site.x, c.z[i]! - site.z) <= site.radius && Math.abs(soldierHeight(field, c.surface[i]!, c.x[i]!, c.z[i]!) - floor) < lv.height;
        let arrived = -1;
        for (let tick = 1; tick <= 300 * 60 && arrived < 0; tick++) {
          const next = stepCrowd(c, tick, t.battle, [], m);
          checkLevels(t, CAVERN, linked, c, next, tick, (id) => !id.startsWith('WALK_Z_') && !id.startsWith('WALK_L00'));
          c = next;
          if (members.every(there)) arrived = tick;
        }
        process.stderr.write(`Cavern: Team ${team}'s Squad stood on ${letter} after ${(arrived / 60).toFixed(0)} s\n`);
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

describe('a Fighter a Player drives walks the whole cavern', () => {
  it('walks from its spawn to A, B, C, D and E in turn, never leaving the floors', () => {
    // A small army whose Soldiers barely hurt, so the walk is not cut short.
    const knobs = applyBattleKnobs(base.battle, { map: 'cavern', armySize: 12 });
    const harmless = { ...tuning, battle: { ...knobs, tickets: { ...knobs.tickets, perSoldier: 1000, limitSeconds: 100_000 }, soldier: { ...base.battle.soldier, mods: { damage: 0.001 } } } };
    const at = (k: number) => ({ x: field.objectives[k]!.x, y: soldierHeight(field, field.objectiveSurfaces[k]!, field.objectives[k]!.x, field.objectives[k]!.z), z: field.objectives[k]!.z });
    const goals = [at(A), at(B), at(C), at(D), at(E), at(B)];
    const reached: number[] = [];
    const controllers = poolControllers(harmless, [walker(goals, reached)]);
    let m = createMatch(harmless, { format: 'Battle', bestOf: 1, seed: 5, arena: CAVERN, teams: [0], weapons: ['Longsword'] });
    let lowest = Infinity;
    for (let tick = 0; tick < 20 * 60 * 60 && reached.length < goals.length && m.status.status === 'InProgress'; tick++) {
      m = stepMatchWith(m, controllers, harmless);
      const f = m.duel.fighters[0]!;
      if (inDuel(f)) lowest = Math.min(lowest, f.y);
    }
    process.stderr.write(`Cavern: a Fighter reached its goals at ${reached.map((t) => (t / 60).toFixed(0)).join(', ')} s\n`);
    expect(reached).toHaveLength(goals.length);
    expect(lowest).toBeGreaterThan(-0.5); // it never fell into the lava
  }, 300_000);
});

describe('a Battle in the Cavern', () => {
  it('plays to its end by Tickets with every Soldier on the right level on every Tick, and the armies crossing between floors', () => {
    const linked = joins(tuning, CAVERN);
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: CAVERN });
    let crossed = 0;
    while (m.status.status === 'InProgress' && m.tick < 60_000) {
      const before = m.duel.crowd!;
      m = stepMatch(m, [], tuning);
      crossed += checkLevels(tuning, CAVERN, linked, before, m.duel.crowd!, m.tick, (id) => !id.startsWith('WALK_Z_') && !id.startsWith('WALK_L00'));
    }
    const seconds = m.tick / 60;
    process.stderr.write(`Cavern war: ${m.status.status} after ${seconds.toFixed(0)} s, ${crossed} crossings between floors\n`);
    expect(m.status.status).toBe('Over');
    expect(crossed).toBeGreaterThan(100);
  }, 600_000);

  it('starts and runs a minute of Ticks, every Soldier on a Walk Surface of the map', () => {
    let match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: CAVERN });
    for (let k = 0; k < 3600; k++) match = stepMatch(match, [], tuning);
    const c = match.duel.crowd!;
    for (let i = 0; i < c.x.length; i++) if (c.alive[i] && c.slot[i]! < 0) expect(onSurface(arena, c.surface[i]!, c.x[i]!, c.z[i]!), `Soldier ${i}`).toBe(true);
    expect(c.alive.some((a) => a)).toBe(true);
  }, 120_000);
});
