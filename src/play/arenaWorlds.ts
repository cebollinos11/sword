import { arenaOf, navMesh, nextArenaName, runSeed, withGeneratedArena, type Layout, type MatchState } from '../sim';
import { arenaTuning, floorArenaName, parseFloorArena } from '../sim/delver';
import type { TuningData } from '../tuning';

/**
 * Random Maps built lately (most recently used kept), so a restart or the scene behind the menus does not generate them
 * again: a Run's Floor and the next one warmed ahead fit, as in the Simulation's own cache of Generated Arenas.
 */
const KEPT_WORLDS = 8;

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
    if (world) {
      // Used again: kept the longest (the Arena drawn every frame is never dropped for one warmed after it).
      worlds.delete(name);
    } else {
      // A Delver Floor is read under its own Tuning Data copy (the one `stepDelver` and the AI read it under); it has no Layout.
      world = parseFloorArena(name) ? { tuning: arenaTuning(tuning, name) } : withGeneratedArena(tuning, name);
      if (worlds.size >= KEPT_WORLDS) worlds.delete(worlds.keys().next().value!);
    }
    worlds.set(name, world);
    return world;
  };
}

/** A Delver Run's next Floor's Arena name from the Floor's first Tick (so it builds while the fade-in still darkens the screen), or null on the last Floor or once the Run is Over. */
function nextFloor(match: MatchState): string | null {
  const run = match.delver;
  if (!run || match.status.status === 'Over' || run.floor >= run.floors) return null;
  return floorArenaName(runSeed(match.config.arena), run.floor + 1);
}

/**
 * The Arena the game should build ahead for this Match state, or null for none: in a Run, the next Floor's (from the Floor's first Tick); in
 * Duels, the Rematch's while the result shows (none without a Rematch, or when it is the same hand-made Arena).
 */
export function arenaToWarm(match: MatchState): string | null {
  if (match.delver) return nextFloor(match);
  if (match.status.status !== 'Over' || match.config.rematchTicks === null) return null;
  const next = nextArenaName(match.arena);
  return next === match.arena ? null : next;
}

/**
 * Build Arena `name` ahead of the Tick that moves onto it: the Arena itself and its navmesh for the Match's Tuning Data
 * (`matchTuning`, both cached by the Simulation; a Delver Floor under its own, `arenaTuning`), and the world the Renderer draws it from. That Tick, and any Rollback
 * re-simulating it, then only reads the caches.
 */
export function warmArena(worlds: (name: string) => ArenaWorld, matchTuning: TuningData, name: string): void {
  const t = arenaTuning(matchTuning, name);
  navMesh(arenaOf(t, name), t);
  worlds(name);
}
