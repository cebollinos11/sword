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
 * Stage 6 (levels): per Floor the Hall levels, galleries (balconies and stairwells), sloped Passages and Deck posts are counted, and the
 * rerolls by rule printed; on the 20 navmesh Floors every Deck must hold a shortcut jump Link onto it from its Hall's floor and no other
 * jump Link may exist. The budgets of the Design: the passing attempt's plan, build and judge average at most 600 ms and none passes 2 s;
 * the navmesh averages at most 300 ms. The test fails unless it exercised Floors of 3 or more Hall levels, balconies, stairwells, sloped
 * Passages and Deck posts.
 */
import { describe, expect, it } from 'vitest';
import { MapCompileError, mapFileText } from '../../mapEditor/compile';
import { loadTuningData } from '../../tuning';
import { navMesh, type JumpLink } from '../nav';
import { groundOf } from '../battlefield';
import { runPick } from '../dungeon';
import { buildFloor, delverFloor, isBossFloor, judgeFields, judgePlan, planFloor, type DelverHallKind, type FloorPlan } from './index';

const tuning = loadTuningData();
const t = tuning.delver.floor;
const PAIRS = 500;
const SAMPLE_EVERY = 25;
const NAV_FLOORS = 20;
const KINDS: readonly DelverHallKind[] = ['Entrance', 'Stairs', 'Boss', 'Rest', 'Treasure', 'Fight', 'Empty'];
const RULES = ['rooms', 'levels', 'compile', 'halls', 'passages', 'markers', 'sight', 'galleries'];
/** The Design's budgets (ms), on the machine of the plans' measurements. */
const BUILD_MEAN_MS = 600;
const BUILD_MAX_MS = 2000;
const NAV_MEAN_MS = 300;
/** A Passage longer than this joins Halls two lattice steps apart, over an empty cell. */
const FAR = Math.max(...t.gaps);

interface Dealt {
  k: number;
  seed: number;
  floor: number;
  attempts: number;
  /** The passing attempt's plan, or the last one's when none passed. */
  layout: FloorPlan | null;
  /** The passing Floor's map file (sampled pairs only), and its navmesh numbers (the first NAV_FLOORS passing Floors only). */
  mapText: string | null;
  nav: { ms: number; polygons: number; links: number; jumps: number; decks: number; decksLinked: number; otherJumps: number } | null;
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
    const plan = planFloor(t, seed, floor, attempt, isBossFloor(tuning.delver, floor));
    const t1 = performance.now();
    d.attempts = attempt + 1;
    d.plan = t1 - t0;
    d.build = 0;
    d.judge = 0;
    let reasons: string[] = judgePlan(t, plan);
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
          const decksOf = new Set(plan.halls.flatMap((h) => (h.gallery ? [groundOf(built.battle, built.field, (h.gallery.deck.x0 + h.gallery.deck.x1) / 2, (h.gallery.deck.z0 + h.gallery.deck.z1) / 2, h.gallery.y)] : [])));
          const otherJumps = jumps.filter((l) => !l.shortcut || !decksOf.has(l.to)).length;
          d.nav = { ms, polygons: mesh.out.length, links: mesh.links.length, jumps: jumps.length, decks, decksLinked, otherJumps };
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
      `  jump Links on those ${nav.length} Floors: ${nav.reduce((n, x) => n + x.jumps, 0)} (all shortcuts onto a Deck; other jump Links: ${nav.reduce((n, x) => n + x.otherJumps, 0)}); Decks ${decks}, each with a shortcut Link onto it from its Hall's floor: ${nav.reduce((n, x) => n + x.decksLinked, 0)}`,
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
    const far = passages.filter((p) => p.length > FAR).length;
    lines.push(`  Passages: ${passages.length} (tree ${passages.length - loops}, loop ${loops}, far (> ${FAR} m) ${far})`);
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

    // Stage 6: levels are exercised, and the budgets hold.
    expect(levelCount.filter((n) => n >= 3).length, 'no Floor with 3 or more Hall levels').toBeGreaterThan(0);
    expect(galleries.length - stairwells, 'no balcony').toBeGreaterThan(0);
    expect(stairwells, 'no stairwell').toBeGreaterThan(0);
    expect(sloped, 'no sloped Passage').toBeGreaterThan(0);
    expect(deckPosts, 'no Deck post').toBeGreaterThan(0);
    expect(nav.length).toBe(NAV_FLOORS);
    expect(decks, 'no Deck among the navmesh Floors').toBeGreaterThan(0);
    expect(nav.reduce((n, x) => n + x.decksLinked, 0), 'a Deck without a shortcut jump Link onto it').toBe(decks);
    expect(nav.reduce((n, x) => n + x.otherJumps, 0), 'a jump Link that is not a shortcut onto a Deck').toBe(0);
    const total = passing.map((d) => d.plan + d.build + d.judge);
    expect(mean(total), `passing attempt plan + build + judge averages ${fmt(mean(total))} ms`).toBeLessThanOrEqual(BUILD_MEAN_MS);
    expect(Math.max(...total), `slowest passing attempt ${fmt(Math.max(...total))} ms`).toBeLessThanOrEqual(BUILD_MAX_MS);
    expect(mean(nav.map((n) => n.ms)), `navMesh averages ${fmt(mean(nav.map((n) => n.ms)))} ms`).toBeLessThanOrEqual(NAV_MEAN_MS);
  }, 1_200_000);
});
