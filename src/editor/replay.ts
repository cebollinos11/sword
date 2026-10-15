/**
 * Golden replays: balance tooling for the Editor (opt-in, never a CI gate).
 *
 * A replay is a Duel's (or Match's) seed and starting setup plus the Intent
 * sequence actually fed to the Simulation, one Intent per Fighter per Tick.
 * Because the Simulation is deterministic (ADR 0001), re-running those Intents
 * against the same Tuning Data reproduces the run exactly; against changed
 * Tuning Data it shows what the change does to the same play. Recording the
 * Intents (not the Controllers) means an AI vs AI run replays without the AI:
 * the Fighters do the same things even if the new Tuning Data would have made
 * the AI choose differently.
 *
 * The replay also stores the outcome seen when it was recorded (winner,
 * damage dealt, hits) so a replay can be compared on its own. No DOM here.
 */
import {
  createInitialState,
  createMatch,
  DIRECTIONS,
  hashValue,
  step,
  stepMatch,
  type Intent,
  type MatchConfig,
  type MatchState,
  type Placement,
  type SimState,
} from '../sim';
import { HIT_ZONES, tuningDataHash, type HitZone, type TuningData } from '../tuning';
import type { Sandbox } from './sandboxSession';

export const REPLAY_FORMAT = 'sword-replay';
export const REPLAY_VERSION = 1;

/**
 * How the run started: a bare Duel from given placements, or a Match. Both are seeded, and name
 * each Fighter's Weapon (a replay recorded before Weapons were chosen has none: the default Weapon).
 */
export type ReplaySetup =
  | { readonly kind: 'Duel'; readonly seed: number; readonly placements: readonly Placement[]; readonly weapons?: readonly string[]; readonly teams?: readonly number[] }
  | {
      readonly kind: 'Match';
      readonly seed: number;
      /** Replays saved before teams lack `spacing` and `teams` (one Fighter a side, Tuning Data spacing). A replay is one Match: no rematches. */
      readonly config: Omit<MatchConfig, 'weapons' | 'spacing' | 'teams' | 'rematchTicks'> & {
        readonly weapons?: readonly string[];
        readonly spacing?: number;
        readonly teams?: readonly number[];
      };
    };

/** One landed Hit, at the Tick it landed (the Match Tick for a Match). */
export interface ReplayHit {
  readonly tick: number;
  readonly attacker: number;
  readonly defender: number;
  readonly direction: Intent['direction'];
  readonly zone: HitZone;
  readonly damage: number;
}

/** A Fighter index, a draw, or no result yet (the run stopped before the end). */
export type ReplayWinner = number | 'Draw' | 'Undecided';

export interface ReplayOutcome {
  /** The Duel's winner (bare Duel) or the Match's winner. */
  readonly winner: ReplayWinner;
  /** The Tick the Duel or Match ended on, or null if it did not. */
  readonly endTick: number | null;
  /** The result of every Duel that ended, in order (a Match may hold several). */
  readonly duelWinners: readonly (number | 'Draw')[];
  /** Total damage each Fighter dealt. */
  readonly damageDealt: readonly number[];
  readonly hits: readonly ReplayHit[];
}

export interface Replay {
  readonly setup: ReplaySetup;
  /** Number of Ticks recorded (`intents.length`). */
  readonly ticks: number;
  /** `intents[t]` is what was fed to the Simulation to step from Tick t to t+1. */
  readonly intents: readonly (readonly Intent[])[];
  /** `tuningDataHash` of the Tuning Data the replay was recorded with. */
  readonly tuningHash: string;
  /** What happened when it was recorded. */
  readonly outcome: ReplayOutcome;
}

/** A replay file that cannot be read; the message names the bad field. */
export class ReplayError extends Error {
  override name = 'ReplayError';
}

type RunState = SimState | MatchState;
const isMatch = (s: RunState): s is MatchState => 'config' in s;
const duelOf = (s: RunState): SimState => (isMatch(s) ? s.duel : s);

// ---------------------------------------------------------------- recording

