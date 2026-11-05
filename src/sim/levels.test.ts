/**
 * docs/plans/battle-objectives.md, Stage 4a: Soldiers on several levels (ADR 0022), on the hand-made test maps of `levelMaps.testdata.ts`
 * (a platform with ramps; a rampart with a bridge over a tunnel), not the Fort. Each Soldier's Walk Surface in the Crowd, crossing between
 * surfaces only by walking and dropping, never jumping, its height from its surface; the destination fields per level where levels overlap,
 * and their clearance; the build-time walk check; the Bubble's height gate; whole Battles on both maps with every Soldier checked on every
 * step, and Rollbacks across a level change.
 */
import { describe, expect, it } from 'vitest';
import { createBattlePilot, poolControllers, stepMatchWith } from '../controllers';
import { loadTuningData, type BattleMapTuning, type TuningData } from '../tuning';
import {
  battlefieldOf,
  battleMapOf,
  clearanceAt,
  createMatch,
  fieldDistance,
  formationNarrow,
  formationSpot,
  sameLevel,
  COLUMN,
  LINE,
  hashValue,
  restore,
  snapshot,
  soldierHeight,
  stepBubbles,
  stepCrowd,
  stepMatch,
  surfaceHeight,
  trace,
  walkCheck,
  walkTo,
  groundOf,
  type CrowdState,
  type MatchState,
  type Snapshot,
} from '.';
import { checkLevels, joins, placed, unplanned } from './levelChecks.testdata';
import { bridgeMap, DECK, platformMap, RAMPART, withLevelMaps } from './levelMaps.testdata';

const base = loadTuningData();
const PLATFORM = 'battle:platform';
const BRIDGE = 'battle:bridge';
const onPlatform = withLevelMaps(base, 'platform');
const onBridge = withLevelMaps(base, 'bridge');
const lv = base.battle.levels;

/** The index of the Walk Surface `id` of `map`'s Battlefield. */
const surfaceId = (t: TuningData, name: string, id: string): number => battlefieldOf(t.battle, name)!.arena.walk.findIndex((w) => w.id === id);

describe('the test maps', () => {
  it('are Battle maps of several levels that pass the walk check, each its own half turn, and Soldiers climb and drop no more than a Fighter', () => {
    for (const [t, name, map] of [[onPlatform, PLATFORM, platformMap()], [onBridge, BRIDGE, bridgeMap()]] as const) {
      const field = battlefieldOf(t.battle, name)!;
      expect(field.layered).toBe(true);
      expect(walkCheck(field.arena, lv)).toBeNull();
      // Every Walk Surface has its half turn among them.
      const key = (w: { points: readonly { x: number; y: number; z: number }[] }, turn: number) =>
        w.points
          .map((p) => `${(turn * p.x + 0).toFixed(3)},${p.y.toFixed(3)},${(turn * p.z + 0).toFixed(3)}`)
          .sort()
          .join(' ');
      const all = new Set(map.walk.map((w) => key(w, 1)));
      for (const w of map.walk) expect(all.has(key(w, -1)), `${name} ${w.id}`).toBe(true);
      map.objectives.forEach((o, k) => expect([map.objectives[4 - k]!.x, map.objectives[4 - k]!.z]).toEqual([-o.x + 0, -o.z + 0]));
    }
    // Soldiers never climb what a Fighter cannot, and never drop deeper than a Fighter's drop Link (fall damage up to 35).
    expect(lv.stepUp).toBeLessThanOrEqual(base.fall.stepUp);
    expect(lv.drop).toBeLessThanOrEqual(base.fall.safeHeight + 35 / base.fall.damagePerMetre);
    expect(lv.height).toBeLessThanOrEqual(base.fighter.height);
  });

  it('refuses a map with a Walk Surface nobody can walk to, or one nobody can walk back from', () => {
    const t = (map: BattleMapTuning): TuningData => ({ ...base, battle: { ...base.battle, maps: { [map.name]: map }, armySize: 200 } });
    const plat = platformMap();
    // The ramps taken away: the deck stands alone, 3 m up.
    const island = { ...plat, name: 'island', walk: plat.walk.filter((w) => !w.id.startsWith('ramp')).concat(plat.walk.filter((w) => w.id.startsWith('ramp')).map((w) => ({ ...w, points: w.points.map((p) => ({ ...p, y: 0 })) }))) };
    expect(() => battlefieldOf(t(island).battle, 'battle:island')).toThrow(/deck_\w+ cannot be walked to/);
    // The ramps' rails taken away and the ramps flattened, but the deck raised 3 m over open ground: a Soldier drops off it, never climbs back.
    const ledge = { ...plat, name: 'ledge', walk: plat.walk.map((w) => (w.id.startsWith('ramp') ? { ...w, points: w.points.map((p) => ({ ...p, y: 0 })) } : w)), walls: plat.walls.filter((w) => !w.id.startsWith('ramp')) };
    expect(() => battlefieldOf(t(ledge).battle, 'battle:ledge')).toThrow(/cannot be walked to|cannot walk back/);
    expect(battlefieldOf(t(plat).battle, 'battle:platform')).not.toBeNull();
  });
});

