/**
 * docs/plans/big-battle.md, Stage 6: a Battle on the wire. Its options in a hello, and its whole state in a resync: the Fighter Pool, the
 * Crowd, each Pool slot's binding and each Pool AI's memory, a Player's takeover of a Soldier and a Player who left.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData, type TuningData } from '../tuning';
import { createBattlePilot, lineupAis, lineupMatch, type Lineup } from '../controllers';
import { createMatch, hashValue, stepMatch, takeOverFighter, type MatchState } from '../sim';
import { isFormatOnMap, isLobbyFormatOnMap, parseNetMessage } from './messages';

const tuning = loadTuningData();
/** Two small armies close together, so a whole Battle is quick. */
const small: TuningData = { ...tuning, battle: { ...tuning.battle, armySize: 40, deploy: { ...tuning.battle.deploy, front: 10, perRank: 10 } } };
const LINEUP: Lineup = [
  { team: 0, pilot: { kind: 'Player', player: 0 } },
  { team: 1, pilot: { kind: 'Player', player: 1 } },
];
const MATCH = { format: 'Battle', bestOf: 1, seed: 5 } as const;

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Sample {
  readonly state: MatchState;
  readonly ai: readonly unknown[];
}

/**
 * A small Battle's states every 30 Ticks, each with every Pool slot's AI memory, as a host would send them: its Players on a Battle
 * autopilot. At Tick 600 Player 0's Fighter falls (so it later takes over a Soldier), and at Tick 900 Player 1 leaves (an AI Takeover).
 */
const samples: readonly Sample[] = (() => {
  const ais = lineupAis(small, LINEUP, 'Battle', MATCH);
  const pilots = [createBattlePilot(small, 'Hard'), createBattlePilot(small, 'Hard')];
  let m = createMatch(small, lineupMatch(small, LINEUP, ['Longsword', 'Halberd'], MATCH));
  const out: Sample[] = [];
  for (let t = 1; t <= 1500 && m.status.status === 'InProgress'; t++) {
    if (t === 600) m = { ...m, duel: { ...m.duel, fighters: m.duel.fighters.map((f, k) => (k === 0 ? { ...f, hp: 0, death: { tick: m.duel.tick, cause: 'Hit', blow: null } } : f)) } };
    if (t === 900) m = takeOverFighter(m, 1);
    const intents = ais.map((ai, k) => (ai ?? pilots[k]!).intent(m.duel, k));
    m = stepMatch(m, intents, small);
    if (t % 30 === 0) out.push({ state: wire(m), ai: wire(ais.map((ai) => ai?.save?.() ?? null)) });
  }
  return out;
})();

const resync = (s: Sample, state: unknown = s.state, ai: readonly unknown[] = s.ai) => ({ type: 'resync', tick: s.state.tick, state, ai, streams: [] });
/** A sample with several Pool slots bound. */
const busy = () => samples.find((s) => s.state.duel.fighters.filter((f) => f.soldier).length >= 3)!;

