import { pickupVisibleTo, type Pickup, type PickupAt } from '../sim';

/** How near (m, across the ground, from the local Fighter) a pickup is for its label to show. */
export const LABEL_RANGE = 3;
/** How far (m, from the camera) the pickup the camera points at still shows its label, and how close to the view axis (cosine of the angle) it must lie. */
export const AIM_RANGE = 12;
export const AIM_COS = Math.cos((6 * Math.PI) / 180);
/** Where a pickup's item floats over its ground (m): over a Treasure pedestal, or just lying. The point the camera aims at. */
export const PEDESTAL_HEIGHT = 0.4;
export const ITEM_HEIGHT = 0.7;

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
  /** Whether it is drawn at all: `pickupVisibleTo` (its own or shared, not taken). */
  readonly shown: boolean;
  /** Whether its name is shown over it. */
  readonly label: boolean;
  /** Across-the-ground distance to the Fighter (m). */
  readonly distance: number;
}

/** The cosine of the angle between the camera's view axis and the pickup's item, or -1 when it is out of AIM_RANGE. */
function aimCos(p: Pick<Pickup, 'at'>, eye: PickupEye): number {
  const dx = p.at.x - eye.at.x;
  const dy = p.at.y + ITEM_HEIGHT - eye.at.y;
  const dz = p.at.z - eye.at.z;
  const len = Math.hypot(dx, dy, dz);
  if (len > AIM_RANGE || len < 1e-6) return -1;
  return (dx * eye.dir.x + dy * eye.dir.y + dz * eye.dir.z) / len;
}

/**
 * How pickup `p` is drawn for Player Fighter `viewer`, `label` as if it were the only pickup (within LABEL_RANGE of the Fighter, or
 * aimed at). Several pickups share one label rule through `pickupViews`.
 */
export function pickupView(p: Pickup, viewer: number, eye: PickupEye): PickupView {
  const shown = pickupVisibleTo(p, viewer);
  const distance = Math.hypot(p.at.x - eye.near.x, p.at.z - eye.near.z);
  return {
    id: p.id,
    at: p.at,
    form: p.kind === 'weapon' ? { kind: 'weapon', weapon: p.item } : { kind: 'relic', relic: p.item },
    pedestal: p.group !== undefined,
    shown,
    label: shown && (distance <= LABEL_RANGE || aimCos(p, eye) >= AIM_COS),
    distance,
  };
}

/**
 * Every pickup's view, with at most one label: the pickup the camera points at, else the nearest within LABEL_RANGE of the Fighter, so a
 * Treasure Hall's three names never overlap. Same order as `pickups`.
 */
export function pickupViews(pickups: readonly Pickup[], viewer: number, eye: PickupEye): PickupView[] {
  const views = pickups.map((p) => pickupView(p, viewer, eye));
  let best = -1;
  let bestAim = AIM_COS;
  views.forEach((v, i) => {
    const aim = v.shown ? aimCos(pickups[i]!, eye) : -1;
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
