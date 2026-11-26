import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena, type AiDifficulty, type TuningData } from '../tuning';
import { attack, createInitialState, hold, wait, whirlwindTimings, type Intent, type SimEvent, type SimState, type Track } from '../sim';
import { aiDifficulty, aiStyle, createAiController, runControllers, scriptedController } from './index';
import { skillOf } from './ai';

const repo = loadTuningData();
const timings = whirlwindTimings(repo);
/** Everything that could distract it from the Whirlwind is off, and its feel knobs too. */
const calm = (extra: Partial<AiDifficulty> = {}): AiDifficulty => ({
  ...aiDifficulty(repo, 'Expert'),
  aggression: 0,
  kickRate: 0,
  throwRate: 0,
  rhythm: 0,
  reactionJitter: 0,
  humanMistakes: 0,
  idleLife: 0,
  jumpStep: 0,
  whirlwindRate: 1,
  ...extra,
});
const reaction = Math.round(aiDifficulty(repo, 'Expert').reactionTime * 60);
const still: Track = wait(1);

/** The AI is Fighter 0 (team 0) at the origin facing +z; the enemies (team 1) are scripted still, the others as `teams` says. */
function play(tuning: TuningData, difficulty: AiDifficulty, others: readonly { x: number; z: number; team: number }[], ticks: number, arena?: string, weapons: readonly string[] = [], track: Track = still) {
  const ai = createAiController(tuning, difficulty);
  const intents: Intent[] = [];
  const recording = {
    intent: (s: SimState, i: number) => {
      const intent = ai.intent(s, i);
      intents.push(intent);
      return intent;
    },
    save: ai.save,
    load: ai.load,
  };
  const placements = [{ position: { x: 0, z: 0 }, facing: 0 }, ...others.map((o) => ({ position: { x: o.x, z: o.z }, facing: Math.atan2(-o.x, -o.z) }))];
  const initial = createInitialState(tuning, 1, placements, weapons, [0, ...others.map((o) => o.team)], arena);
  const run = runControllers(tuning, initial, [recording, ...others.map(() => scriptedController(track))], ticks);
  return { run, intents, ai };
}

// A floor ending at z 2 (the Abyss beyond), running 8 m to the south.
const ledge = parseArena(
  {
    name: 'whirlLedge',
    walk: [
      { id: 'WALK_floor', points: [[-6, 0, -8], [6, 0, -8], [6, 0, 2], [-6, 0, 2]] },
      { id: 'WALK_abyss', abyss: true, points: [[-20, -8, -20], [20, -8, -20], [20, -8, 20], [-20, -8, 20]] },
    ],
    walls: [],
  },
  'whirlLedge',
);
const onLedge: TuningData = { ...repo, arenas: { ...repo.arenas, whirlLedge: ledge } };

const two = [{ x: -0.6, z: 1.1, team: 1 }, { x: 0.6, z: 1.1, team: 1 }];
const begins = (intents: readonly Intent[]) => intents.some((i) => i.whirlwind);

/**
 * What an AI (Fighter 0, no teamwork) sends on the Tick it sees itself in a Whirlwind Wind-up as `action` says, facing `yaw`, with two
 * enemies behind it (-z) and `mates` standing as its teammates: the state is held still over its Reaction Time so it sees it.
 */
function holdIntent(action: { armed: boolean; ticks: number }, yaw: number, mates: readonly { x: number; z: number }[], tuning: TuningData = repo, arena?: string): Intent {
  const placements = [{ position: { x: 0, z: 0 }, facing: yaw }, { position: { x: -0.6, z: -1.1 }, facing: 0 }, { position: { x: 0.6, z: -1.1 }, facing: 0 }, ...mates.map((m) => ({ position: m, facing: 0 }))];
  const initial = createInitialState(tuning, 1, placements, [], [0, 1, 1, ...mates.map(() => 0)], arena);
  const fighters = initial.fighters.map((f, i) => (i === 0 ? { ...f, action: { kind: 'Whirlwind' as const, phase: 'Wind-up' as const, direction: 'Left' as const, ticks: action.ticks, armed: action.armed, turn: 0 } } : f));
  const ai = createAiController(tuning, calm({ whirlwindRate: 0, whirlwindRead: 0, teamwork: 0 }));
  let intent: Intent = ai.intent({ ...initial, fighters }, 0);
  for (let n = 1; n <= reaction; n++) intent = ai.intent({ ...initial, fighters, tick: initial.tick + n }, 0);
  return intent;
}

