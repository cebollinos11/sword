/**
 * docs/plans/map-editor.md, Stage 6: half-turn mirror mode. Twins are placed and edited together (move, resize, panel edit, material, delete,
 * duplicate, paint order), each one undo step, and a pair is turned back into two free parts on request; the compiler lists a mirrored map's
 * Objectives and Blocks so that k mirrors n - 1 - k and merges its Walk Surfaces so the half turn keeps them; the mirror check names what
 * is not its own half turn and is silent on a map that is; a source with no mirror data reads and compiles as before.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import { checkMap, mirrorIssues } from './checks';
import { compileDraft, compileMap, mapFileText } from './compile';
import { brushesTwin, inMirrorOrder, mirrorOrder, turnBrush, turnObjective, turnProp } from './mirror';
import { GROUND, sampleSource, withBrushes } from './sample.testdata';
import { blankSource, MapEditorSession, sourceFileText } from './session';
import { parseMapSource, type Brush, type MapSource, type Rect } from './source';

const tuning = loadTuningData();
const battle = tuning.battle;
const mirrorOf = (s: MapSource) => checkMap(s, tuning).issues.filter((i) => i.kind === 'mirror');
/** A session on a blank map in mirror mode with a second level (4 m) to build on. */
function mirrored(): MapEditorSession {
  const s = new MapEditorSession(blankSource('mirrored'));
  s.setMirror(true);
  s.addLevel(4);
  s.level = 0;
  return s;
}
/** The Brush `id` (its rectangle read where it has one). */
const brush = (s: MapEditorSession, id: string) => s.source.brushes.find((b) => b.id === id)! as Brush & { readonly rect: Rect };

