/**
 * The judge: whether an Arena is fit to fight in, checked with the real navmesh (ADR 0006, 0011, 0013).
 *   - Every spawn reaches every enemy spawn by walk and drop Links alone, so the plain AI (no jump Links) can
 *     always reach the fight.
 *   - The two Teams start apart: no spawn within MIN_SPAWN_GAP of an enemy spawn.
 *   - No spawn has deadly ground (or none at all) within DEADLY_RADIUS that it could walk straight onto, no Wall between.
 *   - A Hall Arena (docs/plans/dungeon.md) has the Doors its name asks for; every Door's zone and spawns reach every enemy
 *     spawn by walk and drop Links alone, and no part of a door zone is deadly ground (or none).
 *   - Enough open floor at the lowest fighting level: a share of the footprint (from above).
 *   - The navmesh is cheap to build: at most `maxJumpLinks` jump Links (simulating Jumps is nearly all of a build, about
 *     3.5 ms per jump Link found), and, when the caller hands in a clock (`now`), built within `maxBuildMs`. The Simulation
 *     never reads a clock, and a verdict that hung on the machine's speed would not be deterministic, so `generateArena`
 *     judges by the jump Links alone.
 */
import type { ArenaDoor, ArenaGeometry, TuningData, WalkSurface } from '../../tuning';
import { blockedAt, deadly, groundBelow, wallCrossing } from '../arena';
import { corners, findPath, navMesh, navPolygon, type NavPoint } from '../nav';
import { SPAWNS_PER_TEAM } from './assemble';

export interface JudgeRules {
  /** The least share (0–1) of the footprint that is open floor at the lowest fighting level. */
  readonly minOpenFloor: number;
  /** The longest (ms) the navmesh may take to build, when `now` is given. */
  readonly maxBuildMs: number;
  /** The most jump Links (shortcuts too) the navmesh may hold: the deterministic stand-in for its build time. */
  readonly maxJumpLinks: number;
  /** Spawns each Team must have. */
  readonly spawnsPerTeam: number;
  /** Doors the Arena must have (a Hall Arena's, from its name; 0 for any other). */
  readonly doors: number;
  /** A clock (ms) to time the navmesh build with; without one it is not timed. */
  readonly now?: () => number;
}

export const DEFAULT_JUDGE_RULES: JudgeRules = { minOpenFloor: 0.25, maxBuildMs: 250, maxJumpLinks: 40, spawnsPerTeam: SPAWNS_PER_TEAM, doors: 0 };

/** How far (m) from a spawn no deadly ground may lie. */
export const DEADLY_RADIUS = 3;
/** The least distance (m, from above) between two enemy spawns. */
export const MIN_SPAWN_GAP = 6;
/** Ground near a spawn is looked at this often (m). */
const SAMPLE = 0.25;

export interface JudgeStats {
  readonly walkSurfaces: number;
  /** Links by kind; `jump` counts the jump Links that are not shortcuts. */
  readonly links: { readonly walk: number; readonly drop: number; readonly jump: number; readonly shortcut: number };
  /** How long (ms) the navmesh took to build, or null if not timed. */
  readonly buildMs: number | null;
  /** The longest walk (m, along the string-pulled path) from a spawn to an enemy spawn, by walk and drop Links alone. */
  readonly longestSpawnPath: number;
  /** The share of the footprint that is open floor at the lowest fighting level. */
  readonly openFloor: number;
}

export interface Judgement {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  readonly stats: JudgeStats;
}

export function judgeArena(arena: ArenaGeometry, tuning: TuningData, rules: Partial<JudgeRules> = {}): Judgement {
  const { minOpenFloor, maxBuildMs, maxJumpLinks, spawnsPerTeam, doors, now } = { ...DEFAULT_JUDGE_RULES, ...rules };
  const reasons: string[] = [];

  const t0 = now?.();
  const mesh = navMesh(arena, tuning);
  const buildMs = now && t0 !== undefined ? now() - t0 : null;
  if (buildMs !== null && buildMs > maxBuildMs) reasons.push(`the navmesh took ${buildMs.toFixed(0)} ms to build (most ${maxBuildMs} ms)`);

  const teams = [0, 1].map((team) => arena.spawns.filter((s) => s.team === team).sort((a, b) => a.slot - b.slot));
  teams.forEach((spawns, team) => {
    if (spawns.length < spawnsPerTeam) reasons.push(`team ${team} has ${spawns.length} spawns (needs ${spawnsPerTeam})`);
  });
  const at = (s: ArenaGeometry['spawns'][number]): NavPoint => s.position;

  for (const s of arena.spawns) {
    const { x, y, z } = s.position;
    if (navPolygon(arena, tuning, at(s)) < 0) reasons.push(`team ${s.team} spawn ${s.slot} stands on no Walk Surface`);
    if (deadlyNear(arena, tuning, x, y, z)) reasons.push(`team ${s.team} spawn ${s.slot} has deadly ground within ${DEADLY_RADIUS} m`);
  }

  const gap = Math.min(...teams[0]!.flatMap((a) => teams[1]!.map((b) => Math.sqrt((a.position.x - b.position.x) ** 2 + (a.position.z - b.position.z) ** 2))));
  if (gap < MIN_SPAWN_GAP) reasons.push(`enemy spawns stand ${gap.toFixed(1)} m apart (least ${MIN_SPAWN_GAP} m)`);

  let longest = 0;
  for (const a of teams[0]!)
    for (const b of teams[1]!)
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const path = findPath(arena, tuning, at(from), at(to), { jumps: false });
        if (!path) {
          reasons.push(`team ${from.team} spawn ${from.slot} cannot reach team ${to.team} spawn ${to.slot} by walking and dropping`);
          continue;
        }
        let length = 0;
        let last = { x: from.position.x, z: from.position.z };
        for (const c of corners(arena, tuning, path, last, { x: to.position.x, z: to.position.z })) (length += Math.sqrt((c.x - last.x) ** 2 + (c.z - last.z) ** 2)), (last = c);
        longest = Math.max(longest, length);
      }

  if (arena.doors.length !== doors) reasons.push(`the Arena has ${arena.doors.length} Doors (needs ${doors})`);
  arena.doors.forEach((door, i) => {
    if (zoneDeadly(arena, tuning, door)) reasons.push(`door ${i} has its zone over deadly ground`);
    const zone = door.zone.reduce((c, p) => ({ x: c.x + p.x / door.zone.length, y: c.y + p.y / door.zone.length, z: c.z + p.z / door.zone.length }), { x: 0, y: 0, z: 0 });
    const from: [string, NavPoint][] = [[`door ${i}'s zone`, zone], ...door.spawns.map((s): [string, NavPoint] => [`door ${i} spawn ${s.slot}`, at(s)])];
    for (const [what, p] of from) {
      if (navPolygon(arena, tuning, p) < 0) {
        reasons.push(`${what} stands on no Walk Surface`);
        continue;
      }
      for (const to of teams[1]!) if (!findPath(arena, tuning, p, at(to), { jumps: false })) reasons.push(`${what} cannot reach team 1 spawn ${to.slot} by walking and dropping`);
    }
  });

  const openFloor = openFloorShare(arena);
  if (openFloor < minOpenFloor) reasons.push(`open floor at the lowest level is ${(openFloor * 100).toFixed(0)}% of the footprint (least ${(minOpenFloor * 100).toFixed(0)}%)`);

  const links = { walk: 0, drop: 0, jump: 0, shortcut: 0 };
  for (const l of mesh.links) links[l.kind === 'jump' && l.shortcut ? 'shortcut' : l.kind]++;
  if (links.jump + links.shortcut > maxJumpLinks) reasons.push(`the navmesh has ${links.jump + links.shortcut} jump Links (most ${maxJumpLinks})`);
  return { ok: reasons.length === 0, reasons, stats: { walkSurfaces: arena.walk.length, links, buildMs, longestSpawnPath: longest, openFloor } };
}

