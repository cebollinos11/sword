/**
 * Half-turn mirror mode (docs/plans/map-editor.md, Stage 6; ADR 0022, "The map is its own half turn"): a Battle map is fair when it is its
 * own half turn about the field's centre, as the two armies are. In a mirrored Map Source (`mirror: true`) each Brush, Objective and prop
 * placed gets a **twin**, its half turn (x, z → -x, -z: a Ramp's `up` and rails and an Enclosure's doorways turn with it, an Objective's starting Owner and a banner's
 * Team swap, a prop turns 180°), and the two are edited together; the two Bases are each other's twins. One placed at the centre's own
 * half turn (a centred rectangle, a segment through the centre, a point on it) is its own twin.
 *
 * The link is stored in the source (`twin`, the other's id, on each of the pair; its own id on one that is its own twin). This module holds
 * what the session, the compiler and the checks share: the half turn of each part, whether two parts are each other's (ids and links
 * aside), and the **mirrored order** a list is compiled in, so that Objective k mirrors Objective n - 1 - k and Block k mirrors Block n - 1 - k.
 * Pure and exact: a half turn only negates grid coordinates, so a part and its twin's twin are the same numbers.
 */
import { SIDES, type Brush, type GroundPoint, type MapSource, type Rect, type Side, type SourceObjective, type SourceProp } from './source';

/** A side or direction turned half round: north and south, east and west. */
export const TURNED: Readonly<Record<Side, Side>> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** `-v`, with no negative zero (so a part on the centre line writes the same JSON as its twin). */
const neg = (v: number): number => (v === 0 ? 0 : -v);

export const turnPoint = (p: GroundPoint): GroundPoint => ({ x: neg(p.x), z: neg(p.z) });
export const turnRect = (r: Rect): Rect => ({ x0: neg(r.x1), z0: neg(r.z1), x1: neg(r.x0), z1: neg(r.z0) });

/** The half turn of a Brush, keeping its id, link and material: a rectangle turned, a segment's ends turned (a stays a), a Ramp's `up` and rails turned. */
export function turnBrush<B extends Brush>(b: B): B {
  if (b.kind === 'rail' || b.kind === 'wall') return { ...b, a: turnPoint(b.a), b: turnPoint(b.b) };
  if (b.kind === 'ramp') return { ...b, rect: turnRect(b.rect), up: TURNED[b.up], rails: SIDES.filter((s) => b.rails.includes(TURNED[s])) };
  if (b.kind === 'enclosure') {
    // Each doorway to the side it turns to, in the sides' order (so a twin writes the same JSON).
    const doors = Object.fromEntries(SIDES.filter((s) => b.doors[TURNED[s]] !== undefined).map((s) => [s, b.doors[TURNED[s]]!]));
    return { ...b, rect: turnRect(b.rect), doors };
  }
  return { ...b, rect: turnRect((b as Extract<Brush, { rect: Rect }>).rect) };
}

/** The half turn of an Objective: its point turned, its starting Owner the other Team's (none stays none); weight, spawn and `y` kept. */
export const turnObjective = (o: SourceObjective): SourceObjective => ({ ...o, x: neg(o.x), z: neg(o.z), owner: o.owner === -1 ? -1 : o.owner === 0 ? 1 : 0 });

/** The half turn of a prop: its point turned, facing the other way, a banner in the other Team's colour. */
export function turnProp(p: SourceProp): SourceProp {
  const turned = { ...p, x: neg(p.x), z: neg(p.z), turn: (p.turn + 180) % 360 };
  return p.team === undefined ? turned : { ...turned, team: p.team === 0 ? 1 : 0 };
}

/** A part's shape alone: its id, link and material left out (a material is render-only, and a twin's always follows). */
export function shape(v: { readonly id: string }): string {
  const { id: _id, twin: _twin, material: _material, ...rest } = v as { id: string; twin?: string; material?: string };
  return canonical(rest);
}

/** JSON with every object's keys in one order, so two parts built in different orders compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** Whether `b` is `a`'s half turn, ids and links aside (a Rail's or Wall's ends either way round: they stand the same Wall). */
export function brushesTwin(a: Brush, b: Brush): boolean {
  const t = turnBrush(a);
  if (shape(t) === shape(b)) return true;
  return (t.kind === 'rail' || t.kind === 'wall') && shape({ ...t, a: t.b, b: t.a } as Brush) === shape(b);
}
export const objectivesTwin = (a: SourceObjective, b: SourceObjective): boolean => shape(turnObjective(a)) === shape(b);
export const propsTwin = (a: SourceProp, b: SourceProp): boolean => shape(turnProp(a)) === shape(b);
export const basesTwin = (bases: MapSource['bases']): boolean => bases[1].x === neg(bases[0].x) && bases[1].z === neg(bases[0].z);

/** What differs between a part and its twin's half turn: the first key whose value is not the half turn's, for a message. */
export function twinDifference<T extends object>(a: T, b: T, turn: (v: T) => T): string {
  const t = turn(a) as Record<string, unknown>;
  const o = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(t), ...Object.keys(o)])) {
    if (k === 'id' || k === 'twin' || k === 'material') continue;
    if (canonical(t[k]) !== canonical(o[k])) return k;
  }
  return '';
}

/** A list item a twin link joins: its id, and its twin's id (absent: none; its own: its own twin). */
interface Linked {
  readonly id: string;
  readonly twin?: string;
}

/**
 * The mirrored order of a list (Objectives, Blocks), as the indices of `items`: the first of each twin pair in the order the list gives
 * them, then the parts that are their own twins (or have none) in the list's order, then the pairs' second parts in the reverse order of
 * their firsts. So item k and item n - 1 - k are twins wherever both are paired, and a list already in that order is left as it is.
 */
export function mirrorOrder(items: readonly Linked[]): number[] {
  const index = new Map(items.map((v, i) => [v.id, i]));
  const firsts: number[] = [];
  const middle: number[] = [];
  const second = new Map<number, number>();
  const placed = new Set<number>();
  items.forEach((v, i) => {
    if (placed.has(i)) return;
    placed.add(i);
    const t = v.twin === undefined ? undefined : index.get(v.twin);
    if (t === undefined || t === i || placed.has(t)) {
      middle.push(i);
      return;
    }
    placed.add(t);
    firsts.push(i);
    second.set(i, t);
  });
  return [...firsts, ...middle, ...[...firsts].reverse().map((i) => second.get(i)!)];
}

/** `items` in their mirrored order (`mirrorOrder`). */
export const inMirrorOrder = <T extends Linked>(items: readonly T[]): T[] => mirrorOrder(items).map((i) => items[i]!);
