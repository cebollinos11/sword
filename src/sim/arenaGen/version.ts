/**
 * The Generated Arena generator's version, part of the Tuning Data hash (`tuningDataHash`): peers whose generators
 * differ refuse each other rather than build different Arenas from the same `gen:<kit>:<seed>` name and drift apart.
 *
 * Bump it on any change that could alter a Layout or the Arena assembled from it: the layout generator, the
 * assembler, the judge (it picks which attempt is kept), DEFAULT_GEN_PARAMS, MAX_ATTEMPTS, how a name is read, or the step from one Match's seed to the
 * next (`nextArenaSeed`: it picks the name a Rematch builds).
 * (A Kit file needs no bump: the Kits are hashed themselves.) Depends on nothing, so Tuning Data may import it.
 */
export const GENERATOR_VERSION = 3;
