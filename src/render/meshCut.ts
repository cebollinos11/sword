/**
 * The mesh cut (Dismemberment): a skinned Body's mesh, standing in the pose its Fighter fell in, parted into the pieces
 * its severed bones leave. Pure geometry on plain arrays (no three.js, no DOM), so it is the same cut every time.
 *
 * The Skeleton decides the pieces and the plane decides the boundary: a vertex goes with the bone it is weighted to
 * most, except round a cut (on the severed bone, within reach of where it is cut), where the side of the cut plane it
 * lies on decides. A triangle the plane parts is clipped along it, and the clipped edges are closed with flesh (`capOf`).
 * Everything stays in the posed space: a piece is drawn by binding it to its bones as they stood in that pose.
 */
import type { Vec3 } from '../sim';

/** A skinned mesh as it stands in a pose: per vertex its place and normal (skinned), its UV if it has one, and its four bones and weights. */
export interface PosedMesh {
  readonly position: ArrayLike<number>;
  readonly normal: ArrayLike<number>;
  readonly uv?: ArrayLike<number>;
  readonly skinIndex: ArrayLike<number>;
  readonly skinWeight: ArrayLike<number>;
  readonly index: ArrayLike<number>;
}

/** One severed bone, as the mesh is cut by it. */
export interface BoneCut {
  /** The severed bone, as the mesh's skin numbers it. */
  readonly bone: number;
  /** Bones lying beside it, whose vertices the plane parts like its own within `reach` (the hips, beside the spine). */
  readonly beside?: readonly number[];
  /** Where the bone is cut, and the cut plane's unit normal, turned toward the bone's far end. */
  readonly at: Vec3;
  readonly normal: Vec3;
  /** The bone's own direction (unit, toward its far end): beyond `reach` of the cut, what lies further along it is past the cut. */
  readonly along: Vec3;
  /** How far from `at` the plane still decides (m): the limb's girth and some. */
  readonly reach: number;
  /** The piece on the bone's near side of the cut, and the one on its far side. */
  readonly pieces: readonly [number, number];
}

/** How a mesh is parted: each skin bone's piece (a severed bone's own entry is not used), the cuts, and how many pieces there are. */
export interface CutPlan {
  readonly pieceOfBone: readonly number[];
  readonly cuts: readonly BoneCut[];
  readonly pieces: number;
}

/** A clipped edge of a piece, lying in the plane of `cut`: two of the piece's vertices. */
export interface RimEdge {
  readonly cut: number;
  readonly a: number;
  readonly b: number;
}

/**
 * One piece of a cut mesh, in the posed space. Every vertex is weighted only to the piece's own bones (a severed bone
 * belongs to both its pieces). `from`: the vertex of the whole mesh each came from, -1 for one the cut made.
 */
export interface PieceMesh {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv?: Float32Array;
  readonly skinIndex: Uint16Array;
  readonly skinWeight: Float32Array;
  readonly index: Uint32Array;
  readonly from: Int32Array;
  readonly rim: readonly RimEdge[];
}

/** Vertices closer than this (m) are at one place: where a mesh joins itself across split vertices, and where rims meet in a loop. */
const WELD = 1e-4;

/** A vertex of another bone with less weight than this on a severed bone is not on its limb: it stays with its own bone's piece. */
const ON_BONE = 0.3;

/**
 * Skin a mesh on the CPU: each vertex and normal as `matrices` (16 numbers per bone, column-major, as three.js keeps
 * them: the bone's world matrix times its inverse bind matrix) place it. Normals come out unit length.
 */
