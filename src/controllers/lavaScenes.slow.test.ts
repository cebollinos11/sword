import { describe, expect, it } from "vitest";
import { defaultWeaponName, loadTuningData, type TuningData } from "../tuning";
import {
  createMatch,
  IDLE_INTENT,
  inDuel,
  MAX_TEAM_SIZE,
  runSeed,
  secondsToTicks,
  stepMatch,
  type FighterState,
  type MatchState,
} from "../sim";
import { floorArenaName, floorOf } from "../sim/delver";
import type { DelverHall } from "../sim/delver/plan";
import type { Rect } from "../mapEditor/source";
import { createAiController } from "./ai";
import { controllerIntents, type Controller } from "./controller";
import { lineupAis, type Lineup } from "./lineup";

/**
 * Stage 7d's two scenarios (docs/plans/delver.md, Stage 7d, Design §11), on the shipped Floors: a kick into lava and a Knockdown's Slide into it.
 * Each takes the first candidate in seed order (seeds 1.., Floors 1 to 9) where it happens, and prints which candidates it tried.
 *
 * The set-up is the test harness's, as the 7b and 7c scenarios: the Match starts on the Floor (`delverStart`), the Player (Fighter 0) stands idle at
 * the Entrance so no Bubble promotes anyone, an Expert AI party Fighter (Fighter 1, plain AI controller) is put on the floor, and the first Pool slot
 * is fielded as an unbound Team 1 Duel Fighter (a promoted Soldier would need a Warband and a Bubble round the lava), driven by a scripted Controller
 * and given enough HP that only lava can kill it. Nothing else in the Simulation is touched.
 */
const base = loadTuningData();
/** The seeds searched (`gen:greybox:1` ...). */
const SEARCH = 60;
/** The scenario's cap (s) once the Fighters are placed. */
const SCENE_SECONDS = 10;
/** A push on the victim counts as the cause of its Death by Lava when it came this many seconds before. */
const WINDOW = 3;
/** How many candidates (a Floor and a lava edge) a scenario tries at most. */
const CAP = 10;

const f = (x: number, d = 1) => x.toFixed(d);

/** The shipped Tuning with no Warbands deployed (the plans, and so the lava, are the shipped ones). */
const empty = (): TuningData => ({
  ...base,
  delver: { ...base.delver, postFill: 0, patrolFill: 0 },
});

const LINEUP: Lineup = [
  { team: 0, pilot: { kind: "Player", player: 0 } },
  { team: 0, pilot: { kind: "AI", difficulty: "Expert" } },
  ...Array.from({ length: MAX_TEAM_SIZE }, () => ({
    team: 1,
    pilot: { kind: "AI" as const, difficulty: "Floor" },
  })),
];
const ATTACKER = 1;
/** The first Pool slot: the party has two Fighters. */
const TARGET = 2;

interface Spot {
  readonly x: number;
  readonly z: number;
}
/** A walk back and forth along the unit direction `along` through `mid`, turning at `half` m from it (it stays near its edge, always moving). */
interface Oscillate {
  readonly along: Spot;
  readonly mid: Spot;
  readonly half: number;
}

/** Where the attacker stands, where the target stands, how the target moves, and what was tried (for the print). */
interface Setup {
  readonly attacker: Spot;
  readonly target: Spot;
  /** The target's walk (the scripted Controller): `toward` presses toward the attacker's place each Tick (it never walks past it), a fixed unit direction, or null: it stands. */
  readonly walk: "toward" | Oscillate | null;
  readonly label: string;
}
interface Candidate {
  readonly run: string;
  readonly floor: number;
  readonly hall: DelverHall;
  readonly what: string;
  readonly setups: readonly Setup[];
}

const unit = (dx: number, dz: number): Spot => {
  const d = Math.hypot(dx, dz);
  return { x: dx / d, z: dz / d };
};
/** The yaw (0 faces +z) from (ax, az) toward (bx, bz). */
const yawTo = (ax: number, az: number, bx: number, bz: number): number =>
  Math.atan2(bx - ax, bz - az);

