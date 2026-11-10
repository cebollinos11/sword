/**
 * docs/plans/map-editor.md, Stage 2: the Map Editor's live checks say what the Simulation will do on a Map Source (its own walk check, walk
 * rule, destination fields and marker placement on the compiled draft) and name the Brushes concerned; and they run well inside an edit
 * on a source the size of the City.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { filesFit } from '../sim/squad';
import { checkMap, fieldClearance, issueBounds, steepestRamp, type IssueKind, type MapChecks } from './checks';
import { compileMap } from './compile';
import { citySizedSource, GROUND, sampleSource, withBrushes } from './sample.testdata';
import type { Brush, MapSource } from './source';

const tuning = loadTuningData();
const battle = tuning.battle;
const check = (s: MapSource, edges = false) => checkMap(s, tuning, { edges });
const of = (c: MapChecks, kind: IssueKind) => c.issues.filter((i) => i.kind === kind);

const PLATFORM: Brush = { kind: 'platform', id: 'keep', rect: { x0: -10, z0: -6, x1: 10, z1: 6 }, top: 3 };
const RAMP: Brush = { kind: 'ramp', id: 'rampS', rect: { x0: -3, z0: -18, x1: 3, z1: -6 }, lo: 0, hi: 3, up: 'n', rails: ['e', 'w'] };
/** A keep with its Ramp: two levels, no Wall on a field cell centre. */
const KEEP = (more: readonly Brush[] = []) => withBrushes([GROUND, PLATFORM, RAMP, ...more], [0, 3]);

describe('the live checks: the Done', () => {
  it('a floating Platform (no Ramp up to it) is an error naming it, and its top is unreached', () => {
    const tower: Brush = { kind: 'platform', id: 'tower', rect: { x0: 30, z0: 30, x1: 40, z1: 40 }, top: 3 };
    const c = check(KEEP([tower]));
    expect(c.ok).toBe(false);
    const [lost, ...rest] = of(c, 'unreachable');
    expect(rest).toEqual([]);
    expect(lost).toMatchObject({ severity: 'error', brushes: ['tower'] });
    expect(lost!.message).toContain('cannot be walked to from WALK_ground_0');
    c.draft!.surfaceBrush.forEach((b, i) => expect(c.reach[i]).toBe(b === 'tower' ? 'unreached' : 'reached'));
    // Save refuses it for the same reason, naming the same Brush.
    expect(() => compileMap(KEEP([tower]), battle)).toThrow(/tower/);
  });

  it('lava 2 m under a bank is a warning naming the lava, then the bank Soldiers drop off into it', () => {
    const pit: Brush = { kind: 'hole', id: 'pit', rect: { x0: 30, z0: 20, x1: 46, z1: 36 }, y: 0 };
    const lava: Brush = { kind: 'hazard', id: 'lava', rect: { x0: 30, z0: 20, x1: 46, z1: 36 }, y: -2, hazard: 'lava' };
    const c = check(withBrushes([GROUND, pit, lava], [-2, 0]));
    expect(c.ok).toBe(true);
    const deadly = of(c, 'deadly');
    expect(deadly).toHaveLength(1);
    expect(deadly[0]).toMatchObject({ severity: 'warning', brushes: ['lava', 'ground'] });
    expect(deadly[0]!.message).toContain('drop 2 m off ground');
    // 8 m down (the sample's pit) is out of a Soldier's drop: nothing fires.
    const deep = check(withBrushes([GROUND, pit, { ...lava, y: -8 }], [-8, 0]));
    expect(of(deep, 'deadly')).toEqual([]);
  });

  it('a Rail on a destination-field cell centre is a warning naming it; one off the centres is not', () => {
    const fence = (x: number): Brush => ({ kind: 'rail', id: 'fence', a: { x, z: 30 }, b: { x, z: 41 }, y: 0, height: 1 });
    const on = check(KEEP([fence(20)]));
    const centre = of(on, 'centre');
    expect(centre).toHaveLength(1);
    expect(centre[0]).toMatchObject({ severity: 'warning', brushes: ['fence'], at: { x: 20, z: 32 } });
    expect(on.centres.cell).toBe(battle.crowd.flowCell);
    expect(on.centres.hits.map((h) => [h.x, h.z, h.y, h.brush])).toEqual([
      [20, 32, 0, 'fence'],
      [20, 36, 0, 'fence'],
      [20, 40, 0, 'fence'],
    ]);
    expect(of(check(KEEP([fence(21)])), 'centre')).toEqual([]);
    // A map of one level reads no Wall in its fields: the same Rail there cuts nothing off.
    const flat = check(withBrushes([GROUND, fence(20)], [0]));
    expect(flat.centres.layered).toBe(false);
    expect(of(flat, 'centre')).toEqual([]);
  });

  it("on Stage 0's sample nothing fires but the field cell centres its keep's faces and ramps' rails stand on, and C's note", () => {
    const c = check(sampleSource());
    expect(c.ok).toBe(true);
    // The sample was laid out before these checks, on the source's 5 m coarse grid; the destination fields' cell is 4 m (`crowd.flowCell`),
    // and its keep's sides (x ±12, z ±8), its ramps' rails (x ±4) and its pit's bank under the bridge (x 20, 36) lie on its centres.
    expect(c.issues.map((i) => [i.severity, i.kind, i.brushes[0]])).toEqual([
      ['warning', 'centre', 'keep'],
      ['warning', 'centre', 'rampS'],
      ['warning', 'centre', 'rampN'],
      ['warning', 'centre', 'bridge'],
      ['note', 'objective', 'bridge'],
    ]);
    expect(c.issues[4]).toMatchObject({ objective: 'C' });
    expect(c.reach.every((r) => r === 'reached' || r === 'deadly')).toBe(true);
  });
});

