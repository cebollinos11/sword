/**
 * Hand-made Battle maps of several levels for the tests of docs/plans/battle-objectives.md, Stage 4a (Soldiers on several levels), written
 * as Tuning Data the way `art/build_battle_<map>.py` writes one: floor rectangles (convex Walk Surfaces cut along every edge of what stands on
 * them), Walls round what a Fighter must not walk into or off, five Objectives and two Bases. Each is its own half turn, as every Battle map
 * is (Objective k mirrors Objective 4 - k), so neither army is favoured. Not the Fort, and not in `data/battlemaps`: no Battle is fought on
 * them but in tests.
 *
 *  - `platform`: a deck 3 m up in the middle of the field (x -10 to 10, z -6 to 6) reached by a ramp from the south and one from the north
 *    (6 m wide, 12 m long), railed. Its other sides are open ledges a Soldier may drop off (3 m, `levels.drop`). B stands on the deck.
 *  - `bridge`: a rampart 4 m high across the whole field (z -6 to 6) with a tunnel through it in the middle (x -3 to 3) and the rampart's top
 *    over the tunnel as a bridge: a Soldier crossing north to south goes under, one walking along the top goes over, through the same cells.
 *    The top is reached by a ramp from the south at x -41 to -35 and one from the north at x 35 to 41; its faces and the tunnel's sides are
 *    Walls, and parapets stop a Fighter walking off the top. A and C stand on the top, B on the bridge over the tunnel.
 */
import type { BattleMapTuning, ObjectiveSite, TuningData, WalkSurface, WallSegment } from '../tuning';

const HALF = 100;

/** A horizontal (or, with `y1` and `along`, sloping) rectangle as a Walk Surface: x from x0 to x1, z from z0 to z1, at `y` (rising to `y1` along z or x). */
function rect(id: string, x0: number, x1: number, z0: number, z1: number, y: number, slope?: { along: 'x' | 'z'; y1: number }): WalkSurface {
  const at = (x: number, z: number) => {
    if (!slope) return { x, y, z };
    const t = slope.along === 'z' ? (z - z0) / (z1 - z0) : (x - x0) / (x1 - x0);
    return { x, y: y + (slope.y1 - y) * t, z };
  };
  return { id, points: [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)] };
}

/** A Wall from (ax, az) to (bx, bz), solid from `bottom` to `top`. */
const wall = (id: string, ax: number, az: number, bx: number, bz: number, bottom: number, top: number): WallSegment => ({ id, a: { x: ax, z: az }, b: { x: bx, z: bz }, bottom, top });

/** The floor rectangles of the field's square cut along `xs` and `zs` (ascending, from -HALF to HALF), but those `skip` says stand under something else. */
function ground(xs: readonly number[], zs: readonly number[], skip: (x: number, z: number) => boolean): WalkSurface[] {
  const out: WalkSurface[] = [];
  for (let j = 0; j + 1 < zs.length; j++)
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const z0 = zs[j]!;
      const z1 = zs[j + 1]!;
      if (!skip((x0 + x1) / 2, (z0 + z1) / 2)) out.push(rect(`ground_${i}_${j}`, x0, x1, z0, z1, 0));
    }
  return out;
}

/** The field's edge: a Wall along each side, so a Fighter never walks off the map. */
const edge = (): WallSegment[] => [
  wall('edge_s', -HALF, -HALF, HALF, -HALF, -1, 10),
  wall('edge_e', HALF, -HALF, HALF, HALF, -1, 10),
  wall('edge_n', HALF, HALF, -HALF, HALF, -1, 10),
  wall('edge_w', -HALF, HALF, -HALF, -HALF, -1, 10),
];

/** Five Objectives in Battle order (D, A, B, C, E: D and E spawns, B weighing 1.4), all neutral, each the half turn of the one 4 - k. */
function objectives(a: { x: number; z: number }): ObjectiveSite[] {
  return [
    { id: 'D', x: 0, z: -40, weight: 1, owner: -1, spawn: true },
    { id: 'A', x: a.x, z: a.z, weight: 1, owner: -1, spawn: false },
    { id: 'B', x: 0, z: 0, weight: 1.4, owner: -1, spawn: false },
    { id: 'C', x: 0 - a.x, z: 0 - a.z, weight: 1, owner: -1, spawn: false },
    { id: 'E', x: 0, z: 40, weight: 1, owner: -1, spawn: true },
  ];
}

const common = { bases: [{ x: 0, z: -88 }, { x: 0, z: 88 }] as const, front: 52, armySize: { standard: 200, max: 200 }, blocks: [] };

/** The deck's height (m) on `platform`, and the rampart's on `bridge`. */
export const DECK = 3;
export const RAMPART = 4;

