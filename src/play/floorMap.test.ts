import { describe, expect, it } from 'vitest';
import { floorGraph, FLOOR_ROWS, runKit } from '../sim';
import { loadTuningData } from '../tuning';
import { floorArenaName } from '../sim/delver/world';
import { createMatch, MAX_TEAM_SIZE } from '../sim';
import { floorOf } from '../sim/delver';
import { emptyReveal, withReveal } from '../sim/delver/reveal';
import { flatRooms, rooms7b } from '../sim/delver/flat.testdata';
import { DELVER_MAP_MIN_SPAN, delverMapLayout, delverMapStatus, floorMapLayout, MAP_KEY, mapKeyAction } from './floorMap';

const tuning = loadTuningData();
const kit = runKit(tuning, `gen:${Object.keys(tuning.kits)[0]}:1:d2`);
const graph = (seed: number, floor = 1) => floorGraph(tuning.dungeon, seed, floor, kit);
const at = { floor: 1, row: 0, index: 0 };

describe('floorMapLayout', () => {
  it('puts every Hall once, in its row, and every exit as an edge', () => {
    for (const seed of [1, 2, 3, 77]) {
      const g = graph(seed);
      const layout = floorMapLayout(g, [at], at);
      expect(layout.nodes).toHaveLength(g.reduce((n, row) => n + row.length, 0));
      for (const [row, halls] of g.entries()) {
        const nodes = layout.nodes.filter((n) => n.row === row);
        expect(nodes.map((n) => n.index)).toEqual(halls.map((_, i) => i));
        expect(nodes.map((n) => n.kind)).toEqual(halls.map((h) => h.kind));
      }
      const exits = g.flatMap((row, r) => row.flatMap((h, i) => (r === FLOOR_ROWS - 1 ? [] : h.exits.map((j) => `${r}:${i}>${j}`))));
      expect(layout.edges.map((e) => `${e.from.row}:${e.from.index}>${e.to.index}`).sort()).toEqual(exits.sort());
    }
  });

  it('spaces rows evenly (the entrance at the bottom), centres each row and orders ties by index', () => {
    const layout = floorMapLayout(graph(5), [at], at);
    const ys = Array.from({ length: FLOOR_ROWS }, (_, r) => layout.nodes.find((n) => n.row === r)!.y);
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    const gaps = ys.slice(1).map((y, i) => ys[i]! - y);
    gaps.forEach((gap) => expect(gap).toBeCloseTo(gaps[0]!));
    for (let r = 0; r < FLOOR_ROWS; r++) {
      const xs = layout.nodes.filter((n) => n.row === r).map((n) => n.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect((xs[0]! + xs[xs.length - 1]!) / 2).toBeCloseTo(0.5);
    }
  });

  it('marks the path visited, the current Hall, and what is reachable from it', () => {
    const g = graph(9);
    const second = { floor: 1, row: 1, index: g[0]![0]!.exits[0]! };
    const layout = floorMapLayout(g, [at, second], second);
    const node = (r: number, i: number) => layout.nodes.find((n) => n.row === r && n.index === i)!;
    expect(node(0, 0)).toMatchObject({ visited: true, current: false, reachable: false });
    expect(node(1, second.index)).toMatchObject({ visited: true, current: true, reachable: false });
    for (const j of g[1]![second.index]!.exits) expect(node(2, j)).toMatchObject({ visited: false, current: false, reachable: true });
    expect(node(FLOOR_ROWS - 1, 0).reachable).toBe(true);
    expect(layout.nodes.filter((n) => n.visited)).toHaveLength(2);
    const walked = layout.edges.filter((e) => e.visited);
    expect(walked.map((e) => [e.from.row, e.from.index, e.to.row, e.to.index])).toEqual([[0, 0, 1, second.index]]);
  });

  it('lays out a graph of one row (or two) without dividing by zero, by the graph’s own rows', () => {
    const hall = (kind: 'Boss' | 'Fight', exits: number[] = []) => ({ ...graph(1)[0]![0]!, kind, exits });
    const one = floorMapLayout([[hall('Boss')]], [at], at);
    expect(one.nodes).toHaveLength(1);
    expect(Number.isFinite(one.nodes[0]!.y) && one.nodes[0]!.y >= 0 && one.nodes[0]!.y <= 1).toBe(true);
    expect(one.nodes[0]).toMatchObject({ x: 0.5, current: true });
    expect(one.edges).toEqual([]);
    const two = floorMapLayout([[hall('Fight', [0])], [hall('Boss')]], [at], at);
    expect(two.nodes.map((n) => n.y)).toEqual([1, 0]);
    expect(two.nodes.map((n) => n.reachable)).toEqual([false, true]);
    expect(two.edges).toHaveLength(1);
  });

  it('ignores path entries of other Floors', () => {
    const here = { floor: 2, row: 0, index: 0 };
    const layout = floorMapLayout(graph(9, 2), [at, here], here);
    expect(layout.nodes.filter((n) => n.visited)).toHaveLength(1);
    expect(layout.edges.some((e) => e.visited)).toBe(false);
  });

  it('is the same for the same seed', () => {
    expect(floorMapLayout(graph(4), [at], at)).toEqual(floorMapLayout(graph(4), [at], at));
  });
});

describe('mapKeyAction', () => {
  it('toggles on the map key and closes on Escape only while open', () => {
    expect(MAP_KEY).toBe('KeyM');
    expect(mapKeyAction('KeyM', false)).toBe('toggle');
    expect(mapKeyAction('KeyM', true)).toBe('toggle');
    expect(mapKeyAction('Escape', true)).toBe('close');
    expect(mapKeyAction('Escape', false)).toBeNull();
    expect(mapKeyAction('KeyW', true)).toBeNull();
  });
});

describe('delverMapLayout', () => {
  // A Passage is one rect on Stage 6's lattice (a turning one is drawn as its pieces, below), so these run on `flatRooms`.
  const rooms = flatRooms(tuning);
  const delverTuning = { ...rooms, delver: { ...rooms.delver, tiers: 1, floorsPerTier: 3 } };
  const m = createMatch(delverTuning, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, delver: true, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const plan = floorOf(delverTuning, m.arena)!.plan;
  const status = delverMapStatus(m, plan);
  const layout = (revealed: readonly number[], fighters = m.duel.fighters, me = 0) => delverMapLayout(plan, revealed, fighters, me, status);
  const entrance = withReveal(emptyReveal(plan), plan.entrance);

  it('draws nothing for a Floor with nothing revealed, and one Hall and no markers for the Entrance alone', () => {
    expect(layout(emptyReveal(plan)).rects).toEqual([]);
    const l = layout(entrance);
    expect(l.rects).toHaveLength(1);
    expect(l.rects[0]).toMatchObject({ hall: true, kind: 'Entrance' });
    expect(l.marks).toEqual([]);
  });

  it('keeps every rect on the board, and a lone Hall small (DELVER_MAP_MIN_SPAN metres at the least)', () => {
    const all = Array.from({ length: plan.halls.length + plan.passages.length }).reduce<readonly number[]>((r, _, b) => withReveal(r, b), emptyReveal(plan));
    for (const l of [layout(entrance), layout(all)]) {
      for (const r of l.rects) {
        expect(r.x0).toBeGreaterThanOrEqual(0);
        expect(r.y0).toBeGreaterThanOrEqual(0);
        expect(r.x1).toBeLessThanOrEqual(1);
        expect(r.y1).toBeLessThanOrEqual(1);
        expect(r.x1).toBeGreaterThan(r.x0);
        expect(r.y1).toBeGreaterThan(r.y0);
      }
    }
    const hall = plan.halls[plan.entrance]!.rect;
    const lone = layout(entrance).rects[0]!;
    expect(lone.x1 - lone.x0).toBeLessThanOrEqual((hall.x1 - hall.x0) / DELVER_MAP_MIN_SPAN);
    expect(layout(all).rects).toHaveLength(plan.halls.length + plan.passages.length);
  });

  it('shows the markers of revealed Halls only: the Stairs when its Hall is, with the gate', () => {
    const none = layout(entrance).marks;
    expect(none.some((k) => k.type === 'stairs')).toBe(plan.stairs === plan.entrance);
    const l = layout(withReveal(entrance, plan.stairs));
    const stairs = l.marks.find((k) => k.type === 'stairs');
    expect(stairs).toMatchObject({ type: 'stairs', open: true });
    const fires = plan.markers.fires.filter((f) => f.hall === plan.stairs || f.hall === plan.entrance).length;
    expect(l.marks.filter((k) => k.type === 'fire')).toHaveLength(fires);
    const shut = delverMapLayout(plan, withReveal(entrance, plan.stairs), m.duel.fighters, 0, { ...status, gateOpen: false });
    expect(shut.marks.find((k) => k.type === 'stairs')).toMatchObject({ open: false });
  });

  it('marks a revealed fire spent once its revive is used, and a Treasure Hall lying or emptied', () => {
    const fire = plan.markers.fires[0]!;
    const seen = withReveal(entrance, fire.hall);
    const lit = delverMapLayout(plan, seen, m.duel.fighters, 0, status).marks.find((k) => k.type === 'fire');
    expect(lit).toMatchObject({ spent: false });
    const used = status.restUsed.map((u, k) => (k === 0 ? { ...u, revived: true } : u));
    expect(delverMapLayout(plan, seen, m.duel.fighters, 0, { ...status, restUsed: used }).marks.find((k) => k.type === 'fire')).toMatchObject({ spent: true });
    const treasure = plan.halls.findIndex((h) => h.kind === 'Treasure');
    if (treasure >= 0) {
      const t = withReveal(entrance, treasure);
      expect(delverMapLayout(plan, t, m.duel.fighters, 0, status).marks.find((k) => k.type === 'treasure')).toMatchObject({ lying: true });
      expect(delverMapLayout(plan, t, m.duel.fighters, 0, { ...status, pickups: [] }).marks.find((k) => k.type === 'treasure')).toMatchObject({ lying: false });
    }
  });

  it('draws an arrow for each living party Fighter, me alone white, and none for the fallen or for enemies', () => {
    const l = layout(entrance);
    expect(l.arrows.map((a) => [a.fighter, a.me])).toEqual([
      [0, true],
      [1, false],
    ]);
    const fallen = m.duel.fighters.map((f, i) => (i === 1 ? { ...f, hp: 0, death: { tick: 0, cause: 'Fall' as const, blow: null } } : f));
    expect(layout(entrance, fallen).arrows.map((a) => a.fighter)).toEqual([0]);
    for (const a of l.arrows) expect(Math.hypot(a.dx, a.dy)).toBeCloseTo(1);
  });

  it('puts the Boss mark beside the Stairs mark in the Boss Hall, not on it', () => {
    const boss = createMatch({ ...delverTuning, delver: { ...delverTuning.delver, tiers: 1, floorsPerTier: 1 } }, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, delver: true, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
    const bt = { ...delverTuning, delver: { ...delverTuning.delver, tiers: 1, floorsPerTier: 1 } };
    const bplan = floorOf(bt, boss.arena)!.plan;
    expect(bplan.markers.boss).toBeDefined();
    const l = delverMapLayout(bplan, withReveal(emptyReveal(bplan), bplan.stairs), boss.duel.fighters, 0, delverMapStatus(boss, bplan));
    const stairs = l.marks.find((k) => k.type === 'stairs')!;
    const skull = l.marks.find((k) => k.type === 'boss')!;
    expect(Math.hypot(stairs.bx - skull.bx, stairs.by - skull.by)).toBeGreaterThan(0);
  });
});

describe('delverMapLayout on turning Passages', () => {
  it('draws a revealed Passage as one rect per piece, in piece order', () => {
    const t7 = tuning;
    const m = createMatch(t7, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, delver: true, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
    for (let seed = 1; seed <= 3; seed++) {
      const plan = floorOf(t7, floorArenaName(seed, 1))!.plan;
      const all = Array.from({ length: plan.halls.length + plan.passages.length }).reduce<readonly number[]>((r, _, b) => withReveal(r, b), emptyReveal(plan));
      const l = delverMapLayout(plan, all, m.duel.fighters, 0, delverMapStatus(m, plan));
      const pieces = plan.passages.reduce((n, p) => n + p.pieces.length, 0);
      expect(plan.passages.some((p) => p.shape !== 'straight')).toBe(true);
      expect(l.rects.filter((r) => !r.hall)).toHaveLength(pieces);
      expect(l.rects).toHaveLength(plan.halls.length + pieces);
    }
  }, 120_000);
});

describe('delverMapLayout on shaped Halls (Stage 7b)', () => {
  const shaped = rooms7b(tuning);
  const t = { ...shaped, delver: { ...shaped.delver, tiers: 1, floorsPerTier: 3 } };
  const found = Array.from({ length: 40 }, (_, k) => k + 1)
    .map((k) => {
      const arena = `gen:greybox:${k}`;
      const m = createMatch(t, { format: 'Gauntlet', arena, bestOf: 1, seed: 7, delver: true, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
      return { m, plan: floorOf(t, m.arena)!.plan };
    })
    .find((e) => e.plan.halls.some((h) => h.shape === 'L' || h.shape === 'ring'))!;

  it('draws a revealed shaped Hall as one hall rect per rects entry, in rect order, with its kind and the right board coordinates', () => {
    const { m, plan } = found;
    const i = plan.halls.findIndex((h) => h.shape === 'L' || h.shape === 'ring');
    const hall = plan.halls[i]!;
    expect(hall.rects.length).toBeGreaterThan(1);
    const l = delverMapLayout(plan, withReveal(emptyReveal(plan), i), m.duel.fighters, 0, delverMapStatus(m, plan));
    expect(l.rects).toHaveLength(hall.rects.length);
    for (const r of l.rects) expect(r).toMatchObject({ hall: true, kind: hall.kind });
    // The board is the map seen from above: x1 of the rect is its left edge. Bounds come from all the rects, here the Hall's rect.
    const span = Math.max(hall.rect.x1 - hall.rect.x0, hall.rect.z1 - hall.rect.z0, DELVER_MAP_MIN_SPAN);
    const scale = (1 - 2 * 0.06) / span;
    const cx = -(hall.rect.x0 + hall.rect.x1) / 2;
    const cz = -(hall.rect.z0 + hall.rect.z1) / 2;
    hall.rects.forEach((r, k) => {
      expect(l.rects[k]!.x0).toBeCloseTo(0.5 + (-r.x1 - cx) * scale);
      expect(l.rects[k]!.x1).toBeCloseTo(0.5 + (-r.x0 - cx) * scale);
      expect(l.rects[k]!.y0).toBeCloseTo(0.5 + (-r.z1 - cz) * scale);
      expect(l.rects[k]!.y1).toBeCloseTo(0.5 + (-r.z0 - cz) * scale);
    });
  });
});
