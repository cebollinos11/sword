/**
 * The Battlefield (docs/plans/big-battle.md, Stage 1): a Battle's Arena. Two kinds (docs/plans/battle-objectives.md, Stage 3a; ADR 0022):
 *  - **the open field**, `battle:<seed>`: a square field of gentle hills built from its name alone and Tuning Data `battle.field`. No
 *    Walls, no Kit, no Jump Links, no Abyss. The ground is a heightfield: heights sampled on a grid (`battle.field.cell`), the same seed
 *    always giving the same hills, and between samples each grid cell is two flat triangles. Those triangles are also the Arena's Walk
 *    Surfaces, so `groundBelow` and everything a Fighter's movement reads stand on exactly the ground `battlefieldHeight` gives (the same
 *    plane), while the Crowd reads `battlefieldHeight` directly, in constant time.
 *  - **a hand-built Battle map**, `battle:<map>` (`battle.maps`, exported by `art/build_battle_<map>.py`): an `ArenaGeometry` of its own,
 *    its floor's Walk Surfaces and its Walls, with no jump Links. Its solid blocks (walls, towers) stand a Wall on each side; Soldiers are
 *    pushed out of them (`pushOutOfBlocks`) and the destination fields go round them. Its ground (`battlefieldHeight`) is the highest Walk
 *    Surface under a point; a Soldier stands on a Walk Surface of its own (`CrowdState.surface`, Stage 4a: `soldierHeight`, `levels.ts`), so
 *    on a map of several levels (`layered`) one in a tunnel stands on the tunnel's floor, not on the bridge over it. A map whose Walk
 *    Surfaces are not every one joined to every other by walking and dropping is refused when it is built (`walkCheck`).
 * Pure functions of the name and Tuning Data; the built field is a cache, never state, so it cannot change an outcome (ADR 0006).
 */
import { deployLayout, type ArenaGeometry, type BattleMapTuning, type BattleTuning, type ObjectiveSite, type SpawnPoint, type WalkSurface, type WallBlock, type WallSegment } from '../tuning';
import { deadly, groundBelow, surfaceHeight } from './arena';
import { groundNear, walkCheck } from './levels';
import { createRng, nextFloat } from './rng';

const PREFIX = 'battle:';
/** A hand-built Battle map's name after the prefix: lower-case letters and digits, starting with a letter (a seed is digits only). */
const MAP_NAME = /^[a-z][a-z0-9]*$/;

/** The open field's map name, as the Lobby calls it: never a key of `battle.maps`. */
export const OPEN_FIELD = 'open';

/** The Battlefield name for `seed`: `battle:<seed>`. */
export const battleArenaName = (seed: number): string => `${PREFIX}${seed >>> 0}`;

/** The Battlefield a Battle on `map` is fought on: `battle:<map>` for a hand-built map, else (absent, or `open`) the open field of `seed`. */
export const battleNameFor = (map: string | undefined, seed: number): string => (map === undefined || map === OPEN_FIELD ? battleArenaName(seed) : `${PREFIX}${map}`);

/**
 * The seed of a `battle:<seed>` name (a whole number, written without sign or leading zeros), or null for any other name, a hand-built
 * map's `battle:<map>` among them. Throws on a malformed battle: name.
 */
export function parseBattleName(name: string): number | null {
  if (!name.startsWith(PREFIX)) return null;
  const text = name.slice(PREFIX.length);
  if (MAP_NAME.test(text) && text !== OPEN_FIELD) return null;
  const seed = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(seed) || String(seed) !== text) throw new Error(`Battlefield "${name}": the name must be battle:<seed>, a whole number, or battle:<map>`);
  return seed;
}

/** The hand-built map a `battle:<map>` name names (whether Tuning Data has it or not), or null for any other name. Throws on a malformed battle: name. */
export function battleMapName(name: string): string | null {
  if (parseBattleName(name) !== null || !name.startsWith(PREFIX)) return null;
  return name.slice(PREFIX.length);
}

/** Whether `name` is a Battlefield's (`battle:<seed>` or `battle:<map>`); false for a malformed one. */
export function isBattleName(name: string): boolean {
  try {
    return parseBattleName(name) !== null || battleMapName(name) !== null;
  } catch {
    return false;
  }
}

