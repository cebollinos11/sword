import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTuningData, type TuningData } from "../tuning";
import {
  battleMapOf,
  CHASE,
  createMatch,
  fieldDistance,
  fieldToward,
  formationSpot,
  GUARD,
  groundOf,
  hashValue,
  IDLE_INTENT,
  inDuel,
  MAX_TEAM_SIZE,
  oneField,
  PATROL,
  RETURN,
  runSeed,
  soldierHeight,
  secondsToTicks,
  snapshot,
  squadNarrows,
  stepMatch,
  TICK_SECONDS,
  type HitEvent,
  type MatchEvent,
  type MatchState,
} from "../sim";
import {
  clearanceAt,
  fieldBuilds,
  inSight,
  timeFieldBuilds,
} from "../sim/destinations";
import {
  arenaTuning,
  floorArenaName,
  floorOf,
  warbandHomes,
  type WarbandHomes,
} from "../sim/delver";
import { isBossFloor, tierOf } from "../sim/delver/troops";
import { gateOpen } from "../sim/delverRun";
import { BOSS, ELITE } from "../sim/warband";
import { createAiController } from "./ai";
import { controllerIntents, type Controller } from "./controller";
import { promotedNear } from "./allyAi";
import { createDelverPilot } from "./delverPilot";
import { lineupAis, type Lineup } from "./lineup";

/**
 * The Warband soak (docs/plans/delver.md, Stage 3, "The slow soak"): five Delver Runs of one tier of three Floors with Warbands, AI-driven (the
 * Player's Fighter on the Delver pilot at Hard, two Hard Ally AIs, the Pool's AIs for the Soldiers the Bubbles promote), each up to a Victory, a
 * Defeat or `RUN_SECONDS` of simulated time. It times each Tick (the Controllers' Intents and `stepMatch`) by how many Pool slots are bound to
 * Soldiers, and the hash and the snapshot of the Match on every 10th Tick, the Floors' cold builds and the destination fields built while a Floor
 * is played, and follows each Warband from the states alone: whether it met the party (a Soldier promoted), chased, was wiped, returned home, how
 * long each excursion out of GUARD or PATROL lasted, and the patrols' legs and loops. It also writes down how the promoted enemies live and die
 * (the diagnosis of why a fight can last): each stint's length, role and end, the blows landed a minute, whether the party moves toward its route,
 * and whether Warbands follow one another into the fight. A second test, the patrols, leaves the party standing in the Entrance and watches each
 * patrol Warband that never leaves its loop for 120 s walk it: each leg against its walking time, and how well its Soldiers keep their places.
 * A third checks that the two tests together exercised what they measure.
 */
const base = loadTuningData();
/** The five Runs: Random Map names, so the Run seed is `runSeed(name)` and Floor k is `floorArenaName(seed, k)`. */
const RUNS = [
  "gen:greybox:4242",
  "gen:greybox:101",
  "gen:greybox:777",
  "gen:greybox:31337",
  "gen:greybox:2026",
];
const FLOORS = 3;
/** A Run's cap of simulated time (s): 15 minutes. */
const RUN_SECONDS = 15 * 60;
/** Every this many Ticks the Match is hashed and snapshotted (each timed). */
const COPY_EVERY = 10;
/** The chase-given-up scenario: how long (s) the Player walks away. */
const AWAY_SECONDS = 60;
/** The patrols test: how long (s) the party stands in the Entrance. */
const PATROL_SECONDS = 120;

/** An excursion (leaving GUARD or PATROL to being back) may not last longer (s), nor a RETURN, nor a patrol's leg; a leg may take twice its walking time plus `LEG_SLACK`. */
const EXCURSION_MAX = 150;
const RETURN_MAX = 60;
const LEG_MAX = 60;
const LEG_SLACK = 10;
/** A Soldier further than this (m) from its Formation place is "off" it; one off it by `LOST` for longer than `LOST_SECONDS` is lost. */
const OFF_PLACE = 3;
const LOST = 6;
const LOST_SECONDS = 10;

const LINEUP: Lineup = [
  { team: 0, pilot: { kind: "Player", player: 0 } },
  { team: 0, pilot: { kind: "AI", difficulty: "Hard" } },
  { team: 0, pilot: { kind: "AI", difficulty: "Hard" } },
  ...Array.from({ length: MAX_TEAM_SIZE }, () => ({
    team: 1,
    pilot: { kind: "AI" as const, difficulty: "Floor" },
  })),
];

/**
 * The bundled Tuning cut to one tier of three Floors (`tierHp` and `warbands` to that one tier), with its tier's `boss` removed: Floor 3 would be a
 * Boss Floor, and these cases follow Warbands on a Run that ends at the last Stairs (docs/plans/delver.md, Stage 4, §10). Elites stay in. A new
 * object each call: its Floors build cold.
 */
const runTuning = (): TuningData => ({
  ...base,
  delver: {
    ...base.delver,
    tiers: 1,
    floorsPerTier: FLOORS,
    tierHp: base.delver.tierHp.slice(0, 1),
    warbands: base.delver.warbands
      .slice(0, 1)
      .map(({ boss: _boss, ...tier }) => tier),
  },
});

const f = (x: number, d = 1) => x.toFixed(d);
const secs = (ticks: number): number => ticks * TICK_SECONDS;
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const percentile = (xs: readonly number[], p: number): number =>
  xs.length === 0
    ? 0
    : [...xs].sort((a, b) => a - b)[
        Math.min(xs.length - 1, Math.floor(xs.length * p))
      ]!;
const maxOf = (xs: readonly number[]): number =>
  xs.reduce((a, b) => Math.max(a, b), 0);
const stat = (xs: readonly number[]): string =>
  xs.length === 0
    ? "-"
    : `${xs.length}x mean ${f(mean(xs))} max ${f(maxOf(xs))}`;

/** What the two tests saw, for the third. */
const seen = {
  promotions: 0,
  chases: 0,
  returns: 0,
  wiped: 0,
  loops: 0,
  givenUp: 0,
};

// ------------------------------------------------------------------ the Warbands, followed from the states

/** One leg of a patrol that was walked to its end. */
interface Leg {
  /** Ticks from its start to the leg advancing. */
  readonly ticks: number;
  /** Where the anchor stood when the leg began, and the loop point it walked to. */
  readonly from: { readonly x: number; readonly z: number; readonly s: number };
  readonly target: number;
  /** Soldier-steps off place by `OFF_PLACE`, of all, and the longest (ticks) a Soldier stayed `LOST` off (the patrols test fills these). */
  readonly off: number;
  readonly steps: number;
  readonly lost: number;
}

/** A Warband's record over a Floor. */
interface Row {
  readonly q: number;
  readonly kind: "guard" | "patrol";
  readonly size: number;
  readonly points: number;
  met: boolean;
  chases: number;
  chaseStarts: number[];
  wiped: boolean;
  returned: number;
  /** The Ticks each closed excursion lasted, and the Tick the open one began. */
  excursions: number[];
  out: number | null;
  /** Each RETURN's length (Ticks) and the Tick the open one began. */
  returns: number[];
  homing: number | null;
  legs: Leg[];
  legStart: number | null;
  legFrom: { x: number; z: number; s: number };
  streak: number;
  loops: number;
  /** The patrols test's accumulators over the leg being walked. */
  acc: { off: number; steps: number; lost: number };
  /** Closed at the Floor's end: the open excursion, RETURN and leg (Ticks), or null. */
  openOut: number | null;
  openReturn: number | null;
  openLeg: number | null;
}

const isHome = (mode: number): boolean => mode === GUARD || mode === PATROL;

/** Follows a Floor's Warbands Tick by Tick from the Match states (no Simulation change). */
class Tracker {
  readonly rows: Row[];

  constructor(first: MatchState, homes: WarbandHomes) {
    const c = first.duel.crowd!;
    const w = c.warbands!;
    this.rows = w.mode.map((_, q): Row => {
      const patrol = w.patrol[q]! >= 0;
      const at = {
        x: c.squads.x[q]!,
        z: c.squads.z[q]!,
        s: c.squads.surface[q]!,
      };
      return {
        q,
        kind: patrol ? "patrol" : "guard",
        size: w.size[q]!,
        points: patrol ? homes.patrols[w.patrol[q]!]!.length : 0,
        met: false,
        chases: 0,
        chaseStarts: [],
        wiped: false,
        returned: 0,
        excursions: [],
        out: null,
        returns: [],
        homing: null,
        legs: [],
        legStart: patrol && w.mode[q] === PATROL ? first.tick : null,
        legFrom: at,
        streak: 0,
        loops: 0,
        acc: { off: 0, steps: 0, lost: 0 },
        openOut: null,
        openReturn: null,
        openLeg: null,
      };
    });
  }

