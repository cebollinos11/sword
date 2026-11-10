import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../sim';
import { capOf, cutMesh, dropScraps, skinned, type BoneCut, type CutPlan, type PieceMesh, type PosedMesh } from './meshCut';

const RADIUS = 0.1;
const AROUND = 12;

/**
 * A closed tube up the y axis from 0 to `joints`' last, a ring every 0.125 m, fanned shut at both ends. Its bones run
 * from each of `joints` to the next; a vertex is weighted to the bone it is beside, blending into the next over 0.2 m
 * either side of a joint. UV: (the way round, the height).
 */
function tube(joints: readonly number[]): PosedMesh {
  const top = joints[joints.length - 1]!;
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  const skin = (y: number) => {
    let b = 0;
    while (b < joints.length - 2 && y > joints[b + 1]!) b++;
    // Into the bone above or below, near the joint to it.
    const up = b < joints.length - 2 ? Math.max(0, 0.5 - (joints[b + 1]! - y) / 0.4) : 0;
    const down = b > 0 ? Math.max(0, 0.5 - (y - joints[b]!) / 0.4) : 0;
    skinIndex.push(b, up > 0 ? b + 1 : down > 0 ? b - 1 : 0, 0, 0);
    skinWeight.push(1 - up - down, up + down, 0, 0);
  };
  const rings = Math.round(top / 0.125);
  for (let r = 0; r <= rings; r++) {
    const y = (top * r) / rings;
    for (let a = 0; a < AROUND; a++) {
      const angle = (2 * Math.PI * a) / AROUND;
      position.push(RADIUS * Math.cos(angle), y, RADIUS * Math.sin(angle));
      normal.push(Math.cos(angle), 0, Math.sin(angle));
      uv.push(a / AROUND, y);
      skin(y);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < AROUND; a++) {
      const [p, q] = [r * AROUND + a, r * AROUND + ((a + 1) % AROUND)];
      index.push(p, p + AROUND, q, q, p + AROUND, q + AROUND);
    }
  }
  for (const [y, ring, down] of [[0, 0, true], [top, rings, false]] as const) {
    const centre = position.length / 3;
    position.push(0, y, 0);
    normal.push(0, down ? -1 : 1, 0);
    uv.push(0.5, y);
    skin(y);
    for (let a = 0; a < AROUND; a++) {
      const [p, q] = [ring * AROUND + a, ring * AROUND + ((a + 1) % AROUND)];
      if (down) index.push(centre, p, q);
      else index.push(centre, q, p);
    }
  }
  return { position, normal, uv, skinIndex, skinWeight, index };
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
/** A cut of `bone` at height `y`, its plane tilted, parting `pieces`. */
const cutAt = (bone: number, y: number, pieces: readonly [number, number], tilt = 0.3): BoneCut => ({
  bone,
  at: { x: 0, y, z: 0 },
  normal: unit({ x: tilt, y: 1, z: 0.1 }),
  along: { x: 0, y: 1, z: 0 },
  reach: 0.5,
  pieces,
});

/** Three bones (0 to 0.6, to 1.5, to 2), the middle one severed at 1.05, between two rings. */
const limb = tube([0, 0.6, 1.5, 2]);
const plan: CutPlan = { pieceOfBone: [0, 0, 1], cuts: [cutAt(1, 1.05, [0, 1])], pieces: 2 };

function area(mesh: Pick<PosedMesh, 'position' | 'index'>): number {
  let sum = 0;
  for (let i = 0; i < mesh.index.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((d) => mesh.position[3 * mesh.index[i + k]! + d]!));
    const u = [0, 1, 2].map((d) => b![d]! - a![d]!);
    const v = [0, 1, 2].map((d) => c![d]! - a![d]!);
    sum += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
  }
  return sum;
}

/** How far each vertex is past the plane of `cut`. */
const past = (mesh: PieceMesh, cut: BoneCut): number[] =>
  Array.from({ length: mesh.position.length / 3 }, (_, v) => (mesh.position[3 * v]! - cut.at.x) * cut.normal.x + (mesh.position[3 * v + 1]! - cut.at.y) * cut.normal.y + (mesh.position[3 * v + 2]! - cut.at.z) * cut.normal.z);

/** Each directed edge of `meshes` (by where its ends are) and how often it runs that way. */
function edges(meshes: readonly PieceMesh[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const mesh of meshes) {
    const key = (v: number) => [0, 1, 2].map((c) => Math.round(mesh.position[3 * v + c]! * 1e4)).join(',');
    for (let i = 0; i < mesh.index.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const [a, b] = [key(mesh.index[i + k]!), key(mesh.index[i + ((k + 1) % 3)]!)];
        if (a !== b) count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
      }
    }
  }
  return count;
}

