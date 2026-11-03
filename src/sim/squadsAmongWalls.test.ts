/**
 * docs/plans/battle-objectives.md, Stage 3b: Squads among walls. Each destination-field cell's clearance (its distance to the nearest
 * wall), Formations narrowing to the clearance ahead (a line becomes a column through a gate and opens out beyond it), a step into a wall
 * sliding along it, a Squad's place at an Objective chosen with room for it, Soldiers walled off from their places walking round to them,
 * and the stuck counter over whole Battles (how long each Soldier stays out of place: a measure, kept here in the harness, never state).
 * The open field has no walls, so none of it changes the open field.
 */
import { describe, expect, it } from 'vitest';
import { applyBattleKnobs, loadTuningData, type BattleTuning, type TuningData } from '../tuning';
import {
  battlefieldOf,
  battleMapOf,
  clearanceAt,
  COLUMN,
  createCrowd,
  createMatch,
  DEFEND,
  formationNarrow,
  formationSpot,
  hashValue,
  inBlock,
  inSight,
  LINE,
  LOOSE,
  orderSpot,
  placeOffset,
  pushOutOfBlocks,
  restore,
  snapshot,
  squadNarrows,
  squadsPerTeam,
  stepCrowd,
  stepMatch,
  type BattleMap,
  type CrowdState,
  type MatchState,
  type Snapshot,
} from '.';

const base = loadTuningData();
const tuning: TuningData = { ...base, battle: applyBattleKnobs(base.battle, { map: 'fort' }) };
const battle = tuning.battle;
const FORT = 'battle:fort';
const map = battleMapOf(battle, FORT);
const open = battleMapOf(base.battle, 'battle:1');

describe('clearance', () => {
  it("stores each field cell's distance to the nearest wall (negative inside one), the same at a cell's half turn, and none on the open field", () => {
    const f = map.fields;
    const cl = f.clearance!;
    const mid = (f.side - 1) / 2;
    for (let c = 0; c < f.side * f.side; c++) {
      const x = ((c % f.side) - mid) * f.cell;
      const z = (Math.floor(c / f.side) - mid) * f.cell;
      // Brute force: the nearest point of each block.
      let near = Infinity;
      for (const b of map.field.blocks) {
        const dx = Math.max(b.minX - x, 0, x - b.maxX);
        const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
        near = Math.min(near, dx === 0 && dz === 0 ? -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z) : Math.hypot(dx, dz));
      }
      expect(cl[c], `cell ${c}`).toBeCloseTo(near, 9);
      expect(cl[c]! < 0).toBe(inBlock(map.field, x, z));
      expect(cl[f.side * f.side - 1 - c]).toBeCloseTo(cl[c]!, 9);
    }
    // The south gate is 10 m between its towers: 5 m at its middle, falling evenly toward a tower between the cells' centres.
    expect(clearanceAt(f, 0, -32)).toBeCloseTo(5, 9);
    expect(clearanceAt(f, 2, -32)).toBeCloseTo(3, 9);
    expect(clearanceAt(f, 0, 32)).toBeCloseTo(5, 9);
    expect(open.fields.clearance).toBeNull();
    expect(clearanceAt(open.fields, 0, 0)).toBe(Infinity);
  });
});