  /** Account for Tick `cur.tick` (stepped from `prev`). */
  observe(prev: MatchState, cur: MatchState): void {
    const pw = prev.duel.crowd!.warbands!;
    const c = cur.duel.crowd!;
    const w = c.warbands!;
    const tick = cur.tick;
    for (const row of this.rows) {
      const q = row.q;
      const mp = pw.mode[q]!;
      const mc = w.mode[q]!;
      if (mc === CHASE && mp !== CHASE) {
        row.chases++;
        row.chaseStarts.push(tick);
      }
      if (isHome(mp) && !isHome(mc)) row.out = tick;
      if (!isHome(mp) && isHome(mc)) {
        row.excursions.push(tick - row.out!);
        row.out = null;
        if (mp === RETURN) row.returned++;
      }
      if (mc === RETURN && mp !== RETURN) row.homing = tick;
      if (mp === RETURN && mc !== RETURN) {
        row.returns.push(tick - row.homing!);
        row.homing = null;
      }
      if (c.squads.living[q] === 0 && !row.wiped) {
        // Wiped: it thinks no more, so what it had open ends here (its mode stays as it was).
        row.wiped = true;
        if (row.out !== null) row.excursions.push(tick - row.out);
        if (row.homing !== null) row.returns.push(tick - row.homing);
        row.out = null;
        row.homing = null;
        row.legStart = null;
        continue;
      }
      if (row.wiped) continue;
      if (row.kind === "patrol") {
        if (mc === PATROL && mp !== PATROL) {
          row.legStart = tick;
          row.streak = 0;
          row.legFrom = {
            x: c.squads.x[q]!,
            z: c.squads.z[q]!,
            s: c.squads.surface[q]!,
          };
        } else if (mc !== PATROL) row.legStart = null;
        else if (w.leg[q] !== pw.leg[q]) {
          row.legs.push({
            ticks: tick - row.legStart!,
            from: row.legFrom,
            target: pw.leg[q]!,
            off: row.acc.off,
            steps: row.acc.steps,
            lost: row.acc.lost,
          });
          row.acc = { off: 0, steps: 0, lost: row.acc.lost };
          row.legStart = tick;
          row.legFrom = {
            x: c.squads.x[q]!,
            z: c.squads.z[q]!,
            s: c.squads.surface[q]!,
          };
          if (++row.streak >= row.points) {
            row.loops++;
            row.streak = 0;
          }
        }
      }
    }
    // A Soldier promoted marks its Warband as met.
    const pc = prev.duel.crowd!;
    for (let i = 0; i < c.slot.length; i++) {
      if (c.slot[i]! >= 0 && pc.slot[i]! < 0 && c.squad[i]! >= 0)
        this.rows[c.squad[i]!]!.met = true;
    }
  }

  /** The Floor ends on Tick `tick`: what is still open. */
  finish(tick: number): void {
    for (const row of this.rows) {
      if (row.out !== null) row.openOut = tick - row.out;
      if (row.homing !== null) row.openReturn = tick - row.homing;
      if (row.legStart !== null) row.openLeg = tick - row.legStart;
    }
  }
}

// ------------------------------------------------------------------ the fight, followed from the states (the diagnosis)

/** One promoted enemy's stay in a Pool slot, from its Promotion to the end of it. */
interface Stint {
  readonly soldier: number;
  readonly q: number;
  readonly start: number;
  /** The Warband's mode on the Tick it was promoted. */
  readonly mode: number;
  end: number;
  attack: number;
  waiting: number;
  how: "fell" | "demoted Waiting" | "demoted Attack" | "open";
}

/** A minute of a Floor's play. */
interface Minute {
  ticks: number;
  /** Ticks the pilot's `promotedNear` held. */
  near: number;
  /** Sums over Ticks of the promoted enemies by role and of Warbands in CHASE, bound slots. */
  attack: number;
  waiting: number;
  chasing: number;
  bound: number;
  pilotBlows: number;
  allyBlows: number;
  enemyBlows: number;
  toEnemy: number;
  toParty: number;
  promoted: number;
  fell: number;
  demoted: number;
  /** The pilot's path (m) and its distance (m) to the Stairs zone's centre at the minute's start and end. */
  walked: number;
  from: number;
  to: number;
}

const newMinute = (): Minute => ({
  ticks: 0,
  near: 0,
  attack: 0,
  waiting: 0,
  chasing: 0,
  bound: 0,
  pilotBlows: 0,
  allyBlows: 0,
  enemyBlows: 0,
  toEnemy: 0,
  toParty: 0,
  promoted: 0,
  fell: 0,
  demoted: 0,
  walked: 0,
  from: NaN,
  to: NaN,
});

/** Everything about one Floor of a Run. */
interface FloorReport {
  floor: number;
  start: number;
  end: number | null;
  /** 'Stairs', 'Defeat', 'Victory' or 'cap'. */
  how: string;
  party: string;
  warbands: Tracker;
  stints: Stint[];
  promotions: Map<number, number>;
  minutes: Minute[];
  /** Ticks (ms) by bound slots: 0, 1-4, 5-8, 9+. */
  costs: number[][];
  hash: number[];
  snap: number[];
  build: number;
  fieldsAt: { count: number; ms: number };
  fields: { count: number; ms: number };
  /** Chase starts: [Tick, Warband, the pilot was held by `promotedNear`]. */
  chaseStarts: [number, number, boolean][];
  maxChasing: number;
  soldiers: number;
  deadAtEnd: number;
  stairs: { x: number; z: number };
}

const BOUND = ["0", "1-4", "5-8", "9+"];
const bucket = (bound: number): number =>
  bound === 0 ? 0 : bound <= 4 ? 1 : bound <= 8 ? 2 : 3;

interface RunReport {
  name: string;
  seed: number;
  floors: FloorReport[];
  ticks: number;
  ended: string;
  seconds: number;
}

/** How a Run is set up: the soak's own, or the slow co-op test's party. */
interface RunOptions {
  lineup?: Lineup;
  /** The Match seed. */
  seed?: number;
  /** The Players' Weapon, when not the default. */
  weapon?: string;
  /** The Run's cap (s of simulated time). */
  seconds?: number;
  /** Stop when this Floor has ended (default: play the Run out). */
  stopAfter?: number;
  /** The Tuning (default `runTuning()`), and how many Floors it has (default `FLOORS`). */
  tuning?: TuningData;
  floors?: number;
  /** Called on every Tick with the Match before and after it, and the Tuning. */
  watch?: (at: MatchState, next: MatchState, tuning: TuningData) => void;
}