/**
 * A Battlefield's heights: `side` × `side` samples, `cell` metres apart, from (-size/2, -size/2), row by row along z. On a hand-built
 * map, `walk` is its Arena: the ground is its highest Walk Surface under a point, and the samples (flat at its lowest floor) stand only
 * where none is (inside a block), and are drawn round it.
 */
export interface Heightfield {
  readonly size: number;
  readonly cell: number;
  /** Samples along each side: size / cell + 1. */
  readonly side: number;
  readonly heights: readonly number[];
  /** A hand-built map's Arena, whose Walk Surfaces are the ground; absent on the open field. */
  readonly walk?: ArenaGeometry;
}

/** Hill waves summed into the heightfield. */
const WAVES = 4;

/** The Battlefield's heightfield for `seed`: a few long sine waves, each its own seeded direction, length and phase, summed to at most `hillHeight` from 0. */
export function heightfield(field: BattleTuning['field'], seed: number): Heightfield {
  let rng = createRng(seed ^ 0x9e3779b9);
  const draw = () => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };
  const waves = Array.from({ length: WAVES }, (_, k) => {
    const angle = draw() * 2 * Math.PI;
    const length = field.hillLength * (0.7 + 0.6 * draw());
    const phase = draw() * 2 * Math.PI;
    // Later waves are smaller ripples on the first.
    const weight = 1 / (k + 1);
    return { kx: (Math.sin(angle) * 2 * Math.PI) / length, kz: (Math.cos(angle) * 2 * Math.PI) / length, phase, weight };
  });
  const total = waves.reduce((s, w) => s + w.weight, 0);
  const side = Math.round(field.size / field.cell) + 1;
  const half = field.size / 2;
  const heights: number[] = [];
  for (let r = 0; r < side; r++)
    for (let c = 0; c < side; c++) {
      const x = -half + c * field.cell;
      const z = -half + r * field.cell;
      let h = 0;
      for (const w of waves) h += w.weight * Math.sin(w.kx * x + w.kz * z + w.phase);
      heights.push((field.hillHeight * h) / total);
    }
  return { size: field.size, cell: field.cell, side, heights };
}

/**
 * The ground's height at (x, z): on a hand-built map, the highest of its Walk Surfaces there; else (and where it has none) the triangle of
 * its grid cell under it (each cell split along its diagonal from its low corner (c, r) to (c + 1, r + 1)), flat between its three samples.
 * Off the field, the nearest edge's.
 */
export function battlefieldHeight(hf: Heightfield, x: number, z: number): number {
  if (hf.walk) {
    const g = groundBelow(hf.walk, x, z, Infinity);
    if (g) return g.y;
  }
  const half = hf.size / 2;
  const cells = hf.side - 1;
  const fx = Math.min(cells, Math.max(0, (x + half) / hf.cell));
  const fz = Math.min(cells, Math.max(0, (z + half) / hf.cell));
  const c = Math.min(cells - 1, Math.floor(fx));
  const r = Math.min(cells - 1, Math.floor(fz));
  const u = fx - c;
  const v = fz - r;
  const h = hf.heights;
  const h00 = h[r * hf.side + c]!;
  const h11 = h[(r + 1) * hf.side + c + 1]!;
  if (u >= v) {
    const h10 = h[r * hf.side + c + 1]!;
    return h00 + u * (h10 - h00) + v * (h11 - h10);
  }
  const h01 = h[(r + 1) * hf.side + c]!;
  return h00 + v * (h01 - h00) + u * (h11 - h01);
}

/** An Objective as a map places it (docs/plans/battle-objectives.md, Stage 2a): `ObjectiveSite` with its place settled. Static, never state. */
export interface MapObjective extends Omit<ObjectiveSite, 'hill'> {
  readonly radius: number;
}

