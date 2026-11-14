/**
 * The Delver Floor generator's version, part of the Tuning Data hash (`tuningDataHash`): peers whose generators differ
 * refuse each other rather than build different Floors from the same (seed, Floor) and drift apart.
 *
 * Bump it on any change to the Floor plan (`planFloor`), its Map Source (`floorSource`), the judge or the reroll.
 * Depends on nothing, so Tuning Data may import it.
 */
export const DELVER_VERSION = 4;
