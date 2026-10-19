import { it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { createInitialState, runScript, type Track } from './index';

/**
 * Measures how high and far a Jump reaches with the current Tuning Data, for docs/jump-reach.md.
 * Skipped in the normal suite; after changing data/fall.json (or walk speed), run
 *   MEASURE_JUMP=1 npx vitest run src/sim/jumpReach.measure.test.ts --silent=false
 * and paste the printed tables into the note.
 */
const repo = loadTuningData();
const FORWARD = { x: 0, z: 1 };

/** A big floor, plus (when `edge` is given) a 10 m wide block of height `h` whose near edge is `edge` m ahead of the Fighter. */
function arena(edge: number | null, h: number): TuningData {
  const walk = [{ id: 'WALK_floor', points: [[-20, 0, -20], [20, 0, -20], [20, 0, 40], [-20, 0, 40]] }];
  if (edge !== null) walk.push({ id: 'WALK_block', points: [[-5, h, edge], [5, h, edge], [5, h, edge + 4], [-5, h, edge + 4]] });
  return { ...repo, arenas: { ...repo.arenas, t: parseArena({ name: 't', walk, walls: [] }, 't') } };
}

/** Jump on the first Tick while walking forward, holding Jump for `holdTicks`, and keep walking. */
function jump(t: TuningData, holdTicks: number, ticks: number) {
  const track: Track = [
    { ticks: 1, intent: { move: FORWARD, jump: true, jumpHeld: holdTicks > 0 } },
    { ticks: Math.max(0, holdTicks - 1), intent: { move: FORWARD, jumpHeld: true } },
    { ticks, intent: { move: FORWARD } },
  ];
  return runScript(t, createInitialState(t, 1, [{ position: { x: 0, z: 0 }, facing: 0 }], [], [], 't'), [track], ticks);
}

it.skipIf(!process.env.MEASURE_JUMP)('measure Jump reach', () => {
  const out = [`fall.json: ${JSON.stringify(repo.fall)}; walkSpeed ${repo.fighter.walkSpeed}`, '', '| Jump held | Top of the jump | Reached after | Time in the air | Distance on level ground |', '|---|---|---|---|---|'];
  for (const hold of [0, 10, 15, 20, 25, 30]) {
    const r = jump(arena(null, 0), hold, 200);
    const land = r.events.find((e) => e.type === 'Land')!;
    const ys = r.states.map((s) => s.fighters[0]!.y);
    const apex = Math.max(...ys);
    const label = hold === 0 ? 'tap' : `${(hold / 60).toFixed(2)} s`;
    out.push(`| ${label} | ${apex.toFixed(2)} m | ${((ys.indexOf(apex) - 1) / 60).toFixed(2)} s | ${((land.tick - 1) / 60).toFixed(2)} s | ${r.states[land.tick]!.fighters[0]!.position.z.toFixed(2)} m |`);
  }
  out.push('', '| Ledge height | Farthest near edge (full hold) |', '|---|---|');
  for (let h = 0.5; h <= 5; h += 0.25) {
    let best: number | null = null;
    // Farthest first: the first landing found is the reach.
    for (let d = 6; d >= 0.3 && best === null; d -= 0.05) {
      const end = jump(arena(d, h), 60, 130).states.at(-1)!.fighters[0]!;
      if (Math.abs(end.y - h) < 1e-6 && end.position.z > d) best = d;
    }
    out.push(`| ${h.toFixed(2)} m | ${best === null ? 'out of reach' : `${best.toFixed(2)} m`} |`);
    if (best === null) break;
  }
  console.log(out.join('\n'));
}, 600_000);