describe('narrow passes', () => {
  it('narrow a line to a column in a gate, open it out beyond, and narrow a column further through the narrow breach', () => {
    const f = map.fields;
    // Team 0 marching north (+z) through the south gate on its middle line.
    expect(formationNarrow(battle, f, LINE, 12, 0, -60, 0)).toBe(0);
    expect(formationNarrow(battle, f, LINE, 12, 0, -32, 0)).toBe(battle.squad.column.wide);
    expect(formationNarrow(battle, f, LINE, 12, 0, -20, 0)).toBe(0);
    // A column fits the gate's middle as it is; through the 8 m breach east of it, fewer files.
    expect(formationNarrow(battle, f, COLUMN, 12, 0, -32, 0)).toBe(0);
    expect(formationNarrow(battle, f, COLUMN, 12, 21, -32, 0)).toBeGreaterThan(0);
    expect(formationNarrow(battle, f, COLUMN, 12, 21, -32, 0)).toBeLessThan(battle.squad.column.wide);
    // Off the middle of the gate there is less room either side.
    expect(formationNarrow(battle, f, COLUMN, 12, 2.5, -32, 0)).toBe(1);
    // A loose remnant spread wider than the room: in rows.
    expect(formationNarrow(battle, f, LOOSE, 8, 0, -32, 0)).toBeGreaterThan(0);
    // Team 1 at the half turn, marching south through the north gate, the same.
    expect(formationNarrow(battle, f, LINE, 12, 0, 32, Math.PI)).toBe(battle.squad.column.wide);
    expect(formationNarrow(battle, f, COLUMN, 12, -21, 32, Math.PI)).toBe(formationNarrow(battle, f, COLUMN, 12, 21, -32, 0));
    // Nothing narrows on the open field.
    for (const shape of [COLUMN, LINE, LOOSE]) expect(formationNarrow(base.battle, open.fields, shape, 12, 0, 0, 0)).toBe(0);
  });

  it('places a narrowed Formation in rows of that many files, centred on its living Soldiers, and leaves the rest as they were', () => {
    const out: [number, number] = [0, 0];
    const files = new Set<number>();
    const rows = new Set<number>();
    for (let place = 0; place < 9; place++) {
      placeOffset(battle, LINE, place, 0, out, 3, 9);
      files.add(Math.round(out[0] * 100) / 100);
      rows.add(Math.round(out[1] * 100) / 100);
    }
    expect([...files].sort((a, b) => a - b)).toEqual([-1.5, 0, 1.5]);
    expect([...rows].sort((a, b) => a - b)).toEqual([-1.5, 0, 1.5]);
    // Not narrowed (0), it is the Formation it always was.
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 0];
    for (const shape of [COLUMN, LINE, LOOSE])
      for (let place = 0; place < 12; place++) {
        placeOffset(battle, shape, place, 0.7, a);
        placeOffset(battle, shape, place, 0.7, b, 0, 5);
        expect(b).toEqual(a);
      }
  });
});

