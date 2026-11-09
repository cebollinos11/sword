/**
 * docs/plans/map-editor.md, Stage 1: the Map Editor's session. Every edit is validated by `parseMapSource` and undoable, a drag is one undo
 * step, places snap to the grid, and Save's files are exactly what the Map Compiler gives: Stage 0's sample, rebuilt by the operations the
 * editor's top view and panels call, saves to the same two files as the hand-written sample compiles to.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import { compileMap, mapFileText, MapCompileError } from './compile';
import { GROUND, sampleSource, withBrushes } from './sample.testdata';
import { blankSource, brushAt, brushLevels, handleAt, handlesOf, MapEditorSession, sourceFileText } from './session';
import { parseMapSource, type Brush, type MapSource } from './source';

const battle = loadTuningData().battle;

/** The Brush `id` of the session's source. */
const brush = (s: MapEditorSession, id: string): Brush => s.source.brushes.find((b) => b.id === id)!;
/** Rename the selected Brush to `id`, with any other changes. */
const renameSelected = (s: MapEditorSession, id: string, more: Partial<Brush> = {}) => s.replaceBrush(s.selected!, { ...s.selection!, ...more, id } as Brush);

/** Stage 0's sample, built as the user builds it in the editor: drawn by drags, resized, moved, renamed and set in the panels. */
function rebuildSample(): MapEditorSession {
  const s = new MapEditorSession();
  s.setSettings({ name: 'sample' });
  s.addLevel(4);
  s.addLevel(-8);
  s.level = 0;
  // The keep: drawn a little off, then dragged out by its north-east corner to size.
  s.addBrush('platform', { x: -12.2, z: -7.9 }, { x: 9.1, z: 5.2 });
  renameSelected(s, 'keep');
  s.beginDrag();
  s.resizeBrush('keep', 'ne', 10, 6);
  s.resizeBrush('keep', 'ne', 12.1, 8.2);
  s.endDrag();
  // The south ramp drawn where the north one goes, then dragged south.
  s.addBrush('ramp', { x: -4, z: 8 }, { x: 4, z: 20 });
  renameSelected(s, 'rampS');
  s.moveBrush('rampS', 0, -28);
  s.addBrush('ramp', { x: -4, z: 8 }, { x: 4, z: 20 });
  renameSelected(s, 'rampN', { up: 's' });
  s.addBrush('hole', { x: 36, z: 12 }, { x: 20, z: -12 });
  renameSelected(s, 'pit');
  s.level = -8;
  s.addBrush('hazard', { x: 20, z: -12 }, { x: 36, z: 12 });
  renameSelected(s, 'lava');
  s.level = 4;
  s.addBrush('deck', { x: 12, z: -3 }, { x: 44, z: 3 });
  renameSelected(s, 'bridge');
  s.addBrush('rail', { x: 12, z: -3 }, { x: 44, z: -3 });
  renameSelected(s, 'bridgeRailS');
  s.addBrush('rail', { x: 12, z: 3 }, { x: 44, z: 3 });
  renameSelected(s, 'bridgeRailN');
  s.setSettings({ objectives: s.source.objectives.map((o) => (o.id === 'C' ? { ...o, x: 40 } : o)) });
  return s;
}

