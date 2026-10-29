/**
 * The Dungeon tuning harness's report (`dungeon.tune.test.ts`, Stage 5): plain per-Hall and per-Run records, and the pure
 * aggregation and formatting of them. No Simulation here: the harness plays the Runs and fills the records; this turns
 * many records into win rates, HP carried, Run times, loot rates and a pasteable summary. Test and tooling code only.
 */

/** How a Hall ended for the party. */
export type HallOutcome = 'cleared' | 'wiped' | 'hang';

/** One Hall of one Run, as measured. HP fractions are Team 0's summed HP over its summed max HP (a fallen Fighter counts 0). */
export interface HallRecord {
  readonly floor: number;
  /** 0-based: 0 the entrance, 4 the Boss. */
  readonly row: number;
  readonly index: number;
  readonly kind: string;
  /** The Encounter's index in its Floor's pool for the kind (the Boss: 0), null for a Hall with none. */
  readonly encounter: number | null;
  readonly enemies: number;
  /** The largest max HP among the Hall's enemies (0 for none). */
  readonly enemyMaxHp: number;
  readonly outcome: HallOutcome;
  /** Ticks from the Hall's start to its Clear (or to the wipe or the cap). 0 for a Treasure or Rest Hall (cleared on arrival). */
  readonly fightTicks: number;
  /** Ticks until a Team 0 and a Team 1 Fighter first came within NEAR; `fightTicks` if never. */
  readonly contactTicks: number;
  /** Ticks from the Clear to the Door taken; null if no Door was taken (the Run ended first or hung). */
  readonly walkTicks: number | null;
  readonly walkHang: boolean;
  readonly hpIn: number;
  /** When the Hall was cleared (after a Clear heal), or at the wipe or cap. */
  readonly hpOut: number;
  /** When the Door was taken (after a Rest heal, a pickup and so on): the HP carried on; null if no Door was taken. */
  readonly hpLeave: number | null;
  /** Team 0 Fighters that fell in this Hall. */
  readonly deaths: number;
  /** Team 0 Fighters that were down when the Hall before ended and stood again on entering this one. */
  readonly revives: number;
  /** Rest heal taken, as a fraction of Team 0's summed max HP. */
  readonly restHeal: number;
  /** The enemies' summed HP left as a fraction of their summed max HP when the Hall ended: 0 for a Clear, the rest at a wipe or a fight cap (tells a stall from a slow win). */
  readonly enemyHpLeft: number;
  /** Team 0 Fighters standing when the Hall ended (at a fight cap or a wipe). */
  readonly alive: number;
}

/** What happened to one item name in one Run: `kind:name` keys (`relic:Whetstone`, `weapon:Sledge Hammer`). */
export interface ItemCount {
  /** Copies that lay in a Hall for a Player (each Player's copy counts), a Treasure Hall's pedestals included. */
  offered: number;
  taken: number;
  equipped: number;
  dropped: number;
  /** Of `offered`, the copies that lay on a Treasure Hall's pedestals (a Player may take one of its three, which closes the rest). */
  pedestal: number;
  /** Of `taken`, the ones taken off a pedestal. */
  pedestalTaken: number;
}

/** A Player's final inventory. */
export interface BuildRecord {
  readonly player: number;
  readonly weapon: string;
  readonly weapons: readonly string[];
  readonly equipped: readonly string[];
  readonly carried: readonly string[];
}

export type RunResult = 'won' | 'lost' | 'hang' | 'stopped';

export interface RunRecord {
  readonly seed: number;
  readonly players: number;
  readonly allies: number;
  /** The autopilot difficulty of the Players. */
  readonly difficulty: string;
  /** 'won' the last Boss fell; 'lost' Team 0 was wiped; 'hang' a cap was hit; 'stopped' the harness's own stop (`TUNE_UNTIL`, `TUNE_MAX_TICKS`) was reached. */
  readonly result: RunResult;
  /** The Hall the Run ended in (`floor.row.index kind`, 1-based floor and 0-based row, as HallRecord), null if it won. */
  readonly endHall: string | null;
  readonly hallsCleared: number;
  readonly ticks: number;
  readonly seconds: number;
  /** The Halls entered, in order: `floor.row.index kind`. */
  readonly route: readonly string[];
  readonly halls: readonly HallRecord[];
  readonly loot: Readonly<Record<string, ItemCount>>;
  readonly builds: readonly BuildRecord[];
  /** Wall time to play it (ms); not part of the Simulation. */
  readonly wallMs: number;
}