describe('walls', () => {
  it('slides a step that walks into a wall back out by the side it came in through, each Team the mirror of the other', () => {
    const field = battlefieldOf(battle, FORT)!;
    const out: [number, number] = [0, 0];
    // A step north into the south-east corner of the shed by A (x -58 to -54, z -16 to -8): its shallowest way out is east, but it came
    // in through the south face, so it slides along that.
    pushOutOfBlocks(field, -54.3, -15.5, 0.45, 0, out);
    expect(out[0]).toBeCloseTo(-53.55, 9);
    expect(pushOutOfBlocks(field, -54.3, -15.5, 0.45, 0, out, -54.3, -16.6)).toBe(true);
    expect(out).toEqual([-54.3, -16.45]);
    pushOutOfBlocks(field, 54.3, 15.5, 0.45, 1, out, 54.3, 16.6);
    expect(out).toEqual([54.3, 16.45]);
    // Diagonally in past a corner: the face crossed last.
    pushOutOfBlocks(field, -54.4, -15.8, 0.45, 0, out, -53.0, -16.5);
    expect(out[0]).toBeCloseTo(-53.55, 9);
    expect(out[1]).toBe(-15.8);
    // A body that started inside is put out by its shallowest side as before.
    pushOutOfBlocks(field, -54.3, -15.5, 0.45, 0, out, -54.3, -15.6);
    expect(out[0]).toBeCloseTo(-53.55, 9);
  });

  it("gives each Squad a place at an Objective with room for a column, outside a gatehouse's passage, each army's the half turn of the other's", () => {
    const per = squadsPerTeam(battle);
    const need = battle.squad.narrow.room + ((battle.squad.column.wide - 1) / 2) * battle.squad.spacing;
    const mine: [number, number] = [0, 0];
    const theirs: [number, number] = [0, 0];
    let roomy = 0;
    for (let k = 0; k < 5; k++)
      for (let q = 0; q < per; q++) {
        orderSpot(map, k, q, per, battle, mine);
        orderSpot(map, 4 - k, q + per, per, battle, theirs);
        expect(theirs[0]).toBeCloseTo(-mine[0], 9);
        expect(theirs[1]).toBeCloseTo(-mine[1], 9);
        expect(inBlock(map.field, mine[0], mine[1])).toBe(false);
        const o = map.field.objectives[k]!;
        expect(Math.hypot(mine[0] - o.x, mine[1] - o.z)).toBeLessThan(o.radius);
        if (clearanceAt(map.fields, mine[0], mine[1]) >= need) roomy++;
      }
    // Nearly every Squad finds room; at the gatehouses that means outside the passage, not in it.
    expect(roomy).toBeGreaterThan(0.9 * 5 * per);
    // The open field's places are the golden-angle spiral they always were.
    orderSpot(open, 2, 3, per, base.battle, mine);
    const o = open.field.objectives[2]!;
    const reach = 0.7 * o.radius * Math.sqrt(3.5 / per);
    expect(mine[0]).toBe(o.x + Math.sin(3 * 2.399963229728653) * reach);
    expect(mine[1]).toBe(o.z + Math.cos(3 * 2.399963229728653) * reach);
  });

  it("walks a Squad's Soldiers round the walls to their places when the anchor stands beyond a wall from them, none ever inside one", () => {
    const crowd = createCrowd(battle, 1, 0, FORT);
    const per = squadsPerTeam(battle);
    // Squad 0 stands in the courtyard at its place by B, defending it, its Order held through the test (given as if 25 s from now, so the
    // Commander's hold keeps it 40 s); its Soldiers are still south of the fort, at deployment. The enemy army starts fallen (it respawns at
    // its Base, far off), so nothing but the walls stands in the way.
    const spot: [number, number] = [0, 0];
    orderSpot(map, 2, 0, per, battle, spot);
    const set = <T,>(xs: readonly T[], k: number, v: T): T[] => xs.map((x, j) => (j === k ? v : x));
    const sq = crowd.squads;
    const fallen = (xs: readonly number[]) => xs.map((v, i) => (crowd.team[i] === 1 ? 0 : v));
    let c: CrowdState = { ...crowd, alive: fallen(crowd.alive), hp: fallen(crowd.hp), squads: { ...sq, x: set(sq.x, 0, spot[0]), z: set(sq.z, 0, spot[1]), heading: set(sq.heading, 0, 0), aim: set(sq.aim, 0, 0), order: set(sq.order, 0, DEFEND), target: set(sq.target, 0, 2), since: set(sq.since, 0, 25 * 60) } };
    const members = c.squad.flatMap((s, i) => (s === 0 ? [i] : []));
    const walledOff = members.filter((i) => !inSight(map.fields, c.x[i]!, c.z[i]!, spot[0], spot[1]));
    expect(walledOff.length).toBeGreaterThan(members.length / 2);
    const place: [number, number] = [0, 0];
    let arrived = -1;
    for (let tick = 1; tick <= 40 * 60; tick++) {
      c = stepCrowd(c, tick, battle, [], map);
      for (const i of members) expect(inBlock(map.field, c.x[i]!, c.z[i]!), `Soldier ${i} at Tick ${tick}`).toBe(false);
      const narrow = squadNarrows(battle, map, c.squads);
      const home = members.every((i) => {
        formationSpot(battle, map, c.squads, 0, c.place[i]!, narrow[0]!, place);
        return Math.hypot(place[0] - c.x[i]!, place[1] - c.z[i]!) <= 2 * battle.squad.spacing;
      });
      if (home) {
        arrived = tick;
        // Its anchor still stood at its place by B: the Soldiers came to it, not it to them.
        expect(Math.hypot(c.squads.x[0]! - spot[0], c.squads.z[0]! - spot[1])).toBeLessThan(2 * battle.squad.spacing);
        break;
      }
    }
    process.stderr.write(`Squad 0 walked round the walls to its places in ${(arrived / 60).toFixed(1)} s\n`);
    expect(arrived).toBeGreaterThan(0);
  });
});

