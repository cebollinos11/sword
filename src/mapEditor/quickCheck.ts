/**
 * The Quick check (docs/plans/map-editor.md, Stage 4): `N` whole AI-v-AI Battles on a draft, headless, each on a fixed seed, reporting what
 * a map author wants to know before playing it: how long a Battle lasts and how it ends, how often each Objective changes hands, how the
 * Tickets run down, and how long Soldiers stand stuck (`stuck.ts`). The seeds are fixed, so a rerun on the same draft gives the same report
 * to the last digit; the report holds no clock. Pure (no DOM, no three.js): `QuickBattle` steps one Battle a few Ticks at a time (the editor
 * runs it between frames), `quickCheck` runs them all.
 */
import { battleNameFor, createMatch, limitTicks, stepMatch, TICK_SECONDS, type MatchState } from '../sim';
import type { TuningData } from '../tuning';
import { StuckMeter } from './stuck';

/** The seeds a Quick check runs when none are named: fixed, so a rerun is comparable. */
export const QUICK_SEEDS: readonly number[] = [1, 2, 3, 4];
/** Battle seconds between the points of the Ticket curve. */
export const CURVE_EVERY = 30;

/** How a Battle ended: a Team routed with Tickets left (it was killed down), with none left, or at the Battle's time limit. */
export type EndedBy = 'rout' | 'tickets' | 'limit' | 'unfinished';

export interface CapturePoint {
  readonly id: string;
  /** Times it changed hands to Team 0, and to Team 1 (a first capture from none counts). */
  readonly captures: readonly [number, number];
  /** Its Owner at the end: -1 for none. */
  readonly owner: number;
}

export interface BattleReport {
  readonly seed: number;
  /** Battle time at the end (s). */
  readonly seconds: number;
  readonly winner: number | null;
  readonly endedBy: EndedBy;
  readonly objectives: readonly CapturePoint[];
  /** Each Team's Tickets every `CURVE_EVERY` seconds, from 0, and at the end. */
  readonly tickets: readonly { readonly seconds: number; readonly team0: number; readonly team1: number }[];
  /** Soldier-seconds stuck past `STUCK_AFTER`, the longest stuck run (s), and the hottest 2 m cell. */
  readonly stall: { readonly seconds: number; readonly longest: number; readonly runs: number; readonly hottest: { readonly x: number; readonly z: number; readonly seconds: number } | null };
  /** Soldiers each Team started with, and had left. */
  readonly armies: { readonly start: number; readonly left: readonly [number, number] };
}

export interface QuickCheckOptions {
  readonly seeds?: readonly number[];
}

export interface QuickCheckReport {
  readonly map: string;
  readonly battles: readonly BattleReport[];
  readonly summary: {
    readonly seconds: { readonly min: number; readonly mean: number; readonly max: number };
    readonly wins: readonly [number, number];
    readonly endedBy: Readonly<Record<EndedBy, number>>;
    /** Per Objective: total changes of hands to each Team over the Battles. */
    readonly captures: readonly { readonly id: string; readonly captures: readonly [number, number] }[];
    readonly stall: { readonly meanSeconds: number; readonly maxSeconds: number; readonly longest: number };
  };
}

/** One Battle being run: step it, and read its report once it is over (or `unfinished`). */
export class QuickBattle {
  private match: MatchState;
  private readonly meter: StuckMeter;
  private readonly owner: number[];
  private readonly captures: [number, number][];
  private readonly curve: { seconds: number; team0: number; team1: number }[] = [];
  private readonly army: number;
  private readonly arena: string;
  private nextPoint = 0;

  constructor(
    private readonly tuning: TuningData,
    readonly map: string,
    readonly seed: number,
  ) {
    this.arena = battleNameFor(map, seed);
    this.match = createMatch(tuning, { format: 'Battle', bestOf: 1, seed, arena: this.arena });
    this.meter = new StuckMeter(tuning.battle, this.arena);
    const o = this.match.duel.crowd!.objectives;
    this.owner = [...o.owner];
    this.captures = o.owner.map(() => [0, 0]);
    this.army = tuning.battle.armySize;
    this.point();
  }

  get over(): boolean {
    return this.match.status.status === 'Over';
  }

  get seconds(): number {
    return this.match.duel.tick * TICK_SECONDS;
  }

  private point(): void {
    const t = this.match.duel.crowd!.tickets;
    this.curve.push({ seconds: this.nextPoint * CURVE_EVERY, team0: t[0]!, team1: t[1]! });
    this.nextPoint++;
  }

  /** Step up to `ticks` Ticks; whether the Battle is over. */
  step(ticks: number): boolean {
    for (let k = 0; k < ticks && !this.over; k++) {
      this.match = stepMatch(this.match, [], this.tuning);
      const c = this.match.duel.crowd!;
      c.objectives.owner.forEach((now, i) => {
        if (now !== this.owner[i] && now >= 0) this.captures[i]![now]!++;
        this.owner[i] = now;
      });
      this.meter.observe(this.match);
      if (this.match.duel.tick * TICK_SECONDS >= this.nextPoint * CURVE_EVERY) this.point();
    }
    return this.over;
  }

