import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadTuningData } from '../tuning';
import { arenaOf } from '../sim/arena';
import { arenaTuning, floorArenaName, floorOf } from '../sim/delver';
import type { Rect } from '../mapEditor/source';
import { hallBase } from '../sim/delver/plan';
import { CLUTTER, CLUTTER_SHADE, clutterEnabled, clutterModel, clutterOf, setClutterEnabled, type Clutter } from './delverClutter';
import { sconcesOf } from './delverTorches';

const tuning = loadTuningData();
const fireRadius = tuning.delver.fireRadius;

const inside = (r: Rect, x: number, z: number, pad = 0): boolean => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

function floor(seed: number, n: number) {
  const name = floorArenaName(seed, n);
  const built = floorOf(tuning, name)!;
  const arena = arenaOf(arenaTuning(tuning, name), name);
  const flames = sconcesOf(built.plan, arena);
  return { plan: built.plan, arena, clutter: clutterOf(built.plan, arena, { fireRadius, flames }) };
}

/** Every floor item (heaps and cracks), as a disc: where it is and how far it reaches. */
const discs = (c: Clutter) => [...c.heaps.map((h) => ({ x: h.x, y: h.y, z: h.z, r: h.r })), ...c.cracks.map((k) => ({ x: k.x, y: k.y, z: k.z, r: k.size * 0.6 }))];

const triangles = (root: THREE.Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) n += (o.geometry as THREE.BufferGeometry).getAttribute('position').count / 3;
  });
  return n;
};

afterEach(() => setClutterEnabled(true));

describe('clutterOf', () => {
  // A first-tier Floor (7 Halls) and a last-tier one (all 20), each from two seeds.
  const cases = [
    [7, 1],
    [11, 2],
    [7, 7],
    [23, 8],
  ] as const;

  it.each(cases)('is the same each time (seed %i, Floor %i)', (seed, n) => {
    const a = floor(seed, n);
    expect(clutterOf(a.plan, a.arena, { fireRadius, flames: sconcesOf(a.plan, a.arena) })).toEqual(a.clutter);
  });

  it.each(cases)('keeps out of doorways, off Passage walking lines and Ramps, clear of the fire, pedestals and Stairs (seed %i, Floor %i)', (seed, n) => {
    const { plan, clutter } = floor(seed, n);
    const items = discs(clutter);
    expect(items.length).toBeGreaterThan(plan.halls.length * 2);
    const pieces = plan.passages.flatMap((p) => p.pieces);
    for (const d of items) {
      const at = `(${d.x.toFixed(2)}, ${d.z.toFixed(2)})`;
      const hall = plan.halls.find((h) => h.rects.some((r) => inside(r, d.x, d.z)));
      const piece = pieces.find((q) => inside(q.rect, d.x, d.z));
      expect(hall ?? piece, `${at} is in a Hall or a Passage`).toBeDefined();
      if (hall) {
        // Nowhere near a doorway: no Passage piece within reach of it.
        for (const q of pieces) expect(inside(q.rect, d.x, d.z, d.r + 1.5), `${hall.id} ${at} by a doorway`).toBe(false);
        // Never on a Ramp, a Deck, a pit or a dais.
        const g = hall.gallery;
        for (const r of [...(g ? [g.deck, g.ramp, ...(g.wrap?.decks ?? [])] : []), ...(hall.feature?.steps.map((s) => s.rect) ?? [])]) expect(inside(r, d.x, d.z, d.r), `${hall.id} ${at} on a Ramp or Deck`).toBe(false);
        // And on the Hall's own floor: between its floor and its roof.
        expect(d.y).toBeGreaterThanOrEqual(hallBase(hall) - 0.01);
        expect(d.y).toBeLessThan(hall.top);
      } else {
        // In a Passage: along a wall, clear of its walking line (the piece's middle), and never on its sloped leg.
        expect(piece!.y0, `${at} on a sloped leg`).toBe(piece!.y1);
        if (!piece!.corner) {
          const mid = piece!.axis === 'x' ? (piece!.rect.z0 + piece!.rect.z1) / 2 : (piece!.rect.x0 + piece!.rect.x1) / 2;
          const off = Math.abs((piece!.axis === 'x' ? d.z : d.x) - mid);
          expect(off - d.r, `${at} on a Passage's walking line`).toBeGreaterThan(0.25);
        }
      }
    }
    // Clear of the Rest fire's heal ring, the Treasure pedestals and the Stairs.
    for (const d of items) {
      for (const f of plan.markers.fires) expect(Math.hypot(f.x - d.x, f.z - d.z)).toBeGreaterThan(fireRadius + d.r);
      for (const p of plan.markers.pedestals) expect(Math.hypot(p.x - d.x, p.z - d.z)).toBeGreaterThan(1 + d.r);
      expect(inside(plan.markers.stairs.zone, d.x, d.z, d.r)).toBe(false);
    }
    // Cobwebs hang up near a ceiling, over the heads of the Fighters.
    for (const w of clutter.webs) expect(w.hub.y, `web at (${w.hub.x}, ${w.hub.z})`).toBeGreaterThan(Math.min(...plan.halls.map((h) => h.y)) + 2.5);
  });

  it('puts more in Empty and Fight Halls than in the Entrance', () => {
    const per = new Map<string, number[]>();
    for (const [seed, n] of [...cases, [5, 9], [31, 9]] as const) {
      const { plan, clutter } = floor(seed, n);
      for (const h of plan.halls) {
        const count = discs(clutter).filter((d) => inside(h.rect, d.x, d.z)).length / ((h.rect.x1 - h.rect.x0) * (h.rect.z1 - h.rect.z0));
        const kind = h.kind === 'Fight' || h.kind === 'Empty' ? 'busy' : h.kind === 'Entrance' ? 'entrance' : 'other';
        per.set(kind, [...(per.get(kind) ?? []), count]);
      }
    }
    const mean = (k: string) => per.get(k)!.reduce((a, b) => a + b, 0) / per.get(k)!.length;
    expect(mean('busy')).toBeGreaterThan(mean('entrance') * 2);
  });
});

