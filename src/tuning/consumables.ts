/**
 * The Consumables as Tuning Data (data/consumables.json, hashed; docs/plans/delver.md, Stage 10): items a Player picks up into a Relic slot and
 * uses once from the inventory screen, which destroys them. Each is a name, an icon id and one effect from a fixed vocabulary the Simulation
 * implements (`useConsumable`, `src/sim/delverRun.ts`), so a new Consumable of a known effect is data, not code.
 */
import { array, nonEmptyString, record, TuningDataError } from './validate';

/**
 * What a Consumable does when used: `healFull` heals its user to full HP, `revealFloor` reveals every Hall and Passage of the Floor (for the
 * party), `reviveFallen` brings every fallen ally back round its user, as a fire does.
 */
export const CONSUMABLE_EFFECTS = ['healFull', 'revealFloor', 'reviveFallen'] as const;
export type ConsumableEffect = (typeof CONSUMABLE_EFFECTS)[number];

export interface ConsumableTuning {
  /** Its name, unique among the Consumables and the Relics (a Relic slot holds names of either). */
  readonly name: string;
  /** An icon id the presentation draws it with. Render-only, never read by the Simulation. */
  readonly icon: string;
  readonly effect: ConsumableEffect;
}

/** Validate the raw Consumables against the Relics' names. Accepts its own output. */
export function parseConsumables(raw: unknown, relics: readonly string[] = []): readonly ConsumableTuning[] {
  const names = new Set<string>();
  return array(raw, 'consumables').map((rawItem, n): ConsumableTuning => {
    const where = `consumables[${n}]`;
    const c = record(rawItem, where);
    const name = nonEmptyString(c, 'name', where);
    if (names.has(name)) throw new TuningDataError(`${where}.name: duplicate Consumable "${name}"`);
    if (relics.includes(name)) throw new TuningDataError(`${where}.name: "${name}" is a Relic's name too`);
    names.add(name);
    const icon = nonEmptyString(c, 'icon', where);
    const effect = c.effect;
    if (typeof effect !== 'string' || !(CONSUMABLE_EFFECTS as readonly string[]).includes(effect))
      throw new TuningDataError(`${where}.effect must be one of ${CONSUMABLE_EFFECTS.join(', ')}, got ${JSON.stringify(effect)}`);
    return { name, icon, effect: effect as ConsumableEffect };
  });
}
