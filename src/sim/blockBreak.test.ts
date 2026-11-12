/**
 * The Block Break: a Blocked blow whose Block Impact strength on a Weapon reaches its `blockImpact.breakAt` knocks the
 * defender down (a short Slide away from the attacker); the Block still stops the blade, so there is no damage and the
 * attacker recoils. Only the Dagger has one.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, withWeapon } from '../tuning';
import { attack, createInitialState, hashState, hold, mirrorDirection, runDuel, runScript, type BlockEvent, type Direction, type HitEvent, type ScriptRun } from './index';
import { startBlockImpact } from './actions';

const tuning = loadTuningData();
const dagger = tuning.weapons.Dagger!;

const events = <T extends HitEvent | BlockEvent>(run: ScriptRun, type: T['type']): T[] =>
  run.states.flatMap((s) => s.events).filter((e): e is T => e.type === type);

/** `weapon` swings in `d` from `distance` into a Dagger Blocking the matching Direction. */
const into = (t: typeof tuning, weapon: string, d: Direction, distance: number, defender = 'Dagger') =>
  runDuel(t, { distance, weapons: [weapon, defender], a: attack(d), b: hold(150, { block: true, direction: mirrorDirection(d) }) });

const blockOf = (run: ScriptRun) => events<BlockEvent>(run, 'Block')[0]!;
const tickOf = (run: ScriptRun, e: BlockEvent) => run.states.find((s) => s.events.includes(e))!;
/** How far Fighter 1 moved (m) from where the Duel placed it to its last Tick. */
const moved = (run: ScriptRun): number => {
  const [from, to] = [run.states[0]!.fighters[1]!.position, run.final.fighters[1]!.position];
  return Math.hypot(to.x - from.x, to.z - from.z);
};

describe('Block Break', () => {
  it('a full-speed Sledge Hammer swing Blocked by a Dagger knocks its wielder down, with no damage, and the attacker recoils', () => {
    const run = into(tuning, 'Sledge Hammer', 'Left', 1.5);
    const block = blockOf(run);
    expect(block.broken).toBe(true);
    const at = tickOf(run, block);
    expect(at.fighters[1]!.action.kind).toBe('Knockdown');
    expect(at.fighters[1]!.blockImpact).toBeUndefined();
    expect(at.fighters[1]!.hp).toBe(tuning.fighter.maxHp);
    expect(at.fighters[0]!.action.kind).toBe('Stagger');
    expect(events<HitEvent>(run, 'Hit')).toEqual([]);
    expect(moved(run)).toBeGreaterThan(dagger.blockImpact.breakSlide * 0.9);
  });

  it('a Halberd swing at the far end of its reach breaks it too', () => {
    const run = into(tuning, 'Halberd', 'Left', 1.5);
    expect(blockOf(run).broken).toBe(true);
    expect(tickOf(run, blockOf(run)).fighters[1]!.action.kind).toBe('Knockdown');
  });

  it('the strength compared is the Block Impact strength: Relic mods and the Weapon scale it', () => {
    const run = into(tuning, 'Halberd', 'Left', 1.5);
    const at = tickOf(run, blockOf(run));
    const strength = startBlockImpact(at.fighters[0]!, at.fighters[1]!, 'Left', blockOf(run).bladeSpeed, tuning).strength;
    expect(strength).toBeGreaterThanOrEqual(dagger.blockImpact.breakAt);
    // The same swing with the break bar above that strength does not break.
    const sturdy = withWeapon(tuning, { blockImpact: { ...dagger.blockImpact, breakAt: strength + 0.01 } }, 'Dagger');
    expect(blockOf(into(sturdy, 'Halberd', 'Left', 1.5)).broken).toBeUndefined();
  });

  it('a slower swing (closer in, below the bar) is Blocked as before: the Block holds and nothing breaks', () => {
    for (const [weapon, d, distance] of [['Sledge Hammer', 'Overhead', 1.0], ['Halberd', 'Overhead', 1.1], ['Halberd', 'Thrust', 1.4]] as const) {
      const run = into(tuning, weapon, d, distance);
      const block = blockOf(run);
      expect(block.broken, weapon).toBeUndefined();
      expect(tickOf(run, block).fighters[1]!.action.kind, weapon).toBe('Block');
      expect(run.final.fighters[1]!.action.kind, weapon).not.toBe('Knockdown');
    }
  });

  it('an Arming Sword (or a Dagger) never breaks it, at any range', () => {
    for (const weapon of ['Arming Sword', 'Dagger']) {
      for (const d of ['Overhead', 'Left', 'Right', 'Thrust'] as Direction[]) {
        for (let distance = 0.5; distance <= 1.8; distance += 0.1) {
          const blocks = events<BlockEvent>(into(tuning, weapon, d, distance), 'Block');
          expect(blocks.every((b) => b.broken === undefined), `${weapon} ${d} ${distance}`).toBe(true);
        }
      }
    }
  });

  it('a Throwing Dagger Blocked by a Dagger never breaks it', () => {
    // A thrown dagger already in flight, 0.6 m short of a Dagger wielder who faces it with a Block up.
    const initial = createInitialState(tuning, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 3 }, facing: Math.PI }], ['Arming Sword', 'Dagger']);
    const thrown = { ...initial, daggers: [{ owner: 0, team: 0, thrownAt: 0, position: { x: 0, y: 1.1, z: 2.4 }, velocity: { x: 0, y: 0, z: 18 }, ticks: 3 }] };
    const run = runScript(tuning, thrown, [[], hold(30, { block: true, direction: 'Overhead', face: Math.PI })], 30);
    const blocked = run.states.find((s) => s.events.some((e) => e.type === 'DaggerBlocked'))!;
    expect(blocked).toBeDefined();
    expect(blocked.fighters[1]!.blockImpact!.strength).toBeLessThan(dagger.blockImpact.breakAt);
    expect(run.states.every((s) => s.fighters[1]!.action.kind !== 'Knockdown')).toBe(true);
  });

  it('no other Weapon has a Block Break: it takes the same blow from the Sledge Hammer without going down', () => {
    for (const defender of Object.keys(tuning.weapons).filter((w) => w !== 'Dagger')) {
      expect(tuning.weapons[defender]!.blockImpact.breakAt, defender).toBe(0);
      const run = into(tuning, 'Sledge Hammer', 'Left', 1.5, defender);
      const blocks = events<BlockEvent>(run, 'Block');
      expect(blocks.length, defender).toBeGreaterThan(0);
      expect(blocks.every((b) => b.broken === undefined), defender).toBe(true);
    }
  });

  it('is deterministic: the same Duel plays out to the same state, break and all', () => {
    const a = into(tuning, 'Sledge Hammer', 'Left', 1.5);
    const b = into(tuning, 'Sledge Hammer', 'Left', 1.5);
    expect(events<BlockEvent>(a, 'Block')[0]!.broken).toBe(true);
    expect(a.states.map((s) => hashState(s))).toEqual(b.states.map((s) => hashState(s)));
  });
});
