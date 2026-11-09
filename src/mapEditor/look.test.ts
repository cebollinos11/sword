/**
 * docs/plans/map-editor.md, Stage 5: the look of a map made in the Map Editor (materials on its Brushes, props, a sky) is render-only. The Map
 * Source's look parses and round-trips; a source with none writes what Stage 4 wrote; the compiled map, and the Tuning Data hash of a Battle
 * on it, are the same bytes with and without it; each material is named so the game's texturing (`surfaceOf`) gives it the Surface meant.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, tuningDataHash } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import { surfaceOf, type Surface } from '../render/triplanar';
import { checkMap } from './checks';
import { compileMap, mapFileText } from './compile';
import { brushLook, HAZARD_LOOKS, MATERIAL_LOOKS, materialOf, PROP_LOOKS } from './look';
import { draftTuning } from './playtest';
import { dressedSampleSource, sampleSource } from './sample.testdata';
import { markerAt, MapEditorSession, sourceFileText } from './session';
import { MAP_MATERIALS, MAX_PROPS, parseMapSource, type MapMaterial, type MapSource } from './source';

const tuning = loadTuningData();
const battle = tuning.battle;
/** A source as JSON would give it back, to break by hand. */
const raw = (s: MapSource = dressedSampleSource()) => JSON.parse(sourceFileText(s)) as Record<string, any>;

