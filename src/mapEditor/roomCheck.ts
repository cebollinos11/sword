/**
 * Check room (docs/plans/delver.md, Stage 7g, §5): a drawn room checked alone, as its stub map, in seconds, with no Floor generated. In frame 0 and in
 * one turned and mirrored frame (5), in order:
 *  1. `parseRoom` (the room file's checks);
 *  2. the stub compiled, then `walkCheck`;
 *  3. the navmesh built;
 *  4. the AI walk (`walkAll`, as `&aiwalk=1` walks a Floor): a leg from the centre to 1 m inside each doorway and back, a leg between each pair of
 *     doorways, and a leg from the centre to the middle of each Platform and to the top of each Ramp.
 *
 * A doorway or the centre the AI does not reach is an **error**; a Platform or a Ramp's top it does not reach is a **warning** (a ledge may be meant to be
 * reached by a Jump only). Pure of the DOM; deterministic.
 */
import { navMesh, type NavPoint } from '../sim';
import { walkCheck } from '../sim/levels';
import { LEVEL_RISE } from '../sim/delver/plan';
import { doorwayPoint, type DrawnRoom } from '../tuning/delverRooms';
import type { TuningData } from '../tuning';
import { compileDraft, type DraftMap } from './compile';
import { parseEditedRoom, roomStub } from './room';
import type { NavTarget } from './navProbe';
import { walkAll, type WalkLeg } from './navWalk';
import { SIDES, type MapSource, type Side } from './source';

/** The frames Check room compiles and walks: as drawn, and turned a quarter and mirrored and shifted 1 m on both axes off its doorways' lines (as a Floor shifts a room whose walls would land on even metres). */
export const CHECK_FRAMES = [0, 5] as const;
const CHECK_SHIFT: Readonly<Record<number, readonly [number, number]>> = { 0: [0, 0], 5: [1, 1] };

export interface RoomIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** The frame it was found in; absent for the room file itself. */
  readonly frame?: number;
  /** Where (stub map metres), when there is a place. */
  readonly at?: { readonly x: number; readonly z: number };
}

export interface RoomFrameCheck {
  readonly frame: number;
  readonly source: MapSource;
  readonly draft: DraftMap | null;
  readonly legs: readonly WalkLeg[];
}

