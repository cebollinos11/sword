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
 * `MapEditorSession` holds the source and every operation on it (unit-tested); this file only calls it and the checks.
 */
import { Pane, type FolderApi } from 'tweakpane';
import type { TuningData } from '../../tuning';
import { saveJsonFile } from '../../editor/save';
import { navMesh } from '../../sim';
import { checkMap, EDGE_KINDS, fieldClearance, issueBounds, type ClearanceNode, type MapChecks, type MapIssue } from '../checks';
import { MapCompileError } from '../compile';
import { sampleSource } from '../sample.testdata';
import { blankSource, brushLevels, isSegment, MapEditorSession, rampLongSides } from '../session';
import { BRUSH_KINDS, SIDES, type Brush, type BrushKind, type HazardKind, type Side } from '../source';
import { EDGE_COLOURS, EDGE_LABELS, type Overlays } from './overlays';
import { TopView, type Tool } from './topView';
import { View3D } from './view3d';

/** How long (ms) after an edit the source is checked again, and the navmesh and the fields' clearance built (they are slower). */
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
};
const TOOL_KEYS: Record<string, Tool> = { v: 'select', f: 'floor', d: 'deck', p: 'platform', r: 'ramp', h: 'hole', z: 'hazard', l: 'rail', w: 'wall', b: 'block' };

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
  return into;
}

