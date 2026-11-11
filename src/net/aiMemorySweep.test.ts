/**
 * docs/plans/flail.md, Stage 6: every AI memory a real AI reaches is one the resync validator accepts. Each scenario runs AIs
 * through what fills their memory (jump Links on the summit, a Link given up, daggers thrown both ways, a Landing punished, a
 * leaping Attack, spins and Back plans, Duels between the tiers, a Gauntlet Run, a Battle) and checks every AI's memory on every
 * Tick, as a host would send it in a resync. A coverage check last: the scenarios must have reached each field the validator checks,
 * so the sweep cannot pass by never exercising one.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type TuningData } from '../tuning';
import { createBattlePilot, createAiController, DEFENCE_KINDS, JUMP_STAGES, AI_MODES, aiDifficulty, FLOOR_DIFFICULTY, lineupAis, lineupMatch, scriptedController, type Controller, type Lineup } from '../controllers';
import { createInitialState, createMatch, duelPlacements, hold, IDLE_INTENT, MAX_TEAM_SIZE, step, stepMatch, wait, walk, type Intent, type MatchState, type SimState } from '../sim';
import { isAiMemory, isHallAiMemory, isPoolAiMemory } from './messages';

const tuning = loadTuningData();
type Memory = Record<string, any>;
const wire = (v: unknown): any => JSON.parse(JSON.stringify(v));

/** What the scenarios reached, across every memory checked. */
const reached = new Set<string>();
function note(m: Memory): void {
  const d = m.defencePlan;
  if (d) {
    reached.add(`defence:${d.kind}`);
    if (d.spinRead !== undefined) reached.add('defence.spinRead');
    if (d.holdBreak !== undefined) reached.add('defence.holdBreak');
    if (d.raiseAt !== undefined) reached.add('defence.raiseAt');
    if (d.reads !== undefined) reached.add('defence.reads');
  }
  const a = m.attackPlan;
  if (a) {
    reached.add('attackPlan');
    if (a.holdJumpUntil >= 0) reached.add('attackPlan.holdJumpUntil');
    if (a.spin !== undefined) reached.add('attackPlan.spin');
    if (a.double !== undefined) reached.add('attackPlan.double');
    if (a.chain !== null) reached.add('attackPlan.chain');
  }
  if (m.feintPlan) reached.add('feintPlan');
  if (m.throwPlan) reached.add('throwPlan');
  if (m.aimError !== 0) reached.add('aimError');
  if (m.jumpRun) reached.add(`jumpRun:${m.jumpRun.stage}`);
  if (m.jumpRun?.escape) reached.add('jumpRun.escape');
  if (m.failedJumps.length > 0) reached.add('failedJumps');
  if (m.landing) reached.add('landing');
  if (m.route?.links) reached.add('route.links');
  reached.add(`mode:${m.tactic.mode}`);
  if (m.opening) reached.add('opening');
  if (m.focus) reached.add('focus');
  if (m.beat) reached.add('beat');
  if (m.jitter) reached.add('jitter');
  for (const o of m.seen) {
    for (const f of o.fighters) {
      if (f.airStart !== null) reached.add('sighting.airStart');
      if (f.size !== undefined) reached.add('sighting.size');
      if (f.sheathed) reached.add('sighting.sheathed');
      if ((f.action as Memory).charge !== undefined) reached.add('sighting.charge');
    }
  }
}

/** The first failing check of `m`, for the failure message (the validator itself only says yes or no). */
function why(m: Memory): string {
  for (const key of Object.keys(m)) {
    const blanked = { ...m };
    // Swap in a known-good value from a fresh AI: if the memory passes then, this field is the one refused.
    const fresh = wire(createAiController(tuning, 'Normal').save!()) as Memory;
    blanked[key] = fresh[key];
    if (isAiMemory(blanked)) return `${key}: ${JSON.stringify(m[key]).slice(0, 400)}`;
  }
  return JSON.stringify(m).slice(0, 400);
}

function check(label: string, tick: number, m: unknown): void {
  const memory = wire(m) as Memory;
  if (!isAiMemory(memory)) expect.fail(`${label}, Tick ${tick}: refused ${why(memory)}`);
  note(memory);
}

/** Steps `initial` with `controllers`, checking each AI's memory (the ones in `ais`) every Tick. */
function sweep(label: string, t: TuningData, initial: SimState, controllers: Controller[], ais: Controller[], ticks: number, drive?: (i: number, intent: Intent) => Intent): void {
  let s = initial;
  for (let k = 0; k < ticks; k++) {
    const intents = controllers.map((c, i) => (drive ?? ((_: number, x: Intent) => x))(i, c.intent(s, i)));
    s = step(s, intents, t);
    for (const ai of ais) check(label, s.tick, ai.save!());
  }
}

const sharp = { reactionTime: 0.1, mistakeRate: 0, feintRate: 0 };
const summit = (seed: number, me: [number, number, number], it: [number, number, number]) =>
  createInitialState(tuning, seed, [me, it].map(([x, y, z]) => ({ position: { x, z }, y, facing: 0 })), [], [0, 1], 'summit');

