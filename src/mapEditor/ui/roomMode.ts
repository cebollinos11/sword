/**
 * The Map Editor's room mode panel (docs/plans/delver.md, Stage 7g, §5): File → New dungeon room and Open dungeon room, and the Room folder (the
 * room's name and size, its doorways and their levels, its kinds, its centre, Check room, Save and Try in a Floor). The room is edited as its stub
 * map (`room.ts`) in the ordinary session, its Enclosure and stubs locked and places snapped 2 m from the walls; the centre is the stub's Objective
 * D, dragged like any Objective. Save writes `data/delver/rooms/<name>.json` only once Check room has passed on the source as it stands.
 */
import type { FolderApi, Pane } from 'tweakpane';
import { saveJsonFile } from '../../editor/save';
import type { TuningData } from '../../tuning';
import { ROOM_DOOR_MAX, ROOM_KINDS, type DrawnRoom, type RoomKind } from '../../tuning/delverRooms';
import type { MapEditorSession } from '../session';
import { EDIT_TOP, editOrigin, editSource, isFixed, looseRoomParts, newRoomMeta, ROOM_ENCLOSURE, ROOM_SNAP, roomFileText, roomFromSource, roomParts, roomStub, type RoomMeta } from '../room';
import { checkRoom, roomCheckText, type RoomCheck } from '../roomCheck';
import type { WalkLeg } from '../navWalk';
import { SIDES, type Brush, type Rect, type Side } from '../source';
import { boundsOf } from '../session';

/** The drawn room files bundled from `data/delver/rooms/`, keyed by file name. */
const roomFiles = import.meta.glob<unknown>('../../../data/delver/rooms/*.json', { eager: true, import: 'default' });
export const bundledRooms = (): Record<string, unknown> => Object.fromEntries(Object.entries(roomFiles).map(([p, raw]) => [p.slice(p.lastIndexOf('/') + 1, -'.json'.length), raw]));

export interface RoomModeHost {
  readonly pane: Pane;
  readonly file: FolderApi;
  readonly session: MapEditorSession;
  readonly tuning: TuningData;
  readonly say: (text: string) => void;
  /** After the session opened a new source: frame it and rebuild the panels. */
  readonly opened: (what: string) => void;
  readonly rebuild: () => void;
  readonly discardOk: () => boolean;
  /** Frame the room (and its stubs) in the views. */
  readonly frameRoom: (rect: Rect) => void;
  /** Mark Brushes red in the top view. */
  readonly flag: (ids: string[]) => void;
  /** Draw the AI's traces of Check room over the view (stub map metres, already moved into the editing stub's). */
  readonly showLegs: (legs: readonly WalkLeg[]) => void;
  /** Open a Delver Floor dealt on `tuning` (the room's Try in a Floor). */
  readonly openFloor: (tuning: TuningData, seed: number, floor: number, what: string) => void;
  /** The seed and Floor the File folder's Delver choices name. */
  readonly floorAsked: () => { seed: number; floor: number };
}

export interface RoomMode {
  /** Whether the session holds a drawn room. */
  readonly active: () => boolean;
  /** Open the bundled room `name` (and check it, with `check`). */
  readonly openBundled: (name: string, check?: boolean) => void;
  /** The room as edited now, parsed (null when it does not parse), for Try in a Floor. */
  readonly edited: () => DrawnRoom | null;
  /** Leave room mode (another map was opened). */
  readonly leave: () => void;
  /** Save the room (its Save button's, and Ctrl+S's in room mode). */
  readonly save: () => void;
  /** Whether the room's settings changed since it was opened or saved (a change reopens the session, so the session's own `dirty` misses it). */
  readonly dirty: () => boolean;
}

