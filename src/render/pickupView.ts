import { pickupVisibleTo, type Pickup, type PickupAt } from '../sim';

/** How near (m, across the ground, from the local Fighter) a pickup is for its label to show. */
export const LABEL_RANGE = 3;
/** How far (m, from the camera) the pickup the camera points at still shows its label, and how close to the view axis (cosine of the angle) it must lie. */
export const AIM_RANGE = 12;
export const AIM_COS = Math.cos((6 * Math.PI) / 180);
/** Where a pickup's item floats over its ground (m): over a Treasure pedestal, or just lying. The point the camera aims at. */
export const PEDESTAL_HEIGHT = 0.4;
export const ITEM_HEIGHT = 0.7;
/** A crate prop's height (m), as `placeProps` draws its main box (1.2 m at the ground): what a Delver Floor's pedestal item stands on, in place of the cylinder. */
export const CRATE_HEIGHT = 1.2;
/** The smaller crate `placeProps` stacks on some crates adds this much (m) to the top. */
export const STACK_HEIGHT = 0.8;
/** The top (m) of the crate a Delver pedestal stands on: `CRATE_HEIGHT`, plus `STACK_HEIGHT` when `stacked` (`crateStacked` of its prop's id). */
export const crateTop = (stacked: boolean): number => CRATE_HEIGHT + (stacked ? STACK_HEIGHT : 0);

/** Where the local Player looks from: the camera (its place and unit direction) and the Fighter it follows (its feet). */
export interface PickupEye {
  readonly at: PickupAt;
  readonly dir: PickupAt;
  readonly near: PickupAt;
}

/** What a pickup is drawn as: the Weapon's model, or the Relic's icon. */
export type PickupForm = { readonly kind: 'weapon'; readonly weapon: string } | { readonly kind: 'relic'; readonly relic: string };

/** How one pickup is drawn this frame (render only). */
export interface PickupView {
  readonly id: number;
  readonly at: PickupAt;
  readonly form: PickupForm;
  /** Whether it stands on a pedestal (a Treasure Hall's). */
  readonly pedestal: boolean;
  /** Whether the pedestal is a crate prop of the Floor's map (a Delver Run's Treasure Hall): the item stands on its top, and no cylinder is drawn. Absent: false. */
  readonly crate?: boolean;
  /** With `crate`: the height (m) of the top of its crate stack; absent: `CRATE_HEIGHT`. */
  readonly crateTop?: number;
  /** Whether it is drawn at all: `pickupVisibleTo` (its own or shared, not taken). */
  readonly shown: boolean;
  /** Whether its name is shown over it. */
  readonly label: boolean;
  /** Across-the-ground distance to the Fighter (m). */
  readonly distance: number;
}

/** The cosine of the angle between the camera's view axis and the pickup's item, or -1 when it is out of AIM_RANGE. */
function aimCos(p: Pick<Pickup, 'at'>, eye: PickupEye, lift = 0): number {
  const dx = p.at.x - eye.at.x;
  const dy = p.at.y + lift + ITEM_HEIGHT - eye.at.y;
  const dz = p.at.z - eye.at.z;
  const len = Math.hypot(dx, dy, dz);
  if (len > AIM_RANGE || len < 1e-6) return -1;
  return (dx * eye.dir.x + dy * eye.dir.y + dz * eye.dir.z) / len;
}

/**
 * How pickup `p` is drawn for Player Fighter `viewer`, `label` as if it were the only pickup (within LABEL_RANGE of the Fighter, or
 * aimed at). Several pickups share one label rule through `pickupViews`.
 */
export function pickupView(p: Pickup, viewer: number, eye: PickupEye, onCrate: boolean | ((p: Pickup) => number) = false): PickupView {
  const shown = pickupVisibleTo(p, viewer);
  const crate = Boolean(onCrate) && p.group !== undefined;
  const top = crate && typeof onCrate === 'function' ? onCrate(p) : CRATE_HEIGHT;
  const distance = Math.hypot(p.at.x - eye.near.x, p.at.z - eye.near.z);
  return {
    id: p.id,
    at: p.at,
    form: p.kind === 'weapon' ? { kind: 'weapon', weapon: p.item } : { kind: 'relic', relic: p.item },
    pedestal: p.group !== undefined,
    ...(crate ? { crate, crateTop: top } : {}),
    shown,
    label: shown && (distance <= LABEL_RANGE || aimCos(p, eye, crate ? top : 0) >= AIM_COS),
    distance,
  };
}

/**
 * Every pickup's view, with at most one label: the pickup the camera points at, else the nearest within LABEL_RANGE of the Fighter, so a
 * Treasure Hall's three names never overlap. Same order as `pickups`. `onCrate`: a Delver Floor's pedestals stand on crate props (`PickupView.crate`), or a function giving each one's crate top (m).
 */
export function pickupViews(pickups: readonly Pickup[], viewer: number, eye: PickupEye, onCrate: boolean | ((p: Pickup) => number) = false): PickupView[] {
  const views = pickups.map((p) => pickupView(p, viewer, eye, onCrate));
  let best = -1;
  let bestAim = AIM_COS;
  views.forEach((v, i) => {
    const aim = v.shown ? aimCos(pickups[i]!, eye, v.crate ? (v.crateTop ?? CRATE_HEIGHT) : 0) : -1;
    if (aim >= bestAim) (best = i), (bestAim = aim);
  });
  if (best < 0) {
    let nearest = LABEL_RANGE;
    views.forEach((v, i) => {
      if (v.shown && v.distance <= nearest) (best = i), (nearest = v.distance);
    });
  }
  return views.map((v, i) => (v.label === (i === best) ? v : { ...v, label: i === best }));
}

/** How far over the ground (m) a pickup's label floats. */
export const LABEL_HEIGHT = 1.0;

/** One pickup's floating label for the HUD: where (a little over its ground) and what it says. */
export interface PickupLabel {
  readonly id: number;
  readonly at: PickupAt;
  readonly text: string;
  readonly kind: 'weapon' | 'relic';
}

/** The labels to draw: the item name over each view that is shown and labelled (`pickupViews` allows one), so the 3D mark and the label agree. */
export function pickupLabels(views: readonly PickupView[]): PickupLabel[] {
  return views
    .filter((v) => v.shown && v.label)
    .map((v) => ({ id: v.id, at: { x: v.at.x, y: v.at.y + (v.crate ? (v.crateTop ?? CRATE_HEIGHT) : 0) + LABEL_HEIGHT, z: v.at.z }, text: v.form.kind === 'weapon' ? v.form.weapon : v.form.relic, kind: v.form.kind }));
}
