/**
 * A Floor's Reveal (docs/plans/delver.md, Stage 5): the shared fog of war, one bit per Hall (`plan.halls` order) and then one per Passage
 * (`plan.passages` order), in 32-bit words held as a plain number array so the Run's state hashes and snapshots structurally. Pure.
 * A place is revealed by entering it (a living present Player's Fighter stands inside its rect); nothing in the Simulation reads the Reveal.
 */
import type { Rect } from '../../mapEditor/source';
import type { FloorPlan } from './plan';

/** The bits of a Floor's Reveal: its Halls, then its Passages. */
export const revealBits = (plan: Pick<FloorPlan, 'halls' | 'passages'>): number => plan.halls.length + plan.passages.length;

/** A Reveal with nothing revealed: `ceil(bits / 32)` words of 0. */
export function emptyReveal(plan: Pick<FloorPlan, 'halls' | 'passages'>): number[] {
  return new Array<number>(Math.ceil(revealBits(plan) / 32)).fill(0);
}

/** Whether bit `bit` is set (false for a bit beyond the words, or a negative one). */
export function isRevealed(revealed: readonly number[], bit: number): boolean {
  if (bit < 0) return false;
  return (((revealed[bit >>> 5] ?? 0) >>> (bit & 31)) & 1) === 1;
}

/** Whether (x, z) lies in `r`: inclusive on x0 and z0, exclusive on x1 and z1, so a seam between two rects belongs to exactly one. */
const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;

/** The bit of the Hall whose rect holds (x, z), else of the Passage whose rect holds it, else -1. Halls first, ties by the lower index. */
export function revealPlace(plan: Pick<FloorPlan, 'halls' | 'passages'>, x: number, z: number): number {
  const h = plan.halls.findIndex((hall) => inRect(hall.rect, x, z));
  if (h >= 0) return h;
  const p = plan.passages.findIndex((pass) => inRect(pass.rect, x, z));
  return p >= 0 ? plan.halls.length + p : -1;
}

/** `revealed` with `bit` set: the very same array when it is set already (or the bit is -1), so a Tick that reveals nothing new allocates nothing. */
export function withReveal(revealed: readonly number[], bit: number): readonly number[] {
  if (bit < 0 || isRevealed(revealed, bit)) return revealed;
  const out = revealed.slice();
  out[bit >>> 5] = ((out[bit >>> 5] ?? 0) | (1 << (bit & 31))) >>> 0;
  return out;
}