describe('AI Whirlwind: knobs', () => {
  it('Skilled 0.03/0.7, Expert 0.05/0.9, and none for Beginner, Easy, Normal and Hard', () => {
    const s = skillOf(repo, aiDifficulty(repo, 'Skilled'));
    const e = skillOf(repo, aiDifficulty(repo, 'Expert'));
    expect([s.whirlwindRate, s.whirlwindRead]).toEqual([0.03, 0.7]);
    expect([e.whirlwindRate, e.whirlwindRead]).toEqual([0.05, 0.9]);
    for (const tier of ['Beginner', 'Easy', 'Normal', 'Hard']) {
      const k = skillOf(repo, aiDifficulty(repo, tier));
      expect([k.whirlwindRate, k.whirlwindRead], tier).toEqual([0, 0]);
    }
  });

  it('Aggressive plays 1.6 and Defensive 0.4 of the rate', () => {
    const skilled = aiDifficulty(repo, 'Skilled');
    expect(skillOf(repo, skilled, aiStyle(repo, 'Aggressive')).whirlwindRate).toBeCloseTo(0.03 * 1.6);
    expect(skillOf(repo, skilled, aiStyle(repo, 'Defensive')).whirlwindRate).toBeCloseTo(0.03 * 0.4);
    expect(skillOf(repo, aiDifficulty(repo, 'Normal'), aiStyle(repo, 'Aggressive')).whirlwindRate).toBe(0);
  });
});

describe('AI Whirlwind: using it', () => {
  it('against two still enemies in reach it holds G until armed, lets go and Spins, never crouching or jumping', () => {
    const { run, intents } = play(repo, calm(), two, 200);
    const first = intents.findIndex((i) => i.whirlwind);
    expect(first).toBeGreaterThanOrEqual(0);
    let held = 0;
    while (intents[first + held]?.whirlwind) held++;
    expect(held).toBe(timings.armTicks + 1);
    expect(run.events.some((e) => e.type === 'WhirlwindPhase' && e.fighter === 0 && e.phase === 'Spin')).toBe(true);
    let spinning = 0;
    run.states.forEach((s, k) => {
      const a = s.fighters[0]!.action;
      if (a.kind !== 'Whirlwind' || a.phase === 'Recovery') return;
      if (a.phase === 'Spin') spinning++;
      const i = intents[k];
      if (!i) return;
      expect([i.crouch, i.jump, i.attack, i.block, i.kick, i.throw].map(Boolean), `Tick ${k}`).toEqual([false, false, false, false, false, false]);
    });
    expect(spinning).toBe(timings.spinTicks);
  });

  it('against one standing enemy it does not start', () => {
    expect(begins(play(repo, calm(), [{ x: 0, z: 1.1, team: 1 }], 150).intents)).toBe(false);
  });

  it('against one Staggered or in a Knockdown in reach it does', () => {
    // A second enemy, out of the AI's reach + 1.5, hits the first down (a blow between teammates Staggers too).
    const ai = createAiController(repo, calm());
    const intents: Intent[] = [];
    const recording = { intent: (s: SimState, i: number) => (intents.push(ai.intent(s, i)), intents[intents.length - 1]!) };
    const initial = createInitialState(repo, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 1.5 }, facing: Math.PI }, { position: { x: 0, z: 3.1 }, facing: Math.PI }], [], [0, 1, 1]);
    const run = runControllers(repo, initial, [recording, scriptedController(still), scriptedController(attack('Overhead'))], 150);
    expect(run.states.some((s) => ['Knockdown', 'Stagger'].includes(s.fighters[1]!.action.kind))).toBe(true);
    expect(begins(intents)).toBe(true);
  });
});

