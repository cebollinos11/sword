/**
 * The Map Editor route (`#/mapeditor?dev=1`, docs/plans/map-editor.md, Stage 1), loaded on demand: author a Battle map's Map Source in the
 * browser. The top view (`topView.ts`) draws and edits the Brushes on the grid; the panel (Tweakpane, as the Motion Editor's) holds the
 * Brush palette, the levels, the selected Brush's numbers, the map's name and Objectives, undo and redo, and New, Open and Save. Save
 * writes `<map>.source.json` and the compiled `<map>.json` through `saveJsonFile`, and refuses, with the compiler's error and its
 * Brushes outlined in red, a source the game would refuse.
 *
 * Stage 2: on every edit (a moment after it) the source is compiled and checked (`checkMap`, timed here: the pure modules read no clock), and
 * what the checks find is listed under the view, each line selecting and framing its Brushes; the Checks folder switches the overlays
 * (reachability, edges, clearance, field cell centres) and the 3D view (`view3d.ts`), and shows the cost: Walk Surfaces, Walls, the
 * compile and check time, and the navmesh's build time (measured here once the edits pause, as the Arena Lab times it).
 *
 * Stage 3: the Battle's markers are dragged in the top view (Objectives, Bases, either front line) and placed with the Objective tool (O);
 * the Map folder edits the settings (name, front, army size, Tickets), the Bases, each Objective (id, place, weight, starting Owner,
 * spawn, its level `y`, its place in the Battle's order) and the Lobby card (label, where, blurb, art, with a preview of the card).
 *
 * Stage 4: the Play-test folder runs the draft as it is now (no save, no reload) in the existing Battle routes over the editor (`playtest.ts`):
 * Spectate, Play or Walk. Back returns to the editor with the session, its undo history and both cameras as they were. The Quick check button
 * runs whole AI-v-AI Battles on the draft, fixed seeds, between frames, and lists what they found (`quickCheck.ts`).
 *
 * Stage 5: the look. The Brush folder names the selected Brush's material; the Look folder the map's sky and light and the prop tool's kind
 * (T, then click), and the selected prop's numbers. The map's model is generated from the Brushes (`render/mapModel.ts`): the 3D view shows
 * it, the play-test draws it, and Save exports it as `public/models/arenas/battle_<map>.glb` after the two JSON files, so the game draws the
 * saved map from it with no Blender step.
 *
 * The quick edits (fewer clicks): a toolbar over the view (`toolbar.ts`: the tools, undo, the levels, mirror mode, the view, Play-test), a
 * right-click menu of what lies under the pointer (`contextMenu.ts`, built here by `menuAt`: a Brush's copy, turn, paint order, level, kind,
 * material, rails, doorways and the Brushes under it; an Objective's spawn, Owner and weight; a prop's kind and turn; and on any ground,
 * paste, a cell of any Brush, an Objective or a prop there), and keys for the rest (`?` lists them): 1 to 9 and PageUp/PageDown the level,
 * A every level, Q a quarter turn, Ctrl+C/X/V copy, cut and paste under the pointer, Home the whole field, Space held to pan.
 *
 * `MapEditorSession` holds the source and every operation on it (unit-tested); this file only calls it and the checks.
 */
import type * as THREE from 'three';
import { Pane, type FolderApi } from 'tweakpane';
import { maxArmySize, type TuningData } from '../../tuning';
import { saveGlbFile, saveJsonFile } from '../../editor/save';
import { exportMapModel, mapModel } from '../../render/mapModel';
import { navMesh } from '../../sim';
import { checkMap, EDGE_KINDS, fieldClearance, issueBounds, type ClearanceNode, type MapChecks, type MapIssue } from '../checks';
import { compileDraft, MapCompileError, type DraftMap } from '../compile';
import { draftTuning, type Draft } from '../playtest';
import { formatQuickCheck, QuickBattle, summarise, type BattleReport } from '../quickCheck';
import { battleMapCard } from '../../play/lobbyView';
import { dressedSampleSource, sampleSource } from '../sample.testdata';
import { fortPortSource } from '../fortPort.testdata';
import { blankSource, boundsOf, brushLevels, isSegment, MapEditorSession, rampLongSides, type Marker } from '../session';
import { BATTLE_SKIES, BRUSH_KINDS, DOOR_WIDTH, enclosureTop, MAP_MATERIALS, PROP_KINDS, SIDES, type BattleSky, type Brush, type BrushKind, type GroundPoint, type HazardKind, type MapMaterial, type PropKind, type Side, type SourceLobby, type SourceObjective, type SourceProp } from '../source';
import { materialOf } from '../look';
import { EDGE_COLOURS, EDGE_LABELS, type Overlays } from './overlays';
import { PLAYTEST_MODES, startPlaytest, type PlaytestMode } from './playtest';
import { closeMenu, showMenu, type MenuItem } from './contextMenu';
import { Toolbar } from './toolbar';
import { PANEL_PX, TopView, type Tool } from './topView';
import { View3D } from './view3d';

/** How long (ms) after an edit the source is checked again, and the navmesh and the fields' clearance built (they are slower). */
/** The views the editor can show: the top view, the 3D view, or both side by side. */
type ViewMode = 'top' | '3d' | 'split';
const CHECK_AFTER = 120;
const MEASURE_AFTER = 700;

/** Map Sources bundled from `data/battlemaps/` (dev and build alike), keyed by file name. */
const bundled = import.meta.glob<unknown>('../../../data/battlemaps/*.source.json', { eager: true, import: 'default' });

const TOOL_LABELS: Record<Tool, string> = {
  select: 'select / move (V)',
  floor: 'Floor (F)',
  deck: 'Deck (D)',
  platform: 'Platform (P)',
  ramp: 'Ramp (R)',
  hole: 'Hole (H)',
  hazard: 'Hazard (Z)',
  rail: 'Rail (L)',
  wall: 'Wall (W)',
  block: 'Block (B)',
  enclosure: 'Enclosure (E): a room',
  objective: 'Objective (O): click to place',
  prop: 'Prop (T): click to place',
};
const TOOL_KEYS: Record<string, Tool> = { v: 'select', f: 'floor', d: 'deck', p: 'platform', r: 'ramp', h: 'hole', z: 'hazard', l: 'rail', w: 'wall', b: 'block', e: 'enclosure', o: 'objective', t: 'prop' };

/** The sky choices as the Look folder shows them: each the look of an existing Arena or of the Battlefield. */
const SKY_LABELS: Record<BattleSky, string> = { dusk: 'dusk (the Battlefield)', mystic: 'mystic space (the Kit)', sunset: 'wasteland sunset (the train)', fog: 'sea fog (the ship)', snow: 'snowstorm (the summit)', ember: 'lava glow (the chamber)' };

/** The selected Brush's numbers as the panel edits them: one flat record for every kind, read back by `brushFromProps`. */
interface BrushProps {
  id: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
  top: number;
  lo: number;
  hi: number;
  up: Side;
  railA: boolean;
  railB: boolean;
  hazard: HazardKind;
  height: number;
  bottom: number;
  /** An Enclosure's doorways: whether each side has one, and its width (m). */
  doorN: boolean;
  doorE: boolean;
  doorS: boolean;
  doorW: boolean;
  widthN: number;
  widthE: number;
  widthS: number;
  widthW: number;
  /** The Brush's material, or '' for its kind's own. */
  material: MapMaterial | '';
}

function propsOf(b: Brush, into: BrushProps): BrushProps {
  into.id = b.id;
  if (isSegment(b)) Object.assign(into, { ax: b.a.x, az: b.a.z, bx: b.b.x, bz: b.b.z });
  else Object.assign(into, b.rect);
  if ('y' in b) into.y = b.y;
  if ('top' in b) into.top = b.top;
  if (b.kind === 'ramp') {
    const [sa, sb] = rampLongSides(b.up);
    Object.assign(into, { lo: b.lo, hi: b.hi, up: b.up, railA: b.rails.includes(sa!), railB: b.rails.includes(sb!) });
  }
  if (b.kind === 'hazard') into.hazard = b.hazard;
  if (b.kind === 'rail') into.height = b.height;
  if (b.kind === 'wall') into.bottom = b.bottom;
  if (b.kind === 'enclosure')
    for (const s of SIDES) {
      const k = DOOR_KEYS[s];
      into[k.door] = b.doors[s] !== undefined;
      // A side with no doorway keeps the width it last had (or a new one's), for when it is opened again.
      if (b.doors[s] !== undefined) into[k.width] = b.doors[s];
      else if (!(into[k.width] > 0)) into[k.width] = DOOR_WIDTH;
    }
  into.material = b.material ?? '';
  return into;
}

/** The Brush the panel's numbers make, with its material (none on a Hole or a Hazard). */
function brushFromProps(kind: BrushKind, p: BrushProps): Brush {
  const b = shapeFromProps(kind, p);
  return p.material === '' || b.kind === 'hole' || b.kind === 'hazard' ? b : { ...b, material: p.material };
}

