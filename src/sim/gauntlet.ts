/**
 * A Gauntlet Run's Floors as the Simulation reads them (docs/plans/gauntlet.md): which enemy each Team 1 slot holds on a
 * Floor, with what Weapon and max HP. Pure functions of Tuning Data (`gauntlet`), the Run's first Arena (its seed) and the
 * number of humans, so every peer builds the same Floor with nothing sent.
 */
import { hashValue } from '../hash';
import { MAX_FLOOR_ENEMIES, RANDOM_PICK, type TuningData } from '../tuning';
import { parseGeneratedName } from './arenaGen/named';
import type { MatchConfig } from './match';

/** One enemy of a Floor, resolved: its `"random"` picks made and its max HP scaled. */
export interface FloorEnemy {
  readonly difficulty: string;
  readonly weapon: string;
  /** A Body name, `"random"` when no Bodies were given to pick from, or absent (the usual random Body). Render-only. */
  readonly body?: string;
  /** Its AI Style (Tuning Data `ai.styles`), or absent (the default Style). The Simulation never reads it. */
  readonly style?: string;
  readonly maxHp: number;
}

/** The Run seed: the seed of the Run's first Arena when it is a Generated Arena (the Lobby's Random Map), else a hash of its name. */
export function runSeed(arena: string): number {
  return parseGeneratedName(arena)?.seed ?? parseInt(hashValue(arena), 16);
}

/** murmur3's 32-bit finaliser: spreads nearby inputs over the whole range. */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A pure pick of one of `count` choices for (Run seed, Floor, slot); `salt` keeps the Weapon, Body and Style picks apart. */
export function runPick(seed: number, floor: number, slot: number, salt: number, count: number): number {
  const h = mix32(mix32(mix32(seed ^ Math.imul(floor, 0x9e3779b9)) ^ Math.imul(slot + 1, 0x85ebca6b)) ^ Math.imul(salt + 1, 0xc2b2ae35));
  return h % count;
}

/** An enemy's max HP: `fighter.maxHp × hpScale × (1 + perPlayerHp × (humans − 1))`. */
export function enemyMaxHp(tuning: TuningData, hpScale: number, humans: number): number {
  return tuning.fighter.maxHp * hpScale * (1 + tuning.gauntlet.perPlayerHp * (humans - 1));
}

/**
 * Floor `floor`'s (1-based) enemy for each Team 1 slot, in slot order (MAX_FLOOR_ENEMIES of them), or null for a slot
 * the Floor leaves empty (Benched). A `"random"` Weapon is picked from the roster, a `"random"` Style from `ai.styles`, and
 * a `"random"` Body from `bodies` when given, by `runPick` on the Run seed (`config.arena`, the first Floor's Arena). Throws on a Floor the Run lacks.
 */
export function floorRoster(tuning: TuningData, config: Pick<MatchConfig, 'arena' | 'humans'>, floor: number, bodies?: readonly string[]): (FloorEnemy | null)[] {
  const listed = tuning.gauntlet.floors[floor - 1];
  if (!listed) throw new RangeError(`A Run has Floors 1 to ${tuning.gauntlet.floors.length}, not ${floor}`);
  const seed = runSeed(config.arena);
  const weapons = Object.keys(tuning.weapons);
  const styles = Object.keys(tuning.ai.styles);
  return Array.from({ length: MAX_FLOOR_ENEMIES }, (_, slot) => {
    const e = listed.enemies[slot];
    if (!e) return null;
    const weapon = e.weapon === RANDOM_PICK ? weapons[runPick(seed, floor, slot, 0, weapons.length)]! : e.weapon;
    const body = e.body === RANDOM_PICK && bodies && bodies.length > 0 ? bodies[runPick(seed, floor, slot, 1, bodies.length)]! : e.body;
    const style = e.style === RANDOM_PICK ? styles[runPick(seed, floor, slot, 2, styles.length)]! : e.style;
    return { difficulty: e.difficulty, weapon, ...(body === undefined ? {} : { body }), ...(style === undefined ? {} : { style }), maxHp: enemyMaxHp(tuning, e.hpScale, config.humans) };
  });
}
