/**
 * Where an AI-driven Fighter of a cleared Hall stands in an exit Door's zone: its own slot's spawn there (the Door's Team 0 spawns, so the party
 * stands side by side), shared by the Ally AI and the dev autopilot so both walk to the same spot.
 */
import { exitDoor, type SimState } from '../sim';
import type { ArenaGeometry, SpawnPoint } from '../tuning';

/**
 * The spawn of exit `exit` (0-based, as `Hall.exits`) at `arena` that `fighter` takes: the one whose slot is its rank among the Fighters of its
 * team (those before it in the line-up), else the Door's first.
 */
export function exitDoorSpawn(arena: ArenaGeometry, exit: number, state: Pick<SimState, 'fighters'>, fighter: number): SpawnPoint {
  const { spawns } = arena.doors[exitDoor(exit)]!;
  const team = state.fighters[fighter]!.team;
  const slot = state.fighters.slice(0, fighter).filter((f) => f.team === team).length;
  return spawns.find((s) => s.slot === slot) ?? spawns[0]!;
}
