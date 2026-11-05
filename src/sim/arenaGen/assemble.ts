/**
 * The assembler: Layout → an ordinary ArenaGeometry. Each Piece's Walk Surfaces and Walls are turned and
 * moved onto its cells (grid cells and quarter turns only, so every coordinate is exact and neighbours share
 * edges exactly); a Wall stands under every cell side whose ground is higher than its neighbour's, so nobody walks
 * under a raised floor; whole flat cells at one height are merged into larger rectangles (fewer Walk Surfaces, a
 * faster navmesh); one Abyss lies under the whole footprint; each Team gets four spawns in one cell, the two
 * Teams' cells as far apart as the Layout allows. A Hall Arena's Doors (docs/plans/dungeon.md) each get their zone
 * and four spawns before the doorway; Team 0 starts at Door 0's, Team 1 in the cell furthest from it by walking.
 */
import type { ArenaDoor, ArenaGeometry, ArenaPoint, SpawnPoint, WalkSurface, WallSegment } from '../../tuning';
import { cellGraph, distances, owners, SIDE_STEP, turnPoint, type Layout } from './grid';
import type { Kit } from './kit';

/** How far (m) the Abyss reaches beyond the footprint, so a Jump off its edge still comes down on it. */
const ABYSS_MARGIN = 9;
/** How far (m) the Abyss lies below the lowest floor. */
const ABYSS_DEPTH = 8;
/** How far (m) a Team's slots 1 and 2 stand to the side of slot 0, and behind it. */
const TEAMMATE_SIDE = 1;
const TEAMMATE_BACK = 0.5;
/** Fighters per Team that get a spawn. */
export const SPAWNS_PER_TEAM = 4;
/** How far (m) a Door's slot 0 stands out from its Wall, along the middle of its cell (its other slots behind it, nearer the Wall). */
const DOOR_SPAWN_OUT = 1.75;

