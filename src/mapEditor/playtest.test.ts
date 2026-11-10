/**
 * docs/plans/map-editor.md, Stage 4: a draft is play-tested from memory (compiled into a copy of the Tuning Data), and every cache the
 * Simulation keeps (the Battlefield, the destination fields, the Fighters' navmesh) is built afresh for a changed draft of the same name, so the
 * second play-test of an edit-play-edit-play cycle shows the second edit. The stuck measure and the Quick check are deterministic.
 */
import { describe, expect, it } from 'vitest';
import { loadTuningData } from '../tuning';
import { battleMapOf, battlefieldOf, createMatch, navMesh, stepMatch } from '../sim';
import { draftTuning } from './playtest';
import { formatQuickCheck, QuickBattle, quickCheck, summarise } from './quickCheck';
import { quickCheckSource } from './quickCheckCli';
import { sampleSource } from './sample.testdata';
import { MapEditorSession, sourceFileText } from './session';
import { StuckMeter } from './stuck';
import { MapCompileError } from './compile';

const base = loadTuningData();
const NAME = 'sample';
const ARENA = `battle:${NAME}`;

/** The sample, then the same map with its Objective C dragged 12 m along the bridge (what the editor's session does to it). */
function twoDrafts() {
  const session = new MapEditorSession(sampleSource());
  const first = session.source;
  session.level = 4;
  session.moveMarker({ kind: 'objective', id: 'C' }, -12, 0);
  return { first, second: session.source };
}

describe('a draft in a copy of the Tuning Data', () => {
  it('holds the compiled map under its name, leaves the Tuning Data it came from alone, and sizes the armies as the Lobby does', () => {
    const draft = draftTuning(sampleSource(), base);
    expect(draft.tuning).not.toBe(base);
    expect(draft.tuning.battle).not.toBe(base.battle);
    expect(draft.tuning.battle.maps[NAME]).toBe(draft.compiled);
    expect(base.battle.maps[NAME]).toBeUndefined();
    expect(Object.keys(draft.tuning.battle.maps)).toEqual([...Object.keys(base.battle.maps), NAME]);
    expect(draft.tuning.battle.armySize).toBe(draft.compiled.armySize.standard);
    expect(draftTuning(sampleSource(), base, { armySize: 30 }).tuning.battle.armySize).toBe(30);
    // The shipped maps and everything else are the very same objects.
    expect(draft.tuning.battle.maps.fort).toBe(base.battle.maps.fort);
    expect(draft.tuning.arenas).toBe(base.arenas);
  });

  it('refuses a name a shipped map’s model is drawn for, so the draft is never drawn as another map', () => {
    expect(() => draftTuning({ ...sampleSource(), name: 'fort' }, base)).toThrow(/shipped map/);
  });

  it("refuses a source the compiler refuses, naming its Brush, as Save does", () => {
    const s = sampleSource();
    const lost = { ...s, brushes: s.brushes.filter((b) => b.kind !== 'ramp') };
    expect(() => draftTuning(lost, base)).toThrow(MapCompileError);
  });

  it('is played by the existing Battle routes: a Battle on it starts, and steps', () => {
    const { tuning } = draftTuning(sampleSource(), base, { armySize: 24 });
    let m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: ARENA });
    expect(m.duel.crowd!.x.length).toBe(48);
    for (let i = 0; i < 300; i++) m = stepMatch(m, [], tuning);
    expect(m.status.status).toBe('InProgress');
  });
});