export const hallLabel = (h: Pick<HallRecord, 'floor' | 'row' | 'index' | 'kind'>): string => `${h.floor}.${h.row}.${h.index} ${h.kind}`;

/** The median of `xs` (the mean of the middle two for an even count); NaN for none. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The `p`th (0 to 1) percentile of `xs`, linearly interpolated; NaN for none. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const at = p * (s.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

/** A group of Halls fought: how many, how many cleared, and the medians over them. */
export interface HallGroup {
  readonly fought: number;
  readonly cleared: number;
  /** cleared / fought. */
  readonly winRate: number;
  readonly medianHpIn: number;
  /** Median HP fraction carried through the Door, over the Halls whose Door was taken. */
  readonly medianHpLeave: number;
  readonly medianFightSeconds: number;
  readonly medianContactSeconds: number;
  readonly medianWalkSeconds: number;
  readonly medianEnemyMaxHp: number;
  readonly deaths: number;
  readonly revives: number;
  /** Mean Rest heal per Hall (fraction of Team 0's max HP). */
  readonly meanRestHeal: number;
}

export function groupHalls(halls: readonly HallRecord[], tickRate = 60): HallGroup {
  const cleared = halls.filter((h) => h.outcome === 'cleared').length;
  const sec = (t: number) => t / tickRate;
  return {
    fought: halls.length,
    cleared,
    winRate: halls.length === 0 ? NaN : cleared / halls.length,
    medianHpIn: median(halls.map((h) => h.hpIn)),
    medianHpLeave: median(halls.flatMap((h) => (h.hpLeave === null ? [] : [h.hpLeave]))),
    medianFightSeconds: sec(median(halls.map((h) => h.fightTicks))),
    medianContactSeconds: sec(median(halls.map((h) => h.contactTicks))),
    medianWalkSeconds: sec(median(halls.flatMap((h) => (h.walkTicks === null ? [] : [h.walkTicks])))),
    medianEnemyMaxHp: median(halls.filter((h) => h.enemies > 0).map((h) => h.enemyMaxHp)),
    deaths: halls.reduce((a, h) => a + h.deaths, 0),
    revives: halls.reduce((a, h) => a + h.revives, 0),
    meanRestHeal: mean(halls.map((h) => h.restHeal)),
  };
}

export interface FloorStats {
  readonly floor: number;
  /** Runs that entered the Floor. */
  readonly entered: number;
  /** Runs that cleared its Boss. */
  readonly bossCleared: number;
  /** bossCleared / entered: the Floor's win rate. */
  readonly winRate: number;
  /** Median HP fraction carried through the Doors of the Floor's cleared Halls. */
  readonly medianHpLeave: number;
  /** Median HP fraction when the Boss fell. */
  readonly medianHpAtBossClear: number;
  /** Runs whose last Hall (lost or hung) was on this Floor. */
  readonly endedHere: number;
}

export interface ItemStats extends ItemCount {
  readonly key: string;
  /** Taken / offered for the copies off the pedestals (a Hall's drops, an Elite's carried Relic): the rate a Player takes what simply lies there. */
  readonly takenRate: number;
  /** Pedestal copies picked / pedestal copies offered. Three lie on a Player's pedestals and one is taken, so an even pick is 33%. */
  readonly pedestalPickRate: number;
  /** equipped / taken. */
  readonly equippedRate: number;
}

