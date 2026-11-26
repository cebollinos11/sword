/**
 * The AI walk: one AI Fighter walked by the AI Controller's own `walkTo` (the navmesh route, its steering, its sidestep and its edge keeping,
 * as an AI ally or the Delver pilot walks) through the real Simulation (`stepMatch`: Walls, pillars, Ramps, drops, fall damage), alone on a
 * draft, from a start to each target in turn, nearest first by a straight line, as the Delver pilot picks its fires. Where the navmesh says
 * there is a way (`navProbe.ts`), this says whether a Fighter actually gets through it: a doorway it snags on, a pillar it grinds against, a
 * ledge it walks off, a Ramp it slides from.
 *
 * Each leg ends **arrived** (within the stop of the target, on its level), **stuck** (it moved less than `STUCK_MOVE` m in the last
 * `STUCK_SECONDS`), **slow** (still walking at twice the route's walking time and `SLOW_GRACE`), **fell** (it died) or **no route** (the
 * navmesh has none). A leg stuck, slow or fallen puts the Fighter on its target, so the walk goes on and one snag does not hide the rest.
 * Its trace is sampled every `TRACE_EVERY` Ticks, for drawing. A measure: deterministic (fixed seed, no clock), never written into a game.
 *
 * `AiWalk` steps a few Ticks at a time (the editor runs it between frames); `walkAll` runs it to the end.
 */
import { createAiController, type AiController } from '../controllers/ai';
import { createMatch, findPath, IDLE_INTENT, inDuel, navMesh, stepMatch, TICK_SECONDS, type MatchState, type NavPoint } from '../sim';
import type { ArenaGeometry, TuningData } from '../tuning';
import type { NavIssue, NavTarget } from './navProbe';

/** How far (m) it must have moved over the last `STUCK_SECONDS` not to be stuck. */
export const STUCK_MOVE = 0.5;
export const STUCK_SECONDS = 3;
/** A leg is slow past twice its route's walking time and this (s). */
export const SLOW_GRACE = 10;
/** Where it stops short of a target (m), as the pilot stops short of a fire. */
export const ARRIVE = 0.5;
/** Heights within this (m) are one level. */
const LEVEL = 1;
/** The trace keeps a point every this many Ticks. */
const TRACE_EVERY = 6;
/** The Arena name the walk registers its draft under. */
const ARENA = 'aiwalk:draft';

export type LegOutcome = 'arrived' | 'stuck' | 'slow' | 'fell' | 'noRoute';

export interface WalkLeg {
  readonly from: NavPoint;
  readonly target: NavTarget;
  readonly outcome: LegOutcome;
  /** Seconds it walked. */
  readonly seconds: number;
  /** The route's walking time (its length at walk speed), s; 0 with no route. */
  readonly expected: number;
  /** Where it was when the leg ended (stuck, slow or fell: where the problem is). */
  readonly at: NavPoint;
  /** Fall damage it took on the leg. */
  readonly hurt: number;
  /** Its feet every `TRACE_EVERY` Ticks. */
  readonly trace: readonly NavPoint[];
}

export interface AiWalkOptions {
  /** The AI's difficulty (default Hard: an AI ally's). */
  readonly difficulty?: string;
  /** Walk Sheathed, at a run (default true): an Ally AI on a Floor with no enemy near. */
  readonly sheathed?: boolean;
  /** Take no jump Link (the Delver pilot online). */
  readonly walkOnly?: boolean;
  /** The AI's Quirks (`ai.quirks` names, docs/plans/enemy-behaviours.md, Stage 4; default none): a Hopper follows longer jump Links. */
  readonly quirks?: readonly string[];
}

/** Tuning Data with `arena` registered under `ARENA`, the Fighter put at `start` and the other Fighter of the Duel at it too (benched). */
function walkTuning(tuning: TuningData, arena: ArenaGeometry, start: NavPoint): TuningData {
  const spot = { x: start.x, y: start.y, z: start.z };
  const spawns = [
    { team: 0, slot: 0, position: spot, facing: 0 },
    { team: 1, slot: 0, position: spot, facing: 0 },
  ];
  return { ...tuning, arenas: { ...tuning.arenas, [ARENA]: { ...arena, name: ARENA, spawns } } };
}

