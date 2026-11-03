/**
 * The Battlefield (docs/plans/big-battle.md, Stage 1): a Battle's Arena, an open square field of gentle hills built from
 * its name alone, `battle:<seed>`, and Tuning Data `battle.field`. No Walls, no Kit, no Jump Links, no Abyss.
 *
 * The ground is a heightfield: heights sampled on a grid (`battle.field.cell`), the same seed always giving the same
 * hills, and between samples each grid cell is two flat triangles. Those triangles are also the Arena's Walk Surfaces,
 * so `groundBelow` and everything a Fighter's movement reads stand on exactly the ground `battlefieldHeight` gives (the
 * same plane), while the Crowd reads `battlefieldHeight` directly, in constant time. Pure functions of the name and
 * Tuning Data; the built field is a cache, never state, so it cannot change an outcome (ADR 0006).
 */
import { deployLayout, type ArenaGeometry, type BattleTuning, type SpawnPoint, type WalkSurface } from '../tuning';
import { createRng, nextFloat } from './rng';

const PREFIX = 'battle:';

/** The Battlefield name for `seed`: `battle:<seed>`. */
export const battleArenaName = (seed: number): string => `${PREFIX}${seed >>> 0}`;

/** The seed of a `battle:<seed>` name (a whole number, written without sign or leading zeros), or null for any other name. Throws on a malformed battle: name. */
export function parseBattleName(name: string): number | null {
  if (!name.startsWith(PREFIX)) return null;
  const text = name.slice(PREFIX.length);
  const seed = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(seed) || String(seed) !== text) throw new Error(`Battlefield "${name}": the name must be battle:<seed>, a whole number`);
  return seed;
}

/** A Battlefield's heights: `side` × `side` samples, `cell` metres apart, from (-size/2, -size/2), row by row along z. */
export interface Heightfield {
  readonly size: number;
  readonly cell: number;
  /** Samples along each side: size / cell + 1. */
  readonly side: number;
  readonly heights: readonly number[];
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
 * The ground's height at (x, z): the triangle of its grid cell under it (each cell split along its diagonal from its low
 * corner (c, r) to (c + 1, r + 1)), flat between its three samples. Off the field, the nearest edge's.
 */
export function battlefieldHeight(hf: Heightfield, x: number, z: number): number {
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

/** A built Battlefield: its Arena (the heightfield's triangles as Walk Surfaces, and each Team's spawns) and its heightfield. */
export interface Battlefield {
  readonly arena: ArenaGeometry;
  readonly heights: Heightfield;
}

/** Where Team `team`'s k-th Fighter spawns: behind its army's last rank, side by side, facing the enemy. */
function spawnsOf(battle: BattleTuning, hf: Heightfield): SpawnPoint[] {
  const back = deployLayout(battle).depth + 2;
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
  return { arena: { name, walk, walls: [], spawns: spawnsOf(battle, hf), doors: [] }, heights: hf };
}

/** How many Battlefields one Battle Tuning Data keeps built; one dropped is built again (the same field). */
const KEPT = 4;
const built = new WeakMap<BattleTuning, Map<string, Battlefield>>();

/** Battlefield `name` (`battle:<seed>`) built from `battle`, once and then reused while it stays among the last few. Null for a name that is not battle:. */
export function battlefieldOf(battle: BattleTuning, name: string): Battlefield | null {
  const seed = parseBattleName(name);
  if (seed === null) return null;
  let kept = built.get(battle);
  if (!kept) built.set(battle, (kept = new Map()));
  let field = kept.get(name);
  if (field) kept.delete(name);
  else {
    field = build(battle, name, seed);
    if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  }
  kept.set(name, field);
  return field;
}