describe('the Map Source’s look', () => {
  it('parses and round-trips through the file: materials on the Brushes, the sky, the props one a line', () => {
    const dressed = dressedSampleSource();
    const text = sourceFileText(dressed);
    expect(parseMapSource(JSON.parse(text))).toEqual(parseMapSource(dressed));
    expect(sourceFileText(parseMapSource(JSON.parse(text)))).toBe(text);
    expect(text).toContain('"material":"brick"');
    expect(text).toMatch(/"look": \{\n {4}"sky": "mystic",\n {4}"props": \[\n {6}\{"id":"tree1"/);
    expect(parseMapSource(dressed).look?.props).toHaveLength(dressed.look!.props!.length);
  });

  it('is optional: a source with none parses as before and writes the very text Stage 4 wrote', () => {
    const plain = sampleSource();
    const text = sourceFileText(plain);
    expect(text).not.toMatch(/material|look/);
    expect(parseMapSource(JSON.parse(text))).toEqual(plain);
    expect(parseMapSource(plain)).not.toHaveProperty('look');
    // A look with nothing in it is no look.
    expect(parseMapSource({ ...plain, look: {} })).not.toHaveProperty('look');
    expect(parseMapSource({ ...plain, look: { props: [] } })).not.toHaveProperty('look');
  });

  it('refuses what it cannot draw, naming where', () => {
    const cases: [(r: Record<string, any>) => void, RegExp][] = [
      [(r) => (r.brushes[1].material = 'marble'), /keep\)\.material must be one of stone/],
      [(r) => (r.brushes[4].material = 'stone'), /pit\)\.material: a Hole has no material/],
      [(r) => (r.brushes[5].material = 'stone'), /lava\)\.material: a Hazard has no material/],
      [(r) => (r.look.sky = 'noon'), /look\.sky must be one of dusk/],
      [(r) => (r.look.props[0].kind = 'statue'), /props\[0\] \(tree1\)\.kind must be one of tree/],
      [(r) => (r.look.props[0].team = 0), /only a banner is in a Team's colour/],
      [(r) => (r.look.props[0].turn = 360), /turn \(360\) must be at least 0 and under 360/],
      [(r) => (r.look.props[0].x = 0.3), /must lie on the 0.5 m grid/],
      [(r) => (r.look.props[0].x = 120), /must lie inside the field/],
      [(r) => (r.look.props[1].id = 'tree1'), /another prop is already "tree1"/],
      [(r) => (r.look.props[0].id = 'tree_1'), /may hold only letters, digits and -/],
      [(r) => (r.look.props = Array.from({ length: MAX_PROPS + 1 }, (_, k) => ({ id: `p${k}`, kind: 'crate', x: 0, z: 0, y: 0, turn: 0 }))), /at most 500 props/],
    ];
    for (const [breakIt, message] of cases) {
      const r = raw();
      breakIt(r);
      expect(() => parseMapSource(r)).toThrow(TuningDataError);
      expect(() => parseMapSource(r)).toThrow(message);
    }
  });
});

describe('the look is render-only', () => {
  it('compiles to the same bytes with and without materials, props and a sky', () => {
    const plain = mapFileText(compileMap(sampleSource(), battle).map);
    expect(mapFileText(compileMap(dressedSampleSource(), battle).map)).toBe(plain);
    // And every Brush in every material, every kind of prop: still the same map.
    for (const m of MAP_MATERIALS) {
      const s = sampleSource();
      const all: MapSource = { ...s, brushes: s.brushes.map((b) => (b.kind === 'hole' || b.kind === 'hazard' ? b : { ...b, material: m })), look: dressedSampleSource().look! };
      expect(mapFileText(compileMap(all, battle).map)).toBe(plain);
    }
  });

  it('leaves the checks and the Tuning Data hash of a Battle on the map as they were', () => {
    const a = checkMap(sampleSource(), tuning);
    const b = checkMap(dressedSampleSource(), tuning);
    expect(b.issues).toEqual(a.issues);
    expect(tuningDataHash(draftTuning(dressedSampleSource(), tuning).tuning)).toBe(tuningDataHash(draftTuning(sampleSource(), tuning).tuning));
  });
});

describe('the palette', () => {
  /** The triplanar Surface each material is textured with in the game (null: drawn flat in its colour). */
  const MEANT: Record<MapMaterial, Surface | null> = {
    stone: 'stone',
    brick: 'stone',
    basalt: 'rock',
    dungeon: 'dungeon',
    cobble: 'cobble',
    plaster: 'plaster',
    tile: 'tile',
    wood: 'wood',
    grass: 'grass',
    dirt: 'dirt',
    sand: 'dirt',
    metal: null,
    glow: null,
  };

  it('names each material so the game’s texturing gives it the Surface meant', () => {
    for (const m of MAP_MATERIALS) expect([m, surfaceOf(MATERIAL_LOOKS[m].name)]).toEqual([m, MEANT[m]]);
    expect(new Set(MAP_MATERIALS.map((m) => MATERIAL_LOOKS[m].name)).size).toBe(MAP_MATERIALS.length);
  });

  it('draws hazards, leaves, cloth, metal and fire flat, and bark, rubble and crates textured', () => {
    for (const look of [...Object.values(HAZARD_LOOKS), PROP_LOOKS.leaf, PROP_LOOKS.banner, PROP_LOOKS.banner0, PROP_LOOKS.banner1, PROP_LOOKS.pole, PROP_LOOKS.fire]) expect([look.name, surfaceOf(look.name)]).toEqual([look.name, null]);
    expect(surfaceOf(PROP_LOOKS.bark.name)).toBe('wood');
    expect(surfaceOf(PROP_LOOKS.crate.name)).toBe('wood');
    expect(surfaceOf(PROP_LOOKS.rubble.name)).toBe('rock');
    // The shipped maps' own materials keep their Surfaces (the Map Editor's `Dungeon` rule matches none of them).
    expect(surfaceOf('Cavern_Floor0')).toBe('dungeon');
    expect(surfaceOf('Fort_Stone')).toBe('stone');
  });

  it('gives each kind of Brush its own material when the source names none', () => {
    const s = sampleSource();
    const of = (id: string) => materialOf(s.brushes.find((b) => b.id === id)!, s);
    expect([of('ground'), of('keep'), of('rampS'), of('bridge'), of('bridgeRailS')]).toEqual(['grass', 'stone', 'stone', 'wood', 'wood']);
    const lava = s.brushes.find((b) => b.id === 'lava')!;
    expect(brushLook(lava, s)).toBe(HAZARD_LOOKS.lava);
    const d = dressedSampleSource();
    expect(materialOf(d.brushes.find((b) => b.id === 'keep')!, d)).toBe('brick');
  });
});

describe('Save', () => {
  it('refuses a map named after one a generator builds: it would write over that map’s files and its model', () => {
    const s = new MapEditorSession({ ...sampleSource(), name: 'fort' });
    expect(() => s.files(battle)).toThrow(/"fort" is a shipped map built in art\//);
    s.setSettings({ name: 'lavakeep' });
    expect(s.files(battle).model).toEqual({ fileName: 'battle_lavakeep.glb', path: 'public/models/arenas/battle_lavakeep.glb' });
  });
});

describe('the session edits the look', () => {
  it('sets a Brush’s material through the panel’s edit; duplicating keeps it; undo takes it back', () => {
    const s = new MapEditorSession(sampleSource());
    const keep = s.source.brushes.find((b) => b.id === 'keep')!;
    s.replaceBrush('keep', { ...keep, material: 'basalt' });
    expect(s.source.brushes.find((b) => b.id === 'keep')!.material).toBe('basalt');
    const copy = s.duplicateBrush('keep');
    expect(copy.material).toBe('basalt');
    s.undo();
    s.undo();
    expect(s.source).toEqual(sampleSource());
    expect(s.dirty).toBe(false);
  });

  it('places, picks, drags, edits and removes props, each one undo step, and sets the sky', () => {
    const s = new MapEditorSession(sampleSource());
    s.level = 4;
    const torch = s.addProp('torch', { x: -10.2, z: 6.1 });
    expect(torch).toEqual({ id: 'torch1', kind: 'torch', x: -10, z: 6, y: 4, turn: 0 });
    expect(s.marker).toEqual({ kind: 'prop', id: 'torch1' });
    expect(s.prop).toEqual(torch);
    expect(s.addProp('torch', { x: 0, z: 0 }).id).toBe('torch2');
    // Picked as a marker, after the Objectives (B stands at 0, 0) and Bases.
    expect(markerAt(s.source, -10, 6, 1)).toEqual({ kind: 'prop', id: 'torch1' });
    expect(markerAt(s.source, 0, 0, 1)).toEqual({ kind: 'objective', id: 'B' });
    // A drag takes the level being edited, as an Objective's does; a click leaves it.
    s.level = 0;
    s.selectMarker({ kind: 'prop', id: 'torch1' });
    s.moveMarker({ kind: 'prop', id: 'torch1' }, 0.1, 0.1);
    expect(s.prop!.y).toBe(4);
    s.moveMarker({ kind: 'prop', id: 'torch1' }, -20, 0);
    expect(s.prop).toMatchObject({ x: -30, z: 6, y: 0 });
    s.replaceProp('torch1', { ...s.prop!, id: 'gate-torch', turn: 90 });
    expect(s.marker).toEqual({ kind: 'prop', id: 'gate-torch' });
    expect(() => s.replaceProp('gate-torch', { ...s.prop!, kind: 'crate', team: 1 })).toThrow(/only a banner/);
    s.setSky('snow');
    expect(s.source.look?.sky).toBe('snow');
    s.removeProp('gate-torch');
    s.removeProp('torch2');
    s.setSky(undefined);
    // Nothing left: no look block at all, so the file is the sample's again.
    expect(s.source).not.toHaveProperty('look');
    expect(sourceFileText(s.source)).toBe(sourceFileText(sampleSource()));
    for (let k = 0; k < 9; k++) s.undo();
    expect(s.canUndo).toBe(false);
    expect(s.source).toEqual(sampleSource());
  });
});