export class AiWalk {
  private readonly tuning: TuningData;
  private readonly ai: AiController;
  private match: MatchState;
  private readonly left: NavTarget[];
  readonly legs: WalkLeg[] = [];
  /** The leg being walked: where from, its target, its Ticks so far, its route's walking time, the HP it started with, its trace. */
  private leg: { from: NavPoint; target: NavTarget; ticks: number; expected: number; hp: number; trace: NavPoint[] } | null = null;
  private readonly back: number;
  /** The Match as the leg being walked began: a fall that kills ends the Duel, so the walk goes on from here. */
  private legStart: MatchState | null = null;

  /** The draft as the walk registered it: the very Arena object the AI's navmesh is built and cached for. */
  private readonly arena: ArenaGeometry;

  constructor(
    base: TuningData,
    arena: ArenaGeometry,
    start: NavPoint,
    targets: readonly NavTarget[],
    private readonly options: AiWalkOptions = {},
  ) {
    this.tuning = walkTuning(base, arena, start);
    this.arena = this.tuning.arenas[ARENA]!;
    const skill = this.tuning.ai.difficulties[options.difficulty ?? 'Hard']!;
    // Its Quirks (a Hopper's `jumpNav` minimum) first; walk-only after them, so it still takes no jump Link.
    this.ai = createAiController(this.tuning, skill, undefined, { quirks: options.quirks ?? [], walk: options.walkOnly === true });
    const m = createMatch(this.tuning, { format: 'Duels', bestOf: 1, seed: 1, arena: ARENA, teams: [0, 1] });
    // The other Fighter is benched: out of the Duel, in nobody's way.
    this.match = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, i) => (i === 0 ? f : { ...f, benched: true as const })) } };
    this.left = [...targets];
    this.back = Math.round(STUCK_SECONDS / (TRACE_EVERY * TICK_SECONDS));
  }

  /** Whether every target has had its leg. */
  get done(): boolean {
    return this.leg === null && this.left.length === 0;
  }

  /** How many legs are done, of all. */
  get progress(): { done: number; of: number } {
    return { done: this.legs.length, of: this.legs.length + this.left.length + (this.leg ? 1 : 0) };
  }

  private get self() {
    return this.match.duel.fighters[0]!;
  }

  private here(): NavPoint {
    const f = this.self;
    return { x: f.position.x, z: f.position.z, y: f.y };
  }

  /** The next leg: the nearest target left, in a straight line (the lower index on a tie). */
  private nextLeg(): void {
    // Each leg starts whole, so the fall damage of earlier legs never adds up to a death.
    this.setSelf({ hp: this.self.maxHp });
    this.legStart = this.match;
    const at = this.here();
    let k = 0;
    for (let i = 1; i < this.left.length; i++) {
      const d = (t: NavTarget) => (t.x - at.x) ** 2 + (t.z - at.z) ** 2;
      if (d(this.left[i]!) < d(this.left[k]!)) k = i;
    }
    const target = this.left.splice(k, 1)[0]!;
    const route = findPath(this.arena, this.tuning, at, target, { jumps: !this.options.walkOnly });
    if (!route) return void this.end({ from: at, target, ticks: 0, expected: 0, hp: this.self.hp, trace: [] }, 'noRoute');
    const length = this.routeLength(at, target, route);
    const speed = this.tuning.fighter.walkSpeed * (this.options.sheathed === false ? 1 : this.tuning.fighter.sheathedWalkFactor);
    this.leg = { from: at, target, ticks: 0, expected: length / speed, hp: this.self.hp, trace: [at] };
  }

  /** A route's length (m) in straight hops through each Link's portal middle (a jump's landing): close enough for a time limit. */
  private routeLength(from: NavPoint, to: NavPoint, route: readonly number[]): number {
    const mesh = navMesh(this.arena, this.tuning).links;
    let length = 0;
    let p: { x: number; z: number } = from;
    for (const id of route) {
      const l = mesh[id]!;
      const m = l.kind === 'jump' ? l.lands : { x: (l.left.x + l.right.x) / 2, z: (l.left.z + l.right.z) / 2 };
      length += Math.hypot(m.x - p.x, m.z - p.z);
      p = m;
    }
    return length + Math.hypot(to.x - p.x, to.z - p.z);
  }

  /** End the leg `leg` with `outcome`; one stuck, slow or fallen puts the Fighter on its target (one with no route leaves it where it stands). */
  private end(leg: NonNullable<AiWalk['leg']>, outcome: LegOutcome): void {
    const at = this.here();
    this.legs.push({ from: leg.from, target: leg.target, outcome, seconds: leg.ticks * TICK_SECONDS, expected: leg.expected, at, hurt: Math.max(0, leg.hp - this.self.hp), trace: leg.trace });
    this.leg = null;
    if (outcome === 'arrived' || outcome === 'noRoute') return;
    if (outcome === 'fell' && this.legStart) this.match = this.legStart;
    const t = leg.target;
    this.setSelf({ position: { x: t.x, z: t.z }, y: t.y, air: undefined, slide: undefined });
  }

  private setSelf(change: Partial<MatchState['duel']['fighters'][number]>): void {
    const duel = this.match.duel;
    this.match = { ...this.match, duel: { ...duel, fighters: duel.fighters.map((g, i) => (i === 0 ? { ...g, ...change } : g)) } };
  }

  /** Step up to `ticks` Ticks; returns whether the walk is done. */
  step(ticks: number): boolean {
    for (let n = 0; n < ticks && !this.done; n++) {
      if (!this.leg) {
        this.nextLeg();
        continue;
      }
      const leg = this.leg;
      const self = this.self;
      if (!inDuel(self) || self.death || this.match.status.status !== 'InProgress') {
        this.end(leg, 'fell');
        if (this.match.status.status !== 'InProgress') return this.stopAll('fell');
        continue;
      }
      const t = leg.target;
      if (Math.hypot(t.x - self.position.x, t.z - self.position.z) <= ARRIVE + 0.3 && Math.abs(t.y - self.y) < LEVEL && !self.air) {
        this.end(leg, 'arrived');
        continue;
      }
      let intent = this.ai.walkTo(this.match.duel, 0, t, ARRIVE);
      if (this.options.sheathed !== false && !self.sheathed && self.action.kind === 'Idle') intent = { ...intent, sheathe: true };
      this.match = stepMatch(this.match, [intent, IDLE_INTENT], this.tuning);
      leg.ticks++;
      if (leg.ticks % TRACE_EVERY === 0) {
        const p = this.here();
        leg.trace.push(p);
        const was = leg.trace.length > this.back ? leg.trace[leg.trace.length - 1 - this.back]! : null;
        if (was && Math.hypot(p.x - was.x, p.z - was.z) < STUCK_MOVE && Math.abs(p.y - was.y) < STUCK_MOVE) this.end(leg, 'stuck');
        else if (leg.ticks * TICK_SECONDS > 2 * leg.expected + SLOW_GRACE) this.end(leg, 'slow');
      }
    }
    return this.done;
  }

  /** The Match ended under the walk (it should not): every leg left is unwalked. */
  private stopAll(outcome: LegOutcome): boolean {
    for (const target of this.left.splice(0)) this.legs.push({ from: this.here(), target, outcome, seconds: 0, expected: 0, at: this.here(), hurt: 0, trace: [] });
    return true;
  }
}