function brushFromProps(kind: BrushKind, p: BrushProps): Brush {
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
  }
}

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
    status: 'Pick a tool and drag on the grid to draw a Brush. Select: click to pick, drag to move, drag a yellow handle to resize. Right-drag or drag empty ground to pan, wheel to zoom.',
    cursor: '',
    view: 'top' as 'top' | '3d',
    cost: '',
  };
  const overlays: Overlays = { reach: true, edges: false, edgeKinds: { walk: false, drop: true, wall: true, ledge: true }, clearance: false, centres: true };
  /** True while the panel is being brought up to the session: Tweakpane reports the values it refreshes as changes, which are not edits. */
  let syncing = false;
  const refreshPane = () => {
    syncing = true;
    try {
      pane.refresh();
    } finally {
      syncing = false;
    }
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

  const view3d = new View3D(container);

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
  const drawChecks = () => {
    view.checks = checks;
    view.overlays = overlays;
    view.clearance = overlays.clearance ? clearance : null;
    view.levels = tuning.battle.levels;
    view.redraw();
    if (ui.view === '3d' && checks) view3d.update(checks, overlays, overlays.clearance ? clearance : null, tuning.battle.levels);
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
  const examples: Record<string, () => unknown> = { "Stage 0's sample": sampleSource };
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

  const save = async () => {
    let files: ReturnType<MapEditorSession['files']>;
    try {
      files = session.files(tuning.battle);
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
    for (const f of [files.source, files.map]) {
      try {
        const result = await saveJsonFile(f.fileName, f.text);
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
  file.addButton({ title: 'Save (source + compiled map)' }).on('click', () => void save());

  // --- Tools and edits ----------------------------------------------------
  pane.addBinding(ui, 'tool', { label: 'tool', options: Object.fromEntries((['select', ...BRUSH_KINDS] as Tool[]).map((t) => [TOOL_LABELS[t], t])) });
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

  // --- Levels -------------------------------------------------------------
  let levelsFolder: FolderApi | undefined;
  const buildLevels = () => {
    if (levelsFolder) pane.remove(levelsFolder);
    const f = pane.addFolder({ title: 'Levels', index: 3 });
    levelsFolder = f;
    ui.level = session.level;
    ui.showAll = session.showAll;
    f.addBinding(ui, 'level', { label: 'editing', options: Object.fromEntries(session.source.levels.map((y) => [`${y} m`, y])) }).on('change', (e) => {
      session.level = e.value;
      view.redraw();
    });
    f.addBinding(ui, 'showAll', { label: 'show all levels' }).on('change', (e) => {
      session.showAll = e.value;
      view.redraw();
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
    const key = sel ? `${sel.id}|${sel.kind}|${sel.kind === 'ramp' ? sel.up : ''}|${levels.join(',')}|${session.source.grid.step}` : '';
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
    const f = pane.addFolder({ title: `Brush: ${sel.kind} ${sel.id}`, index: 4 });
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
    }
    f.on('change', (e) => {
      if (e.last) commitProps();
    });
  };

  // --- Map settings (Stage 3 makes the markers draggable) ------------------
  let mapFolder: FolderApi | undefined;
  const buildMap = () => {
    if (mapFolder) pane.remove(mapFolder);
    const f = pane.addFolder({ title: 'Map', expanded: false });
    mapFolder = f;
    ui.name = session.source.name;
    f.addBinding(ui, 'name', { label: 'name' }).on('change', (e) => {
      if (syncing) return;
      try {
        session.setSettings({ name: e.value });
      } catch (err) {
        ui.name = session.source.name;
        say(err instanceof Error ? err.message : String(err));
      }
      sync();
    });
    const objectives = session.source.objectives.map((o) => ({ ...o }));
    for (const o of objectives) {
      const of = f.addFolder({ title: `Objective ${o.id}`, expanded: false });
      of.addBinding(o, 'x', { step: 0.5 });
      of.addBinding(o, 'z', { step: 0.5 });
      of.addBinding(o, 'weight', { step: 0.1, min: 0.1 });
      of.addBinding(o, 'owner', { label: 'starts owned by', options: { nobody: -1, 'Team 0': 0, 'Team 1': 1 } });
      of.addBinding(o, 'spawn');
      of.on('change', (e) => {
        if (!e.last || syncing) return;
        try {
          session.setSettings({ objectives: objectives.map((x) => ({ ...x })) });
        } catch (err) {
          say(err instanceof Error ? err.message : String(err));
        }
        sync();
        view.redraw();
      });
    }
  };

  // --- Checks and overlays ------------------------------------------------
  const checksFolder = pane.addFolder({ title: 'Checks', index: 3 });
  checksFolder.addBinding(ui, 'view', { label: 'view', options: { 'top (2D, edit)': 'top', '3D (orbit)': '3d' } }).on('change', (e) => {
    if (syncing) return;
    view3d.show(e.value === '3d');
    view.shown = e.value !== '3d';
    view.canvas.style.visibility = e.value === '3d' ? 'hidden' : 'visible';
    drawChecks();
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

  /** Bring the panel up to the session: the Brush folder for the selection, the undo buttons, the title. */
  const sync = () => {
    scheduleChecks();
    buildBrush();
    undoButton.disabled = !session.canUndo;
    redoButton.disabled = !session.canRedo;
    pane.title = `Map Editor: ${session.source.name}${session.dirty ? ' •' : ''}`;
    refreshPane();
  };
  /** Rebuild every panel that depends on the source's shape (levels, Objectives) and bring the rest up to it. */
  const rebuild = () => {
    buildLevels();
    buildMap();
    sync();
    view.redraw();
  };
  rebuild();
  runChecks();

  window.addEventListener('beforeunload', (e) => {
    if (session.dirty) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
    } else if (mod && key === 's') {
      void save();
    } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
      remove();
    } else if (!mod && e.key === 'Escape') {
      ui.tool = 'select';
      session.select(null);
      sync();
      view.redraw();
    } else if (!mod && (e.key === '[' || e.key === ']')) {
      withSelection((id) => session.reorder(id, e.key === '[' ? -1 : 1))();
    } else if (!mod && e.key.startsWith('Arrow') && session.selected !== null) {
      // Nudge by a grid step (a coarse cell with Shift).
      const by = e.shiftKey ? session.source.grid.cell : session.source.grid.step;
      const [dx, dz] = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, by], ArrowDown: [0, -by] }[e.key] ?? [0, 0];
      withSelection((id) => session.moveBrush(id, dx!, dz!))();
    } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
      ui.tool = TOOL_KEYS[key]!;
      refreshPane();
    } else {
      return;
    }
    e.preventDefault();
  });
}