describe('the caches rebuild for a changed draft of the same name', () => {
  const { first, second } = twoDrafts();
  const a = draftTuning(first, base, { armySize: 24 });
  const b = draftTuning(second, base, { armySize: 24 });

  it('builds the Battlefield, the destination fields and the navmesh again, and keeps each draft’s own', () => {
    const fa = battlefieldOf(a.tuning.battle, ARENA)!;
    const fb = battlefieldOf(b.tuning.battle, ARENA)!;
    expect(fb).not.toBe(fa);
    expect(fb.arena).not.toBe(fa.arena);
    expect(battleMapOf(a.tuning.battle, ARENA).fields).not.toBe(battleMapOf(b.tuning.battle, ARENA).fields);
    expect(navMesh(fb.arena, b.tuning)).not.toBe(navMesh(fa.arena, a.tuning));
    // Each draft still gets its own back, built once.
    expect(battlefieldOf(a.tuning.battle, ARENA)).toBe(fa);
    expect(battleMapOf(b.tuning.battle, ARENA).field).toBe(fb);
    expect(navMesh(fa.arena, a.tuning)).toBe(navMesh(fa.arena, a.tuning));
    // The edit is what the second one stands on: C moved from x 40 (the bridge, y 4) to -12 (the keep).
    const c = (f: typeof fa) => f.objectives.find((o) => o.id === 'C')!;
    expect([c(fa).x, c(fa).y]).toEqual([40, undefined]);
    expect([c(fb).x, c(fb).y]).toEqual([28, 4]);
    expect(battleMapOf(b.tuning.battle, ARENA).fields).not.toEqual(battleMapOf(a.tuning.battle, ARENA).fields);
  });

  it('shows the edit in the Battle: its Objectives start where the draft puts them', () => {
    const start = (t: typeof a.tuning) => createMatch(t, { format: 'Battle', bestOf: 1, seed: 1, arena: ARENA });
    const ma = start(a.tuning);
    const mb = start(b.tuning);
    expect(ma.arena).toBe(mb.arena);
    const cOf = (t: typeof a.tuning, arena: string) => battleMapOf(t.battle, arena).field.objectives.find((o) => o.id === 'C')!;
    expect(cOf(a.tuning, ma.arena).x).toBe(40);
    expect(cOf(b.tuning, mb.arena).x).toBe(28);
  });

  it('builds the Battlefield again for a map put under the same name in the same Battle Tuning Data', () => {
    const battle = { ...base.battle, maps: { ...base.battle.maps, [NAME]: a.compiled } };
    const before = battlefieldOf(battle, ARENA)!;
    expect(battlefieldOf(battle, ARENA)).toBe(before);
    battle.maps[NAME] = b.compiled;
    const after = battlefieldOf(battle, ARENA)!;
    expect(after).not.toBe(before);
    expect(after.objectives.find((o) => o.id === 'C')!.x).toBe(28);
    // Nothing else of the cache was dropped: the open field is still the one built.
    expect(battlefieldOf(battle, 'battle:3')).toBe(battlefieldOf(battle, 'battle:3'));
  });
});