export function skinned(mesh: Pick<PosedMesh, 'position' | 'normal' | 'skinIndex' | 'skinWeight'>, matrices: ArrayLike<number>): { position: Float32Array; normal: Float32Array } {
  const count = mesh.position.length / 3;
  const position = new Float32Array(3 * count);
  const normal = new Float32Array(3 * count);
  const m = new Float64Array(12);
  for (let v = 0; v < count; v++) {
    m.fill(0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.skinWeight[4 * v + k]!;
      if (w === 0) continue;
      total += w;
      const o = 16 * mesh.skinIndex[4 * v + k]!;
      // Rows 0 to 2 of the blended matrix (the fourth is 0 0 0 1).
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) m[4 * r + c] = m[4 * r + c]! + w * matrices[o + 4 * c + r]!;
    }
    const x = mesh.position[3 * v]!;
    const y = mesh.position[3 * v + 1]!;
    const z = mesh.position[3 * v + 2]!;
    const nx = mesh.normal[3 * v]!;
    const ny = mesh.normal[3 * v + 1]!;
    const nz = mesh.normal[3 * v + 2]!;
    // An unweighted vertex stays where it is.
    if (total === 0) {
      position.set([x, y, z], 3 * v);
      normal.set([nx, ny, nz], 3 * v);
      continue;
    }
    const out = [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      position[3 * v + r] = (m[4 * r]! * x + m[4 * r + 1]! * y + m[4 * r + 2]! * z + m[4 * r + 3]!) / total;
      out[r] = m[4 * r]! * nx + m[4 * r + 1]! * ny + m[4 * r + 2]! * nz;
    }
    const l = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
    normal.set([out[0]! / l, out[1]! / l, out[2]! / l], 3 * v);
  }
  return { position, normal };
}

/** A piece being filled. */
class Builder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly skinIndex: number[] = [];
  readonly skinWeight: number[] = [];
  readonly index: number[] = [];
  readonly from: number[] = [];
  readonly rim: RimEdge[] = [];
  /** Where each vertex of the whole mesh went in this piece (by the vertex and the one it is skinned as), and each clipped edge's new vertex. */
  readonly copies = new Map<number, number>();
  readonly clipped = new Map<string, number>();

  constructor(
    /** For each skin bone, the bone of this piece that takes its weight (itself, when it is the piece's own). */
    private readonly takes: readonly number[],
  ) {}

  /** Add a vertex, its weights moved onto this piece's own bones; returns its number. */
  add(position: readonly number[], normal: readonly number[], uv: readonly number[] | undefined, bones: readonly number[], weights: readonly number[], from: number): number {
    const n = this.from.length;
    this.position.push(position[0]!, position[1]!, position[2]!);
    this.normal.push(normal[0]!, normal[1]!, normal[2]!);
    if (uv) this.uv.push(uv[0]!, uv[1]!);
    // Weights to the same bone (after the move) add up; the four heaviest are kept, summing to 1.
    const own = new Map<number, number>();
    bones.forEach((b, k) => weights[k]! > 0 && own.set(this.takes[b] ?? b, (own.get(this.takes[b] ?? b) ?? 0) + weights[k]!));
    const kept = [...own].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const total = kept.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.skinIndex.push(kept[k]?.[0] ?? 0);
      this.skinWeight.push((kept[k]?.[1] ?? 0) / total);
    }
    this.from.push(from);
    return n;
  }

  build(hasUv: boolean): PieceMesh {
    return {
      position: new Float32Array(this.position),
      normal: new Float32Array(this.normal),
      ...(hasUv ? { uv: new Float32Array(this.uv) } : {}),
      skinIndex: new Uint16Array(this.skinIndex),
      skinWeight: new Float32Array(this.skinWeight),
      index: new Uint32Array(this.index),
      from: new Int32Array(this.from),
      rim: this.rim,
    };
  }
}

/**
 * For each piece, the bone of its own that takes each skin bone's weight: the bone itself when it is the piece's (a
 * severed bone is both its pieces'), else the severed bone the piece is cut by on the way to that bone's piece, so a
 * vertex never hangs on a bone that fell with another piece.
 */