/** The Match on Floor `floor` of `run`, with the Fighters placed as `setup` says, and its Controllers. */
function scene(
  tuning: TuningData,
  c: Candidate,
  setup: Setup,
  weapon: string | undefined,
  difficulty: string,
): { match: MatchState; controllers: Controller[] } {
  const created = createMatch(tuning, {
    format: "Gauntlet",
    bestOf: 1,
    seed: 7,
    arena: c.run,
    delverStart: c.floor,
    teams: LINEUP.map((s) => s.team),
    humans: 1,
    players: [0],
    ...(weapon === undefined
      ? {}
      : { weapons: [defaultWeaponName(tuning), weapon] }),
  });
  const y = c.hall.y;
  const place = (
    fighter: FighterState,
    at: Spot,
    toward: Spot,
  ): FighterState => ({
    ...fighter,
    position: { x: at.x, z: at.z },
    y,
    facing: yawTo(at.x, at.z, toward.x, toward.z),
  });
  const match: MatchState = {
    ...created,
    duel: {
      ...created.duel,
      fighters: created.duel.fighters.map((x, i) =>
        i === ATTACKER
          ? place(x, setup.attacker, setup.target)
          : i === TARGET
            ? {
                ...place(x, setup.target, setup.attacker),
                benched: undefined,
                hp: 1e6,
                maxHp: 1e6,
              }
            : x,
      ),
    },
  };
  let sign = 1;
  const target: Controller = {
    intent: (state) => {
      const me = state.fighters[TARGET]!;
      const to = state.fighters[ATTACKER]!.position;
      const move =
        setup.walk === null || me.death !== undefined
          ? IDLE_INTENT.move
          : setup.walk === "toward"
            ? unit(to.x - me.position.x, to.z - me.position.z)
            : (() => {
                const w = setup.walk;
                const at =
                  (me.position.x - w.mid.x) * w.along.x +
                  (me.position.z - w.mid.z) * w.along.z;
                if (at > w.half) sign = -1;
                else if (at < -w.half) sign = 1;
                return { x: w.along.x * sign, z: w.along.z * sign };
              })();
      return {
        ...IDLE_INTENT,
        move,
        face: yawTo(me.position.x, me.position.z, to.x, to.z),
      };
    },
  };
  const controllers: Controller[] = lineupAis(tuning, LINEUP, "Gauntlet", {
    seed: 7,
  }).map((x) => x ?? { intent: () => IDLE_INTENT });
  controllers[ATTACKER] = createAiController(tuning, difficulty);
  controllers[TARGET] = target;
  return { match, controllers };
}


/**
 * Edge keep (Task 5 of 7d): an AI Fighter standing at a lava edge is shoved toward it by another body walking slowly into it (the Fighters'
 * capsules push each other apart), as a promoted Soldier was in the soak (Run 5 Floor 5: a 0.3 m/s drift with Intent (0, 0) over a pit's edge). It
 * must hold its ground: no Death by Lava, and the centre of its body never nearer to the lava than EDGE_MIN m, for HOLD_SECONDS.
 */
const HOLD_SECONDS = 20;
/** The nearest (m, from above) the centre of the held Fighter may come to lava. */
const EDGE_MIN = 0.02;
/** How hard the pusher walks into it (a walk Intent's length: half the walking speed, shoving each body about 1 m/s). */
const SHOVE = 0.5;
/** The first Ticks, while it steps in from the 0.1 m it starts at, are not measured. */
const SETTLE = 30;

const rectGap = (r: Rect, x: number, z: number): number =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

interface Held {
  readonly died: boolean;
  readonly cause: string;
  readonly nearest: number;
  readonly drift: number;
  readonly tick: number;
}

/** Plays `setup` with the held Fighter on the Expert AI and the other body walking slowly into it, for HOLD_SECONDS. */
function hold(tuning: TuningData, c: Candidate, setup: Setup, lava: readonly Rect[]): Held {
  const s = scene(tuning, c, setup, undefined, "Expert");
  s.controllers[TARGET] = createAiController(tuning, "Expert");
  s.controllers[ATTACKER] = {
    intent: (state) => {
      const me = state.fighters[ATTACKER]!;
      const to = state.fighters[TARGET]!.position;
      const d = unit(to.x - me.position.x, to.z - me.position.z);
      return {
        ...IDLE_INTENT,
        move: { x: d.x * SHOVE, z: d.z * SHOVE },
        face: yawTo(me.position.x, me.position.z, to.x, to.z),
      };
    },
  };
  let m: MatchState = {
    ...s.match,
    duel: {
      ...s.match.duel,
      fighters: s.match.duel.fighters.map((x, i) =>
        i === ATTACKER ? { ...x, hp: 1e6, maxHp: 1e6 } : x,
      ),
    },
  };
  let nearest = Infinity;
  let cause = "alive";
  const start = m.duel.fighters[TARGET]!.position;
  for (let t = 0; t < secondsToTicks(HOLD_SECONDS); t++) {
    const at = m;
    m = stepMatch(at, controllerIntents(at.duel, s.controllers), tuning);
    const x = m.duel.fighters[TARGET]!;
    if (inDuel(x) && t >= SETTLE)
      nearest = Math.min(
        nearest,
        ...lava.map((r) => rectGap(r, x.position.x, x.position.z)),
      );
    const death = m.duel.events.find(
      (e) => e.type === "Death" && e.fighter === TARGET,
    );
    if (death && death.type === "Death") {
      cause = `Death by ${death.cause}`;
      break;
    }
  }
  const x = m.duel.fighters[TARGET]!;
  return {
    died: cause !== "alive",
    cause,
    nearest,
    drift: Math.hypot(x.position.x - start.x, x.position.z - start.z),
    tick: m.tick,
  };
}

