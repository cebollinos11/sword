/**
 * A Floor's Crowd at its start (docs/plans/delver.md, Stage 3): the plan's posts and patrol loops filled by seeded picks, a Warband
 * (a Squad of Team 1 Soldiers from a tier's template) deployed on each filled one. Pure, from (Run seed, Floor, humans): every peer deals
 * the same Crowd with nothing sent. The homes the brain walks back to are derived from the plan and cached, never stored in the Simulation.
 */
import { clampSize, troopBodies, type TuningData } from '../../tuning';
import type { WarbandTemplate } from '../../tuning/delver';
import { groundOf, type Battlefield } from '../battlefield';
import type { CrowdState } from '../crowd';
import { runPick } from '../dungeon';
import { createObjectives } from '../objectives';
import { createRng } from '../rng';
import { COLUMN, DEFEND, placeOffset } from '../squad';
import { GUARD, PATROL } from '../warband';
import type { FloorPlan } from './plan';

/** `runPick` salts for the Warbands' picks, apart from the Floor generator's (`SALT`). */
export const WARBAND_SALT = { postOrder: 20, patrolOrder: 21, guardPick: 22, patrolPick: 23, extra: 24, height: 25, thick: 26, look: 27 } as const;

/** The homes the brain reads (derived from the plan, never state): each post with its guard facing, each patrol loop's points. */
export interface WarbandHomes {
  readonly posts: readonly { readonly x: number; readonly z: number; readonly facing: number }[];
  readonly patrols: readonly (readonly { readonly x: number; readonly z: number }[])[];
}

/** The facings (radians; 0 faces +z) into a Passage on a Hall's sides, in the order n, e, s, w: the Passage's side of the Hall. */
const NORTH = 0;
const EAST = Math.PI / 2;
const SOUTH = Math.PI;
const WEST = -Math.PI / 2;

/**
 * A guard's facing at the post in Hall `hall`: the side (n, e, s, w; the earlier on a tie) whose Passage leads to the neighbour Hall of
 * least `depth`, which is the way the party comes. 0 for a Hall with no Passage.
 */
function guardFacing(plan: FloorPlan, hall: number): number {
  // Passage `a` is west of `b` (axis 'x') or south of it (axis 'z'): a Hall's n and e neighbours are the `b` of its Passages, s and w the `a`.
  const sides = [
    { axis: 'z', own: 'a', facing: NORTH },
    { axis: 'x', own: 'a', facing: EAST },
    { axis: 'z', own: 'b', facing: SOUTH },
    { axis: 'x', own: 'b', facing: WEST },
  ] as const;
  let best = Infinity;
  let facing = 0;
  for (const side of sides) {
    for (const p of plan.passages) {
      if (p.axis !== side.axis || p[side.own] !== hall) continue;
      const depth = plan.halls[side.own === 'a' ? p.b : p.a]!.depth;
      if (depth < best) [best, facing] = [depth, side.facing];
    }
  }
  return facing;
}

const homes = new WeakMap<FloorPlan, WarbandHomes>();

/** The plan's homes (each post with its guard facing, each loop's points), derived once per plan and kept. Never state. */
export function warbandHomes(plan: FloorPlan): WarbandHomes {
  let kept = homes.get(plan);
  if (!kept) {
    kept = {
      posts: plan.markers.posts.map((p) => ({ x: p.x, z: p.z, facing: guardFacing(plan, p.hall) })),
      patrols: plan.markers.patrols.map((loop) => loop.points.map((p) => ({ x: p.x, z: p.z }))),
    };
    homes.set(plan, kept);
  }
  return kept;
}

/** The slots 0 to `count - 1` that are filled: the first `ceil(count * fill / 100)` by a seeded order (the lower index on a tie), back in slot order. */
function filled(seed: number, floor: number, count: number, fill: number, salt: number): number[] {
  const order = Array.from({ length: count }, (_, i) => ({ i, key: runPick(seed, floor, i, salt, 0x1_0000_0000) }));
  order.sort((a, b) => a.key - b.key || a.i - b.i);
  return order
    .slice(0, Math.ceil((count * fill) / 100))
    .map((o) => o.i)
    .sort((a, b) => a - b);
}

/** A facing toward `to` from `from` along the axis they differ on (the points of a loop are axis-aligned: no trig). */
function facingToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  if (to.x > from.x) return EAST;
  if (to.x < from.x) return WEST;
  if (to.z > from.z) return NORTH;
  if (to.z < from.z) return SOUTH;
  return 0;
}

interface Planned {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly template: WarbandTemplate;
  readonly encounter: number;
  readonly post: number;
  readonly patrol: number;
  readonly leg: number;
}

/**
 * The Floor's Crowd at its start (pure): the filled posts' guards in post order, then the filled loops' patrols in loop order, Warband q being
 * Squad q. `tuning` is the Floor's `arenaTuning` and `field` its Battlefield. Each Warband stands in a column at its home (a guard at its post
 * facing the way the party comes, a patrol at its loop's start facing its next point), on the floor (never a roof); `humans` makes each
 * bigger by `perPlayerSoldiers` per human beyond the first. With nothing filled (`postFill` and `patrolFill` 0) every array is empty.
 */