/**
 * Whether a body standing at (x, y, z) has deadly ground, or none, within DEADLY_RADIUS that it could walk straight onto:
 * no Wall across the way, and no higher ground (a crate, a ramp's rise) standing in it.
 */
function deadlyNear(arena: ArenaGeometry, tuning: TuningData, x: number, y: number, z: number): boolean {
  const steps = Math.round(DEADLY_RADIUS / SAMPLE);
  const head = y + tuning.fighter.height / 2;
  for (let i = -steps; i <= steps; i++)
    for (let k = -steps; k <= steps; k++) {
      if (i * i + k * k > steps * steps) continue;
      const p = { x: x + i * SAMPLE, z: z + k * SAMPLE };
      const ground = groundBelow(arena, p.x, p.z, y + tuning.fall.stepUp);
      if (ground && !deadly(arena.walk[ground.surface]!)) continue;
      // The way there, every SAMPLE: blocked anywhere by higher ground (the point itself too), it never gets there.
      const n = Math.max(Math.abs(i), Math.abs(k));
      let blocked = false;
      for (let t = 1; t <= n && !blocked; t++) blocked = blockedAt(arena, x + (i * SAMPLE * t) / n, z + (k * SAMPLE * t) / n, y, tuning);
      if (!blocked && !wallCrossing({ x, y: head, z }, { x: p.x, y: head, z: p.z }, arena)) return true;
    }
  return false;
}

/** Whether any of a Door's zone (looked at every SAMPLE) has deadly ground, or none, under it. */
function zoneDeadly(arena: ArenaGeometry, tuning: TuningData, door: ArenaDoor): boolean {
  const xs = door.zone.map((p) => p.x);
  const zs = door.zone.map((p) => p.z);
  const y = Math.max(...door.zone.map((p) => p.y));
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += SAMPLE)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += SAMPLE) {
      if (!insideZone(door.zone, x, z)) continue;
      const ground = groundBelow(arena, x, z, y + tuning.fall.stepUp);
      if (!ground || deadly(arena.walk[ground.surface]!)) return true;
    }
  return false;
}

/** Whether (x, z) is inside (or on the edge of) the convex polygon `zone`, from above. */
function insideZone(zone: ArenaDoor['zone'], x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < zone.length; i++) {
    const a = zone[i]!;
    const b = zone[(i + 1) % zone.length]!;
    const cross = Math.sign((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x));
    if (cross === 0) continue;
    if (sign !== 0 && cross !== sign) return false;
    sign = cross;
  }
  return true;
}

/** Twice the area (m²) of a Walk Surface seen from above. */
const area2 = (s: WalkSurface) => Math.abs(s.points.reduce((sum, p, i) => sum + p.x * s.points[(i + 1) % s.points.length]!.z - s.points[(i + 1) % s.points.length]!.x * p.z, 0));

/** The share of the footprint (the bounds of every Walk Surface that is not deadly, from above) that is flat floor at the lowest such height. */
function openFloorShare(arena: ArenaGeometry): number {
  const live = arena.walk.filter((s) => !deadly(s));
  const flat = live.filter((s) => s.points.every((p) => p.y === s.points[0]!.y));
  if (!flat.length) return 0;
  const lowest = Math.min(...flat.map((s) => s.points[0]!.y));
  const xs = live.flatMap((s) => s.points.map((p) => p.x));
  const zs = live.flatMap((s) => s.points.map((p) => p.z));
  const footprint = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  return flat.filter((s) => s.points[0]!.y === lowest).reduce((sum, s) => sum + area2(s) / 2, 0) / footprint;
}
