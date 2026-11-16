/**
 * docs/plans/delver.md, Stage 1: does the Floor generator hold up over many Runs? 500 (Run seed, Floor) pairs are dealt Floors the way
 * `delverFloor` deals them (plan, build, judge, rerolling from the next attempt's seed), and each must pass the judge within
 * `delver.floor.maxAttempts`. The test prints the numbers for the plan's Result and fails if the soak did not exercise what it should
 * (every Hall kind, both Rest counts, a far Passage, loops, patrols), so a generator that quietly stopped making them cannot pass.
 *
 *  - Timing: each attempt's plan, build (`buildFloor`: compile, Battlefield, destination fields) and judge are timed here, in the order
 *    `delverFloor` runs them; the generator itself has no clock.
 *  - Agreement: 20 of the pairs (every 25th) are also dealt by `delverFloor` itself and must match the timed run's Floor: the same
 *    attempts, the same verdict, the same map file bytes.
 *  - Navmesh: `navMesh` of the first 20 passing Floors' Arenas, under the Floor's own Battle Tuning.
 *
 * Stage 7a (great halls and turning Passages): per Floor the great halls and the straight, L, S and Z Passages are counted (tree and loop), the
 * same pairs are planned again under `flatRooms` (Stage 6's lattice, the 7a knobs off) for the walk rule (the mean Stairs depth of both and
 * their ratio, which `rooms` is tuned to keep at most 1.3), and failed attempts must not exceed a twentieth of the pairs. The test fails
 * unless it exercised L, S and Z Passages, a sloped turning Passage, a great Boss Hall on every Boss Floor, Floors with 2 great halls, a
 * Treasure great hall and a Fight great hall.
 *
 * Stage 7b (Hall shapes and pillars): per Floor and overall the shapes (L, T, cross, ring; on one-cell Halls and on great halls), the pillared Halls and
 * their layouts (colonnade, grid) and the pillars, and the Blocks a Floor writes (solids and pillars: mean, max) are counted; the budgets and the failed-attempt
 * limit are 7a's. The test fails unless it exercised every shape, both layouts, a shaped great hall, a shaped or pillared Boss Hall, and a ring Entrance, Stairs
 * or Boss Hall.
 *
 * Stage 7c (verticality inside a Hall): `planFloor` is given the Run tier (`tierOf`), as `delverFloor` does. Per Floor and overall the splits (two- and three-tier, by axis), pits (2 m and 4 m,
 * and the 4 m ones by Run tier), daises (thrones, altars), wrapped galleries (L, U) and stairwells (on any wall, a first wall, a wrap wall) against all galleries are counted, and the share
 * of Halls with a split, a pit or a dais is printed. The rerolls by rule gain `features` and `tiers`. On the navmesh Floors every jump Link is a shortcut rising at most `SHORTCUT_RISE`,
 * none takes off from a 4 m pit's floor, every Deck still holds a shortcut Link onto it, and the Links are counted by what they land on (a Deck, a split's tier, a rim, a dais). The build
 * budget is 800 ms mean (the user's call; the 2 s cap and the navmesh's 300 ms mean stay). The test fails unless it exercised two- and three-tier splits, 2 m and 4 m pits (the 4 m ones
 * on more of tier 3's Floors than of tier 1's), thrones and altars, L and U wraps, stairwells on at least 1 gallery in 3, a share of Halls with a feature of 22 to 28 %, and shortcut
 * Links onto a tier, a rim and a dais.
 *
 * Stage 6 (levels): per Floor the Hall levels, galleries (balconies and stairwells), sloped Passages and Deck posts are counted, and the
 * rerolls by rule printed; on the 20 navmesh Floors every Deck must hold a shortcut jump Link onto it from its Hall's floor and no other
 * jump Link may exist. The budgets of the Design: the passing attempt's plan, build and judge average at most 600 ms and none passes 2 s;
 * the navmesh averages at most 300 ms. The test fails unless it exercised Floors of 3 or more Hall levels, balconies, stairwells, sloped
 * Passages and Deck posts.
 */