export function assembleArena(kit: Kit, layout: Layout, name: string): ArenaGeometry {
  const { cols, rows } = layout;
  const size = kit.cell;
  const x0 = (-cols * size) / 2;
  const z0 = (-rows * size) / 2;
  const walk: WalkSurface[] = [];
  const walls: WallSegment[] = [];
  const surface = (points: ArenaPoint[], extra: Partial<WalkSurface> = {}) => walk.push({ id: `WALK_${walk.length}`, points, ...extra });

  // Whole flat cells, by height, to merge.
  const tile = new Array<number | null>(cols * rows).fill(null);
  const pieces: { points: ArenaPoint[] }[] = [];
  for (const p of layout.placements) {
    const piece = kit.pieces[p.piece];
    const [w, d] = [piece.cols * size, piece.rows * size];
    const base = p.level * kit.levelHeight;
    const place = (x: number, z: number): [number, number] => {
      const [tx, tz] = turnPoint(x, z, w, d, p.turn);
      return [x0 + p.col * size + tx, z0 + p.row * size + tz];
    };
    for (const s of piece.walk) {
      if (s.tile) tile[p.row * cols + p.col] = base + s.points[0]![1];
      else
        pieces.push({
          points: s.points.map(([x, y, z]) => {
            const [px, pz] = place(x, z);
            return { x: px, y: base + y, z: pz };
          }),
        });
    }
    for (const wall of piece.walls) {
      const [ax, az] = place(wall.a[0], wall.a[1]);
      const [bx, bz] = place(wall.b[0], wall.b[1]);
      walls.push({ id: `WALL_${walls.length}`, a: { x: ax, z: az }, b: { x: bx, z: bz }, bottom: base + wall.bottom, top: base + wall.top });
    }
  }

  // Under ground higher than the neighbour's, a Wall down to the neighbour's ground (from the Pieces' skirts).
  const skirt: ({ min: number; max: number } | undefined)[] = new Array(cols * rows * 4);
  for (const p of layout.placements) {
    const piece = kit.pieces[p.piece];
    for (const s of piece.skirts) {
      const [x, z] = turnPoint(s.col + 0.5, s.row + 0.5, piece.cols, piece.rows, p.turn);
      const base = p.level * kit.levelHeight;
      skirt[((p.row + Math.floor(z)) * cols + p.col + Math.floor(x)) * 4 + ((s.side + p.turn) % 4)] = { min: base + s.min, max: base + s.max };
    }
  }
  for (let k = 0; k < cols * rows; k++) {
    const c = k % cols;
    const r = Math.floor(k / cols);
    // Each shared side once: the +x and +z sides.
    for (const side of [1, 2]) {
      const [dc, dr] = SIDE_STEP[side]!;
      if (c + dc >= cols || r + dr >= rows) continue;
      const here = skirt[k * 4 + side];
      const there = skirt[((r + dr) * cols + c + dc) * 4 + ((side + 2) % 4)];
      if (!here || !there) continue;
      const [high, low] = here.min > there.max ? [here, there] : there.min > here.max ? [there, here] : [null, null];
      if (!high || !low) continue;
      // The side's ends: from the cell's corner on that side.
      const ax = x0 + (c + (side === 1 ? 1 : 0)) * size;
      const az = z0 + (r + (side === 2 ? 1 : 0)) * size;
      const [bx, bz] = side === 1 ? [ax, az + size] : [ax + size, az];
      walls.push({ id: `WALL_${walls.length}`, a: { x: ax, z: az }, b: { x: bx, z: bz }, bottom: low.min, top: high.min });
    }
  }

  // Merge whole cells into rectangles: grow along x, then along z while every cell of the next row matches.
  const used = new Uint8Array(cols * rows);
  for (let k = 0; k < cols * rows; k++) {
    const y = tile[k];
    if (y === null || used[k]) continue;
    const c0 = k % cols;
    const r0 = Math.floor(k / cols);
    const fits = (c: number, r: number) => c < cols && r < rows && tile[r * cols + c] === y && !used[r * cols + c];
    let c1 = c0 + 1;
    while (fits(c1, r0)) c1++;
    let r1 = r0 + 1;
    while (Array.from({ length: c1 - c0 }, (_, i) => c0 + i).every((c) => fits(c, r1))) r1++;
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) used[r * cols + c] = 1;
    const [ax, az, bx, bz] = [x0 + c0 * size, z0 + r0 * size, x0 + c1 * size, z0 + r1 * size];
    surface([
      { x: ax, y: y!, z: az },
      { x: bx, y: y!, z: az },
      { x: bx, y: y!, z: bz },
      { x: ax, y: y!, z: bz },
    ]);
  }
  for (const s of pieces) surface(s.points);

  const low = Math.min(0, ...walk.flatMap((s) => s.points.map((p) => p.y))) - ABYSS_DEPTH;
  const [ax, az, bx, bz] = [x0 - ABYSS_MARGIN, z0 - ABYSS_MARGIN, -x0 + ABYSS_MARGIN, -z0 + ABYSS_MARGIN];
  walk.push({
    id: 'WALK_abyss',
    abyss: true,
    points: [
      { x: ax, y: low, z: az },
      { x: bx, y: low, z: az },
      { x: bx, y: low, z: bz },
      { x: ax, y: low, z: bz },
    ],
  });

  const doors = layout.placements
    .filter((p) => p.door !== undefined)
    .sort((a, b) => a.door! - b.door!)
    .map((p): ArenaDoor => {
      const zone = kit.pieces[p.piece].zone;
      if (!zone) throw new Error(`Kit "${kit.name}": Piece "${p.piece}" is placed as a Door but has no zone`);
      const y = p.level * kit.levelHeight;
      const place = (x: number, z: number): [number, number] => {
        const [tx, tz] = turnPoint(x, z, kit.cell, kit.cell, p.turn);
        return [x0 + p.col * size + tx, z0 + p.row * size + tz];
      };
      // Out of the doorway is +z (side 2) unturned; a quarter turn moves side s to s + 1.
      const [fx, fz] = SIDE_STEP[(2 + p.turn) % 4]!;
      const facing = yaw(fx, fz);
      // Unturned, the Fighter's right is -x.
      const spawns = FORMATION.map(([side, ahead], slot): SpawnPoint => {
        const [x, z] = place(kit.cell / 2 - side, DOOR_SPAWN_OUT + ahead);
        return { team: 0, slot, position: { x, y, z }, facing };
      });
      const corners = zone.map(([zx, zz]): ArenaPoint => {
        const [x, z] = place(zx, zz);
        return { x, y, z };
      });
      return { zone: corners, facing, spawns };
    });
  return { name, walk, walls, spawns: doors.length ? [...doors[0]!.spawns, ...hallSpawns(kit, layout, tile, x0, z0)] : spawns(kit, layout, tile, x0, z0), doors };
}

/** A Team's spawns relative to slot 0: [to its right, ahead] (m). Slots 1 and 2 to the side and behind, slot 3 straight behind. */
const FORMATION: readonly (readonly [number, number])[] = [
  [0, 0],
  [TEAMMATE_SIDE, -TEAMMATE_BACK],
  [-TEAMMATE_SIDE, -TEAMMATE_BACK],
  [0, -2 * TEAMMATE_BACK],
].slice(0, SPAWNS_PER_TEAM) as [number, number][];

/** The yaw (0 faces +z) of a quarter-turn direction (fx, fz). */
const yaw = (fx: number, fz: number) => (fz === 1 ? 0 : fz === -1 ? Math.PI : fx === 1 ? Math.PI / 2 : -Math.PI / 2);