/** `platform`: a deck 3 m up reached by two railed ramps (see the file's header). */
export function platformMap(): BattleMapTuning {
  const xs = [-HALF, -10, -3, 3, 10, HALF];
  const zs = [-HALF, -18, -6, 6, 18, HALF];
  const raised = (x: number, z: number) => (Math.abs(x) < 10 && Math.abs(z) < 6) || (Math.abs(x) < 3 && Math.abs(z) < 18);
  const walk = [
    ...ground(xs, zs, raised),
    rect('deck_w', -10, -3, -6, 6, DECK),
    rect('deck_m', -3, 3, -6, 6, DECK),
    rect('deck_e', 3, 10, -6, 6, DECK),
    rect('ramp_s', -3, 3, -18, -6, 0, { along: 'z', y1: DECK }),
    rect('ramp_n', -3, 3, 6, 18, DECK, { along: 'z', y1: 0 }),
  ];
  const walls = [
    ...edge(),
    // The deck's sides, where no ramp meets them: solid below it, open above (a ledge).
    wall('deck_sw', -10, -6, -3, -6, -1, DECK),
    wall('deck_se', 3, -6, 10, -6, -1, DECK),
    wall('deck_nw', -10, 6, -3, 6, -1, DECK),
    wall('deck_ne', 3, 6, 10, 6, -1, DECK),
    wall('deck_w', -10, -6, -10, 6, -1, DECK),
    wall('deck_e', 10, -6, 10, 6, -1, DECK),
    // The ramps' sides: solid below them and a rail above.
    wall('ramp_sw', -3, -18, -3, -6, -1, DECK + 1),
    wall('ramp_se', 3, -18, 3, -6, -1, DECK + 1),
    wall('ramp_nw', -3, 6, -3, 18, -1, DECK + 1),
    wall('ramp_ne', 3, 6, 3, 18, -1, DECK + 1),
  ];
  return { name: 'platform', walk, walls, objectives: objectives({ x: -50, z: 0 }), ...common, bases: [common.bases[0], common.bases[1]] };
}

/** `bridge`: a rampart across the field with a tunnel through it under a bridge, and a ramp up to its top from each side (see the file's header). */
export function bridgeMap(): BattleMapTuning {
  // South of the rampart, the ramp up stands at x -41 to -35, z -22 to -6; north of it, its half turn.
  const south = [
    rect('ground_s', -HALF, HALF, -HALF, -22, 0),
    rect('ground_sw', -HALF, -41, -22, -6, 0),
    rect('ground_se', -35, HALF, -22, -6, 0),
  ];
  const north = [
    rect('ground_n', -HALF, HALF, 22, HALF, 0),
    rect('ground_ne', 41, HALF, 6, 22, 0),
    rect('ground_nw', -HALF, 35, 6, 22, 0),
  ];
  const top = [-HALF, -41, -35, -3, 3, 35, 41, HALF];
  const walk = [
    ...south,
    ...north,
    rect('tunnel', -3, 3, -6, 6, 0),
    ...top.slice(0, -1).map((x0, k) => rect(k === 3 ? 'bridge' : `top_${k}`, x0, top[k + 1]!, -6, 6, RAMPART)),
    rect('ramp_s', -41, -35, -22, -6, 0, { along: 'z', y1: RAMPART }),
    rect('ramp_n', 35, 41, 6, 22, RAMPART, { along: 'z', y1: 0 }),
  ];
  // The rampart's faces (but where the tunnel and the ramps meet it), the tunnel's sides, the ramps' sides, and parapets along the top.
  const face = (id: string, z: number, spans: readonly (readonly [number, number])[]) => spans.map(([a, b], k) => wall(`${id}_${k}`, a, z, b, z, -1, RAMPART));
  const parapet = (id: string, z: number, spans: readonly (readonly [number, number])[]) => spans.map(([a, b], k) => wall(`${id}_${k}`, a, z, b, z, RAMPART, RAMPART + 1));
  const walls = [
    ...edge(),
    ...face('face_s', -6, [[-HALF, -41], [-35, -3], [3, HALF]]),
    ...face('face_n', 6, [[-HALF, -3], [3, 35], [41, HALF]]),
    ...parapet('parapet_s', -6, [[-HALF, -41], [-35, HALF]]),
    ...parapet('parapet_n', 6, [[-HALF, 35], [41, HALF]]),
    wall('tunnel_w', -3, -6, -3, 6, -1, RAMPART),
    wall('tunnel_e', 3, -6, 3, 6, -1, RAMPART),
    wall('ramp_sw', -41, -22, -41, -6, -1, RAMPART + 1),
    wall('ramp_se', -35, -22, -35, -6, -1, RAMPART + 1),
    wall('ramp_nw', 35, 6, 35, 22, -1, RAMPART + 1),
    wall('ramp_ne', 41, 6, 41, 22, -1, RAMPART + 1),
  ];
  return { name: 'bridge', walk, walls, objectives: objectives({ x: -60, z: 0 }), ...common, bases: [common.bases[0], common.bases[1]] };
}

/** `tuning` with both test maps among its Battle maps, and its Battle fought on `map` (`applyBattleKnobs` would fold in the same army size). */
export function withLevelMaps(tuning: TuningData, map: 'platform' | 'bridge'): TuningData {
  const maps = { ...tuning.battle.maps, platform: platformMap(), bridge: bridgeMap() };
  return { ...tuning, battle: { ...tuning.battle, maps, armySize: maps[map].armySize.standard } };
}
