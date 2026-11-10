/**
 * docs/plans/map-editor.md, Stage 6's Done, the fast part: the Fort ported into a Map Source compiles to the shipped Fort (`fort.json`)'s
 * Objectives, Bases, front, army size, Tickets and levels, its ground, Blocks and Walls, its walk check passes and its mirror check is clean;
 * where it differs (the keep's deck in three Walk Surfaces, not nine; the field's edge Walls taller) is pinned here. And the same source is
 * authored in the Map Editor's session alone, in mirror mode, drawing Team 0's half of the map: its twins are the other half.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { checkMap } from './checks';
import { compileMap, mapFileText } from './compile';
import { fortPortSource } from './fortPort.testdata';
import { blankSource, MapEditorSession, sourceFileText } from './session';
import type { Brush, MapSource, RampBrush, SourceProp } from './source';

const tuning = loadTuningData();
const battle = tuning.battle;
const fort = battle.maps.fort!;
const port = () => compileMap(fortPortSource(), battle).map;
const pointsKey = (w: { points: readonly { x: number; y: number; z: number }[] }) => w.points.map((p) => `${p.x},${p.y},${p.z}`).sort().join(' ');
const wallKey = (w: { a: { x: number; z: number }; b: { x: number; z: number }; bottom: number; top: number }) => `${[`${w.a.x},${w.a.z}`, `${w.b.x},${w.b.z}`].sort().join(' ')}|${w.bottom},${w.top}`;

describe('the Fort ported into a Map Source', () => {
  it('has the shipped Fort’s Objectives, Bases, front, army size, Tickets and levels', () => {
    const map = port();
    expect(map.objectives).toEqual(fort.objectives);
    expect(map.bases).toEqual(fort.bases);
    expect(map.front).toBe(fort.front);
    expect(map.armySize).toEqual(fort.armySize);
    expect(map.ticketsPerSoldier).toBe(fort.ticketsPerSoldier);
    const levels = (m: typeof map) => [...new Set(m.walk.flatMap((w) => w.points.map((p) => p.y)))].sort((a, b) => a - b);
    expect(levels(map)).toEqual(levels(fort));
  });

  it('has its ground and Blocks exactly, its Walls but the field’s edge, and its deck in three Walk Surfaces, not nine', () => {
    const map = port();
    // The Blocks: the same boxes in the same order (Team 0's half, then its half turn reversed); only the ids differ (a Brush id has no `_`).
    expect(map.blocks.map(({ id: _id, ...b }) => b)).toEqual(fort.blocks.map(({ id: _id, ...b }) => b));
    expect(map.blocks.map((b) => b.id).slice(0, 3)).toEqual(['BLOCK_curtain-s-w', 'BLOCK_gate-s-w', 'BLOCK_gate-s-e']);
    // The ground: the generator's 49 rectangles, in its order.
    const ground = map.walk.filter((w) => w.id.startsWith('WALK_ground_'));
    expect(ground.map(pointsKey)).toEqual(fort.walk.slice(0, 49).map(pointsKey));
    // The keep's deck: the two halves and the roof over the tunnel, where the generator cuts each into three along the ramps' sides.
    const deck = map.walk.filter((w) => !w.id.startsWith('WALK_ground_') && w.points.every((p) => p.y === 4));
    expect(deck.map((w) => w.id)).toEqual(['WALK_keep-w_0', 'WALK_keep-e_0', 'WALK_roof_0']);
    expect(fort.walk.filter((w) => w.id.startsWith('WALK_deck_'))).toHaveLength(9);
    const area = (ws: readonly (typeof deck)[number][]) => ws.reduce((a, w) => a + (Math.max(...w.points.map((p) => p.x)) - Math.min(...w.points.map((p) => p.x))) * (Math.max(...w.points.map((p) => p.z)) - Math.min(...w.points.map((p) => p.z))), 0);
    expect(area(deck)).toBe(area(fort.walk.filter((w) => w.id.startsWith('WALK_deck_'))));
    // The ramps: the same sloped quads.
    const ramps = (ws: typeof map.walk) => ws.filter((w) => w.points.some((p) => p.y === 0) && w.points.some((p) => p.y === 4)).map(pointsKey).sort();
    expect(ramps(map.walk)).toEqual(ramps(fort.walk));
    expect(map.walk).toHaveLength(54);
    expect(fort.walk).toHaveLength(60);
    // The Walls: the keep's faces, the tunnel's sides, the parapet and the ramps' rails exactly; the field's edge stands 8 m (4 over the deck), not 4.
    const inner = (ws: typeof map.walls) => ws.filter((w) => !w.id.startsWith('WALL_edge_')).map(wallKey).sort();
    expect(inner(map.walls)).toEqual(inner(fort.walls));
    expect(map.walls.filter((w) => w.id.startsWith('WALL_edge_')).map((w) => [w.bottom, w.top])).toEqual(Array(4).fill([-1, 8]));
    expect(fort.walls.filter((w) => w.id.startsWith('WALL_edge_')).map((w) => [w.bottom, w.top])).toEqual(Array(4).fill([-1, 4]));
  });

  it('passes the walk check and is its own half turn: its checks hold only the note that B stands over the tunnel', () => {
    const c = checkMap(fortPortSource(), tuning);
    expect(c.ok).toBe(true);
    expect(c.issues.map((i) => [i.severity, i.kind, i.objective])).toEqual([['note', 'objective', 'B']]);
    expect(c.centres.hits).toEqual([]);
  });

  it('is saved under the plan’s folder as the port and the map it compiles to', () => {
    expect(readFileSync('docs/plans/map-editor/fortport.source.json', 'utf8')).toBe(sourceFileText(fortPortSource()));
    expect(readFileSync('docs/plans/map-editor/fortport.json', 'utf8')).toBe(mapFileText(port()));
  });
});

/**
 * The Fort authored in the session, in mirror mode, drawing only Team 0's half (every twin made by the editor), as a user would in the
 * browser: mirror mode on, the levels and grid, the Objectives moved (their twins follow), the keep, ramp, parapet and Blocks drawn and
 * set in the panel, the props placed, the card and sky set.
 */