/** A point on the map (m). */
export interface MapPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * A built Battlefield: its Arena (the heightfield's triangles, or a hand-built map's floor, as Walk Surfaces, and each Team's spawns), its
 * ground (`heights`), what the armies fight over: its Objectives and each Team's Base (`bases[team]`), where they deploy (`front`), and a
 * hand-built map's solid blocks. Static like the ground and never state.
 */
export interface Battlefield {
  readonly arena: ArenaGeometry;
  readonly heights: Heightfield;
  readonly objectives: readonly MapObjective[];
  readonly bases: readonly [MapPoint, MapPoint];
  /** How far from the centre (m, along z) each army's front rank deploys. */
  readonly front: number;
  /** The solid blocks Soldiers keep out of (`pushOutOfBlocks`); none on the open field. */
  readonly blocks: readonly WallBlock[];
  /** Per cell of a `BLOCK_CELL` grid over the field (row by row along z, from (-size/2, -size/2)), the blocks within `BLOCK_REACH` of it, ascending. */
  readonly blockCells: readonly (readonly number[])[];
  /**
   * Whether a hand-built map has several levels (Stage 4a): some Walk Surface not flat at its floor's height (a ramp, a platform, a bridge).
   * Only then do Soldiers cross between levels by the walk rule (`levels.ts`), and the destination fields have a node per level. False on
   * the open field (one heightfield) and on a one-level map, where a Soldier's Walk Surface is the floor under it and moves nothing.
   */
  readonly layered: boolean;
  /** Each Objective's and each Base's Walk Surface: the highest under its centre (-1 on the open field, whose ground is the heightfield). */
  readonly objectiveSurfaces: readonly number[];
  readonly baseSurfaces: readonly [number, number];
}

/**
 * The height (m) of a Soldier on Walk Surface `surface` at (x, z) (Stage 4a): its surface's there, or on the open field (`surface` -1) the
 * heightfield's. A Soldier's height is never stored: it follows its surface.
 */
export function soldierHeight(field: Battlefield, surface: number, x: number, z: number): number {
  return groundHeight(field.heights, surface, x, z);
}

/** `soldierHeight` from a Battlefield's ground alone (as the renderer has it): Walk Surface `surface`'s height at (x, z), or the heightfield's for -1. */
export function groundHeight(hf: Heightfield, surface: number, x: number, z: number): number {
  return surface >= 0 && hf.walk ? surfaceHeight(hf.walk, surface, x, z) : battlefieldHeight(hf, x, z);
}

/**
 * The Walk Surface a Soldier put down at (x, z) on `field` stands on: the highest there (`groundNear`), or -1 on the open field (or off the
 * floor). Put down anew (no `y`), never a roof; at a Fighter's feet (`y`), the floor under them, a roof too.
 */
export function groundOf(battle: BattleTuning, field: Battlefield, x: number, z: number, y = Infinity): number {
  return field.heights.walk ? groundNear(field.arena, battle.levels, x, z, y, y === Infinity) : -1;
}

/**
 * An Objective site's place: where it asks to be, or, with `hill`, the highest sample within `hill` metres of that along the line across
 * the armies (the same z, so both armies stay equally far from it: a hill must not hand one Team the centre). The nearest, then the lower
 * index, on a tie.
 */
function settle(site: ObjectiveSite, hf: Heightfield): MapPoint {
  if (!site.hill) return { x: site.x, z: site.z };
  const half = hf.size / 2;
  let best: MapPoint = { x: site.x, z: site.z };
  let bestH = -Infinity;
  let bestD = Infinity;
  const r = Math.round((site.z + half) / hf.cell);
  for (let c = 0; c < hf.side; c++) {
    const x = -half + c * hf.cell;
    const d = Math.abs(x - site.x);
    if (d > site.hill) continue;
    const h = hf.heights[r * hf.side + c]!;
    if (h > bestH || (h === bestH && d < bestD)) [best, bestH, bestD] = [{ x, z: -half + r * hf.cell }, h, d];
  }
  return best;
}

/** Where Team `team`'s k-th Fighter spawns: behind its army's last rank (its front rank `front` from the centre), side by side, facing the enemy. */
/** An Objective's circle (m): `objectives.spawnRadius` for a spawn, where a Team's respawning Squads gather, `objectives.radius` for any other. */
const objectiveRadius = (battle: BattleTuning, site: { readonly spawn: boolean }): number => (site.spawn ? battle.objectives.spawnRadius : battle.objectives.radius);

function spawnsOf(battle: BattleTuning, hf: Heightfield, front: number): SpawnPoint[] {
  const back = deployLayout({ ...battle, deploy: { ...battle.deploy, front } }).depth + 2;
  return [0, 1].flatMap((team) =>
    [0, 1, 2, 3].map((slot) => {
      const x = (slot - 1.5) * 2 * (team === 0 ? 1 : -1);
      const z = team === 0 ? -back : back;
      return { team, slot, position: { x, y: battlefieldHeight(hf, x, z), z }, facing: team === 0 ? 0 : Math.PI };
    }),
  );
}

function build(battle: BattleTuning, name: string, seed: number): Battlefield {
  const hf = heightfield(battle.field, seed);
  const half = hf.size / 2;
  const at = (c: number, r: number) => ({ x: -half + c * hf.cell, y: hf.heights[r * hf.side + c]!, z: -half + r * hf.cell });
  const walk: WalkSurface[] = [];
  for (let r = 0; r < hf.side - 1; r++)
    for (let c = 0; c < hf.side - 1; c++) {
      walk.push({ id: `t${c}_${r}a`, points: [at(c, r), at(c + 1, r), at(c + 1, r + 1)] });
      walk.push({ id: `t${c}_${r}b`, points: [at(c, r), at(c + 1, r + 1), at(c, r + 1)] });
    }
  const objectives = battle.objectives.openField.map(({ hill: _hill, ...site }, k) => ({ ...site, ...settle(battle.objectives.openField[k]!, hf), radius: objectiveRadius(battle, site) }));
  const bases: [MapPoint, MapPoint] = [{ x: 0, z: -battle.squad.baseDistance }, { x: 0, z: battle.squad.baseDistance }];
  const front = battle.deploy.front;
  return {
    arena: { name, walk, walls: [], spawns: spawnsOf(battle, hf, front), doors: [] },
    heights: hf,
    objectives,
    bases,
    front,
    blocks: [],
    blockCells: [],
    layered: false,
    objectiveSurfaces: objectives.map(() => -1),
    baseSurfaces: [-1, -1],
  };
}

/** The block lookup's cell (m), and the furthest (m) past a cell a body may reach and still be pushed out of a block it meets there (more than any Soldier's radius). */
const BLOCK_CELL = 4;
const BLOCK_REACH = 1;

/** The block lookup grid's cell along one axis for a coordinate `v` on a field of `size`. */
const blockIndex = (v: number, size: number): number => Math.min(Math.ceil(size / BLOCK_CELL) - 1, Math.max(0, Math.floor((v + size / 2) / BLOCK_CELL)));

/** Per cell of the block lookup, the blocks within `BLOCK_REACH` of it (see `Battlefield.blockCells`). */
function blockCellsOf(blocks: readonly WallBlock[], size: number): number[][] {
  const side = Math.ceil(size / BLOCK_CELL);
  const cells: number[][] = Array.from({ length: side * side }, () => []);
  blocks.forEach((b, k) => {
    for (let r = blockIndex(b.minZ - BLOCK_REACH, size); r <= blockIndex(b.maxZ + BLOCK_REACH, size); r++)
      for (let c = blockIndex(b.minX - BLOCK_REACH, size); c <= blockIndex(b.maxX + BLOCK_REACH, size); c++) cells[r * side + c]!.push(k);
  });
  return cells;
}

/** The blocks near (x, z) on `field`, ascending (see `Battlefield.blockCells`). */
const blocksNear = (field: Battlefield, x: number, z: number): readonly number[] => {
  const size = field.heights.size;
  return field.blockCells[blockIndex(z, size) * Math.ceil(size / BLOCK_CELL) + blockIndex(x, size)]!;
};

/** Whether (x, z) is inside a solid block of `field` (its edge counts as outside). */
export function inBlock(field: Battlefield, x: number, z: number): boolean {
  if (field.blocks.length === 0) return false;
  for (const k of blocksNear(field, x, z)) {
    const b = field.blocks[k]!;
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  return false;
}

/** The most times a push is put back out of the blocks: a push out of one may land in a block beside it. */
const PUSH_PASSES = 3;
/** The ways out of a block (-x, +x, -z, +z) in the order Team 0 breaks a tie in, and Team 1. */
const WAYS = [0, 1, 2, 3] as const;
const MIRRORED_WAYS = [1, 0, 3, 2] as const;

/** The first block of `field` (Team 0 ascending, Team 1 descending) that a body of `radius` at (x, z) overlaps, other than `except`; null for none. */
function overlapping(field: Battlefield, x: number, z: number, radius: number, team: number, except: WallBlock | null): WallBlock | null {
  const near = blocksNear(field, x, z);
  for (let n = 0; n < near.length; n++) {
    const b = field.blocks[near[team === 1 ? near.length - 1 - n : n]!]!;
    if (b !== except && x > b.minX - radius && x < b.maxX + radius && z > b.minZ - radius && z < b.maxZ + radius) return b;
  }
  return null;
}

/**
 * A body of Team `team` with `radius` (at most `BLOCK_REACH`) at (x, z) pushed out of the solid blocks of `field` it overlaps, into `out`:
 * each time out of the first block it overlaps by its shallowest side that does not put it into another block (blocks that touch, a tower
 * on a curtain wall, are one wall), by its shallowest side at all when every side does, until it overlaps none or PUSH_PASSES run out.
 * Team 0 looks at the blocks in ascending order and breaks a tie -x, +x, -z, +z; Team 1 in descending order, +x, -x, +z, -z: a map's block
 * k is the half turn of its block `length - 1 - k` (as its Objectives are), so each army is pushed as the other is, turned with the map.
 * A step from (fromX, fromZ), given, that walked into a block from outside it slides along it instead (Stage 3b): out by the side it
 * came in through (the side whose face it crossed last), keeping the part of its step along that side, when that lands in no other block.
 * Whether it moved the body. Deterministic.
 */
export function pushOutOfBlocks(field: Battlefield, x: number, z: number, radius: number, team: number, out: [number, number], fromX = NaN, fromZ = NaN): boolean {
  out[0] = x;
  out[1] = z;
  if (field.blocks.length === 0) return false;
  let moved = false;
  // In the Team's order: Team 1's is Team 0's turned half round (each axis's two sides swapped).
  const order = team === 1 ? MIRRORED_WAYS : WAYS;
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    const hit = overlapping(field, out[0], out[1], radius, team, null);
    if (!hit) break;
    const ways = [out[0] - (hit.minX - radius), hit.maxX + radius - out[0], out[1] - (hit.minZ - radius), hit.maxZ + radius - out[1]];
    const to = (w: number): [number, number] => (w === 0 ? [hit.minX - radius, out[1]] : w === 1 ? [hit.maxX + radius, out[1]] : w === 2 ? [out[0], hit.minZ - radius] : [out[0], hit.maxZ + radius]);
    const entered = pass === 0 ? entrySide(hit, radius, fromX, fromZ, x, z, order) : -1;
    if (entered >= 0) {
      const [tx, tz] = to(entered);
      if (!overlapping(field, tx, tz, radius, team, hit)) {
        [out[0], out[1]] = [tx, tz];
        moved = true;
        continue;
      }
    }
    let best = -1;
    let any: number = order[0];
    for (const w of order) {
      if (ways[w]! < ways[any]!) any = w;
      const [tx, tz] = to(w);
      if ((best < 0 || ways[w]! < ways[best]!) && !overlapping(field, tx, tz, radius, team, hit)) best = w;
    }
    [out[0], out[1]] = to(best >= 0 ? best : any);
    moved = true;
  }
  return moved;
}

/**
 * The side of block `b` (grown by `radius`; -x, +x, -z, +z as `WAYS`) a step from (fx, fz) to (x, z) came in through: the one whose face
 * it crossed last. -1 when it started inside (or was not given). A step through a corner exactly, both faces at once, takes the first of
 * the two in `order`.
 */
function entrySide(b: WallBlock, radius: number, fx: number, fz: number, x: number, z: number, order: readonly number[]): number {
  const outX = fx <= b.minX - radius ? 0 : fx >= b.maxX + radius ? 1 : -1;
  const outZ = fz <= b.minZ - radius ? 2 : fz >= b.maxZ + radius ? 3 : -1;
  if (outX < 0) return outZ;
  if (outZ < 0) return outX;
  // Outside on both axes: the face crossed later is the one it came in through.
  const tx = ((outX === 0 ? b.minX - radius : b.maxX + radius) - fx) / (x - fx);
  const tz = ((outZ === 2 ? b.minZ - radius : b.maxZ + radius) - fz) / (z - fz);
  if (tx !== tz) return tx > tz ? outX : outZ;
  return order.indexOf(outX) < order.indexOf(outZ) ? outX : outZ;
}

/** The four Walls round a block, each solid from below the floor to the block's top. */
export function blockWalls(b: WallBlock): WallSegment[] {
  const corners = [
    { x: b.minX, z: b.minZ },
    { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ },
    { x: b.minX, z: b.maxZ },
  ];
  return corners.map((a, k) => ({ id: `${b.id}_${k}`, a, b: corners[(k + 1) % 4]!, bottom: -1, top: b.top }));
}

/** The lowest floor of a hand-built Battle map that is not deadly (where its Players spawn), and whether it has several levels (`Battlefield.layered`). */
export function mapFloor(map: Pick<BattleMapTuning, 'walk'>): number {
  return Math.min(...map.walk.filter((w) => !deadly(w)).flatMap((w) => w.points.map((p) => p.y)));
}
export const isLayered = (map: Pick<BattleMapTuning, 'walk'>): boolean => {
  const floor = mapFloor(map);
  return map.walk.some((w) => w.points.some((p) => p.y !== floor));
};

/**
 * A hand-built Battle map's Battlefield: its floor and Walls (its own, and each block's four) with no jump Links, its spawns behind its
 * armies, its Objectives and Bases where it puts them. Throws when its Walk Surfaces are not all joined by walking and dropping (`walkCheck`).
 */
function buildMap(battle: BattleTuning, name: string, map: BattleMapTuning): Battlefield {
  const size = battle.field.size;
  // The floor is the lowest ground that is not deadly: a lava river far below it (the Cavern) is no place for the Players to spawn.
  const floor = mapFloor(map);
  const flat: Heightfield = { size, cell: size, side: 2, heights: [floor, floor, floor, floor] };
  // The Players spawn at the floor's height (on one level, where they stand).
  const arena: ArenaGeometry = { name, walk: map.walk, walls: [...map.walls, ...map.blocks.flatMap(blockWalls)], spawns: spawnsOf(battle, flat, map.front), doors: [], jumpLinks: map.shortcuts ? 'shortcuts' : false };
  const heights: Heightfield = { ...flat, walk: arena };
  const unjoined = walkCheck(arena, battle.levels);
  if (unjoined) throw new Error(`Battle map "${map.name}": ${unjoined}`);
  // An Objective that names its level (`y`) stands on the floor there nearest under it, else on the highest.
  const highest = (p: MapPoint & { readonly y?: number }) => groundNear(arena, battle.levels, p.x, p.z, p.y ?? Infinity, true);
  return {
    arena,
    heights,
    objectives: map.objectives.map(({ hill: _hill, ...site }) => ({ ...site, radius: objectiveRadius(battle, site) })),
    bases: [map.bases[0], map.bases[1]],
    front: map.front,
    blocks: map.blocks,
    blockCells: blockCellsOf(map.blocks, size),
    layered: isLayered(map),
    objectiveSurfaces: map.objectives.map(highest),
    baseSurfaces: [highest(map.bases[0]), highest(map.bases[1])],
  };
}

/** How many Battlefields one Battle Tuning Data keeps built; one dropped is built again (the same field). */
const KEPT = 4;
/** A built Battlefield and the map it was built from (null: the open field), so a map put in a name's place is not answered with the old field. */
interface Kept {
  readonly map: BattleMapTuning | null;
  readonly field: Battlefield;
}
const built = new WeakMap<BattleTuning, Map<string, Kept>>();

/**
 * Battlefield `name` (`battle:<seed>`, or `battle:<map>` for a map of `battle.maps`) built from `battle`, once and then reused while it stays
 * among the last few and its map is the one it was built from (the Map Editor's play-test puts each draft in a copy of the Tuning Data, but a
 * map swapped under one name in the same `battle` is built again too). Null for a name that is not battle:, or a map `battle` does not have.
 */
export function battlefieldOf(battle: BattleTuning, name: string): Battlefield | null {
  const seed = parseBattleName(name);
  const mapName = seed === null ? battleMapName(name) : null;
  const map = mapName !== null && battle.maps && Object.hasOwn(battle.maps, mapName) ? battle.maps[mapName]! : null;
  if (seed === null && !map) return null;
  let kept = built.get(battle);
  if (!kept) built.set(battle, (kept = new Map()));
  let entry = kept.get(name);
  if (entry) kept.delete(name);
  if (entry && entry.map !== map) entry = undefined;
  if (!entry) {
    entry = { map, field: map ? buildMap(battle, name, map) : build(battle, name, seed!) };
    if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  }
  kept.set(name, entry);
  return entry.field;
}