function takers(plan: CutPlan, bones: number): number[][] {
  const { cuts, pieceOfBone } = plan;
  const cutOf = new Map(cuts.map((c, k) => [c.bone, k]));
  return Array.from({ length: plan.pieces }, (_, piece) => {
    // The first cut on the way from this piece to every other (the pieces are a tree, joined by the cuts).
    const first = new Map<number, number>();
    const open = [piece];
    const seen = new Set(open);
    while (open.length > 0) {
      const p = open.shift()!;
      cuts.forEach((c, k) => {
        const other = c.pieces[0] === p ? c.pieces[1] : c.pieces[1] === p ? c.pieces[0] : -1;
        if (other < 0 || seen.has(other)) return;
        seen.add(other);
        first.set(other, first.get(p) ?? k);
        open.push(other);
      });
    }
    return Array.from({ length: bones }, (_, b) => {
      const k = cutOf.get(b);
      const home = k === undefined ? (pieceOfBone[b] ?? 0) : cuts[k]!.pieces.includes(piece) ? piece : cuts[k]!.pieces[0];
      if (home === piece) return b;
      const through = first.get(home);
      return through === undefined ? b : cuts[through]!.bone;
    });
  });
}

/**
 * Part `mesh` into `plan.pieces` pieces along the planes of its cuts. Every triangle ends up in exactly one piece,
 * whole or clipped, so no area is lost or made; each clipped edge is in its piece's `rim`, for
 * `capOf` to close.
 */
