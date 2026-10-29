import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createAutopilot, lineupAis, lineupMatch, FLOOR_DIFFICULTY, stepMatchWith, type Autopilot, type AutopilotLoot, type Controller, type Lineup, type PlayerNumber } from '../controllers';
import { inDuel } from './duel';
import { hallOf, hallRoster, runKit, type HallRef } from './hall';
import { runPick } from './dungeon';
import { wieldedWeapon, type Inventory } from './inventory';
import { createMatch, type MatchState } from './match';
import type { RunStart } from './hall';
import {
  aggregate,
  formatAggregate,
  formatBuilds,
  formatHalls,
  formatRuns,
  hallLabel,
  type Aggregate,
  type BuildRecord,
  type HallOutcome,
  type HallRecord,
  type ItemCount,
  type RunRecord,
  type RunResult,
} from './tuneReport';

/**
 * The Dungeon tuning harness (docs/plans/dungeon.md, Stage 5): headless Runs with 1 to 4 Players on the dev autopilot
 * (src/controllers/autopilot.ts, with loot), stepped offline through `stepMatchWith` the way src/net/coop.test.ts drives them
 * over the wire; per Hall, Floor and Run measurements and an aggregate. Behind a flag, as the walking soak is:
 *
 *   TUNE_DUNGEON=1 npx vitest run src/sim/dungeon.tune.test.ts --silent=false
 *
 * AN AUTOPILOT IS NOT A HUMAN. It is the AI at a difficulty, walking to loot and Doors; it blocks, swings and walks differently from a
 * person and never learns a Boss. Its numbers are a yardstick that tuning tickets compare against, not a prediction of a human's Run.
 *
 * Flags (all optional; lists are comma separated):
 *   TUNE_FROM / TUNE_TO     seeds, a Run seed each (`gen:greybox:<seed>`), default 1 to 10
 *   TUNE_PLAYERS            party sizes in Players, default "1"; "1,2,4" reports each on its own
 *   TUNE_ALLIES             AI allies (Ally AI) added to the party in the empty seats, default 0 (at most 4 Fighters in all)
 *   TUNE_ALLY_DIFFICULTY    their difficulty, default Hard
 *   TUNE_DIFFICULTY         the Players' autopilot difficulty (Tuning Data `ai.difficulties`), default REFERENCE_DIFFICULTY;
 *                           "Expert,Hard" reports both on the same seeds
 *   TUNE_WEAPON             the Players' starting Weapon, default Arming Sword
 *   TUNE_ROUTE              "seeded" (default): the Door list [row 1..5] is a pure pick of (seed, row), so Runs take varied routes, the same
 *                           ones at every difficulty and party size; "first": always the lowest-index exit; or "2,1,3,1,1": that Door list
 *                           (1-based, the autopilot's own: Door d out of every Hall of row r, the last for later rows; a Hall with fewer exits takes its last)
 *   TUNE_LOOT               "take" (default), "drop" (also drops one item once and takes it up again) or "none" (the autopilot leaves loot lying)
 *   TUNE_FLOOR/ROW/HALL     a dev start (the URL's `floor`, `row`, `hall`: 1-based, ROW 5 the Boss, default row 1), through
 *                           MatchOptions.start; the party is at full HP with the route's earlier Halls counted cleared
 *   TUNE_RELICS             "Whetstone,Iron Plate": every Player starts with these Relics (MatchOptions.relics), equipped in order
 *   TUNE_UNTIL              "run" (default), "floor" (stop when the start Floor's Boss falls) or "hall" (when the start Hall is cleared)
 *   TUNE_MAX_TICKS          stop a Run at this Match Tick (result "stopped")
 *   TUNE_OUT                the JSON report's path, default <tmpdir>/dungeon-tune.json (never commit it)
 *   TUNE_MERGE              "a.json,b.json": do not play; report the groups of these files together (to split a long run over processes;
 *                           TUNE_DIFFICULTY then keeps only those difficulties)
 *   TUNE_TABLES             "runs", "halls", "builds" (comma list): also print those tables for every Run
 *   TUNE_PROGRESS=1         one line to stderr per Run
 *
 * THE LOOT RULE (the autopilot's: `loot` of createAutopilot, src/controllers/autopilot.ts). In a Cleared Hall each Player walks onto the
 * nearest pickup it can see and take with room (its own drops, a Treasure Hall's pedestals (the nearest of its three: taking one closes
 * the rest), a beaten Elite's carried Relic), which TAKES it. It EQUIPS what it holds in this order: a Relic, the lowest slot not
 * equipped, while an equip slot is free (3), else the newest Weapon if that is not the one wielded. It never unequips, never swaps a
 * Relic for a better one and never picks by value: the first Relic it takes is worn. A Relic is OFFERED when it lies in the Hall for a
 * Player (each Player's copies count), TAKEN when an ItemTaken event names it, EQUIPPED when it newly appears among a Player's equipped
 * Relics (a Weapon: when it newly becomes the wielded one), DROPPED on an ItemDropped event. Taken can exceed offered under TUNE_LOOT=drop
 * (a drop is taken up again).
 *
 * Other definitions. HP fractions are Team 0's summed HP over its summed max HP (a fallen Fighter counts 0, allies included). HP in: at
 * the Hall's start (fallen Fighters revived at `revive`). HP out: when the Hall clears (after a Clear heal). HP carried: when the Door is
 * taken (after a Rest and pickups). Deaths: Team 0 Fighters that fell in the Hall. Revives: Fighters down when the Hall before ended and standing
 * on entering this one (so a Boss's full heal counts). Fight time: Hall start to Clear. Time to contact: until a Team 0 and a Team 1 Fighter first
 * came within 8 m. Walk time: Clear to Door taken (looting included), capped at a minute (a hang). A Hall that runs past three minutes hangs.
 */
