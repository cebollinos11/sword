import { arenaOf, navMesh, nextArenaName, withGeneratedArena, type Layout, type MatchState } from '../sim';
import type { TuningData } from '../tuning';

/** Random Maps built lately, kept so a restart or the scene behind the menus does not generate them again. */
const KEPT_WORLDS = 4;

/** The Tuning Data a Match on an Arena is played with, and a Random Map's Layout (to draw it from its Kit's model). */
export interface ArenaWorld {
  readonly tuning: TuningData;
  readonly layout?: Layout;
}

/**
 * The world for Arena `name`: `tuning` itself, or for a Random Map (`gen:<kit>:<seed>`) a copy holding the Arena every
 * peer builds from that name, with its Layout. The same copy each time while it is among the last few (the navmesh is
 * cached per Arena and Tuning Data); one dropped is built again, the same Arena. The Renderer asks it for each Match
 * state's Arena, so the drawn Arena follows a Rematch onto the next Random Map.
 */
export function createArenaWorlds(tuning: TuningData): (name: string) => ArenaWorld {
  const worlds = new Map<string, ArenaWorld>();
  return (name) => {
    let world = worlds.get(name);
    if (!world) {
      world = withGeneratedArena(tuning, name);
      worlds.set(name, world);
      if (worlds.size > KEPT_WORLDS) worlds.delete(worlds.keys().next().value!);
    }
    return world;
  };
}

/**
 * The Arena the game should build ahead for this Match state, or null for none: in a Run, the next Floor's from the
 * current Floor's first Tick on (none on the last Floor, or once the Run is over); in Duels, the Rematch's while the
 * result shows (none without a Rematch, or when it is the same hand-made Arena).
 */
export function arenaToWarm(match: MatchState): string | null {
  const { run } = match;
  if (run) return run.floor < run.floors && match.status.status === 'InProgress' ? nextArenaName(match.arena) : null;
  if (match.status.status !== 'Over' || match.config.rematchTicks === null) return null;
  const next = nextArenaName(match.arena);
  return next === match.arena ? null : next;
}

/**
 * Build Arena `name` ahead of the Tick that moves onto it: the Arena itself and its navmesh for the Match's Tuning Data
 * (`matchTuning`, both cached by the Simulation), and the world the Renderer draws it from. That Tick, and any Rollback
 * re-simulating it, then only reads the caches.
 */
export function warmArena(worlds: (name: string) => ArenaWorld, matchTuning: TuningData, name: string): void {
  navMesh(arenaOf(matchTuning, name), matchTuning);
  worlds(name);
}
