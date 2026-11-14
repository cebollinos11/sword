/**
 * What the Delver maps (the minimap and the Floor Map, docs/plans/delver.md, Stage 5) draw besides Halls and Passages, as plain data in
 * world metres: pure and render only. Only the markers of revealed Halls are given; nothing here changes the Match.
 */
import { isRevealed } from '../sim/delver/reveal';
import type { FloorPlan } from '../sim/delver/plan';
import { pickupVisibleTo, type Pickup, type RestUse } from '../sim';

/** The Boss mark is drawn this far (m, towards +z) from the Boss Hall's centre, so it does not cover the Stairs mark there (the Stairs stand at the Boss Hall's centre). */
export const BOSS_MARK_OFFSET = 4;

/** One marker on a Delver map. */
export type DelverMapMark =
  /** The Stairs zone's centre; `open` false while a Boss Floor's gate is shut. */
  | { readonly type: 'stairs'; readonly x: number; readonly z: number; readonly open: boolean }
  /** A fire; `spent` once its revive is used (a fire's heal is per Player and not shown). */
  | { readonly type: 'fire'; readonly x: number; readonly z: number; readonly spent: boolean }
  /** A Treasure Hall's pedestals; `lying` while any item still lies there for the viewer. */
  | { readonly type: 'treasure'; readonly x: number; readonly z: number; readonly lying: boolean }
  /** The Boss Hall's centre, `BOSS_MARK_OFFSET` aside. */
  | { readonly type: 'boss'; readonly x: number; readonly z: number };

/** The Run's state the markers depend on. */
export interface DelverMapStatus {
  /** `gateOpen` of the Floor: false on a Boss Floor until its Boss Warband is wiped. */
  readonly gateOpen: boolean;
  readonly restUsed: readonly RestUse[];
  readonly pickups: readonly Pickup[];
}

/** The markers of the Halls `revealed` holds, in a fixed order: Stairs, Boss, fires, Treasure Halls. `me`: whose pedestals count as lying (-1: none). */
export function delverMapMarks(plan: FloorPlan, revealed: readonly number[], status: DelverMapStatus, me: number): DelverMapMark[] {
  const marks: DelverMapMark[] = [];
  const seen = (hall: number): boolean => isRevealed(revealed, hall);
  const { zone } = plan.markers.stairs;
  if (seen(plan.stairs)) marks.push({ type: 'stairs', x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2, open: status.gateOpen });
  const { boss } = plan.markers;
  if (boss && seen(boss.hall)) marks.push({ type: 'boss', x: boss.x, z: boss.z + BOSS_MARK_OFFSET });
  plan.markers.fires.forEach((fire, k) => {
    if (seen(fire.hall)) marks.push({ type: 'fire', x: fire.x, z: fire.z, spent: status.restUsed[k]?.revived ?? false });
  });
  const lying = status.pickups.filter((p) => p.group !== undefined && pickupVisibleTo(p, me));
  plan.halls.forEach((hall, h) => {
    if (hall.kind !== 'Treasure' || !seen(h)) return;
    const { x0, x1, z0, z1 } = hall.rect;
    const here = lying.some((p) => p.at.x >= x0 && p.at.x < x1 && p.at.z >= z0 && p.at.z < z1);
    marks.push({ type: 'treasure', x: hall.cx, z: hall.cz, lying: here });
  });
  return marks;
}