/** Play one Run to its end or the cap, following it. */
function playRun(name: string, options: RunOptions = {}): RunReport {
  const lineup = options.lineup ?? LINEUP;
  const matchSeed = options.seed ?? 7;
  const players = lineup.flatMap((s, i) =>
    s.pilot.kind === "Player" ? [i] : [],
  );
  const cap = secondsToTicks(options.seconds ?? RUN_SECONDS);
  const tuning = options.tuning ?? runTuning();
  const seed = runSeed(name);
  // A cold tuning object: each Floor is built here for the first time, then the Match reads them from the cache.
  const builds = Array.from({ length: options.floors ?? FLOORS }, (_, k) => {
    const t0 = performance.now();
    floorOf(tuning, floorArenaName(seed, k + 1));
    return performance.now() - t0;
  });
  let m = createMatch(tuning, {
    format: "Gauntlet",
    bestOf: 1,
    seed: matchSeed,
    arena: name,
    delver: true,
    teams: lineup.map((s) => s.team),
    humans: players.length,
    players,
    ...(options.weapon === undefined
      ? {}
      : { weapons: lineup.map(() => options.weapon!) }),
  });
  const controllers: Controller[] = lineupAis(tuning, lineup, "Gauntlet", {
    seed: matchSeed,
    arena: name,
    delver: true,
  }).map((c) => c ?? createDelverPilot(tuning, "Hard"));
  const k = m.config.teams.length;
  const floors: FloorReport[] = [];
  let live: { report: FloorReport; open: Map<number, Stint> } | null = null;

  const begin = (match: MatchState): void => {
    const arena = match.duel.arena;
    const plan = floorOf(tuning, arena)!.plan;
    const zone = plan.markers.stairs.zone;
    const report: FloorReport = {
      floor: match.delver!.floor,
      start: match.tick,
      end: null,
      how: "cap",
      party: "",
      warbands: new Tracker(match, warbandHomes(plan)),
      stints: [],
      promotions: new Map(),
      minutes: [],
      costs: BOUND.map(() => []),
      hash: [],
      snap: [],
      build: builds[match.delver!.floor - 1]!,
      fieldsAt: { ...fieldBuilds() },
      fields: { count: 0, ms: 0 },
      chaseStarts: [],
      maxChasing: 0,
      soldiers: match.duel.crowd!.x.length,
      deadAtEnd: 0,
      stairs: { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 },
    };
    floors.push(report);
    live = { report, open: new Map() };
  };

  /** Follow the fight and the pilot over the Tick `prev` to `cur`. */
  const follow = (
    L: NonNullable<typeof live>,
    prev: MatchState,
    cur: MatchState,
    near: boolean,
  ): void => {
    const r = L.report;
    const c = cur.duel.crowd!;
    const pc = prev.duel.crowd!;
    const minuteIndex = Math.floor((cur.tick - r.start) / secondsToTicks(60));
    while (r.minutes.length <= minuteIndex) r.minutes.push(newMinute());
    const min = r.minutes[minuteIndex]!;
    const pilot = cur.duel.fighters[0]!;
    const before = prev.duel.fighters[0]!;
    if (Number.isNaN(min.from))
      min.from = Math.hypot(
        pilot.position.x - r.stairs.x,
        pilot.position.z - r.stairs.z,
      );
    min.to = Math.hypot(
      pilot.position.x - r.stairs.x,
      pilot.position.z - r.stairs.z,
    );
    min.walked += Math.hypot(
      pilot.position.x - before.position.x,
      pilot.position.z - before.position.z,
    );
    min.ticks++;
    if (near) min.near++;
    let chasing = 0;
    for (const mode of c.warbands!.mode) if (mode === CHASE) chasing++;
    min.chasing += chasing;
    r.maxChasing = Math.max(r.maxChasing, chasing);
    for (let q = 0; q < c.warbands!.mode.length; q++) {
      if (c.warbands!.mode[q] === CHASE && pc.warbands!.mode[q] !== CHASE) {
        r.chaseStarts.push([cur.tick, q, near]);
      }
    }
    // The promoted enemies: roles, stints, ends.
    for (let kSlot = k; kSlot < cur.duel.fighters.length; kSlot++) {
      const fighter = cur.duel.fighters[kSlot]!;
      if (fighter.soldier === undefined || fighter.team !== 1) continue;
      min.bound++;
      const stint = L.open.get(fighter.soldier.index);
      if (fighter.soldier.role === "Attack") {
        min.attack++;
        if (stint) stint.attack++;
      } else if (fighter.soldier.role === "Waiting") {
        min.waiting++;
        if (stint) stint.waiting++;
      }
    }
    for (let i = 0; i < c.slot.length; i++) {
      const was = pc.slot[i]!;
      const now = c.slot[i]!;
      if (was < 0 && now >= 0) {
        const stint: Stint = {
          soldier: i,
          q: c.squad[i]!,
          start: cur.tick,
          mode: cur.duel.crowd!.warbands!.mode[c.squad[i]!]!,
          end: cur.tick,
          attack: 0,
          waiting: 0,
          how: "open",
        };
        L.open.set(i, stint);
        r.stints.push(stint);
        r.promotions.set(i, (r.promotions.get(i) ?? 0) + 1);
        min.promoted++;
      }
      const stint = L.open.get(i);
      if (!stint) continue;
      if (pc.alive[i] && !c.alive[i]) {
        stint.end = cur.tick;
        stint.how = "fell";
        L.open.delete(i);
        min.fell++;
      } else if (was >= 0 && now < 0) {
        stint.end = cur.tick;
        stint.how =
          prev.duel.fighters[was]?.soldier?.role === "Waiting"
            ? "demoted Waiting"
            : "demoted Attack";
        L.open.delete(i);
        min.demoted++;
      }
    }
    // The blows landed.
    for (const e of cur.duel.events) {
      if (e.type !== "Hit") continue;
      const hit = e as HitEvent;
      if (hit.attacker < k && hit.defender >= k) {
        if (hit.attacker === 0) min.pilotBlows++;
        else min.allyBlows++;
        min.toEnemy += hit.damage;
      } else if (hit.attacker >= k && hit.defender < k) {
        min.enemyBlows++;
        min.toParty += hit.damage;
      }
    }
  };

  const finish = (
    L: NonNullable<typeof live>,
    match: MatchState,
    how: string,
  ): void => {
    const r = L.report;
    r.end = match.tick;
    r.how = how;
    r.warbands.finish(match.tick);
    for (const stint of L.open.values()) stint.end = match.tick;
    const now = fieldBuilds();
    r.fields = {
      count: now.count - r.fieldsAt.count,
      ms: now.ms - r.fieldsAt.ms,
    };
    r.party = match.duel.fighters
      .slice(0, k)
      .map(
        (x, i) =>
          `${i === 0 ? "pilot" : `ally ${i}`} ${inDuel(x) ? `${f(x.hp, 0)}/${f(x.maxHp, 0)}` : "down"}`,
      )
      .join(", ");
    const c = match.duel.crowd!;
    r.deadAtEnd = c.alive.filter((a) => a === 0).length;
  };

  begin(m);
  let ended = "cap";
  let t = 0;
  for (; t < cap; t++) {
    const L = live!;
    const at = m;
    const t0 = performance.now();
    const next = stepMatch(at, controllerIntents(at.duel, controllers), tuning);
    const ms = performance.now() - t0;
    options.watch?.(at, next, tuning);
    const bound = next.duel.fighters
      .slice(k)
      .filter((x) => x.soldier !== undefined).length;
    const over = next.status.status === "Over";
    const events = next.events as readonly MatchEvent[];
    const newFloor = events.some((e) => e.type === "DuelStart");
    if (!newFloor) {
      L.report.costs[bucket(bound)]!.push(ms);
      if (next.tick % COPY_EVERY === 0) {
        const h0 = performance.now();
        hashValue(next);
        const h1 = performance.now();
        snapshot(next);
        L.report.hash.push(h1 - h0);
        L.report.snap.push(performance.now() - h1);
      }
      if (L.report.end === null) {
        const near = promotedNear(tuning, at.duel, 0);
        L.report.warbands.observe(at, next);
        follow(L, at, next, near);
      }
    }
    const stairs = events.some((e) => e.type === "StairsTaken");
    const runEnd = events.find((e) => e.type === "RunEnd") as
      | Extract<MatchEvent, { type: "RunEnd" }>
      | undefined;
    if (stairs && L.report.end === null) finish(L, next, "Stairs");
    if (runEnd) {
      finish(L, next, runEnd.winner === 0 ? "Victory" : "Defeat");
      ended = runEnd.winner === 0 ? "Victory" : "Defeat";
    }
    m = next;
    if (newFloor) begin(m);
    if (
      over ||
      (options.stopAfter !== undefined &&
        floors.length >= options.stopAfter &&
        floors[options.stopAfter - 1]!.end !== null)
    )
      break;
  }
  if (live!.report.end === null) finish(live!, m, "cap");
  return { name, seed, floors, ticks: m.tick, ended, seconds: secs(m.tick) };
}

// ------------------------------------------------------------------ printing