describe('A Battle on the wire (docs/plans/big-battle.md, Stage 6)', () => {
  it('a hello may carry a Battle, of one to four Players, on a Battlefield only; the Lobby holds one on any Map (Stage 7)', () => {
    const hello = { type: 'hello', protocol: 1, tuningHash: 'abcd1234' };
    for (const match of [{ bestOf: 1, format: 'Battle' }, { bestOf: 1, format: 'Battle', arena: 'battle:7', seed: 7 }, { bestOf: 1, format: 'Battle', weapons: ['Halberd'], teams: [1] }]) {
      expect(parseNetMessage({ ...hello, match }), JSON.stringify(match)).toEqual({ ...hello, match });
    }
    const four = [0, 1, 0, 1].map((team, player) => ({ team, pilot: { kind: 'Player', player } }));
    expect(parseNetMessage({ ...hello, match: { bestOf: 1, format: 'Battle' }, lineup: four })).not.toBeNull();
    expect(parseNetMessage({ ...hello, lineup: [four[0]] })).not.toBeNull();
    expect(parseNetMessage({ ...hello, match: { bestOf: 1, format: 'Battle', arena: 'circle' } })).toBeNull();
    expect(parseNetMessage({ ...hello, match: { bestOf: 1, format: 'Battle', arena: 'gen:greybox:3' } })).toBeNull();
    expect(isFormatOnMap('Battle', undefined)).toBe(false);
    expect(isFormatOnMap('Duels', 'circle')).toBe(true);
    // The Lobby sets the Map aside for a Battle (it names its Battlefield from its seed at the start), and judges the rest as before.
    expect(isLobbyFormatOnMap('Battle', 'circle')).toBe(true);
    expect(isLobbyFormatOnMap('Battle', 'gen:greybox:3')).toBe(true);
    expect(isLobbyFormatOnMap('Gauntlet', 'circle')).toBe(false);
    expect(isLobbyFormatOnMap('Siege', 'circle')).toBe(false);
  });

  it("accepts every state of a Battle as a resync with its Pool AIs' memory, through JSON, which keeps its hash", () => {
    expect(samples.length).toBeGreaterThan(30);
    for (const s of samples) {
      expect(parseNetMessage(resync(s)), `Tick ${s.state.tick}`).toEqual(resync(s));
      expect(hashValue(wire(s.state)), `Tick ${s.state.tick}`).toBe(hashValue(s.state));
    }
    // What the samples hold: every role, bound Pool AIs' memory, a takeover of a Soldier, a Player who left.
    const fighters = samples.flatMap((s) => s.state.duel.fighters);
    for (const role of ['Attack', 'Ally', 'Waiting']) expect(fighters.some((f) => f.soldier?.role === role), role).toBe(true);
    expect(samples.some((s) => s.ai.some((m) => m !== null && typeof m === 'object' && 'bound' in m))).toBe(true);
    const last = samples.at(-1)!.state.duel.crowd!;
    expect(last.players[0]!.soldier).toBeGreaterThanOrEqual(0);
    expect(last.slot[last.players[0]!.soldier]).toBe(0);
    expect(last.players[0]!.taken).toBe(1);
    expect(last.players[1]!.away).toBe(true);
  });

  it("refuses a Crowd whose arrays disagree, hold what they can't, or point out of range", () => {
    const s = busy();
    const crowd = s.state.duel.crowd!;
    const n = crowd.x.length;
    const bad = [
      { x: crowd.x.slice(1) },
      { hp: [...crowd.hp.slice(1), 'x'] },
      { team: [2, ...crowd.team.slice(1)] },
      { alive: [0.5, ...crowd.alive.slice(1)] },
      { engage: [-1, ...crowd.engage.slice(1)] },
      { target: [n, ...crowd.target.slice(1)] },
      { slot: [s.state.duel.fighters.length, ...crowd.slot.slice(1)] },
      // The Squads: a Soldier's Squad and place in range, every per-Squad array whole and holding what it may.
      { squad: [crowd.squads.team.length, ...crowd.squad.slice(1)] },
      { place: [-1, ...crowd.place.slice(1)] },
      { place: [64, ...crowd.place.slice(1)] },
      { squads: undefined },
      { squads: { ...crowd.squads, x: crowd.squads.x.slice(1) } },
      { squads: { ...crowd.squads, shape: [3, ...crowd.squads.shape.slice(1)] } },
      { squads: { ...crowd.squads, fall: [2, ...crowd.squads.fall.slice(1)] } },
      { squads: { ...crowd.squads, living: [65, ...crowd.squads.living.slice(1)] } },
      { squads: { ...crowd.squads, team: crowd.squads.team.map(() => 0) } },
      { rng: { seed: 'x' } },
      { rout: { team: 3, tick: 1 } },
      { players: [] },
      { players: [{ ...crowd.players[0], soldier: n }, crowd.players[1]] },
      { players: [{ ...crowd.players[0], away: false }, crowd.players[1]] },
      { players: [{ ...crowd.players[0], corpse: 99 }, crowd.players[1]] },
    ];
    for (const edit of bad) {
      const state = { ...s.state, duel: { ...s.state.duel, crowd: { ...crowd, ...edit } } };
      expect(parseNetMessage(resync(s, state)), JSON.stringify(edit).slice(0, 60)).toBeNull();
    }
  });

  it('refuses a Pool and a Crowd that disagree on who is bound where, and a Battle without its Crowd or a Duel with one', () => {
    const s = busy();
    const { fighters, crowd } = s.state.duel;
    const k = fighters.findIndex((f) => f.soldier);
    const index = fighters[k]!.soldier!.index;
    const withFighter = (f: object) => ({ ...s.state, duel: { ...s.state.duel, fighters: fighters.map((g, i) => (i === k ? { ...g, ...f } : g)) } });
    const free = crowd!.x.findIndex((_, i) => crowd!.slot[i] === -1);
    const unbound = fighters.findIndex((f, i) => i >= 2 && !f.soldier);
    for (const state of [
      withFighter({ soldier: { ...fighters[k]!.soldier, index: free } }),
      withFighter({ soldier: { ...fighters[k]!.soldier, role: 'Boss' } }),
      withFighter({ soldier: { ...fighters[k]!.soldier, since: -1 } }),
      { ...s.state, duel: { ...s.state.duel, fighters: fighters.map((f, i) => (i === 0 ? { ...f, soldier: { index: free, since: 1, role: 'Attack' } } : f)) } },
      { ...s.state, duel: { ...s.state.duel, crowd: { ...crowd!, slot: crowd!.slot.map((v, i) => (i === index ? unbound : v)) } } },
      { ...s.state, duel: { ...s.state.duel, crowd: { ...crowd!, slot: crowd!.slot.map((v, i) => (i === free ? 1 : v)) } } },
      { ...s.state, duel: { ...s.state.duel, crowd: undefined } },
      { ...s.state, config: { ...s.state.config, rematchTicks: 60 } },
      { ...s.state, duel: { ...s.state.duel, fighters: [...fighters, ...new Array(64).fill(fighters.at(-1))] } },
    ]) {
      expect(parseNetMessage(resync(s, state, state.duel.fighters.map(() => null)))).toBeNull();
    }
    const duel = createMatch(tuning, { bestOf: 1, seed: 3 });
    expect(parseNetMessage({ type: 'resync', tick: 0, state: wire({ ...duel, duel: { ...duel.duel, crowd } }), ai: [null, null], streams: [] })).toBeNull();
  });

  it("refuses a malformed Pool AI memory", () => {
    const s = busy();
    const k = s.ai.findIndex((m) => m !== null && typeof m === 'object' && 'bound' in m);
    const good = s.ai[k] as { bound: object; memory: object };
    for (const bad of [{ bound: good.bound }, { ...good, bound: { ...good.bound, role: 'Boss' } }, { ...good, memory: {} }, { ...good, extra: 1 }]) {
      expect(parseNetMessage(resync(s, s.state, s.ai.map((m, i) => (i === k ? bad : m)))), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
  });
});