function shapeFromProps(kind: BrushKind, p: BrushProps): Brush {
  const rect = { x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 };
  const a = { x: p.ax, z: p.az };
  const b = { x: p.bx, z: p.bz };
  switch (kind) {
    case 'floor':
    case 'deck':
    case 'hole':
      return { kind, id: p.id, rect, y: p.y };
    case 'hazard':
      return { kind, id: p.id, rect, y: p.y, hazard: p.hazard };
    case 'platform':
    case 'block':
      return { kind, id: p.id, rect, top: p.top };
    case 'ramp': {
      const [sa, sb] = rampLongSides(p.up);
      const rails = SIDES.filter((s) => (s === sa && p.railA) || (s === sb && p.railB));
      return { kind, id: p.id, rect, lo: p.lo, hi: p.hi, up: p.up, rails };
    }
    case 'rail':
      return { kind, id: p.id, a, b, y: p.y, height: p.height };
    case 'wall':
      return { kind, id: p.id, a, b, bottom: p.bottom, top: p.top };
    case 'enclosure':
      return { kind, id: p.id, rect, y: p.y, doors: Object.fromEntries(SIDES.filter((s) => p[DOOR_KEYS[s].door]).map((s) => [s, p[DOOR_KEYS[s].width]])) };
  }
}

/** The panel's keys for each side's doorway (an Enclosure's). */
const DOOR_KEYS: Readonly<Record<Side, { door: 'doorN' | 'doorE' | 'doorS' | 'doorW'; width: 'widthN' | 'widthE' | 'widthS' | 'widthW' }>> = {
  n: { door: 'doorN', width: 'widthN' },
  e: { door: 'doorE', width: 'widthE' },
  s: { door: 'doorS', width: 'widthS' },
  w: { door: 'doorW', width: 'widthW' },
};

const SIDE_LABELS: Record<Side, string> = { n: 'north (+z)', e: 'east (+x)', s: 'south (-z)', w: 'west (-x)' };

