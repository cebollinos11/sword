import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { floorArenaName } from '../sim/delver/world';
import { createMatch, MAX_TEAM_SIZE } from '../sim';
import { floorOf } from '../sim/delver';
import { emptyReveal, withReveal } from '../sim/delver/reveal';
import { flatRooms, plainHalls } from '../sim/delver/flat.testdata';
import { delverDoorStubs, DOOR_STUB_LENGTH } from '../render/delverMapMarks';
import { DELVER_MAP_MIN_SPAN, delverMapLayout, delverMapStatus, MAP_KEY, mapKeyAction } from './floorMap';

const tuning = loadTuningData();
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
  const m = createMatch(delverTuning, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
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
    const boss = createMatch({ ...delverTuning, delver: { ...delverTuning.delver, tiers: 1, floorsPerTier: 1 } }, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, teams: [0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
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
    const t7 = plainHalls(tuning);
    const m = createMatch(t7, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
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
  const shaped = tuning;
  const t = { ...shaped, delver: { ...shaped.delver, tiers: 1, floorsPerTier: 3 } };
  const found = Array.from({ length: 40 }, (_, k) => k + 1)
    .map((k) => {
      const arena = `gen:greybox:${k}`;
      const m = createMatch(t, { format: 'Gauntlet', arena, bestOf: 1, seed: 7, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
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
    // The board is the map seen from above: x1 of the rect is its left edge. Bounds come from all the rects, here the Hall's rect and its doorways' stubs.
    const all = [hall.rect, ...delverDoorStubs(plan, withReveal(emptyReveal(plan), i)).map((d) => d.rect)];
    const [bx0, bx1] = [Math.min(...all.map((r) => r.x0)), Math.max(...all.map((r) => r.x1))];
    const [bz0, bz1] = [Math.min(...all.map((r) => r.z0)), Math.max(...all.map((r) => r.z1))];
    const span = Math.max(bx1 - bx0, bz1 - bz0, DELVER_MAP_MIN_SPAN);
    const scale = (1 - 2 * 0.06) / span;
    const cx = -(bx0 + bx1) / 2;
    const cz = -(bz0 + bz1) / 2;
    hall.rects.forEach((r, k) => {
      expect(l.rects[k]!.x0).toBeCloseTo(0.5 + (-r.x1 - cx) * scale);
      expect(l.rects[k]!.x1).toBeCloseTo(0.5 + (-r.x0 - cx) * scale);
      expect(l.rects[k]!.y0).toBeCloseTo(0.5 + (-r.z1 - cz) * scale);
      expect(l.rects[k]!.y1).toBeCloseTo(0.5 + (-r.z0 - cz) * scale);
    });
  });
});

describe('the unexplored doorways of the revealed Halls', () => {
  const t7 = plainHalls(tuning);
  const m = createMatch(t7, { format: 'Gauntlet', arena: 'gen:greybox:4242', bestOf: 1, seed: 7, teams: [0, 0, ...Array<number>(MAX_TEAM_SIZE).fill(1)] });
  const plan = floorOf(t7, floorArenaName(1, 1))!.plan;
  const entrance = withReveal(emptyReveal(plan), plan.entrance);
  const touches = (r: { x0: number; x1: number; z0: number; z1: number }, h: { x0: number; x1: number; z0: number; z1: number }) =>
    r.x0 <= h.x1 + 1e-6 && r.x1 >= h.x0 - 1e-6 && r.z0 <= h.z1 + 1e-6 && r.z1 >= h.z0 - 1e-6;

  it('stubs each Passage out of the Entrance alone, against the Entrance, no longer than DOOR_STUB_LENGTH', () => {
    const out = plan.passages.filter((p) => p.a === plan.entrance || p.b === plan.entrance);
    const stubs = delverDoorStubs(plan, entrance);
    expect(out.length).toBeGreaterThan(0);
    expect(stubs).toHaveLength(out.length);
    for (const d of stubs) {
      expect(Math.min(d.rect.x1 - d.rect.x0, d.rect.z1 - d.rect.z0)).toBeLessThanOrEqual(DOOR_STUB_LENGTH + 1e-6);
      expect(plan.halls[plan.entrance]!.rects.some((r) => touches(d.rect, r))).toBe(true);
    }
    expect(delverMapLayout(plan, entrance, m.duel.fighters, 0, delverMapStatus(m, plan)).doors).toHaveLength(out.length);
  });

  it('drops a doorway once its Passage is revealed, and stubs both ends of an unexplored Passage between two revealed Halls', () => {
    const p = plan.passages.findIndex((q) => q.a === plan.entrance || q.b === plan.entrance);
    const q = plan.passages[p]!;
    const walked = withReveal(entrance, plan.halls.length + p);
    expect(delverDoorStubs(plan, walked)).toHaveLength(delverDoorStubs(plan, entrance).length - 1);
    const both = withReveal(entrance, q.a === plan.entrance ? q.b : q.a);
    const ends = delverDoorStubs(plan, both).filter((d) => touches(d.rect, q.rect));
    expect(ends.length).toBeGreaterThanOrEqual(2);
    const all = Array.from({ length: plan.halls.length + plan.passages.length }).reduce<readonly number[]>((r, _, b) => withReveal(r, b), emptyReveal(plan));
    expect(delverDoorStubs(plan, all)).toEqual([]);
  });
});