/** Walk every target to the end. */
export function walkAll(tuning: TuningData, arena: ArenaGeometry, start: NavPoint, targets: readonly NavTarget[], options: AiWalkOptions = {}): readonly WalkLeg[] {
  const w = new AiWalk(tuning, arena, start, targets, options);
  while (!w.step(600));
  return w.legs;
}

const xz = (p: NavPoint) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}, ${p.y.toFixed(1)} m)`;

/** What the walk found, worst first: a leg stuck, fallen or with no route (errors), slow (a warning), or hurt by a fall on the way (a note). */
export function walkIssues(legs: readonly WalkLeg[]): NavIssue[] {
  const out: NavIssue[] = [];
  for (const l of legs) {
    const to = `on the way to ${l.target.label}`;
    const at = { x: l.at.x, z: l.at.z };
    const y = l.at.y;
    if (l.outcome === 'stuck') out.push({ severity: 'error', message: `AI walk: stuck at ${xz(l.at)} ${to}, after ${l.seconds.toFixed(1)} s.`, at, y });
    else if (l.outcome === 'fell') out.push({ severity: 'error', message: `AI walk: died at ${xz(l.at)} ${to}.`, at, y });
    else if (l.outcome === 'noRoute') out.push({ severity: 'error', message: `AI walk: no route from ${xz(l.from)} to ${l.target.label}.`, at: { x: l.target.x, z: l.target.z } });
    else if (l.outcome === 'slow') out.push({ severity: 'warning', message: `AI walk: still walking ${to} after ${l.seconds.toFixed(0)} s (its route: ${l.expected.toFixed(0)} s), at ${xz(l.at)}.`, at, y });
    else if (l.hurt > 0) out.push({ severity: 'note', message: `AI walk: took ${l.hurt} fall damage ${to}.`, at: { x: l.target.x, z: l.target.z } });
  }
  const rank = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