export function startMapEditor(container: HTMLElement, tuning: TuningData): void {
  const session = new MapEditorSession();
  // Dev server only: the session in the console (`mapEditor.source`), to look at or script a map by hand.
  if (import.meta.env.DEV) (window as unknown as { mapEditor: MapEditorSession }).mapEditor = session;
  container.style.position = 'relative';
  const ui = {
    tool: 'select' as Tool,
    level: session.level,
    showAll: session.showAll,
    newLevel: 4,
    name: session.source.name,
    example: '',
    status: 'Pick a tool (the toolbar, or its key) and drag on the grid to draw a Brush. Select: click to pick (again to pick the one under it), drag to move, Alt-drag to copy, drag a yellow handle to resize. Right-click for what you can do there; right-drag, Space-drag or drag empty ground to pan, wheel to zoom. ? lists the keys.',
    cursor: '',
    view: 'top' as ViewMode,
    cost: '',
    mode: 'spectate' as PlaytestMode,
    speed: 1,
    seed: 1,
    army: 0,
    quickBattles: 4,
    look3d: true,
    mirror: false,
  };
  const overlays: Overlays = { reach: true, edges: false, edgeKinds: { walk: false, drop: true, wall: true, ledge: true }, clearance: false, centres: true };
  /** True while the panel is being brought up to the session: Tweakpane reports the values it refreshes as changes, which are not edits. */
  let syncing = false;
  /** The toolbar, once made (it reads the panel's state, so it follows every refresh). */
  let toolbar: Toolbar | null = null;
  const refreshPane = () => {
    syncing = true;
    try {
      pane.refresh();
    } finally {
      syncing = false;
    }
    toolbar?.update();
  };
  const say = (text: string) => {
    ui.status = text;
    refreshPane();
  };

  const view = new TopView(
    container,
    session,
    () => ui.tool,
    (error) => {
      if (error) say(error);
      sync();
    },
    (at) => {
      ui.cursor = at ? `x ${at.x}, z ${at.z}` : '';
      cursorBinding.refresh();
    },
  );

  view.objectiveRadii = tuning.battle.objectives;
  const view3d = new View3D(container);
  /**
   * Lay the views out for `mode`: one of them over the whole container, or (split) the top view on the left half and the 3D view on the
   * right half, left of the panel. Editing stays in the top view; the 3D view follows the checks as they run.
   */
  const layoutViews = (mode: ViewMode) => {
    const split = mode === 'split';
    // A canvas sizes by its width, not its left and right edges: each is given one.
    view3d.canvas.style.left = split ? '50%' : '0';
    view3d.canvas.style.width = split ? `calc(50% - ${PANEL_PX}px)` : '100%';
    view.canvas.style.width = split ? '50%' : '100%';
    view.canvas.style.visibility = mode === '3d' ? 'hidden' : 'visible';
    view.shown = mode !== '3d';
    view.panelPx = split ? 0 : PANEL_PX;
    list.style.width = split ? 'min(620px,calc(50% - 16px))' : 'min(620px,calc(100% - 370px))';
    view3d.show(mode !== 'top');
    view.frame(session.source);
  };

  // --- The live checks ----------------------------------------------------
  /** The checks of the source as it last was, how long they took, and the fields' clearance and navmesh time for them once measured. */
  let checks: MapChecks | null = null;
  let checkMs = 0;
  let clearance: readonly ClearanceNode[] | null = null;
  let fieldMs: number | null = null;
  let navMs: number | null = null;
  /** The checks the navmesh was last timed for. */
  let navFor: MapChecks | null = null;
  let checkTimer = 0;
  let measureTimer = 0;
  const list = document.createElement('div');
  list.style.cssText =
    'position:absolute;left:8px;bottom:8px;max-height:32vh;width:min(620px,calc(100% - 370px));overflow-y:auto;background:rgba(18,20,26,0.88);color:#ddd;font:12px/1.35 system-ui,sans-serif;border-radius:4px;z-index:5';
  container.appendChild(list);
  const SEVERITY = { error: ['✗', '#ff6b6b'], warning: ['!', '#ffc04d'], note: ['·', '#9ab'] } as const;
  const showIssues = () => {
    list.replaceChildren();
    const c = checks;
    if (!c) return;
    const head = document.createElement('div');
    head.style.cssText = 'padding:4px 8px;font-weight:600;border-bottom:1px solid #333;position:sticky;top:0;background:rgb(24,26,32)';
    const count = (v: MapIssue['severity']) => c.issues.filter((i) => i.severity === v).length;
    head.textContent = c.issues.length === 0 ? '✓ No checks fire' : `${count('error')} errors · ${count('warning')} warnings · ${count('note')} notes${c.ok ? '' : ' (Save refuses the map)'}`;
    head.style.color = c.ok ? (count('warning') ? '#ffc04d' : '#7fdc8f') : '#ff6b6b';
    list.appendChild(head);
    c.issues.forEach((issue) => {
      const row = document.createElement('div');
      const [mark, colour] = SEVERITY[issue.severity];
      row.style.cssText = 'padding:3px 8px;cursor:pointer;display:flex;gap:6px';
      row.title = 'Select and frame it';
      row.onmouseenter = () => (row.style.background = 'rgba(255,255,255,0.08)');
      row.onmouseleave = () => (row.style.background = '');
      const m = document.createElement('span');
      m.textContent = mark;
      m.style.cssText = `color:${colour};font-weight:700;width:10px;flex:none`;
      const t = document.createElement('span');
      t.textContent = issue.message;
      row.append(m, t);
      row.onclick = () => focusIssue(issue);
      list.appendChild(row);
    });
  };
  /** Select an issue's first Brush (at its level), outline all of them, and frame them in both views. */
  const focusIssue = (issue: MapIssue) => {
    view.flagged = issue.brushes;
    const b = session.source.brushes.find((x) => x.id === issue.brushes[0]);
    if (b) {
      session.select(b.id);
      const levels = brushLevels(b, session.source.levels);
      if (!levels.includes(session.level)) session.level = levels[0]!;
    }
    // An Objective's or a Base's check selects the marker (its floor's Brushes stay outlined).
    if (issue.objective !== undefined) session.selectMarker({ kind: 'objective', id: issue.objective });
    else if (issue.base !== undefined) session.selectMarker({ kind: 'base', team: issue.base });
    const rect = issueBounds(session.source, issue);
    if (rect) {
      view.frameRect(rect);
      view3d.focus(rect, session.level, session.source.name);
    }
    rebuild();
  };
  const costLine = () => {
    const d = checks?.draft;
    const counts = d ? `${d.map.walk.length} Walk Surfaces · ${d.map.walls.length} Walls · ${d.map.blocks.length} Blocks` : 'does not compile';
    const nav = navMs === null ? 'navmesh: Measure' : `navmesh ${navMs.toFixed(0)} ms${navFor === checks ? '' : ' (before the last edit)'}`;
    const fields = fieldMs === null ? '' : ` · fields ${fieldMs.toFixed(0)} ms`;
    ui.cost = `${counts}\ncompile + checks ${checkMs.toFixed(0)} ms · ${checks?.ok ? nav : 'navmesh: not built'}${fields}`;
  };
  /** The fields' clearance for the checks as they are, built (and timed) when the overlay wants it. */
  const buildClearance = () => {
    if (!overlays.clearance || !checks || clearance) return;
    const t0 = performance.now();
    clearance = fieldClearance(checks, tuning.battle)?.nodes ?? null;
    fieldMs = clearance ? performance.now() - t0 : null;
  };
  /** The model the 3D view shows for the checks' source: built once per source (an overlay toggled draws the same one again). */
  let shownModel: { readonly of: MapChecks; readonly model: THREE.Object3D | null } | null = null;
  const lookModel = (c: MapChecks): THREE.Object3D | null => {
    if (shownModel?.of !== c) shownModel = { of: c, model: c.draft ? mapModel(c.source, c.draft) : null };
    return shownModel.model;
  };
  const drawChecks = () => {
    view.checks = checks;
    view.overlays = overlays;
    view.clearance = overlays.clearance ? clearance : null;
    view.levels = tuning.battle.levels;
    view.redraw();
    if (ui.view !== 'top' && checks) view3d.update(checks, overlays, overlays.clearance ? clearance : null, tuning.battle.levels, ui.look3d ? lookModel(checks) : null);
  };
  const runChecks = () => {
    window.clearTimeout(checkTimer);
    checkTimer = 0;
    const t0 = performance.now();
    checks = checkMap(session.source, tuning, { edges: overlays.edges });
    checkMs = performance.now() - t0;
    clearance = null;
    fieldMs = null;
    costLine();
    showIssues();
    drawChecks();
    refreshPane();
    // The fields' clearance (when its overlay is on) waits for the edits to pause: on a big map it is the slowest thing here.
    window.clearTimeout(measureTimer);
    const measured = checks;
    if (overlays.clearance)
      measureTimer = window.setTimeout(() => {
        if (checks !== measured) return;
        buildClearance();
        costLine();
        drawChecks();
        refreshPane();
      }, MEASURE_AFTER);
  };
  /** Build the draft's navmesh (the Fighters', as a Battle on it builds it) and time it, as the Arena Lab does. */
  const measureNavmesh = () => {
    const d = checks?.ok ? checks.draft : null;
    if (!d) return say('The navmesh is built for a map Save accepts: fix the errors first');
    const t0 = performance.now();
    navMesh({ ...d.arena }, tuning);
    navMs = performance.now() - t0;
    navFor = checks;
    costLine();
    refreshPane();
  };
  /** Check the source again a moment after it changes (each edit restarts the wait, so a drag checks once it rests). */
  const scheduleChecks = () => {
    if (checks?.source === session.source) return;
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(runChecks, CHECK_AFTER);
  };

  const pane = new Pane({ title: 'Map Editor' });
  const paneBox = pane.element.parentElement!;
  paneBox.style.width = '320px';
  paneBox.style.maxHeight = 'calc(100vh - 16px)';
  paneBox.style.overflowY = 'auto';
  const style = document.createElement('style');
  style.textContent = '.tp-mllv_i { white-space: pre-wrap !important; }';
  document.head.appendChild(style);

  // --- File ---------------------------------------------------------------
  const discardOk = () => !session.dirty || confirm('Discard the unsaved edits to this map?');
  const opened = (what: string) => {
    view.flagged = [];
    view.frame(session.source);
    view3d.reframe();
    rebuild();
    say(`Opened ${what}`);
  };
  const openRaw = (raw: unknown, what: string) => {
    try {
      session.open(raw);
      opened(what);
    } catch (e) {
      say(`Not opened: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const examples: Record<string, () => unknown> = { "Stage 0's sample": sampleSource, "Stage 5's dressed sample": dressedSampleSource, "Stage 6's ported Fort (mirrored)": fortPortSource };
  for (const [path, raw] of Object.entries(bundled)) examples[path.slice(path.lastIndexOf('/') + 1)] = () => raw;
  ui.example = Object.keys(examples)[0]!;
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    void file.text().then((text) => {
      try {
        openRaw(JSON.parse(text), file.name);
      } catch (e) {
        say(`Not opened: ${file.name} is not JSON (${e instanceof Error ? e.message : String(e)})`);
      }
    });
  });

  /** The compiled draft of `source`: the live checks' when they are of it, else compiled now. */
  const draftOf = (source: typeof session.source): DraftMap => (checks?.source === source && checks.draft ? checks.draft : compileDraft(source, tuning.battle));
  /** The map's model as Save writes it (a `.glb`), for `source` as it is now. */
  const modelFile = (source: typeof session.source): Promise<ArrayBuffer> => exportMapModel(mapModel(source, draftOf(source)));

  const save = async () => {
    let files: ReturnType<MapEditorSession['files']>;
    let model: THREE.Object3D;
    try {
      files = session.files(tuning.battle);
      model = mapModel(session.source, draftOf(session.source));
    } catch (e) {
      view.flagged = e instanceof MapCompileError ? e.brushes : [];
      if (view.flagged[0]) session.select(view.flagged[0]);
      rebuild();
      say(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    view.flagged = [];
    view.redraw();
    const done: string[] = [];
    // The two JSON files, then the model (Stage 5): the three a map ships as.
    const writes = [
      { ...files.source, write: () => saveJsonFile(files.source.fileName, files.source.text) },
      { ...files.map, write: () => saveJsonFile(files.map.fileName, files.map.text) },
      { ...files.model, write: async () => saveGlbFile(files.model.fileName, await exportMapModel(model)) },
    ];
    for (const f of writes) {
      try {
        const result = await f.write();
        if (result === 'cancelled') {
          say([...done, `Save of ${f.fileName} cancelled`].join('\n'));
          return;
        }
        done.push(result === 'written' ? `Saved ${f.path}` : `Downloaded ${f.fileName}: move it to ${f.path}`);
      } catch (e) {
        // The browser lets a click open one save dialog: the second file needs a second click (the first is remembered and not asked again).
        const again = e instanceof DOMException && e.name === 'SecurityError';
        say([...done, again ? `Click Save again to write ${f.fileName}` : `Save of ${f.fileName} failed: ${e instanceof Error ? e.message : String(e)}`].join('\n'));
        return;
      }
    }
    session.markSaved();
    const warned = files.warnings.map((w) => `warning: ${w.message}`);
    say([...done, ...warned].join('\n'));
  };

  const file = pane.addFolder({ title: 'File' });
  file.addButton({ title: 'New map' }).on('click', () => {
    if (!discardOk()) return;
    session.open(blankSource());
    opened('a new map (the whole field at 0)');
  });
  file.addBinding(ui, 'example', { label: 'example', options: Object.fromEntries(Object.keys(examples).map((k) => [k, k])) });
  file.addButton({ title: 'Open example' }).on('click', () => discardOk() && openRaw(examples[ui.example]!(), ui.example));
  file.addButton({ title: 'Open .source.json…' }).on('click', () => discardOk() && picker.click());
  file.addButton({ title: 'Save (source, compiled map, model)' }).on('click', () => void save());

  // --- Play-test and the Quick check ---------------------------------------
  /** Ends the play-test running over the editor, if one is. */
  let playtesting: (() => void) | null = null;
  /** The draft of the current (or last) edit, for the play-test and the Quick check: refused with the compiler's error, shown in the status. */
  const draftNow = (): Draft | null => {
    try {
      return draftTuning(session.source, tuning, ui.army > 0 ? { armySize: ui.army } : {});
    } catch (e) {
      say(`Not play-tested: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const playtest = () => {
    if (playtesting) return;
    const t0 = performance.now();
    const draft = draftNow();
    if (!draft) return;
    const draftMs = performance.now() - t0;
    paneBox.style.display = 'none';
    list.style.display = 'none';
    toolbar!.element.style.display = 'none';
    closeMenu();
    const model = modelFile(session.source);
    playtesting = startPlaytest(draft, { mode: ui.mode, seed: ui.seed, speed: ui.speed, onBack, model }, (ms) => {
      // Dev only: the last play-test's timings, for the cycle measure (the draft compiled and put in Tuning Data, then until the Battle was drawing).
      if (import.meta.env.DEV) (window as unknown as { mapEditorPlaytest: unknown }).mapEditorPlaytest = { draftMs, startMs: ms, mode: ui.mode };
    });
    function onBack(): void {
      playtesting = null;
      paneBox.style.display = '';
      list.style.display = '';
      toolbar!.element.style.display = '';
      view.redraw();
      say(`Back from the play-test (${PLAYTEST_MODES[ui.mode]}; the draft took ${draftMs.toFixed(0)} ms to build).`);
    }
  };
  const quickBox = document.createElement('div');
  quickBox.style.cssText =
    'position:absolute;left:8px;top:8px;max-width:min(780px,calc(100% - 360px));max-height:64vh;overflow:auto;background:rgba(18,20,26,0.94);color:#ddd;font:11px/1.45 ui-monospace,monospace;border-radius:4px;z-index:6;display:none';
  const quickText = document.createElement('pre');
  quickText.style.cssText = 'margin:0;padding:8px 10px;white-space:pre-wrap';
  const quickClose = document.createElement('button');
  quickClose.textContent = '×';
  quickClose.style.cssText = 'position:sticky;float:right;top:2px;right:2px;margin:2px;cursor:pointer';
  quickClose.onclick = () => {
    quickBox.style.display = 'none';
    quickRun++;
  };
  quickBox.append(quickClose, quickText);
  container.appendChild(quickBox);
  /** Bumped to stop a Quick check running (a new one, or the box closed). */
  let quickRun = 0;
  const quickCheckNow = async () => {
    const draft = draftNow();
    if (!draft) return;
    const mine = ++quickRun;
    const started = performance.now();
    const seeds = Array.from({ length: Math.max(1, Math.floor(ui.quickBattles)) }, (_, k) => k + 1);
    const battles: BattleReport[] = [];
    quickBox.style.display = 'block';
    quickBox.style.top = `${(toolbar?.element.offsetHeight ?? 0) + 16}px`;
    for (const seed of seeds) {
      const run = new QuickBattle(draft.tuning, draft.map, seed);
      // A few hundred Ticks at a time, so the page stays alive.
      while (!run.step(300)) {
        if (mine !== quickRun) return;
        quickText.textContent = `Quick check · ${draft.map}: Battle ${seed} of ${seeds.length}, ${run.seconds.toFixed(0)} s of Battle time in…`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (mine !== quickRun) return;
      battles.push(run.report());
    }
    const report = summarise(draft.map, battles);
    quickText.textContent = `${formatQuickCheck(report)}\n\n(${((performance.now() - started) / 1000).toFixed(1)} s to run; the same seeds give the same numbers)`;
    // Dev only: the last report, for scripting.
    if (import.meta.env.DEV) (window as unknown as { mapEditorQuick: unknown }).mapEditorQuick = report;
  };
  const playFolder = pane.addFolder({ title: 'Play-test', index: 1 });
  playFolder.addBinding(ui, 'mode', { label: 'mode', options: Object.fromEntries(Object.entries(PLAYTEST_MODES).map(([k, v]) => [v, k])) });
  playFolder.addBinding(ui, 'speed', { label: 'speed (Spectate)', options: { '1×': 1, '2×': 2, '4×': 4 } });
  playFolder.addBinding(ui, 'seed', { label: 'seed', min: 0, step: 1 });
  playFolder.addBinding(ui, 'army', { label: 'army (0: standard)', min: 0, step: 1 });
  playFolder.addButton({ title: 'Play-test the draft (Ctrl+Enter)' }).on('click', playtest);
  playFolder.addBinding(ui, 'quickBattles', { label: 'Quick check: Battles', min: 1, max: 12, step: 1 });
  playFolder.addButton({ title: 'Quick check (headless Battles)' }).on('click', () => void quickCheckNow());

  // --- Tools and edits ----------------------------------------------------
  pane.addBinding(ui, 'tool', { label: 'tool', options: Object.fromEntries((['select', ...BRUSH_KINDS] as Tool[]).map((t) => [TOOL_LABELS[t], t])) }).on('change', () => toolbar?.update());
  const edits = pane.addFolder({ title: 'Edit' });
  const undoButton = edits.addButton({ title: 'Undo (Ctrl+Z)' });
  const redoButton = edits.addButton({ title: 'Redo (Ctrl+Shift+Z)' });
  undoButton.on('click', () => {
    session.undo();
    rebuild();
  });
  redoButton.on('click', () => {
    session.redo();
    rebuild();
  });
  const withSelection = (f: (id: string) => void) => () => {
    const id = session.selected;
    if (id === null) return say('Select a Brush first');
    try {
      f(id);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
    sync();
    view.redraw();
  };
  const duplicate = withSelection((id) => session.duplicateBrush(id));
  const remove = withSelection((id) => session.deleteBrush(id));
  edits.addButton({ title: 'Duplicate (Ctrl+D)' }).on('click', duplicate);
  edits.addButton({ title: 'Delete (Del)' }).on('click', remove);
  edits.addButton({ title: 'Paint earlier ([)' }).on('click', withSelection((id) => session.reorder(id, -1)));
  edits.addButton({ title: 'Paint later (])' }).on('click', withSelection((id) => session.reorder(id, 1)));
  // Stage 6: half-turn mirror mode, and turning a twin pair back into two free parts.
  const setMirror = (on: boolean) =>
    settingsEdit(() => {
      session.setMirror(on);
      say(on ? 'Mirror mode: what you place gets its half-turn twin (dashed cyan), edited with it; parts already each other’s half turn are linked, and Team 1’s Base is put at the half turn of Team 0’s (Ctrl+Z to undo).' : 'Mirror mode off: new parts are free; twins stay linked until unlinked.');
    });
  edits.addBinding(ui, 'mirror', { label: 'mirror mode (M)' }).on('change', (e) => !syncing && setMirror(e.value));
  const unlink = () => {
    const m = session.marker;
    const target = session.selected ?? (m?.kind === 'objective' || m?.kind === 'prop' ? m : null);
    if (target === null) return say('Select a Brush, an Objective or a prop with a twin first');
    settingsEdit(() => session.unlink(target));
  };
  edits.addButton({ title: 'Unlink its twin' }).on('click', unlink);

  // --- Levels -------------------------------------------------------------
  let levelsFolder: FolderApi | undefined;
  const buildLevels = () => {
    if (levelsFolder) pane.remove(levelsFolder);
    const f = pane.addFolder({ title: 'Levels', index: 4 });
    levelsFolder = f;
    ui.level = session.level;
    ui.showAll = session.showAll;
    f.addBinding(ui, 'level', { label: 'editing', options: Object.fromEntries(session.source.levels.map((y) => [`${y} m`, y])) }).on('change', (e) => {
      if (syncing) return;
      setLevel(e.value);
    });
    f.addBinding(ui, 'showAll', { label: 'show all levels' }).on('change', (e) => {
      if (syncing) return;
      setShowAll(e.value);
    });
    f.addBinding(ui, 'newLevel', { label: 'height (m)', step: 0.5 });
    f.addButton({ title: 'Add level' }).on('click', () => {
      try {
        session.addLevel(ui.newLevel);
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
      }
      rebuild();
    });
    f.addButton({ title: 'Remove the level being edited' }).on('click', () => {
      try {
        session.removeLevel(session.level);
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
      }
      rebuild();
    });
  };

  // --- The selected Brush -------------------------------------------------
  let brushFolder: FolderApi | undefined;
  /** What the Brush folder was built for: rebuilt when this changes, otherwise only refreshed (so a field being dragged keeps its grip). */
  let brushKey = '';
  const props = {} as BrushProps;
  const commitProps = () => {
    const sel = session.selection;
    if (!sel || syncing) return;
    try {
      session.replaceBrush(sel.id, brushFromProps(sel.kind, props));
      view.flagged = [];
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
    sync();
    view.redraw();
  };
  const buildBrush = () => {
    const sel = session.selection;
    const levels = session.source.levels;
    const key = sel ? `${sel.id}|${sel.kind}|${sel.kind === 'ramp' ? sel.up : sel.kind === 'enclosure' ? sel.y : ''}|${levels.join(',')}|${session.source.grid.step}|${sel.twin ?? ''}` : '';
    if (key === brushKey && brushFolder) {
      if (sel) propsOf(sel, props);
      syncing = true;
      brushFolder.refresh();
      syncing = false;
      return;
    }
    brushKey = key;
    if (brushFolder) pane.remove(brushFolder);
    brushFolder = undefined;
    if (!sel) return;
    propsOf(sel, props);
    const twin = sel.twin === undefined ? '' : sel.twin === sel.id ? ' (its own twin)' : ` (twin ${sel.twin})`;
    const f = pane.addFolder({ title: `Brush: ${sel.kind} ${sel.id}${twin}`, index: 4 });
    brushFolder = f;
    const step = session.source.grid.step;
    const half = session.source.size / 2;
    const level = { options: Object.fromEntries(levels.map((y) => [`${y} m`, y])) };
    const coord = { step, min: -half, max: half };
    f.addBinding(props, 'id');
    if (isSegment(sel)) {
      f.addBinding(props, 'ax', { label: 'a x', ...coord });
      f.addBinding(props, 'az', { label: 'a z', ...coord });
      f.addBinding(props, 'bx', { label: 'b x', ...coord });
      f.addBinding(props, 'bz', { label: 'b z', ...coord });
    } else {
      f.addBinding(props, 'x0', { label: 'west x0', ...coord });
      f.addBinding(props, 'x1', { label: 'east x1', ...coord });
      f.addBinding(props, 'z0', { label: 'south z0', ...coord });
      f.addBinding(props, 'z1', { label: 'north z1', ...coord });
    }
    switch (sel.kind) {
      case 'floor':
      case 'deck':
      case 'hole':
        f.addBinding(props, 'y', { label: 'level', ...level });
        break;
      case 'hazard':
        f.addBinding(props, 'y', { label: 'level', ...level });
        f.addBinding(props, 'hazard', { options: { lava: 'lava', water: 'water', abyss: 'abyss' } });
        break;
      case 'platform':
        f.addBinding(props, 'top', { label: 'top level', ...level });
        break;
      case 'block':
        f.addBinding(props, 'top', { label: 'top (m)', step: 0.5, min: 0.5 });
        break;
      case 'ramp': {
        f.addBinding(props, 'lo', { label: 'foot level', ...level });
        f.addBinding(props, 'hi', { label: 'top level', ...level });
        f.addBinding(props, 'up', { label: 'rises toward', options: Object.fromEntries(SIDES.map((s) => [SIDE_LABELS[s], s])) });
        const [sa, sb] = rampLongSides(sel.up);
        f.addBinding(props, 'railA', { label: `rail ${sa}` });
        f.addBinding(props, 'railB', { label: `rail ${sb}` });
        break;
      }
      case 'rail':
        f.addBinding(props, 'y', { label: 'stands on', ...level });
        f.addBinding(props, 'height', { label: 'height (m)', step: 0.25, min: 0.25 });
        break;
      case 'wall':
        f.addBinding(props, 'bottom', { label: 'bottom (m)', step: 0.5 });
        f.addBinding(props, 'top', { label: 'top (m)', step: 0.5 });
        break;
      case 'enclosure': {
        const top = enclosureTop(sel, levels);
        f.addBinding(props, 'y', { label: `floor level (ceiling ${top === null ? 'none' : `${top} m`})`, ...level });
        for (const s of SIDES) {
          f.addBinding(props, DOOR_KEYS[s].door, { label: `doorway ${SIDE_LABELS[s]}` });
          f.addBinding(props, DOOR_KEYS[s].width, { label: `  width (m)`, step, min: step });
        }
        break;
      }
    }
    // Its material (render-only): a Hole and a Hazard have none of their own.
    if (sel.kind !== 'hole' && sel.kind !== 'hazard') {
      const { material: _m, ...plain } = sel;
      f.addBinding(props, 'material', { label: 'material', options: { [`its kind's (${materialOf(plain as Brush, session.source)})`]: '', ...Object.fromEntries(MAP_MATERIALS.map((m) => [m, m])) } });
    }
    f.on('change', (e) => {
      if (e.last) commitProps();
    });
  };

  // --- Map settings, markers and the Lobby card (Stage 3) ------------------
  /** The settings as the panel edits them, brought up to the source by `syncMap`. */
  const settings = {
    name: '',
    size: 0,
    front: 0,
    standard: 0,
    max: 0,
    fits: '',
    ownTickets: false,
    tickets: 0,
    base0x: 0,
    base0z: 0,
    base1x: 0,
    base1z: 0,
    cell: 5,
    label: '',
    where: '',
    blurb: '',
    art: '',
  };
  /** Each Objective's numbers as the panel edits them: `named` whether it names its level, `y` that level. */
  type ObjectiveProps = Omit<SourceObjective, 'y'> & { named: boolean; y: number };
  let objectiveProps: ObjectiveProps[] = [];
  const objectiveOf = (p: ObjectiveProps): SourceObjective => {
    const o = { id: p.id, x: p.x, z: p.z, weight: p.weight, owner: p.owner, spawn: p.spawn };
    return p.named ? { ...o, y: p.y } : o;
  };
  let mapFolder: FolderApi | undefined;
  /** What the Map folder was built for (the Objectives, the levels, the selected Objective): rebuilt when it changes, else refreshed. */
  let mapKey = '';
  let mapExpanded = false;
  let previewKey = '';
  const preview = document.createElement('div');
  preview.style.cssText = 'margin:4px 8px 8px;height:64px;border-radius:6px;display:flex;flex-direction:column;justify-content:flex-end;padding:6px 8px;box-sizing:border-box;color:#fff;font:12px/1.3 system-ui,sans-serif;text-shadow:0 1px 2px #000';
  /** Run a settings edit from the panel: its refusal is shown and the panel set back to the source. */
  const settingsEdit = (f: () => void) => {
    if (syncing) return;
    try {
      f();
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
    }
    sync();
    view.redraw();
  };
  const syncMap = () => {
    const s = session.source;
    const lobby: SourceLobby = s.lobby ?? {};
    Object.assign(settings, {
      name: s.name,
      size: s.size,
      front: s.front,
      standard: s.armySize.standard,
      max: s.armySize.max,
      fits: `${maxArmySize({ ...tuning.battle, deploy: { ...tuning.battle.deploy, front: s.front } })} a side from this front`,
      ownTickets: s.ticketsPerSoldier !== undefined,
      tickets: s.ticketsPerSoldier ?? tuning.battle.tickets.perSoldier,
      base0x: s.bases[0].x,
      base0z: s.bases[0].z,
      base1x: s.bases[1].x,
      base1z: s.bases[1].z,
      cell: s.grid.cell,
      label: lobby.label ?? '',
      where: lobby.where ?? '',
      blurb: lobby.blurb ?? '',
      art: lobby.art ?? '',
    });
    objectiveProps = s.objectives.map((o) => ({ ...o, named: o.y !== undefined, y: o.y ?? session.level }));
    // The card as the Lobby shows it (`battleMapCard`), drawn again only when it changes.
    const card = battleMapCard(s.name, s.lobby);
    const cardKey = JSON.stringify(card);
    if (cardKey !== previewKey) {
      previewKey = cardKey;
      preview.style.background = card.art;
      preview.replaceChildren(Object.assign(document.createElement('b'), { textContent: card.label }), Object.assign(document.createElement('span'), { textContent: card.blurb }));
    }
    const picked = session.marker?.kind === 'objective' ? session.marker.id : '';
    const key = `${s.objectives.map((o) => o.id).join(',')}|${s.levels.join(',')}|${picked}`;
    if (key !== mapKey || !mapFolder) return buildMap(key);
    // Each Objective's folder binds its own record: brought up in place (`sync` then refreshes the whole panel).
    objectiveBound.forEach((bound, k) => Object.assign(bound, objectiveProps[k]));
  };
  /** The records the Objectives' folders are bound to (kept, so a refresh shows new values). */
  let objectiveBound: ObjectiveProps[] = [];
  const buildMap = (key: string) => {
    if (mapFolder) {
      mapExpanded = mapFolder.expanded;
      pane.remove(mapFolder);
    }
    mapKey = key;
    const picked = session.marker?.kind === 'objective' ? session.marker.id : null;
    if (picked !== null) mapExpanded = true;
    const f = pane.addFolder({ title: 'Map', expanded: mapExpanded });
    mapFolder = f;
    const levels = { options: Object.fromEntries(session.source.levels.map((y) => [`${y} m`, y])) };
    syncing = true;
    try {
      f.addBinding(settings, 'name', { label: 'name' }).on('change', (e) => settingsEdit(() => session.setSettings({ name: e.value })));
      f.addBinding(settings, 'size', { label: 'size (m)', readonly: true, format: (v: number) => `${v} (the Battle's field)` });
      // The coarse grid: drawn, a click's Brush and a duplicate's offset. The destination fields' cell keeps Walls off its dots (Stage 6).
      const cells = { [`${tuning.battle.crowd.flowCell} m (the destination fields' cell)`]: tuning.battle.crowd.flowCell, ...(tuning.battle.crowd.flowCell === 5 ? {} : { '5 m': 5 }) };
      f.addBinding(settings, 'cell', { label: 'coarse grid', options: cells }).on('change', (e) => settingsEdit(() => session.setSettings({ grid: { ...session.source.grid, cell: e.value } })));
      f.addBinding(settings, 'front', { label: 'front (m)', step: session.source.grid.step, min: session.source.grid.step }).on('change', (e) => {
        if (e.last) settingsEdit(() => session.setSettings({ front: e.value }));
      });
      const army = () => settingsEdit(() => session.setSettings({ armySize: { standard: settings.standard, max: settings.max } }));
      f.addBinding(settings, 'standard', { label: 'army standard', step: 1, min: 1 }).on('change', (e) => e.last && army());
      f.addBinding(settings, 'max', { label: 'army most', step: 1, min: 1 }).on('change', (e) => e.last && army());
      f.addBinding(settings, 'fits', { label: 'fits', readonly: true });
      const tickets = () => settingsEdit(() => session.setTickets(settings.ownTickets ? settings.tickets : undefined));
      f.addBinding(settings, 'ownTickets', { label: 'own Tickets' }).on('change', tickets);
      f.addBinding(settings, 'tickets', { label: 'Tickets a Soldier', step: 0.1, min: 0.1 }).on('change', (e) => e.last && settings.ownTickets && tickets());

      const bases = () =>
        settingsEdit(() =>
          session.setSettings({
            bases: [
              { x: settings.base0x, z: settings.base0z },
              { x: settings.base1x, z: settings.base1z },
            ],
          }),
        );
      const bf = f.addFolder({ title: 'Bases', expanded: false });
      for (const k of ['base0x', 'base0z', 'base1x', 'base1z'] as const) bf.addBinding(settings, k, { label: `Team ${k[4]} ${k[5]}`, step: session.source.grid.step }).on('change', (e) => e.last && bases());

      const lf = f.addFolder({ title: 'Lobby card', expanded: false });
      const LOBBY_LABELS: Record<keyof SourceLobby, string> = { label: 'label', where: 'where (… meet ___ and fight)', blurb: 'blurb', art: 'art (CSS background)' };
      for (const k of ['label', 'where', 'blurb', 'art'] as const)
        lf.addBinding(settings, k, { label: LOBBY_LABELS[k] }).on('change', (e) =>
          settingsEdit(() => {
            // A background the browser cannot read would leave the Lobby's card with no picture.
            if (k === 'art' && e.value.trim() !== '' && !CSS.supports('background', e.value)) throw new Error(`"${e.value}" is not a CSS background the browser reads (try linear-gradient(180deg, #8fb4d8, #3b5f25))`);
            session.setLobby({ [k]: e.value });
          }),
        );
      lf.element.appendChild(preview);

      objectiveBound = objectiveProps.map((o) => ({ ...o }));
      objectiveBound.forEach((o) => {
        const id = o.id;
        const of = f.addFolder({ title: `Objective ${id}`, expanded: id === picked });
        of.addBinding(o, 'id');
        of.addBinding(o, 'x', { step: session.source.grid.step });
        of.addBinding(o, 'z', { step: session.source.grid.step });
        of.addBinding(o, 'weight', { step: 0.1, min: 0.1 });
        of.addBinding(o, 'owner', { label: 'starts owned by', options: { nobody: -1, 'Team 0': 0, 'Team 1': 1 } });
        of.addBinding(o, 'spawn');
        of.addBinding(o, 'named', { label: 'names its level' });
        of.addBinding(o, 'y', { label: 'level (y)', ...levels });
        of.on('change', (e) => {
          if (e.last) settingsEdit(() => session.replaceObjective(id, objectiveOf(o)));
        });
        of.addButton({ title: 'Earlier in the order' }).on('click', () => settingsEdit(() => session.reorderObjective(id, -1)));
        of.addButton({ title: 'Later in the order' }).on('click', () => settingsEdit(() => session.reorderObjective(id, 1)));
        of.addButton({ title: 'Remove' }).on('click', () => settingsEdit(() => session.removeObjective(id)));
      });
      f.addButton({ title: 'Place an Objective (O, then click)' }).on('click', () => setTool('objective'));
    } finally {
      syncing = false;
    }
  };

  // --- The look (Stage 5): the sky, the prop tool and the selected prop -----
  const lookUi = { sky: 'dusk' as BattleSky, propKind: 'tree' as PropKind };
  const lookFolder = pane.addFolder({ title: 'Look', expanded: false });
  lookFolder.addBinding(lookUi, 'sky', { label: 'sky and light', options: Object.fromEntries(BATTLE_SKIES.map((k) => [SKY_LABELS[k], k])) }).on('change', (e) => {
    // The 3D view shows it once the checks have run on the edited source.
    settingsEdit(() => session.setSky(e.value === 'dusk' ? undefined : e.value));
  });
  lookFolder.addBinding(lookUi, 'propKind', { label: 'prop tool places', options: Object.fromEntries(PROP_KINDS.map((k) => [k, k])) }).on('change', (e) => {
    view.propKind = e.value;
  });
  lookFolder.addButton({ title: 'Place props (T, then click)' }).on('click', () => setTool('prop'));
  lookFolder.addBinding(ui, 'look3d', { label: '3D view shows the look' }).on('change', () => !syncing && drawChecks());
  let propFolder: FolderApi | undefined;
  let propKey = '';
  /** The selected prop's numbers as the panel edits them (`team` -1: plain). */
  const propUi = { id: '', kind: 'tree' as PropKind, x: 0, z: 0, y: 0, turn: 0, team: -1 };
  const propOf = (): SourceProp => {
    const p = { id: propUi.id, kind: propUi.kind, x: propUi.x, z: propUi.z, y: propUi.y, turn: propUi.turn };
    return propUi.kind === 'banner' && propUi.team >= 0 ? { ...p, team: propUi.team as 0 | 1 } : p;
  };
  const buildProp = () => {
    const p = session.prop;
    const key = p ? `${p.id}|${p.kind}|${session.source.levels.join(',')}` : '';
    if (p) Object.assign(propUi, { ...p, team: p.team ?? -1 });
    if (key === propKey && propFolder) return;
    propKey = key;
    if (propFolder) pane.remove(propFolder);
    propFolder = undefined;
    if (!p) return;
    const f = pane.addFolder({ title: `Prop: ${p.kind} ${p.id}`, index: 4 });
    propFolder = f;
    syncing = true;
    try {
      const coord = { step: session.source.grid.step, min: -session.source.size / 2, max: session.source.size / 2 };
      f.addBinding(propUi, 'id');
      f.addBinding(propUi, 'kind', { options: Object.fromEntries(PROP_KINDS.map((k) => [k, k])) });
      f.addBinding(propUi, 'x', coord);
      f.addBinding(propUi, 'z', coord);
      f.addBinding(propUi, 'y', { label: 'stands on', options: Object.fromEntries(session.source.levels.map((y) => [`${y} m`, y])) });
      f.addBinding(propUi, 'turn', { label: 'turn (°)', min: 0, max: 345, step: 15 });
      if (p.kind === 'banner') f.addBinding(propUi, 'team', { label: 'colour', options: { plain: -1, 'Team 0': 0, 'Team 1': 1 } });
      f.on('change', (e) => {
        if (e.last) settingsEdit(() => session.replaceProp(p.id, propOf()));
      });
      f.addButton({ title: 'Remove (Del)' }).on('click', () => settingsEdit(() => session.removeProp(p.id)));
    } finally {
      syncing = false;
    }
  };

  // --- Checks and overlays ------------------------------------------------
  const checksFolder = pane.addFolder({ title: 'Checks', index: 4 });
  checksFolder.addBinding(ui, 'view', { label: 'view', options: { 'top (2D, edit)': 'top', '3D (orbit)': '3d', 'split (top | 3D)': 'split' } }).on('change', (e) => {
    if (syncing) return;
    setView(e.value);
  });
  const overlayChanged = () => {
    if (syncing) return;
    // The edges' runs are worked out only while their overlay is on.
    if (overlays.edges && checks?.draft && checks.edges.length === 0) return runChecks();
    buildClearance();
    costLine();
    drawChecks();
    refreshPane();
  };
  checksFolder.addBinding(overlays, 'reach', { label: 'reachability' }).on('change', overlayChanged);
  checksFolder.addBinding(overlays, 'edges', { label: 'edges' }).on('change', overlayChanged);
  for (const k of EDGE_KINDS) checksFolder.addBinding(overlays.edgeKinds, k, { label: `  ${EDGE_LABELS[k]}` }).on('change', overlayChanged);
  checksFolder.addBinding(overlays, 'clearance', { label: 'clearance' }).on('change', overlayChanged);
  checksFolder.addBinding(overlays, 'centres', { label: 'field cell centres' }).on('change', overlayChanged);
  checksFolder.addBinding(ui, 'cost', { readonly: true, multiline: true, rows: 5, label: 'cost' });
  checksFolder.addButton({ title: 'Measure navmesh build' }).on('click', measureNavmesh);
  const legend = document.createElement('div');
  legend.style.cssText = 'padding:2px 8px 6px;font:11px/1.4 system-ui,sans-serif;color:#bbb';
  const swatch = (c: string, t: string) => `<span style="display:inline-block;width:9px;height:9px;background:${c};margin:0 3px 0 6px"></span>${t}`;
  legend.innerHTML = [
    `reach: ${swatch('#3fbf5f', 'reached')}${swatch('#ff3b3b', 'unreached')}${swatch('#ff9a2f', 'no way back')}`,
    `edges: ${EDGE_KINDS.map((k) => swatch(EDGE_COLOURS[k], k)).join('')}`,
    `clearance (files a Formation fits): ${swatch('#ff3b3b', '1')}${swatch('#ffb03f', '3')}${swatch('#5fc050', '6+')}${swatch('#4a78c8', 'open')}`,
    `centres: ${swatch('#ff3b3b', 'a Wall cuts the node off')}`,
  ].join('<br>');
  checksFolder.element.appendChild(legend);

  pane.addBinding(ui, 'status', { readonly: true, multiline: true, rows: 5, label: 'status' });
  const cursorBinding = pane.addBinding(ui, 'cursor', { readonly: true, label: 'pointer' });

  // --- The quick edits: the toolbar, the shortcuts and the right-click menu --
  const setTool = (t: Tool) => {
    ui.tool = t;
    refreshPane();
    view.redraw();
  };
  const setLevel = (y: number) => {
    session.level = y;
    ui.level = y;
    refreshPane();
    view.redraw();
  };
  const setShowAll = (on: boolean) => {
    session.showAll = on;
    ui.showAll = on;
    refreshPane();
    view.redraw();
  };
  const setView = (mode: ViewMode) => {
    ui.view = mode;
    layoutViews(mode);
    drawChecks();
    refreshPane();
  };
  /** The editor's clipboard: a Brush as it was copied (Ctrl+C, or the menu), pasted under the pointer with Ctrl+V. */
  let clipboard: Brush | null = null;
  const copy = (): boolean => {
    const b = session.selection;
    if (!b) {
      say('Select a Brush to copy');
      return false;
    }
    clipboard = b;
    say(`Copied ${b.kind} ${b.id}: Ctrl+V (or right-click, Paste here) puts a copy under the pointer`);
    return true;
  };
  const paste = (at: GroundPoint | null) => {
    const b = clipboard;
    if (!b) return say('Copy a Brush first (Ctrl+C)');
    // Off the view, a coarse cell east of where it was copied from.
    const r = boundsOf(b);
    const to = at ?? { x: (r.x0 + r.x1) / 2 + session.source.grid.cell, z: (r.z0 + r.z1) / 2 };
    settingsEdit(() => session.pasteBrush(b, to));
  };
  const deleteSelected = () => {
    const m = session.marker;
    if (m?.kind === 'objective') settingsEdit(() => session.removeObjective(m.id));
    else if (m?.kind === 'prop') settingsEdit(() => session.removeProp(m.id));
    else remove();
  };
  /** A quarter turn (Q): the selected Brush about its middle, or the selected prop. */
  const rotateSelected = () => {
    const p = session.prop;
    if (p) return settingsEdit(() => session.replaceProp(p.id, { ...p, turn: (p.turn + 90) % 360 }));
    withSelection((id) => session.rotateBrush(id))();
  };

  const toolbarState = () => ({
    tool: ui.tool,
    levels: session.source.levels,
    level: session.level,
    showAll: session.showAll,
    mirror: session.source.mirror === true,
    view: ui.view,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
  });
  toolbar = new Toolbar(container, toolbarState, {
    tool: setTool,
    undo: () => {
      session.undo();
      rebuild();
    },
    redo: () => {
      session.redo();
      rebuild();
    },
    level: setLevel,
    showAll: setShowAll,
    mirror: (on) => setMirror(on),
    view: setView,
    playtest,
    help: () => toggleHelp(),
  });

  const helpBox = document.createElement('div');
  helpBox.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(640px,calc(100% - 32px));max-height:80vh;overflow:auto;padding:12px 16px;background:rgba(18,20,26,0.96);color:#ddd;font:12px/1.5 system-ui,sans-serif;border:1px solid #444;border-radius:6px;z-index:8;display:none';
  const SHORTCUTS: readonly (readonly [string, string])[] = [
    ['V F D P R H Z L W B E O T', 'tools: select, Floor, Deck, Platform, Ramp, Hole, Hazard, Rail, Wall, Block, Enclosure, Objective, prop'],
    ['Right-click', 'what you can do with what is there (a Brush, an Objective, a prop, or the ground)'],
    ['Click again', 'on the selected Brush, without moving: the Brush under it'],
    ['Alt-drag', 'a copy of the Brush'],
    ['Double-click', 'a faded Brush: edit its level'],
    ['1 … 9, PageUp / PageDown', 'the level being edited'],
    ['A', 'show every level (the others faded), or only the one being edited'],
    ['Q', 'turn the selected Brush (or prop) a quarter clockwise'],
    ['Ctrl+C / Ctrl+X / Ctrl+V', 'copy, cut, paste under the pointer'],
    ['Ctrl+D', 'duplicate (a coarse cell east)'],
    ['Del', 'delete the selection'],
    ['[ / ]', 'paint earlier, later'],
    ['Arrows (Shift: a coarse cell)', 'nudge the selection'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'undo, redo'],
    ['M', 'mirror mode'],
    ['Home', 'frame the whole field'],
    ['Space-drag, right-drag', 'pan (the wheel zooms)'],
    ['Ctrl+S / Ctrl+Enter', 'save, play-test'],
    ['Esc', 'the select tool, nothing selected'],
  ];
  helpBox.innerHTML = `<div style="font-weight:600;margin-bottom:6px">Map Editor keys <span style="color:#888;font-weight:400">(? or Esc closes)</span></div><table style="border-collapse:collapse">${SHORTCUTS.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#ffe14d;white-space:nowrap;vertical-align:top">${k}</td><td>${v}</td></tr>`).join('')}</table>`;
  helpBox.addEventListener('pointerdown', () => (helpBox.style.display = 'none'));
  container.appendChild(helpBox);
  const toggleHelp = () => {
    helpBox.style.display = helpBox.style.display === 'none' ? 'block' : 'none';
  };

  /** A menu item that runs a session edit (refused edits are shown in the status, as the panel's are). */
  const act = (label: string, f: () => void, extra: Partial<Exclude<MenuItem, 'separator'>> = {}): MenuItem => ({ label, action: () => settingsEdit(f), ...extra });
  const levelLabel = (y: number) => `${y} m`;
  const brushItems = (b: Brush, stack: readonly Brush[]): MenuItem[] => {
    const levels = session.source.levels;
    const items: MenuItem[] = [
      { label: `${b.kind} ${b.id}${b.twin === undefined ? '' : b.twin === b.id ? ' (its own twin)' : ` (twin ${b.twin})`}`, header: true },
      act('Duplicate', () => session.duplicateBrush(b.id), { hint: 'Ctrl+D' }),
      { label: 'Copy', hint: 'Ctrl+C', action: () => copy() },
      { label: 'Cut', hint: 'Ctrl+X', action: () => copy() && remove() },
      act('Delete', () => session.deleteBrush(b.id), { hint: 'Del' }),
      act('Turn a quarter clockwise', () => session.rotateBrush(b.id), { hint: 'Q' }),
      {
        label: 'Paint order',
        submenu: [
          act('Paint last (over everything)', () => session.reorder(b.id, session.source.brushes.length)),
          act('Paint later', () => session.reorder(b.id, 1), { hint: ']' }),
          act('Paint earlier', () => session.reorder(b.id, -1), { hint: '[' }),
          act('Paint first (under everything)', () => session.reorder(b.id, -session.source.brushes.length)),
        ],
      },
    ];
    // Its level, for the kinds that stand at one.
    if ('y' in b && b.kind !== 'rail' && b.kind !== 'enclosure') items.push({ label: 'Level', submenu: levels.map((y) => act(levelLabel(y), () => session.replaceBrush(b.id, { ...b, y }), { checked: b.y === y })) });
    if (b.kind === 'rail' || b.kind === 'enclosure') items.push({ label: b.kind === 'rail' ? 'Stands on' : 'Floor level', submenu: levels.map((y) => act(levelLabel(y), () => session.replaceBrush(b.id, { ...b, y }), { checked: b.y === y })) });
    if (b.kind === 'platform') items.push({ label: 'Top level', submenu: levels.map((y) => act(levelLabel(y), () => session.replaceBrush(b.id, { ...b, top: y }), { checked: b.top === y })) });
    if (b.kind === 'floor' || b.kind === 'deck' || b.kind === 'hole' || b.kind === 'hazard') {
      const kinds = ['floor', 'deck', 'hole', 'hazard'] as const;
      items.push({
        label: 'Kind',
        submenu: kinds.map((k) =>
          act(k, () => {
            const base = { kind: k, id: b.id, rect: b.rect, y: b.y };
            const material = k === 'hole' || k === 'hazard' || b.kind === 'hole' || b.kind === 'hazard' ? {} : b.material ? { material: b.material } : {};
            session.replaceBrush(b.id, (k === 'hazard' ? { ...base, hazard: 'lava' } : { ...base, ...material }) as Brush);
          }, { checked: b.kind === k }),
        ),
      });
    }
    if (b.kind === 'hazard') items.push({ label: 'Hazard', submenu: (['lava', 'water', 'abyss'] as const).map((h) => act(h, () => session.replaceBrush(b.id, { ...b, hazard: h }), { checked: b.hazard === h })) });
    if (b.kind === 'ramp') {
      items.push({
        label: 'Rises toward',
        submenu: SIDES.map((side) =>
          act(SIDE_LABELS[side], () => {
            const long = rampLongSides(side);
            const rails = b.rails.length === 0 ? [] : b.rails.length === 2 ? [...long] : [long[0]!];
            session.replaceBrush(b.id, { ...b, up: side, rails });
          }, { checked: b.up === side }),
        ),
      });
      items.push({
        label: 'Rails',
        submenu: rampLongSides(b.up).map((side) =>
          act(`rail ${SIDE_LABELS[side]}`, () => session.replaceBrush(b.id, { ...b, rails: b.rails.includes(side) ? b.rails.filter((x) => x !== side) : [...b.rails, side] }), { checked: b.rails.includes(side) }),
        ),
      });
    }
    if (b.kind === 'enclosure') {
      items.push({
        label: 'Doorways',
        submenu: SIDES.map((side) =>
          act(SIDE_LABELS[side], () => {
            const doors = { ...b.doors };
            const len = side === 'n' || side === 's' ? b.rect.x1 - b.rect.x0 : b.rect.z1 - b.rect.z0;
            if (doors[side] !== undefined) delete doors[side];
            else doors[side] = Math.min(DOOR_WIDTH, len);
            session.replaceBrush(b.id, { ...b, doors });
          }, { checked: b.doors[side] !== undefined }),
        ),
      });
    }
    if (b.kind !== 'hole' && b.kind !== 'hazard') {
      const { material: _m, ...plain } = b;
      items.push({
        label: 'Material',
        submenu: [
          act(`its kind's (${materialOf(plain as Brush, session.source)})`, () => session.replaceBrush(b.id, plain as Brush), { checked: b.material === undefined }),
          'separator',
          ...MAP_MATERIALS.map((m) => act(m, () => session.replaceBrush(b.id, { ...b, material: m } as Brush), { checked: b.material === m })),
        ],
      });
    }
    items.push('separator');
    const own = brushLevels(b, levels);
    if (!own.includes(session.level)) items.push({ label: `Edit its level (${levelLabel(own[0]!)})`, hint: 'double-click', action: () => setLevel(own[0]!) });
    items.push({
      label: 'Frame it',
      action: () => {
        const r = boundsOf(b);
        view.frameRect(r);
        if (ui.view !== 'top') view3d.focus(r, session.level, session.source.name);
      },
    });
    if (b.twin !== undefined) items.push(act('Unlink its twin', () => session.unlink(b.id)));
    if (stack.length > 1)
      items.push({
        label: 'Select under the pointer',
        submenu: stack.map((x) => ({ label: `${x.kind} ${x.id}`, checked: x.id === b.id, action: () => {
          session.select(x.id);
          sync();
          view.redraw();
        } })),
      });
    return items;
  };
  const markerItems = (m: Marker): MenuItem[] => {
    const s = session.source;
    if (m.kind === 'objective') {
      const o = s.objectives.find((x) => x.id === m.id);
      if (!o) return [];
      const items: MenuItem[] = [
        { label: `Objective ${o.id}${o.twin === undefined ? '' : o.twin === o.id ? ' (its own twin)' : ` (twin ${o.twin})`}`, header: true },
        act('A spawn', () => session.replaceObjective(o.id, { ...o, spawn: !o.spawn }), { checked: o.spawn }),
        { label: 'Starts owned by', submenu: ([[-1, 'nobody'], [0, 'Team 0'], [1, 'Team 1']] as const).map(([v, t]) => act(t, () => session.replaceObjective(o.id, { ...o, owner: v }), { checked: o.owner === v })) },
        { label: 'Weight', submenu: [0.5, 1, 1.4, 2, 3].map((w) => act(String(w), () => session.replaceObjective(o.id, { ...o, weight: w }), { checked: o.weight === w })) },
      ];
      if (s.levels.length > 1) items.push({ label: 'Level (y)', submenu: s.levels.map((y) => act(levelLabel(y), () => session.replaceObjective(o.id, { ...o, y }), { checked: o.y === y })) });
      items.push(act('Earlier in the order', () => session.reorderObjective(o.id, -1)), act('Later in the order', () => session.reorderObjective(o.id, 1)));
      if (o.twin !== undefined) items.push(act('Unlink its twin', () => session.unlink(m)));
      items.push('separator', act('Remove', () => session.removeObjective(o.id), { hint: 'Del' }));
      return items;
    }
    if (m.kind === 'prop') {
      const p = session.prop;
      if (!p) return [];
      const { team: _t, ...plain } = p;
      const items: MenuItem[] = [
        { label: `Prop: ${p.kind} ${p.id}`, header: true },
        { label: 'Kind', submenu: PROP_KINDS.map((k) => act(k, () => session.replaceProp(p.id, k === 'banner' ? { ...p, kind: k } : { ...plain, kind: k }), { checked: p.kind === k })) },
        act('Turn a quarter', () => session.replaceProp(p.id, { ...p, turn: (p.turn + 90) % 360 }), { hint: 'Q' }),
      ];
      if (p.kind === 'banner') items.push({ label: 'Colour', submenu: ([[-1, 'plain'], [0, 'Team 0'], [1, 'Team 1']] as const).map(([v, t]) => act(t, () => session.replaceProp(p.id, v === -1 ? plain : { ...p, team: v }), { checked: (p.team ?? -1) === v })) });
      if (p.y !== session.level) items.push(act(`Stand it on the level being edited (${levelLabel(session.level)})`, () => session.replaceProp(p.id, { ...p, y: session.level })));
      if (p.twin !== undefined) items.push(act('Unlink its twin', () => session.unlink(m)));
      items.push('separator', act('Remove', () => session.removeProp(p.id), { hint: 'Del' }));
      return items;
    }
    return [{ label: m.kind === 'base' ? `Team ${m.team}'s Base (drag it)` : `Team ${m.team}'s front line (drag it)`, header: true }];
  };
  const hereItems = (at: GroundPoint): MenuItem[] => {
    const half = session.source.size / 2;
    const off = Math.abs(at.x) >= half || Math.abs(at.z) >= half;
    const levels = session.source.levels;
    return [
      act('Paste here', () => session.pasteBrush(clipboard!, at), { hint: 'Ctrl+V', disabled: clipboard === null || off }),
      { label: 'Add a cell here', disabled: off, submenu: BRUSH_KINDS.map((k) => act(TOOL_LABELS[k].replace(/ \(.*$/, ''), () => session.addBrush(k, at, at))) },
      act('Place an Objective here', () => session.addObjective(at), { disabled: off }),
      {
        label: 'Place a prop here',
        disabled: off,
        submenu: PROP_KINDS.map((k) =>
          act(k, () => {
            lookUi.propKind = k;
            view.propKind = k;
            session.addProp(k, at);
          }),
        ),
      },
      'separator',
      { label: 'Edit level', submenu: levels.map((y, k) => ({ label: levelLabel(y), hint: k < 9 ? String(k + 1) : '', checked: y === session.level, action: () => setLevel(y) })) },
      { label: 'Show every level', hint: 'A', checked: session.showAll, action: () => setShowAll(!session.showAll) },
      { label: 'Frame the whole field', hint: 'Home', action: () => view.frame(session.source) },
    ];
  };
  /** The right-click menu: what is under the pointer is selected, its own items first, then what can be done on the ground there. */
  const menuAt = (at: GroundPoint, x: number, y: number) => {
    const marker = view.markerUnder(at.x, at.z);
    const stack = view.pickStack(at.x, at.z);
    let items: MenuItem[] = [];
    if (marker) {
      session.selectMarker(marker);
      items = markerItems(marker);
    } else if (stack.length > 0) {
      const b = stack.find((v) => v.id === session.selected) ?? stack[0]!;
      session.select(b.id);
      items = brushItems(b, stack);
    } else {
      session.select(null);
      session.selectMarker(null);
    }
    sync();
    view.redraw();
    if (items.length > 0) items.push('separator');
    showMenu(x, y, [...items, ...hereItems(at)]);
  };
  view.onContext = menuAt;

  /** Bring the panel up to the session: the Brush folder for the selection, the undo buttons, the title. */
  const sync = () => {
    ui.level = session.level;
    ui.showAll = session.showAll;
    scheduleChecks();
    buildBrush();
    buildProp();
    lookUi.sky = session.source.look?.sky ?? 'dusk';
    ui.mirror = session.source.mirror === true;
    syncMap();
    undoButton.disabled = !session.canUndo;
    redoButton.disabled = !session.canRedo;
    pane.title = `Map Editor: ${session.source.name}${session.dirty ? ' •' : ''}`;
    refreshPane();
  };
  /** Rebuild every panel that depends on the source's shape (levels, Objectives) and bring the rest up to it. */
  const rebuild = () => {
    buildLevels();
    mapKey = '';
    sync();
    view.redraw();
  };
  rebuild();
  runChecks();

  window.addEventListener('beforeunload', (e) => {
    if (session.dirty) e.preventDefault();
  });
  const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') view.panHeld = false;
  });
  window.addEventListener('blur', () => (view.panHeld = false));
  window.addEventListener('keydown', (e) => {
    // The play-test has the keyboard (WASD would otherwise pick tools, the arrows nudge a Brush, Ctrl+Z undo an edit under it).
    if (playtesting) return;
    if (typing(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      if (e.shiftKey) session.redo();
      else session.undo();
      rebuild();
    } else if (mod && key === 'y') {
      session.redo();
      rebuild();
    } else if (mod && key === 'd') {
      duplicate();
    } else if (mod && key === 'c') {
      copy();
    } else if (mod && key === 'x') {
      if (copy()) remove();
    } else if (mod && key === 'v') {
      paste(view.pointerAt);
    } else if (mod && key === 's') {
      void save();
    } else if (mod && e.key === 'Enter') {
      playtest();
    } else if (!mod && e.key === ' ') {
      view.panHeld = true;
    } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
      deleteSelected();
    } else if (!mod && e.key === 'Escape') {
      if (helpBox.style.display !== 'none') helpBox.style.display = 'none';
      else {
        ui.tool = 'select';
        session.select(null);
        session.selectMarker(null);
        sync();
        view.redraw();
      }
    } else if (!mod && (e.key === '[' || e.key === ']')) {
      withSelection((id) => session.reorder(id, e.key === '[' ? -1 : 1))();
    } else if (!mod && e.key.startsWith('Arrow') && (session.selected !== null || session.marker !== null)) {
      // Nudge by a grid step (a coarse cell with Shift): the selected Brush, or the selected marker. East is drawn on the left, so Left is +x.
      const by = e.shiftKey ? session.source.grid.cell : session.source.grid.step;
      const [dx, dz] = { ArrowLeft: [by, 0], ArrowRight: [-by, 0], ArrowUp: [0, by], ArrowDown: [0, -by] }[e.key] ?? [0, 0];
      const m = session.marker;
      if (m) settingsEdit(() => session.moveMarker(m, dx!, dz!));
      else withSelection((id) => session.moveBrush(id, dx!, dz!))();
    } else if (!mod && !e.altKey && /^[1-9]$/.test(e.key)) {
      const y = session.source.levels[Number(e.key) - 1];
      if (y === undefined) return say(`This map has ${session.source.levels.length} level${session.source.levels.length === 1 ? '' : 's'}: add one in the Levels folder`);
      setLevel(y);
    } else if (!mod && (e.key === 'PageUp' || e.key === 'PageDown')) {
      const levels = session.source.levels;
      const k = levels.indexOf(session.level) + (e.key === 'PageUp' ? 1 : -1);
      if (k >= 0 && k < levels.length) setLevel(levels[k]!);
    } else if (!mod && e.key === 'Home') {
      view.frame(session.source);
    } else if (!mod && e.key === '?') {
      toggleHelp();
    } else if (!mod && !e.altKey && key === 'q') {
      rotateSelected();
    } else if (!mod && !e.altKey && key === 'a') {
      setShowAll(!session.showAll);
    } else if (!mod && !e.altKey && key === 'm') {
      setMirror(!session.source.mirror);
    } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
      setTool(TOOL_KEYS[key]!);
    } else {
      return;
    }
    e.preventDefault();
  });
}
