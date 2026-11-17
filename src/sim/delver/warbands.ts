/**
 * A Floor's Crowd at its start (docs/plans/delver.md, Stage 3): the plan's posts and patrol loops filled by seeded picks, a Warband
 * (a Squad of Team 1 Soldiers from a tier's template) deployed on each filled one. Pure, from (Run seed, Floor, humans): every peer deals
 * the same Crowd with nothing sent. The homes the brain walks back to are derived from the plan and cached, never stored in the Simulation.
 */
import { MAX_SQUAD_PLACES, type DelverTuning, type TuningData } from '../../tuning';
import type { WarbandTemplate } from '../../tuning/delver';
import { groundOf, type Battlefield } from '../battlefield';
import type { CrowdState } from '../crowd';
import { runPick } from '../dungeon';
import { createObjectives } from '../objectives';
import { createRng } from '../rng';
import { relicMods } from '../inventory';
import { COLUMN, DEFEND, placeOffset } from '../squad';
import { BOSS, ELITE, GUARD, PATROL, PLAIN, RETURN } from '../warband';
import type { FloorPlan } from './plan';
import { floorPrefabs, floorTroops, sizeOfHp, tierOf } from './troops';

/** `runPick` salts for the Warbands' picks, apart from the Floor generator's (`SALT`). */
export const WARBAND_SALT = { postOrder: 20, patrolOrder: 21, guardPick: 22, patrolPick: 23, extra: 24, prefab: 25, variant: 26, elitePick: 28, bossGuard: 29 } as const;

/**
 * The places a Warband's picks are keyed over: place p of Warband q picks as slot `q * PICK_PLACES + p`. It must be at least a Squad's
 * most places (MAX_SQUAD_PLACES), or one Warband's picks would share slots with the next's; kept above it so raising that cap moves no pick.
 */
const PICK_PLACES = 256;
if (PICK_PLACES < MAX_SQUAD_PLACES) throw new Error(`PICK_PLACES (${PICK_PLACES}) must be at least MAX_SQUAD_PLACES (${MAX_SQUAD_PLACES})`);

/** The homes the brain reads (derived from the plan, never state): each post with its guard facing, each patrol loop's points. */
export interface WarbandHomes {
  readonly posts: readonly { readonly x: number; readonly y: number; readonly z: number; readonly facing: number }[];
  readonly patrols: readonly (readonly { readonly x: number; readonly y: number; readonly z: number }[])[];
}

/** The facings (radians; 0 faces +z) into a Passage on a Hall's sides, in the order n, e, s, w: the Passage's side of the Hall. */
const NORTH = 0;
const EAST = Math.PI / 2;
const SOUTH = Math.PI;
const WEST = -Math.PI / 2;

/**
 * A guard's facing at the post in Hall `hall`: the side (n, e, s, w; the earlier on a tie, and the earlier Passage within a side) whose Passage
 * leads to the neighbour Hall of least `depth`, which is the way the party comes. A Passage leaves Hall `a` by its `sideA` and Hall `b` by its
 * `sideB`, so a turning Passage counts for the side it leaves by, not its first leg's axis. 0 for a Hall with no Passage.
 */
function guardFacing(plan: FloorPlan, hall: number): number {
  const sides = [
    { side: 'n', facing: NORTH },
    { side: 'e', facing: EAST },
    { side: 's', facing: SOUTH },
    { side: 'w', facing: WEST },
  ] as const;
  let best = Infinity;
  let facing = 0;
  for (const { side, facing: face } of sides) {
    for (const p of plan.passages) {
      const neighbour = p.a === hall && p.sideA === side ? p.b : p.b === hall && p.sideB === side ? p.a : -1;
      if (neighbour < 0) continue;
      const depth = plan.halls[neighbour]!.depth;
      if (depth < best) [best, facing] = [depth, face];
    }
  }
  return facing;
}

/**
 * A Deck post's facing: along its gallery's Deck toward its Ramp (the Ramp lies at the Deck's end, so the way is constant: no trig), so the
 * guard's column lies on the Deck. Undefined when the post is not on its Hall's Deck (its `y` is not the gallery's).
 */
function deckFacing(plan: FloorPlan, hall: number, y: number): number | undefined {
  const g = plan.halls[hall]!.gallery;
  if (!g || g.y !== y) return undefined;
  // The Ramp's high end is `up`: the Deck lies on that side of the Ramp, so the Ramp is the other way along the wall.
  return g.up === 'w' ? EAST : g.up === 's' ? NORTH : g.up === 'e' ? WEST : SOUTH;
}