/** A sandbox that remembers the Intents each state was stepped with. */
export interface RecordingSandbox<S> extends Sandbox<S> {
  /** The Intents that produced `history[1..]` (so `result[t]` stepped Tick t to t+1). */
  intentsOf(history: readonly S[]): Intent[][];
}

/**
 * Wrap a sandbox so every state it steps remembers the Intents that produced
 * it. Give the wrapper to `createSandboxSession`; the session's history after
 * scrubs and branches then maps back to exactly the Intents fed to the Simulation.
 */
export function recordingSandbox<S extends object>(sandbox: Sandbox<S>): RecordingSandbox<S> {
  const producedBy = new WeakMap<S, Intent[]>();
  return {
    duel: (s) => sandbox.duel(s),
    over: (s) => sandbox.over(s),
    step(s, intents) {
      const next = sandbox.step(s, intents);
      producedBy.set(next, intents.map((i) => ({ ...i, move: { ...i.move } })));
      return next;
    },
    intentsOf(history) {
      return history.slice(1).map((s, k) => {
        const intents = producedBy.get(s);
        if (!intents) throw new Error(`Tick ${k + 1} was not stepped by this recorder`);
        return intents;
      });
    },
  };
}

/** The seed and setup a run started from (its state at Tick 0). */
export function replaySetup(initial: RunState): ReplaySetup {
  if (initial.tick !== 0) throw new RangeError(`A replay starts at Tick 0, not ${initial.tick}`);
  if (isMatch(initial)) {
    const { rematchTicks: _oneMatch, ...config } = initial.config;
    return { kind: 'Match', seed: initial.duel.rng.seed, config: { ...config, weapons: [...config.weapons], teams: [...config.teams] } };
  }
  return {
    kind: 'Duel',
    seed: initial.rng.seed,
    placements: initial.fighters.map((f) => ({ position: { x: f.position.x, z: f.position.z }, facing: f.facing })),
    weapons: initial.fighters.map((f) => f.weapon),
    teams: initial.fighters.map((f) => f.team),
  };
}

/** Record a run (its states from Tick 0, and the Intents between them) as a replay. */
export function recordReplay(tuning: TuningData, history: readonly RunState[], intents: readonly (readonly Intent[])[]): Replay {
  const initial = history[0];
  if (!initial) throw new RangeError('Nothing to record');
  if (intents.length !== history.length - 1) throw new RangeError(`${history.length} states need ${history.length - 1} Intent sets, got ${intents.length}`);
  return { setup: replaySetup(initial), ticks: intents.length, intents, tuningHash: tuningDataHash(tuning), outcome: outcomeOf(history) };
}

// ---------------------------------------------------------------- outcome

/** Winner, damage and hits of a run, from its states in Tick order (starting at Tick 0). */
export function outcomeOf(states: Iterable<RunState>): ReplayOutcome {
  const hits: ReplayHit[] = [];
  const duelWinners: (number | 'Draw')[] = [];
  const damageDealt: number[] = [];
  let last: RunState | undefined;
  let t = 0;
  for (const s of states) {
    const duel = duelOf(s);
    if (!last) duel.fighters.forEach(() => damageDealt.push(0));
    for (const e of t === 0 ? [] : duel.events) {
      if (e.type === 'Hit') {
        hits.push({ tick: t, attacker: e.attacker, defender: e.defender, direction: e.direction, zone: e.zone, damage: e.damage });
        damageDealt[e.attacker] = (damageDealt[e.attacker] ?? 0) + e.damage;
      } else if (e.type === 'DuelEnd') duelWinners.push(e.winner ?? 'Draw');
    }
    last = s;
    t++;
  }
  if (!last) throw new RangeError('No states');
  let winner: ReplayWinner = 'Undecided';
  let endTick: number | null = null;
  if (isMatch(last)) {
    if (last.status.status === 'Over') ({ winner, tick: endTick } = last.status);
  } else if (last.duel.status === 'Over') {
    winner = last.duel.winner ?? 'Draw';
    endTick = last.duel.tick;
  }
  return { winner, endTick, duelWinners, damageDealt, hits };
}

// ---------------------------------------------------------------- replaying

export interface ReplayRun {
  readonly final: RunState;
  readonly outcome: ReplayOutcome;
}