/** A Team's four spawns about slot 0 at `at` (height `y`), facing (fx, fz) along an axis. */
function formation(team: number, at: { x: number; z: number }, y: number, [fx, fz]: readonly [number, number]): SpawnPoint[] {
  const facing = yaw(fx, fz);
  // The Fighter's right is (-forward.z, forward.x).
  const [rx, rz] = [-fz, fx];
  return FORMATION.map(([side, ahead], slot) => ({
    team,
    slot,
    position: { x: at.x + rx * side + fx * ahead, y, z: at.z + rz * side + fz * ahead },
    facing,
  }));
}

/** Forward along the nearer axis from `from` toward `to` (quarter turns only). */
const toward = (from: { x: number; z: number }, to: { x: number; z: number }): [number, number] => {
  const [dx, dz] = [to.x - from.x, to.z - from.z];
  return Math.abs(dz) >= Math.abs(dx) ? [0, dz >= 0 ? 1 : -1] : [dx >= 0 ? 1 : -1, 0];
};

/**
 * Four spawns per Team, all in one whole flat cell: the two cells furthest apart across the grid that walking joins
 * (a ledge can part cells far apart by walking that stand close), then furthest by walking; ties: the lowest cells.
 * Cells whose eight neighbours are all solid ground (no gap, no edge of the footprint) are taken if there are two.
 * Slot 0 stands in the cell's middle, slots 1 and 2 a TEAMMATE_SIDE to its right and left and TEAMMATE_BACK behind,
 * slot 3 twice TEAMMATE_BACK straight behind slot 0, all facing the other Team's cell along the nearer axis (quarter turns only).
 */
function spawns(kit: Kit, layout: Layout, tile: readonly (number | null)[], x0: number, z0: number): SpawnPoint[] {
  const { cols } = layout;
  const owner = owners(kit, layout);
  const graph = cellGraph(kit, layout);
  const safe = safeCells(kit, layout, owner);
  /** How many cells apart a and b are across the grid (along x plus along z). */
  const across = (a: number, b: number) => Math.abs((a % cols) - (b % cols)) + Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
  const tiles = tile.flatMap((y, k) => (y === null ? [] : [k]));
  const pool = tiles.filter(safe).length >= 2 ? tiles.filter(safe) : tiles;
  let best: [number, number] | null = null;
  let far = [-1, -1];
  for (const a of pool) {
    const dist = distances(graph, a);
    for (const b of pool) {
      if (b <= a || dist[b]! < 0) continue;
      if (across(a, b) > far[0]! || (across(a, b) === far[0] && dist[b]! > far[1]!)) (far = [across(a, b), dist[b]!]), (best = [a, b]);
    }
  }
  if (!best) return [];
  const centre = (k: number) => ({ x: x0 + ((k % cols) + 0.5) * kit.cell, z: z0 + (Math.floor(k / cols) + 0.5) * kit.cell });
  return best.flatMap((cell, team) => formation(team, centre(cell), tile[cell]!, toward(centre(cell), centre(best![1 - team]!))));
}

/**
 * A Hall Arena's Team 1 spawns: in the whole flat cell furthest from Door 0's by walking (ties: the lowest cell), safe
 * cells (as above) if there are any, never a Door's; laid out as above, facing Door 0 along the nearer axis.
 */
function hallSpawns(kit: Kit, layout: Layout, tile: readonly (number | null)[], x0: number, z0: number): SpawnPoint[] {
  const { cols } = layout;
  const owner = owners(kit, layout);
  const entrance = layout.placements.findIndex((p) => p.door === 0);
  const door = layout.placements[entrance]!;
  const dist = distances(cellGraph(kit, layout), door.row * cols + door.col);
  const safe = safeCells(kit, layout, owner);
  const tiles = tile.flatMap((y, k) => (y === null || layout.placements[owner[k]!]!.door !== undefined || dist[k]! < 0 ? [] : [k]));
  const pool = tiles.some((k) => safe(k)) ? tiles.filter(safe) : tiles;
  if (!pool.length) return [];
  const cell = pool.reduce((best, k) => (dist[k]! > dist[best]! ? k : best));
  const centre = (k: number) => ({ x: x0 + ((k % cols) + 0.5) * kit.cell, z: z0 + (Math.floor(k / cols) + 0.5) * kit.cell });
  return formation(1, centre(cell), tile[cell]!, toward(centre(cell), centre(door.row * cols + door.col)));
}

/** Whether a cell's eight neighbours are all solid ground (no gap, no edge of the footprint). */
function safeCells(kit: Kit, layout: Layout, owner: readonly number[]): (k: number) => boolean {
  const { cols, rows } = layout;
  const solid = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows && owner[r * cols + c]! >= 0 && kit.pieces[layout.placements[owner[r * cols + c]!]!.piece].solid;
  return (k: number) => {
    const c = k % cols;
    const r = Math.floor(k / cols);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (!solid(c + dc, r + dr)) return false;
    return true;
  };
}