function printFloor(r: FloorReport): string[] {
  const out: string[] = [];
  const dur = (r.end! - r.start) * TICK_SECONDS;
  const rows = r.warbands.rows;
  const count = (p: (x: Row) => boolean) => rows.filter(p).length;
  out.push(
    `  Floor ${r.floor}: ${f(dur)} s, ended ${r.how}${r.how === "Stairs" ? ` at Tick ${r.end}` : r.how === "Defeat" ? ` at Tick ${r.end}` : ""}; party then: ${r.party}`,
  );
  out.push(
    `    Warbands ${rows.length} deployed (${count((x) => x.kind === "guard")} guards, ${count((x) => x.kind === "patrol")} patrols, ${r.soldiers} Soldiers): met ${count((x) => x.met)}, chased ${count((x) => x.chases > 0)} ` +
      `(${rows.reduce((a, x) => a + x.chases, 0)} chases), wiped ${count((x) => x.wiped)}, returned ${count((x) => x.returned > 0)} (${rows.reduce((a, x) => a + x.returned, 0)} returns); Soldiers dead ${r.deadAtEnd}/${r.soldiers}`,
  );
  const exc = rows.flatMap((x) => x.excursions).map(secs);
  out.push(
    `    time out of place: ${exc.length} excursions, mean ${f(mean(exc))} s, max ${f(maxOf(exc))} s; open at the end ${JSON.stringify(rows.filter((x) => x.openOut !== null).map((x) => `W${x.q} ${f(secs(x.openOut!))} s`))}; ` +
      `returns ${rows.flatMap((x) => x.returns).length} mean ${f(mean(rows.flatMap((x) => x.returns).map(secs)))} s max ${f(maxOf(rows.flatMap((x) => x.returns).map(secs)))} s`,
  );
  const legs = rows.flatMap((x) => x.legs.map((l) => secs(l.ticks)));
  out.push(
    `    patrols: ${legs.length} legs completed (${stat(legs)} s), ${rows.reduce((a, x) => a + x.loops, 0)} whole loops; longest leg open at the end ${f(maxOf(rows.filter((x) => x.openLeg !== null).map((x) => secs(x.openLeg!))))} s`,
  );
  out.push(
    `    Tick ms (mean/p99/max) by bound slots: ${BOUND.map((b, i) => `${b}: ${r.costs[i]!.length === 0 ? "-" : `${f(mean(r.costs[i]!), 2)}/${f(percentile(r.costs[i]!, 0.99), 2)}/${f(maxOf(r.costs[i]!), 1)} (${r.costs[i]!.length})`}`).join("; ")}`,
  );
  out.push(
    `    Floor build ${f(r.build, 0)} ms (cold); field builds ${r.fields.count}, ${f(r.fields.ms, 0)} ms total, ${f(r.fields.count === 0 ? 0 : r.fields.ms / r.fields.count, 1)} ms each; hash ${f(mean(r.hash), 3)}/${f(percentile(r.hash, 0.99), 3)}/${f(maxOf(r.hash), 2)} ms, snapshot ${f(mean(r.snap), 3)}/${f(percentile(r.snap, 0.99), 3)}/${f(maxOf(r.snap), 2)} ms (mean/p99/max, ${r.hash.length} each)`,
  );
  // The Warbands that did anything.
  for (const x of rows.filter(
    (y) => y.met || y.chases > 0 || y.wiped || y.openOut !== null,
  )) {
    out.push(
      `      W${x.q} ${x.kind}${x.kind === "patrol" ? ` (${x.points} pts)` : ""} size ${x.size}: ${[
        x.met ? "met" : "",
        x.chases > 0 ? `chased x${x.chases}` : "",
        x.wiped ? "WIPED" : "",
        x.returned > 0 ? `returned x${x.returned}` : "",
      ]
        .filter(Boolean)
        .join(
          ", ",
        )}; excursions ${stat(x.excursions.map(secs))}${x.openOut !== null ? `; OPEN ${f(secs(x.openOut))} s` : ""}${x.openReturn !== null ? `; RETURN open ${f(secs(x.openReturn))} s` : ""}`,
    );
  }
  // The diagnosis.
  const st = r.stints;
  const fell = st.filter((s) => s.how === "fell");
  const demW = st.filter((s) => s.how === "demoted Waiting");
  const demA = st.filter((s) => s.how === "demoted Attack");
  const open = st.filter((s) => s.how === "open");
  const len = (xs: readonly Stint[]) => xs.map((s) => secs(s.end - s.start));
  const distinct = r.promotions.size;
  const re = [...r.promotions.values()].reduce((a, n) => a + n - 1, 0);
  out.push(
    `    promoted enemies: ${st.length} stints of ${distinct} Soldiers (${re} re-promotions; max ${maxOf([...r.promotions.values()])} for one); stay mean ${f(mean(len(st)))} s p50 ${f(percentile(len(st), 0.5))} max ${f(maxOf(len(st)))}; ` +
      `ended: fell ${fell.length} (stay ${f(mean(len(fell)))} s), demoted Waiting ${demW.length} (${f(mean(len(demW)))} s), demoted Attack/far ${demA.length} (${f(mean(len(demA)))} s), still promoted ${open.length} (${f(mean(len(open)))} s); ` +
      `role time Attack ${f(secs(st.reduce((a, s) => a + s.attack, 0)), 0)} s, Waiting ${f(secs(st.reduce((a, s) => a + s.waiting, 0)), 0)} s; Warband mode at Promotion: ` +
      `${["GUARD", "PATROL", "CHASE", "RETURN"].map((n, i) => `${n} ${st.filter((s) => s.mode === i).length}`).join(", ")}`,
  );
  out.push(
    "    minute | held(promotedNear) | pilot walked m | Stairs dist m (start>end) | Attack/Waiting avg | Warbands chasing avg | pilot/ally/enemy blows | dmg to enemies/party | promoted/fell/demoted",
  );
  r.minutes.forEach((x, i) => {
    out.push(
      `    ${String(i).padStart(6)} | ${f((100 * x.near) / Math.max(1, x.ticks), 0).padStart(3)}% | ${f(x.walked).padStart(6)} | ${f(x.from).padStart(5)}>${f(x.to).padEnd(5)} | ${f(x.attack / Math.max(1, x.ticks))}/${f(x.waiting / Math.max(1, x.ticks))} | ${f(x.chasing / Math.max(1, x.ticks))} | ${x.pilotBlows}/${x.allyBlows}/${x.enemyBlows} | ${f(x.toEnemy, 0)}/${f(x.toParty, 0)} | ${x.promoted}/${x.fell}/${x.demoted}`,
    );
  });
  const during = r.chaseStarts.filter((c) => c[2]).length;
  out.push(
    `    train of Warbands: ${r.chaseStarts.length} chases started, ${during} while the pilot was held by a promoted enemy, at most ${r.maxChasing} chasing at once; starts (s from the Floor's start, Warband): ` +
      `${r.chaseStarts
        .slice(0, 14)
        .map(
          (c) =>
            `${f((c[0] - r.start) * TICK_SECONDS, 0)} W${c[1]}${c[2] ? "*" : ""}`,
        )
        .join(", ")}${r.chaseStarts.length > 14 ? ", ..." : ""}`,
  );
  return out;
}

// ------------------------------------------------------------------ the tests

// ------------------------------------------------------------------ the full Run, with Bosses

/** The full Run's cap of simulated time (s): 60 minutes. */
const FULL_SECONDS = 60 * 60;
const FULL_RUN = "gen:greybox:4242";
const RANKS = ["plain", "elite", "boss"];

/** What one Floor of the full Run showed, followed from the Match states and events. */
interface BossFloor {
  floor: number;
  /** Warbands by rank [PLAIN, ELITE, BOSS]: deployed, met (a Soldier promoted), wiped. */
  deployed: number[];
  met: number[];
  wiped: number[];
  /** Items laid by WarbandWiped events (and of them Relics), Warband drops taken, pedestals taken. */
  laid: number;
  laidRelics: number;
  dropsTaken: number;
  pedestalsTaken: number;
  /** Elite Warbands wiped, and the Relic one carried (its template's first) laid, and taken. */
  eliteWiped: number;
  eliteRelicLaid: number;
  eliteRelicTaken: number;
  /** A Boss Floor: the Tick the Boss Soldier was first promoted, the Pool slot it took, the Tick another Soldier of its Warband was first promoted, the wipe, the gate opening and StairsTaken. */
  bossPromoted: number | null;
  bossSlot: number;
  otherPromoted: number | null;
  bossWiped: number | null;
  beaten: number | null;
  gate: number | null;
  stairs: number | null;
}

const newBossFloor = (floor: number): BossFloor => ({
  floor,
  deployed: [0, 0, 0],
  met: [0, 0, 0],
  wiped: [0, 0, 0],
  laid: 0,
  laidRelics: 0,
  dropsTaken: 0,
  pedestalsTaken: 0,
  eliteWiped: 0,
  eliteRelicLaid: 0,
  eliteRelicTaken: 0,
  bossPromoted: null,
  bossSlot: -1,
  otherPromoted: null,
  bossWiped: null,
  beaten: null,
  gate: null,
  stairs: null,
});