describe('the Map Editor session', () => {
  it("rebuilds Stage 0's sample by hand, and saves exactly the files the Map Compiler gives for it", () => {
    const s = rebuildSample();
    const files = s.files(battle);
    expect(files.source).toEqual({ fileName: 'sample.source.json', path: 'data/battlemaps/sample.source.json', text: sourceFileText(sampleSource()) });
    expect(files.map).toEqual({ fileName: 'sample.json', path: 'data/battlemaps/sample.json', text: mapFileText(compileMap(sampleSource(), battle).map) });
    expect(parseMapSource(JSON.parse(files.source.text))).toEqual(parseMapSource(sampleSource()));
  });

  it('starts on a blank map that compiles: the whole field at 0, five Objectives', () => {
    expect(blankSource()).toEqual(parseMapSource(withBrushes([GROUND], [0], { name: 'newmap' })));
    const s = new MapEditorSession();
    expect(s.files(battle).map.text).toContain('"WALK_ground_0"');
    expect(s.dirty).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('writes a source file that reads back as the same source, the same text every time', () => {
    const text = sourceFileText(sampleSource());
    expect(parseMapSource(JSON.parse(text))).toEqual(parseMapSource(sampleSource()));
    expect(sourceFileText(parseMapSource(JSON.parse(text)))).toBe(text);
    // One Brush a line.
    expect(text.split('\n').filter((l) => l.includes('"kind"'))).toHaveLength(sampleSource().brushes.length);
  });

  it('snaps what it draws to the grid, and a click makes one coarse cell', () => {
    const s = new MapEditorSession();
    const b = s.addBrush('floor', { x: 3.3, z: -1.1 }, { x: 0.2, z: 7.76 });
    expect(b).toEqual({ kind: 'floor', id: 'floor1', rect: { x0: 0, z0: -1, x1: 3.5, z1: 8 }, y: 0 });
    expect(s.addBrush('floor', { x: 7, z: -3 }, { x: 7, z: -3 })).toMatchObject({ id: 'floor2', rect: { x0: 5, z0: -5, x1: 10, z1: 0 } });
    expect(s.addBrush('wall', { x: 2, z: 2 }, { x: 2, z: 2 })).toEqual({ kind: 'wall', id: 'wall1', a: { x: 2, z: 2 }, b: { x: 7, z: 2 }, bottom: -1, top: 3 });
    // Far off the field: kept inside it.
    expect(s.addBrush('hole', { x: 90, z: 90 }, { x: 130, z: 140 })).toMatchObject({ rect: { x0: 90, z0: 90, x1: 100, z1: 100 } });
    expect(s.selected).toBe('hole1');
  });

  it('stands a new Brush at the level being edited: Platforms and Ramps rise to the level above', () => {
    const s = new MapEditorSession();
    expect(() => s.addBrush('ramp', { x: 0, z: 0 }, { x: 4, z: 10 })).toThrow(/add a second level/);
    expect(s.source.brushes).toHaveLength(1);
    s.addLevel(4);
    s.level = 0;
    expect(s.addBrush('platform', { x: 0, z: 0 }, { x: 10, z: 10 })).toMatchObject({ top: 4 });
    expect(s.addBrush('ramp', { x: 0, z: 10 }, { x: 4, z: 20 })).toMatchObject({ lo: 0, hi: 4, up: 'n', rails: ['e', 'w'] });
    expect(s.addBrush('ramp', { x: 10, z: 0 }, { x: 20, z: 4 })).toMatchObject({ up: 'e', rails: ['n', 's'] });
    s.level = 4;
    expect(s.addBrush('ramp', { x: -20, z: 0 }, { x: -10, z: 4 })).toMatchObject({ lo: 0, hi: 4 });
    expect(s.addBrush('rail', { x: 0, z: 0 }, { x: 10, z: 0 })).toMatchObject({ y: 4, height: 1 });
    expect(s.addBrush('hazard', { x: 0, z: 0 }, { x: 10, z: 10 })).toMatchObject({ y: 4, hazard: 'lava' });
  });

  it('refuses an edit the parser refuses, changing nothing and adding no undo step', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    const before = s.source;
    expect(() => s.replaceBrush('floor1', { ...s.selection!, id: 'bad_id' } as Brush)).toThrow(TuningDataError);
    expect(() => s.replaceBrush('floor1', { ...s.selection!, id: 'ground' } as Brush)).toThrow(/already "ground"/);
    expect(() => s.replaceBrush('floor1', { ...s.selection!, y: 3 } as Brush)).toThrow(/one of the source's levels/);
    expect(() => s.setSettings({ name: 'Not A Name' })).toThrow(TuningDataError);
    expect(s.source).toBe(before);
    s.undo();
    expect(s.source.brushes).toHaveLength(1);
    expect(s.canUndo).toBe(false);
  });

  it('undoes and redoes every edit, and a new edit drops what could be redone', () => {
    const s = new MapEditorSession();
    const blank = s.source;
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    const one = s.source;
    s.moveBrush('floor1', 5, 0);
    expect(s.undo()).toBe(true);
    expect(s.source).toBe(one);
    expect(s.undo()).toBe(true);
    expect(s.source).toBe(blank);
    expect(s.selected).toBe(null);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true);
    expect(s.source).toBe(one);
    s.deleteBrush('floor1');
    expect(s.canRedo).toBe(false);
  });

  it('makes a drag one undo step, each move measured from where the drag began', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    const before = s.source;
    s.beginDrag();
    s.moveBrush('floor1', 1.2, 0);
    s.moveBrush('floor1', 2.6, -0.9);
    s.moveBrush('floor1', 2.4, -1.1);
    s.endDrag();
    expect(brush(s, 'floor1')).toMatchObject({ rect: { x0: 2.5, z0: -1, x1: 12.5, z1: 9 } });
    s.undo();
    expect(s.source).toBe(before);
    // A drag that changes nothing, or comes back to where it began, is no step.
    s.beginDrag();
    s.endDrag();
    s.beginDrag();
    s.moveBrush('floor1', 0.2, 0);
    s.moveBrush('floor1', 3, 0);
    s.moveBrush('floor1', -0.1, 0.1);
    s.endDrag();
    expect(s.canRedo).toBe(true);
  });

  it('keeps a moved Brush inside the field', () => {
    const s = new MapEditorSession();
    s.addLevel(4);
    s.level = 0;
    s.addBrush('platform', { x: 80, z: 80 }, { x: 90, z: 95 });
    s.moveBrush('platform1', 40, -300);
    expect(brush(s, 'platform1')).toMatchObject({ rect: { x0: 90, z0: -100, x1: 100, z1: -85 } });
  });

  it('resizes a rectangle by its handles, never thinner than a step, and a segment by its ends', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    s.resizeBrush('floor1', 'w', 12, 3);
    expect(brush(s, 'floor1')).toMatchObject({ rect: { x0: 9.5, z0: 0, x1: 10, z1: 10 } });
    s.resizeBrush('floor1', 'sw', -4.1, -2.2);
    expect(brush(s, 'floor1')).toMatchObject({ rect: { x0: -4, z0: -2, x1: 10, z1: 10 } });
    s.resizeBrush('floor1', 'n', 99, 20);
    expect(brush(s, 'floor1')).toMatchObject({ rect: { x0: -4, z0: -2, x1: 10, z1: 20 } });
    s.addBrush('rail', { x: 0, z: 0 }, { x: 10, z: 0 });
    s.resizeBrush('rail1', 'b', 10.2, 7.7);
    expect(brush(s, 'rail1')).toMatchObject({ a: { x: 0, z: 0 }, b: { x: 10, z: 7.5 } });
    s.resizeBrush('rail1', 'a', 10, 7.5);
    expect(brush(s, 'rail1')).toMatchObject({ a: { x: 0, z: 0 } });
  });

  it('duplicates a Brush a coarse cell over, right after it in paint order, and deletes', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    s.addBrush('hole', { x: 0, z: 0 }, { x: 5, z: 5 });
    const copy = s.duplicateBrush('floor1');
    expect(copy).toEqual({ kind: 'floor', id: 'floor2', rect: { x0: 5, z0: 0, x1: 15, z1: 10 }, y: 0 });
    expect(s.source.brushes.map((b) => b.id)).toEqual(['ground', 'floor1', 'floor2', 'hole1']);
    expect(s.selected).toBe('floor2');
    // The whole field's floor has nowhere to go: its copy stays in place.
    expect(s.duplicateBrush('ground')).toMatchObject({ id: 'floor3', rect: GROUND.rect });
    s.deleteBrush('floor2');
    expect(s.selected).toBe('floor3');
    expect(s.source.brushes.map((b) => b.id)).toEqual(['ground', 'floor3', 'floor1', 'hole1']);
    s.select('floor1');
    s.deleteBrush('floor1');
    expect(s.selected).toBe(null);
  });

  it('reorders the paint order, clamped to the list', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    s.addBrush('hole', { x: 0, z: 0 }, { x: 5, z: 5 });
    s.reorder('hole1', -1);
    expect(s.source.brushes.map((b) => b.id)).toEqual(['ground', 'hole1', 'floor1']);
    s.reorder('hole1', -10);
    expect(s.source.brushes.map((b) => b.id)).toEqual(['hole1', 'ground', 'floor1']);
    s.reorder('hole1', 10);
    expect(s.source.brushes.map((b) => b.id)).toEqual(['ground', 'floor1', 'hole1']);
  });

  it('keeps a renamed Brush selected, and refuses undo in the middle of a drag', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    renameSelected(s, 'yard');
    expect(s.selected).toBe('yard');
    s.beginDrag();
    s.moveBrush('yard', 5, 0);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
    s.endDrag();
    expect(s.undo()).toBe(true);
    expect(brush(s, 'yard')).toMatchObject({ rect: { x0: 0, x1: 10 } });
  });

  it('takes an edit that changes nothing as no edit: undo still steps back over the last real one', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    s.moveBrush('floor1', 5, 0);
    s.undo();
    s.replaceBrush('floor1', { ...s.selection! });
    s.setSettings({ name: s.source.name, objectives: s.source.objectives.map((o) => ({ ...o })) });
    expect(s.canRedo).toBe(true);
    s.undo();
    expect(s.source.brushes).toHaveLength(1);
  });

  it('refuses a Block whose top would not stand over 0, saying why', () => {
    const s = new MapEditorSession();
    s.addLevel(-4);
    expect(() => s.addBrush('block', { x: 0, z: 0 }, { x: 5, z: 5 })).toThrow(/Block's top is a height over 0/);
  });

  it('turns a Ramp keeping only rails on its new long sides', () => {
    const s = new MapEditorSession();
    s.addLevel(4);
    s.level = 0;
    s.addBrush('ramp', { x: 0, z: 0 }, { x: 4, z: 10 });
    s.replaceBrush('ramp1', { ...s.selection!, up: 'e' } as Brush);
    expect(brush(s, 'ramp1')).toMatchObject({ up: 'e', rails: [] });
  });

  it('adds and removes levels, refusing to remove one a Brush stands at', () => {
    const s = new MapEditorSession();
    s.addLevel(6);
    s.addLevel(3);
    expect(s.source.levels).toEqual([0, 3, 6]);
    expect(s.level).toBe(3);
    s.addBrush('deck', { x: 0, z: 0 }, { x: 10, z: 10 });
    expect(() => s.removeLevel(3)).toThrow(/levels/);
    s.removeLevel(6);
    expect(s.source.levels).toEqual([0, 3]);
    s.level = 0;
    expect(() => s.removeLevel(0)).toThrow(/levels/);
    s.deleteBrush('deck1');
    s.level = 3;
    s.removeLevel(3);
    expect(s.level).toBe(0);
    expect(() => s.removeLevel(0)).toThrow(/at least one level/);
  });

  it('tells unsaved edits apart, and starts over on Open', () => {
    const s = new MapEditorSession();
    s.addBrush('floor', { x: 0, z: 0 }, { x: 10, z: 10 });
    expect(s.dirty).toBe(true);
    s.undo();
    expect(s.dirty).toBe(false);
    s.redo();
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.level = 0;
    s.open(JSON.parse(sourceFileText(sampleSource())));
    expect(s.source.name).toBe('sample');
    expect(s.canUndo).toBe(false);
    expect(s.dirty).toBe(false);
    expect(() => s.open({ version: 2 })).toThrow(TuningDataError);
    expect(s.source.name).toBe('sample');
  });

  it('refuses to save a source that does not compile, naming its Brush', () => {
    const s = new MapEditorSession();
    s.addLevel(4);
    s.level = 0;
    s.addBrush('platform', { x: 0, z: 0 }, { x: 10, z: 10 });
    try {
      s.files(battle);
      throw new Error('it saved');
    } catch (e) {
      expect(e).toBeInstanceOf(MapCompileError);
      expect((e as MapCompileError).brushes).toEqual(['platform1']);
    }
  });
});