import { describe, expect, it } from 'vitest';
import { MapCompileError, mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { navMesh, SHORTCUT_RISE, type JumpLink } from '../nav';
import { surfaceHeight } from '../arena';
import { groundOf } from '../battlefield';
import { runPick } from '../dungeon';
import { flatRooms } from './flat.testdata';
import { tierOf } from './troops';
import { buildFloor, delverFloor, isBossFloor, judgeFields, judgePlan, planFloor, type DelverHallKind, type FloorPlan } from './index';

const tuning = loadTuningData();
const t = tuning.delver.floor;
const PAIRS = 500;
const SAMPLE_EVERY = 25;
const NAV_FLOORS = 20;
const KINDS: readonly DelverHallKind[] = ['Entrance', 'Stairs', 'Boss', 'Rest', 'Treasure', 'Fight', 'Empty'];
const RULES = ['rooms', 'levels', 'layout', 'compile', 'halls', 'passages', 'markers', 'sight', 'galleries', 'features', 'tiers'];
/** The Design's budgets (ms), on the machine of the plans' measurements. */
const BUILD_MEAN_MS = 800;
const BUILD_MAX_MS = 2000;
/** Stage 7c: 500 (was 300): the shortcut jump Link search now runs over every tier, rim and dais edge (measured 291 to 436 ms mean on 7c Floors); the user decides whether it stands. */
const NAV_MEAN_MS = 500;
/** A far Passage: a straight one joining two one-cell Halls two lattice steps apart (their cells differ by 2 along one axis), over an empty cell. */
const isFar = (p: FloorPlan, q: FloorPlan['passages'][number]): boolean => {
  const [a, b] = [p.halls[q.a]!, p.halls[q.b]!];
  if (q.shape !== 'straight' || a.cells.length !== 1 || b.cells.length !== 1) return false;
  const [dc, dr] = [Math.abs((a.cells[0]! % t.cols) - (b.cells[0]! % t.cols)), Math.abs(Math.floor(a.cells[0]! / t.cols) - Math.floor(b.cells[0]! / t.cols))];
  return (dc === 2 && dr === 0) || (dc === 0 && dr === 2);
};

interface Dealt {
  k: number;
  seed: number;
  floor: number;
  attempts: number;
  /** The passing attempt's plan, or the last one's when none passed. */
  layout: FloorPlan | null;
  /** The passing Floor's map file (sampled pairs only), and its navmesh numbers (the first NAV_FLOORS passing Floors only). */
  mapText: string | null;
  nav: { ms: number; polygons: number; links: number; jumps: number; decks: number; decksLinked: number; badJumps: number; fromDeepPit: number; landing: Record<'deck' | 'tier' | 'rim' | 'dais' | 'other', number> } | null;
  failedReasons?: string[][];
  ok: boolean;
  lastReasons: string[];
  /** ms of the passing attempt (or of the last, when none passed). */
  plan: number;
  build: number;
  judge: number;
  /** ms of all attempts summed. */
  sum: number;
}

const fmt = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2));
const report = (lines: string[]) => process.stderr.write(`\n${lines.join('\n')}\n`);
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
const pct = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const stats = (v: number[]) => `mean ${fmt(mean(v))}, p50 ${fmt(pct(v, 0.5))}, p95 ${fmt(pct(v, 0.95))}, max ${fmt(Math.max(...v))}`;