function* replayStates(replay: Replay, tuning: TuningData): Generator<RunState> {
  const { setup } = replay;
  let s: RunState =
    setup.kind === 'Match'
      ? createMatch(tuning, { ...setup.config, seed: setup.seed })
      : createInitialState(tuning, setup.seed, setup.placements, setup.weapons, setup.teams);
  yield s;
  for (const intents of replay.intents) {
    s = isMatch(s) ? stepMatch(s, intents, tuning) : step(s, intents, tuning);
    yield s;
  }
}

/** Re-run the recorded Intents against `tuning` (no Controllers involved). */
export function runReplay(replay: Replay, tuning: TuningData): ReplayRun {
  let final: RunState | undefined;
  const outcome = outcomeOf(
    (function* () {
      for (const s of replayStates(replay, tuning)) yield (final = s);
    })(),
  );
  return { final: final!, outcome };
}

export interface ReplayReport {
  /** The Tuning Data differs from the one the replay was recorded with. */
  readonly tuningChanged: boolean;
  /** The replayed outcome equals the recorded one exactly. */
  readonly identical: boolean;
  /** One line per difference, recorded → replayed. Empty when identical. */
  readonly differences: readonly string[];
  readonly recorded: ReplayOutcome;
  readonly replayed: ReplayOutcome;
}

/** Hit lines listed in a report before the rest are summarised. */
const MAX_HIT_LINES = 12;

const winnerText = (w: ReplayWinner) => (typeof w === 'number' ? `Fighter ${w}` : w);
const hitText = (h: ReplayHit | undefined) =>
  h ? `Tick ${h.tick} F${h.attacker}→F${h.defender} ${h.direction} ${h.zone} −${h.damage.toFixed(2)}` : 'none';

/** What differs between two outcomes, one line each (recorded → replayed). */
export function outcomeDifferences(a: ReplayOutcome, b: ReplayOutcome): string[] {
  const out: string[] = [];
  if (a.winner !== b.winner) out.push(`Winner: ${winnerText(a.winner)} → ${winnerText(b.winner)}`);
  if (a.endTick !== b.endTick) out.push(`Ended on Tick: ${a.endTick ?? 'never'} → ${b.endTick ?? 'never'}`);
  if (hashValue(a.duelWinners) !== hashValue(b.duelWinners))
    out.push(`Duel results: ${a.duelWinners.map(winnerText).join(', ') || 'none'} → ${b.duelWinners.map(winnerText).join(', ') || 'none'}`);
  const fighters = Math.max(a.damageDealt.length, b.damageDealt.length);
  for (let i = 0; i < fighters; i++) {
    const x = a.damageDealt[i] ?? 0;
    const y = b.damageDealt[i] ?? 0;
    if (x !== y) out.push(`Damage dealt by Fighter ${i}: ${x.toFixed(2)} → ${y.toFixed(2)}`);
  }
  if (a.hits.length !== b.hits.length) out.push(`Hits: ${a.hits.length} → ${b.hits.length}`);
  let listed = 0;
  let unlisted = 0;
  for (let k = 0; k < Math.max(a.hits.length, b.hits.length); k++) {
    const x = a.hits[k];
    const y = b.hits[k];
    if (x && y && hashValue(x) === hashValue(y)) continue;
    if (listed < MAX_HIT_LINES) {
      out.push(`Hit ${k + 1}: ${hitText(x)} → ${hitText(y)}`);
      listed++;
    } else unlisted++;
  }
  if (unlisted > 0) out.push(`…and ${unlisted} more differing Hits`);
  return out;
}

/** Replay against `tuning` and report what differs from the recording. */
export function compareReplay(replay: Replay, tuning: TuningData): ReplayReport {
  const replayed = runReplay(replay, tuning).outcome;
  const differences = outcomeDifferences(replay.outcome, replayed);
  return {
    tuningChanged: tuningDataHash(tuning) !== replay.tuningHash,
    identical: differences.length === 0,
    differences,
    recorded: replay.outcome,
    replayed,
  };
}

