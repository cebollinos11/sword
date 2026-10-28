/**
 * The Relics as Tuning Data (data/relics.json, hashed): each a name, an icon id and effects from a fixed vocabulary the
 * Simulation implements (`foldMods`, `src/sim/mods.ts`), so a new Relic is data, not code (docs/plans/dungeon.md). No
 * effect changes a Motion, a Tempo or how fast a Fighter walks: how a Fighter moves stays readable, and the AI's
 * Reaction Time stays fair.
 */
import { array, nonEmptyString, record, TuningDataError } from './validate';

/** Effects that multiply a number (written as the factor: 1.1 is +10%, 0.9 is -10%; above 0). */
export const RELIC_MULTIPLIERS = ['damage', 'heavyDamage', 'damageTaken', 'blockImpactTaken', 'daggerDamage', 'kickDamage'] as const;
/** Effects that add to a number. */
export const RELIC_ADDITIONS = ['maxHp', 'daggers', 'healOnKill', 'healOnClear'] as const;
/** The whole vocabulary. */
export const RELIC_EFFECTS = [...RELIC_MULTIPLIERS, ...RELIC_ADDITIONS] as const;
export type RelicEffect = (typeof RELIC_EFFECTS)[number];

/** A Relic's effects: each key at most once, so a Relic never lists one twice. */
export type RelicEffects = Readonly<Partial<Record<RelicEffect, number>>>;

export interface RelicTuning {
  /** Its name, unique in the file (an Encounter names the Relics its enemies carry by it). */
  readonly name: string;
  /** An icon id the presentation draws it with. Render-only, never read by the Simulation. */
  readonly icon: string;
  readonly effects: RelicEffects;
}

/** How each addition is read, for the errors. */
const ADDITION_RULES: Readonly<Record<(typeof RELIC_ADDITIONS)[number], string>> = {
  maxHp: 'a share of max HP above 0 (0.2 is +20%)',
  daggers: 'a whole number of Throwing Daggers, at least 1',
  healOnKill: 'HP above 0',
  healOnClear: 'a share of max HP above 0 and at most 1',
};

function effectValue(effect: RelicEffect, v: unknown, where: string): number {
  const bad = (rule: string) => new TuningDataError(`${where}.${effect} must be ${rule}, got ${JSON.stringify(v)}`);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad((RELIC_MULTIPLIERS as readonly string[]).includes(effect) ? 'a factor above 0' : ADDITION_RULES[effect as keyof typeof ADDITION_RULES]);
  if ((RELIC_MULTIPLIERS as readonly string[]).includes(effect)) {
    if (v <= 0) throw bad('a factor above 0');
  } else if (v <= 0 || (effect === 'daggers' && !Number.isInteger(v)) || (effect === 'healOnClear' && v > 1)) {
    throw bad(ADDITION_RULES[effect as keyof typeof ADDITION_RULES]);
  }
  return v;
}

/** Validate the raw Relics. Accepts its own output. */
export function parseRelics(raw: unknown): readonly RelicTuning[] {
  const names = new Set<string>();
  return array(raw, 'relics').map((rawRelic, n): RelicTuning => {
    const where = `relics[${n}]`;
    const r = record(rawRelic, where);
    const name = nonEmptyString(r, 'name', where);
    if (names.has(name)) throw new TuningDataError(`${where}.name: duplicate Relic "${name}"`);
    names.add(name);
    const icon = nonEmptyString(r, 'icon', where);
    const e = record(r.effects, `${where}.effects`);
    const effects: Partial<Record<RelicEffect, number>> = {};
    for (const key of Object.keys(e)) {
      if (!(RELIC_EFFECTS as readonly string[]).includes(key)) throw new TuningDataError(`${where}.effects: unknown effect "${key}" (have: ${RELIC_EFFECTS.join(', ')}; none changes a Motion, Tempo or walk speed)`);
      effects[key as RelicEffect] = effectValue(key as RelicEffect, e[key], `${where}.effects`);
    }
    if (Object.keys(effects).length === 0) throw new TuningDataError(`${where}.effects must list at least one effect`);
    return { name, icon, effects };
  });
}
