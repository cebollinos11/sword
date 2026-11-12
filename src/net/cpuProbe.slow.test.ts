/**
 * Probe (not a regression test): what an online Battle costs each peer per frame, on the real clock, as Soldiers are promoted.
 * Full-size armies, the online Battle's Input Delay, internet-ish latency over the star (guests hear each other through the host),
 * and Player Intents whose aim wobbles every Tick as a mouse does, so the others' predictions miss and frames Roll back.
 * Opt-in, so CI never runs it: `PROBE=1 npx vitest run --project slow src/net/cpuProbe.slow.test.ts`. Options: PROBE_TEAMS (default 0,1,0),
 * PROBE_TICKS (default 4000), PROBE_DELAY (Input Delay, default BATTLE_INPUT_DELAY), PROBE_PROF=<file> (a CPU profile of the melee).
 * The tests freeze every snapshotted state (ADR 0028), which a production build does not: add VITE_SNAPSHOT_FREEZE=0 to time what it costs.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { loadTuningData } from '../tuning';
import { createBattlePilot, type Lineup, type PlayerNumber } from '../controllers';
import { IDLE_INTENT, inDuel, stepMatch, TICK_RATE, type Intent, type MatchState } from '../sim';
import { createMemoryTransportPair } from './memoryTransport';
import { BATTLE_INPUT_DELAY, createRollbackSession } from './session';

afterEach(() => vi.restoreAllMocks());

const hr = () => Number(process.hrtime.bigint()) / 1e6;
const TEAMS = (process.env.PROBE_TEAMS ?? '0,1,0').split(',').map(Number);
const TICKS = Number(process.env.PROBE_TICKS ?? 4000);
const DELAY = Number(process.env.PROBE_DELAY ?? BATTLE_INPUT_DELAY);
const TICK_MS = 1000 / TICK_RATE;

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  return { n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1) ?? 0 };
};
const f = (x: number) => x.toFixed(1);

it.skipIf(!process.env.PROBE)('probes per-frame CPU in an online Battle', async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const lineup: Lineup = TEAMS.map((team, p) => ({ team, pilot: { kind: 'Player', player: p as PlayerNumber } }));
  const pairs = TEAMS.slice(1).map((_, i) => createMemoryTransportPair({ latencyMs: 45, jitterMs: 25, seed: 7 + i }));
  const tunings = TEAMS.map(() => loadTuningData());
  const steps = TEAMS.map(() => ({ ms: 0, n: 0 }));
  const stepOf = (k: number) => (m: MatchState, i: readonly Intent[], t: typeof tunings[0]) => {
    const t0 = hr();
    const next = stepMatch(m, i, t);
    steps[k]!.ms += hr() - t0;
    steps[k]!.n++;
    return next;
  };
  const match = { format: 'Battle', bestOf: 1, seed: 11 } as const;
  const host = createRollbackSession({ role: 'host', guests: pairs.map((p) => p.a), tuning: tunings[0]!, match, lineup, weapon: 'Longsword', step: stepOf(0), inputDelay: DELAY });
  const guests = pairs.map((p, i) => createRollbackSession({ role: 'guest', transport: p.b, tuning: tunings[i + 1]!, weapon: 'Longsword', step: stepOf(i + 1), inputDelay: DELAY }));
  const sessions = [host, ...guests];
  const pilots = sessions.map((_, k) => createBattlePilot(tunings[k]!, 'Hard'));
  type Row = { tick: number; bound: number; ms: number; step: number; stepN: number; rolled: number };
  const rows: Row[][] = sessions.map(() => []);
  const prof = process.env.PROBE_PROF ? new Session() : null;
  const post = (m: string, a?: object) => new Promise<unknown>((ok, no) => prof!.post(m, a ?? {}, (e, r) => (e ? no(e) : ok(r))));
  let profiling = false;
  if (prof) prof.connect();
  let n = 0;
  while (host.currentTick < TICKS && host.state?.status.status !== 'Over') {
    clock += TICK_MS;
    n++;
    for (const p of pairs) p.advance(TICK_MS);
    if (prof && !profiling && host.state && host.state.duel.fighters.filter((x) => x.soldier && inDuel(x)).length >= 8) {
      profiling = true;
      prof.post('Profiler.enable');
      prof.post('Profiler.start');
    }
    sessions.forEach((s, k) => {
      const st = s.state;
      let intent: Intent = IDLE_INTENT;
      if (st && s.localFighter >= 0 && st.status.status !== 'Over') {
        const base = pilots[k]!.intent(st.duel, s.localFighter);
        intent = base.face === null ? base : { ...base, face: base.face + Math.sin(n * 0.7 + k) * 0.03 };
      }
      const s0 = steps[k]!.ms;
      const n0 = steps[k]!.n;
      const t0 = hr();
      const res = s.tick(intent);
      const ms = hr() - t0;
      const after = s.state;
      const bound = after ? after.duel.fighters.filter((x) => x.soldier && inDuel(x)).length : 0;
      rows[k]!.push({ tick: s.currentTick, bound, ms, step: steps[k]!.ms - s0, stepN: steps[k]!.n - n0, rolled: res.rolledBack });
    });
  }
  if (prof && profiling) {
    const r = (await post('Profiler.stop')) as { profile: unknown };
    writeFileSync(process.env.PROBE_PROF!, JSON.stringify(r.profile));
  }
  const out: string[] = [`\nCPU probe: teams ${TEAMS.join(',')}, ${host.currentTick} Ticks, Input Delay ${DELAY}, full armies (${tunings[0]!.battle.armySize})`];
  sessions.forEach((s, k) => {
    const rs = rows[k]!.filter((r) => r.tick > 200);
    const all = stats(rs.map((r) => r.ms));
    const rolled = rs.filter((r) => r.rolled > 0);
    out.push(
      `peer ${k}: frame ${f(all.mean)} ms mean, p95 ${f(all.p95)}, p99 ${f(all.p99)}, max ${f(all.max)}; ` +
        `Rollbacks on ${((100 * rolled.length) / rs.length).toFixed(0)}% of frames, depth mean ${f(stats(rolled.map((r) => r.rolled)).mean)} max ${stats(rolled.map((r) => r.rolled)).max}; ` +
        `stepMatch ${f((100 * rs.reduce((a, r) => a + r.step, 0)) / rs.reduce((a, r) => a + r.ms, 0))}% of the time; stats ${JSON.stringify(s.stats)}`,
    );
    const by = new Map<number, Row[]>();
    for (const r of rs) {
      const b = Math.min(16, r.bound);
      by.set(b, [...(by.get(b) ?? []), r]);
    }
    out.push(
      `  by bound Soldiers (bound: frames, frame mean/p95/max ms, ms per simulated Tick): ` +
        [...by]
          .sort((a, b) => a[0] - b[0])
          .map(([b, xs]) => {
            const st = stats(xs.map((x) => x.ms));
            const sims = xs.reduce((a, x) => a + x.stepN, 0);
            return `${b}: ${xs.length}, ${f(st.mean)}/${f(st.p95)}/${f(st.max)}, ${(xs.reduce((a, x) => a + x.ms, 0) / Math.max(1, sims)).toFixed(2)}`;
          })
          .join('; '),
    );
  });
  process.stderr.write(out.join('\n') + '\n');
  expect(host.status).toBe('Running');
}, 900_000);
