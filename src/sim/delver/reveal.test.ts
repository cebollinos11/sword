import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../../tuning';
import { rooms7a } from './flat.testdata';
import { floorArenaName, floorOf } from './world';
import { emptyReveal, isRevealed, revealBits, revealPlace, withReveal } from './reveal';

const tuning = loadTuningData();
const plan = floorOf(tuning, floorArenaName(4242, 1))!.plan;

describe('the Reveal bitset', () => {
  it('has a bit per Hall and Passage, in ceil(bits / 32) zero words', () => {
    expect(revealBits(plan)).toBe(plan.halls.length + plan.passages.length);
    const r = emptyReveal(plan);
    expect(r).toHaveLength(Math.ceil(revealBits(plan) / 32));
    expect(r.every((w) => w === 0)).toBe(true);
    expect(isRevealed(r, 0)).toBe(false);
    expect(isRevealed(r, -1)).toBe(false);
  });

  it('sets a bit without touching the input, as an unsigned word, across word edges', () => {
    const r = emptyReveal(plan);
    for (const bit of [0, 31, 32, revealBits(plan) - 1]) {
      const w = withReveal(r, bit);
      expect(w).not.toBe(r);
      expect(r.every((x) => x === 0)).toBe(true);
      expect(isRevealed(w, bit)).toBe(true);
      expect(w.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff)).toBe(true);
    }
    expect(withReveal(r, 31)[0]).toBe(0x80000000);
  });

  it('returns the same array when the bit is set already (or is -1), so nothing is allocated', () => {
    const w = withReveal(emptyReveal(plan), 3);
    expect(withReveal(w, 3)).toBe(w);
    expect(withReveal(w, -1)).toBe(w);
  });
});

describe('revealPlace', () => {
  it('finds the Hall whose rect holds the point, by its index', () => {
    plan.halls.forEach((h, i) => expect(revealPlace(plan, h.cx, h.cz)).toBe(i));
  });

  it('finds the Passage whose rect holds the point, after the Halls', () => {
    plan.passages.forEach((p, k) => {
      const x = (p.rect.x0 + p.rect.x1) / 2;
      const z = (p.rect.z0 + p.rect.z1) / 2;
      const bit = revealPlace(plan, x, z);
      // A Passage's rect may touch a Hall's; its middle is in the Passage unless the Hall covers it.
      expect([plan.halls.length + k, ...plan.halls.keys()]).toContain(bit);
    });
    const p = plan.passages[0]!;
    const mid = { x: (p.rect.x0 + p.rect.x1) / 2, z: (p.rect.z0 + p.rect.z1) / 2 };
    expect(plan.halls.some((h) => revealPlace(plan, mid.x, mid.z) === plan.halls.indexOf(h))).toBe(false);
    expect(revealPlace(plan, mid.x, mid.z)).toBe(plan.halls.length);
  });

  it('is -1 outside every rect', () => {
    expect(revealPlace(plan, 1e6, 1e6)).toBe(-1);
  });

  it('gives a seam to exactly one place: inclusive on x0 and z0, exclusive on x1 and z1', () => {
    const h = plan.halls[0]!;
    const { x0, x1, z0, z1 } = h.rect;
    const zm = (z0 + z1) / 2;
    expect(revealPlace(plan, x0, zm)).toBe(0);
    expect(revealPlace(plan, x1, zm)).not.toBe(0);
    const xm = (x0 + x1) / 2;
    expect(revealPlace(plan, xm, z0)).toBe(0);
    expect(revealPlace(plan, xm, z1)).not.toBe(0);
  });

  it('breaks a tie by the lower index (Halls before Passages)', () => {
    const twin = { halls: [plan.halls[0]!, plan.halls[0]!], passages: [] };
    expect(revealPlace(twin, plan.halls[0]!.cx, plan.halls[0]!.cz)).toBe(0);
    const hallAndPassage = { halls: [plan.halls[0]!], passages: [{ ...plan.passages[0]!, rect: plan.halls[0]!.rect }] };
    expect(revealPlace(hallAndPassage, plan.halls[0]!.cx, plan.halls[0]!.cz)).toBe(0);
  });
});

describe('revealPlace on turning Passages', () => {
  const t7 = rooms7a(tuning);
  const inBox = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;
  const plans = Array.from({ length: 12 }, (_, i) => floorOf(t7, floorArenaName(i + 1, 1))!.plan);

  it('reveals a Passage by a point in its corner piece', () => {
    let found = 0;
    for (const p of plans)
      p.passages.forEach((pass, k) => {
        if (pass.shape !== 'L' && pass.shape !== 'S') return;
        for (const piece of pass.pieces.filter((q) => q.corner)) {
          const x = (piece.rect.x0 + piece.rect.x1) / 2;
          const z = (piece.rect.z0 + piece.rect.z1) / 2;
          if (p.halls.some((h) => inBox(h.rect, x, z))) continue;
          const earlier = p.passages.findIndex((o) => o.pieces.some((q) => inBox(q.rect, x, z)));
          expect(revealPlace(p, x, z)).toBe(p.halls.length + earlier);
          if (earlier === k) found++;
        }
      });
    expect(found).toBeGreaterThan(0);
  });

  it('reveals nothing for a point in a turning Passage\'s bounding rect but in none of its pieces nor any Hall', () => {
    let found = 0;
    for (const p of plans)
      p.passages.forEach((pass) => {
        if (pass.shape === 'straight') return;
        const { x0, x1, z0, z1 } = pass.rect;
        for (let x = x0 + 0.5; x < x1; x += 1)
          for (let z = z0 + 0.5; z < z1; z += 1) {
            if (p.halls.some((h) => inBox(h.rect, x, z)) || p.passages.some((o) => o.pieces.some((q) => inBox(q.rect, x, z)))) continue;
            expect(revealPlace(p, x, z)).toBe(-1);
            found++;
          }
      });
    expect(found).toBeGreaterThan(0);
  });
});
