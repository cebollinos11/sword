/**
 * A Run's party as the Simulation reads it (docs/plans/delver.md): who its Players are (`runPlayers`), who still counts as one at a Tick
 * (`presentPlayers`), whose standing takes the Stairs (`stairsCounters`), and when a Fighter stands at a spot (`standsWithin`). Pure functions of
 * the Run's config and its Fighters, so every peer agrees with nothing sent.
 */
import type { ArenaPoint, TuningData } from '../tuning';
import { inDuel } from './duel';
import type { MatchConfig } from './match';
import type { FighterState } from './state';
import { secondsToTicks } from './constants';

/**
 * The Fighters the human Players drive in a Run (`config.players`; absent, as for a Match made before it existed: the
 * first `humans` Fighters of Team 0), fixed for the Run: those who started as Players. Who still counts as one at a Tick is
 * `presentPlayers`. Only they count at the Stairs and take a fire's heal; AI allies never do.
 */
export function runPlayers(config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>): readonly number[] {
  return config.players ?? config.teams.flatMap((t, i) => (t === 0 ? [i] : [])).slice(0, config.humans);
}

/**
 * THE source of truth for who counts as the Run's Players at a Tick: `runPlayers(config)` less the Fighters an AI Takeover has taken
 * (`away`: `RunState.away`, mirrored on `SimDelver.away` for a Controller; absent while nobody has left). A taken-over Fighter is an AI
 * ally from then on: the Stairs, pickups, the fires, the Reveal and the Ally AI all read this, never `runPlayers` alone. Ascending.
 */
export function presentPlayers(config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>, away?: readonly number[]): readonly number[] {
  const players = runPlayers(config);
  return away === undefined || away.length === 0 ? players : players.filter((i) => !away.includes(i));
}

/**
 * The Fighters whose standing takes the Stairs: every living present Player's (`presentPlayers`; a fallen Player need not stand there),
 * and only when no such Player lives, the living AI allies, a taken-over Fighter among them (else a party of AI allies could never go down).
 */
export function stairsCounters(config: Pick<MatchConfig, 'teams' | 'humans' | 'players'>, fighters: readonly FighterState[], away?: readonly number[]): number[] {
  const players = presentPlayers(config, away).filter((i) => fighters[i] && inDuel(fighters[i]));
  if (players.length > 0) return players;
  return fighters.flatMap((f, i) => (f.team === 0 && inDuel(f) ? [i] : []));
}

/** How far above a zone's ground (m) a Fighter still stands in it: a hop inside the zone does not step out of it. */
export const ZONE_HEIGHT = 2;

/** Whether height `y` is within a zone's window over `ground`: 0.5 m under it (a step down) to ZONE_HEIGHT over it. */
const inZoneHeight = (ground: number, y: number): boolean => y > ground - 0.5 && y < ground + ZONE_HEIGHT;

/** Whether a Fighter stands at `at` (a spot on the ground): within `radius` across the ground, within ZONE_HEIGHT over it. A fire and a pickup are such spots. */
export function standsWithin(at: ArenaPoint, radius: number, f: Pick<FighterState, 'position' | 'y'>): boolean {
  return inZoneHeight(at.y, f.y) && Math.hypot(f.position.x - at.x, f.position.z - at.z) <= radius;
}

/** Ticks every Fighter whose standing counts must stand in a Floor's Stairs zone to take them (`dungeon.stairsSeconds`, at least 1). */
export const stairsTicksNeeded = (tuning: Pick<TuningData, 'dungeon'>): number => Math.max(1, secondsToTicks(tuning.dungeon.stairsSeconds));
