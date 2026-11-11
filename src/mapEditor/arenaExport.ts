/**
 * A Map Source as a Duel Arena (`data/arenas/<name>.json`, docs/plans/map-editor.md "Later"): the same Brushes and the same compiler as a
 * Battle map, kept to the rooms (Enclosures) the source names, with the two Bases standing the Teams' spawns facing each other. A duel map
 * is authored in the Map Editor on the Battle's field like any map: lay a deadly floor across the field (the compiler wants a floor to every
 * side of it), put the room(s) on top, and place the Bases where the Teams start. Pure: no clock, randomness or trig.
 */
import { surfaceHeight, surfacesAt } from '../sim/arena';
import type { ArenaGeometry, BattleTuning, SpawnPoint, WalkSurface, WallSegment } from '../tuning';
import { compileDraft, type CompileWarning } from './compile';
import type { GroundPoint, MapSource } from './source';

/** A Duel's Teams have this many spawn slots each (as the shipped Arenas). */
export const SPAWN_SLOTS = 4;
/** The Arena keeps what lies within this many metres of its Enclosures' bounds. */
const MARGIN = 1;

export interface CompiledArena {
  readonly arena: ArenaGeometry;
  readonly warnings: readonly CompileWarning[];
}

/** A Team's spawns: slot 0 on `base`, two beside it across its facing and one behind, all facing `toward` along the dominant axis. */
function spawnsOf(team: 0 | 1, base: GroundPoint, toward: GroundPoint, groundY: (p: GroundPoint) => number): SpawnPoint[] {
  const dx = toward.x - base.x;
  const dz = toward.z - base.z;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const sign = (alongX ? dx : dz) >= 0 ? 1 : -1;
  // North (+z) is facing 0, east (+x) a quarter turn: the same facing the Arenas' files carry.
  const facing = alongX ? sign * (Math.PI / 2) : sign > 0 ? 0 : Math.PI;
  const at = (ahead: number, across: number): GroundPoint => (alongX ? { x: base.x + sign * ahead, z: base.z + sign * across } : { x: base.x + sign * across, z: base.z + sign * ahead });
  const offsets: [number, number][] = [
    [0, 0],
    [0.5, -2],
    [0.5, 2],
    [-1, 0],
  ];
  return offsets.map(([ahead, across], slot) => {
    const p = at(ahead, across);
    return { team, slot, position: { x: p.x, y: groundY(p), z: p.z }, facing };
  });
}

/**
 * Compile `source` into a Duel Arena: the compiled floors and Walls within its Enclosures' bounds (the field's edge Walls and the deadly
 * floor beyond the room are left out), and four spawns a Team at its Base. Throws a `MapCompileError` as `compileMap` does, but does not
 * ask Soldiers to walk every floor (a Duel has Fighters only); a Base with no floor under it is an error.
 */
export function compileArena(source: MapSource, battle: Pick<BattleTuning, 'field' | 'deploy' | 'squad' | 'levels'>): CompiledArena {
  const draft = compileDraft(source, battle);
  const rooms = source.brushes.flatMap((b) => (b.kind === 'enclosure' ? [b.rect] : []));
  if (rooms.length === 0) throw new Error(`${source.name} has no Enclosure: a duel map is a room`);
  const x0 = Math.min(...rooms.map((r) => r.x0)) - MARGIN;
  const x1 = Math.max(...rooms.map((r) => r.x1)) + MARGIN;
  const z0 = Math.min(...rooms.map((r) => r.z0)) - MARGIN;
  const z1 = Math.max(...rooms.map((r) => r.z1)) + MARGIN;
  const within = (xs: readonly number[], zs: readonly number[]) => Math.min(...xs) >= x0 && Math.max(...xs) <= x1 && Math.min(...zs) >= z0 && Math.max(...zs) <= z1;
  const walk: WalkSurface[] = draft.map.walk.filter((w) => within(w.points.map((p) => p.x), w.points.map((p) => p.z)));
  const walls: WallSegment[] = draft.arena.walls.filter((w) => !w.id.startsWith('WALL_edge_') && within([w.a.x, w.b.x], [w.a.z, w.b.z]));
  const bare: ArenaGeometry = { name: source.name, walk, walls, spawns: [], doors: [] };
  // A Base stands on the highest floor that is not deadly or a roof.
  const groundY = (p: GroundPoint): number => {
    let best: number | null = null;
    for (const i of surfacesAt(bare, p.x, p.z)) {
      const s = bare.walk[i]!;
      if (s.lava || s.water || s.abyss || s.roof) continue;
      const y = surfaceHeight(bare, i, p.x, p.z);
      if (best === null || y > best) best = y;
    }
    if (best === null) throw new Error(`${source.name}: a Base at (${p.x}, ${p.z}) stands on no floor`);
    return best;
  };
  const [a, b] = source.bases;
  const spawns = [...spawnsOf(0, a, b, groundY), ...spawnsOf(1, b, a, groundY)];
  return { arena: { ...bare, spawns }, warnings: draft.warnings };
}

/** An Arena as `data/arenas/<name>.json` writes it: one Walk Surface, Wall and spawn a line. */
export function arenaFileText(arena: ArenaGeometry): string {
  const line = (v: unknown) => JSON.stringify(v);
  const rows = (items: readonly unknown[]) => `[\n${items.map((v) => `    ${line(v)}`).join(',\n')}\n  ]`;
  const walk = arena.walk.map((w) => {
    const { id, points, ...kind } = w;
    return { id, points: points.map((p) => [p.x, p.y, p.z]), ...kind };
  });
  const walls = arena.walls.map((w) => ({ id: w.id, a: [w.a.x, w.a.z], b: [w.b.x, w.b.z], bottom: w.bottom, top: w.top }));
  const spawns = arena.spawns.map((s) => ({ team: s.team, slot: s.slot, position: [s.position.x, s.position.y, s.position.z], facing: s.facing }));
  return `{\n  "name": ${line(arena.name)},\n  "walk": ${rows(walk)},\n  "walls": ${rows(walls)},\n  "spawns": ${rows(spawns)}\n}\n`;
}