describe('the stuck measure', () => {
  const draft = draftTuning(sampleSource(), base);
  const run = (seconds: number) => {
    let m = createMatch(draft.tuning, { format: 'Battle', bestOf: 1, seed: 1, arena: ARENA });
    const meter = new StuckMeter(draft.tuning.battle, ARENA);
    while (m.tick < seconds * 60 && m.status.status === 'InProgress') {
      m = stepMatch(m, [], draft.tuning);
      meter.observe(m);
    }
    return meter;
  };

  it('is the same on every run, its heat adds up to its total, and it sits on the ground Soldiers walk', () => {
    const one = run(90);
    const two = run(90);
    expect(Array.from(two.heat)).toEqual(Array.from(one.heat));
    expect([two.stuckSeconds, two.longest, two.runs]).toEqual([one.stuckSeconds, one.longest, one.runs]);
    const sum = one.heat.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(one.stuckSeconds, 3);
    // The sample's ramps are chokepoints: Soldiers queue there in the first minute and a half (about 47 Soldier-s, longest 9 s, near the south ramp).
    expect(one.stuckSeconds).toBeGreaterThan(5);
    const hot = one.hottest()!;
    expect(hot.seconds).toBeGreaterThan(0);
    expect(one.heat[one.cellOf(hot.x, hot.z)]).toBe(hot.seconds);
    // The heat is drawn at the floor the Soldier stood on, one of the sample's levels (a ramp's foot gives a height between).
    expect(one.heatY[one.cellOf(hot.x, hot.z)]).toBeGreaterThanOrEqual(0);
    expect(one.heatY[one.cellOf(hot.x, hot.z)]).toBeLessThanOrEqual(4);
    // Nothing is counted before a run has lasted STUCK_AFTER (3 s): the longest run is at least that when anything is.
    expect(one.longest).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe('the Quick check', () => {
  const small = draftTuning(sampleSource(), base, { armySize: 24 });
  const seeds = [1, 2];

  it('gives the same numbers on a rerun with the same seeds, and different ones for another seed', () => {
    const one = quickCheck(small.tuning, NAME, { seeds });
    const two = quickCheck(small.tuning, NAME, { seeds });
    expect(two).toEqual(one);
    expect(formatQuickCheck(two)).toBe(formatQuickCheck(one));
    // A draft rebuilt from the same source (a new copy of the Tuning Data, its caches built again) gives them too.
    expect(quickCheck(draftTuning(sampleSource(), base, { armySize: 24 }).tuning, NAME, { seeds })).toEqual(one);
    expect(quickCheck(small.tuning, NAME, { seeds: [7] }).battles[0]).not.toEqual(one.battles[0]);
  }, 60_000);

  it('reports each Battle’s length and end, captures per Objective, the Ticket curve and the stall time', () => {
    const r = quickCheck(small.tuning, NAME, { seeds });
    expect(r.battles.map((b) => b.seed)).toEqual(seeds);
    for (const b of r.battles) {
      expect(b.seconds).toBeGreaterThan(30);
      expect(b.winner === 0 || b.winner === 1).toBe(true);
      expect(['rout', 'tickets', 'limit']).toContain(b.endedBy);
      expect(b.objectives.map((o) => o.id)).toEqual(['D', 'A', 'B', 'C', 'E']);
      expect(b.armies.start).toBe(24);
      // The Tickets only run down; the curve starts full (24 a side at 2.4 each) and ends at the Battle's end.
      expect(b.tickets[0]!.seconds).toBe(0);
      expect(b.tickets[0]!.team0).toBeCloseTo(57.6, 9);
      expect(b.tickets[0]!.team1).toBeCloseTo(57.6, 9);
      for (let k = 1; k < b.tickets.length; k++) {
        expect(b.tickets[k]!.seconds).toBeGreaterThanOrEqual(b.tickets[k - 1]!.seconds);
        expect(b.tickets[k]!.team0).toBeLessThanOrEqual(b.tickets[k - 1]!.team0 + 1e-9);
        expect(b.tickets[k]!.team1).toBeLessThanOrEqual(b.tickets[k - 1]!.team1 + 1e-9);
      }
      expect(b.tickets.at(-1)!.seconds).toBe(b.seconds);
      expect(b.stall.seconds).toBeGreaterThanOrEqual(0);
    }
    expect(r.summary.seconds.min).toBeLessThanOrEqual(r.summary.seconds.mean);
    expect(r.summary.seconds.mean).toBeLessThanOrEqual(r.summary.seconds.max);
    expect(r.summary.wins[0] + r.summary.wins[1]).toBe(2);
    expect(r.summary.captures.length).toBe(5);
    expect(formatQuickCheck(r)).toContain('Ticket curve');
  }, 60_000);

  it('steps a Battle a few Ticks at a time to the same report as running it whole', () => {
    const whole = new QuickBattle(small.tuning, NAME, 3);
    whole.step(Infinity);
    const chunked = new QuickBattle(small.tuning, NAME, 3);
    while (!chunked.step(250)) {
      /* the editor runs one chunk a frame */
    }
    expect(chunked.report()).toEqual(whole.report());
    expect(summarise(NAME, [whole.report()]).battles).toHaveLength(1);
  }, 60_000);

  it('runs over a Map Source’s file text, as the npm script does, to the same report', () => {
    const { report, text } = quickCheckSource(sourceFileText(sampleSource()), { seeds, armySize: 24 });
    expect(report).toEqual(quickCheck(small.tuning, NAME, { seeds }));
    expect(text).toContain(`Quick check · ${NAME} · 2 Battles`);
    expect(() => quickCheckSource('{"version":1}')).toThrow();
  }, 60_000);

  it('sees an edit: a map with an Objective moved plays out differently', () => {
    const { second } = twoDrafts();
    const edited = quickCheck(draftTuning(second, base, { armySize: 24 }).tuning, NAME, { seeds });
    expect(edited).not.toEqual(quickCheck(small.tuning, NAME, { seeds }));
  }, 60_000);
});