describe('the walk rule', () => {
  const field = battlefieldOf(onBridge.battle, BRIDGE)!;
  const arena = field.arena;
  const tunnel = surfaceId(onBridge, BRIDGE, 'tunnel');
  const bridge = surfaceId(onBridge, BRIDGE, 'bridge');
  const south = surfaceId(onBridge, BRIDGE, 'ground_se');
  const ramp = surfaceId(onBridge, BRIDGE, 'ramp_s');

  it("walks a Soldier on the ground through the tunnel under the bridge, and one on the bridge over it, never onto the other's level", () => {
    // From the ground south of the rampart into the tunnel and out the far side, on the tunnel's floor all the way (the bridge is 4 m up).
    expect(trace(arena, lv, south, 0, -10, 0, 0, true)).toBe(tunnel);
    expect(surfaceHeight(arena, trace(arena, lv, south, 0, -10, 0, 10, true), 0, 10)).toBe(0);
    // On the bridge, along the rampart's top, over the tunnel.
    expect(trace(arena, lv, bridge, 0, 0, 20, 0, true)).toBe(surfaceId(onBridge, BRIDGE, 'top_4'));
    // Into the rampart's face from the ground: stopped (no ground there within a step, and a Wall); off the bridge's edge: a 4 m drop is too deep.
    expect(trace(arena, lv, south, 10, -8, 10, -4, true)).toBe(-1);
    expect(trace(arena, lv, bridge, 2, 0, 2, -8, true)).toBe(-1);
    // Up the ramp and onto the top, and off its railed side never.
    const up = trace(arena, lv, south, -38, -24, -38, -2, true);
    expect(surfaceHeight(arena, up, -38, -2)).toBe(RAMPART);
    expect(trace(arena, lv, ramp, -38, -12, -44, -12, true)).toBe(-1);
  });

  it('drops a Soldier off an open ledge but never lifts it up one, and slides it along what stops it', () => {
    const p = battlefieldOf(onPlatform.battle, PLATFORM)!.arena;
    const deck = surfaceId(onPlatform, PLATFORM, 'deck_w');
    const ground = groundOf(onPlatform.battle, battlefieldOf(onPlatform.battle, PLATFORM)!, -14, 0);
    // Off the deck's west edge: a 3 m drop onto the ground.
    const down = trace(p, lv, deck, -9, 0, -12, 0, true);
    expect(down).toBe(ground);
    expect(trace(p, lv, deck, -9, 0, -12, 0, false)).toBe(-1);
    // Back up the 3 m face: never (no jumping).
    expect(trace(p, lv, ground, -12, 0, -9, 0, true)).toBe(-1);
    // Walking at the face slantwise, it slides along it (its z moves, its x stays).
    const out: [number, number] = [0, 0];
    expect(walkTo(p, lv, ground, -10.2, 0, -9.8, 0.3, out)).toBe(ground);
    expect(out).toEqual([-10.2, 0.3]);
  });
});

