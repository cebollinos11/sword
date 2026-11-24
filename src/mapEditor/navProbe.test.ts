import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { delverFloor } from '../sim/delver';
import { compileDraft } from './compile';
import { floorTargets, mapTargets, navIssues, probeRoutes, type NavTarget } from './navProbe';
import { AiWalk, walkAll, walkIssues, type WalkLeg } from './navWalk';
import { blankSource } from './session';
import type { MapSource } from './source';

const tuning = loadTuningData();

/** The blank map with a Wall 40 m long across its middle (z = 0) and a 4 x 4 m Block at (30, 30). */
const walled = (): MapSource => {
  const s = blankSource('walled');
  return {
    ...s,
    brushes: [
      ...s.brushes,
      { kind: 'wall', id: 'across', a: { x: -20, z: 0 }, b: { x: 20, z: 0 }, bottom: -1, top: 3 },
      { kind: 'block', id: 'box', rect: { x0: 28, z0: 28, x1: 32, z1: 32 }, top: 3 },
    ],
  };
};
const at = (label: string, x: number, z: number, y = 0): NavTarget => ({ label, x, z, y });

describe('the navmesh probe', { timeout: 60_000 }, () => {
  it("a Floor's targets: the Entrance spawn, every Hall's centre and each marker, and every one routed there and back", () => {
    const f = delverFloor(tuning, 1, 1);
    const { start, targets } = floorTargets(f.plan);
    expect(start).toMatchObject({ x: f.plan.markers.spawns[0]!.x, z: f.plan.markers.spawns[0]!.z });
    expect(targets.length).toBeGreaterThanOrEqual(f.plan.halls.length);
    expect(targets.some((t) => t.label.includes('Stairs'))).toBe(true);
    f.plan.markers.fires.forEach((_, k) => expect(targets.some((t) => t.label.includes(`fire ${k + 1}`))).toBe(true));
    const probe = probeRoutes(f.field.arena, tuning, start, targets);
    for (const r of probe.routes) {
      expect(r.there, r.target.label).not.toBeNull();
      expect(r.back, r.target.label).not.toBeNull();
      expect(r.there!.corners.at(-1)).toEqual(r.target);
    }
    expect(navIssues(f.field.arena, tuning, probe)).toEqual([]);
  });

  it("a Battle map's targets: Team 0's Base, the Objectives, Team 1's Base", () => {
    const d = compileDraft(blankSource(), tuning.battle);
    const { start, targets } = mapTargets(d.map, d.arena);
    expect(start).toMatchObject({ x: 0, z: -88, y: 0 });
    expect(targets.map((t) => t.label)).toEqual(['Objective D', 'Objective A', 'Objective B', 'Objective C', 'Objective E', "Team 1's Base"]);
  });

  it('says where a target is off the navmesh', () => {
    const d = compileDraft(walled(), tuning.battle);
    const probe = probeRoutes(d.arena, tuning, at('start', 0, -10), [at('inside the Block', 30, 30), at('open ground', 10, 10)]);
    const issues = navIssues(d.arena, tuning, probe);
    expect(issues.map((i) => i.message)).toEqual(['AI: inside the Block is off the navmesh (no Walk Surface under it at 0 m).']);
  });
});

describe('the AI walk', { timeout: 60_000 }, () => {
  it('walks every target of a Floor and arrives, the same twice', () => {
    const f = delverFloor(tuning, 1, 1);
    const { start, targets } = floorTargets(f.plan);
    const legs = walkAll(tuning, f.field.arena, start, targets);
    expect(legs.map((l) => l.outcome)).toEqual(targets.map(() => 'arrived'));
    expect(walkAll(tuning, f.field.arena, start, targets)).toEqual(legs);
    expect(walkIssues(legs).filter((i) => i.severity !== 'note')).toEqual([]);
  });

  it('finds a Wall the navmesh does not see (one Walk Surface across it) as stuck, and walks on to the next target', () => {
    const d = compileDraft(walled(), tuning.battle);
    const w = new AiWalk(tuning, d.arena, at('start', 0, -10), [at('beyond the Wall', 0, 10), at('back on this side', -40, -10)]);
    while (!w.step(600));
    expect(w.legs.map((l) => l.outcome)).toEqual(['stuck', 'arrived']);
    const stuck = w.legs[0]!;
    // Against the Wall's south face.
    expect(Math.abs(stuck.at.x)).toBeLessThan(1);
    expect(stuck.at.z).toBeLessThan(0);
    expect(stuck.at.z).toBeGreaterThan(-1.5);
    expect(walkIssues(w.legs)[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/^AI walk: stuck at \(.*\) on the way to beyond the Wall/) });
  });

  it('a target with no route is no route, and the walk goes on, nearest first', () => {
    const d = compileDraft(walled(), tuning.battle);
    const legs = walkAll(tuning, d.arena, at('start', 0, -10), [at('inside the Block', 30, 30), at('open ground', -10, -20), at('further', -70, -70)]);
    expect(legs.map((l) => `${l.target.label} ${l.outcome}`)).toEqual(['open ground arrived', 'inside the Block noRoute', 'further arrived']);
    // Left where it stood, not put inside the Block.
    expect(legs[2]!.from).toEqual(legs[1]!.from);
  });

  it('words each outcome', () => {
    const p = { x: 1, z: 2, y: 0 };
    const leg = (outcome: WalkLeg['outcome'], hurt = 0): WalkLeg => ({ from: p, target: at('T', 5, 5), outcome, seconds: 30, expected: 10, at: p, hurt, trace: [] });
    expect(walkIssues([leg('arrived', 12), leg('slow'), leg('fell'), leg('noRoute')]).map((i) => `${i.severity} ${i.message}`)).toEqual([
      'error AI walk: died at (1.0, 2.0, 0.0 m) on the way to T.',
      'error AI walk: no route from (1.0, 2.0, 0.0 m) to T.',
      'warning AI walk: still walking on the way to T after 30 s (its route: 10 s), at (1.0, 2.0, 0.0 m).',
      'note AI walk: took 12 fall damage on the way to T.',
    ]);
  });
});