/** Squads' widths (files) while their anchors walk through a gatehouse's passage. */
function gateWidths(m: MatchState, b: BattleTuning, bm: BattleMap): number[] {
  const sq = m.duel.crowd!.squads;
  const narrow = squadNarrows(b, bm, sq);
  const out: number[] = [];
  for (let q = 0; q < sq.team.length; q++) {
    if (sq.living[q] === 0 || sq.speed[q] === 0 || Math.abs(sq.x[q]!) >= 5 || Math.abs(sq.z[q]!) <= 27 || Math.abs(sq.z[q]!) >= 37) continue;
    // Not narrowed: a column's or a line's own files; a loose spiral's, as many places as its spread spans.
    const loose = Math.floor((2 * b.squad.loose.spread * Math.sqrt(Math.max(1, sq.living[q]!))) + 1);
    out.push(narrow[q]! > 0 ? narrow[q]! : sq.shape[q] === COLUMN ? b.squad.column.wide : sq.shape[q] === LINE ? b.squad.line.wide : loose);
  }
  return out;
}

/**
 * The stuck counter: for each Soldier steering to its place (living, in a Squad, in the Crowd, not engaged, no enemy in sight within
 * `crowd.sight`, its Team not routed), how long it has been more than two places (`2 × squad.spacing`) from its place in a row ("out of
 * place"), and how long of that it has not closed on it by `CLOSING` m a second ("stuck"). Sampled every `crowd.stagger` Ticks. A
 * measure only, so it lives here, not in the state.
 */
const CLOSING = 0.5;
interface StuckLog {
  /** The longest run (s) out of place, and stuck, of any Soldier, and how many runs out of place passed 10 s. */
  outOfPlace: number;
  stuck: number;
  over10: number;
  /** Samples a living Soldier stood inside a block. */
  inside: number;
}

function stuckWar(t: TuningData, arena: string, seed: number): { m: MatchState; log: StuckLog } {
  const b = t.battle;
  const bm = battleMapOf(b, arena);
  let m = createMatch(t, { format: 'Battle', bestOf: 1, seed, arena });
  const n = 2 * b.armySize;
  const every = b.crowd.stagger;
  const window = Math.round(60 / every);
  const run = new Float64Array(n);
  const stuck = new Float64Array(n);
  const past = new Float64Array(n * window).fill(Infinity);
  const log: StuckLog = { outOfPlace: 0, stuck: 0, over10: 0, inside: 0 };
  const place: [number, number] = [0, 0];
  let sample = 0;
  const end = (i: number) => {
    if (run[i]! / 60 > 10) log.over10++;
    run[i] = stuck[i] = 0;
    past.fill(Infinity, i * window, (i + 1) * window);
  };
  while (m.status.status === 'InProgress') {
    m = stepMatch(m, [], t);
    if (m.tick % every !== 0) continue;
    sample++;
    const c = m.duel.crowd!;
    const narrow = squadNarrows(b, bm, c.squads);
    for (let i = 0; i < n; i++) {
      const q = c.squad[i]!;
      if (!c.alive[i] || c.slot[i]! >= 0) continue;
      if (inBlock(bm.field, c.x[i]!, c.z[i]!)) log.inside++;
      let off = q >= 0 && !c.rout && c.target[i]! < 0;
      let d = 0;
      if (off) {
        formationSpot(b, bm, c.squads, q, c.place[i]!, narrow[q]!, place);
        d = Math.hypot(place[0] - c.x[i]!, place[1] - c.z[i]!);
        off = d > 2 * b.squad.spacing;
      }
      // An enemy in sight: it is in the fight (closing with it, or behind its own front rank), not out of place.
      for (let j = 0; off && j < n; j++)
        if (c.alive[j] && c.slot[j]! < 0 && c.team[j] !== c.team[i] && (c.x[j]! - c.x[i]!) ** 2 + (c.z[j]! - c.z[i]!) ** 2 <= b.crowd.sight ** 2 && inSight(bm.fields, c.x[i]!, c.z[i]!, c.x[j]!, c.z[j]!)) off = false;
      if (!off) {
        if (run[i]! > 0) end(i);
        continue;
      }
      run[i]! += every;
      const slot = i * window + (sample % window);
      const before = past[slot]!;
      past[slot] = d;
      stuck[i] = before !== Infinity && d > before - CLOSING ? stuck[i]! + every : before !== Infinity ? 0 : stuck[i]!;
      log.outOfPlace = Math.max(log.outOfPlace, run[i]! / 60);
      log.stuck = Math.max(log.stuck, stuck[i]! / 60);
    }
  }
  for (let i = 0; i < n; i++) if (run[i]! > 0) end(i);
  return { m, log };
}