export interface Aggregate {
  readonly runs: number;
  readonly won: number;
  readonly lost: number;
  readonly hung: number;
  readonly stopped: number;
  readonly winRate: number;
  readonly medianHallsCleared: number;
  /** Run time in seconds: median, 10th and 90th percentile, shortest and longest. */
  readonly runSeconds: { readonly median: number; readonly p10: number; readonly p90: number; readonly min: number; readonly max: number };
  /** Run time of the Runs that were won (same fields; NaN with none). */
  readonly wonSeconds: { readonly median: number; readonly p10: number; readonly p90: number; readonly min: number; readonly max: number };
  /** Median HP fraction at the start of the Hall each lost or hung Run ended in: what the party walked into its end with (HP carried excludes that Hall). */
  readonly fatalHpIn: number;
  readonly floors: readonly FloorStats[];
  readonly byKind: Readonly<Record<string, HallGroup>>;
  /** By row (0-based), over all Floors; Halls fought only (Rest and Treasure are cleared on arrival: see `byKind`). */
  readonly byRow: Readonly<Record<string, HallGroup>>;
  /** By `floor.row`; Halls fought only. */
  readonly byFloorRow: Readonly<Record<string, HallGroup>>;
  /** By `floor kind`: each Floor's Fights, Elites and so on, and `floor Boss` each Boss on its own. */
  readonly byFloorKind: Readonly<Record<string, HallGroup>>;
  /** By `floor kind#encounter`: one Encounter of a Floor's pool, over every row it was met in (Fight and Elite Halls; the Boss's is `floor Boss#0`). */
  readonly byEncounter: Readonly<Record<string, HallGroup>>;
  readonly items: readonly ItemStats[];
  readonly hangs: { readonly fights: number; readonly walks: number };
  readonly wallSeconds: number;
}

const spread = (xs: readonly number[]) => ({ median: median(xs), p10: percentile(xs, 0.1), p90: percentile(xs, 0.9), min: xs.length ? Math.min(...xs) : NaN, max: xs.length ? Math.max(...xs) : NaN });

function groupBy(halls: readonly HallRecord[], key: (h: HallRecord) => string | null): Record<string, HallGroup> {
  const buckets = new Map<string, HallRecord[]>();
  for (const h of halls) {
    const k = key(h);
    if (k !== null) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(h);
  }
  return Object.fromEntries([...buckets].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([k, hs]) => [k, groupHalls(hs)]));
}

/** Every number the report shows, from the Runs' records. Pure. */
export function aggregate(runs: readonly RunRecord[], tickRate = 60): Aggregate {
  const halls = runs.flatMap((r) => r.halls);
  const floorCount = Math.max(0, ...halls.map((h) => h.floor));
  const floors: FloorStats[] = Array.from({ length: floorCount }, (_, k) => {
    const floor = k + 1;
    const inFloor = runs.filter((r) => r.halls.some((h) => h.floor === floor));
    const boss = inFloor.flatMap((r) => r.halls.filter((h) => h.floor === floor && h.kind === 'Boss' && h.outcome === 'cleared'));
    return {
      floor,
      entered: inFloor.length,
      bossCleared: boss.length,
      winRate: inFloor.length === 0 ? NaN : boss.length / inFloor.length,
      medianHpLeave: median(halls.filter((h) => h.floor === floor && h.hpLeave !== null).map((h) => h.hpLeave!)),
      medianHpAtBossClear: median(boss.map((h) => h.hpOut)),
      endedHere: runs.filter((r) => (r.result === 'lost' || r.result === 'hang') && r.halls.at(-1)?.floor === floor).length,
    };
  });
  const fought = halls.filter((h) => h.enemies > 0);
  const items = new Map<string, ItemCount>();
  for (const r of runs)
    for (const [k, c] of Object.entries(r.loot)) {
      const t = items.get(k) ?? items.set(k, { offered: 0, taken: 0, equipped: 0, dropped: 0, pedestal: 0, pedestalTaken: 0 }).get(k)!;
      t.offered += c.offered;
      t.taken += c.taken;
      t.equipped += c.equipped;
      t.dropped += c.dropped;
      t.pedestal += c.pedestal;
      t.pedestalTaken += c.pedestalTaken;
    }
  const won = runs.filter((r) => r.result === 'won');
  return {
    runs: runs.length,
    won: won.length,
    lost: runs.filter((r) => r.result === 'lost').length,
    hung: runs.filter((r) => r.result === 'hang').length,
    stopped: runs.filter((r) => r.result === 'stopped').length,
    winRate: runs.length === 0 ? NaN : won.length / runs.length,
    medianHallsCleared: median(runs.map((r) => r.hallsCleared)),
    runSeconds: spread(runs.map((r) => r.ticks / tickRate)),
    wonSeconds: spread(won.map((r) => r.ticks / tickRate)),
    fatalHpIn: median(runs.flatMap((r) => (r.result === 'lost' || r.result === 'hang') && r.halls.length > 0 ? [r.halls.at(-1)!.hpIn] : [])),
    floors,
    byKind: groupBy(halls, (h) => h.kind),
    byRow: groupBy(fought, (h) => String(h.row)),
    byFloorRow: groupBy(fought, (h) => `${h.floor}.${h.row}`),
    byFloorKind: groupBy(halls, (h) => `${h.floor} ${h.kind}`),
    byEncounter: groupBy(halls, (h) => (h.encounter === null ? null : `${h.floor} ${h.kind}#${h.encounter}`)),
    items: [...items]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, c]) => ({
        key,
        ...c,
        takenRate: c.offered === c.pedestal ? NaN : (c.taken - c.pedestalTaken) / (c.offered - c.pedestal),
        pedestalPickRate: c.pedestal === 0 ? NaN : c.pedestalTaken / c.pedestal,
        equippedRate: c.taken === 0 ? NaN : c.equipped / c.taken,
      })),
    hangs: { fights: halls.filter((h) => h.outcome === 'hang').length, walks: halls.filter((h) => h.walkHang).length },
    wallSeconds: runs.reduce((a, r) => a + r.wallMs, 0) / 1000,
  };
}