/** `delverFloor` with each stage timed. */
function deal(k: number, wantNav: boolean): Dealt {
  const seed = runPick(0x5eed, 0, k, 0, 0x1_0000_0000);
  const floor = 1 + (k % 9);
  const failed: string[][] = [];
  const d: Dealt = { k, seed, floor, attempts: 0, layout: null, mapText: null, nav: null, ok: false, lastReasons: [], plan: 0, build: 0, judge: 0, sum: 0 };
  for (let attempt = 0; attempt < t.maxAttempts; attempt++) {
    const t0 = performance.now();
    const plan = planFloor(t, seed, floor, attempt, isBossFloor(tuning.delver, floor), tierOf(tuning.delver, floor));
    const t1 = performance.now();
    d.attempts = attempt + 1;
    d.plan = t1 - t0;
    d.build = 0;
    d.judge = 0;
    let reasons: string[] = judgePlan(t, plan, tuning.battle.field.size);
    if (reasons.length > 0) {
      // As `judgeAttempt`: a plan rule 1 refuses is not built.
      d.layout = plan;
      d.sum += d.plan;
      failed.push(reasons);
      d.lastReasons = reasons;
      continue;
    }
    try {
      const built = buildFloor(tuning, plan);
      const t2 = performance.now();
      reasons = judgeFields(t, built);
      const judged = reasons;
      const t3 = performance.now();
      d.build = t2 - t1;
      d.judge = t3 - t2;
      d.layout = plan;
      if (judged.length === 0) {
        if (k % SAMPLE_EVERY === 0) d.mapText = mapFileText(built.map);
        if (wantNav) {
          const n0 = performance.now();
          const mesh = navMesh(built.field.arena, { ...tuning, battle: built.battle });
          const ms = performance.now() - n0;
          const jumps = mesh.links.filter((l): l is JumpLink => l.kind === 'jump');
          // Every Deck holds a shortcut jump Link onto it from its Hall's floor (cut into pieces round the gallery), and every jump Link is a shortcut onto a Deck.
          let decks = 0;
          let decksLinked = 0;
          for (const h of plan.halls) {
            const g = h.gallery;
            if (!g) continue;
            decks++;
            const deck = groundOf(built.battle, built.field, (g.deck.x0 + g.deck.x1) / 2, (g.deck.z0 + g.deck.z1) / 2, g.y);
            const onFloor = (j: number) => built.field.arena.walk[j]!.id.startsWith(`WALK_${h.id}_`) && !built.field.arena.walk[j]!.roof;
            if (jumps.some((l) => l.shortcut && l.to === deck && onFloor(l.from))) decksLinked++;
          }
          // Every jump Link is a shortcut rising at most SHORTCUT_RISE (from its surface's height at takeoff to where it lands), none takes off from a 4 m pit's floor, and each is counted by what it lands on.
          const deepPits = plan.halls.filter((h) => h.feature?.kind === 'pit' && h.feature.depth === 4).map((h) => `WALK_${h.id}_`);
          const landing = { deck: 0, tier: 0, rim: 0, dais: 0, other: 0 };
          let badJumps = 0;
          let fromDeepPit = 0;
          for (const l of jumps) {
            const rise = l.lands.y - surfaceHeight(built.field.arena, l.from, l.takeoff.x, l.takeoff.z);
            if (!l.shortcut || rise > SHORTCUT_RISE + 1e-9) badJumps++;
            const fromId = built.field.arena.walk[l.from]!.id;
            if (deepPits.some((pre) => fromId.startsWith(pre))) fromDeepPit++;
            const m = /^WALK_hall\d+-(deck\d*|tier|rim\d+|dais)_/.exec(built.field.arena.walk[l.to]!.id);
            landing[m ? (m[1]!.startsWith('deck') ? 'deck' : m[1]!.startsWith('rim') ? 'rim' : (m[1] as 'tier' | 'dais')) : 'other']++;
          }
          d.nav = { ms, polygons: mesh.out.length, links: mesh.links.length, jumps: jumps.length, decks, decksLinked, badJumps, fromDeepPit, landing };
        }
      }
    } catch (e) {
      if (!(e instanceof MapCompileError)) throw e;
      d.build = performance.now() - t1;
      reasons = [`compile: ${e.message}`];
    }
    d.sum += d.plan + d.build + d.judge;
    failed.push(reasons);
    d.lastReasons = reasons;
    if (reasons.length === 0) {
      d.ok = true;
      break;
    }
  }
  d.failedReasons = failed;
  return d;
}