export function deployWarbands(tuning: TuningData, plan: FloorPlan, field: Battlefield, seed: number, floor: number, humans: number): CrowdState {
  const { battle, delver } = tuning;
  const tier = Math.min(delver.tiers, Math.max(1, Math.ceil(floor / delver.floorsPerTier)));
  const pools = delver.warbands[tier - 1]!;
  const hpOfTier = delver.tierHp[tier - 1]!;
  const { posts, patrols } = plan.markers;
  const home = warbandHomes(plan);

  const planned: Planned[] = [];
  for (const k of filled(seed, floor, posts.length, delver.postFill, WARBAND_SALT.postOrder)) {
    const encounter = runPick(seed, floor, k, WARBAND_SALT.guardPick, pools.guard.length);
    const at = home.posts[k]!;
    planned.push({ x: at.x, z: at.z, facing: at.facing, template: pools.guard[encounter]!, encounter, post: k, patrol: -1, leg: 0 });
  }
  for (const k of filled(seed, floor, patrols.length, delver.patrolFill, WARBAND_SALT.patrolOrder)) {
    const encounter = runPick(seed, floor, k, WARBAND_SALT.patrolPick, pools.patrol.length);
    const loop = patrols[k]!;
    const points = home.patrols[k]!;
    // It starts at the first point whose Hall is neither a Fight Hall nor the Stairs', else the first, walking to the next.
    let start = loop.halls.findIndex((h) => plan.halls[h]!.kind !== 'Fight' && plan.halls[h]!.kind !== 'Stairs');
    if (start < 0) start = 0;
    const leg = (start + 1) % points.length;
    const at = points[start]!;
    planned.push({ x: at.x, z: at.z, facing: facingToward(at, points[leg]!), template: pools.patrol[encounter]!, encounter, post: -1, patrol: k, leg });
  }

  const extra = delver.perPlayerSoldiers * Math.max(0, humans - 1);
  const whole = Math.floor(extra);
  const out: [number, number] = [0, 0];
  const x: number[] = [];
  const z: number[] = [];
  const surface: number[] = [];
  const heading: number[] = [];
  const hp: number[] = [];
  const sizeHeight: number[] = [];
  const sizeThick: number[] = [];
  const troopOf: number[] = [];
  const look: number[] = [];
  const squad: number[] = [];
  const place: number[] = [];
  const squads = {
    team: [] as number[], x: [] as number[], z: [] as number[], heading: [] as number[], aim: [] as number[], speed: [] as number[], shape: [] as number[],
    living: [] as number[], fall: [] as number[], order: [] as number[], target: [] as number[], since: [] as number[], respawnAt: [] as number[], surface: [] as number[],
  };
  const warbands = { mode: [] as number[], post: [] as number[], patrol: [] as number[], leg: [] as number[], chased: [] as number[], seen: [] as number[], size: [] as number[], encounter: [] as number[] };

  planned.forEach((w, q) => {
    // The template's Troops in list order, then the party's extras, all of the first Troop; the total held to a Squad's size.
    const troops: number[] = [];
    for (const row of w.template.troops) for (let c = 0; c < row.count; c++) troops.push(row.troop);
    const more = whole + (runPick(seed, floor, q, WARBAND_SALT.extra, 100) < Math.round(100 * (extra - whole)) ? 1 : 0);
    for (let c = 0; c < more && troops.length < battle.squad.size; c++) troops.push(w.template.troops[0]!.troop);

    const anchorSurface = groundOf(battle, field, w.x, w.z, 0);
    troops.forEach((t, p) => {
      const i = x.length;
      const troop = battle.troops[t]!;
      placeOffset(battle, COLUMN, p, w.facing, out);
      const px = w.x + out[0];
      const pz = w.z + out[1];
      const along = (range: readonly [number, number] | undefined, salt: number): number =>
        range ? range[0] + ((range[1] - range[0]) * runPick(seed, floor, i, salt, 1001)) / 1000 : 1;
      const size = clampSize({ height: along(troop.height, WARBAND_SALT.height), thick: along(troop.width, WARBAND_SALT.thick) });
      x.push(px);
      z.push(pz);
      surface.push(groundOf(battle, field, px, pz, 0));
      heading.push(w.facing);
      hp.push(troop.hp * w.template.hpScale * hpOfTier);
      sizeHeight.push(size.height);
      sizeThick.push(size.thick);
      troopOf.push(t);
      look.push(runPick(seed, floor, i, WARBAND_SALT.look, troopBodies(troop, 1).length));
      squad.push(q);
      place.push(p);
    });

    squads.team.push(1);
    squads.x.push(w.x);
    squads.z.push(w.z);
    squads.heading.push(w.facing);
    squads.aim.push(w.facing);
    squads.speed.push(0);
    squads.shape.push(COLUMN);
    squads.living.push(troops.length);
    squads.fall.push(0);
    squads.order.push(DEFEND);
    squads.target.push(-1);
    squads.since.push(0);
    squads.respawnAt.push(-1);
    squads.surface.push(anchorSurface);
    warbands.mode.push(w.post >= 0 ? GUARD : PATROL);
    warbands.post.push(w.post);
    warbands.patrol.push(w.patrol);
    warbands.leg.push(w.leg);
    warbands.chased.push(-1);
    warbands.seen.push(-1);
    warbands.size.push(troops.length);
    warbands.encounter.push(w.encounter);
  });

  const n = x.length;
  return {
    x,
    z,
    surface,
    vx: new Array<number>(n).fill(0),
    vz: new Array<number>(n).fill(0),
    heading,
    hp,
    team: new Array<number>(n).fill(1),
    target: new Array<number>(n).fill(-1),
    engage: new Array<number>(n).fill(0),
    alive: new Array<number>(n).fill(1),
    slot: new Array<number>(n).fill(-1),
    sizeHeight,
    sizeThick,
    troop: troopOf,
    look,
    squad,
    place,
    squads,
    objectives: createObjectives([]),
    tickets: [0, 0],
    rng: createRng((seed ^ Math.imul(floor, 0x9e3779b9)) >>> 0),
    rout: null,
    players: [],
    maxHp: hp.slice(),
    warbands,
  };
}