/** Plays the full Run on `tuning` and follows the Bosses and the loot. */
function playBossRun(tuning: TuningData, seconds = FULL_SECONDS) {
  const floors: BossFloor[] = [];
  let runEnd: Extract<MatchEvent, { type: "RunEnd" }> | undefined;
  const total = tuning.delver.tiers * tuning.delver.floorsPerTier;
  /** The Warbands of the Floor in play that already met the party, and the ids of the elite Relics laid on it. */
  let metQ = new Set<number>();
  let relicIds = new Set<number>();
  const wall = performance.now();
  const run = playRun(FULL_RUN, {
    tuning,
    floors: total,
    seconds,
    watch: (at, next) => {
      const events = next.events as readonly MatchEvent[];
      const found = events.find((e) => e.type === "RunEnd");
      if (found) runEnd = found as typeof runEnd;
      if (floors.length === 0 || next.delver!.floor !== at.delver!.floor) {
        // A new Floor: its Warbands as deployed.
        const b = newBossFloor(next.delver!.floor);
        for (const r of next.duel.crowd!.warbands!.rank) b.deployed[r]!++;
        floors.push(b);
        metQ = new Set();
        relicIds = new Set();
        return;
      }
      const b = floors[floors.length - 1]!;
      const c = next.duel.crowd!;
      const pc = at.duel.crowd!;
      const w = c.warbands!;
      const bq = w.rank.indexOf(BOSS);
      const boss = bq < 0 ? -1 : c.squad.findIndex((sq) => sq === bq);
      const plan = floorOf(tuning, next.duel.arena)!.plan;
      // Promotions: a Soldier whose Pool slot was none and now is one.
      for (let i = 0; i < c.slot.length; i++) {
        if (!(pc.slot[i]! < 0 && c.slot[i]! >= 0)) continue;
        const q = c.squad[i]!;
        if (!metQ.has(q)) {
          metQ.add(q);
          b.met[w.rank[q]!]!++;
        }
        if (q !== bq) continue;
        if (i === boss) {
          if (b.bossPromoted === null) {
            b.bossPromoted = next.tick;
            b.bossSlot = c.slot[i]!;
          }
        } else if (b.otherPromoted === null) b.otherPromoted = next.tick;
      }
      if (
        b.gate === null &&
        plan.halls[plan.stairs]!.kind === "Boss" &&
        gateOpen(plan, c, next.delver!.wiped)
      )
        b.gate = next.tick;
      const before = at.delver!.pickups;
      const after = next.delver!.pickups;
      for (const e of events) {
        if (e.type === "WarbandWiped") {
          b.wiped[e.rank]!++;
          if (e.rank === BOSS) b.bossWiped = next.tick;
          // The items it laid: appended to the pickups this Tick.
          const laid = after.slice(before.length);
          b.laid += laid.length;
          b.laidRelics += laid.filter((p) => p.kind === "relic").length;
          if (e.rank === ELITE) {
            b.eliteWiped++;
            const carried =
              tuning.delver.warbands[tierOf(tuning.delver, b.floor) - 1]!
                .elite?.[w.encounter[e.warband]!]?.relics[0];
            for (const p of laid)
              if (p.kind === "relic" && p.item === carried) {
                b.eliteRelicLaid++;
                relicIds.add(p.id);
              }
          }
        } else if (e.type === "ItemTaken") {
          const p = after.find((x) => x.id === e.id);
          if (p === undefined) continue;
          if (p.group !== undefined) b.pedestalsTaken++;
          else if (p.owner !== null && p.by === undefined) {
            b.dropsTaken++;
            if (relicIds.has(p.id)) b.eliteRelicTaken++;
          }
        } else if (e.type === "BossBeaten") b.beaten = next.tick;
        else if (e.type === "StairsTaken") b.stairs = next.tick;
      }
    },
  });
  return {
    run,
    floors,
    runEnd,
    wall: (performance.now() - wall) / 1000,
    total,
  };
}

type BossRun = ReturnType<typeof playBossRun>;

/**
 * The test Tuning of the asserted full Run: the bundled one with two knobs eased, because the Delver pilot (Hard, two Hard allies) does not win the
 * bundled Run (it is worn down by Floor 6 or 9 in every Run tried; the case above prints where). Changed: `postFill` 75 to 25 (a quarter of the
 * guard posts filled instead of three quarters) and `tierHp` [1, 1.25, 1.5] to [1, 1, 1] (the deeper tiers' Soldiers as tough as tier 1's).
 * Neither alone won the Run seed 4242. Bosses, elites, patrols and loot are the bundled ones.
 */
const LENIENT: TuningData = {
  ...base,
  delver: { ...base.delver, postFill: 25, tierHp: [1, 1, 1] },
};

/** What the full Run did not exercise. */
function bossProblems(
  tuning: TuningData,
  { run, floors, runEnd, total }: BossRun,
): string[] {
  const problems: string[] = [];
  for (let fl = 1; fl <= total; fl++) {
    if (!isBossFloor(tuning.delver, fl)) continue;
    const b = floors[fl - 1];
    if (b === undefined) {
      problems.push(`Floor ${fl} (a Boss Floor) was never reached`);
      continue;
    }
    if (b.bossPromoted === null)
      problems.push(`Floor ${fl}: the Boss Soldier was never promoted`);
    else if (b.otherPromoted !== null && b.otherPromoted < b.bossPromoted)
      problems.push(
        `Floor ${fl}: a Soldier of the Boss Warband was promoted at Tick ${b.otherPromoted}, before the Boss's ${b.bossPromoted}`,
      );
    if (b.bossWiped === null || b.beaten === null)
      problems.push(
        `Floor ${fl}: the Boss Warband was not wiped (no BossBeaten)`,
      );
    if (b.gate === null) problems.push(`Floor ${fl}: the gate never opened`);
    if (fl < total && b.stairs === null)
      problems.push(`Floor ${fl}: no StairsTaken after the gate`);
  }
  const sum = (k: (b: BossFloor) => number) =>
    floors.reduce((a, b) => a + k(b), 0);
  if (sum((b) => b.dropsTaken) === 0)
    problems.push("no Warband drop was taken");
  if (sum((b) => b.pedestalsTaken) === 0)
    problems.push("no pedestal was taken");
  if (sum((b) => b.eliteWiped) === 0)
    problems.push("no elite Warband was wiped");
  else if (sum((b) => b.eliteRelicLaid) === 0)
    problems.push("no elite's carried Relic was laid");
  if (runEnd === undefined)
    problems.push(
      `no RunEnd: the Run hit the cap on Floor ${run.floors.length} at ${f(run.seconds, 0)} s`,
    );
  else {
    if (runEnd.winner !== 0)
      problems.push(
        `the Run was a Defeat on Floor ${run.floors.length} at ${f(run.seconds, 0)} s`,
      );
    if (runEnd.bosses !== 3)
      problems.push(`RunEnd.bosses was ${runEnd.bosses}, not 3`);
  }
  return problems;
}

/** The case's measurement: a block a Floor. */
function printBossRun(label: string, tuning: TuningData, r: BossRun): void {
  const lines = [
    `\n${label}: Run ${FULL_RUN}, ${r.run.ticks} Ticks (${f(r.run.seconds, 0)} s simulated, cap ${FULL_SECONDS} s), ended ${r.run.ended}${r.runEnd ? ` (RunEnd winner ${r.runEnd.winner}, bosses ${r.runEnd.bosses})` : ""}, ${f(r.wall, 0)} s wall`,
  ];
  const by = (xs: readonly number[]) =>
    RANKS.map((n, i) => `${xs[i]} ${n}`).join("/");
  for (const [i, b] of r.floors.entries()) {
    const fr = r.run.floors[i]!;
    const costs = fr.costs.flat();
    lines.push(
      `  Floor ${b.floor}${isBossFloor(tuning.delver, b.floor) ? " (Boss)" : ""}: ${f(secs(fr.end! - fr.start))} s, ended ${fr.how}; Tick ms mean ${f(mean(costs), 2)} p99 ${f(percentile(costs, 0.99), 2)}; party ${fr.party}`,
      `    Warbands deployed ${by(b.deployed)}; met ${by(b.met)}; wiped ${by(b.wiped)}`,
      `    loot: laid ${b.laid} (${b.laidRelics} Relics), drops taken ${b.dropsTaken}, pedestals taken ${b.pedestalsTaken}; elite wiped ${b.eliteWiped}, its Relic laid ${b.eliteRelicLaid} taken ${b.eliteRelicTaken}`,
    );
    if (isBossFloor(tuning.delver, b.floor))
      lines.push(
        `    Boss: promoted Tick ${b.bossPromoted ?? "-"} into Pool slot ${b.bossSlot}, another of its Warband promoted ${b.otherPromoted === null ? "never" : b.otherPromoted < (b.bossPromoted ?? Infinity) ? `BEFORE at Tick ${b.otherPromoted}` : b.otherPromoted === b.bossPromoted ? "on the same Tick" : `after at Tick ${b.otherPromoted}`}; wiped Tick ${b.bossWiped ?? "-"}; gate open Tick ${b.gate ?? "-"}; Stairs taken Tick ${b.stairs ?? "-"}`,
      );
  }
  console.log(lines.join("\n"));
}