describe('picking in the top view', () => {
  const source: MapSource = parseMapSource(sampleSource());

  it('draws each Brush at its levels', () => {
    const at = (id: string) => brushLevels(source.brushes.find((b) => b.id === id)!, source.levels);
    expect(at('keep')).toEqual([4]);
    expect(at('rampS')).toEqual([0, 4]);
    expect(at('lava')).toEqual([-8]);
    expect(at('bridgeRailS')).toEqual([4]);
    expect(brushLevels({ kind: 'wall', id: 'w', a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, bottom: -1, top: 3 }, source.levels)).toEqual([0]);
    expect(brushLevels({ kind: 'block', id: 'k', rect: GROUND.rect, top: 3 }, source.levels)).toEqual([0]);
  });

  it('picks the Brush painted last under the point, segments first, at the level shown', () => {
    expect(brushAt(source, 0, 0, null, 0.5)?.id).toBe('keep');
    expect(brushAt(source, 0, 0, 0, 0.5)?.id).toBe('ground');
    expect(brushAt(source, 30, 0, null, 0.5)?.id).toBe('bridge');
    expect(brushAt(source, 30, -3.3, null, 0.5)?.id).toBe('bridgeRailS');
    expect(brushAt(source, 30, -8, null, 0.5)?.id).toBe('lava');
    expect(brushAt(source, 30, -8, 0, 0.5)?.id).toBe('pit');
    expect(brushAt(source, 30, -8, 4, 0.5)).toBe(null);
  });

  it("finds a Brush's handles", () => {
    const keep = source.brushes.find((b) => b.id === 'keep')!;
    expect(handlesOf(keep).map((h) => `${h.handle} ${h.x},${h.z}`)).toEqual(['sw -12,-8', 's 0,-8', 'se 12,-8', 'e 12,0', 'ne 12,8', 'n 0,8', 'nw -12,8', 'w -12,0']);
    expect(handleAt(keep, 11.6, 7.7, 1)).toBe('ne');
    expect(handleAt(keep, 6, 0, 1)).toBe(null);
    const rail = source.brushes.find((b) => b.id === 'bridgeRailN')!;
    expect(handleAt(rail, 44, 3.2, 1)).toBe('b');
  });
});
