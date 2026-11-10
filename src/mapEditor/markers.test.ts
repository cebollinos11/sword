/**
 * docs/plans/map-editor.md, Stage 3: the Battle's markers and the map's settings, edited through the Map Editor's session. An Objective is
 * placed, dragged (taking the level being edited as its `y` on a map of several levels), renamed, reordered and removed; the Bases and the
 * front are dragged; the settings and the Lobby card are set. Every edit is validated by `parseMapSource`, a drag is one undo step, and
 * the checks (`checkMap`) react to where the markers stand.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { TuningDataError } from '../tuning/validate';
import { checkMap } from './checks';
import { compileMap, mapFileText } from './compile';
import { sampleSource } from './sample.testdata';
import { freshObjectiveId, markerAt, MapEditorSession, sameMarker, sourceFileText } from './session';
import { parseMapSource } from './source';

const tuning = loadTuningData();
const battle = tuning.battle;
const objective = (s: MapEditorSession, id: string) => s.source.objectives.find((o) => o.id === id)!;

describe("the Battle's markers in the Map Editor session", () => {
  it('drags an Objective onto the bridge as one undo step, its y the level being edited', () => {
    const s = new MapEditorSession(sampleSource());
    s.level = 4;
    s.selectMarker({ kind: 'objective', id: 'C' });
    expect(s.selected).toBe(null);
    s.beginDrag();
    // C (x 40, over the bridge's end and the ground under it) to x 28.2: over the lava pit, on the bridge.
    s.moveMarker({ kind: 'objective', id: 'C' }, -6, 0.1);
    s.moveMarker({ kind: 'objective', id: 'C' }, -11.8, 0.2);
    s.endDrag();
    expect(objective(s, 'C')).toEqual({ id: 'C', x: 28, z: 0, weight: 1, owner: -1, spawn: false, y: 4 });
    // It stands on the bridge, as the Battlefield stands it: no check about it fires.
    expect(checkMap(s.source, tuning).issues.filter((i) => i.objective === 'C')).toEqual([]);
    s.undo();
    expect(objective(s, 'C')).toEqual(sampleSource().objectives[3]);
    expect(s.canUndo).toBe(false);
    // A drag that ends where it began (a click to select it) is no step, and leaves its y alone.
    s.beginDrag();
    s.moveMarker({ kind: 'objective', id: 'C' }, 3, 0);
    s.moveMarker({ kind: 'objective', id: 'C' }, 0.1, 0);
    s.endDrag();
    expect(s.canUndo).toBe(false);
    expect(objective(s, 'C')).not.toHaveProperty('y');
    // An Objective set off the grid in the panel is not snapped, nor given a y, by a click on it.
    s.replaceObjective('C', { ...objective(s, 'C'), x: 40.3 });
    s.moveMarker({ kind: 'objective', id: 'C' }, 0.1, -0.2);
    expect(objective(s, 'C')).toEqual({ ...sampleSource().objectives[3]!, x: 40.3 });
    s.moveMarker({ kind: 'base', team: 0 }, 0.2, 0);
    s.moveMarker({ kind: 'front', team: 0 }, 0, 0.2);
    expect(s.source.bases).toEqual(sampleSource().bases);
    expect(s.source.front).toBe(52);
  });

  it('takes the level being edited as y only on a map of several levels', () => {
    const s = new MapEditorSession();
    s.moveMarker({ kind: 'objective', id: 'A' }, 3.3, -0.4);
    expect(objective(s, 'A')).toEqual({ id: 'A', x: -46.5, z: -0.5, weight: 1, owner: -1, spawn: false });
    s.addLevel(4);
    s.level = 0;
    s.moveMarker({ kind: 'objective', id: 'A' }, 0, 0.5);
    expect(objective(s, 'A').y).toBe(0);
  });

  it('warns when the level an Objective was dropped at has no floor under it', () => {
    const s = new MapEditorSession(sampleSource());
    // Edited at 0 and dropped on the keep: the ground under the keep is cut out.
    s.level = 0;
    s.moveMarker({ kind: 'objective', id: 'A' }, 50, 4);
    expect(objective(s, 'A')).toMatchObject({ x: 0, z: 4, y: 0 });
    const issue = checkMap(s.source, tuning).issues.find((i) => i.objective === 'A')!;
    expect(issue).toMatchObject({ severity: 'warning', kind: 'objective', brushes: ['keep'] });
    expect(issue.message).toMatch(/names its floor at y 0, but there is none there/);
    // Without its y it stands on the keep's top.
    const { y: _y, ...noY } = objective(s, 'A');
    s.replaceObjective('A', noY);
    expect(checkMap(s.source, tuning).issues.filter((i) => i.objective === 'A')).toEqual([]);
  });

  it('places a new Objective with the Objective tool, last in the order, up to the most a map holds', () => {
    const s = new MapEditorSession(sampleSource());
    s.level = 4;
    const o = s.addObjective({ x: 30.2, z: 1.1 });
    expect(o).toEqual({ id: 'F', x: 30, z: 1, weight: 1, owner: -1, spawn: false, y: 4 });
    expect(s.source.objectives.map((x) => x.id)).toEqual(['D', 'A', 'B', 'C', 'E', 'F']);
    expect(sameMarker(s.marker, { kind: 'objective', id: 'F' })).toBe(true);
    for (let k = 6; k < 12; k++) s.addObjective({ x: -90 + 5 * k, z: -60 });
    expect(s.source.objectives).toHaveLength(12);
    expect(() => s.addObjective({ x: 0, z: 60 })).toThrow(/at most 12/);
    // Kept strictly inside the field.
    s.removeObjective('F');
    expect(s.addObjective({ x: 140, z: -100 })).toMatchObject({ id: 'F', x: 99.5, z: -99.5 });
  });

  it('removes, reorders and renames Objectives, refusing what the parser refuses', () => {
    const s = new MapEditorSession(sampleSource());
    s.reorderObjective('B', -5);
    expect(s.source.objectives.map((o) => o.id)).toEqual(['B', 'D', 'A', 'C', 'E']);
    s.reorderObjective('B', 1);
    expect(s.source.objectives.map((o) => o.id)).toEqual(['D', 'B', 'A', 'C', 'E']);
    s.selectMarker({ kind: 'objective', id: 'C' });
    s.replaceObjective('C', { ...objective(s, 'C'), id: 'Hill', weight: 2 });
    expect(s.marker).toEqual({ kind: 'objective', id: 'Hill' });
    expect(() => s.replaceObjective('Hill', { ...objective(s, 'Hill'), id: 'A' })).toThrow(/its own id/);
    expect(() => s.replaceObjective('Hill', { ...objective(s, 'Hill'), weight: 0 })).toThrow(TuningDataError);
    s.removeObjective('Hill');
    expect(s.marker).toBe(null);
    for (const id of ['D', 'B', 'A']) s.removeObjective(id);
    expect(() => s.removeObjective('E')).toThrow(/1 to 12 Objectives/);
    expect(s.source.objectives.map((o) => o.id)).toEqual(['E']);
  });

  it('drags the Bases and either front line, kept inside the field', () => {
    const s = new MapEditorSession(sampleSource());
    s.moveMarker({ kind: 'base', team: 1 }, -10.2, 30);
    expect(s.source.bases).toEqual([
      { x: 0, z: -88 },
      { x: -10, z: 99.5 },
    ]);
    // Team 0's line at z = -52 dragged north 12 m brings both lines in to 40; Team 1's dragged north takes them out.
    s.moveMarker({ kind: 'front', team: 0 }, 0, 12);
    expect(s.source.front).toBe(40);
    s.moveMarker({ kind: 'front', team: 1 }, 0, 5.3);
    expect(s.source.front).toBe(45.5);
    s.moveMarker({ kind: 'front', team: 1 }, 0, -80);
    expect(s.source.front).toBe(0.5);
    expect(s.canUndo).toBe(true);
    s.undo();
    s.undo();
    s.undo();
    expect(s.source.front).toBe(52);
  });

  it('picks markers before Brushes: an Objective, a Base, a front line by its grips at the field\'s edges', () => {
    const source = sampleSource();
    expect(markerAt(source, 40.4, -0.3, 1)).toEqual({ kind: 'objective', id: 'C' });
    expect(markerAt(source, 0.5, 88.5, 1)).toEqual({ kind: 'base', team: 1 });
    expect(markerAt(source, -97, -52.2, 1, 0.5)).toEqual({ kind: 'front', team: 0 });
    expect(markerAt(source, 99, 51.9, 1, 0.5)).toEqual({ kind: 'front', team: 1 });
    expect(markerAt(source, 99, 51, 1, 0.5)).toBe(null);
    // Along the rest of the line, the Brushes under it are picked, not the front.
    expect(markerAt(source, -70, -52, 1, 0.5)).toBe(null);
    expect(sameMarker({ kind: 'front', team: 0 }, { kind: 'base', team: 0 })).toBe(false);
    expect(freshObjectiveId(source.objectives)).toBe('F');
  });

  it('sets the settings and the Lobby card, each part taken away when emptied', () => {
    const s = new MapEditorSession(sampleSource());
    s.setSettings({ armySize: { standard: 100, max: 144 } });
    s.setTickets(undefined);
    expect(s.source.ticketsPerSoldier).toBeUndefined();
    s.setTickets(3);
    expect(s.source.ticketsPerSoldier).toBe(3);
    s.setLobby({ label: 'Lava keep', blurb: 'A keep and a bridge over lava' });
    s.setLobby({ where: 'round a keep over a lava pit,', art: 'linear-gradient(180deg, #333, #f60)' });
    expect(s.source.lobby).toEqual({ label: 'Lava keep', blurb: 'A keep and a bridge over lava', where: 'round a keep over a lava pit,', art: 'linear-gradient(180deg, #333, #f60)' });
    expect(parseMapSource(JSON.parse(sourceFileText(s.source)))).toEqual(s.source);
    s.setLobby({ blurb: '  ' });
    expect(s.source.lobby).not.toHaveProperty('blurb');
    s.setLobby({ label: '', where: '', art: '' });
    expect(s.source).not.toHaveProperty('lobby');
    // The same card again is no step.
    const steps = (): number => (s.undo() ? 1 + steps() : 0);
    s.setLobby({ label: '' });
    expect(steps()).toBe(7);
    // A map too big for its front is the compiler's error (the game's), not the parser's.
    s.setSettings({ armySize: { standard: 144, max: 5000 } });
    expect(checkMap(s.source, tuning).issues[0]).toMatchObject({ severity: 'error', kind: 'compile' });
    expect(checkMap(s.source, tuning).issues[0]!.message).toMatch(/armySize\.max \(5000\)/);
  });

  it('compiles the Lobby card into the map file, in one order, which the game reads back', () => {
    const source = { ...sampleSource(), lobby: { art: 'linear-gradient(#000, #fff)', label: 'Keep' } };
    const { map } = compileMap(source, battle);
    expect(map.lobby).toEqual({ label: 'Keep', art: 'linear-gradient(#000, #fff)' });
    const text = mapFileText(map);
    expect(text).toContain('\n  "lobby": {"label":"Keep","art":"linear-gradient(#000, #fff)"},\n');
    // Without one, nothing: Stage 0's sample writes the file it always did.
    expect(mapFileText(compileMap(sampleSource(), battle).map)).not.toContain('lobby');
    expect(() => parseMapSource({ ...sampleSource(), lobby: { label: '' } })).toThrow(/non-empty/);
    expect(() => parseMapSource({ ...sampleSource(), lobby: { label: 3 } })).toThrow(TuningDataError);
    // A name the Lobby's map knob carries (at most MAX_MAP_NAME).
    expect(() => parseMapSource({ ...sampleSource(), name: 'a'.repeat(33) })).toThrow(/at most 32/);
  });
});
