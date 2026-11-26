/**
 * A Slow AI makes every jump a normal one does (docs/plans/enemy-behaviours.md, Stage 5): the jump Links (`nav.ts`) and every `jumpIsSafe`
 * check are worked out at the full `fighter.walkSpeed`, and a Slow Fighter's Jump takes off and flies at that speed (only its ground walk is
 * slow). So a Slow Hard AI follows an enemy onto each held-Jump spot of docs/jump-reach.md, as `ai.test.ts` asks of a normal one.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { createInitialState, groundBelow, jumpArc, storedMods, TICK_RATE, wait } from '../sim';
import { quirkMods } from '../sim/delver';
import { JUMP_SPOTS } from '../sim/jumpSpots.testdata';
import { createAiController, runControllers, scriptedController } from './index';

const repo = loadTuningData();
const SLOW = storedMods(quirkMods(repo, ['Slow']));

describe('a Slow AI follows onto every held-Jump spot', { timeout: 300_000 }, () => {
  /** A Hard AI (Slow or not) 0.8 m back from where the spot's Jump takes off, an idle enemy where it lands: the Tick it stands on the same Walk Surface, or -1. */
  function follow(s: (typeof JUMP_SPOTS)[number], slow: boolean, seconds = 30): number {
    const arena = repo.arenas[s.arena]!;
    const y = groundBelow(arena, s.x, s.z, s.y + repo.fall.stepUp)!.y;
    const lands = jumpArc(arena, repo, { at: { x: s.x, z: s.z }, y, heading: s.move, holdTicks: s.hold }).lands!;
    const lid = groundBelow(arena, lands.x, lands.z, lands.y + 1e-6)!.surface;
    const start = { x: s.x - s.move.x * 0.8, z: s.z - s.move.z * 0.8 };
    const initial = createInitialState(repo, 1, [{ position: start, y, facing: 0 }, { position: lands, y: lands.y, facing: Math.PI }], [], [0, 1], s.arena);
    const placed = slow ? { ...initial, fighters: initial.fighters.map((f, i) => (i === 0 ? { ...f, mods: SLOW } : f)) } : initial;
    const run = runControllers(repo, placed, [createAiController(repo, 'Hard'), scriptedController(wait(1))], TICK_RATE * seconds);
    expect(run.states.every((st) => !st.fighters[0]!.death), `${s.spot}: the AI died`).toBe(true);
    return run.states.findIndex((st) => {
      const f = st.fighters[0]!;
      return !f.air && groundBelow(arena, f.position.x, f.position.z, f.y + 1e-6)?.surface === lid;
    });
  }

  it('a Slow Hard AI reaches each of them, on every Arena, as a normal Hard AI does', () => {
    const report: string[] = [];
    for (const s of JUMP_SPOTS) {
      const plain = follow(s, false);
      const slow = follow(s, true);
      report.push(`${s.arena} ${s.spot}: Hard ${plain < 0 ? 'no' : `${(plain / TICK_RATE).toFixed(1)} s`}, Slow Hard ${slow < 0 ? 'no' : `${(slow / TICK_RATE).toFixed(1)} s`}`);
      expect(plain, `Hard onto ${s.arena} ${s.spot}`).toBeGreaterThan(0);
      expect(slow, `Slow Hard onto ${s.arena} ${s.spot}`).toBeGreaterThan(0);
    }
    console.log(report.join('\n'));
  });
});