describe("the Warband soak", { timeout: 120 * 60_000 }, () => {
  beforeAll(() => timeFieldBuilds(() => performance.now()));
  afterAll(() => timeFieldBuilds(null));

  it(`plays ${RUNS.length} Runs of ${FLOORS} Floors with Warbands (up to ${RUN_SECONDS / 60} minutes each) and measures the Tick, the hash, the snapshot and the field builds`, () => {
    const runs: RunReport[] = [];
    const t0 = performance.now();
    for (const name of RUNS) {
      const wall = performance.now();
      const run = playRun(name);
      runs.push(run);
      const lines = [
        `\nRun ${run.name} (Run seed ${run.seed}): ${run.ticks} Ticks (${f(run.seconds)} s simulated, cap ${RUN_SECONDS} s), ${run.ended}, ${f((performance.now() - wall) / 1000, 0)} s wall`,
      ];
      for (const r of run.floors) lines.push(...printFloor(r));
      console.log(lines.join("\n"));
    }

    // The summary.
    const floors = runs.flatMap((r) => r.floors);
    const all = floors.flatMap((r) => r.warbands.rows);
    const costs = BOUND.map((_, i) => floors.flatMap((r) => r.costs[i]!));
    const hash = floors.flatMap((r) => r.hash);
    const snap = floors.flatMap((r) => r.snap);
    const fields = floors.reduce(
      (a, r) => ({ count: a.count + r.fields.count, ms: a.ms + r.fields.ms }),
      { count: 0, ms: 0 },
    );
    const lines = [
      `\nSummary over ${runs.length} Runs, ${floors.length} Floors (wall ${f((performance.now() - t0) / 1000, 0)} s):`,
    ];
    lines.push(
      `  Runs: ${runs.map((r) => `${r.name} ${r.ended} on Floor ${r.floors.length} after ${f(r.seconds, 0)} s`).join("; ")}`,
    );
    lines.push(
      `  Floors ended: ${["Stairs", "Victory", "Defeat", "cap"].map((h) => `${h} ${floors.filter((r) => r.how === h).length}`).join(", ")}`,
    );
    lines.push(
      `  Warbands ${all.length}: met ${all.filter((x) => x.met).length}, chased ${all.filter((x) => x.chases > 0).length}, wiped ${all.filter((x) => x.wiped).length}, returned ${all.filter((x) => x.returned > 0).length}; ` +
        `excursions ${stat(all.flatMap((x) => x.excursions).map(secs))} s; patrol legs ${stat(all.flatMap((x) => x.legs.map((l) => secs(l.ticks))))} s, ${all.reduce((a, x) => a + x.loops, 0)} loops`,
    );
    lines.push(
      `  Tick ms (mean/p99/max) by bound slots: ${BOUND.map((b, i) => `${b}: ${costs[i]!.length === 0 ? "-" : `${f(mean(costs[i]!), 2)}/${f(percentile(costs[i]!, 0.99), 2)}/${f(maxOf(costs[i]!), 1)} (${costs[i]!.length})`}`).join("; ")}`,
    );
    const allTicks = costs.flat();
    lines.push(
      `  Tick ms over all ${allTicks.length} Ticks: mean ${f(mean(allTicks), 2)}, p99 ${f(percentile(allTicks, 0.99), 2)}, max ${f(maxOf(allTicks), 1)}`,
    );
    lines.push(
      `  hash ms (mean/p99/max over ${hash.length}): ${f(mean(hash), 3)}/${f(percentile(hash, 0.99), 3)}/${f(maxOf(hash), 2)}; snapshot ms: ${f(mean(snap), 3)}/${f(percentile(snap, 0.99), 3)}/${f(maxOf(snap), 2)}`,
    );
    lines.push(
      `  Floor builds (cold, ms): ${f(mean(floors.map((r) => r.build)), 0)} mean, ${f(maxOf(floors.map((r) => r.build)), 0)} max; field builds: ${fields.count} over ${floors.length} Floors (${f(fields.count / floors.length, 0)} a Floor), ${f(fields.ms, 0)} ms total, ${f(fields.count === 0 ? 0 : fields.ms / fields.count, 1)} ms each`,
    );
    const stints = floors.flatMap((r) => r.stints);
    lines.push(
      `  promoted enemies: ${stints.length} stints; ended ${["fell", "demoted Waiting", "demoted Attack", "open"].map((h) => `${h} ${stints.filter((s) => s.how === h).length}`).join(", ")}`,
    );
    console.log(lines.join("\n"));

    // The bounds: no Warband stuck.
    const stuck: string[] = [];
    for (const run of runs) {
      for (const r of run.floors) {
        const earlyDefeat =
          r.how === "Defeat" && secs(r.end! - r.start) <= EXCURSION_MAX;
        for (const x of r.warbands.rows) {
          const where = `${run.name} Floor ${r.floor} W${x.q} (${x.kind})`;
          for (const e of x.excursions)
            if (secs(e) > EXCURSION_MAX)
              stuck.push(
                `${where}: an excursion of ${f(secs(e))} s (over ${EXCURSION_MAX})`,
              );
          if (
            x.openOut !== null &&
            secs(x.openOut) > EXCURSION_MAX &&
            !earlyDefeat
          )
            stuck.push(
              `${where}: an excursion still open at the Floor's end (${r.how}) after ${f(secs(x.openOut))} s (over ${EXCURSION_MAX})`,
            );
          for (const e of x.returns)
            if (secs(e) > RETURN_MAX)
              stuck.push(
                `${where}: a RETURN of ${f(secs(e))} s (over ${RETURN_MAX})`,
              );
          if (x.openReturn !== null && secs(x.openReturn) > RETURN_MAX)
            stuck.push(
              `${where}: a RETURN open at the end for ${f(secs(x.openReturn))} s (over ${RETURN_MAX})`,
            );
          for (const l of x.legs)
            if (secs(l.ticks) > LEG_MAX)
              stuck.push(
                `${where}: a patrol leg of ${f(secs(l.ticks))} s (over ${LEG_MAX})`,
              );
          if (x.openLeg !== null && secs(x.openLeg) > LEG_MAX)
            stuck.push(
              `${where}: a patrol leg open at the end for ${f(secs(x.openLeg))} s (over ${LEG_MAX})`,
            );
        }
      }
    }
    seen.promotions += stints.length;
    seen.chases += all.reduce((a, x) => a + x.chases, 0);
    seen.returns += all.reduce((a, x) => a + x.returned, 0);
    seen.wiped += all.filter((x) => x.wiped).length;
    seen.loops += all.reduce((a, x) => a + x.loops, 0);
    expect(stuck, `a Warband was stuck:\n${stuck.join("\n")}`).toEqual([]);
  });

  it("diagnosis: the slow co-op test's party (two Hard Delver pilots, no allies, Arming Swords) on its Run, Floor 1, up to 400 s", () => {
    const lineup: Lineup = [
      { team: 0, pilot: { kind: "Player", player: 0 } },
      { team: 0, pilot: { kind: "Player", player: 1 } },
    ];
    const run = playRun("gen:greybox:4242", {
      lineup,
      seed: 9,
      weapon: "Arming Sword",
      seconds: 400,
      stopAfter: 1,
    });
    const lines = [
      `\nCo-op replica gen:greybox:4242 (match seed 9, 2 pilots, 400 s cap): ${run.ticks} Ticks (${f(run.seconds)} s), ${run.ended}`,
    ];
    for (const r of run.floors) lines.push(...printFloor(r));
    console.log(lines.join("\n"));
  });

  it("a chase given up: a lone Player in sight of a guard at 14 m (by walking) walks away by the navmesh, never fighting; the Warband chases, gives up and returns home with none of its Soldiers promoted", () => {
    const lines = [
      `\nA chase given up: Floor 1 of ${RUNS.length} Runs, one Player (no allies) put 12 to 15 m by walking from a guard's post, in sight of it and on the Entrance side of it, walking to the Entrance for ${AWAY_SECONDS} s.`,
    ];
    const problems: string[] = [];
    for (const name of RUNS) {
      const tuning = runTuning();
      const arena = floorArenaName(runSeed(name), 1);
      const lineup: Lineup = [
        { team: 0, pilot: { kind: "Player", player: 0 } },
      ];
      const start = createMatch(tuning, {
        format: "Gauntlet",
        bestOf: 1,
        seed: 7,
        arena: name,
        delver: true,
        teams: [0],
        humans: 1,
        players: [0],
      });
      const t = arenaTuning(tuning, arena);
      const map = battleMapOf(t.battle, arena);
      const fields = map.fields;
      const plan = floorOf(tuning, arena)!.plan;
      const homes = warbandHomes(plan);
      const w = start.duel.crowd!.warbands!;
      // The first guard with a spot: walking distance 12 to 15 m from its post, in sight of it, no Soldier of it within promote + 2.5 m flat (1.5 m on the last tier) (the Bubble's walking field reads a little short); nearest 14 m, then lower x, z.
      const entranceAt = plan.markers.spawns[0]!;
      const toEntrance = oneField(
        fields,
        fieldToward(
          fields,
          entranceAt.x,
          entranceAt.z,
          groundOf(t.battle, map.field, entranceAt.x, entranceAt.z, 0),
        ),
      );
      // Candidates, strictest first: the Entrance this much nearer by walking than the post is, then less; each guard's best spot once. They are tried
      // in order until one runs without a Promotion.
      const candidates: {
        q: number;
        x: number;
        z: number;
        walk: number;
        margin: number;
      }[] = [];
      for (const [margin, clear] of [
        [10, 2.5],
        [6, 2.5],
        [2, 2.5],
        [-100, 2.5],
        [-100, 1.5],
      ] as const) {
        for (let q = 0; q < w.mode.length; q++) {
          if (w.post[q]! < 0) continue;
          const post = homes.posts[w.post[q]!]!;
          const toPost = oneField(
            fields,
            fieldToward(
              fields,
              post.x,
              post.z,
              groundOf(t.battle, map.field, post.x, post.z, 0),
            ),
          );
          const soldiers = start.duel.crowd!.squad.flatMap((sq, i) =>
            sq === q ? [i] : [],
          );
          const found: { x: number; z: number; walk: number }[] = [];
          for (let dx = -15; dx <= 15; dx++)
            for (let dz = -15; dz <= 15; dz++) {
              const x = Math.round(post.x) + dx;
              const z = Math.round(post.z) + dz;
              const on = groundOf(t.battle, map.field, x, z, 0);
              if (
                on < 0 ||
                clearanceAt(fields, x, z, on) < 0.5 ||
                Math.hypot(dx, dz) > base.delver.sight
              )
                continue;
              const walk = fieldDistance(toPost, 0, x, z, on);
              if (
                walk < 12 ||
                walk > 15 ||
                !inSight(fields, post.x, post.z, x, z, 0)
              )
                continue;
              // The way to the Entrance leads away from the post, not past it.
              if (
                fieldDistance(toEntrance, 0, x, z, on) >
                fieldDistance(
                  toEntrance,
                  0,
                  post.x,
                  post.z,
                  groundOf(t.battle, map.field, post.x, post.z, 0),
                ) -
                  margin
              )
                continue;
              if (
                soldiers.some(
                  (i) =>
                    Math.hypot(
                      start.duel.crowd!.x[i]! - x,
                      start.duel.crowd!.z[i]! - z,
                    ) <
                    t.battle.bubble.promote + clear,
                )
              )
                continue;
              found.push({ x, z, walk });
            }
          found.sort(
            (a, b) =>
              Math.abs(a.walk - 14) - Math.abs(b.walk - 14) ||
              a.x - b.x ||
              a.z - b.z,
          );
          if (found[0] && !candidates.some((c) => c.q === q))
            candidates.push({ q, ...found[0], margin });
        }
      }
      if (candidates.length === 0) {
        problems.push(
          `${name}: no guard has a spot 12 to 15 m away by walking, in sight of its post`,
        );
        continue;
      }
      let outcome: { q: number; promoted: number; row: Row } | null = null;
      for (const chosen of candidates.slice(0, 8)) {
        const toward = chosen.margin;
        let m = start;
        const { q } = chosen;
        const post = homes.posts[w.post[q]!]!;
        const on = groundOf(t.battle, map.field, chosen.x, chosen.z, 0);
        m = {
          ...m,
          duel: {
            ...m.duel,
            fighters: m.duel.fighters.map((x, i) =>
              i === 0
                ? {
                    ...x,
                    position: { x: chosen!.x, z: chosen!.z },
                    y: soldierHeight(map.field, on, chosen!.x, chosen!.z),
                    facing: Math.atan2(chosen!.x - post.x, chosen!.z - post.z),
                  }
                : x,
            ),
          },
        };
        const walker = createAiController(tuning, "Hard");
        let entrance: { x: number; z: number } = plan.markers.spawns[0]!;
        if (toward < 0) {
          // No spot has the Entrance on its side of the post: it walks instead to the point (within 60 m of it) farthest from the post by walking.
          const toPost = oneField(
            fields,
            fieldToward(
              fields,
              post.x,
              post.z,
              groundOf(t.battle, map.field, post.x, post.z, 0),
            ),
          );
          let far = -1;
          for (let dx = -60; dx <= 60; dx += 2)
            for (let dz = -60; dz <= 60; dz += 2) {
              const x = Math.round(chosen.x) + dx;
              const z = Math.round(chosen.z) + dz;
              const at = groundOf(t.battle, map.field, x, z, 0);
              if (at < 0 || clearanceAt(fields, x, z, at) < 1) continue;
              const d = fieldDistance(toPost, 0, x, z, at);
              if (d > far) [far, entrance] = [d, { x, z }];
            }
        }
        const controllers: Controller[] = lineupAis(
          tuning,
          lineup,
          "Gauntlet",
          {
            seed: 7,
            arena: name,
            delver: true,
          },
        ).map(
          (c) =>
            c ?? {
              intent: (state, fighter) =>
                walker.walkTo(
                  state,
                  fighter,
                  { x: entrance.x, y: 0, z: entrance.z },
                  1,
                ),
              save: () => walker.save(),
              load: (x) => walker.load(x),
            },
        );
        const tracker = new Tracker(m, homes);
        const row = tracker.rows[q]!;
        let promoted = 0;
        let firstPromo = "";
        let nearest = Infinity;
        let ended = "";
        let chaseSecs = 0;
        const forget = secondsToTicks(base.delver.forgetSeconds);
        for (
          let tick = 0;
          tick < secondsToTicks(AWAY_SECONDS) && m.status.status !== "Over";
          tick++
        ) {
          const at = m;
          m = stepMatch(at, controllerIntents(at.duel, controllers), tuning);
          const pw = at.duel.crowd!.warbands!;
          if (
            pw.mode[q] === CHASE &&
            m.duel.crowd!.warbands!.mode[q] === RETURN
          )
            chaseSecs = secs(
              m.tick - row.chaseStarts[row.chaseStarts.length - 1]!,
            );
          if (
            pw.mode[q] === CHASE &&
            m.duel.crowd!.warbands!.mode[q] === RETURN
          )
            ended =
              m.tick - pw.seen[q]! >= forget
                ? `forgot (${f(secs(m.tick - pw.seen[q]!))} s unseen)`
                : "the Leash";
          tracker.observe(at, m);
          const c = m.duel.crowd!;
          const me = m.duel.fighters[0]!;
          for (let i = 0; i < c.slot.length; i++) {
            if (c.squad[i] !== q || c.slot[i]! < 0) continue;
            if (promoted++ === 0)
              firstPromo = `Soldier ${i} promoted at ${f(secs(m.tick))} s, ${f(Math.hypot(c.x[i]! - me.position.x, c.z[i]! - me.position.z))} m from the Player, Warband mode ${c.warbands!.mode[q]}, Player at (${f(me.position.x)}, ${f(me.position.z)}) y ${f(me.y)}, Soldier y ${f(soldierHeight(map.field, c.surface[i]!, c.x[i]!, c.z[i]!))}`;
          }
          for (let i = 0; i < c.x.length; i++)
            if (c.squad[i] === q)
              nearest = Math.min(
                nearest,
                Math.hypot(c.x[i]! - me.position.x, c.z[i]! - me.position.z),
              );
        }
        tracker.finish(m.tick);

        lines.push(
          `  ${name}: guard W${q} (post ${w.post[q]}, ${row.size} Soldiers, candidate ${candidates.indexOf(chosen) + 1} of ${candidates.length}) at ${f(chosen.walk)} m by walking, ${toward < 0 ? "walking to the point farthest from the post" : `the Entrance ${toward} m or more nearer than the post`}; chased x${row.chases}, chase ${ended === "" ? "not given up" : `${f(chaseSecs)} s, ended by ${ended}`}; ` +
            `RETURN ${row.returns.map((r) => f(secs(r))).join(", ") || "-"} s; excursion ${row.excursions.map((r) => f(secs(r))).join(", ") || "-"} s; back home x${row.returned}; Soldiers promoted ${promoted}; closest to the Player ${f(nearest)} m${firstPromo ? `; ${firstPromo}` : ""}`,
        );
        outcome = { q, promoted, row };
        if (promoted === 0 && row.met === false && row.returned > 0) break;
      }
      const { q, promoted, row } = outcome!;
      seen.givenUp += row.returned;
      seen.chases += row.chases;
      seen.returns += row.returned;
      if (promoted > 0 || row.met)
        problems.push(
          `${name} W${q}: ${promoted} Soldier-Ticks promoted (the Player came within promote)`,
        );
      if (row.chases === 0) problems.push(`${name} W${q}: it never chased`);
      else if (row.returned === 0)
        problems.push(
          `${name} W${q}: it chased but did not return home within ${AWAY_SECONDS} s (open excursion ${row.openOut === null ? "-" : f(secs(row.openOut))} s)`,
        );
    }
    console.log(lines.join("\n"));
    expect(
      problems,
      `a chase given up failed:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("the patrols: with the party standing in the Entrance, each patrol Warband that stays on its loop walks its legs in about their walking time with its Soldiers on their places", () => {
    const lines = [
      `\nThe patrols: ${PATROL_SECONDS} s of Idle Intents, party in the Entrance, Floor 1 of ${RUNS.length} Runs. Off place = more than ${OFF_PLACE} m from its Formation place (formationSpot with squadNarrows of the Tick); lost = more than ${LOST} m.`,
    ];
    const problems: string[] = [];
    let walked = 0;
    let excluded = 0;
    const legRows: number[] = [];
    for (const name of RUNS) {
      const tuning = runTuning();
      const seed = runSeed(name);
      const arena = floorArenaName(seed, 1);
      let m = createMatch(tuning, {
        format: "Gauntlet",
        bestOf: 1,
        seed: 7,
        arena: name,
        delver: true,
        teams: LINEUP.map((s) => s.team),
        humans: 1,
        players: [0],
      });
      const t = arenaTuning(tuning, arena);
      const map = battleMapOf(t.battle, arena);
      const homes = warbandHomes(floorOf(tuning, arena)!.plan);
      const tracker = new Tracker(m, homes);
      const rows = tracker.rows;
      const lostTicks = new Map<number, number>();
      const out: [number, number] = [0, 0];
      const walkSpeed = t.battle.crowd.walkSpeed * t.battle.squad.speed;
      const wasIdle = rows.map(() => true);
      for (
        let tick = 0;
        tick < secondsToTicks(PATROL_SECONDS) && m.status.status !== "Over";
        tick++
      ) {
        const at = m;
        m = stepMatch(
          at,
          at.duel.fighters.map(() => IDLE_INTENT),
          tuning,
        );
        tracker.observe(at, m);
        const c = m.duel.crowd!;
        const narrows = squadNarrows(t.battle, map, c.squads);
        for (const row of rows) {
          if (row.kind !== "patrol" || c.warbands!.mode[row.q] !== PATROL)
            continue;
          for (let i = 0; i < c.x.length; i++) {
            if (c.squad[i] !== row.q || !c.alive[i] || c.slot[i]! >= 0)
              continue;
            formationSpot(
              t.battle,
              map,
              c.squads,
              row.q,
              c.place[i]!,
              narrows[row.q]!,
              out,
            );
            const d = Math.hypot(c.x[i]! - out[0], c.z[i]! - out[1]);
            row.acc.steps++;
            if (d > OFF_PLACE) row.acc.off++;
            const key = row.q * 100_000 + i;
            const run = d > LOST ? (lostTicks.get(key) ?? 0) + 1 : 0;
            lostTicks.set(key, run);
            row.acc.lost = Math.max(row.acc.lost, run);
          }
        }
        rows.forEach((row, q) => {
          if (c.warbands!.mode[q] !== PATROL && row.kind === "patrol")
            wasIdle[q] = false;
        });
      }
      tracker.finish(m.tick);
      lines.push(
        `  ${name} Floor 1: ${f(secs(m.tick), 0)} s simulated${m.status.status === "Over" ? " (the Run ended!)" : ""}; ${rows.filter((x) => x.kind === "patrol").length} patrol Warbands`,
      );
      for (const row of rows.filter((x) => x.kind === "patrol")) {
        const stayed = wasIdle[row.q]! && row.chases === 0;
        if (!stayed) {
          excluded++;
          lines.push(
            `    W${row.q} (${row.points} pts): left its loop (chased x${row.chases}) at ${row.chaseStarts.map((x) => f(secs(x), 0)).join(", ")} s: the party was in its reach; not measured`,
          );
          continue;
        }
        walked++;
        seen.loops += row.loops;
        const fields = map.fields;
        const target = (leg: Leg) =>
          homes.patrols[m.duel.crowd!.warbands!.patrol[row.q]!]![leg.target]!;
        const cells = row.legs.map((l) => {
          const to = target(l);
          const on = groundOf(t.battle, map.field, to.x, to.z, 0);
          const dist = fieldDistance(
            oneField(fields, fieldToward(fields, to.x, to.z, on)),
            0,
            l.from.x,
            l.from.z,
            l.from.s,
          );
          const walking = dist / walkSpeed;
          const secsLeg = secs(l.ticks);
          legRows.push(secsLeg);
          if (dist < 0)
            problems.push(
              `${name} W${row.q}: a leg's walk is unreached from where it began`,
            );
          if (secsLeg > 2 * walking + LEG_SLACK)
            problems.push(
              `${name} W${row.q}: a leg took ${f(secsLeg)} s against a walking time of ${f(walking)} s (over twice + ${LEG_SLACK})`,
            );
          if (secs(l.lost) > LOST_SECONDS)
            problems.push(
              `${name} W${row.q}: a Soldier stayed ${f(secs(l.lost))} s more than ${LOST} m from its place (over ${LOST_SECONDS})`,
            );
          return `${f(secsLeg)}s/${f(walking)}s ${f((100 * l.off) / Math.max(1, l.steps), 0)}%/${f(secs(l.lost))}s`;
        });
        lines.push(
          `    W${row.q} (${row.points} pts, size ${row.size}): ${row.legs.length} legs, ${row.loops} loops; per leg seconds/walking-time, off-place share/longest lost: ${cells.join("  ")}${row.openLeg !== null ? `; open leg ${f(secs(row.openLeg))} s` : ""}`,
        );
        if (row.openLeg !== null && secs(row.openLeg) > LEG_MAX)
          problems.push(
            `${name} W${row.q}: a leg open at the end for ${f(secs(row.openLeg))} s (over ${LEG_MAX})`,
          );
      }
    }
    lines.push(
      `  ${walked} patrols measured, ${excluded} not (the party was in their reach); ${legRows.length} legs: seconds ${stat(legRows)}`,
    );
    console.log(lines.join("\n"));
    expect(problems, `a patrol misbehaved:\n${problems.join("\n")}`).toEqual(
      [],
    );
  });

  it("a full Run on the bundled Tuning (a measurement: where the Delver pilot with two Hard allies ends)", () => {
    const r = playBossRun(base);
    printBossRun("Full Run, bundled Tuning", base, r);
    const problems = bossProblems(base, r);
    console.log(
      problems.length === 0
        ? "The bundled Tuning's full Run showed everything the asserted case checks."
        : `The bundled Tuning's full Run did not show:\n  ${problems.join("\n  ")}`,
    );
  });

  it("a full Run of 3 tiers x 3 Floors on the test Tuning, Bosses on Floors 3, 6 and 9: the Boss promoted first, the Boss Warband wiped, the gate opened, loot taken, to the Victory", () => {
    const r = playBossRun(LENIENT);
    printBossRun("Full Run, test Tuning", LENIENT, r);
    const problems = bossProblems(LENIENT, r);
    expect(
      problems,
      `the full Run did not show:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("exercised what it measures: a Promotion, a Chase, a Return home after a Chase, a Warband wiped, and a patrol walking its whole loop", () => {
    const missing = (
      Object.entries({
        Promotion: seen.promotions,
        Chase: seen.chases,
        "Return home after a Chase": seen.returns,
        "Warband wiped": seen.wiped,
        "whole patrol loop": seen.loops,
      }) as [string, number][]
    )
      .filter(([, n]) => n === 0)
      .map(([what]) => what);
    console.log(`\nExercised: ${JSON.stringify(seen)}`);
    expect(
      missing,
      `the soak never exercised: ${missing.join(", ")} (${JSON.stringify(seen)})`,
    ).toEqual([]);
  });
});