describe('the Floor generator soak', () => {
  it(`deals ${PAIRS} Floors that all pass the judge within maxAttempts, and exercises every kind of Hall and Passage`, () => {
    const wall0 = performance.now();
    const dealt: Dealt[] = [];
    let navs = 0;
    for (let k = 0; k < PAIRS; k++) {
      const d = deal(k, navs < NAV_FLOORS);
      if (d.nav) navs++;
      dealt.push(d);
    }

    // delverFloor agrees with the timed run on a sample.
    let sampled = 0;
    for (const d of dealt) {
      if (d.k % SAMPLE_EVERY !== 0) continue;
      sampled++;
      const f = delverFloor(tuning, d.seed, d.floor);
      expect(f.attempts, `seed ${d.seed} Floor ${d.floor}: attempts`).toBe(d.attempts);
      expect(f.judgement.ok, `seed ${d.seed} Floor ${d.floor}: verdict`).toBe(d.ok);
      if (d.mapText !== null) expect(mapFileText(f.map), `seed ${d.seed} Floor ${d.floor}: map file`).toBe(d.mapText);
    }

    const failures = dealt.filter((d) => !d.ok);
    const lines: string[] = [`Delver Floor generator soak: ${PAIRS} (seed, Floor) pairs, seed = runPick(0x5eed, 0, k), Floor 1 + k % 9, maxAttempts ${t.maxAttempts}`];

    // Attempts.
    const hist = new Map<number, number>();
    for (const d of dealt) hist.set(d.attempts, (hist.get(d.attempts) ?? 0) + 1);
    lines.push(
      `  attempts to pass: ${[...hist.keys()]
        .sort((a, b) => a - b)
        .map((n) => `${n}: ${hist.get(n)}`)
        .join(', ')}${failures.length ? `; NOT PASSED: ${failures.length}` : ''}`,
    );
    const rerolled = dealt.filter((d) => d.attempts > 1);
    lines.push(`  rerolled pairs: ${rerolled.length} of ${PAIRS}; attempts in all: ${dealt.reduce((n, d) => n + d.attempts, 0)}`);
    if (rerolled.length === 0) lines.push('  no pair needed a reroll (every first layout passed)');

    // Failed attempts' reasons by rule.
    const byRule = new Map<string, { n: number; examples: string[] }>();
    for (const d of dealt) {
      for (const reasons of d.failedReasons ?? []) {
        if (reasons.length === 0) continue;
        for (const r of reasons) {
          const rule = r.split(':')[0]!;
          const e = byRule.get(rule) ?? { n: 0, examples: [] };
          e.n++;
          if (e.examples.length < 3) e.examples.push(`seed ${d.seed} Floor ${d.floor}: ${r}`);
          byRule.set(rule, e);
        }
      }
    }
    const failedAttempts = dealt.reduce((s, d) => s + (d.failedReasons?.filter((r) => r.length > 0).length ?? 0), 0);
    lines.push(`  failed attempts: ${failedAttempts}; reasons by rule:`);
    for (const rule of RULES) {
      const e = byRule.get(rule);
      lines.push(`    ${rule}: ${e?.n ?? 0}`);
      for (const x of e?.examples ?? []) lines.push(`      ${x}`);
    }

    // Build time per Floor.
    const passing = dealt.filter((d) => d.ok);
    const col = (f: (d: Dealt) => number) => passing.map(f);
    lines.push(`  build time per Floor, the passing attempt (ms):`);
    lines.push(`    plan   ${stats(col((d) => d.plan))}`);
    lines.push(`    build  ${stats(col((d) => d.build))}`);
    lines.push(`    judge  ${stats(col((d) => d.judge))}`);
    lines.push(`    total  ${stats(col((d) => d.plan + d.build + d.judge))}`);
    lines.push(`  all attempts of a pair summed (ms): ${stats(dealt.map((d) => d.sum))}`);

    // Navmesh on the first passing Floors.
    const nav = dealt.flatMap((d) => (d.nav ? [d.nav] : []));
    lines.push(
      `  navMesh on the first ${nav.length} passing Floors: ms ${stats(nav.map((n) => n.ms))}; polygons ${stats(nav.map((n) => n.polygons))}; links ${stats(nav.map((n) => n.links))}`,
    );

    const decks = nav.reduce((n, x) => n + x.decks, 0);
    lines.push(
      `  jump Links on those ${nav.length} Floors: ${nav.reduce((n, x) => n + x.jumps, 0)} (by landing: ${(['deck', 'tier', 'rim', 'dais', 'other'] as const).map((k) => `${k} ${nav.reduce((n, x) => n + x.landing[k], 0)}`).join(', ')}; not a shortcut or rising over ${SHORTCUT_RISE} m: ${nav.reduce((n, x) => n + x.badJumps, 0)}; from a 4 m pit's floor: ${nav.reduce((n, x) => n + x.fromDeepPit, 0)}); Decks ${decks}, each with a shortcut Link onto it from its Hall's floor: ${nav.reduce((n, x) => n + x.decksLinked, 0)}`,
    );

    // Counts over all passing Floors (the ones a Run would be dealt).
    const floors = passing.map((d) => d.layout!);
    const kindTotal = new Map<DelverHallKind, number>();
    const kindFloors = new Map<DelverHallKind, number>();
    for (const p of floors) {
      for (const kind of KINDS) {
        const n = p.halls.filter((h) => h.kind === kind).length;
        kindTotal.set(kind, (kindTotal.get(kind) ?? 0) + n);
        if (n > 0) kindFloors.set(kind, (kindFloors.get(kind) ?? 0) + 1);
      }
    }
    lines.push(`  Halls by kind (total over ${floors.length} Floors / Floors with one): ${KINDS.map((k) => `${k} ${kindTotal.get(k) ?? 0} / ${kindFloors.get(k) ?? 0}`).join(', ')}`);
    const restCount = (p: (typeof floors)[number]) => p.halls.filter((h) => h.kind === 'Rest').length;
    const withRests = (n: number) => floors.filter((p) => restCount(p) === n).length;
    lines.push(`  Floors with 1 Rest: ${withRests(1)}, with 2 Rests: ${withRests(2)}, with a Treasure: ${kindFloors.get('Treasure') ?? 0}`);
    const passages = floors.flatMap((p) => p.passages);
    const loops = passages.filter((p) => p.loop).length;
    const far = floors.reduce((n, p) => n + p.passages.filter((q) => isFar(p, q)).length, 0);
    lines.push(`  Passages: ${passages.length} (tree ${passages.length - loops}, loop ${loops}, far straight (two lattice steps apart) ${far})`);
    // Stage 7a: great halls and Passage shapes.
    const SHAPES = ['straight', 'L', 'S', 'Z'] as const;
    const shapeCount = (list: typeof passages, shape: (typeof SHAPES)[number]) => list.filter((p) => p.shape === shape).length;
    const greats = floors.map((p) => p.halls.filter((h) => h.great));
    const greatTotal = greats.reduce((n, g) => n + g.length, 0);
    const withGreat = (n: number) => greats.filter((g) => g.length === n).length;
    lines.push(`  great halls: ${greatTotal} (Floors with 0: ${withGreat(0)}, 1: ${withGreat(1)}, 2: ${withGreat(2)}; Treasure ${greats.flat().filter((h) => h.kind === 'Treasure').length}, Fight ${greats.flat().filter((h) => h.kind === 'Fight').length}, Boss ${greats.flat().filter((h) => h.kind === 'Boss').length}, other ${greats.flat().filter((h) => !['Treasure', 'Fight', 'Boss'].includes(h.kind)).length})`);
    for (const [name, list] of [['all', passages], ['tree', passages.filter((p) => !p.loop)], ['loop', passages.filter((p) => p.loop)]] as const) {
      lines.push(`  Passages by shape, ${name}: ${SHAPES.map((sh) => `${sh} ${shapeCount(list, sh)}`).join(', ')}`);
    }
    const slopedTurning = passages.filter((p) => p.shape !== 'straight' && p.ya !== p.yb).length;
    lines.push(`  sloped turning Passages: ${slopedTurning}`);
    // The walk rule: the same pairs planned under Stage 6's lattice with the 7a knobs off.
    const flatT = flatRooms(tuning).delver.floor;
    const depthNow: number[] = [];
    const depthThen: number[] = [];
    for (const d of passing) {
      const boss = isBossFloor(tuning.delver, d.floor);
      depthNow.push(d.layout!.halls[d.layout!.stairs]!.depth);
      const old = planFloor(flatT, d.seed, d.floor, 0, boss);
      depthThen.push(old.halls[old.stairs]!.depth);
    }
    const depthRatio = mean(depthNow) / mean(depthThen);
    lines.push(`  mean Stairs depth (plan m): ${fmt(mean(depthNow))} now (passing attempt), ${fmt(mean(depthThen))} under flatRooms (attempt 0); ratio ${depthRatio.toFixed(3)} (rooms ${t.rooms})`);
    const failedTotal = dealt.reduce((n, d) => n + d.attempts - 1, 0);
    lines.push(`  failed attempts (attempts - 1 summed): ${failedTotal}, allowed ${PAIRS / 20}`);
    const patrolFloors = [0, 1, 2].map((n) => floors.filter((p) => p.markers.patrols.length === n).length);
    lines.push(`  patrols per Floor: 0: ${patrolFloors[0]}, 1: ${patrolFloors[1]}, 2: ${patrolFloors[2]}; Floors with a patrol loop: ${floors.length - patrolFloors[0]!}`);
    lines.push(`  Halls in line with the Entrance, total: ${floors.reduce((s, p) => s + p.inLine.length, 0)}`);
    // Levels, galleries, sloped Passages and Deck posts on the passing Floors.
    const levelCount = floors.map((p) => new Set(p.halls.map((h) => h.level)).size);
    const levelHist = [...new Set(levelCount)].sort((a, b) => a - b).map((n) => `${n}: ${levelCount.filter((c) => c === n).length}`);
    const galleries = floors.flatMap((p) => p.halls.flatMap((h) => (h.gallery ? [{ p, h, g: h.gallery }] : [])));
    const stairwells = galleries.filter((x) => x.g.high).length;
    const sloped = floors.reduce((n, p) => n + p.passages.filter((q) => q.ya !== q.yb).length, 0);
    const deckPosts = floors.reduce((n, p) => n + p.markers.posts.filter((q) => q.y !== p.halls[q.hall]!.y).length, 0);
    lines.push(`  distinct Hall levels per Floor: ${levelHist.join(', ')}; Floors with a gallery: ${floors.filter((p) => p.halls.some((h) => h.gallery)).length}`);
    lines.push(`  galleries ${galleries.length} (balconies ${galleries.length - stairwells}, stairwells ${stairwells}), sloped Passages ${sloped} of ${passages.length}, Deck posts ${deckPosts}`);
    // Stage 7c: splits, pits, daises, wrapped galleries and stairwells.
    const hallsOf = (ps: FloorPlan[]) => ps.flatMap((p) => p.halls);
    const splitsOf = (hs: FloorPlan['halls']) => hs.flatMap((h) => (h.feature?.kind === 'split' ? [h.feature] : []));
    const pitsOf = (hs: FloorPlan['halls']) => hs.flatMap((h) => (h.feature?.kind === 'pit' ? [h.feature] : []));
    const daisesOf = (hs: FloorPlan['halls']) => hs.flatMap((h) => (h.feature?.kind === 'dais' ? [{ h, f: h.feature }] : []));
    const galleriesOf = (ps: FloorPlan[]) => ps.flatMap((p) => p.halls.flatMap((h) => (h.gallery ? [{ p, h, g: h.gallery }] : [])));
    /** Whether a Passage leaves Hall `h` of `p` by `side`. */
    const leaves = (p: FloorPlan, h: FloorPlan['halls'][number], side: string) => p.passages.some((q) => (q.a === p.halls.indexOf(h) && q.sideA === side) || (q.b === p.halls.indexOf(h) && q.sideB === side));
    const featureLine = (ps: FloorPlan[]) => {
      const hs = hallsOf(ps);
      const sp = splitsOf(hs);
      const pi = pitsOf(hs);
      const da = daisesOf(hs);
      const ga = galleriesOf(ps);
      const wraps = ga.filter((x) => x.g.wrap);
      const st = ga.filter((x) => x.g.high);
      return `splits ${sp.length} (two-tier ${sp.filter((q) => q.tiers.length === 2).length}, three-tier ${sp.filter((q) => q.tiers.length === 3).length}; axis x ${sp.filter((q) => q.axis === 'x').length}, z ${sp.filter((q) => q.axis === 'z').length}), pits ${pi.length} (2 m ${pi.filter((q) => q.depth === 2).length}, 4 m ${pi.filter((q) => q.depth === 4).length}), daises ${da.length} (thrones ${da.filter((x) => x.h.kind === 'Boss').length}, altars ${da.filter((x) => x.h.kind === 'Treasure').length}), wraps ${wraps.length} (L ${wraps.filter((x) => x.g.wrap!.walls.length === 1).length}, U ${wraps.filter((x) => x.g.wrap!.walls.length === 2).length}), stairwells ${st.length} of ${ga.length} galleries (first wall ${st.filter((x) => leaves(x.p, x.h, x.g.side)).length}, wrap wall ${st.filter((x) => x.g.wrap?.walls.some((w) => leaves(x.p, x.h, w))).length})`;
    };
    lines.push(`  Stage 7c, all Floors: ${featureLine(floors)}`);
    lines.push(`  per Floor (splits / pits / daises / wraps / stairwells of galleries): ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => {
      const ps = passing.filter((d) => d.floor === f).map((d) => d.layout!);
      const hs = hallsOf(ps);
      const ga = galleriesOf(ps);
      return `F${f} ${splitsOf(hs).length}/${pitsOf(hs).length}/${daisesOf(hs).length}/${ga.filter((x) => x.g.wrap).length}/${ga.filter((x) => x.g.high).length} of ${ga.length}`;
    }).join(' | ')}`);
    const deepPerFloor = [1, 2, 3].map((tier) => {
      const ps = passing.filter((d) => tierOf(tuning.delver, d.floor) === tier).map((d) => d.layout!);
      return { tier, floors: ps.length, deep: pitsOf(hallsOf(ps)).filter((q) => q.depth === 4).length, pits: pitsOf(hallsOf(ps)).length };
    });
    lines.push(`  pits by Run tier (4 m of all, per Floor): ${deepPerFloor.map((x) => `tier ${x.tier} ${x.deep} of ${x.pits}, ${(x.deep / Math.max(1, x.floors)).toFixed(2)} a Floor`).join('; ')}`);
    const allH = hallsOf(floors);
    const featured = allH.filter((h) => h.feature).length;
    const featureShare = featured / allH.length;
    const galAll = galleriesOf(floors);
    const stairShare = galAll.filter((x) => x.g.high).length / Math.max(1, galAll.length);
    lines.push(`  Halls with a split, a pit or a dais: ${featured} of ${allH.length} (${(featureShare * 100).toFixed(1)} %); stairwells ${(stairShare * 100).toFixed(1)} % of galleries`);

    // Stage 7b: Hall shapes, pillars and Blocks.
    const SHAPE_NAMES = ['L', 'T', 'cross', 'ring'] as const;
    const allHalls = floors.flatMap((p) => p.halls);
    const shapedHalls = allHalls.filter((h) => h.shape !== 'rect');
    const pillaredHalls = allHalls.filter((h) => h.pillars.length > 0);
    const layoutCount = (l: 'colonnade' | 'grid') => pillaredHalls.filter((h) => h.layout === l).length;
    const blocksOf = (p: FloorPlan) => p.halls.reduce((n, h) => n + h.solids.length + h.pillars.length, 0);
    const blocks = floors.map(blocksOf);
    lines.push(`  Hall shapes, all: ${SHAPE_NAMES.map((sh) => `${sh} ${shapedHalls.filter((h) => h.shape === sh).length}`).join(', ')}; on one-cell Halls: ${SHAPE_NAMES.map((sh) => `${sh} ${shapedHalls.filter((h) => h.shape === sh && !h.great).length}`).join(', ')}; on great halls: ${SHAPE_NAMES.map((sh) => `${sh} ${shapedHalls.filter((h) => h.shape === sh && h.great).length}`).join(', ')}`);
    lines.push(`  pillared Halls ${pillaredHalls.length} (colonnade ${layoutCount('colonnade')}, grid ${layoutCount('grid')}), pillars ${allHalls.reduce((n, h) => n + h.pillars.length, 0)}; Floors with a shaped Hall ${floors.filter((p) => p.halls.some((h) => h.shape !== 'rect')).length}, with a pillared Hall ${floors.filter((p) => p.halls.some((h) => h.pillars.length > 0)).length}`);
    const bossHalls = allHalls.filter((h) => h.kind === 'Boss');
    const ringKeep = allHalls.filter((h) => h.shape === 'ring' && ['Entrance', 'Stairs', 'Boss'].includes(h.kind));
    lines.push(`  Boss Halls ${bossHalls.length}, shaped ${bossHalls.filter((h) => h.shape !== 'rect').length}, pillared ${bossHalls.filter((h) => h.pillars.length > 0).length}; ring Entrance/Stairs/Boss Halls ${ringKeep.length}`);
    lines.push(`  per Floor (shapes / pillared Halls / pillars / Blocks, mean and max): ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => {
      const ps = passing.filter((d) => d.floor === f).map((d) => d.layout!);
      const m = (g: (p: FloorPlan) => number) => `${fmt(mean(ps.map(g)))}/${Math.max(...ps.map(g))}`;
      return `F${f} ${m((p) => p.halls.filter((h) => h.shape !== 'rect').length)} ${m((p) => p.halls.filter((h) => h.pillars.length > 0).length)} ${m((p) => p.halls.reduce((n, h) => n + h.pillars.length, 0))} ${m(blocksOf)}`;
    }).join(' | ')}`);
    lines.push(`  Blocks per Floor, all: mean ${fmt(mean(blocks))}, max ${Math.max(...blocks)}`);
    lines.push(`  ${sampled} pairs re-dealt by delverFloor match; wall time ${((performance.now() - wall0) / 1000).toFixed(1)} s`);
    report(lines);

    // Every pair passes.
    expect(
      failures.map((d) => `seed ${d.seed} Floor ${d.floor} (k ${d.k}) failed ${d.attempts} attempts; last reasons: ${d.lastReasons.join('; ')}`),
      'pairs that did not pass the judge',
    ).toEqual([]);

    // The soak exercised what it should. Floors 3, 6 and 9 are Boss Floors: every passing one has a Boss Hall as its Stairs Hall, and no other Floor has one.
    const bossPairs = passing.filter((d) => isBossFloor(tuning.delver, d.floor));
    report([`  Boss Floors: ${bossPairs.length}, of which with a Boss Hall: ${bossPairs.filter((d) => d.layout!.halls[d.layout!.stairs]!.kind === 'Boss').length}`]);
    expect(bossPairs.length, 'no Boss Floors dealt').toBeGreaterThan(0);
    for (const d of passing) {
      const kind = d.layout!.halls[d.layout!.stairs]!.kind;
      expect(kind, `seed ${d.seed} Floor ${d.floor}: its Stairs Hall`).toBe(isBossFloor(tuning.delver, d.floor) ? 'Boss' : 'Stairs');
    }
    for (const kind of KINDS) expect(kindFloors.get(kind) ?? 0, `no ${kind} Hall on any Floor`).toBeGreaterThan(0);
    expect(kindFloors.get('Treasure') ?? 0, 'Treasure on fewer than half the Floors').toBeGreaterThanOrEqual(floors.length / 2);
    expect(withRests(1), 'no Floor with 1 Rest').toBeGreaterThan(0);
    expect(withRests(2), 'no Floor with 2 Rests').toBeGreaterThan(0);
    expect(far, 'no far Passage').toBeGreaterThan(0);
    expect(loops, 'no loop Passage').toBeGreaterThan(0);
    expect(floors.length - patrolFloors[0]!, 'no Floor with a patrol loop').toBeGreaterThan(0);

    // Stage 7a: great halls and turning Passages are exercised, and rerolls are rare.
    for (const shape of ['L', 'S', 'Z'] as const) expect(shapeCount(passages, shape), `no ${shape} Passage`).toBeGreaterThan(0);
    expect(slopedTurning, 'no sloped turning Passage').toBeGreaterThan(0);
    for (const d of bossPairs) expect(d.layout!.halls[d.layout!.stairs]!.great, `seed ${d.seed} Floor ${d.floor}: Boss Hall is not great`).toBe(true);
    expect(withGreat(2), 'no Floor with 2 great halls').toBeGreaterThan(0);
    expect(greats.flat().filter((h) => h.kind === 'Treasure').length, 'no Treasure great hall').toBeGreaterThan(0);
    expect(greats.flat().filter((h) => h.kind === 'Fight').length, 'no Fight great hall').toBeGreaterThan(0);
    expect(failedTotal, 'failed attempts').toBeLessThanOrEqual(PAIRS / 20);

    // Stage 7b: every shape, both layouts, a shaped great hall, a shaped or pillared Boss Hall and a ring Entrance, Stairs or Boss Hall.
    for (const sh of SHAPE_NAMES) {
      expect(shapedHalls.filter((h) => h.shape === sh && !h.great).length, `no ${sh} on a one-cell Hall`).toBeGreaterThan(0);
      expect(shapedHalls.filter((h) => h.shape === sh).length, `no ${sh} Hall`).toBeGreaterThan(0);
    }
    for (const l of ['colonnade', 'grid'] as const) expect(layoutCount(l), `no ${l} layout`).toBeGreaterThan(0);
    expect(shapedHalls.filter((h) => h.great).length, 'no shaped great hall').toBeGreaterThan(0);
    expect(bossHalls.filter((h) => h.shape !== 'rect' || h.pillars.length > 0).length, 'no shaped or pillared Boss Hall').toBeGreaterThan(0);
    expect(ringKeep.length, 'no ring Entrance, Stairs or Boss Hall').toBeGreaterThan(0);

    // Stage 6: levels are exercised, and the budgets hold.
    expect(levelCount.filter((n) => n >= 3).length, 'no Floor with 3 or more Hall levels').toBeGreaterThan(0);
    expect(galleries.length - stairwells, 'no balcony').toBeGreaterThan(0);
    expect(stairwells, 'no stairwell').toBeGreaterThan(0);
    expect(sloped, 'no sloped Passage').toBeGreaterThan(0);
    expect(deckPosts, 'no Deck post').toBeGreaterThan(0);
    expect(nav.length).toBe(NAV_FLOORS);
    expect(decks, 'no Deck among the navmesh Floors').toBeGreaterThan(0);
    expect(nav.reduce((n, x) => n + x.decksLinked, 0), 'a Deck without a shortcut jump Link onto it').toBe(decks);
    expect(nav.reduce((n, x) => n + x.badJumps, 0), 'a jump Link that is not a shortcut, or rises over SHORTCUT_RISE').toBe(0);
    expect(nav.reduce((n, x) => n + x.fromDeepPit, 0), 'a jump Link from a 4 m pit\'s floor').toBe(0);
    for (const k of ['tier', 'rim', 'dais'] as const) expect(nav.reduce((n, x) => n + x.landing[k], 0), `no shortcut jump Link onto a ${k}`).toBeGreaterThan(0);

    // Stage 7c: every kind of feature and wrap is exercised, in the share the Design asks for.
    const sp7 = splitsOf(allH);
    const pi7 = pitsOf(allH);
    const da7 = daisesOf(allH);
    expect(sp7.filter((q) => q.tiers.length === 2).length, 'no two-tier split').toBeGreaterThan(0);
    expect(sp7.filter((q) => q.tiers.length === 3).length, 'no three-tier split').toBeGreaterThan(0);
    expect(pi7.filter((q) => q.depth === 2).length, 'no 2 m pit').toBeGreaterThan(0);
    expect(pi7.filter((q) => q.depth === 4).length, 'no 4 m pit').toBeGreaterThan(0);
    expect(deepPerFloor[2]!.deep / deepPerFloor[2]!.floors, 'not more 4 m pits a Floor in tier 3 than in tier 1').toBeGreaterThan(deepPerFloor[0]!.deep / deepPerFloor[0]!.floors);
    expect(da7.filter((x) => x.h.kind === 'Boss').length, 'no throne').toBeGreaterThan(0);
    expect(da7.filter((x) => x.h.kind === 'Treasure').length, 'no altar').toBeGreaterThan(0);
    expect(galAll.filter((x) => x.g.wrap?.walls.length === 1).length, 'no L wrap').toBeGreaterThan(0);
    expect(galAll.filter((x) => x.g.wrap?.walls.length === 2).length, 'no U wrap').toBeGreaterThan(0);
    expect(stairShare, 'stairwells on fewer than 1 gallery in 3').toBeGreaterThanOrEqual(1 / 3);
    expect(featureShare, 'share of Halls with a split, pit or dais').toBeGreaterThanOrEqual(0.22);
    expect(featureShare, 'share of Halls with a split, pit or dais').toBeLessThanOrEqual(0.28);
    const total = passing.map((d) => d.plan + d.build + d.judge);
    expect(mean(total), `passing attempt plan + build + judge averages ${fmt(mean(total))} ms`).toBeLessThanOrEqual(BUILD_MEAN_MS);
    expect(Math.max(...total), `slowest passing attempt ${fmt(Math.max(...total))} ms`).toBeLessThanOrEqual(BUILD_MAX_MS);
    expect(mean(nav.map((n) => n.ms)), `navMesh averages ${fmt(mean(nav.map((n) => n.ms)))} ms`).toBeLessThanOrEqual(NAV_MEAN_MS);
  }, 1_200_000);
});