describe('Squads among walls, over whole Battles', () => {
  it('narrow every Squad to a column or fewer files while it marches through a gate', () => {
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2, arena: FORT });
    const widths: number[] = [];
    while (m.status.status === 'InProgress' && m.tick < 20_000) {
      m = stepMatch(m, [], tuning);
      if (m.tick % 30 === 0) widths.push(...gateWidths(m, battle, map));
    }
    process.stderr.write(`Squads in a gate: ${widths.length} samples, widths ${[1, 2, 3, 4, 5, 6].map((w) => `${w}: ${widths.filter((x) => x === w).length}`).join(', ')}\n`);
    expect(widths.length).toBeGreaterThan(50);
    expect(Math.max(...widths)).toBeLessThanOrEqual(battle.squad.column.wide);
  }, 120_000);

  it('log how long Soldiers stay out of place on the Fort and on the open field: on the Fort none is stuck for long, none stands in a wall', () => {
    for (const [t, arena, seed] of [
      [tuning, FORT, 1],
      [tuning, FORT, 2],
      [base, 'battle:1', 1],
    ] as const) {
      const { m, log } = stuckWar(t, arena, seed);
      const c = m.duel.crowd!;
      process.stderr.write(
        `${arena} seed ${seed}: ended at ${(c.rout!.tick / 60).toFixed(0)} s; longest out of place ${log.outOfPlace.toFixed(1)} s (${log.over10} runs over 10 s), longest stuck ${log.stuck.toFixed(1)} s; inside a wall ${log.inside}\n`,
      );
      expect(m.status.status).toBe('Over');
      expect(log.inside).toBe(0);
      if (arena === FORT) expect(log.stuck).toBeLessThan(20);
    }
  }, 600_000);

  it('land a Rollback on the same state across Squads narrowing and Soldiers walking round the walls', () => {
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 5, arena: FORT });
    const saved = new Map<number, Snapshot<MatchState>>();
    const hashes = new Map<number, string>();
    let narrowedAt = 0;
    for (let t = 1; t <= 6000; t++) {
      m = stepMatch(m, [], tuning);
      hashes.set(t, hashValue(m));
      if (t % 300 === 0) {
        saved.set(t, snapshot(m));
        if (squadNarrows(battle, map, m.duel.crowd!.squads).some((w) => w > 0)) narrowedAt++;
      }
    }
    expect(narrowedAt).toBeGreaterThan(5);
    for (const [t, s] of saved) {
      if (t + 15 > 6000) continue;
      let r = restore(s);
      for (let k = 0; k < 15; k++) r = stepMatch(r, [], tuning);
      expect(hashValue(r), `from Tick ${t}`).toBe(hashes.get(t + 15));
    }
  }, 120_000);
});
