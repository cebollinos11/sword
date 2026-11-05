/**
 * The level check of docs/plans/battle-objectives.md, Stage 4a's Done, shared by the tests of every Battle map of several levels (the test
 * maps of `levelMaps.testdata.ts` in `levels.test.ts`, the Fort's keep in `fort.test.ts`): after every Tick each living Soldier in the
 * Crowd stands on its Walk Surface at its height, and has crossed between surfaces only by a walk or drop Link of the full Fighters' navmesh.
 */
import { expect } from 'vitest';
import type { TuningData } from '../tuning';
import { ATTACK, battlefieldOf, COLUMN, createCrowd, groundOf, navMesh, onSurface, placeOffset, RESPAWN, soldierHeight, surfaceHeight, type CrowdState } from '.';

/** The Walk Surfaces each Walk Surface of `name`'s Battlefield joins by a walk or drop Link of the full Fighters' navmesh. */
export function joins(t: TuningData, name: string): Set<number>[] {
  const arena = battlefieldOf(t.battle, name)!.arena;
  const mesh = navMesh(arena, t);
  return arena.walk.map((_, k) => new Set(mesh.out[k]!.map((id) => mesh.links[id]!).filter((l) => l.kind === 'walk' || l.kind === 'drop').map((l) => l.to)));
}

/** Whether a Walk Surface counts as a raised level when `checkLevels` tallies crossings: on the test maps, any but the ground. */
export type RaisedLevel = (id: string) => boolean;
const notGround: RaisedLevel = (id) => !id.startsWith('ground');

/**
 * The level check, every step: each living Soldier in the Crowd stands on its Walk Surface (its polygon holds its place, and its height is
 * that surface's there), and one that changed surface since `before` walked or dropped across a walk or drop Link of the navmesh (or two,
 * past a corner where three surfaces meet), never up more than a step and never down more than a drop. Fails on the first that does not;
 * returns how many crossed onto or off a raised level (a ramp, a deck, the rampart's top or the tunnel on the test maps; `raised` says).
 */
export function checkLevels(t: TuningData, name: string, linked: readonly Set<number>[], before: CrowdState, after: CrowdState, tick: number, raised: RaisedLevel = notGround): number {
  const lv = t.battle.levels;
  const field = battlefieldOf(t.battle, name)!;
  const arena = field.arena;
  let crossed = 0;
  // Plain checks, failed by `expect` only when one fails: an `expect` a Soldier a Tick would cost most of the test.
  const fail = (what: string, i: number) => expect.fail(`Soldier ${i} at Tick ${tick} (${after.x[i]!.toFixed(2)}, ${after.z[i]!.toFixed(2)}) on ${arena.walk[after.surface[i]!]?.id}: ${what}`);
  for (let i = 0; i < after.x.length; i++) {
    if (!after.alive[i] || after.slot[i]! >= 0) continue;
    const s = after.surface[i]!;
    if (!onSurface(arena, s, after.x[i]!, after.z[i]!)) fail('not on its Walk Surface', i);
    if (soldierHeight(field, s, after.x[i]!, after.z[i]!) !== surfaceHeight(arena, s, after.x[i]!, after.z[i]!)) fail('not at its height', i);
    if (!before.alive[i] || before.slot[i]! >= 0) continue;
    const r = before.surface[i]!;
    if (r === s) continue;
    if (![...linked[r]!].some((c) => c === s || [...linked[c]!].some((d) => d === s || linked[d]!.has(s)))) fail(`from ${arena.walk[r]!.id} with no walk or drop Link`, i);
    const from = surfaceHeight(arena, r, before.x[i]!, before.z[i]!);
    const to = surfaceHeight(arena, s, after.x[i]!, after.z[i]!);
    if (to - from >= lv.stepUp + 0.3) fail(`climbed ${(to - from).toFixed(2)} m`, i);
    if (from - to > lv.drop + 0.3) fail(`dropped ${(from - to).toFixed(2)} m`, i);
    if (raised(arena.walk[r]!.id) || raised(arena.walk[s]!.id)) crossed++;
  }
  return crossed;
}

/** Tuning Data whose Commanders give Orders only at deployment (a test then gives the Squads it watches their own). */
export const unplanned = (t: TuningData): TuningData => ({ ...t, battle: { ...t.battle, commander: { ...t.battle.commander, planSeconds: 1e6 } } });

/**
 * A Crowd on `name` where every Squad awaits Orders where it deployed but those `moved`, which stand in column at their (x, z) facing
 * `heading`, ordered to attack Objective `target`.
 */
export function placed(t: TuningData, name: string, moved: readonly { q: number; x: number; z: number; heading: number; target: number }[]): CrowdState {
  const crowd = createCrowd(t.battle, 1, 0, name);
  const field = battlefieldOf(t.battle, name)!;
  const sq = crowd.squads;
  const order = sq.order.map(() => RESPAWN);
  const [ax, az, heading, aim, target, surface] = [sq.x.slice(), sq.z.slice(), sq.heading.slice(), sq.aim.slice(), sq.target.slice(), sq.surface.slice()];
  const x = crowd.x.slice();
  const z = crowd.z.slice();
  const on = crowd.surface.slice();
  const out: [number, number] = [0, 0];
  for (const m of moved) {
    [ax[m.q], az[m.q], heading[m.q], aim[m.q], target[m.q], order[m.q]] = [m.x, m.z, m.heading, m.heading, m.target, ATTACK];
    surface[m.q] = groundOf(t.battle, field, m.x, m.z);
    for (let i = 0; i < x.length; i++) {
      if (crowd.squad[i] !== m.q) continue;
      placeOffset(t.battle, COLUMN, crowd.place[i]!, m.heading, out);
      x[i] = m.x + out[0];
      z[i] = m.z + out[1];
      on[i] = groundOf(t.battle, field, x[i]!, z[i]!);
    }
  }
  return { ...crowd, x, z, surface: on, squads: { ...sq, x: ax, z: az, heading, aim, target, order, surface } };
}