describe('AI Whirlwind: when it will not', () => {
  it('an ally within its reach + 1 stops it', () => {
    expect(begins(play(repo, calm(), [...two, { x: 1.2, z: 0.3, team: 0 }], 150).intents)).toBe(false);
    // ...and the same ally further off does not.
    expect(begins(play(repo, calm(), [...two, { x: 0, z: -4, team: 0 }], 150).intents)).toBe(true);
  });

  it('an ally off to the side of the drive path, far from the AI but near the path ahead, stops it', () => {
    const stays = calm({ footwork: 0, pressure: 0, caution: 0 });
    // The drive runs from the AI toward its focus (the enemy at x -0.6, z 1.1, the lower index). An ally 3 m along it and 1.8 m aside
    // stands 3.5 m from the AI (beyond reach + 1) but within reach + 1 of the path; at 3.2 m aside it is clear of both.
    const toward = { x: -0.6 / Math.hypot(0.6, 1.1), z: 1.1 / Math.hypot(0.6, 1.1) };
    const aside = { x: toward.z, z: -toward.x };
    const ally = (side: number) => ({ x: 3 * toward.x + side * aside.x, z: 3 * toward.z + side * aside.z, team: 0 });
    expect(begins(play(repo, stays, [...two, ally(3.2)], 150).intents)).toBe(true);
    expect(begins(play(repo, stays, [...two, ally(1.8)], 150).intents)).toBe(false);
  });


  it('a drive path over an Abyss edge stops it, while the same setup turned toward safe ground starts', () => {
    // It keeps to its spot (no footwork), so the setup is what the test says it is.
    const stays = calm({ footwork: 0, pressure: 0, caution: 0 });
    expect(begins(play(onLedge, stays, two, 150, 'whirlLedge').intents)).toBe(false);
    const behind = two.map((o) => ({ ...o, z: -o.z }));
    expect(begins(play(onLedge, stays, behind, 150, 'whirlLedge').intents)).toBe(true);
  });

  it('a teammate on the drive path stops it even without teamwork', () => {
    const solo = calm({ footwork: 0, pressure: 0, caution: 0, teamwork: 0 });
    const toward = { x: -0.6 / Math.hypot(0.6, 1.1), z: 1.1 / Math.hypot(0.6, 1.1) };
    const ally = (along: number, side: number) => ({ x: along * toward.x + side * toward.z, z: along * toward.z - side * toward.x, team: 0 });
    expect(begins(play(repo, solo, [...two, ally(3, 3.2)], 150).intents)).toBe(true);
    expect(begins(play(repo, solo, [...two, ally(3, 1.8)], 150).intents)).toBe(false);
  });

  it('with its focus on its own spot it checks its drive along its facing', () => {
    const stays = calm({ footwork: 0, pressure: 0, caution: 0, teamwork: 0 });
    // The state is held still over its Reaction Time (the Simulation would push the two apart): its focus stays on its exact spot.
    const facing = (yaw: number) => {
      const placements = [{ position: { x: 0, z: 0 }, facing: yaw }, { position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0.6, z: -1.1 }, facing: 0 }];
      const initial = createInitialState(onLedge, 1, placements, [], [0, 1, 1], 'whirlLedge');
      const ai = createAiController(onLedge, stays);
      const intents: Intent[] = [];
      for (let n = 0; n <= reaction + 3; n++) intents.push(ai.intent({ ...initial, tick: initial.tick + n }, 0));
      return intents;
    };
    // The ledge is 2 m ahead along +z.
    expect(begins(facing(0))).toBe(false);
    expect(begins(facing(Math.PI))).toBe(true);
  });

  it('unarmed, it judges the drive toward its focus (where it is turning), not the bearings it sweeps past: a teammate there cancels it', () => {
    // Its enemies are behind it (-z), on clear ground; the Abyss is 2 m ahead (+z).
    const intentAt = (yaw: number, mates: readonly { x: number; z: number }[] = []) => holdIntent({ armed: false, ticks: 10 }, yaw, mates, onLedge, 'whirlLedge');
    expect(intentAt(0).whirlwind).toBe(true); // still facing the Abyss, but turning to its focus: it holds on
    expect(intentAt(Math.PI).whirlwind).toBe(true);
    expect(intentAt(Math.PI, [{ x: 0, z: -3 }]).whirlwind).toBeFalsy(); // a teammate on the drive toward its focus: it lets go unarmed
  });

  it('armed and turned toward a teammate it keeps holding and turns away; once clear it lets go', () => {
    // Enemies behind it (-z); a teammate at x -3.2, z -2.5 stands on the drive along its facing toward them (yaw ~ -2.64).
    const mate = [{ x: -3.2, z: -2.5 }];
    const blocked = holdIntent({ armed: true, ticks: timings.armTicks }, -2.64, mate);
    expect(blocked.whirlwind).toBe(true);
    expect(blocked.face).toBeDefined();
    expect(Math.abs(Math.atan2(Math.sin(blocked.face! + 2.64), Math.cos(blocked.face! + 2.64)))).toBeGreaterThan(0.5);
    // Facing the way it turned (+90° from the enemies' bearing, away from the mate), the drive is clear: it lets go.
    expect(holdIntent({ armed: true, ticks: timings.armTicks }, blocked.face!, mate).whirlwind).toBeFalsy();
    // Held SPIN_WAIT Ticks armed with the way still blocked, it lets go anyway (a teammate all round it).
    const boxed = [{ x: -3.2, z: -2.5 }, { x: 3.2, z: 2.5 }, { x: 3.2, z: -2.5 }, { x: -3.2, z: 2.5 }, { x: 0, z: -3 }, { x: 0, z: 3 }, { x: 3, z: 0 }, { x: -3, z: 0 }];
    expect(holdIntent({ armed: true, ticks: timings.armTicks }, -2.64, boxed).whirlwind).toBe(true);
    expect(holdIntent({ armed: true, ticks: timings.armTicks + 60 }, -2.64, boxed).whirlwind).toBeFalsy();
  });

  it('a Flail AI never sends whirlwind', () => {
    const { intents } = play(repo, calm(), two, 200, undefined, ['Flail', 'Flail', 'Flail']);
    expect(intents.some((i) => i.whirlwind)).toBe(false);
  });

  it('with whirlwindRate 0 its Intents are those of the same AI without the key (no new draw)', () => {
    const { whirlwindRate: _r, whirlwindRead: _d, ...without } = calm();
    const attacks: Track = [...wait(40), ...attack('Overhead'), ...wait(60), ...attack('Left'), ...wait(60)];
    const off = play(repo, { ...without, aggression: 0.03, kickRate: 0.1, throwRate: 0.05, whirlwindRate: 0, whirlwindRead: 0 }, two, 500, undefined, [], attacks);
    const absent = play(repo, { ...without, aggression: 0.03, kickRate: 0.1, throwRate: 0.05 }, two, 500, undefined, [], attacks);
    expect(off.intents).toEqual(absent.intents);
    expect(begins(off.intents)).toBe(false);
  });
});