/**
 * The Boss post's facing: a throne (the Boss Hall's dais, with the post on it: `y` is the dais's) faces away from its wall, so the Boss and its guard
 * stand on the dais facing the Hall (n: south, e: west, s: north, w: east); else a guard's, `guardFacing`.
 */
function bossFacing(plan: FloorPlan, hall: number, y: number): number {
  const f = plan.halls[hall]!.feature;
  if (f?.kind === 'dais' && f.y === y) return f.side === 'n' ? SOUTH : f.side === 'e' ? WEST : f.side === 's' ? NORTH : EAST;
  return guardFacing(plan, hall);
}

const homes = new WeakMap<FloorPlan, WarbandHomes>();

/**
 * The plan's homes (each post with its guard facing, each loop's points), derived once per plan and kept. Never state. A Boss Floor's
 * posts gain the Boss post last, at index `plan.markers.posts.length`: the Boss Hall's centre (its throne's post on a dais), facing as a guard of that Hall does, or away from the throne's wall.
 */
export function warbandHomes(plan: FloorPlan): WarbandHomes {
  let kept = homes.get(plan);
  if (!kept) {
    const posts = plan.markers.posts.map((p) => ({ x: p.x, y: p.y, z: p.z, facing: deckFacing(plan, p.hall, p.y) ?? guardFacing(plan, p.hall) }));
    const boss = plan.markers.boss;
    if (boss) posts.push({ x: boss.x, y: boss.y, z: boss.z, facing: bossFacing(plan, plan.stairs, boss.y) });
    kept = {
      posts,
      patrols: plan.markers.patrols.map((loop) => loop.points.map((p) => ({ x: p.x, y: p.y, z: p.z }))),
    };
    homes.set(plan, kept);
  }
  return kept;
}

/**
 * Whether a Floor's Warbands, as a peer's resync sends them, fit the Floor's plan (a guard of a post of it, a patrol of one of its loops at one of
 * their points; a guard never in PATROL; the chased a party slot or none) and the Tuning Data's Troops. `party` is the number of party slots and
 * `troops` how many Troops the Floor has. `pools` says how many templates each rank draws its `encounter` from: the tier's guard and patrol pools
 * (rank PLAIN, by guard or patrol), its elite pool (ELITE) and its Boss's guard pool (BOSS). Exactly one Warband is the Boss's (rank BOSS) on a Boss Floor, a guard
 * at the Boss post (the last); on any other Floor none is. Pure; a state that fails is refused, since the brain would read past its homes.
 */
export function warbandsFit(crowd: CrowdState, plan: FloorPlan, party: number, troops: number, pools: WarbandPools): boolean {
  const w = crowd.warbands;
  if (!w) return true;
  const home = warbandHomes(plan);
  const squads = crowd.squads.team.length;
  const index = (v: number | undefined, below: number, from: number) => v !== undefined && Number.isInteger(v) && v >= from && v < below;
  for (const a of [w.mode, w.post, w.patrol, w.leg, w.chased, w.seen, w.size, w.encounter, w.rank]) if (a.length !== squads) return false;
  let bosses = 0;
  for (let q = 0; q < squads; q++) {
    const guard = w.post[q]! >= 0;
    const rank = w.rank[q]!;
    if (!index(w.mode[q], RETURN + 1, GUARD) || !index(w.chased[q], party, -1) || !index(rank, BOSS + 1, PLAIN)) return false;
    if (rank === BOSS && (++bosses > 1 || !plan.markers.boss || !guard || w.post[q] !== home.posts.length - 1)) return false;
    const pool = rank === BOSS ? pools.boss : rank === ELITE ? pools.elite : guard ? pools.guard : pools.patrol;
    if (!index(w.encounter[q], pool, 0) || (rank !== PLAIN && !guard)) return false;
    if (guard) {
      if (!index(w.post[q], home.posts.length, 0) || w.patrol[q] !== -1 || w.leg[q] !== 0 || w.mode[q] === PATROL) return false;
    } else if (w.post[q] !== -1 || !index(w.patrol[q], home.patrols.length, 0) || !index(w.leg[q], home.patrols[w.patrol[q]!]!.length, 0)) return false;
  }
  // A Boss Floor has exactly one Boss Warband, any other Floor none.
  if (bosses !== (plan.markers.boss ? 1 : 0)) return false;
  return crowd.squad.every((q) => index(q, squads, -1)) && crowd.troop.every((t) => index(t, troops, 0));
}

