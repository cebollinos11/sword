import { arenaOf, hallBehind, hallOf, navMesh, nextArenaName, runHall, secondsToTicks, takenExit, withGeneratedArena, type Layout, type MatchState } from '../sim';
import type { TuningData } from '../tuning';

/**
 * Random Maps built lately (most recently used kept), so a restart or the scene behind the menus does not generate them
 * again: a Run's Hall and its up to three exits warmed ahead fit, as in the Simulation's own cache of Generated Arenas.
 */
const KEPT_WORLDS = 8;
/** A Run's exit Halls wait for the Final Blow Shot to end, unless the next Hall starts within this (seconds). */
export const WARM_LEAD_SECONDS = 1.5;

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
      // Used again: kept the longest (the Hall drawn every frame is never dropped for the exits warmed after it).
      worlds.delete(name);
    } else {
      world = withGeneratedArena(tuning, name);
      if (worlds.size >= KEPT_WORLDS) worlds.delete(worlds.keys().next().value!);
    }
    worlds.set(name, world);
    return world;
  };
}

/**
 * The Arena the game should build ahead for this Match state, or null for none: in a Run, the next Hall's once the party
 * has taken a Door (during the fade before it, `nextDuelTick`; `tuning` the Match's); in Duels, the Rematch's while the
 * result shows (none without a Rematch, or when it is the same hand-made Arena).
 */
export function arenaToWarm(match: MatchState, tuning: TuningData): string | null {
  if (match.run) {
    const exit = match.nextDuelTick !== null ? takenExit(match.run, tuning) : null;
    const next = exit === null ? null : hallBehind(tuning, match.config, match.run, exit);
    return next ? hallOf(tuning, match.config.arena, next).arena : null;
  }
  if (match.status.status !== 'Over' || match.config.rematchTicks === null) return null;
  const next = nextArenaName(match.arena);
  return next === match.arena ? null : next;
}

/**
 * Every Arena the game should build ahead for this Match state: in a Run, once the Hall is Cleared, every exit's Hall's
 * (Hall.exits order; while Leaving the taken Door's first), so the Hall change only reads the caches whichever Door the
 * party takes; in Duels, `arenaToWarm`'s. Empty while a Hall is fought, and once the Run is over.
 */
export function arenasToWarm(match: MatchState, tuning: TuningData): string[] {
  const run = match.run;
  if (!run) {
    const next = arenaToWarm(match, tuning);
    return next === null ? [] : [next];
  }
  if (run.phase === 'Fighting' || match.status.status === 'Over') return [];
  const exits = hallOf(tuning, match.config.arena, runHall(run)).exits.map((_, exit) => exit);
  const taken = takenExit(run, tuning);
  const order = taken === null ? exits : [taken, ...exits.filter((e) => e !== taken)];
  return order.map((exit) => hallOf(tuning, match.config.arena, hallBehind(tuning, match.config, run, exit)!).arena);
}

/**
 * Whether building ahead waits for now: a Run's exits wait for the Final Blow Shot (`shotPlaying`) to end, as v1 did
 * (building takes a few hundred ms, which the slowed replay would show), unless the next Hall starts within
 * WARM_LEAD_SECONDS. A Door is taken no sooner than `doorSeconds` after the party starts gathering, which covers it.
 */
export function warmingWaits(match: MatchState, shotPlaying: boolean): boolean {
  if (!match.run || !shotPlaying) return false;
  return match.nextDuelTick === null || match.nextDuelTick - match.tick > secondsToTicks(WARM_LEAD_SECONDS);
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