describe('Every AI memory a real AI reaches passes the resync validator (docs/plans/flail.md, Stage 6)', { timeout: 300_000 }, () => {
  it('jump Links on the summit: lined up, run in, flown, and given up', () => {
    for (const [seed, difficulty] of [[1, 'Normal'], [2, 'Hard'], [3, 'Expert']] as const) {
      const ai = createAiController(tuning, difficulty);
      sweep(`summit chase ${difficulty}`, tuning, summit(seed, [0, 2, -8], [3, 2.5, -4.1]), [ai, scriptedController(wait(1))], [ai], 900);
    }
    // Held where it stands, it never gets airborne and gives the Link up at its deadline.
    const held = createAiController(tuning, 'Normal');
    sweep('summit held', tuning, summit(1, [0, 2, -8], [3, 2.5, -4.1]), [held, scriptedController(wait(1))], [held], 400, (i, x) => (i === 0 ? IDLE_INTENT : x));
  });

  it('a jump to get away (an escape Link), and an enemy that Sheathes', () => {
    // A floor with a 1 m lid walled up to its top; the AI, low on HP so it Disengages, just south of it, pressed from further south.
    const lid = parseArena(
      {
        name: 'lid',
        walk: [
          { id: 'WALK_floor', points: [[-10, 0, -10], [10, 0, -10], [10, 0, 20], [-10, 0, 20]] },
          { id: 'WALK_lid', points: [[-3, 1, 3], [3, 1, 3], [3, 1, 7], [-3, 1, 7]] },
        ],
        walls: [
          { id: 'WALL_s', a: [-3, 3], b: [3, 3], bottom: 0, top: 1 },
          { id: 'WALL_e', a: [3, 3], b: [3, 7], bottom: 0, top: 1 },
          { id: 'WALL_n', a: [3, 7], b: [-3, 7], bottom: 0, top: 1 },
          { id: 'WALL_w', a: [-3, 7], b: [-3, 3], bottom: 0, top: 1 },
        ],
      },
      'lid',
    );
    const t: TuningData = { ...tuning, fighter: { ...tuning.fighter, maxHp: 1e9 }, arenas: { ...tuning.arenas, lid } };
    const placed = createInitialState(t, 3, [{ position: { x: 0, z: 2.1 }, facing: Math.PI }, { position: { x: 0, z: 0.9 }, facing: 0 }], [], [0, 1], 'lid');
    const initial = { ...placed, fighters: placed.fighters.map((f, i) => (i === 0 ? { ...f, hp: 0.2 * t.fighter.maxHp } : f)) };
    const wary = { ...aiDifficulty(tuning, 'Hard'), caution: 1, pressure: 0, aggression: 0, jumpAttackRate: 0, throwRate: 0, kickRate: 0 };
    const runner = createAiController(t, wary);
    sweep('escape', t, initial, [runner, scriptedController(wait(1))], [runner], 600);
    // An enemy that Sheathes and Draws in front of it.
    const watcher = createAiController(tuning, 'Hard');
    const sheathes = scriptedController([...wait(20), ...hold(1, { sheathe: true }), ...wait(120), ...hold(1, { sheathe: true }), ...wait(60)]);
    sweep('sheathed', tuning, createInitialState(tuning, 1, duelPlacements(4)), [sheathes, watcher], [watcher], 200);
  });

  it('daggers: its own throws (with aim mistakes) and a throw at it', () => {
    const thrower: TuningData = { ...tuning, ai: { ...tuning.ai, aggression: 0, kickRate: 0, throwRate: 0.5 } };
    for (const seed of [1, 7]) {
      const ai = createAiController(thrower, { ...sharp, mistakeRate: 0.3, throwRate: 0.5 });
      const initial = createInitialState(thrower, seed, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 5 }, facing: Math.PI }]);
      sweep(`thrower seed ${seed}`, thrower, initial, [ai, scriptedController(walk(800, { x: 0, z: 1 }))], [ai], 800);
    }
    const catcher: TuningData = { ...tuning, ai: { ...tuning.ai, aggression: 0, kickRate: 0, throwRate: 0 } };
    const ai = createAiController(catcher, sharp);
    const initial = createInitialState(catcher, 1, [{ position: { x: -0.2, z: 0 }, facing: 0 }, { position: { x: 0, z: 8 }, facing: Math.PI }]);
    sweep('catcher', catcher, initial, [scriptedController([...wait(10), ...hold(1, { throw: true }), ...wait(200)]), ai], [ai], 200);
  });

  it('jumps in a fight: a Landing punished and a leaping Attack', () => {
    const tough: TuningData = { ...tuning, fighter: { ...tuning.fighter, maxHp: 1e9 }, ai: { ...tuning.ai, kickRate: 0, throwRate: 0 } };
    const toward = { x: 0, z: -1 };
    const jumps = Array.from({ length: 4 }, () => [...wait(40), { ticks: 1, intent: { ...IDLE_INTENT, move: toward, jump: true } }, { ticks: 30, intent: { ...IDLE_INTENT, move: toward } }]).flat();
    for (const seed of [1, 2, 3]) {
      const ai = createAiController(tough, { ...aiDifficulty(tuning, 'Hard'), throwRate: 0, kickRate: 0 });
      const initial = createInitialState(tough, seed, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 4 }, facing: Math.PI }]);
      sweep(`landing seed ${seed}`, tough, initial, [ai, scriptedController([...jumps, ...wait(60)])], [ai], 400);
    }
    const eager: TuningData = { ...tough, ai: { ...tough.ai, kickRate: 0 } };
    const leaper = createAiController(eager, { ...sharp, footwork: 0.5, aggression: 0, jumpAttackRate: 0.05 });
    sweep('leaper', eager, createInitialState(eager, 3, duelPlacements(3.5)), [scriptedController(wait(1)), leaper], [leaper], 600);
  });

  it('Duels between AIs of every tier, with and without a Flail', () => {
    const pairs: [string, string, string, string][] = [
      ['Expert', 'Flail', 'Expert', 'Longsword'],
      ['Expert', 'Flail', 'Expert', 'Flail'],
      ['Skilled', 'Flail', 'Beginner', 'Arming Sword'],
      ['Hard', 'Halberd', 'Normal', 'Sledge Hammer'],
      ['Easy', 'Arming Sword', 'Expert', 'Halberd'],
    ];
    for (const [da, wa, db, wb] of pairs) {
      for (const seed of [1, 2]) {
        const ais = [createAiController(tuning, da), createAiController(tuning, db)];
        let m: MatchState = createMatch(tuning, { bestOf: 3, seed, distance: 3, weapons: [wa, wb] });
        for (let k = 0; k < 1500 && m.status.status === 'InProgress'; k++) {
          m = stepMatch(m, ais.map((ai, i) => ai.intent(m.duel, i)), tuning);
          for (const ai of ais) check(`${da} ${wa} v ${db} ${wb} seed ${seed}`, m.duel.tick, ai.save!());
        }
      }
    }
  });

  it('a Gauntlet Run: its Hall AIs', () => {
    const lineup: Lineup = [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      ...Array.from({ length: MAX_TEAM_SIZE }, () => ({ team: 1, pilot: { kind: 'AI', difficulty: FLOOR_DIFFICULTY } }) as const),
    ];
    const ais = lineupAis(tuning, lineup, 'Gauntlet');
    let m = createMatch(tuning, lineupMatch(tuning, lineup, ['Flail'], { bestOf: 1, arena: 'gen:greybox:4242', seed: 3, format: 'Gauntlet' }));
    for (let k = 0; k < 900 && m.status.status === 'InProgress'; k++) {
      m = stepMatch(m, lineup.map((s, i) => (s.pilot.kind === 'AI' ? ais[i]!.intent(m.duel, i) : IDLE_INTENT)), tuning);
      for (const ai of ais) {
        if (!ai?.save) continue;
        const saved = wire(ai.save());
        if (!isHallAiMemory(saved)) expect.fail(`Gauntlet, Tick ${m.duel.tick}: refused ${saved.memory ? why(saved.memory) : JSON.stringify(saved).slice(0, 200)}`);
        if (saved.memory) note(saved.memory);
      }
    }
  });

  it("a Battle: its Pool AIs", () => {
    const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
    const lineup: Lineup = [
      { team: 0, pilot: { kind: 'Player', player: 0 } },
      { team: 1, pilot: { kind: 'Player', player: 1 } },
    ];
    const match = { format: 'Battle', bestOf: 1, seed: 5 } as const;
    const ais = lineupAis(small, lineup, 'Battle', match);
    const pilots = [createBattlePilot(small, 'Hard'), createBattlePilot(small, 'Hard')];
    let m = createMatch(small, lineupMatch(small, lineup, ['Flail', 'Halberd'], match));
    for (let k = 0; k < 700 && m.status.status === 'InProgress'; k++) {
      m = stepMatch(m, ais.map((ai, i) => (ai ?? pilots[i]!).intent(m.duel, i)), small);
      for (const ai of ais) {
        const saved = ai?.save ? wire(ai.save()) : null;
        if (saved === null) continue;
        if (!isPoolAiMemory(saved)) expect.fail(`Battle, Tick ${m.duel.tick}: refused ${saved.memory ? why(saved.memory) : JSON.stringify(saved).slice(0, 200)}`);
        note(saved.memory);
      }
    }
  });

  it('the scenarios reached every field the validator checks', () => {
    console.log(`reached: ${[...reached].sort().join(', ')}`);
    const wanted = [
      ...DEFENCE_KINDS.map((k) => `defence:${k}`),
      ...JUMP_STAGES.map((s) => `jumpRun:${s}`),
      ...AI_MODES.map((m) => `mode:${m}`),
      'defence.spinRead',
      'attackPlan.holdJumpUntil',
      'attackPlan.spin',
      'feintPlan',
      'throwPlan',
      'aimError',
      'failedJumps',
      'landing',
      'route.links',
      'jumpRun.escape',
      'sighting.airStart',
      'sighting.charge',
      'sighting.sheathed',
      'sighting.size',
    ];
    expect(wanted.filter((w) => !reached.has(w))).toEqual([]);
  });
});