describe('AI Whirlwind: steering the Spin', () => {
  /** Plays to the second Tick of a Spin, and returns what its AI sends when the others are seen at `others` (all one Tick later, held there for its Reaction Time). */
  function steer(placed: readonly { x: number; z: number; team: number }[], later: readonly { x: number; z: number }[]): { face: number | null | undefined; heading: number } {
    const { run, ai } = play(repo, calm(), placed, 200);
    const k = run.states.findIndex((s) => s.fighters[0]!.action.kind === 'Whirlwind' && s.fighters[0]!.action.phase === 'Spin');
    expect(k).toBeGreaterThan(0);
    const at = run.states[k + 1]!;
    const self = at.fighters[0]!;
    const heading = (self.action as { heading?: number }).heading!;
    let intent: Intent = ai.intent({ ...at, tick: at.tick }, 0);
    for (let n = 1; n <= reaction + 1; n++) {
      const moved: SimState = { ...at, tick: at.tick + n, fighters: at.fighters.map((f, i) => (i === 0 ? f : { ...f, position: { x: later[i - 1]!.x, z: later[i - 1]!.z } })) };
      intent = ai.intent(moved, 0);
    }
    return { face: intent.face, heading };
  }

  it('toward enemies off to one side', () => {
    const { face, heading } = steer(two, [{ x: 3, z: 0.3 }, { x: 3.5, z: -0.3 }]);
    expect(heading).toBeCloseTo(0, 0);
    expect(face!).toBeCloseTo(Math.PI / 2, 1);
  });

  it('away from an ally ahead of it', () => {
    const { face } = steer([...two, { x: 0, z: -5, team: 0 }], [{ x: 0, z: 4.5 }, { x: 0, z: 4.6 }, { x: 0, z: 1.5 }]);
    expect(Math.cos(face!)).toBeLessThan(0);
  });

  it('with nothing near it keeps its heading', () => {
    const { face, heading } = steer(two, [{ x: 0, z: 40 }, { x: 1, z: 40 }]);
    expect(face!).toBeCloseTo(heading, 6);
  });
});