/** How many templates each kind of Warband draws its `encounter` from on a Floor (`warbandPools`). */
export interface WarbandPools {
  readonly guard: number;
  readonly patrol: number;
  readonly elite: number;
  readonly boss: number;
}

/** The pool sizes of Floor `floor`'s tier, for `warbandsFit`. */
export function warbandPools(delver: DelverTuning, floor: number): WarbandPools {
  const tier = delver.warbands[tierOf(delver, floor) - 1]!;
  return { guard: tier.guard.length, patrol: tier.patrol.length, elite: tier.elite?.length ?? 0, boss: tier.boss?.guard.length ?? 0 };
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
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  readonly template: WarbandTemplate;
  readonly encounter: number;
  readonly post: number;
  readonly patrol: number;
  readonly leg: number;
  readonly rank: number;
  /** Each Soldier's skill (an AI difficulty, its template row's) in place order, before the party's extras; a Boss Warband's Boss Soldier comes before them. */
  readonly skills: readonly string[];
  /** The skill the party's extras are of: the template's first row's. */
  readonly extra: string;
  /** An elite's Relic set (an index into `floorTroops`' `elite`), or -1. */
  readonly eliteSet: number;
}

/**
 * The Floor's Crowd at its start (pure): the filled posts' guards in post order, then the filled loops' patrols in loop order, Warband q being
 * Squad q. `tuning` is the Floor's `arenaTuning` and `field` its Battlefield. Each Warband stands in a column at its home (a guard at its post
 * facing the way the party comes, a patrol at its loop's start facing its next point), on the floor (never a roof); `humans` makes each
 * bigger by `perPlayerSoldiers` per human beyond the first. With nothing filled (`postFill` and `patrolFill` 0) every array is empty.
 */
