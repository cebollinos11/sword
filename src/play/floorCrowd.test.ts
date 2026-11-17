import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, IDLE_INTENT, stepMatch, type MatchState, type SimState } from '../sim';
import { traitorSlot } from '../sim/delverTraitors';
import type { ImpostorAtlas, ImpostorAtlases } from '../render/impostorAtlas';
import { floorArenaName, floorLooks, floorTroops, parseFloorArena } from '../sim/delver';
import { FloorCrowd, floorAtlases, floorBattle, traitorSlots, type CrowdDraw, type CrowdStage, type FloorCrowdParts } from './floorCrowd';

const tuning = loadTuningData();
const ARENA = 'gen:greybox:4242';
const start = (): SimState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0] }).duel;
const flush = async () => {
  for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 0));
};

/** A fake atlas of Prefab `prefab`, counting its disposals. */
type FakeAtlas = ImpostorAtlas & { readonly prefab: number; readonly dispose: ReturnType<typeof vi.fn> };

/**
 * A stage and views that record what a Floor's Crowd does with them, and bakes that wait for `release` (each a fake atlas counting its
 * disposals): which Prefabs were baked, and whether paced, in order.
 */
function rig() {
  const scene = new THREE.Scene();
  const fades: ((k: number) => number)[] = [];
  const dust = vi.fn();
  const stage = { scene, setFades: (f: ((k: number) => number) | null) => void (f && fades.push(f)), impacts: { dust }, gl: {} } as unknown as CrowdStage;
  const draws: { length: number; fades: number[] }[] = [];
  const views: { draw: CrowdDraw; atlases: ImpostorAtlases }[] = [];
  const baked: { prefab: number; paced: boolean }[] = [];
  const atlases: FakeAtlas[] = [];
  let open = false;
  const waiting: (() => void)[] = [];
  const release = () => {
    open = true;
    for (const w of waiting.splice(0)) w();
  };
  const parts: FloorCrowdParts = {
    bake: (prefab, pace) => {
      baked.push({ prefab, paced: pace !== undefined });
      const atlas = { prefab, dispose: vi.fn() } as unknown as FakeAtlas;
      atlases.push(atlas);
      return open ? Promise.resolve(atlas) : new Promise((r) => waiting.push(() => r(atlas)));
    },
    view: (a) => {
      const draw: CrowdDraw = {
        root: new THREE.Group(),
        update: (crowd, _tick, _alpha, _hf, _camera, f) => void draws.push({ length: crowd.x.length, fades: [...f!] }),
        dispose: vi.fn(),
      };
      views.push({ draw, atlases: a });
      return draw;
    },
    frame: () => Promise.resolve(),
  };
  return {
    stage,
    scene,
    draws,
    views,
    baked,
    atlases,
    fades,
    dust,
    release,
    parts,
    /** The last view made. */
    get view(): CrowdDraw {
      return views.at(-1)!.draw;
    },
  };
}

