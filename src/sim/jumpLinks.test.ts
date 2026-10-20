import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { arenaOf, groundBelow, jumpArc } from './index';
import { JUMP_SPOTS as SPOTS } from './jumpSpots.testdata';
import { findPath, navMesh, type NavPoint } from './nav';

const tuning = loadTuningData();

describe('Every held-Jump spot in docs/jump-reach.md has a jump Link', () => {
  for (const s of SPOTS) {
    it(`${s.arena}: ${s.spot}`, () => {
      const arena = arenaOf(tuning, s.arena);
      const y = groundBelow(arena, s.x, s.z, s.y + tuning.fall.stepUp)!.y;
      // Where the documented Jump lands: a point on the lid.
      const arc = jumpArc(arena, tuning, { at: { x: s.x, z: s.z }, y, heading: s.move, holdTicks: s.hold });
      expect(arc.lands!.y).toBeCloseTo(s.lid, 6);
      const from: NavPoint = { x: s.x, z: s.z, y };
      const to: NavPoint = arc.lands!;
      const mesh = navMesh(arena, tuning);
      const up = findPath(arena, tuning, from, to)!;
      expect(up).not.toBeNull();
      expect(up.some((id) => mesh.links[id]!.kind === 'jump')).toBe(true);
      // And down (or back) again: a drop off the lid, or a Jump where dropping would be deadly.
      expect(findPath(arena, tuning, to, from)).not.toBeNull();
    });
  }
});

describe('Building the navmesh', () => {
  it('takes well under a second for every Arena, jump Links and all (logged)', () => {
    const times: string[] = [];
    for (const name of Object.keys(tuning.arenas)) {
      // A fresh copy, never built before: the navmesh is cached per Arena.
      const arena = parseArena(JSON.parse(JSON.stringify(tuning.arenas[name])), name);
      const t0 = performance.now();
      const mesh = navMesh(arena, { ...tuning, arenas: { ...tuning.arenas, [name]: arena } });
      const ms = performance.now() - t0;
      times.push(`${name} ${ms.toFixed(0)} ms (${mesh.links.filter((l) => l.kind === 'jump').length} jump Links)`);
      expect(ms).toBeLessThan(1000);
    }
    console.log(`navmesh build: ${times.join(', ')}`);
  });
});