interface Outcome {
  readonly died: boolean;
  readonly tick: number;
  /** The events naming the target in the WINDOW before its Death by Lava, oldest first. */
  readonly events: string[];
  /** Which of them pushed it. */
  readonly kicked: boolean;
  readonly heavy: boolean;
  readonly whirlwind: boolean;
  readonly knockdown: boolean;
  readonly deathAt: string;
  readonly end: string;
}

/** Plays `s` for up to SCENE_SECONDS and reads the target's end from the events. */
function play(
  tuning: TuningData,
  s: { match: MatchState; controllers: Controller[] },
): Outcome {
  let m = s.match;
  const log: { tick: number; text: string; kind: string }[] = [];
  let outcome: Outcome | null = null;
  const cap = secondsToTicks(SCENE_SECONDS);
  for (let t = 0; t < cap && outcome === null; t++) {
    const at = m;
    m = stepMatch(at, controllerIntents(at.duel, s.controllers), tuning);
    for (const e of m.duel.events) {
      if (e.type === "KickLanded" && e.defender === TARGET)
        log.push({
          tick: m.tick,
          kind: "kick",
          text: `KickLanded ${e.attacker}->${e.defender} (${e.outcome})`,
        });
      else if (e.type === "Hit" && e.defender === TARGET)
        log.push({
          tick: m.tick,
          kind: e.whirlwind ? "whirlwind" : e.heavy ? "heavy" : "hit",
          text: `Hit ${e.attacker}->${e.defender} ${e.whirlwind ? "whirlwind" : e.heavy ? "HEAVY" : "plain"} ${f(e.damage, 0)} dmg`,
        });
      else if (e.type === "KnockdownPhase" && e.fighter === TARGET)
        log.push({
          tick: m.tick,
          kind: "knockdown",
          text: `KnockdownPhase ${e.fighter} ${e.phase}`,
        });
      else if (e.type === "Death" && e.fighter === TARGET) {
        const near = log.filter(
          (p) => m.tick - p.tick <= secondsToTicks(WINDOW),
        );
        const x = at.duel.fighters[TARGET]!;
        outcome = {
          died: e.cause === "Lava",
          tick: m.tick,
          events: near.map((p) => `T-${m.tick - p.tick} ${p.text}`),
          kicked: near.some(
            (p) => p.kind === "kick" && p.text.includes("(Knockdown)"),
          ),
          heavy: near.some((p) => p.kind === "heavy"),
          whirlwind: near.some((p) => p.kind === "whirlwind"),
          knockdown: near.some((p) => p.kind === "knockdown"),
          deathAt: `(${f(x.position.x, 2)}, ${f(x.position.z, 2)}) y ${f(x.y, 2)}`,
          end: `Death by ${e.cause}`,
        };
      }
    }
  }
  const x = m.duel.fighters[TARGET]!;
  return (
    outcome ?? {
      died: false,
      tick: m.tick,
      events: log.map((p) => `T-${m.tick - p.tick} ${p.text}`).slice(-8),
      kicked: false,
      heavy: false,
      whirlwind: false,
      knockdown: false,
      deathAt: `(${f(x.position.x, 2)}, ${f(x.position.z, 2)}) y ${f(x.y, 2)}`,
      end: `alive after ${SCENE_SECONDS} s${inDuel(x) ? "" : " (out of play)"}`,
    }
  );
}