/** Whether every edge is matched by one running the other way: a closed surface, wound one way. */
function closed(meshes: readonly PieceMesh[]): boolean {
  const count = edges(meshes);
  for (const [edge, n] of count) {
    const [a, b] = edge.split('>');
    if (count.get(`${b}>${a}`) !== n) return false;
  }
  return count.size > 0;
}

describe('cutMesh', () => {
  const pieces = cutMesh(limb, plan);

  it('leaves a mesh with no cuts whole', () => {
    const [whole, ...rest] = cutMesh(limb, { pieceOfBone: [0, 0, 0], cuts: [], pieces: 1 });
    expect(rest).toEqual([]);
    // The same triangles of the same vertices (numbered as they were first used).
    expect(Array.from(whole!.index, (v) => whole!.from[v])).toEqual(Array.from(limb.index));
    expect(area(whole!)).toBeCloseTo(area(limb), 6);
    expect(whole!.rim).toEqual([]);
  });

  it('neither loses nor makes any surface', () => {
    expect(pieces).toHaveLength(2);
    expect(area(pieces[0]!) + area(pieces[1]!)).toBeCloseTo(area(limb), 6);
    expect(area(pieces[0]!)).toBeGreaterThan(0.3 * area(limb));
    expect(area(pieces[1]!)).toBeGreaterThan(0.3 * area(limb));
  });

  it('puts every vertex in exactly one piece, and each piece on its own side of the plane', () => {
    const count = limb.position.length / 3;
    const seen = new Int32Array(count);
    pieces.forEach((piece, p) => {
      const d = past(piece, plan.cuts[0]!);
      piece.from.forEach((from, v) => {
        if (from >= 0) {
          seen[from] = seen[from]! + 1;
          // Where it was, on this piece's side.
          expect(Array.from(piece.position.slice(3 * v, 3 * v + 3))).toEqual(Array.from(new Float32Array(Array.prototype.slice.call(limb.position, 3 * from, 3 * from + 3))));
          expect(p === 0 ? d[v]! < 0 : d[v]! >= 0).toBe(true);
        } else expect(d[v]).toBeCloseTo(0, 6);
      });
    });
    expect(Array.from(seen)).toEqual(Array.from({ length: count }, () => 1));
  });

  it('weights every vertex only to bones of its own piece', () => {
    const own = [new Set([0, 1]), new Set([1, 2])];
    pieces.forEach((piece, p) => {
      for (let v = 0; v < piece.from.length; v++) {
        let total = 0;
        for (let k = 0; k < 4; k++) {
          const w = piece.skinWeight[4 * v + k]!;
          total += w;
          if (w > 0) expect(own[p]!.has(piece.skinIndex[4 * v + k]!)).toBe(true);
        }
        expect(total).toBeCloseTo(1, 6);
      }
    });
  });

  it('gives a clipped vertex the UV, normal and weights of where it is on its edge', () => {
    for (const piece of pieces) {
      let made = 0;
      for (let v = 0; v < piece.from.length; v++) {
        if (piece.from[v]! >= 0) continue;
        made++;
        // The tube's UV is (the way round, the height), and its normals point straight out.
        expect(piece.uv![2 * v + 1]).toBeCloseTo(piece.position[3 * v + 1]!, 5);
        expect(Math.hypot(piece.normal[3 * v]!, piece.normal[3 * v + 1]!, piece.normal[3 * v + 2]!)).toBeCloseTo(1, 6);
        expect(piece.normal[3 * v]! * piece.position[3 * v]! + piece.normal[3 * v + 2]! * piece.position[3 * v + 2]!).toBeGreaterThan(0.9 * RADIUS);
        // Cut in the middle of bone 1, well off its joints: all on that bone.
        expect([piece.skinIndex[4 * v], piece.skinWeight[4 * v]]).toEqual([1, 1]);
      }
      expect(made).toBe(2 * AROUND);
    }
  });

  it('closes both cut ends with flesh', () => {
    pieces.forEach((piece, p) => {
      expect(closed([piece])).toBe(false);
      const cap = capOf([piece], plan, p)!;
      expect(closed([piece, cap])).toBe(true);
      const { normal } = plan.cuts[0]!;
      const out = p === 0 ? 1 : -1;
      for (const d of past(cap, plan.cuts[0]!)) expect(d).toBeCloseTo(0, 6);
      for (let v = 0; v < cap.from.length; v++) expect(Array.from(cap.normal.slice(3 * v, 3 * v + 3))).toEqual(Array.from(new Float32Array([normal.x * out, normal.y * out, normal.z * out])));
      // The tube's cross-section, tilted as the plane is.
      const section = (AROUND / 2) * RADIUS * RADIUS * Math.sin((2 * Math.PI) / AROUND);
      expect(area(cap)).toBeCloseTo(section / normal.y, 4);
    });
  });

  it('closes a Body of several meshes whose rims run on through each other', () => {
    // The same tube as two meshes: its even and its odd triangles.
    const half = (odd: number): PosedMesh => ({ ...limb, index: Array.from(limb.index).filter((_, i) => Math.floor(i / 3) % 2 === odd) });
    const halves = [cutMesh(half(0), plan), cutMesh(half(1), plan)];
    for (const p of [0, 1]) {
      const cap = capOf([halves[0]![p]!, halves[1]![p]!], plan, p)!;
      expect(closed([halves[0]![p]!, halves[1]![p]!, cap])).toBe(true);
      // One loop, so one middle.
      expect(cap.from.length).toBe(1 + 2 * 2 * AROUND);
    }
  });

  it('has no flesh for a piece with no cut end', () => {
    const [whole] = cutMesh(limb, { pieceOfBone: [0, 0, 0], cuts: [], pieces: 1 });
    expect(capOf([whole!], { pieceOfBone: [0, 0, 0], cuts: [], pieces: 1 }, 0)).toBeNull();
  });

  it('is the same cut every time', () => {
    expect(cutMesh(limb, plan)).toEqual(pieces);
  });

  it('parts a body cut twice into three, each weighted to its own bones and the severed ones beside it', () => {
    // Five bones, the second and fourth severed: pieces 0 (bones 0, 1), 1 (bones 1, 2, 3) and 2 (bones 3, 4).
    const long = tube([0, 0.5, 1, 1.5, 2, 2.5]);
    const twice: CutPlan = { pieceOfBone: [0, 0, 1, 1, 2], cuts: [cutAt(1, 0.6, [0, 1], 0.1), cutAt(3, 1.9, [1, 2], 0.1)], pieces: 3 };
    const parts = cutMesh(long, twice);
    expect(parts).toHaveLength(3);
    expect(parts.reduce((s, p) => s + area(p), 0)).toBeCloseTo(area(long), 6);
    const own = [new Set([0, 1]), new Set([1, 2, 3]), new Set([3, 4])];
    parts.forEach((piece, p) => {
      for (let i = 0; i < piece.skinWeight.length; i++) if (piece.skinWeight[i]! > 0) expect(own[p]!.has(piece.skinIndex[i]!)).toBe(true);
      expect(closed([piece, capOf([piece], twice, p)!])).toBe(true);
    });
    // The first cut is beside the joint at 0.5, where bone 1's vertices are also weighted to bone 0: in the middle
    // piece that weight has moved onto the severed bone.
    const middle = parts[1]!;
    const low = Array.from(middle.from).findIndex((from) => from >= 0 && long.position[3 * from + 1]! < 0.7);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(long.skinWeight[4 * middle.from[low]! + 1]).toBeGreaterThan(0);
    expect([middle.skinIndex[4 * low], middle.skinWeight[4 * low]]).toEqual([1, 1]);
  });

  it('lets the plane decide only within reach of the cut: further off, what is further along the bone is past it', () => {
    // A steep plane, which the far end of the tube comes back across.
    const steep: BoneCut = { ...cutAt(1, 1.05, [0, 1]), normal: unit({ x: 1, y: 0.35, z: 0 }), reach: 0.3 };
    const one = tube([0, 0.2, 1.8, 2]);
    const parts = cutMesh(one, { pieceOfBone: [0, 0, 1], cuts: [steep], pieces: 2 });
    const heights = (p: PieceMesh) => Array.from(p.from).filter((from) => from >= 0).map((from) => one.position[3 * from + 1]!);
    // Beyond reach every vertex above the cut is past it and every one below is not, whichever side of the plane it is on.
    expect(Math.max(...heights(parts[0]!))).toBeLessThan(1.3);
    expect(Math.min(...heights(parts[1]!))).toBeGreaterThan(0.7);
    expect(parts.reduce((s, p) => s + area(p), 0)).toBeCloseTo(area(one), 6);
  });

  it('keeps a triangle whole where the weights and the plane disagree', () => {
    // A vertex just past the plane, but all on the bone before the cut: its triangles are not clipped, and none is lost.
    const odd = { ...limb, skinIndex: Array.from(limb.skinIndex), skinWeight: Array.from(limb.skinWeight) };
    const v = 9 * AROUND;
    expect(limb.position[3 * v + 1]).toBeCloseTo(1.125, 6);
    odd.skinIndex.splice(4 * v, 4, 0, 0, 0, 0);
    odd.skinWeight.splice(4 * v, 4, 1, 0, 0, 0);
    const parts = cutMesh(odd, plan);
    expect(parts.reduce((s, p) => s + area(p), 0)).toBeCloseTo(area(limb), 6);
    // Each triangle went to the piece most of it is in; in the far piece its weight has moved onto the severed bone.
    const there = Array.from(parts[1]!.from).indexOf(v);
    expect([parts[1]!.skinIndex[4 * there], parts[1]!.skinWeight[4 * there]]).toEqual([1, 1]);
    expect(Array.from(parts[0]!.from)).toContain(v);
    for (let i = 0; i < parts[1]!.skinWeight.length; i++) if (parts[1]!.skinWeight[i]! > 0) expect(parts[1]!.skinIndex[i]).not.toBe(0);
  });

  it('parts the vertices of a bone beside the severed one by the plane too', () => {
    // Cut below the joint, where the tube is still on bone 0 (as the hips are beside the spine at the waist).
    const low = { ...cutAt(1, 0.45, [0, 1]) };
    const ragged = cutMesh(limb, { pieceOfBone: [0, 0, 1], cuts: [low], pieces: 2 });
    expect(Math.max(...past(ragged[0]!, low))).toBeGreaterThan(0.05);
    const beside: CutPlan = { pieceOfBone: [0, 0, 1], cuts: [{ ...low, beside: [0] }], pieces: 2 };
    const clean = cutMesh(limb, beside);
    expect(Math.max(...past(clean[0]!, low))).toBeLessThan(1e-6);
    expect(Math.min(...past(clean[1]!, low))).toBeGreaterThan(-1e-6);
    clean.forEach((piece, p) => expect(closed([piece, capOf([piece], beside, p)!])).toBe(true));
    // Past the cut, bone 0's weight has moved onto the severed bone.
    for (let i = 0; i < clean[1]!.skinWeight.length; i++) if (clean[1]!.skinWeight[i]! > 0) expect(clean[1]!.skinIndex[i]).not.toBe(0);
  });

  it('lets what is left of a severed bone hold nothing beyond its cut end', () => {
    // The far end of the tube, mostly on the bone before the cut (cloth hanging from it) and partly on the severed one.
    const cloth = { ...limb, skinIndex: Array.from(limb.skinIndex), skinWeight: Array.from(limb.skinWeight) };
    const v = 16 * AROUND;
    expect(limb.position[3 * v + 1]).toBeCloseTo(2, 6);
    for (let u = 0; u < limb.position.length / 3; u++) {
      if (limb.position[3 * u + 1]! < 1.8) continue;
      cloth.skinIndex.splice(4 * u, 4, 0, 1, 0, 0);
      cloth.skinWeight.splice(4 * u, 4, 0.6, 0.4, 0, 0);
    }
    const parts = cutMesh(cloth, plan);
    const there = Array.from(parts[0]!.from).indexOf(v);
    expect(there).toBeGreaterThanOrEqual(0);
    expect([parts[0]!.skinIndex[4 * there], parts[0]!.skinWeight[4 * there]]).toEqual([0, 1]);
    expect(parts.reduce((s, p) => s + area(p), 0)).toBeCloseTo(area(limb), 6);
  });

  it('drops the scraps a cut leaves, but nothing the cut did not clip', () => {
    // Two loose bands round the tube, all on the severed bone: one the plane clips, one just clear of it.
    const band = (from: number, to: number): PosedMesh => {
      const position: number[] = [];
      const index: number[] = [];
      for (const y of [from, to]) for (let a = 0; a < AROUND; a++) position.push(1.5 * RADIUS * Math.cos((2 * Math.PI * a) / AROUND), y, 1.5 * RADIUS * Math.sin((2 * Math.PI * a) / AROUND));
      for (let a = 0; a < AROUND; a++) index.push(a, a + AROUND, (a + 1) % AROUND, (a + 1) % AROUND, a + AROUND, ((a + 1) % AROUND) + AROUND);
      const count = 2 * AROUND;
      return { position, normal: position.map((c, i) => (i % 3 === 1 ? 0 : c / (1.5 * RADIUS))), uv: new Array(2 * count).fill(0), skinIndex: new Array(4 * count).fill(1), skinWeight: Array.from({ length: 4 * count }, (_, i) => (i % 4 === 0 ? 1 : 0)), index };
    };
    const join = (a: PosedMesh, b: PosedMesh): PosedMesh => {
      const n = a.position.length / 3;
      const cat = (key: 'position' | 'normal' | 'uv' | 'skinIndex' | 'skinWeight') => [...Array.from(a[key]!), ...Array.from(b[key]!)];
      return { position: cat('position'), normal: cat('normal'), uv: cat('uv'), skinIndex: cat('skinIndex'), skinWeight: cat('skinWeight'), index: [...Array.from(a.index), ...Array.from(b.index, (i) => i + n)] };
    };
    const clippedBand = band(1, 1.1);
    const clearBand = band(1.2, 1.25);
    // As two meshes (as a Body's materials are): the tube with the clear band, and the clipped band.
    const cut = [cutMesh(join(limb, clearBand), plan), cutMesh(clippedBand, plan)];
    [0, 1].forEach((p) => {
      const kept = dropScraps([cut[0]![p]!, cut[1]![p]!], plan, p);
      // The clipped band is gone, rim and all; the clear one is kept, and the tube is whole and closed as before.
      expect(area(kept[1]!)).toBe(0);
      expect(kept[1]!.rim).toEqual([]);
      expect(area(kept[0]!)).toBeCloseTo(area(cut[0]![p]!), 6);
      expect(area(capOf(kept, plan, p)!)).toBeCloseTo(area(capOf([pieces[p]!], plan, p)!), 6);
    });
    expect(area(cut[0]![0]!) + area(cut[0]![1]!)).toBeCloseTo(area(limb) + area(clearBand), 6);
  });

  it('keeps a clipped strip that is joined to another mesh of the Body', () => {
    // The tube as two meshes, split at the ring above the cut: the short clipped strip below it is no scrap, being one shell with the rest.
    const split = 9 * AROUND * 6;
    const lower: PosedMesh = { ...limb, index: Array.from(limb.index).slice(0, split) };
    const upper: PosedMesh = { ...limb, index: Array.from(limb.index).slice(split) };
    const cut = [cutMesh(lower, plan), cutMesh(upper, plan)];
    const kept = dropScraps([cut[0]![1]!, cut[1]![1]!], plan, 1);
    expect(area(cut[0]![1]!)).toBeGreaterThan(0);
    expect(area(kept[0]!)).toBeCloseTo(area(cut[0]![1]!), 9);
    expect(closed([...kept, capOf(kept, plan, 1)!])).toBe(true);
    // On its own it would be one: all of it within the limb's girth of the cut.
    expect(area(dropScraps([cut[0]![1]!], plan, 1)[0]!)).toBe(0);
  });

  it('puts no flesh on a chain of clipped edges that closes nothing', () => {
    // Half the tube's wall (a tabard): its clipped edge is an open arc. All but one strip of it: nearly a loop, so closed.
    const wall = (strips: number): PosedMesh => ({ ...limb, index: Array.from(limb.index).filter((_, i) => i < 16 * AROUND * 6 && Math.floor(i / 6) % AROUND < strips) });
    const half = cutMesh(wall(AROUND / 2), plan);
    expect(half[0]!.rim.length).toBe(AROUND);
    expect(capOf([half[0]!], plan, 0)).toBeNull();
    const most = cutMesh(wall(AROUND - 1), plan);
    expect(capOf([most[0]!], plan, 0)).not.toBeNull();
  });
});

describe('skinned', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  /** A quarter turn about z (x to y), then moved 1 along x; column-major. */
  const turned = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
  const mesh = {
    position: [1, 0, 0, 1, 0, 0, 1, 0, 0],
    normal: [1, 0, 0, 1, 0, 0, 1, 0, 0],
    skinIndex: [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    skinWeight: [1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0],
  };

  it('places each vertex and normal by its bones, blended by weight', () => {
    const { position, normal } = skinned(mesh, [...identity, ...turned]);
    expect(Array.from(position.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(position.slice(3, 6))).toEqual([1, 1, 0]);
    expect(Array.from(position.slice(6, 9))).toEqual([1, 0.5, 0]);
    expect(Array.from(normal.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(normal.slice(3, 6))).toEqual([0, 1, 0]);
    // Blended, and made unit length again.
    expect(normal[6]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(normal[7]).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
