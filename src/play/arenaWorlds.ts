import { withGeneratedArena, type Layout } from '../sim';
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