/** The two rects share an edge of at least 2 m: how, and the unit normal from the first toward the second. */
function sharedEdge(
  a: Rect,
  b: Rect,
): { out: Spot; mid: Spot; length: number } | null {
  const eps = 1e-6;
  const span = (lo0: number, hi0: number, lo1: number, hi1: number) =>
    [Math.max(lo0, lo1), Math.min(hi0, hi1)] as const;
  if (Math.abs(a.x1 - b.x0) < eps) {
    const [lo, hi] = span(a.z0, a.z1, b.z0, b.z1);
    if (hi - lo >= 2)
      return {
        out: { x: 1, z: 0 },
        mid: { x: a.x1, z: (lo + hi) / 2 },
        length: hi - lo,
      };
  }
  if (Math.abs(a.x0 - b.x1) < eps) {
    const [lo, hi] = span(a.z0, a.z1, b.z0, b.z1);
    if (hi - lo >= 2)
      return {
        out: { x: -1, z: 0 },
        mid: { x: a.x0, z: (lo + hi) / 2 },
        length: hi - lo,
      };
  }
  if (Math.abs(a.z1 - b.z0) < eps) {
    const [lo, hi] = span(a.x0, a.x1, b.x0, b.x1);
    if (hi - lo >= 2)
      return {
        out: { x: 0, z: 1 },
        mid: { x: (lo + hi) / 2, z: a.z1 },
        length: hi - lo,
      };
  }
  if (Math.abs(a.z0 - b.z1) < eps) {
    const [lo, hi] = span(a.x0, a.x1, b.x0, b.x1);
    if (hi - lo >= 2)
      return {
        out: { x: 0, z: -1 },
        mid: { x: (lo + hi) / 2, z: a.z0 },
        length: hi - lo,
      };
  }
  return null;
}

/** The ways to stand a target `edge` m from a lava edge (the lava `out` of it) with the attacker `gap` m inboard of it, within a Kick's range (1 m). */
function setupsAt(
  mid: Spot,
  out: Spot,
  label: string,
  moving: boolean,
  half: number,
  gaps: readonly number[],
): Setup[] {
  const list: Setup[] = [];
  const along = { x: -out.z, z: out.x };
  for (const edge of moving ? [0.6, 0.8, 0.45] : [0.7, 0.9, 0.5])
    for (const gap of gaps) {
      const target = { x: mid.x - out.x * edge, z: mid.z - out.z * edge };
      const attacker = {
        x: target.x - out.x * gap,
        z: target.z - out.z * gap,
      };
      const words = `${label}, target ${edge} m from the edge, attacker ${gap} m inboard of it`;
      if (!moving) {
        list.push({
          attacker,
          target,
          walk: null,
          label: `${words}, target standing`,
        });
        continue;
      }
      list.push({
        attacker,
        target,
        walk: { along, mid: target, half },
        label: `${words}, target walking back and forth along the edge (+-${f(half, 1)} m)`,
      });
    }
  return list;
}

/** Every Floor (seed order, Floors 1 to 9) with a lava Hall that `pick` takes, as candidates. */
function candidates(
  tuning: TuningData,
  pick: (hall: DelverHall) => { what: string; setups: Setup[] }[],
): Candidate[] {
  const out: Candidate[] = [];
  const floors = tuning.delver.tiers * tuning.delver.floorsPerTier;
  for (let n = 1; n <= SEARCH && out.length < CAP; n++) {
    const run = `gen:greybox:${n}`;
    for (let floor = 1; floor <= floors && out.length < CAP; floor++) {
      const plan = floorOf(tuning, floorArenaName(runSeed(run), floor))!.plan;
      for (const hall of plan.halls)
        for (const p of pick(hall))
          out.push({ run, floor, hall, what: p.what, setups: p.setups });
    }
  }
  return out.slice(0, CAP);
}

/** Runs the candidates in order; the first that kills the target by lava, preceded by `proof`, is chosen. */
function firstThat(
  tuning: TuningData,
  list: readonly Candidate[],
  weapon: string | undefined,
  proof: (o: Outcome) => boolean,
): { tried: string[]; chosen: string | null; outcome: Outcome | null } {
  const tried: string[] = [];
  for (const [i, c] of list.entries()) {
    for (const setup of c.setups) {
      const o = play(tuning, scene(tuning, c, setup, weapon, "Expert"));
      const line = `candidate ${i + 1}: Run ${c.run} Floor ${c.floor} ${c.hall.id} (${c.what}, Hall y ${f(c.hall.y)}); ${setup.label}: ${o.end} at Tick ${o.tick}${o.died ? ` from ${o.deathAt}` : ""}; events: ${o.events.join("; ") || "none"}`;
      if (o.died && proof(o)) return { tried, chosen: line, outcome: o };
      tried.push(line);
    }
  }
  return { tried, chosen: null, outcome: null };
}