export function cutMesh(mesh: PosedMesh, plan: CutPlan): PieceMesh[] {
  const { cuts } = plan;
  const count = mesh.position.length / 3;
  let bones = plan.pieceOfBone.length;
  for (let i = 0; i < mesh.skinIndex.length; i++) bones = Math.max(bones, mesh.skinIndex[i]! + 1);
  const takes = takers(plan, bones);
  const builders = takes.map((t) => new Builder(t));
  const cutOf = new Map(cuts.map((c, k) => [c.bone, k]));
  /** The cut whose plane parts each bone's vertices: its own bone's, and those of the bones beside it. */
  const partedBy = new Map(cuts.flatMap((c, k) => [c.bone, ...(c.beside ?? [])].map((b) => [b, k] as const)));

  const at = (v: number): number[] => [mesh.position[3 * v]!, mesh.position[3 * v + 1]!, mesh.position[3 * v + 2]!];
  /** How far vertex `v` is past the plane of cut `k`. */
  const past = (v: number, k: number): number => {
    const c = cuts[k]!;
    return (mesh.position[3 * v]! - c.at.x) * c.normal.x + (mesh.position[3 * v + 1]! - c.at.y) * c.normal.y + (mesh.position[3 * v + 2]! - c.at.z) * c.normal.z;
  };
  const near = (v: number, k: number): boolean => {
    const c = cuts[k]!;
    return Math.hypot(mesh.position[3 * v]! - c.at.x, mesh.position[3 * v + 1]! - c.at.y, mesh.position[3 * v + 2]! - c.at.z) <= c.reach;
  };

  /**
   * The side of cut `k` vertex `v` is on (1: past it): the plane's, within reach; further off the plane has no say (a
   * bent limb may come back across it), and what is further along the bone is past the cut.
   */
  const sideOf = (v: number, k: number): 0 | 1 => {
    if (near(v, k)) return past(v, k) >= 0 ? 1 : 0;
    const c = cuts[k]!;
    return (mesh.position[3 * v]! - c.at.x) * c.along.x + (mesh.position[3 * v + 1]! - c.at.y) * c.along.y + (mesh.position[3 * v + 2]! - c.at.z) * c.along.z >= 0 ? 1 : 0;
  };

  // Each vertex's piece: its heaviest bone's, the cut plane deciding on a severed bone's limb.
  const pieceOf = new Int32Array(count);
  for (let v = 0; v < count; v++) {
    let heaviest = 0;
    for (let k = 1; k < 4; k++) if (mesh.skinWeight[4 * v + k]! > mesh.skinWeight[4 * v + heaviest]!) heaviest = k;
    const bone = mesh.skinIndex[4 * v + heaviest]!;
    const own = partedBy.get(bone);
    let piece = plan.pieceOfBone[bone] ?? 0;
    // A bone beside the severed one is parted only within reach of the cut.
    if (own !== undefined && (bone === cuts[own]!.bone || near(v, own))) piece = cuts[own]!.pieces[sideOf(v, own)];
    // A vertex of a neighbouring bone that is also on a severed bone's limb, and across its cut from its own piece.
    for (let k = 0; k < 4; k++) {
      const other = cutOf.get(mesh.skinIndex[4 * v + k]!);
      if (other === undefined || other === own || mesh.skinWeight[4 * v + k]! < ON_BONE || !near(v, other)) continue;
      const side = past(v, other) >= 0 ? 1 : 0;
      if (piece === cuts[other]!.pieces[1 - side]) piece = cuts[other]!.pieces[side];
    }
    pieceOf[v] = piece;
  }

  const hasUv = mesh.uv !== undefined;
  const skin = (v: number): { bones: number[]; weights: number[] } => ({
    bones: [0, 1, 2, 3].map((k) => mesh.skinIndex[4 * v + k]!),
    weights: [0, 1, 2, 3].map((k) => mesh.skinWeight[4 * v + k]!),
  });
  /**
   * Vertex `v`'s bones and weights as piece `p` holds it. What is left of a severed bone in a piece holds nothing that
   * lies beyond its cut end (cloth hanging between the legs must not swing with the stump of a thigh): such a vertex
   * keeps only its other bones, if it has any.
   */
  const held = (p: number, v: number): { bones: number[]; weights: number[] } => {
    const s = skin(v);
    const weights = s.weights.map((w, k) => {
      const through = cutOf.get(takes[p]![s.bones[k]!] ?? -1);
      if (through === undefined) return w;
      const c = cuts[through]!;
      return c.pieces[sideOf(v, through)] === p || !c.pieces.includes(p) ? w : 0;
    });
    return weights.some((w) => w > 0) ? { bones: s.bones, weights } : s;
  };
  /** Vertex `v` of the whole mesh in piece `p` (copied in the first time), skinned as vertex `like`. */
  const copy = (p: number, v: number, like = v): number => {
    const b = builders[p]!;
    const key = v * count + like;
    let n = b.copies.get(key);
    if (n === undefined) {
      const s = held(p, like);
      n = b.add(at(v), [mesh.normal[3 * v]!, mesh.normal[3 * v + 1]!, mesh.normal[3 * v + 2]!], hasUv ? [mesh.uv![2 * v]!, mesh.uv![2 * v + 1]!] : undefined, s.bones, s.weights, v);
      b.copies.set(key, n);
    }
    return n;
  };
  /** The vertex where the edge from `u` to `v` crosses the plane of cut `k`, in piece `p` (made the first time). */
  const crossing = (p: number, k: number, u: number, v: number): number => {
    const b = builders[p]!;
    const [lo, hi] = u < v ? [u, v] : [v, u];
    const key = `${k}:${lo}:${hi}`;
    let n = b.clipped.get(key);
    if (n === undefined) {
      const dl = past(lo, k);
      const t = dl / (dl - past(hi, k));
      const mix = (a: ArrayLike<number>, size: number): number[] => Array.from({ length: size }, (_, c) => a[size * lo + c]! + (a[size * hi + c]! - a[size * lo + c]!) * t);
      const normal = mix(mesh.normal, 3);
      const l = Math.hypot(normal[0]!, normal[1]!, normal[2]!) || 1;
      const a = skin(lo);
      const z = skin(hi);
      n = b.add(mix(mesh.position, 3), normal.map((c) => c / l), hasUv ? mix(mesh.uv!, 2) : undefined, [...a.bones, ...z.bones], [...a.weights.map((w) => w * (1 - t)), ...z.weights.map((w) => w * t)], -1);
      b.clipped.set(key, n);
    }
    return n;
  };

  for (let i = 0; i + 2 < mesh.index.length; i += 3) {
    const tri = [mesh.index[i]!, mesh.index[i + 1]!, mesh.index[i + 2]!];
    const ps = tri.map((v) => pieceOf[v]!);
    if (ps[0] === ps[1] && ps[1] === ps[2]) {
      builders[ps[0]!]!.index.push(...tri.map((v) => copy(ps[0]!, v)));
      continue;
    }
    // The cut that parts its pieces, with every corner on its own piece's side of the plane.
    const k = cuts.findIndex((c, n) => tri.every((v, j) => c.pieces[past(v, n) >= 0 ? 1 : 0] === ps[j]));
    if (k < 0) {
      // No plane parts it (a corner off the limb, where the weights and the plane disagree): it goes whole to the piece
      // most of it is in, a corner from another piece moving as one that is in it does, so it never stretches.
      const most = ps[1] === ps[2] ? ps[1]! : ps[0]!;
      const own = tri[ps.indexOf(most)]!;
      builders[most]!.index.push(...tri.map((v, j) => (ps[j] === most ? copy(most, v) : copy(most, v, own))));
      continue;
    }
    // Turn it so corner 0 is alone on its side: that corner's piece gets a triangle, the other a quad, and both the new edge.
    const side = tri.map((v) => (past(v, k) >= 0 ? 1 : 0));
    const lone = side[0] !== side[1] && side[0] !== side[2] ? 0 : side[1] !== side[0] && side[1] !== side[2] ? 1 : 2;
    const [a, b, c] = [tri[lone]!, tri[(lone + 1) % 3]!, tri[(lone + 2) % 3]!];
    const one = cuts[k]!.pieces[side[lone]!]!;
    const two = cuts[k]!.pieces[1 - side[lone]!]!;
    const ab = crossing(one, k, a, b);
    const ac = crossing(one, k, a, c);
    builders[one]!.index.push(copy(one, a), ab, ac);
    builders[one]!.rim.push({ cut: k, a: ab, b: ac });
    const ba = crossing(two, k, a, b);
    const ca = crossing(two, k, a, c);
    builders[two]!.index.push(ba, copy(two, b), copy(two, c), ba, copy(two, c), ca);
    builders[two]!.rim.push({ cut: k, a: ba, b: ca });
  }
  return builders.map((b) => b.build(hasUv));
}