describe('the half turn of each part', () => {
  it('turns a rectangle, a segment, a Ramp with its rails, an Objective and a prop, and twice is the same part', () => {
    const ramp: Brush = { kind: 'ramp', id: 'r', rect: { x0: -23, z0: -5.5, x1: -14, z1: 5.5 }, lo: 0, hi: 4, up: 'e', rails: ['n'] };
    expect(turnBrush(ramp)).toEqual({ ...ramp, rect: { x0: 14, z0: -5.5, x1: 23, z1: 5.5 }, up: 'w', rails: ['s'] });
    const rail: Brush = { kind: 'rail', id: 'l', a: { x: -14, z: -14 }, b: { x: 14, z: -14 }, y: 4, height: 1 };
    expect(turnBrush(rail)).toEqual({ ...rail, a: { x: 14, z: 14 }, b: { x: -14, z: 14 } });
    for (const b of [ramp, rail, GROUND]) expect(turnBrush(turnBrush(b))).toEqual(b);
    expect(brushesTwin(GROUND, GROUND)).toBe(true);
    expect(turnObjective({ id: 'D', x: 0, z: -32, weight: 1, owner: 0, spawn: true, y: 4 })).toEqual({ id: 'D', x: 0, z: 32, weight: 1, owner: 1, spawn: true, y: 4 });
    expect(turnProp({ id: 'b', kind: 'banner', x: 2, z: -88, y: 0, turn: 270, team: 0 })).toEqual({ id: 'b', kind: 'banner', x: -2, z: 88, y: 0, turn: 90, team: 1 });
  });

  it('orders a list so that k and n - 1 - k are twins, the free and self-twinned in the middle, and leaves a mirrored list as it is', () => {
    const list = [{ id: 'A', twin: 'C' }, { id: 'E', twin: 'D' }, { id: 'B', twin: 'B' }, { id: 'D', twin: 'E' }, { id: 'C', twin: 'A' }];
    expect(inMirrorOrder(list).map((v) => v.id)).toEqual(['A', 'E', 'B', 'D', 'C']);
    expect(inMirrorOrder([{ id: 'C', twin: 'A' }, { id: 'X' }, { id: 'A', twin: 'C' }]).map((v) => v.id)).toEqual(['C', 'X', 'A']);
    const ordered = [{ id: 'D', twin: 'E' }, { id: 'A', twin: 'C' }, { id: 'B', twin: 'B' }, { id: 'C', twin: 'A' }, { id: 'E', twin: 'D' }];
    expect(mirrorOrder(ordered)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('the Map Source keeps the links', () => {
  it('reads and writes `mirror` and `twin`, and refuses a broken link naming it', () => {
    const s = mirrored();
    s.addBrush('platform', { x: -20, z: -10 }, { x: -10, z: 10 });
    const text = sourceFileText(s.source);
    expect(text).toContain('"mirror": true');
    expect(parseMapSource(JSON.parse(text))).toEqual(s.source);
    const raw = JSON.parse(text);
    raw.brushes[1].twin = 'nobody';
    expect(() => parseMapSource(raw)).toThrow(/brushes\[1\] \(platform1\)\.twin names "nobody"/);
    raw.brushes[1].twin = 'ground';
    expect(() => parseMapSource(raw)).toThrow(/a twin is of its own kind/);
    raw.brushes[1].twin = 'platform2';
    raw.brushes[2].twin = 'platform2';
    expect(() => parseMapSource(raw)).toThrow(/twins name each other/);
    expect(() => parseMapSource({ ...JSON.parse(text), mirror: false })).toThrow(/source.mirror must be true/);
  });

  it('a source with no mirror data writes and compiles to the same bytes as before, and links alone change no compiled byte', () => {
    const sample = sampleSource();
    expect(sourceFileText(sample)).not.toMatch(/mirror|twin/);
    const plain = mapFileText(compileMap(sample, battle).map);
    // Links without mirror mode: the source writes them, the compiled map is the same.
    const linked = { ...sample, brushes: sample.brushes.map((b) => (b.id === 'rampS' ? { ...b, twin: 'rampN' } : b.id === 'rampN' ? { ...b, twin: 'rampS' } : b)) };
    expect(mapFileText(compileMap(linked, battle).map)).toBe(plain);
  });
});

describe('twins are edited together', () => {
  it('a Brush drawn in mirror mode gets its twin, painted right after it; a centred one is its own', () => {
    const s = mirrored();
    s.addBrush('platform', { x: -20, z: -10 }, { x: -10, z: 10 });
    expect(s.source.brushes.map((b) => [b.id, b.twin])).toEqual([
      ['ground', 'ground'],
      ['platform1', 'platform2'],
      ['platform2', 'platform1'],
    ]);
    expect(brush(s, 'platform2')).toEqual({ ...turnBrush(brush(s, 'platform1')), id: 'platform2', twin: 'platform1' });
    s.level = 4;
    s.addBrush('deck', { x: -10, z: -2 }, { x: 10, z: 2 });
    expect(brush(s, 'deck1').twin).toBe('deck1');
    expect(s.source.brushes).toHaveLength(4);
  });

  it('a move, a resize, a panel edit and a material each change both, one undo step each', () => {
    const s = mirrored();
    s.addBrush('ramp', { x: -23, z: -5.5 }, { x: -14, z: 5.5 });
    const steps = () => (s as unknown as { undoStack: unknown[] }).undoStack.length;
    const twinIsTurn = () => expect(brush(s, 'ramp2')).toEqual({ ...turnBrush(brush(s, 'ramp1')), id: 'ramp2', twin: 'ramp1' });
    let n = steps();
    // A drag of many moves is one step; the twin follows the other way.
    s.beginDrag();
    s.moveBrush('ramp1', -1, 0);
    s.moveBrush('ramp1', -3, 2);
    s.endDrag();
    expect(brush(s, 'ramp1').rect).toEqual({ x0: -26, z0: -3.5, x1: -17, z1: 7.5 });
    expect(brush(s, 'ramp2').rect).toEqual({ x0: 17, z0: -7.5, x1: 26, z1: 3.5 });
    expect(steps()).toBe(++n);
    // A resize by a handle: the twin's turned handle moves to the turned point.
    s.resizeBrush('ramp1', 'e', -14, 0);
    expect(brush(s, 'ramp2').rect.x0).toBe(14);
    twinIsTurn();
    expect(steps()).toBe(++n);
    // The panel: turned to rise east, one rail, a material, a rename. The twin rises west, is railed on its turned side, keeps its id, names the new one.
    s.replaceBrush('ramp1', { ...(brush(s, 'ramp1') as Extract<Brush, { kind: 'ramp' }>), id: 'rampW', up: 'e', rails: ['n'], material: 'cobble' });
    expect(brush(s, 'ramp2')).toMatchObject({ up: 'w', rails: ['s'], material: 'cobble', twin: 'rampW' });
    expect(brush(s, 'rampW').twin).toBe('ramp2');
    expect(steps()).toBe(++n);
    // The twin edited from its own side carries the first along.
    s.replaceBrush('ramp2', { ...brush(s, 'ramp2'), material: 'brick' });
    expect(brush(s, 'rampW').material).toBe('brick');
    expect(steps()).toBe(++n);
    s.undo();
    s.undo();
    expect(brush(s, 'ramp1').material).toBeUndefined();
    expect(brush(s, 'ramp2').material).toBeUndefined();
    twinIsTurn();
  });

  it('a delete and a duplicate do both; the paint order keeps a pair side by side', () => {
    const s = mirrored();
    s.addBrush('platform', { x: -20, z: -10 }, { x: -10, z: 10 });
    s.addBrush('block', { x: -60, z: -10 }, { x: -55, z: -5 });
    const copy = s.duplicateBrush('platform1');
    expect(s.source.brushes.map((b) => b.id)).toEqual(['ground', 'platform1', 'platform2', copy.id, 'platform4', 'block1', 'block2']);
    expect(brush(s, 'platform4')).toEqual({ ...turnBrush(brush(s, copy.id)), id: 'platform4', twin: copy.id });
    s.reorder('block1', -1);
    expect(s.source.brushes.map((b) => b.id)).toEqual(['ground', 'platform1', 'platform2', 'block1', 'block2', copy.id, 'platform4']);
    s.reorder('block2', -5);
    expect(s.source.brushes.map((b) => b.id)).toEqual(['block1', 'block2', 'ground', 'platform1', 'platform2', copy.id, 'platform4']);
    s.deleteBrush('platform2');
    expect(s.source.brushes.map((b) => b.id)).toEqual(['block1', 'block2', 'ground', copy.id, 'platform4']);
    s.undo();
    expect(s.source.brushes).toHaveLength(7);
  });

  it('a Brush that is its own twin stays centred: a move leaves it, a resize moves the opposite side too, a duplicate gets a twin', () => {
    const s = mirrored();
    s.level = 4;
    s.addBrush('deck', { x: -4, z: -10 }, { x: 4, z: 10 });
    const before = s.source;
    expect(() => s.moveBrush('deck1', 6, 3)).toThrow(/deck1 is its own twin, so it stays centred/);
    expect(s.source).toBe(before);
    s.resizeBrush('deck1', 'ne', 6, 12);
    expect(brush(s, 'deck1')).toMatchObject({ rect: { x0: -6, z0: -12, x1: 6, z1: 12 }, twin: 'deck1' });
    s.resizeBrush('deck1', 'w', 3, 0);
    expect(brush(s, 'deck1').rect).toMatchObject({ x0: -0.5, x1: 0.5 });
    s.addBrush('rail', { x: -5, z: -5 }, { x: 5, z: 5 });
    expect(brush(s, 'rail1').twin).toBe('rail1');
    s.resizeBrush('rail1', 'a', -8, 2);
    expect(brush(s, 'rail1')).toMatchObject({ a: { x: -8, z: 2 }, b: { x: 8, z: -2 } });
    const copy = s.duplicateBrush('deck1');
    expect(brush(s, copy.id).twin).toBeDefined();
    expect(brush(s, brush(s, copy.id).twin!)).toEqual({ ...turnBrush(brush(s, copy.id)), id: brush(s, copy.id).twin, twin: copy.id });
  });

  it('a pair is turned back into two free Brushes on request, and then moves apart', () => {
    const s = mirrored();
    s.addBrush('platform', { x: -20, z: -10 }, { x: -10, z: 10 });
    s.unlink('platform1');
    expect(brush(s, 'platform1').twin).toBeUndefined();
    expect(brush(s, 'platform2').twin).toBeUndefined();
    s.moveBrush('platform1', -5, 0);
    expect(brush(s, 'platform2').rect).toEqual({ x0: 10, z0: -10, x1: 20, z1: 10 });
    const issues = mirrorOf(s.source);
    expect(issues.slice(0, 2).map((i) => i.brushes)).toEqual([['platform1'], ['platform2']]);
    expect(new Set(issues.flatMap((i) => i.brushes))).toEqual(new Set(['platform1', 'platform2', 'ground']));
    s.undo();
    s.undo();
    expect(brush(s, 'platform1').twin).toBe('platform2');
  });

  it('Objectives, props and the Bases: placed in pairs, moved, edited and removed together; the order stays mirrored', () => {
    const s = mirrored();
    // Turning mirror mode on linked the blank map's five Objectives and its Bases.
    expect(s.source.objectives.map((o) => [o.id, o.twin])).toEqual([
      ['D', 'E'],
      ['A', 'C'],
      ['B', 'B'],
      ['C', 'A'],
      ['E', 'D'],
    ]);
    const f = s.addObjective({ x: -30, z: -60 });
    expect(s.source.objectives.map((o) => o.id)).toEqual(['D', 'A', 'F', 'B', 'G', 'C', 'E']);
    expect(s.source.objectives.find((o) => o.id === 'G')).toEqual({ ...turnObjective(f), id: 'G', twin: 'F' });
    s.moveMarker({ kind: 'objective', id: 'G' }, 4, 0);
    expect(s.source.objectives.find((o) => o.id === 'F')).toMatchObject({ x: -34, z: -60, y: 0 });
    s.replaceObjective('A', { id: 'A', x: -60, z: 0, weight: 1, owner: 0, spawn: false });
    expect(s.source.objectives.find((o) => o.id === 'C')).toMatchObject({ x: 60, owner: 1, twin: 'A' });
    // Moving the second of a pair later moves the first earlier: the pair keeps k and n - 1 - k.
    s.reorderObjective('C', 1);
    expect(s.source.objectives.map((o) => o.id)).toEqual(['A', 'D', 'F', 'B', 'G', 'E', 'C']);
    const moved = s.source;
    expect(() => s.moveMarker({ kind: 'objective', id: 'B' }, 10, 0)).toThrow(/Objective B is its own twin/);
    expect(s.source).toBe(moved);
    s.removeObjective('F');
    expect(s.source.objectives.map((o) => o.id)).toEqual(['A', 'D', 'B', 'E', 'C']);
    // Bases.
    s.moveMarker({ kind: 'base', team: 1 }, 10, -4);
    expect(s.source.bases).toEqual([
      { x: -10, z: -84 },
      { x: 10, z: 84 },
    ]);
    s.setSettings({ bases: [{ x: -10, z: -84 }, { x: 0, z: 90 }] });
    expect(s.source.bases).toEqual([
      { x: 0, z: -90 },
      { x: 0, z: 90 },
    ]);
    // Props.
    const p = s.addProp('banner', { x: 4, z: -80 });
    expect(s.source.look!.props!.map((q) => [q.id, q.x, q.z, q.twin])).toEqual([
      ['banner1', 4, -80, 'banner2'],
      ['banner2', -4, 80, 'banner1'],
    ]);
    s.replaceProp(p.id, { ...p, team: 0, turn: 90 });
    expect(s.source.look!.props![1]).toMatchObject({ team: 1, turn: 270 });
    s.moveMarker({ kind: 'prop', id: 'banner2' }, -2, 0);
    expect(s.source.look!.props![0]).toMatchObject({ x: 6, z: -80 });
    s.unlink({ kind: 'prop', id: 'banner2' });
    s.removeProp('banner1');
    expect(s.source.look!.props!.map((q) => q.id)).toEqual(['banner2']);
    expect(() => s.unlink({ kind: 'base', team: 0 })).toThrow(TuningDataError);
  });

  it('mirror mode off keeps the links; new parts are free', () => {
    const s = mirrored();
    s.addBrush('platform', { x: -20, z: -10 }, { x: -10, z: 10 });
    s.setMirror(false);
    expect(s.source.mirror).toBeUndefined();
    s.addBrush('platform', { x: 40, z: 40 }, { x: 50, z: 50 });
    expect(brush(s, 'platform3').twin).toBeUndefined();
    s.moveBrush('platform1', 0, 2);
    expect(brush(s, 'platform2').rect.z0).toBe(-12);
  });
});

describe('the compiler mirrors a mirrored map', () => {
  /** Two Holes each other's half turn in the ground: row-major greedy rectangles grow from the south-west and are not their own half turn. */
  const holes = (mirror: boolean): MapSource =>
    withBrushes(
      [
        { ...GROUND, twin: 'ground' },
        { kind: 'hole', id: 'h1', rect: { x0: 10, z0: 10, x1: 20, z1: 20 }, y: 0, twin: 'h2' },
        { kind: 'hole', id: 'h2', rect: { x0: -20, z0: -20, x1: -10, z1: -10 }, y: 0, twin: 'h1' },
        { kind: 'hazard', id: 'w1', rect: { x0: 10, z0: 10, x1: 20, z1: 20 }, y: -8, hazard: 'water', twin: 'w2' },
        { kind: 'hazard', id: 'w2', rect: { x0: -20, z0: -20, x1: -10, z1: -10 }, y: -8, hazard: 'water', twin: 'w1' },
      ],
      [-8, 0],
      mirror ? { mirror: true } : {},
    );

  it('merges the Walk Surfaces so the half turn keeps them, where row-major rectangles do not', () => {
    const plain = compileDraft(holes(false), battle);
    expect(mirrorIssues(holes(true), plain).map((i) => i.message)).toEqual([expect.stringMatching(/^ground's Walk Surfaces \(\d+\) have no half turn/)]);
    const draft = compileDraft(holes(true), battle);
    expect(mirrorIssues(holes(true), draft)).toEqual([]);
    // A band under each Hole and two beside it, and the ground between and beyond: seven, the half turn of each among them.
    expect(draft.map.walk.filter((w) => w.id.startsWith('WALK_ground'))).toHaveLength(7);
    // A source without mirror mode compiles as before.
    expect(mapFileText(compileMap(holes(false), battle).map)).toBe(mapFileText(compileMap({ ...holes(false), brushes: holes(false).brushes.map(({ twin: _t, ...b }) => b as Brush) }, battle).map));
  });

  it('lists Objectives and Blocks so that k mirrors n - 1 - k, whatever order the source gives', () => {
    const blocks: Brush[] = [
      { kind: 'block', id: 'b1', rect: { x0: 30, z0: 30, x1: 34, z1: 40 }, top: 3, twin: 'b4' },
      { kind: 'block', id: 'b2', rect: { x0: -60, z0: -10, x1: -56, z1: -4 }, top: 2.5, twin: 'b3' },
      { kind: 'block', id: 'b3', rect: { x0: 56, z0: 4, x1: 60, z1: 10 }, top: 2.5, twin: 'b2' },
      { kind: 'block', id: 'b4', rect: { x0: -34, z0: -40, x1: -30, z1: -30 }, top: 3, twin: 'b1' },
      { kind: 'block', id: 'mid', rect: { x0: -2, z0: -2, x1: 2, z1: 2 }, top: 3, twin: 'mid' },
    ];
    const objectives = [
      { id: 'A', x: -50, z: 0, weight: 1, owner: -1 as const, spawn: false, twin: 'C' },
      { id: 'E', x: 0, z: 40, weight: 1, owner: 1 as const, spawn: true, twin: 'D' },
      { id: 'B', x: 0, z: 10, weight: 1.4, owner: -1 as const, spawn: false, twin: 'B2' },
      { id: 'C', x: 50, z: 0, weight: 1, owner: -1 as const, spawn: false, twin: 'A' },
      { id: 'D', x: 0, z: -40, weight: 1, owner: 0 as const, spawn: true, twin: 'E' },
      { id: 'B2', x: 0, z: -10, weight: 1.4, owner: -1 as const, spawn: false, twin: 'B' },
    ];
    const source = withBrushes([{ ...GROUND, twin: 'ground' }, ...blocks], [0], { objectives, mirror: true });
    const { map } = compileMap(source, battle);
    expect(map.objectives.map((o) => o.id)).toEqual(['A', 'E', 'B', 'B2', 'D', 'C']);
    expect(map.blocks.map((b) => b.id)).toEqual(['BLOCK_b1', 'BLOCK_b2', 'BLOCK_mid', 'BLOCK_b3', 'BLOCK_b4']);
    const n = map.objectives.length;
    map.objectives.forEach((o, k) => expect(turnObjective(o as never)).toMatchObject({ x: map.objectives[n - 1 - k]!.x, z: map.objectives[n - 1 - k]!.z, owner: map.objectives[n - 1 - k]!.owner }));
    expect(map.objectives.some((o) => 'twin' in o)).toBe(false);
    expect(mirrorOf(source)).toEqual([]);
    // Without mirror mode, the source's own order.
    expect(compileMap({ ...source, mirror: undefined }, battle).map.objectives.map((o) => o.id)).toEqual(['A', 'E', 'B', 'C', 'D', 'B2']);
  });
});

describe('the mirror check', () => {
  const clean = (): MapSource => {
    const s = mirrored();
    s.addBrush('platform', { x: -20, z: -10 }, { x: -10, z: 10 });
    s.addBrush('ramp', { x: -28, z: -3 }, { x: -20, z: 3 });
    const r = brush(s, 'ramp1') as Extract<Brush, { kind: 'ramp' }>;
    s.replaceBrush('ramp1', { ...r, up: 'e', rails: ['n', 's'] });
    s.addBrush('block', { x: -60, z: -30 }, { x: -55, z: -20 });
    s.addProp('tree', { x: -70, z: 50 });
    return s.source;
  };

  it('is silent on a clean mirrored map and on the blank one', () => {
    expect(checkMap(clean(), tuning).ok).toBe(true);
    expect(mirrorOf(clean())).toEqual([]);
    expect(mirrorOf({ ...blankSource(), mirror: true })).toEqual([]);
  });

  it('fires on a broken twin, a free Brush with no half turn, Objectives and Bases out of turn, naming them', () => {
    const s = clean();
    const broken = { ...s, brushes: s.brushes.map((b) => (b.id === 'platform2' ? { ...b, rect: { ...(b as Extract<Brush, { rect: unknown }>).rect, x1: 19 } } : b)) };
    const issues = mirrorOf(broken);
    expect(issues[0]).toMatchObject({ severity: 'warning', brushes: ['platform1', 'platform2'], message: expect.stringContaining("platform1 and platform2 are twins but not each other's half turn (platform2's rect)") });
    // The compiled map's parts the half turn misses, by Brush.
    expect(new Set(issues.slice(1).flatMap((i) => i.brushes))).toEqual(new Set(['ground', 'platform1', 'platform2', 'ramp2']));

    const free: MapSource = { ...s, brushes: [...s.brushes, { kind: 'wall', id: 'lone', a: { x: 40, z: 40 }, b: { x: 44, z: 40 }, bottom: -1, top: 3 }] };
    expect(mirrorOf(free).map((i) => [i.brushes, i.message.slice(0, 40)])).toEqual([
      [['lone'], 'lone has no half turn on the map: draw i'],
      [['lone'], "lone's Walls (1) have no half turn among"],
    ]);

    const objectives = s.objectives.map((o) => (o.id === 'A' ? { ...o, x: -45 } : o));
    expect(mirrorOf({ ...s, objectives }).map((i) => [i.objective, i.message.slice(0, 51)])).toEqual([['A', "Objective A (2nd in the Battle's order) and C (4th)"]]);
    const owned = s.objectives.map((o) => (o.id === 'B' ? { ...o, owner: 0 as const } : o));
    expect(mirrorOf({ ...s, objectives: owned })[0]!.message).toMatch(/^Objective B, the middle of the Battle's order, is not its own half turn/);
    expect(mirrorOf({ ...s, bases: [s.bases[0], { x: 3, z: 88 }] })).toMatchObject([{ base: 1, message: expect.stringMatching(/^Team 1's Base is not the half turn/) }]);
  });

  it('fires on a paint order that breaks the half turn, and on twins of Blocks out of order', () => {
    const s = clean();
    // A Floor over the platform's foot, painted over platform1 but under its twin's twin: the twins lay different floors.
    const floors: Brush[] = [
      { kind: 'floor', id: 'f1', rect: { x0: -22, z0: -12, x1: -12, z1: 12 }, y: 0, twin: 'f2' },
      { kind: 'floor', id: 'f2', rect: { x0: 12, z0: -12, x1: 22, z1: 12 }, y: 0, twin: 'f1' },
    ];
    const b = s.brushes;
    const at = (id: string) => b.findIndex((x) => x.id === id);
    const order = [...b.slice(0, at('platform1')), floors[0]!, b[at('platform1')]!, b[at('platform2')]!, floors[1]!, ...b.slice(at('platform2') + 1)];
    const issues = mirrorOf({ ...s, brushes: order });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.message.includes('have no half turn among'))).toBe(true);
    const named = new Set(issues.flatMap((i) => i.brushes));
    expect(named.has('f1') && named.has('f2')).toBe(true);
    // Two pairs of Blocks each other's half turn but not linked: the compiled order keeps them as the source lists them, so Block k is not
    // n - 1 - k's twin, and Soldiers pushed out of them break their ties differently for each Team.
    const two = new MapEditorSession(s);
    two.addBrush('block', { x: 60, z: -30 }, { x: 65, z: -20 });
    const unlinked = { ...two.source, brushes: two.source.brushes.map((x) => (x.kind === 'block' ? (({ twin: _t, ...y }) => y as Brush)(x) : x)) };
    expect(mirrorOf(unlinked).map((i) => i.brushes)).toEqual([
      ['block1', 'block4'],
      ['block2', 'block3'],
    ]);
    expect(mirrorOf(two.source)).toEqual([]);
  });
});