export interface RoomCheck {
  /** No error (warnings allowed): Save may write the room. */
  readonly ok: boolean;
  readonly room: DrawnRoom | null;
  readonly issues: readonly RoomIssue[];
  readonly frames: readonly RoomFrameCheck[];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Check the raw room `raw` (a room file) against `tuning`'s Floor; `walk` false skips step 4 (the fast test of every shipped room). */
export function checkRoom(raw: unknown, tuning: TuningData, { walk = true }: { readonly walk?: boolean } = {}): RoomCheck {
  const f = tuning.delver.floor;
  let room: DrawnRoom;
  try {
    room = parseEditedRoom(raw, f.halfSize, f.passage);
  } catch (e) {
    return { ok: false, room: null, issues: [{ severity: 'error', message: msg(e) }], frames: [] };
  }
  const issues: RoomIssue[] = [];
  const frames: RoomFrameCheck[] = [];
  for (const frame of CHECK_FRAMES) {
    const stub = roomStub(room, frame, f.passage, tuning.battle.field.size, CHECK_SHIFT[frame]);
    const at = (s: string) => `frame ${frame}: ${s}`;
    let draft: DraftMap | null = null;
    try {
      draft = compileDraft(stub.source, tuning.battle);
      const bad = walkCheck(draft.arena, tuning.battle.levels);
      if (bad) throw new Error(`the walk check: ${bad}`);
      navMesh(draft.arena, tuning);
    } catch (e) {
      issues.push({ severity: 'error', message: at(msg(e)), frame });
      frames.push({ frame, source: stub.source, draft, legs: [] });
      continue;
    }
    const legs: WalkLeg[] = [];
    if (walk) {
      const fr = stub.room;
      const [cx, cz] = stub.centre;
      const ox = (stub.rect.x0 + stub.rect.x1) / 2;
      const oz = (stub.rect.z0 + stub.rect.z1) / 2;
      const centre: NavTarget = { label: 'the centre', x: cx, z: cz, y: 0 };
      const doors: NavTarget[] = SIDES.flatMap((d: Side) => {
        const lv = fr.doorways[d];
        if (lv === undefined) return [];
        const p = doorwayPoint(fr.half, d, 1, d === 'n' || d === 's' ? -stub.shift[0] : -stub.shift[1]);
        return [{ label: `the ${d} doorway`, x: p.x + ox, z: p.z + oz, y: lv * LEVEL_RISE }];
      });
      const tops: NavTarget[] = fr.brushes.flatMap((b): NavTarget[] => {
        if (b.kind === 'platform') return [{ label: `the middle of Platform ${b.id}`, x: (b.rect.x0 + b.rect.x1) / 2 + ox, z: (b.rect.z0 + b.rect.z1) / 2 + oz, y: b.top }];
        if (b.kind !== 'ramp') return [];
        const r = b.rect;
        const mx = (r.x0 + r.x1) / 2 + ox;
        const mz = (r.z0 + r.z1) / 2 + oz;
        const inset = 0.5;
        const p = b.up === 'n' ? { x: mx, z: r.z1 - inset + oz } : b.up === 's' ? { x: mx, z: r.z0 + inset + oz } : b.up === 'e' ? { x: r.x1 - inset + ox, z: mz } : { x: r.x0 + inset + ox, z: mz };
        const run = b.up === 'n' || b.up === 's' ? r.z1 - r.z0 : r.x1 - r.x0;
        return [{ label: `the top of Ramp ${b.id}`, ...p, y: b.hi - ((b.hi - b.lo) * inset) / run }];
      });
      const leg = (from: NavTarget, to: NavTarget, severity: RoomIssue['severity']) => {
        const [l] = walkAll(tuning, draft!.arena, from as NavPoint, [to]);
        if (!l) return;
        legs.push(l);
        if (l.outcome !== 'arrived') issues.push({ severity, message: at(`the AI walking from ${from.label} to ${to.label}: ${l.outcome === 'noRoute' ? 'no route' : l.outcome}${l.outcome === 'noRoute' ? '' : ` at (${l.at.x.toFixed(1)}, ${l.at.z.toFixed(1)}, ${l.at.y.toFixed(1)} m)`}`), frame, at: { x: l.at.x, z: l.at.z } });
      };
      for (const d of doors) {
        leg(centre, d, 'error');
        leg(d, centre, 'error');
      }
      doors.forEach((a, i) => doors.slice(i + 1).forEach((b) => leg(a, b, 'error')));
      for (const t of tops) leg(centre, t, 'warning');
    }
    frames.push({ frame, source: stub.source, draft, legs });
  }
  return { ok: !issues.some((i) => i.severity === 'error'), room, issues, frames };
}

/** The Map Editor link (on `npm run dev`) that opens the bundled room `name` and checks it. */
export const roomLink = (name: string): string => `http://localhost:5173/sword/#/mapeditor?dev=1&room=${name}&roomcheck=1`;

/** Check room's report as text: one line a problem, then a summary. */
export function roomCheckText(name: string, c: RoomCheck): string {
  const lines = c.issues.map((i) => `    ${i.severity === 'error' ? '✗' : '!'} ${i.message}`);
  const legs = c.frames.reduce((n, f) => n + f.legs.length, 0);
  const arrived = c.frames.reduce((n, f) => n + f.legs.filter((l) => l.outcome === 'arrived').length, 0);
  const head = `${c.ok ? (c.issues.length ? '!' : '✓') : '✗'} room ${name}: ${c.frames.length} frames, ${arrived} of ${legs} AI legs arrived${c.issues.length ? `, ${c.issues.length} problems` : ''}`;
  return [head, ...lines, ...(c.issues.length ? [`    ${roomLink(name)}`] : [])].join('\n');
}