/** One-paragraph text summary of a report, for the Editor. */
export function describeReport(report: ReplayReport): string {
  const tuning = report.tuningChanged ? 'Tuning Data changed since recording' : 'Tuning Data unchanged';
  if (report.identical) return `${tuning}. Outcome identical: ${winnerText(report.replayed.winner)}, ${report.replayed.hits.length} hits.`;
  return `${tuning}. Outcome changed:\n${report.differences.join('\n')}`;
}

// ---------------------------------------------------------------- files

/** Consecutive Ticks fed the same Intents. */
interface IntentRun {
  readonly ticks: number;
  readonly intents: readonly Intent[];
}

/** A replay as stored on disk: repeated Intents are run-length encoded. */
interface ReplayFile {
  readonly format: typeof REPLAY_FORMAT;
  readonly version: number;
  readonly setup: ReplaySetup;
  readonly ticks: number;
  readonly tuningHash: string;
  readonly intents: readonly IntentRun[];
  readonly outcome: ReplayOutcome;
}

/** Stable 2-space JSON (numbers round-trip exactly, so the replay stays exact). */
export function serializeReplay(replay: Replay): string {
  const runs: { ticks: number; intents: readonly Intent[] }[] = [];
  let lastKey = '';
  for (const intents of replay.intents) {
    const key = JSON.stringify(intents);
    const run = runs[runs.length - 1];
    if (run && key === lastKey) run.ticks++;
    else runs.push({ ticks: 1, intents });
    lastKey = key;
  }
  const file: ReplayFile = {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    setup: replay.setup,
    ticks: replay.ticks,
    tuningHash: replay.tuningHash,
    intents: runs,
    outcome: replay.outcome,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A file name for a replay, e.g. `replay-match-seed11-2412ticks.json`. */
export function replayFileName(replay: Replay): string {
  return `replay-${replay.setup.kind.toLowerCase()}-seed${replay.setup.seed}-${replay.ticks}ticks.json`;
}

const fail = (path: string, what: string): never => {
  throw new ReplayError(`${path} ${what}`);
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function obj(v: unknown, path: string): Record<string, unknown> {
  return isObject(v) ? v : fail(path, 'must be an object');
}
function arr(v: unknown, path: string): unknown[] {
  return Array.isArray(v) ? v : fail(path, 'must be an array');
}
function num(v: unknown, path: string): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'must be a number');
}
function int(v: unknown, path: string, min: number): number {
  const n = num(v, path);
  return Number.isInteger(n) && n >= min ? n : fail(path, `must be an integer >= ${min}`);
}
function bool(v: unknown, path: string): boolean {
  return typeof v === 'boolean' ? v : fail(path, 'must be true or false');
}

function parseIntent(raw: unknown, path: string): Intent {
  const o = obj(raw, path);
  const move = obj(o.move, `${path}.move`);
  const direction = DIRECTIONS.find((d) => d === o.direction) ?? fail(`${path}.direction`, `must be one of ${DIRECTIONS.join(', ')}`);
  const face = o.face === undefined || o.face === null ? null : num(o.face, `${path}.face`);
  return {
    move: { x: num(move.x, `${path}.move.x`), z: num(move.z, `${path}.move.z`) },
    direction,
    attack: bool(o.attack, `${path}.attack`),
    block: bool(o.block, `${path}.block`),
    face,
  };
}

/** Optional Weapon names, one per Fighter. */
function weaponNames(v: unknown, path: string): { weapons?: string[] } {
  if (v === undefined) return {};
  return { weapons: arr(v, path).map((w, i) => (typeof w === 'string' ? w : fail(`${path}[${i}]`, 'must be a Weapon name'))) };
}

/** Optional teams (0 or 1), one per Fighter. */
function teamList(v: unknown, path: string): { teams?: number[] } {
  if (v === undefined) return {};
  return { teams: arr(v, path).map((t, i) => (t === 0 || t === 1 ? t : fail(`${path}[${i}]`, 'must be team 0 or 1'))) };
}

function parseSetup(raw: unknown): ReplaySetup {
  const o = obj(raw, 'setup');
  const seed = int(o.seed, 'setup.seed', 0);
  if (o.kind === 'Duel') {
    const placements = arr(o.placements, 'setup.placements').map((p, i) => {
      const path = `setup.placements[${i}]`;
      const po = obj(p, path);
      const pos = obj(po.position, `${path}.position`);
      return { position: { x: num(pos.x, `${path}.position.x`), z: num(pos.z, `${path}.position.z`) }, facing: num(po.facing, `${path}.facing`) };
    });
    return { kind: 'Duel', seed, placements, ...weaponNames(o.weapons, 'setup.weapons'), ...teamList(o.teams, 'setup.teams') };
  }
  if (o.kind === 'Match') {
    const c = obj(o.config, 'setup.config');
    return {
      kind: 'Match',
      seed,
      config: {
        bestOf: int(c.bestOf, 'setup.config.bestOf', 1),
        distance: num(c.distance, 'setup.config.distance'),
        interDuelTicks: int(c.interDuelTicks, 'setup.config.interDuelTicks', 1),
        ...weaponNames(c.weapons, 'setup.config.weapons'),
        ...(c.spacing === undefined ? {} : { spacing: num(c.spacing, 'setup.config.spacing') }),
        ...teamList(c.teams, 'setup.config.teams'),
      },
    };
  }
  return fail('setup.kind', 'must be "Duel" or "Match"');
}

function parseWinner(v: unknown, path: string, undecided: boolean): number | 'Draw' | 'Undecided' {
  if (v === 'Draw' || (undecided && v === 'Undecided')) return v;
  return int(v, path, 0);
}

function parseOutcome(raw: unknown): ReplayOutcome {
  const o = obj(raw, 'outcome');
  return {
    winner: parseWinner(o.winner, 'outcome.winner', true),
    endTick: o.endTick === null ? null : int(o.endTick, 'outcome.endTick', 0),
    duelWinners: arr(o.duelWinners, 'outcome.duelWinners').map((w, i) => parseWinner(w, `outcome.duelWinners[${i}]`, false) as number | 'Draw'),
    damageDealt: arr(o.damageDealt, 'outcome.damageDealt').map((d, i) => num(d, `outcome.damageDealt[${i}]`)),
    hits: arr(o.hits, 'outcome.hits').map((h, i) => {
      const path = `outcome.hits[${i}]`;
      const ho = obj(h, path);
      return {
        tick: int(ho.tick, `${path}.tick`, 0),
        attacker: int(ho.attacker, `${path}.attacker`, 0),
        defender: int(ho.defender, `${path}.defender`, 0),
        direction: DIRECTIONS.find((d) => d === ho.direction) ?? fail(`${path}.direction`, 'must be a Direction'),
        zone: HIT_ZONES.find((z) => z === ho.zone) ?? fail(`${path}.zone`, 'must be a Hit Zone'),
        damage: num(ho.damage, `${path}.damage`),
      };
    }),
  };
}

/** Read a replay file written by `serializeReplay`. Throws `ReplayError` naming the bad field. */
export function parseReplay(text: string): Replay {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ReplayError(`Not JSON: ${(e as Error).message}`);
  }
  const o = obj(raw, 'replay');
  if (o.format !== REPLAY_FORMAT) fail('format', `must be "${REPLAY_FORMAT}" (not a replay file)`);
  if (o.version !== REPLAY_VERSION) fail('version', `must be ${REPLAY_VERSION}`);
  const setup = parseSetup(o.setup);
  const ticks = int(o.ticks, 'ticks', 0);
  const tuningHash = typeof o.tuningHash === 'string' ? o.tuningHash : fail('tuningHash', 'must be a string');
  const intents: Intent[][] = [];
  arr(o.intents, 'intents').forEach((r, i) => {
    const path = `intents[${i}]`;
    const run = obj(r, path);
    const n = int(run.ticks, `${path}.ticks`, 1);
    const set = arr(run.intents, `${path}.intents`).map((x, f) => parseIntent(x, `${path}.intents[${f}]`));
    for (let k = 0; k < n; k++) intents.push(set);
  });
  if (intents.length !== ticks) fail('intents', `cover ${intents.length} Ticks but ticks is ${ticks}`);
  return { setup, ticks, intents, tuningHash, outcome: parseOutcome(o.outcome) };
}