describe("lava scenarios", { timeout: 30 * 60_000 }, () => {
  it("a kick into lava: on the first Floor (seed order) with a river, an Expert AI Fighter on a bridge kicks a Team 1 Duel Fighter that stands with the river behind it; within 10 s the target dies of Lava, with a Kick's Knockdown on it in the 3 s before", () => {
    const tuning = empty();
    const list = candidates(tuning, (hall) => {
      const lava = hall.lava;
      if (!lava || lava.kind !== "river") return [];
      // One candidate per bridge edge that lies against lava (a bridge between two lava rects has two).
      return lava.bridges.flatMap((bridge, b) =>
        lava.rects.flatMap((rect, r) => {
          const e = sharedEdge(rect, bridge);
          if (!e) return [];
          // `e.out` points from the lava toward the bridge; the lava is behind the target the other way.
          const out = { x: -e.out.x, z: -e.out.z };
          return [
            {
              what: `river, bridge ${b} (${f(bridge.x1 - bridge.x0)} x ${f(bridge.z1 - bridge.z0)} m), lava rect ${r}`,
              setups: setupsAt(
                e.mid,
                out,
                `bridge ${b} edge of rect ${r}`,
                true,
                Math.min(0.8, e.length / 2 - 0.6),
                [0.9, 0.75],
              ),
            },
          ];
        }),
      );
    });
    expect(
      list.length,
      "no Floor of the first seeds has a river with a bridge",
    ).toBeGreaterThan(0);
    const r = firstThat(tuning, list, undefined, (o) => o.kicked);
    console.log(
      `\nA kick into lava: ${list.length} candidate bridge edge(s) in seed order (cap ${CAP}); ${r.tried.length} set-up(s) before the chosen one failed:\n${r.tried.map((l) => `  skipped: ${l}`).join("\n")}\n  chosen: ${r.chosen ?? "none"}`,
    );
    expect(
      r.chosen,
      "no kick carried a target into the river within 10 s on any candidate",
    ).not.toBeNull();
    expect(
      r.outcome!.kicked,
      "the Death was not preceded by a Kick's Knockdown",
    ).toBe(true);
  });

  it("a Knockdown's Slide into lava: on the first Floor (seed order) with a pit, an Expert AI Fighter with the Sledge Hammer hits a Team 1 Duel Fighter that stands within 1 m of the pit's edge with the pit behind it; within 10 s the target dies of Lava, with a Heavy Blow's Knockdown on it before", () => {
    const tuning = empty();
    const list = candidates(tuning, (hall) => {
      const lava = hall.lava;
      if (!lava || lava.kind !== "pit") return [];
      const pit = lava.rects[0]!;
      const mid = { x: (pit.x0 + pit.x1) / 2, z: (pit.z0 + pit.z1) / 2 };
      // The four edges, west first: the lava lies in the direction `out` from the target.
      const edges: [string, Spot, Spot][] = [
        ["west edge", { x: pit.x0, z: mid.z }, { x: 1, z: 0 }],
        ["east edge", { x: pit.x1, z: mid.z }, { x: -1, z: 0 }],
        ["south edge", { x: mid.x, z: pit.z0 }, { x: 0, z: 1 }],
        ["north edge", { x: mid.x, z: pit.z1 }, { x: 0, z: -1 }],
      ];
      return [
        {
          what: `pit ${f(pit.x1 - pit.x0)} x ${f(pit.z1 - pit.z0)} m`,
          setups: edges.flatMap(([label, at, out]) =>
            setupsAt(at, out, `pit ${label}`, false, 0, [2.0, 1.6, 1.2]),
          ),
        },
      ];
    });
    expect(
      list.length,
      "no Floor of the first seeds has a pit",
    ).toBeGreaterThan(0);
    const r = firstThat(
      tuning,
      list,
      "Sledge Hammer",
      (o) => o.knockdown && o.heavy,
    );
    console.log(
      `\nA Knockdown's Slide into lava (Sledge Hammer): ${list.length} candidate pit Hall(s) in seed order (cap ${CAP}); ${r.tried.length} set-up(s) before the chosen one failed:\n${r.tried.map((l) => `  skipped: ${l}`).join("\n")}\n  chosen: ${r.chosen ?? "none"}${r.outcome ? `\n  the Knockdown came from: ${r.outcome.heavy ? "a Heavy Blow" : ""}${r.outcome.whirlwind ? "a Whirlwind blow" : ""}${r.outcome.kicked ? "a Kick" : ""}` : ""}`,
    );
    expect(
      r.chosen,
      "no Knockdown carried a target into the pit within 10 s on any candidate",
    ).not.toBeNull();
    expect(
      r.outcome!.knockdown && r.outcome!.heavy,
      "the Death was not preceded by a Heavy Blow's Knockdown on it",
    ).toBe(true);
  });

  it(`an edge held: on the first Floor (seed order) with a pit and the first with a river, an Expert AI Fighter standing 0.1 m inboard of a lava edge (a pit's side and corner, a bridge's side) with another body walking slowly into it from inboard is never carried into the lava, and its centre never comes within ${EDGE_MIN} m of it after its first half second, for ${HOLD_SECONDS} s`, () => {
    const tuning = empty();
    const cases: { c: Candidate; setup: Setup; lava: readonly Rect[] }[] = [];
    const inboard = (
      at: Spot,
      out: Spot,
      label: string,
      lava: readonly Rect[],
      c: Omit<Candidate, "setups" | "what">,
      what: string,
    ) => {
      // The held Fighter 0.1 m from the edge; the pusher touching it (0.7 m between centres) on the inboard side.
      const target = { x: at.x - out.x * 0.1, z: at.z - out.z * 0.1 };
      const attacker = { x: target.x - out.x * 0.7, z: target.z - out.z * 0.7 };
      const setup: Setup = { attacker, target, walk: null, label };
      cases.push({ c: { ...c, what, setups: [setup] }, setup, lava });
    };
    let pit = false;
    let river = false;
    for (let n = 1; n <= SEARCH && !(pit && river); n++) {
      const run = `gen:greybox:${n}`;
      for (let floor = 1; floor <= 9; floor++) {
        const plan = floorOf(tuning, floorArenaName(runSeed(run), floor))!.plan;
        for (const hall of plan.halls) {
          const lava = hall.lava;
          const c = { run, floor, hall };
          if (lava?.kind === "pit" && !pit) {
            pit = true;
            const r = lava.rects[0]!;
            const mid = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
            inboard({ x: r.x0, z: mid.z }, { x: 1, z: 0 }, "pit west side", lava.rects, c, "pit");
            inboard({ x: mid.x, z: r.z1 }, { x: 0, z: -1 }, "pit north side", lava.rects, c, "pit");
            // A corner: the Fighter 0.1 m outside the pit's north-west corner's two edges, shoved along +x (cutting the corner).
            const corner = { x: r.x0 - 0.1, z: r.z1 - 0.1 };
            const diag = unit(1, -1);
            const cs: Setup = {
              attacker: { x: corner.x - diag.x * 0.7, z: corner.z - diag.z * 0.7 },
              target: corner,
              walk: null,
              label: "pit north-west corner, shoved diagonally across it",
            };
            cases.push({ c: { ...c, what: "pit", setups: [cs] }, setup: cs, lava: lava.rects });
          }
          if (lava?.kind === "river" && !river) {
            river = true;
            for (const [b, bridge] of lava.bridges.entries())
              for (const [k, r] of lava.rects.entries()) {
                const e = sharedEdge(r, bridge);
                if (!e) continue;
                inboard(e.mid, { x: -e.out.x, z: -e.out.z }, `river bridge ${b} side of rect ${k}`, lava.rects, c, "river");
              }
          }
        }
      }
    }
    expect(cases.length, "no pit or river in the first seeds").toBeGreaterThan(0);
    const lines: string[] = [];
    const bad: string[] = [];
    for (const { c, setup, lava } of cases) {
      const h = hold(tuning, c, setup, lava);
      const line = `Run ${c.run} Floor ${c.floor} ${c.hall.id} (${c.what}), ${setup.label}: ${h.cause} at Tick ${h.tick}, nearest to lava ${f(h.nearest, 2)} m, ended ${f(h.drift, 2)} m from its start`;
      lines.push(line);
      if (h.died || h.nearest < EDGE_MIN) bad.push(line);
    }
    console.log(`\nAn edge held (${cases.length} set-ups):\n${lines.map((l) => `  ${l}`).join("\n")}`);
    expect(bad, `the held Fighter went over or too near a lava edge:\n${bad.join("\n")}`).toEqual([]);
  });
});