/**
 * The reference autopilot, standing in for "a competent human": Expert, the top of the strength ladder (Tuning Data `ai.difficulties`,
 * with the exploit fixes and the teamwork on), looting with the rule above, on the seeded route. Calibrated on seeds 1-10 against what is known:
 * Hard alone loses Floor 1 (1 of 10 solo Runs clears it), and Expert is no better solo (0 of 10) but the better of the two in a party
 * (2 Players: 7/10 and 7/10; 4 Players: 5/10 and 5/10 clear Floor 1; Normal and Skilled clear less). Reports ship Expert and Hard on the same seeds to
 * show how sensitive the numbers are. It is a yardstick the tuning tickets move numbers against, not proof that a human wins that often.
 */
const REFERENCE_DIFFICULTY = 'Expert';
/** The longest a Hall's fight may run (Ticks): three minutes, as the soak's. One that runs longer hangs, and its Run is stopped there. */
const FLOOR_CAP = 180 * 60;
/** The longest a cleared Hall's party may take to walk to a Door and take it (Ticks): a minute, as the soak's. Longer, it hangs. */
const WALK_CAP = 60 * 60;
/** Fighters of the two Teams further apart than this (m, from above) are not fighting yet. */
const NEAR = 8;
const TICK_RATE = 60;

export interface HarnessConfig {
  readonly players: number;
  readonly allies: number;
  readonly allyDifficulty: string;
  readonly difficulty: string;
  readonly weapon: string;
  /** The Door list: 'seeded' (a pure pick per row from the seed), or the autopilot's 0-based list. */
  readonly route: 'seeded' | readonly number[];
  readonly loot: AutopilotLoot | null;
  readonly start?: RunStart;
  readonly relics?: readonly string[];
  readonly until: 'run' | 'floor' | 'hall';
  readonly maxTicks?: number;
}

const DOOR_SALT = 77;
/** The Door list (0-based, one per row) the seeded route gives a Run: a pure pick of (seed, row) among three, the autopilot clamping to a Hall's own exits. */
export const seededDoors = (seed: number): number[] => Array.from({ length: 5 }, (_, row) => runPick(seed, 0, row, DOOR_SALT, 3));

