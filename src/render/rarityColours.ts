/**
 * The colour of each Rarity (docs/plans/loot-rarity.md), the one source the HUD's CSS and the 3D marks read. Render only. Common has none: it looks as it
 * always did.
 */
import type { FighterState } from '../sim';
import type { Rarity } from '../tuning';

/** Each Rarity's colour as 0xRRGGBB, or null for Common (no colour, no class, no glow). */
export const RARITY_COLOUR: Readonly<Record<Rarity, number | null>> = { Common: null, Rare: 0x4a9eff, Legendary: 0xff8a1f };

/** Rarity `r`'s colour as `#rrggbb`, or null for Common. */
export function rarityCss(r: Rarity): string | null {
  const c = RARITY_COLOUR[r];
  return c === null ? null : `#${c.toString(16).padStart(6, '0')}`;
}

/** The CSS class a Rarity's items carry: `''` for Common, else `rarity-rare` / `rarity-legendary`. */
export const rarityClass = (r: Rarity): string => (r === 'Common' ? '' : `rarity-${r.toLowerCase()}`);

/** How far a tinted Weapon's emissive moves from its base to the Rarity colour. */
const TINT = 0.55;

/** `base` (0xRRGGBB) for Common, else moved 55% of the way, per channel, to Rarity `r`'s colour. */
export function rarityTint(base: number, r: Rarity): number {
  const c = RARITY_COLOUR[r];
  if (c === null) return base;
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const a = (base >> shift) & 255;
    const b = (c >> shift) & 255;
    out |= Math.round(a + (b - a) * TINT) << shift;
  }
  return out;
}

/** The Rarity of the Item `f` wields, or Common without an inventory (an enemy). */
export function wieldedRarity(f: Pick<FighterState, 'inventory'>): Rarity {
  const inv = f.inventory;
  return inv ? (inv.weapons[inv.weapon]?.rarity ?? 'Common') : 'Common';
}