describe('AI Whirlwind: answering it', () => {
  /** An Expert that answers every Whirlwind it sees, with nothing else on its mind. */
  const reads = (extra: Partial<AiDifficulty> = {}) => calm({ whirlwindRate: 0, whirlwindRead: 1, ...extra });
  const standingReach = repo.ai.attackRange;
  const heldG = (direction: 'Left' | 'Right', face?: number): Track => hold(timings.armTicks + 1, { whirlwind: true, direction, ...(face === undefined ? {} : { face }) });
  const events = <T extends SimEvent['type']>(run: { events: readonly (SimEvent & { tick: number })[] }, type: T) => run.events.filter((e): e is Extract<SimEvent, { type: T }> & { tick: number } => e.type === type);
  const spinStart = (states: readonly SimState[]) => states.findIndex((s) => s.fighters[1]!.action.kind === 'Whirlwind' && s.fighters[1]!.action.phase === 'Spin');

  /** The Duel at the Tick the spinner (Fighter 1, at `at`, facing `face` or the AI) lets go armed: its Spin has just begun, unseen by the AI. */
  function atSpin(at: { x: number; z: number }, direction: 'Left' | 'Right', weapons: readonly string[] = [], face?: number): SimState {
    const placements = [{ position: { x: 0, z: 0 }, facing: 0 }, { position: at, facing: Math.atan2(-at.x, -at.z) }];
    const initial = createInitialState(repo, 1, placements, weapons, [0, 1]);
    const run = runControllers(repo, initial, [scriptedController(wait(1)), scriptedController([...heldG(direction, face), ...wait(400)])], timings.armTicks + 2);
    const k = spinStart(run.states);
    expect(k).toBeGreaterThan(0);
    return run.states[k]!;
  }

  /** The AI (Fighter 0) plays on from `initial`, the spinner letting its Spin run (idle). */
  function playOn(initial: SimState, difficulty: AiDifficulty, ticks: number) {
    const ai = createAiController(repo, difficulty);
    const intents = new Map<number, Intent>();
    const snaps = new Map<number, unknown>();
    const states = new Map<number, SimState>();
    const recording = {
      intent: (s: SimState, i: number) => {
        states.set(s.tick, s);
        snaps.set(s.tick, JSON.parse(JSON.stringify(ai.save())));
        const intent = ai.intent(s, i);
        intents.set(s.tick, intent);
        return intent;
      },
    };
    const run = runControllers(repo, initial, [recording, scriptedController(wait(1))], ticks);
    return { run, intents, snaps, states };
  }

  it('seeing a Spin come, it Blocks the mirrored side facing the spinner, and the turn is Blocked', () => {
    const start = atSpin({ x: 0, z: 3.4 }, 'Left');
    const { run, intents } = playOn(start, reads(), 90);
    const blocks = events(run, 'Block').filter((e) => e.whirlwind && e.defender === 0);
    expect(blocks.length).toBeGreaterThan(0);
    expect(events(run, 'Hit').filter((e) => e.whirlwind && e.defender === 0)).toHaveLength(0);
    // The Block raised for it is the mirrored side (Left spin, Right Block), facing the spinner.
    const raised = [...intents.values()].filter((i) => i.block);
    expect(raised.length).toBeGreaterThan(0);
    for (const i of raised) expect(i.direction).toBe('Right');
    const at = blocks[0]!.tick;
    const me = run.states[at - start.tick]!.fighters[0]!;
    expect(me.action.kind).toBe('Block');
  });

  it('it faces the spinner as it Blocks, and without the read the same Spin Hits it', () => {
    const start = atSpin({ x: 0, z: 3.4 }, 'Right');
    const { run, intents } = playOn(start, reads(), 90);
    for (const i of [...intents.values()].filter((x) => x.block)) {
      expect(i.direction).toBe('Left');
      expect(Math.abs(Math.atan2(Math.sin(i.face! - 0), Math.cos(i.face! - 0)))).toBeLessThan(0.5);
    }
    expect(events(run, 'Block').some((e) => e.whirlwind && e.defender === 0)).toBe(true);
    const blind = playOn(start, reads({ whirlwindRead: 0 }), 90);
    expect(events(blind.run, 'Hit').some((e) => e.whirlwind && e.defender === 0)).toBe(true);
  });

  it('Dumb (defendRate 0, Stage 4 of docs/plans/enemy-behaviours.md) answers no Whirlwind: the same Spin Hits it, read or not', () => {
    const start = atSpin({ x: 0, z: 3.4 }, 'Left');
    const dumb = playOn(start, reads({ defendRate: 0 }), 90);
    expect(events(dumb.run, 'Block').some((e) => e.whirlwind && e.defender === 0)).toBe(false);
    expect(events(dumb.run, 'Hit').some((e) => e.whirlwind && e.defender === 0)).toBe(true);
    expect([...dumb.intents.values()].some((i) => i.block)).toBe(false);
  });

  it('seeing a hold in reach where its Attack lands before arming, it attacks and the hold is broken', () => {
    const { run } = play(repo, reads(), [{ x: 0, z: 1.2, team: 1 }], 150, undefined, [], [...heldG('Left'), ...wait(200)]);
    const hit = events(run, 'Hit').find((e) => e.attacker === 0 && e.defender === 1);
    expect(hit).toBeDefined();
    expect(hit!.tick).toBeLessThan(timings.armTicks);
    expect(events(run, 'WhirlwindPhase').some((e) => e.fighter === 1 && e.phase === 'Spin')).toBe(false);
  });

  it('seeing a hold late, where its Attack cannot land in time, it backs out beyond reach + WHIRL_CLEAR before the Spin begins', () => {
    const late = reads({ reactionTime: 0.5 });
    const { run } = play(repo, late, [{ x: 0, z: -2.6, team: 1 }], 150, undefined, [], [...heldG('Left'), ...wait(200)]);
    expect(events(run, 'Hit').some((e) => e.attacker === 0)).toBe(false);
    const k = spinStart(run.states);
    expect(k).toBeGreaterThan(0);
    // On the last Tick of the hold, before the spinner lets go.
    const me = run.states[k - 1]!.fighters[0]!.position;
    const them = run.states[k - 1]!.fighters[1]!.position;
    expect(Math.hypot(me.x - them.x, me.z - them.z)).toBeGreaterThanOrEqual(standingReach + 1.5);
  });

  it('with a Thrust reaching past the spinner\'s blade it Thrusts and the Spin ends', () => {
    // A Halberd against an Arming Sword's spinner, the spinner standing in its Thrust reach (but out of the sword's), driving off to the side.
    const start = atSpin({ x: 0, z: 1.8 }, 'Left', ['Halberd', 'Arming Sword'], -Math.PI / 2);
    const { run, intents } = playOn(start, reads(), 90);
    expect([...intents.values()].some((i) => i.attack && i.direction === 'Thrust')).toBe(true);
    const staggered = run.states.findIndex((s) => s.fighters[1]!.action.kind === 'Stagger' || s.fighters[1]!.action.kind === 'Knockdown');
    expect(staggered).toBeGreaterThan(0);
    expect(run.states.slice(staggered).every((s) => !(s.fighters[1]!.action.kind === 'Whirlwind' && s.fighters[1]!.action.phase === 'Spin'))).toBe(true);
  });

  it('with whirlwindRead 0 it answers nothing: its Intents are those with the key absent', () => {
    const { whirlwindRead: _d, ...without } = reads();
    const track: Track = [...heldG('Left'), ...wait(200)];
    const off = play(repo, reads({ whirlwindRead: 0 }), [{ x: 0, z: 1.2, team: 1 }], 200, undefined, [], track);
    const absent = play(repo, without, [{ x: 0, z: 1.2, team: 1 }], 200, undefined, [], track);
    expect(off.intents).toEqual(absent.intents);
    expect(events(off.run, 'Hit').some((e) => e.attacker === 0)).toBe(false);
  });

  it('its memory round-trips through save()/load() mid-answer, and one that never met a Whirlwind has no whirlReads', () => {
    const start = atSpin({ x: 0, z: 3.4 }, 'Left');
    const { intents, snaps, states } = playOn(start, reads(), 60);
    const mid = start.tick + 20;
    const saved = snaps.get(mid) as Record<string, unknown>;
    expect(saved.whirlReads).toHaveLength(1);
    const again = createAiController(repo, reads());
    again.load!(saved);
    // The same Ticks from the same states give the same Intents.
    for (let t = mid; t < mid + 30; t++) expect(again.intent(states.get(t)!, 0), `Tick ${t}`).toEqual(intents.get(t));
    const calmRun = playOn(createInitialState(repo, 1, [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: 0, z: 3 }, facing: Math.PI }], [], [0, 1]), reads(), 40);
    for (const m of calmRun.snaps.values()) expect('whirlReads' in (m as object)).toBe(false);
  });

  it('one roll per spinner and phase: two enemies holding G at equal distance never re-roll', () => {
    const rolls = new Map<string, boolean>();
    let flips = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ai = createAiController(repo, reads({ whirlwindRead: 0.5 }));
      const rec = {
        intent: (s: SimState, i: number) => {
          const intent = ai.intent(s, i);
          const saved = ai.save!() as { whirlReads?: { fighter: number; phase: string; since: number; read: boolean }[] };
          const entries = saved.whirlReads ?? [];
          expect(new Set(entries.map((e) => e.fighter)).size).toBe(entries.length);
          for (const e of entries) {
            const key = `${seed}:${e.fighter}:${e.phase}:${e.since}`;
            if (rolls.has(key) && rolls.get(key) !== e.read) flips++;
            rolls.set(key, e.read);
          }
          return intent;
        },
      };
      const placements = [{ position: { x: 0, z: 0 }, facing: 0 }, { position: { x: -0.8, z: 1.6 }, facing: 0 }, { position: { x: 0.8, z: 1.6 }, facing: 0 }];
      const initial = createInitialState(repo, seed, placements, [], [0, 1, 1]);
      runControllers(repo, initial, [rec, scriptedController([...heldG('Left'), ...wait(200)]), scriptedController([...heldG('Right'), ...wait(200)])], 150);
    }
    expect(rolls.size).toBeGreaterThan(0);
    expect(flips).toBe(0);
    // One Wind-up roll per spinner per seed, however often the nearer of the two changes.
    const windUps = [...rolls.keys()].filter((k) => k.includes(':Wind-up:'));
    expect(new Set(windUps.map((k) => k.split(':').slice(0, 2).join(':'))).size).toBe(windUps.length);
  });
});