const frac = (m: MatchState): number => {
  const own = m.duel.fighters.filter((f) => f.team === 0);
  const max = own.reduce((a, f) => a + f.maxHp, 0);
  return max === 0 ? 0 : own.reduce((a, f) => a + (inDuel(f) ? f.hp : 0), 0) / max;
};
const teamMax = (m: MatchState): number => m.duel.fighters.filter((f) => f.team === 0).reduce((a, f) => a + f.maxHp, 0);

/** A Hall being measured. */
interface Building extends Omit<{ -readonly [K in keyof HallRecord]: HallRecord[K] }, 'outcome'> {
  outcome: HallOutcome | 'open';
  clearedAt: number | null;
  contacted: boolean;
}

const key = (k: string, item: string) => `${k}:${item}`;

function lineupFor(cfg: HarnessConfig): Lineup {
  const own = Array.from({ length: cfg.players }, (_, p) => ({ team: 0, pilot: { kind: 'Player', player: p as PlayerNumber } }) as const);
  const allies = Array.from({ length: cfg.allies }, () => ({ team: 0, pilot: { kind: 'AI', difficulty: cfg.allyDifficulty } }) as const);
  const floors = Array.from({ length: 4 }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const);
  return [...own, ...allies, ...floors];
}

/** Plays one Run of `seed` headless and measures it. Deterministic: the same (tuning, seed, config) gives the same record, wall time aside. */
export function playRun(tuning: TuningData, seed: number, cfg: HarnessConfig): RunRecord {
  const t0 = performance.now();
  const arena = `gen:greybox:${seed}`;
  const lineup = lineupFor(cfg);
  const options = { ...lineupMatch(tuning, lineup, Array(cfg.players).fill(cfg.weapon), { bestOf: 1, seed, arena, format: 'Gauntlet' }), ...(cfg.start && { start: cfg.start }), ...(cfg.relics && { relics: cfg.relics }) };
  let m: MatchState = createMatch(tuning, options);
  const doors = cfg.route === 'seeded' ? seededDoors(seed) : cfg.route;
  const pilots: Autopilot[] = Array.from({ length: cfg.players }, () => createAutopilot(tuning, cfg.difficulty, doors, cfg.loot));
  const controllers = lineupAis(tuning, lineup, 'Gauntlet', { arena, seed }).map((c, i) => c ?? pilots[i]!) as Controller[];

  const halls: Building[] = [];
  const loot: Record<string, ItemCount> = {};
  const count = (k: string): ItemCount => (loot[k] ??= { offered: 0, taken: 0, equipped: 0, dropped: 0 });
  let pathLen = 0;
  let seenPickups = 0;
  let result: RunResult | null = null;
  const startFloor = m.run!.floor;
  const heldBefore = new Map<number, Inventory | undefined>();

  const begin = (prev: MatchState, now: MatchState): void => {
    const ref: HallRef = { floor: now.run!.floor, row: now.run!.row, index: now.run!.hall };
    const hall = hallOf(tuning, arena, ref);
    const roster = hallRoster(tuning, now.config, ref).filter((e) => e !== null);
    const pool = hall.kind === 'Fight' || hall.kind === 'Elite' ? tuning.dungeon.floors[ref.floor - 1]!.encounters[hall.kind] : null;
    const encounter = hall.kind === 'Boss' ? 0 : pool && hall.encounter ? pool.indexOf(hall.encounter) : null;
    const revives = now.duel.fighters.filter((f, i) => f.team === 0 && !inDuel(prev.duel.fighters[i]!) && inDuel(f)).length;
    halls.push({
      ...ref,
      kind: hall.kind,
      encounter,
      enemies: roster.length,
      enemyMaxHp: roster.reduce((a, e) => Math.max(a, e!.maxHp), 0),
      outcome: 'open',
      fightTicks: 0,
      contactTicks: 0,
      walkTicks: null,
      walkHang: false,
      hpIn: frac(now),
      hpOut: frac(now),
      hpLeave: null,
      deaths: 0,
      revives: prev === now ? 0 : revives,
      restHeal: 0,
      clearedAt: null,
      contacted: false,
    });
    pathLen = now.run!.path.length;
    seenPickups = 0;
  };

  const equipChanged = (before: Inventory | undefined, after: Inventory | undefined): void => {
    if (!after || before === after) return;
    const worn = (inv: Inventory | undefined) => (inv ? inv.equipped.map((s) => inv.relics[s]!) : []);
    const prev = worn(before);
    const seen: string[] = [];
    for (const name of worn(after)) {
      seen.push(name);
      if (seen.filter((n) => n === name).length > prev.filter((n) => n === name).length) count(key('relic', name)).equipped++;
    }
    if (before && wieldedWeapon(after) !== wieldedWeapon(before)) count(key('weapon', wieldedWeapon(after))).equipped++;
  };

  begin(m, m);
  for (let i = 0; i < cfg.players; i++) heldBefore.set(i, m.duel.fighters[i]!.inventory);
  for (;;) {
    for (const p of pilots) p.watch(m);
    const prev = m;
    m = stepMatchWith(m, controllers, tuning);
    const run = m.run!;
    if (run.path.length !== pathLen) begin(prev, m);
    const cur = halls[halls.length - 1]!;
    // Deaths.
    m.duel.fighters.forEach((f, i) => {
      if (f.team === 0 && inDuel(prev.duel.fighters[i]!) && !inDuel(f) && cur.clearedAt === null) cur.deaths++;
    });
    // Loot: what lies there, what was taken and dropped, what is equipped.
    for (; seenPickups < run.pickups.length; seenPickups++) {
      const p = run.pickups[seenPickups]!;
      if (p.by === undefined) count(key(p.kind, p.item)).offered++;
    }
    for (let i = 0; i < cfg.players; i++) {
      const inv = m.duel.fighters[i]!.inventory;
      equipChanged(heldBefore.get(i), inv);
      heldBefore.set(i, inv);
    }
    for (const e of m.events) {
      if (e.type === 'ItemTaken') count(key(e.kind, e.item)).taken++;
      else if (e.type === 'ItemDropped') count(key(e.kind, e.item)).dropped++;
      else if (e.type === 'Rested') cur.restHeal += e.healed / teamMax(m);
    }
    // Contact.
    if (!cur.contacted && run.phase === 'Fighting') {
      const own = m.duel.fighters.filter((f) => f.team === 0 && inDuel(f));
      const them = m.duel.fighters.filter((f) => f.team === 1 && inDuel(f));
      if (own.some((a) => them.some((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= NEAR))) {
        cur.contacted = true;
        cur.contactTicks = m.duel.tick;
      }
    }
    // Hall events.
    for (const e of m.events) {
      if (e.type === 'HallCleared') {
        cur.outcome = 'cleared';
        cur.clearedAt = m.tick;
        cur.fightTicks = cur.kind === 'Treasure' || cur.kind === 'Rest' ? 0 : m.duel.tick;
        if (!cur.contacted) cur.contactTicks = cur.fightTicks;
        cur.hpOut = frac(m);
        if (cfg.until === 'hall' || (cfg.until === 'floor' && cur.kind === 'Boss' && cur.floor === startFloor)) result = 'stopped';
      } else if (e.type === 'DoorTaken') {
        cur.walkTicks = m.tick - cur.clearedAt!;
        cur.hpLeave = frac(m);
      } else if (e.type === 'RunEnd') {
        if (e.winner === 0) result = 'won';
        else {
          result = 'lost';
          if (cur.outcome === 'open') {
            cur.outcome = 'wiped';
            cur.fightTicks = m.duel.tick;
            if (!cur.contacted) cur.contactTicks = cur.fightTicks;
            cur.hpOut = 0;
          }
        }
      }
    }
    if (result === null) {
      if (cur.outcome === 'open' && m.duel.tick >= FLOOR_CAP) {
        cur.outcome = 'hang';
        cur.fightTicks = m.duel.tick;
        if (!cur.contacted) cur.contactTicks = cur.fightTicks;
        cur.hpOut = frac(m);
        result = 'hang';
      } else if (cur.clearedAt !== null && cur.walkTicks === null && m.tick - cur.clearedAt >= WALK_CAP) {
        cur.walkHang = true;
        cur.walkTicks = WALK_CAP;
        result = 'hang';
      } else if (cfg.maxTicks !== undefined && m.tick >= cfg.maxTicks) result = 'stopped';
    }
    if (result !== null) break;
  }

  // A Hall left open when the harness stopped it (`TUNE_MAX_TICKS`, `TUNE_UNTIL`) was not played to its end: it is not a result.
  const done = halls.filter((h) => h.outcome !== 'open') as (Building & { outcome: HallOutcome })[];
  const records: HallRecord[] = done.map(({ clearedAt: _c, contacted: _k, ...h }) => h);
  const last = halls[halls.length - 1]!;
  const builds: BuildRecord[] = Array.from({ length: cfg.players }, (_, p) => {
    const inv = m.duel.fighters[p]!.inventory!;
    return { player: p, weapon: wieldedWeapon(inv), weapons: inv.weapons, equipped: inv.equipped.map((s) => inv.relics[s]!), carried: inv.relics.filter((_, s) => !inv.equipped.includes(s)) };
  });
  return {
    seed,
    players: cfg.players,
    allies: cfg.allies,
    difficulty: cfg.difficulty,
    result,
    endHall: result === 'lost' || result === 'hang' ? hallLabel(last) : null,
    hallsCleared: records.filter((h) => h.outcome === 'cleared').length,
    ticks: m.tick,
    seconds: m.tick / TICK_RATE,
    route: m.run!.path.map((ref) => hallLabel({ ...ref, kind: hallOf(tuning, arena, ref).kind })),
    halls: records,
    loot,
    builds,
    wallMs: performance.now() - t0,
  };
}

/** A group of Runs of one party and autopilot difficulty on a list of seeds. */
export interface Group {
  readonly players: number;
  readonly allies: number;
  readonly difficulty: string;
  readonly runs: RunRecord[];
}

const list = (raw: string | undefined, fallback: string): string[] => (raw ?? fallback).split(',').map((s) => s.trim()).filter((s) => s !== '');
const int = (raw: string | undefined): number | undefined => (raw === undefined || raw === '' ? undefined : Number(raw));

/** The one-screen summary: a row a (difficulty, party), with its win rate, each Floor's win rate and the Run time. */
export function summaryTable(groups: readonly Group[]): string[] {
  const floors = Math.max(1, ...groups.map((g) => aggregate(g.runs).floors.length));
  const pct = (x: number) => (Number.isNaN(x) ? '-' : `${Math.round(x * 100)}%`);
  const out = [
    `| autopilot | party | Runs | won | ${Array.from({ length: floors }, (_, k) => `F${k + 1} cleared`).join(' | ')} | HP carried by Floor (median) | Run min (median, p10-p90) | wall s/Run |`,
    `|---|---|---|---|${Array.from({ length: floors }, () => '---|').join('')}---|---|---|`,
  ];
  for (const g of groups) {
    const a = aggregate(g.runs);
    const party = `${g.players}P${g.allies > 0 ? `+${g.allies}AI` : ''}`;
    const t = a.runSeconds;
    out.push(
      `| ${g.difficulty} | ${party} | ${a.runs} | ${a.won} (${pct(a.winRate)}) | ${Array.from({ length: floors }, (_, k) => (a.floors[k] ? `${a.floors[k]!.bossCleared}/${a.floors[k]!.entered}` : '-')).join(' | ')} | ${a.floors.map((f) => pct(f.medianHpLeave)).join(' / ')} | ${(t.median / 60).toFixed(1)} (${(t.p10 / 60).toFixed(1)}-${(t.p90 / 60).toFixed(1)}) | ${(a.wallSeconds / Math.max(1, a.runs)).toFixed(0)} |`,
    );
  }
  return out;
}

export const LOOT_RULE =
  'Loot rule (autopilot `loot`): in a Cleared Hall each Player walks onto the nearest pickup it can take and TAKES it; EQUIPS a Relic into the lowest free slot (3 slots) else the newest Weapon; never unequips or compares. ' +
  'OFFERED = lies in the Hall for a Player (per Player), TAKEN = ItemTaken, EQUIPPED = newly among the equipped Relics / newly wielded Weapon.';

export function renderReport(groups: readonly Group[], tables: readonly string[], header: readonly string[]): string {
  const out: string[] = [...header, '', '## Summary', '', ...summaryTable(groups)];
  for (const g of groups) {
    const a: Aggregate = aggregate(g.runs);
    out.push('', `## ${g.difficulty} autopilot, ${g.players} Player${g.players > 1 ? 's' : ''}${g.allies ? ` + ${g.allies} AI ally` : ''}, seeds ${Math.min(...g.runs.map((r) => r.seed))}-${Math.max(...g.runs.map((r) => r.seed))}`, '', ...formatAggregate(a));
    if (tables.includes('runs')) out.push('', ...formatRuns(g.runs));
    if (tables.includes('builds')) out.push('', ...formatBuilds(g.runs));
    if (tables.includes('halls')) out.push('', ...formatHalls(g.runs));
  }
  return out.join('\n');
}

function reportHeader(env: NodeJS.ProcessEnv): string[] {
  return [
    '# Dungeon tuning harness report',
    '',
    'An autopilot is not a human: it is the AI at a difficulty walking to loot and Doors. Compare tickets against it; do not read it as a human\'s Run.',
    `Reference autopilot: ${REFERENCE_DIFFICULTY}. Flags: ${Object.entries(env).filter(([k]) => k.startsWith('TUNE_')).map(([k, v]) => `${k}=${v}`).join(' ') || '(defaults)'}`,
    LOOT_RULE,
  ];
}

describe('tuning harness', () => {
  const tuning = loadTuningData();

  it.skipIf(!process.env.TUNE_DUNGEON && !process.env.TUNE_MERGE)(
    'plays Runs with autopilot Players and reports each Hall, Floor and Run',
    () => {
      const env = process.env;
      let groups: Group[] = [];
      const merge = list(env.TUNE_MERGE, '');
      if (merge.length > 0) {
        for (const file of merge) {
          for (const g of (JSON.parse(readFileSync(file, 'utf8')) as { groups: Group[] }).groups) {
            if (env.TUNE_DIFFICULTY && !list(env.TUNE_DIFFICULTY, '').includes(g.difficulty)) continue;
            const into = groups.find((x) => x.players === g.players && x.allies === g.allies && x.difficulty === g.difficulty);
            if (into) into.runs.push(...g.runs);
            else groups.push({ ...g, runs: [...g.runs] });
          }
        }
        groups.forEach((g) => g.runs.sort((a, b) => a.seed - b.seed));
        groups.sort((a, b) => a.difficulty.localeCompare(b.difficulty) || a.players - b.players);
      } else {
        const from = Number(env.TUNE_FROM ?? 1);
        const to = Number(env.TUNE_TO ?? 10);
        const floor = int(env.TUNE_FLOOR);
        const row = (int(env.TUNE_ROW) ?? 1) - 1;
        const hall = int(env.TUNE_HALL);
        const route = env.TUNE_ROUTE ?? 'seeded';
        const lootMode = env.TUNE_LOOT ?? 'take';
        const base = {
          allyDifficulty: env.TUNE_ALLY_DIFFICULTY ?? 'Hard',
          weapon: env.TUNE_WEAPON ?? 'Arming Sword',
          route: route === 'seeded' ? ('seeded' as const) : route === 'first' ? [0] : route.split(',').map((d) => Number(d) - 1),
          loot: lootMode === 'none' ? null : lootMode === 'drop' ? ('drop' as const) : ('take' as const),
          ...(floor === undefined && hall === undefined && row === 0 ? {} : { start: { floor: floor ?? 1, row, ...(hall === undefined ? {} : { index: hall - 1 }) } }),
          ...(env.TUNE_RELICS ? { relics: list(env.TUNE_RELICS, '') } : {}),
          until: (env.TUNE_UNTIL ?? 'run') as HarnessConfig['until'],
          ...(int(env.TUNE_MAX_TICKS) === undefined ? {} : { maxTicks: int(env.TUNE_MAX_TICKS)! }),
        };
        for (const difficulty of list(env.TUNE_DIFFICULTY, REFERENCE_DIFFICULTY)) {
          for (const players of list(env.TUNE_PLAYERS, '1').map(Number)) {
            const allies = Math.min(Number(env.TUNE_ALLIES ?? 0), 4 - players);
            const runs: RunRecord[] = [];
            for (let seed = from; seed <= to; seed++) {
              const r = playRun(tuning, seed, { ...base, players, allies, difficulty });
              runs.push(r);
              if (env.TUNE_PROGRESS) process.stderr.write(`${difficulty} ${players}P seed ${seed}: ${r.result} ${r.endHall ?? ''} ${r.hallsCleared} Halls ${(r.seconds / 60).toFixed(1)} min, ${(r.wallMs / 1000).toFixed(0)} s wall\n`);
            }
            groups.push({ players, allies, difficulty, runs });
          }
        }
      }
      const text = renderReport(groups, list(env.TUNE_TABLES, ''), reportHeader(env));
      const out = env.TUNE_OUT ?? join(tmpdir(), 'dungeon-tune.json');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify({ flags: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('TUNE_'))), groups }));
      console.log(text, `\n\nJSON: ${out}`);
    },
    7_200_000,
  );

  // A short run, so the harness does not rot: a few Halls from Floor 1's entrance, capped in Ticks, and the same twice.
  it('plays a short capped Run and measures its Halls', () => {
    const cfg: HarnessConfig = { players: 2, allies: 0, allyDifficulty: 'Hard', difficulty: 'Expert', weapon: 'Arming Sword', route: 'seeded', loot: 'take', until: 'run', maxTicks: 3 * 60 * 60 };
    const run = playRun(tuning, 1, cfg);
    expect(run.result).toBe('stopped');
    expect(run.ticks).toBe(cfg.maxTicks);
    expect(run.route[0]).toBe('1.0.0 Fight');
    expect(run.halls.length).toBeGreaterThan(0);
    const first = run.halls[0]!;
    expect(first.kind).toBe('Fight');
    expect(first.enemies).toBeGreaterThan(0);
    expect(first.hpIn).toBe(1);
    expect(first.contactTicks).toBeLessThanOrEqual(first.fightTicks);
    expect(first.outcome === 'cleared' || first.outcome === 'wiped').toBe(true);
    expect(run.builds).toHaveLength(2);
    // Enemy HP is scaled by the 2 humans: the entrance's unscaled enemy max HP is fighter.maxHp × hpScale × (1 + perPlayerHp).
    expect(first.enemyMaxHp).toBeCloseTo(tuning.fighter.maxHp * (1 + tuning.dungeon.perPlayerHp) * Math.max(...tuning.dungeon.floors[0]!.encounters.Fight[first.encounter!]!.enemies.map((e) => e.hpScale)), 6);
    const again = playRun(tuning, 1, cfg);
    expect({ ...again, wallMs: 0 }).toEqual({ ...run, wallMs: 0 });
  });

  it('measures a Boss from a dev start', () => {
    const cfg: HarnessConfig = { players: 1, allies: 0, allyDifficulty: 'Hard', difficulty: 'Expert', weapon: 'Arming Sword', route: 'seeded', loot: 'take', start: { floor: 1, row: 4 }, relics: ['Whetstone'], until: 'hall', maxTicks: 60 * 60 };
    const run = playRun(tuning, 2, cfg);
    expect(run.route.at(-1)).toMatch(/^1\.4\.0 Boss$/);
    expect(run.halls.every((h) => h.kind === 'Boss')).toBe(true);
    expect(run.builds[0]!.equipped).toEqual(['Whetstone']);
    expect(runKit(tuning, 'gen:greybox:2')).toBe('greybox');
  });
});