describe('clutter and lava (Stage 7d)', () => {
  it('keeps every heap, crack, chain and cobweb off lava and a metre clear of it, over a scan of shipped lava Floors', { timeout: 120_000 }, () => {
    let lavaHalls = 0;
    let items = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const n of [1, 4, 7, 9]) {
        const { plan, clutter } = floor(seed, n);
        const rects = plan.halls.flatMap((h) => h.lava?.rects ?? []);
        lavaHalls += plan.halls.filter((h) => h.lava).length;
        const points = [
          ...discs(clutter).map((d) => ({ x: d.x, z: d.z, pad: 1 + d.r })),
          ...clutter.chains.map((c) => ({ x: c.x + c.nx * 0.5, z: c.z + c.nz * 0.5, pad: 1 })),
          ...clutter.webs.map((w) => ({ x: w.hub.x, z: w.hub.z, pad: 0 })),
        ];
        items += points.length;
        for (const p of points) for (const r of rects) expect(inside(r, p.x, p.z, p.pad), `seed ${seed} Floor ${n}: (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) by lava`).toBe(false);
      }
    }
    // The scan met lava (else it proves nothing).
    expect(lavaHalls).toBeGreaterThan(5);
    expect(items).toBeGreaterThan(500);
  });
});

describe('clutterModel', () => {
  it('draws a whole Floor in at most four draw calls and under 20 000 triangles', () => {
    for (const [seed, n] of [
      [7, 7],
      [23, 8],
      [5, 9],
    ] as const) {
      const model = clutterModel(floor(seed, n).clutter);
      expect(model.name).toBe(CLUTTER);
      const meshes = model.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
      expect(meshes.length).toBeLessThanOrEqual(4);
      expect(meshes.map((m) => m.name)).toContain(CLUTTER_SHADE);
      expect(triangles(model)).toBeLessThan(20000);
      expect(triangles(model)).toBeGreaterThan(2000);
    }
  });
});

describe('clutter setting', () => {
  it('starts on, and can be turned off and on again', () => {
    expect(clutterEnabled()).toBe(true);
    setClutterEnabled(false);
    expect(clutterEnabled()).toBe(false);
    setClutterEnabled(true);
    expect(clutterEnabled()).toBe(true);
  });
});