describe('AI Whirlwind: a Showoff (whirlwindAlone) at a lone enemy', () => {
  const one = [{ x: 0, z: 1.1, team: 1 }];
  const showoff = (extra: Partial<AiDifficulty> = {}) => calm({ whirlwindAlone: 1, footwork: 0, pressure: 0, caution: 0, teamwork: 0, ...extra });

  it('the Showoff Style gives every tier a Whirlwind, at a lone enemy too', () => {
    for (const tier of ['Beginner', 'Skilled', 'Expert']) {
      const s = skillOf(repo, aiDifficulty(repo, tier), aiStyle(repo, 'Showoff'));
      expect(s.whirlwindRate, tier).toBeGreaterThanOrEqual(0.03);
      expect(s.whirlwindAlone, tier).toBe(0.5);
    }
    expect(skillOf(repo, aiDifficulty(repo, 'Expert')).whirlwindAlone).toBe(0);
  });

  it('against one standing enemy in reach it starts, where the same AI without it does not', () => {
    expect(begins(play(repo, showoff(), one, 150).intents)).toBe(true);
    expect(begins(play(repo, showoff({ whirlwindAlone: 0 }), one, 150).intents)).toBe(false);
  });

  it('never toward a drop: a lone enemy toward the Abyss stops it, the same one on safe ground does not', () => {
    expect(begins(play(onLedge, showoff(), one, 150, 'whirlLedge').intents)).toBe(false);
    expect(begins(play(onLedge, showoff(), [{ x: 0, z: -1.1, team: 1 }], 150, 'whirlLedge').intents)).toBe(true);
  });

  it('never through a teammate: one on the drive path, or within its reach + 1, stops it', () => {
    expect(begins(play(repo, showoff(), [...one, { x: 0, z: 3, team: 0 }], 150).intents)).toBe(false);
    expect(begins(play(repo, showoff(), [...one, { x: 1.2, z: 0.3, team: 0 }], 150).intents)).toBe(false);
    expect(begins(play(repo, showoff(), [...one, { x: 0, z: -4, team: 0 }], 150).intents)).toBe(true);
  });
});