describe('a Delver Run’s Crowd view', () => {
  it('draws nothing while the atlases bake, then every unpromoted Soldier whole', async () => {
    const r = rig();
    const state = start();
    const crowd = new FloorCrowd(r.stage, tuning, 1, state.arena, r.parts);
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    expect(crowd.ready).toBe(false);
    expect(r.draws).toHaveLength(0);
    r.release();
    await flush();
    expect(crowd.ready).toBe(true);
    expect(r.scene.children).toContain(r.view.root);
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    expect(r.draws).toHaveLength(1);
    expect(r.draws[0]!.length).toBe(state.crowd!.x.length);
    expect(r.draws[0]!.fades.every((f) => f === 1)).toBe(true);
    expect(r.dust).not.toHaveBeenCalled();
  });

  it('keeps the party whole and a Benched Pool slot undrawn', () => {
    const r = rig();
    const state = start();
    const crowd = new FloorCrowd(r.stage, tuning, 1, state.arena, r.parts);
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    const fade = r.fades.at(-1)!;
    expect(fade(0)).toBe(1);
    expect(state.fighters[1]!.benched).toBe(true);
    expect(fade(1)).toBe(0);
  });

  it('draws a traitor’s slot whole while it holds a Soldier it took over (it has no Bubble binding)', () => {
    // A lone Player betraying an all-AI party of two, offline.
    let m: MatchState = createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, teams: [0, 0], humans: 0, players: [], traitors: [{}] });
    const k = traitorSlot(m.config, 0);
    const holds = (s: MatchState) => s.delver!.traitors![0]!.soldier >= 0;
    for (let t = 0; t < 4000 && !holds(m); t++) m = stepMatch(m, m.duel.fighters.map(() => IDLE_INTENT), tuning);
    expect(holds(m)).toBe(true);
    expect(m.duel.fighters[k]!.soldier).toBeUndefined();
    expect(traitorSlots(m.duel, 2)).toEqual(new Set([k]));
    const r = rig();
    const crowd = new FloorCrowd(r.stage, tuning, 2, m.duel.arena, r.parts);
    crowd.update(m.duel, 0, 0.016, new THREE.PerspectiveCamera());
    expect(r.fades.at(-1)!(k)).toBe(1);
  });

  it('resizes its fades for a new Floor’s Crowd of another length', async () => {
    const r = rig();
    const state = start();
    const crowd = new FloorCrowd(r.stage, tuning, 1, state.arena, r.parts);
    r.release();
    await flush();
    const cam = new THREE.PerspectiveCamera();
    crowd.update(state, 0, 0.016, cam);
    const n = state.crowd!.x.length;
    const cut = { ...state.crowd!, x: state.crowd!.x.slice(0, n - 3), z: state.crowd!.z.slice(0, n - 3), slot: state.crowd!.slot.slice(0, n - 3) };
    crowd.update({ ...state, crowd: cut }, 0, 0.016, cam);
    expect(r.draws.map((d) => d.length)).toEqual([n, n - 3]);
    expect(r.draws[1]!.fades).toHaveLength(n - 3);
  });

  it('warns once when a Crowd is longer than the army size', () => {
    const r = rig();
    const state = start();
    const small = { ...tuning, battle: { ...tuning.battle, armySize: 2 } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crowd = new FloorCrowd(r.stage, small, 1, state.arena, r.parts);
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('frees the view and every atlas on dispose, even when a bake finishes after it', async () => {
    const r = rig();
    const crowd = new FloorCrowd(r.stage, tuning, 1, start().arena, r.parts);
    r.release();
    await flush();
    const view = r.view;
    crowd.dispose();
    expect(r.scene.children).not.toContain(view.root);
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(r.atlases.length).toBeGreaterThan(0);
    for (const a of r.atlases) expect(a.dispose).toHaveBeenCalledTimes(1);

    const late = rig();
    const gone = new FloorCrowd(late.stage, tuning, 1, start().arena, late.parts);
    await flush();
    gone.dispose();
    late.release();
    await flush();
    expect(late.atlases.length).toBeGreaterThan(0);
    for (const a of late.atlases) expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(late.scene.children).toHaveLength(0);
  });

  it('bakes the first Floor’s looks at full speed, reporting each, then the next Floor’s new ones paced', async () => {
    const r = rig();
    const state = start();
    const { seed, floor } = parseFloorArena(state.arena)!;
    const first = floorLooks(tuning.delver, seed, floor);
    const next = floorLooks(tuning.delver, seed, floor + 1);
    const progress: [number, number][] = [];
    const crowd = new FloorCrowd(r.stage, tuning, 1, state.arena, r.parts, (done, total) => progress.push([done, total]));
    r.release();
    await crowd.settled;
    await flush();
    expect(progress).toEqual([...first.map((_, k) => [k, first.length]), [first.length, first.length]]);
    const fresh = next.filter((p) => !first.includes(p));
    expect(r.baked).toEqual([...first.map((prefab) => ({ prefab, paced: false })), ...fresh.map((prefab) => ({ prefab, paced: true }))]);
    // The view draws the first Floor's looks, in order.
    expect(r.views).toHaveLength(1);
    expect((r.views[0]!.atlases.atlases as FakeAtlas[]).map((a) => a.prefab)).toEqual(first);
    crowd.dispose();
  });

  it('draws a new Floor from its own looks once they are in, freeing the atlases neither it nor the one after it draws', async () => {
    const r = rig();
    const state = start();
    const { seed, floor } = parseFloorArena(state.arena)!;
    const crowd = new FloorCrowd(r.stage, tuning, 1, state.arena, r.parts);
    r.release();
    await crowd.settled;
    await flush();
    const cam = new THREE.PerspectiveCamera();
    const second = floorArenaName(seed, floor + 1);
    crowd.update({ ...state, arena: second }, 0, 0.016, cam);
    await flush();
    expect(r.views).toHaveLength(2);
    expect(r.views[0]!.draw.dispose).toHaveBeenCalledTimes(1);
    expect(r.scene.children).toContain(r.views[1]!.draw.root);
    expect(r.scene.children).not.toContain(r.views[0]!.draw.root);
    const looks = floorLooks(tuning.delver, seed, floor + 1);
    expect((r.views[1]!.atlases.atlases as FakeAtlas[]).map((a) => a.prefab)).toEqual(looks);
    const keep = new Set([...looks, ...floorLooks(tuning.delver, seed, floor + 2)]);
    for (const a of r.atlases) expect(a.dispose).toHaveBeenCalledTimes(keep.has(a.prefab) ? 0 : 1);
    // A look is baked once while it is kept.
    const counts = new Map<number, number>();
    for (const b of r.baked) counts.set(b.prefab, (counts.get(b.prefab) ?? 0) + 1);
    for (const p of looks) expect(counts.get(p)).toBe(1);
    // The same Floor again changes nothing.
    crowd.update({ ...state, arena: second }, 0, 0.016, cam);
    await flush();
    expect(r.views).toHaveLength(2);
    crowd.dispose();
  });
});

describe('the atlases a Delver Run’s Crowd is drawn from', () => {
  const battle = floorBattle(tuning);
  const { troops, boss } = floorTroops(tuning.delver);

  it('index each Floor Troop to its Prefab’s atlas, or to none when its Prefab is not drawn', () => {
    expect(battle.troops).toBe(troops);
    const looks = [2, 10];
    const fake = looks.map((prefab) => ({ prefab }) as unknown as ImpostorAtlas);
    const made = floorAtlases(battle, looks, fake);
    expect(made.atlases).toBe(fake);
    for (const team of [0, 1]) troops.forEach((t, k) => expect(made.index[team]![k]).toEqual([t.prefab === 2 ? 0 : t.prefab === 10 ? 1 : -1]));
    // The tier 1 Boss (the Warden) is of the Uruk Prefab.
    expect(made.index[1]![boss[0]!]).toEqual([1]);
  });
});
