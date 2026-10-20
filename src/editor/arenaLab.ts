/**
 * The Arena Lab (docs/plans/generated-arenas.md, Stage 2): the sandbox's dev-only folder for generating, rerolling,
 * viewing and fighting on Generated Arenas. The pure part (no DOM, no three.js; unit-tested).
 */
import { generateArena, judgeArena, type GeneratedArena, type GenParams } from '../sim';
import type { ArenaGeometry, TuningData } from '../tuning';

/** A copy of `tuning` holding `arena`, which the Editor fights in (`arena.editor`): every script, the AI and the navmesh use it unchanged. */
export function withArena(tuning: TuningData, arena: ArenaGeometry): TuningData {
  return { ...tuning, arenas: { ...tuning.arenas, [arena.name]: arena }, arena: { ...tuning.arena, editor: arena.name } };
}

/** A Generated Arena in the lab, with the Tuning Data to fight in it (`withArena`). */
export interface LabArena extends GeneratedArena {
  readonly tuning: TuningData;
}

/**
 * The Arena `seed` gives from the Kit named `kit` (out of `tuning.kits`), as `generateArena` builds it, with its report judged again with the clock running
 * (the lab shows the real navmesh build time; the Simulation never reads a clock). It is judged with the Tuning Data
 * returned, so the navmesh (cached per Arena and Tuning Data) is not built again for the Match.
 */
export function labArena(seed: number, params: GenParams, tuning: TuningData, kit = 'greybox'): LabArena {
  const kitData = tuning.kits[kit];
  if (!kitData) throw new Error(`no Kit "${kit}" (have: ${Object.keys(tuning.kits).join(', ')})`);
  const generated = generateArena(kitData, seed, params, tuning);
  const fought = withArena(tuning, generated.arena);
  const report = judgeArena(generated.arena, fought, { minOpenFloor: params.minOpenFloor, now: () => performance.now() });
  return { ...generated, report, tuning: fought };
}

/** The judge's report as the lab shows it: verdict, attempts, counts, build time, then any reasons. */
export function describeReport({ attempts, report }: Pick<GeneratedArena, 'attempts' | 'report'>): string {
  const { stats } = report;
  const { walk, drop, jump, shortcut } = stats.links;
  return [
    `${report.ok ? 'PASS' : 'FAIL'} · ${attempts} attempt${attempts === 1 ? '' : 's'}`,
    `${stats.walkSurfaces} Walk Surfaces · open floor ${(stats.openFloor * 100).toFixed(0)}%`,
    `Links: walk ${walk} · drop ${drop} · jump ${jump} · shortcut ${shortcut}`,
    `navmesh build ${stats.buildMs === null ? 'not timed' : `${stats.buildMs.toFixed(0)} ms`} · longest spawn path ${stats.longestSpawnPath.toFixed(1)} m`,
    ...report.reasons.map((r) => `✗ ${r}`),
  ].join('\n');
}

type Point = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Where the orbit camera stands (`position`) and looks (`target`) to see the whole footprint through a `fov`° view:
 * at the middle of the floors (the Abyss left out), from above and behind red's side (-z).
 */
export function frameArena(arena: ArenaGeometry, fov: number): { target: Point; position: Point } {
  const points = arena.walk.filter((s) => !s.abyss).flatMap((s) => s.points);
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const target = { x: (minX + maxX) / 2, y: Math.min(...points.map((p) => p.y)), z: (minZ + maxZ) / 2 };
  const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
  const distance = (1.1 * radius) / Math.tan((fov * Math.PI) / 360);
  // Looking down at about 50°.
  const [up, back] = [0.77, 0.64];
  return { target, position: { x: target.x, y: target.y + distance * up, z: target.z - distance * back } };
}