function authorFort(): MapEditorSession {
  const s = new MapEditorSession(blankSource('fortport'));
  const target = fortPortSource();
  s.setSettings({ grid: { step: 0.5, cell: 4 } });
  // Mirror mode links the blank map's ground, Objectives (D and E, A and C, B on the centre) and Bases.
  s.setMirror(true);
  // On one level an Objective names no level: drag D in from 40 m to 32 m and A out to 60 m before adding the deck's level. E and C follow.
  s.moveMarker({ kind: 'objective', id: 'D' }, 0, 8);
  s.moveMarker({ kind: 'objective', id: 'A' }, -10, 0);
  s.addLevel(4);
  const panel = (id: string, edit: (b: Brush) => Brush) => s.replaceBrush(id, edit(s.source.brushes.find((b) => b.id === id)!));
  const named = (id: string, twin: string | null, edit: (b: Brush) => Brush = (b) => b) => {
    const drawn = s.selection!;
    panel(drawn.id, (b) => ({ ...edit(b), id }));
    // The twin, renamed from its own folder.
    if (twin !== null) panel(s.selection!.twin!, (b) => ({ ...b, id: twin }));
  };
  s.level = 0;
  panel('ground', (b) => ({ ...b, material: 'grass' }));
  // The keep's west half (its east half is its twin), the roof over the tunnel (centred: its own twin).
  s.addBrush('platform', { x: -14, z: -14 }, { x: -3, z: 14 });
  named('keep-w', 'keep-e', (b) => ({ ...b, material: 'stone' }));
  s.level = 4;
  s.addBrush('deck', { x: -3, z: -14 }, { x: 3, z: 14 });
  named('roof', null, (b) => ({ ...b, material: 'stone' }));
  // The west ramp, turned in the panel to rise east (its twin rises west).
  s.level = 0;
  s.addBrush('ramp', { x: -23, z: -5.5 }, { x: -14, z: 5.5 });
  named('ramp-w', 'ramp-e', (b) => ({ ...(b as RampBrush), up: 'e', rails: ['n', 's'], material: 'cobble' }));
  // The parapet, a metre over the deck.
  s.level = 4;
  const rails: [string, string, [number, number], [number, number]][] = [
    ['parapet-s', 'parapet-n', [-14, -14], [14, -14]],
    ['parapet-w-s', 'parapet-e-n', [-14, -14], [-14, -5.5]],
    ['parapet-w-n', 'parapet-e-s', [-14, 5.5], [-14, 14]],
  ];
  for (const [id, twin, a, b] of rails) {
    s.addBrush('rail', { x: a[0], z: a[1] }, { x: b[0], z: b[1] });
    named(id, twin, (r) => ({ ...r, material: 'stone' }));
  }
  // Team 0's half of the walls, towers and sheds, each set to its height and material in the panel.
  s.level = 0;
  for (const b of target.brushes.filter((x) => x.kind === 'block')) {
    if (target.brushes.indexOf(b) > target.brushes.findIndex((x) => x.id === b.twin)) continue;
    const { rect, top, material } = b as Extract<Brush, { kind: 'block' }>;
    s.addBrush('block', { x: rect.x0, z: rect.z0 }, { x: rect.x1, z: rect.z1 });
    named(b.id, b.twin!, (x) => ({ ...x, top, material }));
  }
  // The props of Team 0's half, placed with the prop tool and turned or coloured in their folder.
  const props = target.look!.props!;
  for (const p of props) {
    if (props.indexOf(p) > props.findIndex((q) => q.id === p.twin)) continue;
    s.level = p.y;
    const placed = s.addProp(p.kind, p);
    const { twin: _t, ...shape } = p;
    s.replaceProp(placed.id, { ...shape, id: placed.id } as SourceProp);
  }
  s.setSky('dusk');
  s.setLobby(target.lobby!);
  return s;
}

describe('the Fort authored in the Map Editor, in mirror mode', () => {
  it('saves exactly the port’s Map Source and map, drawing only Team 0’s half', () => {
    const s = authorFort();
    const files = s.files(battle);
    expect(files.source.text).toBe(sourceFileText(fortPortSource()));
    expect(files.map.text).toBe(mapFileText(port()));
    expect(files.warnings).toEqual([]);
  });

  it('keeps the twins together through an edit, and undoes it in one step', () => {
    const s = authorFort();
    const before: MapSource = s.source;
    s.moveBrush('ramp-w', 0, 2);
    expect(s.source.brushes.find((b) => b.id === 'ramp-e')).toMatchObject({ rect: { x0: 14, z0: -7.5, x1: 23, z1: 3.5 } });
    expect(checkMap(s.source, tuning).issues.filter((i) => i.kind === 'mirror')).toEqual([]);
    s.undo();
    expect(s.source).toBe(before);
  });
});