/** A part of a piece that a cut clipped, and that reaches no further from it than this share of the cut's `reach` (about the limb's girth), is a scrap. */
const SCRAP = 1 / 3;

/** Where vertex `v` of `mesh` is, to the nearest `WELD`: the same for vertices at one place. */
const placeOf = (mesh: PieceMesh, v: number): string => `${Math.round(mesh.position[3 * v]! / WELD)},${Math.round(mesh.position[3 * v + 1]! / WELD)},${Math.round(mesh.position[3 * v + 2]! / WELD)}`;

/**
 * Piece `piece` without its scraps: `meshes` are that piece of every mesh of the Body. A scrap is a part joined to
 * nothing else (by where its vertices are, so a mesh's split vertices still join, and one mesh joins the next: a shell
 * made of two materials is one part), clipped by one of the piece's cuts and lying wholly within `SCRAP` of that cut's
 * reach from its plane. The hem of a cape the plane just clips would otherwise hang in the air as a thin ring, rigid
 * with the body it fell away from. Its triangles and clipped edges are dropped (its vertices stay, unused).
 */
export function dropScraps(meshes: readonly PieceMesh[], plan: CutPlan, piece: number): PieceMesh[] {
  // One numbering for the vertices of every mesh.
  const first: number[] = [];
  let count = 0;
  for (const mesh of meshes) {
    first.push(count);
    count += mesh.from.length;
  }
  const part = Array.from({ length: count }, (_, v) => v);
  const find = (v: number): number => {
    while (part[v] !== v) v = part[v] = part[part[v]!]!;
    return v;
  };
  const places = new Map<string, number>();
  meshes.forEach((mesh, m) => {
    for (let v = 0; v < mesh.from.length; v++) {
      const key = placeOf(mesh, v);
      const same = places.get(key);
      if (same === undefined) places.set(key, first[m]! + v);
      else part[find(first[m]! + v)] = find(same);
    }
    for (let i = 0; i < mesh.index.length; i += 3) {
      part[find(first[m]! + mesh.index[i]!)] = find(first[m]! + mesh.index[i + 2]!);
      part[find(first[m]! + mesh.index[i + 1]!)] = find(first[m]! + mesh.index[i + 2]!);
    }
  });
  // How far each part reaches from each cut that clipped it (a part no cut clipped is no scrap, however small).
  const reach = new Map<number, Map<number, number>>();
  meshes.forEach((mesh, m) => {
    for (const e of mesh.rim) {
      const root = find(first[m]! + e.a);
      if (!reach.has(root)) reach.set(root, new Map());
      reach.get(root)!.set(e.cut, 0);
    }
  });
  meshes.forEach((mesh, m) => {
    for (let v = 0; v < mesh.from.length; v++) {
      const far = reach.get(find(first[m]! + v));
      if (!far) continue;
      for (const k of far.keys()) {
        const c = plan.cuts[k]!;
        far.set(k, Math.max(far.get(k)!, Math.abs((mesh.position[3 * v]! - c.at.x) * c.normal.x + (mesh.position[3 * v + 1]! - c.at.y) * c.normal.y + (mesh.position[3 * v + 2]! - c.at.z) * c.normal.z)));
      }
    }
  });
  const scraps = new Set<number>();
  for (const [root, far] of reach) for (const [k, d] of far) if (plan.cuts[k]!.pieces.includes(piece) && d <= plan.cuts[k]!.reach * SCRAP) scraps.add(root);
  if (scraps.size === 0) return [...meshes];
  return meshes.map((mesh, m) => {
    const scrap = (v: number): boolean => scraps.has(find(first[m]! + v));
    return { ...mesh, index: mesh.index.filter((_, i) => !scrap(mesh.index[i - (i % 3)]!)), rim: mesh.rim.filter((e) => !scrap(e.a)) };
  });
}