describe('the live checks', () => {
  it("colours each edge as a Soldier crosses it: walks between floors, drops off the keep's top, Walls at its faces and the ramp's rails", () => {
    const c = check(KEEP(), true);
    const d = c.draft!;
    expect(check(KEEP()).edges).toEqual([]);
    const kinds = (brush: string) => new Set(c.edges.filter((e) => d.surfaceBrush[e.surface] === brush).map((e) => e.kind));
    // The keep's top is 3 m up: within a Soldier's drop, so its open sides are drops; its top walks onto the ramp.
    expect(kinds('keep')).toEqual(new Set(['drop', 'walk']));
    // The ground walks between its rectangles and onto the ramp's foot, and meets Walls at the keep's faces and the ramp's rails.
    expect(kinds('ground')).toEqual(new Set(['walk', 'wall']));
    expect(kinds('rampS')).toEqual(new Set(['walk', 'wall']));
    // The field's edge is a Wall too.
    expect(c.edges.some((e) => e.kind === 'wall' && e.a.x === -100 && e.b.x === -100)).toBe(true);
    // Runs cover the edges end to end: the keep's top's four sides add up to its perimeter.
    const keepLength = c.edges.filter((e) => d.surfaceBrush[e.surface] === 'keep').reduce((sum, e) => sum + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), 0);
    expect(keepLength).toBeCloseTo(2 * (20 + 12), 6);
    // 4 m up (the sample's keep) is more than a drop: a ledge.
    expect(check(sampleSource(), true).edges.some((e) => e.kind === 'ledge')).toBe(true);
  });

  it('warns of an Objective or a Base with no floor, an Objective whose y names no floor, and a Ramp steeper than a Fighter walks', () => {
    const pit: Brush = { kind: 'hole', id: 'pit', rect: { x0: 45, z0: -5, x1: 55, z1: 5 }, y: 0 };
    const gap: Brush = { kind: 'hole', id: 'gap', rect: { x0: -5, z0: -92, x1: 5, z1: -84 }, y: 0 };
    const steep: Brush = { kind: 'ramp', id: 'cliff', rect: { x0: 60, z0: 40, x1: 64, z1: 40.5 }, lo: 0, hi: 3, up: 'n', rails: [] };
    const top: Brush = { kind: 'platform', id: 'top', rect: { x0: 58, z0: 40.5, x1: 66, z1: 46 }, top: 3 };
    const base = withBrushes([GROUND, PLATFORM, RAMP, pit, gap, steep, top], [0, 3]);
    const c = check({ ...base, objectives: base.objectives.map((o) => (o.id === 'A' ? { ...o, y: 7 } : o)) });
    expect(of(c, 'objective').map((i) => [i.objective, i.brushes])).toEqual([
      ['A', ['ground']],
      ['C', []],
    ]);
    expect(of(c, 'objective')[1]!.message).toContain('no Walk Surface under it');
    expect(of(c, 'base')).toMatchObject([{ base: 0, brushes: [] }]);
    expect(of(c, 'steep')).toMatchObject([{ brushes: ['cliff'] }]);
    // A Fighter climbs a step a Tick at its fastest walk: the sample's ramps (4 m in 12) are far under it.
    expect(steepestRamp(tuning)).toBeGreaterThan(1);
    expect(of(check(sampleSource()), 'steep')).toEqual([]);
    // The compiler's own warning (the pit opens onto nothing) comes through, naming its Brush.
    expect(of(c, 'compiler').map((i) => i.brushes)).toContainEqual(['ground']);
  });

  it("a source the compiler refuses is one error naming its Brushes, with nothing else to show", () => {
    const deck: Brush = { kind: 'deck', id: 'roof', rect: { x0: -5, z0: -5, x1: 5, z1: 5 }, y: 4 };
    const block: Brush = { kind: 'block', id: 'crate', rect: { x0: -2, z0: -2, x1: 2, z1: 2 }, top: 3 };
    const c = check(withBrushes([GROUND, block, deck], [0, 4]));
    expect(c.ok).toBe(false);
    expect(c.draft).toBeNull();
    expect(c.issues).toMatchObject([{ severity: 'error', kind: 'compile', brushes: ['crate', 'roof'] }]);
  });

  it('frames an issue on its Brushes, or on its point when its Brush is the whole ground', () => {
    const tower: Brush = { kind: 'platform', id: 'tower', rect: { x0: 30, z0: 30, x1: 40, z1: 40 }, top: 3 };
    const s = KEEP([tower]);
    const c = check(s);
    expect(issueBounds(s, of(c, 'unreachable')[0]!)).toEqual({ x0: 30, z0: 30, x1: 40, z1: 40 });
    expect(issueBounds(s, { severity: 'warning', kind: 'objective', message: '', brushes: ['ground'], at: { x: 50, z: 0 } })).toEqual({ x0: 46, z0: -4, x1: 54, z1: 4 });
  });

  it("gives the destination fields' clearance from the Battle's own build, and the files a Formation fits there", () => {
    const c = check(KEEP());
    const cl = fieldClearance(c, battle)!;
    expect(cl.cell).toBe(battle.crowd.flowCell);
    for (const n of cl.nodes) expect(n.files).toBe(Math.min(battle.squad.line.wide, filesFit(battle, n.clearance)));
    // On the ramp (6 m wide, railed) a Formation goes in one file; out on the open ground it keeps its line.
    const onRamp = cl.nodes.filter((n) => n.x === 0 && n.z === -12 && n.y > 0);
    expect(onRamp).toHaveLength(1);
    expect(onRamp[0]!.files).toBe(1);
    expect(cl.nodes.find((n) => n.x === -60 && n.z === 60)!.files).toBe(battle.squad.line.wide);
    // A map Save refuses has no Battlefield to build fields on.
    expect(fieldClearance(check(KEEP([{ kind: 'platform', id: 'tower', rect: { x0: 30, z0: 30, x1: 40, z1: 40 }, top: 3 }])), battle)).toBeNull();
  });

  it('checks a City-sized source cleanly (timed in checks.slow.test.ts)', () => {
    const c = check(citySizedSource());
    expect(c.ok).toBe(true);
    expect(c.issues).toEqual([]);
    expect(c.draft!.map.walk.length).toBeGreaterThan(600);
  });

  it('gives the same checks for the same source', () => {
    expect(JSON.stringify(check(sampleSource()).issues)).toBe(JSON.stringify(check(sampleSource()).issues));
    expect(check(sampleSource(), true).edges).toEqual(check(sampleSource(), true).edges);
  });
});