  report(): BattleReport {
    const m = this.match;
    const c = m.duel.crowd!;
    const winner = m.status.status === 'Over' ? m.status.winner : null;
    const endedBy: EndedBy = !c.rout ? 'unfinished' : c.rout.tick >= limitTicks(this.tuning.battle) ? 'limit' : c.tickets[c.rout.team]! <= 0 ? 'tickets' : 'rout';
    const tickets = [...this.curve];
    // The end of the Battle is the curve's last point.
    tickets.push({ seconds: this.seconds, team0: c.tickets[0]!, team1: c.tickets[1]! });
    const left: [number, number] = [0, 0];
    for (let i = 0; i < c.x.length; i++) if (c.alive[i]) left[c.team[i]!]!++;
    return {
      seed: this.seed,
      seconds: this.seconds,
      winner,
      endedBy,
      objectives: this.tuning.battle.maps[this.map]!.objectives.map((o, i) => ({ id: o.id, captures: this.captures[i]!, owner: this.owner[i]! })),
      tickets,
      stall: { seconds: this.meter.stuckSeconds, longest: this.meter.longest, runs: this.meter.runs, hottest: this.meter.hottest() },
      armies: { start: this.army, left },
    };
  }
}

/** The report of the Battles `battles` (in order). */
export function summarise(map: string, battles: readonly BattleReport[]): QuickCheckReport {
  const n = Math.max(1, battles.length);
  const seconds = battles.map((b) => b.seconds);
  const endedBy: Record<EndedBy, number> = { rout: 0, tickets: 0, limit: 0, unfinished: 0 };
  const wins: [number, number] = [0, 0];
  for (const b of battles) {
    endedBy[b.endedBy]++;
    if (b.winner !== null) wins[b.winner]!++;
  }
  const ids = battles[0]?.objectives.map((o) => o.id) ?? [];
  return {
    map,
    battles,
    summary: {
      seconds: { min: Math.min(...seconds), mean: seconds.reduce((s, v) => s + v, 0) / n, max: Math.max(...seconds) },
      wins,
      endedBy,
      captures: ids.map((id, k) => ({ id, captures: [0, 1].map((t) => battles.reduce((s, b) => s + b.objectives[k]!.captures[t]!, 0)) as [number, number] })),
      stall: { meanSeconds: battles.reduce((s, b) => s + b.stall.seconds, 0) / n, maxSeconds: Math.max(0, ...battles.map((b) => b.stall.seconds)), longest: Math.max(0, ...battles.map((b) => b.stall.longest)) },
    },
  };
}

/** Run the Battles of `options.seeds` (default `QUICK_SEEDS`) on map `map` of `tuning` (a draft's, `draftTuning`), one after another. */
export function quickCheck(tuning: TuningData, map: string, options: QuickCheckOptions = {}): QuickCheckReport {
  const battles = (options.seeds ?? QUICK_SEEDS).map((seed) => {
    const run = new QuickBattle(tuning, map, seed);
    run.step(Infinity);
    return run.report();
  });
  return summarise(map, battles);
}

const f = (v: number, digits = 1) => v.toFixed(digits);

/** The report as the editor and the script print it: one line a Battle, then the summary. */
export function formatQuickCheck(r: QuickCheckReport): string {
  const lines = [`Quick check · ${r.map} · ${r.battles.length} Battles, seeds ${r.battles.map((b) => b.seed).join(', ')}`];
  for (const b of r.battles) {
    const caps = b.objectives.map((o) => `${o.id} ${o.captures[0]}/${o.captures[1]}`).join('  ');
    const last = b.tickets[b.tickets.length - 1]!;
    lines.push(
      `seed ${b.seed}: ${f(b.seconds, 0)} s, Team ${b.winner ?? '-'} wins by ${b.endedBy}; Tickets left ${f(last.team0, 0)} / ${f(last.team1, 0)}; Soldiers left ${b.armies.left[0]} / ${b.armies.left[1]} of ${b.armies.start}; captures (to Team 0 / Team 1) ${caps}; stuck ${f(b.stall.seconds)} Soldier-s, longest ${f(b.stall.longest)} s${b.stall.hottest ? `, hottest at (${f(b.stall.hottest.x, 0)}, ${f(b.stall.hottest.z, 0)})` : ''}`,
    );
  }
  const s = r.summary;
  lines.push(
    `Battle length ${f(s.seconds.min, 0)} to ${f(s.seconds.max, 0)} s, mean ${f(s.seconds.mean, 0)} s · wins ${s.wins[0]} / ${s.wins[1]} · ended by ${Object.entries(s.endedBy)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    `Captures over the Battles: ${s.captures.map((c) => `${c.id} ${c.captures[0]}/${c.captures[1]}`).join('  ')}`,
    `Stall: mean ${f(s.stall.meanSeconds)} Soldier-s a Battle, most ${f(s.stall.maxSeconds)}, longest stuck run ${f(s.stall.longest)} s`,
    'Ticket curve (Team 0 / Team 1, every 30 s):',
  );
  for (const b of r.battles) lines.push(`  seed ${b.seed}: ${b.tickets.map((t) => `${f(t.seconds, 0)}s ${f(t.team0, 0)}/${f(t.team1, 0)}`).join('  ')}`);
  return lines.join('\n');
}
