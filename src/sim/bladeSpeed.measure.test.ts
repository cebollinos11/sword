import { it } from 'vitest';
import { loadTuningData, spinUpSpeed } from '../tuning';
import { attack, runDuel, type AttackAction, type Direction, type HitEvent } from './index';

/**
 * Measures the Blade Speeds each Weapon's Attacks actually reach, against its reference `speed`.
 *   MEASURE_BLADE=1 npx vitest run src/sim/bladeSpeed.measure.test.ts --silent=false
 */
const tuning = loadTuningData();
const ALL: Direction[] = ['Overhead', 'Left', 'Right', 'Thrust'];
const TICK = 1 / 60;
const f = (n: number) => n.toFixed(1);

type V = { x: number; y: number; z: number };
const at = (h: V, t: V, u: number): V => ({ x: h.x + (t.x - h.x) * u, y: h.y + (t.y - h.y) * u, z: h.z + (t.z - h.z) * u });
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

it.skipIf(!process.env.MEASURE_BLADE)('measure Blade Speed per Weapon', () => {
  const free = ['| Weapon | ref speed | Direction | hold | peak Head speed (free swing, Release) | peak / ref |', '|---|---|---|---|---|---|'];
  const hits = ['| Weapon | ref speed | Direction | hold | Head Hits | min | median | max | median / ref | heavy |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [name, w] of Object.entries(tuning.weapons)) {
    const dirs = (w.attacks ?? ALL) as Direction[];
    const holds = w.spinUp ? [1, Math.ceil(w.spinUp.seconds * 60) + 1] : [1];
    const u = 1 - w.head / (2 * w.length); // centre of the Head along the blade
    for (const d of dirs) {
      for (const h of holds) {
        const label = h === 1 ? 'tap' : 'full spin';
        // Free swing: nobody in reach.
        const run = runDuel(tuning, { distance: 20, weapons: [name, 'Arming Sword'], a: attack(d, h), b: [] });
        let peak = 0;
        for (let i = 1; i < run.states.length; i++) {
          const a = run.states[i]!.fighters[0]!;
          const p = run.states[i - 1]!.fighters[0]!;
          if (a.action.kind !== 'Attack' || (a.action as AttackAction).phase !== 'Release') continue;
          const spin = spinUpSpeed(w, (a.action as AttackAction).charge ?? 0);
          const v = (dist(at(a.blade.hilt, a.blade.tip, u), at(p.blade.hilt, p.blade.tip, u)) / TICK) * (w.spinUp ? spin : 1);
          peak = Math.max(peak, v);
        }
        free.push(`| ${name} | ${w.speed} | ${d} | ${label} | ${f(peak)} | ${(peak / w.speed).toFixed(2)} |`);
        // Real contacts: an idle defender at a sweep of distances.
        const speeds: number[] = [];
        let heavy = 0;
        for (let dd = 0.8; dd <= 2.6; dd += 0.05) {
          const r = runDuel(tuning, { distance: dd, weapons: [name, 'Arming Sword'], a: attack(d, h), b: [] });
          const hit = r.states.flatMap((s) => s.events).find((e): e is HitEvent => e.type === 'Hit' && e.attacker === 0);
          if (hit?.head) {
            speeds.push(hit.bladeSpeed);
            if (hit.heavy) heavy++;
          }
        }
        speeds.sort((a, b) => a - b);
        const med = speeds[Math.floor(speeds.length / 2)] ?? NaN;
        hits.push(`| ${name} | ${w.speed} | ${d} | ${label} | ${speeds.length} | ${f(speeds[0] ?? NaN)} | ${f(med)} | ${f(speeds.at(-1) ?? NaN)} | ${(med / w.speed).toFixed(2)} | ${heavy}/${speeds.length} |`);
      }
    }
  }
  console.log([...free, '', ...hits].join('\n'));
}, 600_000);
