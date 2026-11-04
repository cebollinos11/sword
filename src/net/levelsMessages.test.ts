/**
 * docs/plans/battle-objectives.md, Stage 4a: each Soldier's and each Squad anchor's Walk Surface in a Battle's resync. A resync carries them
 * with the rest of the Crowd, and one that names no Walk Surface (or -1 off the open field, a fraction, a short array) is refused.
 */
import { expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createBattlePilot, poolControllers, stepMatchWith } from '../controllers';
import { createMatch } from '../sim';
import { withLevelMaps } from '../sim/levelMaps.testdata';
import { parseNetMessage } from './messages';

const tuning = withLevelMaps(loadTuningData(), 'bridge');
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

it("carries every Soldier's and anchor's Walk Surface in a resync, and refuses one that is not a Walk Surface", () => {
  // A Battle with a Player on autopilot (a resync carries one), 10 s in.
  const controllers = poolControllers(tuning, [createBattlePilot(tuning, 'Hard')]);
  let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2, arena: 'battle:bridge', teams: [0], weapons: ['Longsword'] });
  for (let t = 0; t < 600; t++) m = stepMatchWith(m, controllers, tuning);
  const state = wire(m);
  const crowd = state.duel.crowd!;
  expect(new Set(crowd.surface).size).toBeGreaterThan(1);
  const message = (c: unknown) => ({ type: 'resync', tick: m.tick, state: { ...state, duel: { ...state.duel, crowd: c } }, ai: state.duel.fighters.map(() => null), streams: [] });
  const parsed = parseNetMessage(message(crowd)) as { state: typeof state } | null;
  expect(parsed?.state.duel.crowd?.surface).toEqual(crowd.surface);
  expect(parsed?.state.duel.crowd?.squads.surface).toEqual(crowd.squads.surface);
  const bad = [
    { ...crowd, surface: crowd.surface.map((s, i) => (i === 3 ? 1.5 : s)) },
    { ...crowd, surface: crowd.surface.map((s, i) => (i === 3 ? -2 : s)) },
    { ...crowd, surface: crowd.surface.map((s, i) => (i === 3 ? 1e6 : s)) },
    { ...crowd, surface: crowd.surface.slice(1) },
    { ...crowd, surface: undefined },
    { ...crowd, squads: { ...crowd.squads, surface: crowd.squads.surface.slice(1) } },
    { ...crowd, squads: { ...crowd.squads, surface: crowd.squads.surface.map((s, q) => (q === 0 ? 'top' : s)) } },
  ];
  bad.forEach((c, k) => expect(parseNetMessage(message(c)), `edit ${k}`).toBeNull());
});