/** A chain of clipped edges whose loose ends are further apart than this share of its length is not a loop. */
const OPEN = 0.25;

/**
 * The flesh closing piece `piece`'s cut ends: `meshes` are that piece of every mesh of the Body (their rims run on
 * through each other, cloth into skin). The clipped edges of each cut are chained into loops where their ends meet, and
 * each loop is fanned from its middle, facing out of the piece along the cut's normal; a chain left open by more than
 * `OPEN` of its length (the edge of a tabard, not the section of a limb) closes nothing and gets no flesh. No UV; its centres ride on the
 * severed bone, its rim as the vertices it closes. Null when the piece has no clipped edge.
 */
export function capOf(meshes: readonly PieceMesh[], plan: CutPlan, piece: number): PieceMesh | null {
  const position: number[] = [];
  const normal: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  plan.cuts.forEach((cut, k) => {
    if (!cut.pieces.includes(piece)) return;
    // The cap of the near piece faces the far one, and the other way round.
    const out = cut.pieces[0] === piece ? 1 : -1;
    const n = [cut.normal.x * out, cut.normal.y * out, cut.normal.z * out];
    // Every clipped edge of this cut, its ends welded by where they are.
    const edges: { mesh: PieceMesh; a: number; b: number; ends: [number, number] }[] = [];
    const points = new Map<string, number>();
    const loop: number[] = [];
    const find = (p: number): number => {
      while (loop[p] !== p) p = loop[p] = loop[loop[p]!]!;
      return p;
    };
    const where: number[][] = [];
    /** How many edges end at each point: a loose end of a chain has an odd number. */
    const counts: number[] = [];
    const point = (mesh: PieceMesh, v: number): number => {
      const key = placeOf(mesh, v);
      let p = points.get(key);
      if (p === undefined) {
        p = loop.length;
        loop.push(p);
        points.set(key, p);
        where.push([mesh.position[3 * v]!, mesh.position[3 * v + 1]!, mesh.position[3 * v + 2]!]);
        counts.push(0);
      }
      return p;
    };
    for (const mesh of meshes) {
      for (const e of mesh.rim) {
        if (e.cut !== k) continue;
        const ends: [number, number] = [point(mesh, e.a), point(mesh, e.b)];
        if (ends[0] === ends[1]) continue;
        loop[find(ends[0])] = find(ends[1]);
        edges.push({ mesh, a: e.a, b: e.b, ends });
        counts[ends[0]] = counts[ends[0]]! + 1;
        counts[ends[1]] = counts[ends[1]]! + 1;
      }
    }
    // Each loop's middle: the mean of its edges' midpoints, by length.
    const middles = new Map<number, { sum: number[]; length: number; vertex: number; gap: number }>();
    const place = (e: (typeof edges)[number], v: number): number[] => [e.mesh.position[3 * v]!, e.mesh.position[3 * v + 1]!, e.mesh.position[3 * v + 2]!];
    for (const e of edges) {
      const a = place(e, e.a);
      const b = place(e, e.b);
      const length = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
      const root = find(e.ends[0]);
      const m = middles.get(root) ?? { sum: [0, 0, 0], length: 0, vertex: -1, gap: 0 };
      for (let c = 0; c < 3; c++) m.sum[c] = m.sum[c]! + ((a[c]! + b[c]!) / 2) * length;
      m.length += length;
      middles.set(root, m);
    }
    const push = (p: readonly number[], bones: readonly number[], weights: readonly number[]): number => {
      position.push(p[0]!, p[1]!, p[2]!);
      normal.push(n[0]!, n[1]!, n[2]!);
      skinIndex.push(bones[0]!, bones[1]!, bones[2]!, bones[3]!);
      skinWeight.push(weights[0]!, weights[1]!, weights[2]!, weights[3]!);
      return position.length / 3 - 1;
    };
    // How far open each chain is: from each loose end to the nearest other one of its chain, each gap counted from both its ends.
    const loose = counts.flatMap((n, p) => (n % 2 === 1 ? [p] : []));
    for (const p of loose) {
      let nearest = Infinity;
      for (const q of loose) if (q !== p && find(q) === find(p)) nearest = Math.min(nearest, Math.hypot(where[p]![0]! - where[q]![0]!, where[p]![1]! - where[q]![1]!, where[p]![2]! - where[q]![2]!));
      const m = middles.get(find(p));
      if (m) m.gap += nearest / 2;
    }
    for (const m of middles.values()) if (m.gap <= OPEN * m.length) m.vertex = push(m.sum.map((s) => s / m.length), [cut.bone, 0, 0, 0], [1, 0, 0, 0]);
    for (const e of edges) {
      const centre = middles.get(find(e.ends[0]))!.vertex;
      if (centre < 0) continue;
      const corners = [e.a, e.b].map((v) => push(place(e, v), [0, 1, 2, 3].map((c) => e.mesh.skinIndex[4 * v + c]!), [0, 1, 2, 3].map((c) => e.mesh.skinWeight[4 * v + c]!)));
      // Wound to face along `n`.
      const o = 3 * centre;
      const u = [0, 1, 2].map((c) => position[3 * corners[0]! + c]! - position[o + c]!);
      const w = [0, 1, 2].map((c) => position[3 * corners[1]! + c]! - position[o + c]!);
      const facing = (u[1]! * w[2]! - u[2]! * w[1]!) * n[0]! + (u[2]! * w[0]! - u[0]! * w[2]!) * n[1]! + (u[0]! * w[1]! - u[1]! * w[0]!) * n[2]!;
      if (facing >= 0) index.push(centre, corners[0]!, corners[1]!);
      else index.push(centre, corners[1]!, corners[0]!);
    }
  });
  if (index.length === 0) return null;
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    skinIndex: new Uint16Array(skinIndex),
    skinWeight: new Float32Array(skinWeight),
    index: new Uint32Array(index),
    from: new Int32Array(position.length / 3).fill(-1),
    rim: [],
  };
}