const pct = (x: number): string => (Number.isNaN(x) ? '-' : `${Math.round(x * 100)}%`);
const num = (x: number, digits = 1): string => (Number.isNaN(x) ? '-' : x.toFixed(digits));

function groupRows(label: string, groups: Readonly<Record<string, HallGroup>>): string[] {
  const out = [`| ${label} | fought | cleared | win | HP in | HP carried | fight s | contact s | walk s | enemy HP | deaths | revives | rest heal |`, '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const [k, g] of Object.entries(groups))
    out.push(`| ${k} | ${g.fought} | ${g.cleared} | ${pct(g.winRate)} | ${pct(g.medianHpIn)} | ${pct(g.medianHpLeave)} | ${num(g.medianFightSeconds)} | ${num(g.medianContactSeconds)} | ${num(g.medianWalkSeconds)} | ${num(g.medianEnemyMaxHp, 0)} | ${g.deaths} | ${g.revives} | ${pct(g.meanRestHeal)} |`);
  return out;
}

/** The headline table of one aggregate (Runs, Floors, Run time), as markdown. */
export function formatHeadline(a: Aggregate): string[] {
  const t = a.runSeconds;
  const out = [
    `Runs ${a.runs}: **won ${a.won} (${pct(a.winRate)})**, lost ${a.lost}, hung ${a.hung}, stopped ${a.stopped}; median Halls cleared ${num(a.medianHallsCleared)}; ` +
      `Run time over all ${a.runs} Runs, lost ones included: median ${num(t.median / 60)} min (p10 ${num(t.p10 / 60)}, p90 ${num(t.p90 / 60)}, ${num(t.min / 60)} to ${num(t.max / 60)})` +
      (a.won > 0 ? `; won Runs only: median ${num(a.wonSeconds.median / 60)} min (${num(a.wonSeconds.min / 60)} to ${num(a.wonSeconds.max / 60)})` : '; no Run won, so no full-Run time') +
      `; median HP at the start of the Hall each lost Run ended in ${pct(a.fatalHpIn)} (the HP carried below leaves that Hall out)` +
      `; hangs: ${a.hangs.fights} fight, ${a.hangs.walks} walk`,
    '',
    '| Floor | entered | Boss cleared | win | HP carried (median, cleared Halls, Doors only) | HP when Boss fell | Runs ended here |',
    '|---|---|---|---|---|---|---|',
    ...a.floors.map((f) => `| ${f.floor} | ${f.entered} | ${f.bossCleared} | ${pct(f.winRate)} | ${pct(f.medianHpLeave)} | ${pct(f.medianHpAtBossClear)} | ${f.endedHere} |`),
  ];
  return out;
}

/** The full report of one aggregate, as markdown: headline, Halls by kind, row, Floor and Boss, loot. */
export function formatAggregate(a: Aggregate): string[] {
  const loot = [
    'Loot: "floor offers" are copies lying in a Hall for a Player outside pedestals (a drop, an Elite\'s Relic); a Treasure Hall\'s pedestals (three per Player, one may be taken) are counted apart, so an even pick is 33%. Equipped % is of taken.',
    '',
    '| item | floor offers | taken | taken % | pedestal offers | picked | picked % | equipped | equipped % | dropped |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const i of a.items)
    loot.push(`| ${i.key} | ${i.offered - i.pedestal} | ${i.taken - i.pedestalTaken} | ${pct(i.takenRate)} | ${i.pedestal} | ${i.pedestalTaken} | ${pct(i.pedestalPickRate)} | ${i.equipped} | ${pct(i.equippedRate)} | ${i.dropped} |`);
  return [
    ...formatHeadline(a),
    '',
    'Hall kinds (a Rest or Treasure Hall is cleared on arrival, so its win and fight time are trivial; read its HP in, HP carried and rest heal):',
    '',
    ...groupRows('Hall kind', a.byKind),
    '',
    'By row and by Floor.row: Halls fought only (Rest and Treasure left out).',
    '',
    ...groupRows('Row (0 entrance, 4 Boss)', a.byRow),
    '',
    ...groupRows('Floor.row', a.byFloorRow),
    '',
    ...groupRows('Floor kind (Bosses each)', a.byFloorKind),
    '',
    'By Encounter (index in the Floor’s pool for the kind; rows differ in depth HP, see the enemy HP column):',
    '',
    ...groupRows('Floor kind#Encounter', a.byEncounter),
    '',
    ...loot,
  ];
}

/** Each Player's final build, one line a Run and Player. */
export function formatBuilds(runs: readonly RunRecord[]): string[] {
  const out = ['| seed | result | Player | weapon (carried) | equipped Relics | carried Relics |', '|---|---|---|---|---|---|'];
  for (const r of runs)
    for (const b of r.builds) out.push(`| ${r.seed} | ${r.result} | P${b.player} | ${b.weapon}${b.weapons.length > 1 ? ` (${b.weapons.filter((w) => w !== b.weapon).join(', ')})` : ''} | ${b.equipped.join(', ') || '-'} | ${b.carried.join(', ') || '-'} |`);
  return out;
}

/** One line a Run: the result, where it ended, time and route. */
export function formatRuns(runs: readonly RunRecord[]): string[] {
  const out = ['| seed | result | ended in | Halls cleared | time | route |', '|---|---|---|---|---|---|'];
  for (const r of runs) out.push(`| ${r.seed} | ${r.result} | ${r.endHall ?? '-'} | ${r.hallsCleared} | ${num(r.seconds / 60, 2)} min | ${r.route.map((h) => h.split(' ')[1]?.[0] ?? '?').join('')} |`);
  return out;
}

/**
 * The Halls of every Run, one line each (the per-Hall record): kind, place, Encounter, enemies and max HP, fight time, time to contact, walk time,
 * Team 0's HP in, out and carried, deaths, revives, Rest heal.
 */
export function formatHalls(runs: readonly RunRecord[], tickRate = 60): string[] {
  const out = ['| seed | Hall | enc | enemies | max HP | fight s | contact s | walk s | HP in | HP out | HP carried | deaths | revives | rest heal | outcome |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of runs)
    for (const h of r.halls)
      out.push(
        `| ${r.seed} | ${hallLabel(h)} | ${h.encounter ?? '-'} | ${h.enemies} | ${num(h.enemyMaxHp, 0)} | ${num(h.fightTicks / tickRate)} | ${num(h.contactTicks / tickRate)} | ${h.walkTicks === null ? '-' : num(h.walkTicks / tickRate)}${h.walkHang ? ' HANG' : ''} | ${pct(h.hpIn)} | ${pct(h.hpOut)} | ${h.hpLeave === null ? '-' : pct(h.hpLeave)} | ${h.deaths} | ${h.revives} | ${pct(h.restHeal)} | ${h.outcome}${h.outcome === 'cleared' ? '' : ` (enemies ${pct(h.enemyHpLeft)} left, ${h.alive} standing)`} |`,
      );
  return out;
}

/** The Halls a cap ended: fight caps with the enemy HP left and the Players standing (a stall and a slow win look different), walk caps with the time walked. */
export function formatHangs(runs: readonly RunRecord[], tickRate = 60): string[] {
  const out = ['| seed | Hall | cap | time s (lower bound) | enemy HP left | Players standing |', '|---|---|---|---|---|---|'];
  for (const r of runs)
    for (const h of r.halls) {
      if (h.outcome === 'hang') out.push(`| ${r.seed} | ${hallLabel(h)} | fight | ${num(h.fightTicks / tickRate)} | ${pct(h.enemyHpLeft)} | ${h.alive} |`);
      else if (h.walkHang) out.push(`| ${r.seed} | ${hallLabel(h)} | walk | ${num((h.walkTicks ?? 0) / tickRate)} | - | ${h.alive} |`);
    }
  return out;
}