describe('the destination fields over several levels', () => {
  const map = battleMapOf(onBridge.battle, BRIDGE);
  const f = map.fields;
  const L = f.levels!;
  const tunnel = surfaceId(onBridge, BRIDGE, 'tunnel');
  const bridge = surfaceId(onBridge, BRIDGE, 'bridge');

  it('hold a node per level where levels overlap, each with its own way', () => {
    const mid = (f.side - 1) / 2;
    const centre = mid * f.side + mid;
    expect(L.start[centre + 1]! - L.start[centre]!).toBe(2);
    expect([L.y[L.start[centre]!], L.y[L.start[centre]! + 1]]).toEqual([0, RAMPART]);
    // To E (north, on the ground): from the tunnel's floor it is 40 m or so straight on; from the bridge over it, back down a ramp first.
    const fromTunnel = fieldDistance(f, 4, 0, 0, tunnel);
    const fromBridge = fieldDistance(f, 4, 0, 0, bridge);
    expect(fromTunnel).toBeGreaterThan(35);
    expect(fromTunnel).toBeLessThan(48);
    expect(fromBridge).toBeGreaterThan(fromTunnel + 40);
    // To B (on the bridge): nothing from the bridge; from the tunnel under it, out, round and up a ramp.
    expect(fieldDistance(f, 2, 0, 0, bridge)).toBe(0);
    expect(fieldDistance(f, 2, 0, 0, tunnel)).toBeGreaterThan(60);
  });

  it("give each Team its half turn's path lengths, level by level", () => {
    const mid = (f.side - 1) / 2;
    let checked = 0;
    for (let c = 0; c < f.side * f.side; c++) {
      const m = f.side * f.side - 1 - c;
      for (let k = L.start[c]!; k < L.start[c + 1]!; k++) {
        const x = ((c % f.side) - mid) * f.cell;
        const z = (Math.floor(c / f.side) - mid) * f.cell;
        // The node of the mirrored cell at the same height.
        let n = -1;
        for (let j = L.start[m]!; j < L.start[m + 1]!; j++) if (Math.abs(L.y[j]! - L.y[k]!) < 1e-9) n = j;
        expect(n, `cell ${c} at ${L.y[k]}`).toBeGreaterThanOrEqual(0);
        for (let d = 0; d < 5; d++) expect(f.dist[d]![k]!, `node ${k} (${x}, ${z}) to ${d}`).toBeCloseTo(f.dist[4 - d]![n]!, 6);
        expect(f.dist[5]![k]!).toBeCloseTo(f.dist[6]![n]!, 6);
        expect(f.clearance![k]!).toBeCloseTo(f.clearance![n]!, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(f.side * f.side * 0.8);
  });

  it("store each level's clearance, so a Formation narrows to a single file in the tunnel and stays open on the rampart's top", () => {
    expect(clearanceAt(f, 0, 0, tunnel)).toBeLessThan(3.1);
    expect(clearanceAt(f, 0, 0, tunnel)).toBeGreaterThan(2.5);
    expect(clearanceAt(f, 0, 0, bridge)).toBeGreaterThan(5.5);
    const b = onBridge.battle;
    expect(formationNarrow(b, f, COLUMN, 12, 0, -2, 0, tunnel)).toBe(1);
    expect(formationNarrow(b, f, COLUMN, 12, -60, 0, Math.PI / 2, surfaceId(onBridge, BRIDGE, 'top_0'))).toBe(0);
    expect(formationNarrow(b, f, LINE, 12, -60, 0, Math.PI / 2, surfaceId(onBridge, BRIDGE, 'top_0'))).toBeGreaterThan(3);
    // Off the rampart, the open field's room.
    expect(formationNarrow(b, f, LINE, 12, 0, -60, 0, groundOf(b, map.field, 0, -60))).toBe(0);
  });
});

/** Whether (x, z) is under the bridge's span: the cells where the bridge and the tunnel overlap. */
const overTunnel = (x: number, z: number) => Math.abs(x) < 3 && Math.abs(z) < 6;

describe('Squads on several levels', () => {
  it("go under the bridge and over it, each by its field's shorter way, every Soldier on the right level on every step", () => {
    const t = unplanned(onBridge);
    const map = battleMapOf(t.battle, BRIDGE);
    const linked = joins(t, BRIDGE);
    // Squad 0 from north of the rampart to D (south, on the ground): through the tunnel. Squad 1 from the foot of the south ramp to C, on the
    // rampart's top in the east: up the ramp and along the top, over the tunnel (the way through it and up the north ramp is longer).
    let c = placed(t, BRIDGE, [
      { q: 0, x: 20, z: 30, heading: Math.PI, target: 0 },
      { q: 1, x: -38, z: -32, heading: 0, target: 3 },
    ]);
    const field = map.field;
    const seen = { underAnchor: 0, overAnchor: 0, under: new Set<number>(), over: new Set<number>(), wrong: 0 };
    let crossed = 0;
    for (let tick = 1; tick <= 120 * 60; tick++) {
      const next = stepCrowd(c, tick, t.battle, [], map);
      crossed += checkLevels(t, BRIDGE, linked, c, next, tick);
      c = next;
      const sq = c.squads;
      for (const q of [0, 1]) {
        if (!overTunnel(sq.x[q]!, sq.z[q]!)) continue;
        const y = soldierHeight(field, sq.surface[q]!, sq.x[q]!, sq.z[q]!);
        if (q === 0 && y === 0) seen.underAnchor++;
        else if (q === 1 && y === RAMPART) seen.overAnchor++;
        else seen.wrong++;
      }
      for (let i = 0; i < c.x.length; i++) {
        if (!overTunnel(c.x[i]!, c.z[i]!) || c.squad[i]! > 1) continue;
        const y = soldierHeight(field, c.surface[i]!, c.x[i]!, c.z[i]!);
        if (c.squad[i] === 0 && y === 0) seen.under.add(i);
        else if (c.squad[i] === 1 && y === RAMPART) seen.over.add(i);
        else seen.wrong++;
      }
    }
    const away = (q: number) => Math.hypot(c.squads.x[q]! - field.objectives[c.squads.target[q]!]!.x, c.squads.z[q]! - field.objectives[c.squads.target[q]!]!.z);
    process.stderr.write(
      `bridge: anchors under ${seen.underAnchor} / over ${seen.overAnchor} Ticks, Soldiers under ${seen.under.size} / over ${seen.over.size}, onto another level ${crossed} times; at the end ${away(0).toFixed(1)} m from D and ${away(1).toFixed(1)} m from C\n`,
    );
    expect(seen.underAnchor).toBeGreaterThan(0);
    expect(seen.overAnchor).toBeGreaterThan(0);
    expect(seen.wrong).toBe(0);
    expect(seen.under.size).toBeGreaterThanOrEqual(10);
    expect(seen.over.size).toBeGreaterThanOrEqual(10);
    // Both got there: inside the Objective's circle, the one on the top on the top.
    expect(away(0)).toBeLessThan(12);
    expect(away(1)).toBeLessThan(12);
    expect(soldierHeight(field, c.squads.surface[1]!, c.squads.x[1]!, c.squads.z[1]!)).toBe(RAMPART);
  }, 120_000);

  it('walk a Squad round the platform and up a ramp onto its deck, its Soldiers to their places on its level', () => {
    const t = unplanned(onPlatform);
    const map = battleMapOf(t.battle, PLATFORM);
    const linked = joins(t, PLATFORM);
    // West of the deck, whose 3 m face stands between it and B: the field leads round to a ramp.
    let c = placed(t, PLATFORM, [{ q: 0, x: -24, z: -2, heading: Math.PI / 2, target: 2 }]);
    const members = c.squad.flatMap((s, i) => (s === 0 ? [i] : []));
    const narrow = (cs: CrowdState) => formationNarrow(t.battle, map.fields, cs.squads.shape[0]!, cs.squads.living[0]!, cs.squads.x[0]!, cs.squads.z[0]!, cs.squads.heading[0]!, cs.squads.surface[0]);
    const place: [number, number] = [0, 0];
    let crossed = 0;
    let up = -1;
    for (let tick = 1; tick <= 90 * 60 && up < 0; tick++) {
      const next = stepCrowd(c, tick, t.battle, [], map);
      crossed += checkLevels(t, PLATFORM, linked, c, next, tick);
      c = next;
      if (c.squads.speed[0] !== 0 || soldierHeight(map.field, c.squads.surface[0]!, c.squads.x[0]!, c.squads.z[0]!) !== DECK) continue;
      // Every Soldier at its place (within two places of it) and on its place's level: on the deck, or on a ramp where a narrowed file reaches.
      const home = members.every((i) => {
        const on = formationSpot(t.battle, map, c.squads, 0, c.place[i]!, narrow(c), place);
        return Math.hypot(place[0] - c.x[i]!, place[1] - c.z[i]!) <= 2 * t.battle.squad.spacing && sameLevel(map.field.arena, lv, c.surface[i]!, on, c.x[i]!, c.z[i]!);
      });
      if (home) up = tick;
    }
    const heights = members.map((i) => soldierHeight(map.field, c.surface[i]!, c.x[i]!, c.z[i]!));
    process.stderr.write(`platform: the Squad stood at B on the deck, its Soldiers at their places, after ${(up / 60).toFixed(1)} s (heights ${heights.map((y) => y.toFixed(1)).join(' ')}), onto another level ${crossed} times
`);
    expect(up).toBeGreaterThan(0);
    expect(heights.filter((y) => y === DECK).length).toBeGreaterThan(members.length / 2);
    expect(Math.min(...heights)).toBeGreaterThan(1);
  }, 120_000);
});

describe('the Bubble across levels', () => {
  it('never promotes a Soldier through a floor: one in the tunnel under a Player on the bridge stays in the Crowd, one beside it on the bridge is promoted', () => {
    const t = onBridge;
    const field = battlefieldOf(t.battle, BRIDGE)!;
    const tunnel = surfaceId(t, BRIDGE, 'tunnel');
    const bridge = surfaceId(t, BRIDGE, 'bridge');
    const top = surfaceId(t, BRIDGE, 'top_4');
    const south = groundOf(t.battle, field, 0, -9);
    const m = createMatch(t, { format: 'Battle', bestOf: 1, seed: 1, arena: BRIDGE, teams: [0], weapons: ['Longsword'] });
    const crowd = m.duel.crowd!;
    // Team 1's first Soldiers: one in the tunnel 2 m from under the Player, one on the top 6 m off, one on the ground south of the rampart 9 m
    // off; the rest of Team 1 far away.
    const [under, beside, below] = [200, 201, 202];
    const put = <T,>(xs: readonly T[], at: Record<number, T>): T[] => xs.map((v, i) => (i in at ? at[i]! : v));
    const far = (xs: readonly number[], v: number) => xs.map((x, i) => (crowd.team[i] === 1 && i > below ? v : x));
    for (const [player, y, promoted, kept] of [
      [bridge, RAMPART, beside, [under, below]],
      [tunnel, 0, under, [beside]],
    ] as const) {
      const c: CrowdState = {
        ...crowd,
        x: put(far(crowd.x, 90), { [under]: 0, [beside]: 6, [below]: 0 }),
        z: put(far(crowd.z, 90), { [under]: 2, [beside]: 1, [below]: -9 }),
        surface: put(crowd.surface, { [under]: tunnel, [beside]: top, [below]: south }),
      };
      const fighters = m.duel.fighters.map((f, k) => (k === 0 ? { ...f, position: { x: 0, z: 0 }, y } : f));
      const after = stepBubbles({ ...m.duel, crowd: c, fighters }, 1, m.tick + 1, t).crowd!;
      expect(after.slot[promoted], `Player on ${field.arena.walk[player]!.id}`).toBeGreaterThan(0);
      for (const k of kept) expect(after.slot[k], `Player on ${field.arena.walk[player]!.id}, Soldier ${k}`).toBe(-1);
    }
  });
});

/**
 * A whole AI-v-AI Battle on `name` (to its end, or `cap` Ticks) with `checkLevels` on every Tick, and with `player` a Hard autopilot Player on
 * Team 0 whose Bubble never promotes a Soldier more than `levels.promote` above or below its Fighter. The Crowd step's own time is measured
 * beside it (run again from the same state, so it is only the measure).
 */
function war(t: TuningData, name: string, seed: number, cap: number, player: boolean) {
  const linked = joins(t, name);
  const field = battlefieldOf(t.battle, name)!;
  const map = battleMapOf(t.battle, name);
  const controllers = player ? poolControllers(t, [createBattlePilot(t, 'Hard')]) : [];
  let m = createMatch(t, { format: 'Battle', bestOf: 1, seed, arena: name, ...(player ? { teams: [0], weapons: ['Longsword'] } : {}) });
  let crossed = 0;
  let promoted = 0;
  const crowdMs: number[] = [];
  while (m.status.status === 'InProgress' && m.tick < cap) {
    const before = m;
    m = player ? stepMatchWith(m, controllers, t) : stepMatch(m, [], t);
    const c0 = performance.now();
    stepCrowd(before.duel.crowd!, m.tick, t.battle, [], map);
    crowdMs.push(performance.now() - c0);
    crossed += checkLevels(t, name, linked, before.duel.crowd!, m.duel.crowd!, m.tick);
    if (!player) continue;
    const c = m.duel.crowd!;
    const was = before.duel.crowd!;
    for (let i = 0; i < c.x.length; i++)
      if (was.slot[i]! < 0 && c.slot[i]! > 0 && c.players[0]!.soldier !== i) {
        promoted++;
        expect(Math.abs(soldierHeight(field, was.surface[i]!, was.x[i]!, was.z[i]!) - before.duel.fighters[0]!.y), `Soldier ${i} promoted at Tick ${m.tick}`).toBeLessThanOrEqual(t.battle.levels.promote);
      }
  }
  return { m, crossed, promoted, crowdMs };
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('Battles on several levels', () => {
  for (const [t, name] of [
    [onBridge, BRIDGE],
    [onPlatform, PLATFORM],
  ] as const)
    it(`play a 200 v 200 Battle on ${name} to its end by Tickets, every Soldier on the right level on every Tick`, () => {
      const { m, crossed, crowdMs } = war(t, name, 1, 60_000, false);
      const c = m.duel.crowd!;
      process.stderr.write(`${name} seed 1: ${m.status.status} at ${(m.tick / 60).toFixed(0)} s, Tickets ${c.tickets.map((x) => x.toFixed(0)).join(' / ')}, onto another level ${crossed} times; Crowd step ${mean(crowdMs).toFixed(2)} ms mean\n`);
      expect(m.status.status).toBe('Over');
      expect(c.rout).not.toBeNull();
      expect(c.tickets.some((x) => x <= 0)).toBe(true);
      expect(crossed).toBeGreaterThan(100);
    }, 600_000);

  it('promote round a Player on autopilot on the bridge map only Soldiers of its own level, every Soldier on the right level on every Tick', () => {
    const { promoted, crossed } = war(onBridge, BRIDGE, 2, 9000, true);
    process.stderr.write(`bridge with a Player: ${promoted} Promotions, onto another level ${crossed} times\n`);
    expect(promoted).toBeGreaterThan(20);
  }, 600_000);

  it('give the same hash every Tick from the same seed, and land a Rollback on the same state across Soldiers changing level', () => {
    const t = onBridge;
    let a = createMatch(t, { format: 'Battle', bestOf: 1, seed: 3, arena: BRIDGE });
    let b = createMatch(t, { format: 'Battle', bestOf: 1, seed: 3, arena: BRIDGE });
    const arena = battlefieldOf(t.battle, BRIDGE)!.arena;
    const saved = new Map<number, Snapshot<MatchState>>();
    const hashes = new Map<number, string>();
    const states = new Map<number, CrowdState>();
    for (let tick = 1; tick <= 9000; tick++) {
      a = stepMatch(a, [], t);
      b = stepMatch(b, [], t);
      hashes.set(tick, hashValue(a));
      if (tick % 250 === 0) expect(hashes.get(tick), `Tick ${tick}`).toBe(hashValue(b));
      if (tick % 100 === 0) saved.set(tick, snapshot(a));
      if (tick % 100 === 0 || tick % 100 === 15) states.set(tick, a.duel.crowd!);
    }
    let across = 0;
    for (const [tick, s] of saved) {
      if (tick + 15 > 9000) continue;
      let r = restore(s);
      for (let k = 0; k < 15; k++) r = stepMatch(r, [], t);
      expect(hashValue(r), `from Tick ${tick}`).toBe(hashes.get(tick + 15));
      // A window in which some Soldier stepped onto or off a ramp, the top, the bridge or the tunnel.
      const [from, to] = [states.get(tick)!, states.get(tick + 15)!];
      if (from.surface.some((v, i) => v !== to.surface[i] && from.alive[i] && to.alive[i] && (!arena.walk[v]!.id.startsWith('ground') || !arena.walk[to.surface[i]!]!.id.startsWith('ground')))) across++;
    }
    process.stderr.write(`bridge: ${across} of ${saved.size - 1} Rollback windows had a Soldier change level\n`);
    expect(across).toBeGreaterThan(5);
  }, 300_000);
});