export function addRoomMode(host: RoomModeHost): RoomMode {
  const { pane, file, session, tuning } = host;
  const f = tuning.delver.floor;
  const [minHalf, maxHalf] = f.halfSize;
  let meta: RoomMeta | null = null;
  /** The last Check room, and the source it checked. */
  let last: { of: unknown; check: RoomCheck } | null = null;
  /** The room's settings changed since it was opened or saved. */
  let changed = false;
  const ui = {
    newName: 'newroom',
    width: 2 * Math.max(minHalf, 10),
    depth: 2 * Math.max(minHalf, 10),
    pick: Object.keys(bundledRooms())[0] ?? '',
    name: '',
    rw: 0,
    rd: 0,
    centre: '',
    report: '',
    ...Object.fromEntries(SIDES.flatMap((d) => [[`door_${d}`, false], [`level_${d}`, 0]])),
    ...Object.fromEntries(ROOM_KINDS.map((k) => [`kind_${k}`, true])),
  } as Record<string, unknown> & { newName: string; width: number; depth: number; pick: string; name: string; rw: number; rd: number; centre: string; report: string };

  /** The centre as the stub's Objective D stands, in the room frame. */
  const centreNow = (m: RoomMeta): [number, number] => {
    const d = session.source.objectives.find((o) => o.id === 'D');
    const [ox, oz] = editOrigin(m.half);
    return d ? [Math.round(d.x - ox), Math.round(d.z - oz)] : [...m.centre] as [number, number];
  };
  /** The room file as it stands now (meta with the centre where D stands, and the session's Brushes). */
  const rawNow = (): Record<string, unknown> | null => {
    if (!meta) return null;
    meta = { ...meta, centre: centreNow(meta) };
    return roomFromSource(meta, session.source);
  };

  /** Open `m` with `brushes` (room frame) as the session's source, locked, snapped; Brushes outside its rect flagged. */
  const show = (m: RoomMeta, brushes: readonly Brush[], what: string, fresh: boolean) => {
    session.open(editSource(m, brushes, f.passage, tuning.battle.field.size));
    session.locked = isFixed;
    session.snapStep = ROOM_SNAP;
    session.blockTop = EDIT_TOP;
    session.level = 0;
    meta = m;
    last = null;
    changed = !fresh;
    ui.report = '';
    host.showLegs([]);
    if (fresh) host.opened(what);
    else host.rebuild();
    host.frameRoom(boundsOf(session.source.brushes.find((b) => b.id === ROOM_ENCLOSURE)!));
    const [hw, hd] = m.half;
    const out = brushes.filter((b) => {
      const r = boundsOf(b);
      return r.x0 < -hw || r.x1 > hw || r.z0 < -hd || r.z1 > hd;
    });
    host.flag(out.map((b) => b.id));
    if (out.length) host.say(`${out.length} Brush${out.length === 1 ? ' lies' : 'es lie'} outside the room (red): move them in or delete them before Check room.`);
    syncUi();
  };
  const syncUi = () => {
    if (!meta) return;
    ui.name = meta.name;
    ui.rw = 2 * meta.half[0];
    ui.rd = 2 * meta.half[1];
    for (const d of SIDES) {
      ui[`door_${d}`] = meta.doorways[d] !== undefined;
      ui[`level_${d}`] = meta.doorways[d] ?? 0;
    }
    for (const k of ROOM_KINDS) ui[`kind_${k}`] = meta.kinds.includes(k);
    ui.centre = `(${meta.centre.join(', ')}): drag Objective D`;
    rebuildFolder();
  };
  /** Change the room's settings: its Brushes kept where they are in the room frame. */
  const change = (next: Partial<RoomMeta>) => {
    if (!meta) return;
    const raw = rawNow()!;
    const m = { ...meta, ...next };
    // The Brushes' undo history ends here (the stub is rebuilt round them); the room stays unsaved until Save.
    const wasDirty = session.dirty || changed;
    show(m, raw.brushes as Brush[], '', false);
    changed = changed || wasDirty;
  };

  /** Open the room file `raw`: parsed when it parses; else as it stands (a room a newer rule refuses can still be opened and fixed), with the reason shown. */
  const openRoom = (raw: unknown, what: string, check = false) => {
    let parts: { meta: RoomMeta; brushes: readonly Brush[] };
    let refused: string | null = null;
    const parsed = checkRoom(raw, tuning, { walk: false });
    try {
      if (parsed.room) parts = roomParts(parsed.room);
      else {
        refused = parsed.issues[0]?.message ?? 'not a room file';
        parts = looseRoomParts(raw, f.halfSize);
      }
    } catch (e) {
      host.say(`Not opened: ${refused ?? (e instanceof Error ? e.message : String(e))}`);
      return;
    }
    show(parts.meta, parts.brushes, what, true);
    if (refused) host.say(`Opened ${what}, which Check room refuses: ${refused}`);
    else if (check) runCheck();
  };

  // --- File ---
  file.addBinding(ui, 'newName', { label: 'room name' });
  file.addBinding(ui, 'width', { label: 'room width (m)', step: 2, min: 2 * minHalf, max: 2 * maxHalf });
  file.addBinding(ui, 'depth', { label: 'room depth (m)', step: 2, min: 2 * minHalf, max: 2 * maxHalf });
  file.addButton({ title: 'New dungeon room' }).on('click', () => {
    if (!host.discardOk()) return;
    if (!/^[A-Za-z0-9-]+$/.test(ui.newName)) return host.say('A room\'s name holds letters, digits and - only.');
    show(newRoomMeta(ui.newName, ui.width, ui.depth), [], `a new dungeon room, ${ui.width} x ${ui.depth} m`, true);
  });
  const names = Object.keys(bundledRooms());
  if (names.length > 0) file.addBinding(ui, 'pick', { label: 'dungeon room', options: Object.fromEntries(names.map((n) => [n, n])) });
  file.addButton({ title: 'Open dungeon room' }).on('click', () => {
    if (!host.discardOk()) return;
    if (!ui.pick) return host.say('No room file is bundled yet (data/delver/rooms/): open one with Open room file…');
    openRoom(bundledRooms()[ui.pick], `dungeon room ${ui.pick}`);
  });
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.addEventListener('change', () => {
    const fl = picker.files?.[0];
    picker.value = '';
    if (!fl) return;
    void fl.text().then((text) => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        return host.say(`Not opened: ${fl.name} is not JSON (${e instanceof Error ? e.message : String(e)})`);
      }
      openRoom(raw, `dungeon room ${fl.name}`);
    });
  });
  file.addButton({ title: 'Open room file…' }).on('click', () => host.discardOk() && picker.click());

  // --- The Room folder (room mode only) ---
  let folder: FolderApi | null = null;
  const rebuildFolder = () => {
    folder?.dispose();
    folder = null;
    if (!meta) return;
    const fo = pane.addFolder({ title: `Room: ${meta.name}`, index: 1 });
    folder = fo;
    fo.addBinding(ui, 'name', { label: 'name' }).on('change', (e) => {
      if (e.value !== meta?.name && /^[A-Za-z0-9-]+$/.test(e.value)) change({ name: e.value });
    });
    const size = () => change({ half: [ui.rw / 2, ui.rd / 2] });
    fo.addBinding(ui, 'rw', { label: 'width (m)', step: 2, min: 2 * minHalf, max: 2 * maxHalf }).on('change', (e) => e.last && size());
    fo.addBinding(ui, 'rd', { label: 'depth (m)', step: 2, min: 2 * minHalf, max: 2 * maxHalf }).on('change', (e) => e.last && size());
    const doors = () => {
      const doorways: Partial<Record<Side, number>> = {};
      for (const d of SIDES) if (ui[`door_${d}`]) doorways[d] = ui[`level_${d}`] as number;
      if (Object.keys(doorways).length === 0) return host.say('A room keeps at least one doorway.');
      change({ doorways });
    };
    for (const d of SIDES) {
      fo.addBinding(ui, `door_${d}`, { label: `${d} doorway` }).on('change', doors);
      fo.addBinding(ui, `level_${d}`, { label: `  ${d} level`, step: 1, min: 0, max: ROOM_DOOR_MAX }).on('change', (e) => e.last && doors());
    }
    const kinds = () => {
      const ks = ROOM_KINDS.filter((k) => ui[`kind_${k}`]) as RoomKind[];
      if (ks.length === 0) return host.say('A room serves at least one kind of Hall.');
      change({ kinds: ks });
    };
    for (const k of ROOM_KINDS) fo.addBinding(ui, `kind_${k}`, { label: k }).on('change', kinds);
    fo.addBinding(ui, 'centre', { label: 'centre', readonly: true });
    fo.addButton({ title: 'Check room' }).on('click', () => runCheck());
    fo.addButton({ title: 'Save room' }).on('click', () => void save());
    fo.addButton({ title: 'Try in a Floor' }).on('click', tryFloor);
    fo.addBinding(ui, 'report', { label: 'Room', readonly: true, multiline: true, rows: 6 });
  };

  const runCheck = () => {
    const raw = rawNow();
    if (!raw || !meta) return;
    host.say(`Checking room ${meta.name}…`);
    setTimeout(() => {
      const check = checkRoom(raw, tuning);
      last = { of: session.source, check };
      ui.report = roomCheckText(meta!.name, check);
      // The traces of frame 0, moved from the check stub's place to the editing stub's.
      const f0 = check.frames[0];
      if (f0 && check.room) {
        const stub = roomStub(check.room, 0, f.passage, tuning.battle.field.size);
        const [ex, ez] = editOrigin(meta!.half);
        const dx = ex - (stub.rect.x0 + stub.rect.x1) / 2;
        const dz = ez - (stub.rect.z0 + stub.rect.z1) / 2;
        const mv = <P extends { x: number; z: number }>(p: P): P => ({ ...p, x: p.x + dx, z: p.z + dz });
        host.showLegs(f0.legs.map((l) => ({ ...l, from: mv(l.from), at: mv(l.at), target: mv(l.target), trace: l.trace.map(mv) })));
      } else host.showLegs([]);
      host.say(check.ok ? `Check room: ${check.issues.length ? `passed with ${check.issues.length} warnings` : 'clean'} (Save may write it).` : `Check room: ${check.issues.filter((i) => i.severity === 'error').length} errors, first: ${check.issues[0]!.message}`);
      host.rebuild();
      syncUi();
    }, 0);
  };

  const save = async () => {
    const raw = rawNow();
    if (!raw || !meta) return;
    if (!last || last.of !== session.source || !last.check.ok) {
      const first = last && last.of === session.source ? last.check.issues.find((i) => i.severity === 'error')?.message : null;
      return host.say(first ? `Not saved: ${first}` : 'Not saved: press Check room on the room as it stands first.');
    }
    const name = meta.name;
    try {
      const result = await saveJsonFile(`${name}.json`, roomFileText(raw));
      if (result === 'cancelled') return host.say('Save cancelled');
      session.markSaved();
      changed = false;
      host.say(result === 'written' ? `Saved data/delver/rooms/${name}.json` : `Downloaded ${name}.json: move it to data/delver/rooms/${name}.json`);
    } catch (e) {
      host.say(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const edited = (): DrawnRoom | null => {
    const raw = rawNow();
    return raw ? checkRoom(raw, tuning, { walk: false }).room : null;
  };
  const tryFloor = () => {
    const room = edited();
    if (!room) return host.say('Try in a Floor wants a room that parses: press Check room to see why it does not.');
    const { seed, floor } = host.floorAsked();
    // The room as edited, in place of the bundled file of its name (unsaved edits included).
    const rooms = [...tuning.delver.floor.drawnRooms.filter((r) => r.name !== room.name), room];
    const t = { ...tuning, delver: { ...tuning.delver, floor: { ...tuning.delver.floor, drawnRooms: rooms } } };
    // The Floor opens over the room (room mode ends once it has opened; a Floor that fails to build leaves the room as it is).
    if ((session.dirty || changed) && !confirm('Try in a Floor opens the Floor in place of this room: discard its unsaved edits? (Save room first to keep them.)')) return;
    host.openFloor(t, seed, floor, room.name);
  };

  return {
    active: () => meta !== null,
    openBundled: (name, check) => {
      const raw = bundledRooms()[name];
      if (raw === undefined) return host.say(`No room file data/delver/rooms/${name}.json is bundled.`);
      openRoom(raw, `dungeon room ${name}`, check);
    },
    edited,
    save: () => void save(),
    dirty: () => meta !== null && changed,
    leave: () => {
      if (!meta) return;
      meta = null;
      session.locked = () => false;
      session.snapStep = null;
      session.blockTop = null;
      host.showLegs([]);
      folder?.dispose();
      folder = null;
    },
  };
}