export function deployWarbands(tuning: TuningData, plan: FloorPlan, field: Battlefield, seed: number, floor: number, humans: number): CrowdState {
  const { battle, delver } = tuning;
  const tier = tierOf(delver, floor);
  const pools = delver.warbands[tier - 1]!;
  const hpOfTier = delver.tierHp[tier - 1]!;
  const { posts, patrols } = plan.markers;
  const home = warbandHomes(plan);
  const indices = floorTroops(delver);
  const prefabs = floorPrefabs(delver, seed, floor);
  const rows = (template: WarbandTemplate): string[] => template.troops.flatMap((row) => Array<string>(row.count).fill(row.skill));

  // The deepest filled posts (their Hall's `depth`, the lower post on a tie) hold the elites, when the tier has any.
  const guards = filled(seed, floor, posts.length, delver.postFill, WARBAND_SALT.postOrder);
  const elitePool = pools.elite ?? [];
  const elites = new Set<number>();
  if (elitePool.length > 0) {
    const deepest = guards.slice().sort((a, b) => plan.halls[posts[b]!.hall]!.depth - plan.halls[posts[a]!.hall]!.depth || a - b);
    for (const k of deepest.slice(0, delver.elitePosts)) elites.add(k);
  }

  const planned: Planned[] = [];
  for (const k of guards) {
    const at = home.posts[k]!;
    if (elites.has(k)) {
      const encounter = runPick(seed, floor, k, WARBAND_SALT.elitePick, elitePool.length);
      const template = elitePool[encounter]!;
      const eliteSet = indices.eliteSet[tier - 1]![encounter]!;
      planned.push({ x: at.x, y: at.y, z: at.z, facing: at.facing, template, encounter, post: k, patrol: -1, leg: 0, rank: ELITE, skills: rows(template), extra: template.troops[0]!.skill, eliteSet });
      continue;
    }
    const encounter = runPick(seed, floor, k, WARBAND_SALT.guardPick, pools.guard.length);
    const template = pools.guard[encounter]!;
    planned.push({ x: at.x, y: at.y, z: at.z, facing: at.facing, template, encounter, post: k, patrol: -1, leg: 0, rank: PLAIN, skills: rows(template), extra: template.troops[0]!.skill, eliteSet: -1 });
  }
  for (const k of filled(seed, floor, patrols.length, delver.patrolFill, WARBAND_SALT.patrolOrder)) {
    const encounter = runPick(seed, floor, k, WARBAND_SALT.patrolPick, pools.patrol.length);
    const loop = patrols[k]!;
    const points = home.patrols[k]!;
    // It starts at the first point whose Hall is neither a Fight Hall nor the Stairs', else the first, walking to the next.
    let start = loop.halls.findIndex((h) => plan.halls[h]!.kind !== 'Fight' && plan.halls[h]!.kind !== 'Stairs' && plan.halls[h]!.kind !== 'Boss');
    if (start < 0) start = 0;
    const leg = (start + 1) % points.length;
    const at = points[start]!;
    const template = pools.patrol[encounter]!;
    planned.push({ x: at.x, y: at.y, z: at.z, facing: facingToward(at, points[leg]!), template, encounter, post: -1, patrol: k, leg, rank: PLAIN, skills: rows(template), extra: template.troops[0]!.skill, eliteSet: -1 });
  }
  // The Boss Warband, last: the Boss Soldier first, then its guard's rows; the extras are of the guard's first row's skill, never another Boss.
  const boss = pools.boss;
  if (plan.markers.boss && boss) {
    const encounter = runPick(seed, floor, 0, WARBAND_SALT.bossGuard, boss.guard.length);
    const template = boss.guard[encounter]!;
    const at = home.posts[posts.length]!;
    planned.push({
      x: at.x, y: at.y, z: at.z, facing: at.facing, template, encounter, post: posts.length, patrol: -1, leg: 0, rank: BOSS,
      skills: rows(template), extra: template.troops[0]!.skill, eliteSet: -1,
    });
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
  const warbands = { mode: [] as number[], post: [] as number[], patrol: [] as number[], leg: [] as number[], chased: [] as number[], seen: [] as number[], size: [] as number[], encounter: [] as number[], rank: [] as number[] };

  // A Soldier's Troop: a Variant of its skill of one of the Floor's Prefabs (an elite's wearing its set's Relics), each picked from the seed by
  // its Warband and place, so one Warband's size never moves another's picks.
  const troopFor = (skill: string, eliteSet: number, q: number, p: number): number => {
    const slot = q * PICK_PLACES + p;
    const prefab = prefabs[runPick(seed, floor, slot, WARBAND_SALT.prefab, prefabs.length)]!;
    const variants = delver.troops[prefab]!.variants.flatMap((v, k) => (!v.boss && v.difficulty === skill ? [k] : []));
    const k = variants[runPick(seed, floor, slot, WARBAND_SALT.variant, variants.length)]!;
    return eliteSet >= 0 ? indices.elite[eliteSet]![prefab]![k]! : indices.plain[prefab]![k]!;
  };
  planned.forEach((w, q) => {
    // The Soldiers' skills in place order, then the party's extras, all of the first row's; the total held to a Squad's size.
    const boss = w.rank === BOSS ? 1 : 0;
    const skills = w.skills.slice();
    const more = whole + (runPick(seed, floor, q, WARBAND_SALT.extra, 100) < Math.round(100 * (extra - whole)) ? 1 : 0);
    for (let c = 0; c < more && skills.length + boss < battle.squad.size; c++) skills.push(w.extra);

    const anchorSurface = groundOf(battle, field, w.x, w.z, w.y);
    const count = skills.length + boss;
    for (let p = 0; p < count; p++) {
      const bossSoldier = boss === 1 && p === 0;
      const t = bossSoldier ? indices.boss[tier - 1]! : troopFor(skills[p - boss]!, w.eliteSet, q, p);
      const troop = battle.troops[t]!;
      placeOffset(battle, COLUMN, p, w.facing, out);
      const px = w.x + out[0];
      const pz = w.z + out[1];
      x.push(px);
      z.push(pz);
      surface.push(groundOf(battle, field, px, pz, w.y));
      heading.push(w.facing);
      // Its Troop's HP (a Boss's whole, every other Soldier's scaled by its template and its tier), with its Relics' `maxHp` share on top.
      const worn = relicMods(tuning, troop.relics ?? []).maxHp;
      const life = bossSoldier ? troop.hp * (1 + worn) : troop.hp * w.template.hpScale * hpOfTier * (1 + worn);
      hp.push(life);
      // Its Size follows that HP (docs/plans/delver-troops.md).
      const size = sizeOfHp(delver, life);
      sizeHeight.push(size.height);
      sizeThick.push(size.thick);
      troopOf.push(t);
      // A Prefab has one look.
      look.push(0);
      squad.push(q);
      place.push(p);
    }

    squads.team.push(1);
    squads.x.push(w.x);
    squads.z.push(w.z);
    squads.heading.push(w.facing);
    squads.aim.push(w.facing);
    squads.speed.push(0);
    squads.shape.push(COLUMN);
    squads.living.push(count);
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
    warbands.size.push(count);
    warbands.encounter.push(w.encounter);
    warbands.rank.push(w.rank);
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
