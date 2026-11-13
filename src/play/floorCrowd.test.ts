import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadTuningData } from '../tuning';
import { createMatch, type SimState } from '../sim';
import type { ImpostorAtlases } from '../render/impostorAtlas';
import { soldierLooks } from '../render/impostorAtlas';
import { floorTroops } from '../sim/delver';
import { FloorCrowd, floorBattle, type CrowdDraw, type CrowdStage } from './floorCrowd';

const tuning = loadTuningData();
const ARENA = 'gen:greybox:4242';
const start = (): SimState => createMatch(tuning, { format: 'Gauntlet', bestOf: 1, seed: 7, arena: ARENA, delver: true, teams: [0] }).duel;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A stage and view that record what a Floor's Crowd does with them, and atlases that count their disposals. */
function rig() {
  const scene = new THREE.Scene();
  const fades: ((k: number) => number)[] = [];
  const dust = vi.fn();
  const stage = { scene, setFades: (f: ((k: number) => number) | null) => void (f && fades.push(f)), impacts: { dust }, gl: {} } as unknown as CrowdStage;
  const atlases = { atlases: [], index: [], dispose: vi.fn() } as unknown as ImpostorAtlases;
  const draws: { length: number; fades: number[] }[] = [];
  const view: CrowdDraw = {
    root: new THREE.Group(),
    update: (crowd, _tick, _alpha, _hf, _camera, f) => void draws.push({ length: crowd.x.length, fades: [...f!] }),
    dispose: vi.fn(),
  };
  let release!: () => void;
  const baked = new Promise<ImpostorAtlases>((resolve) => (release = () => resolve(atlases)));
  return { stage, scene, atlases, view, draws, fades, dust, release, parts: { bake: () => baked, view: () => view } };
}

describe('a Delver Run’s Crowd view', () => {
  it('draws nothing while the atlases bake, then every unpromoted Soldier whole', async () => {
    const r = rig();
    const state = start();
    const crowd = new FloorCrowd(r.stage, tuning, 1, r.parts);
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
    const crowd = new FloorCrowd(r.stage, tuning, 1, r.parts);
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    const fade = r.fades.at(-1)!;
    expect(fade(0)).toBe(1);
    expect(state.fighters[1]!.benched).toBe(true);
    expect(fade(1)).toBe(0);
  });

  it('resizes its fades for a new Floor’s Crowd of another length', async () => {
    const r = rig();
    const state = start();
    const crowd = new FloorCrowd(r.stage, tuning, 1, r.parts);
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
    const crowd = new FloorCrowd(r.stage, small, 1, r.parts);
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    crowd.update(state, 0, 0.016, new THREE.PerspectiveCamera());
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('frees the view and the atlases on dispose, even when the bake finishes after it', async () => {
    const r = rig();
    const crowd = new FloorCrowd(r.stage, tuning, 1, r.parts);
    r.release();
    await flush();
    crowd.dispose();
    expect(r.scene.children).not.toContain(r.view.root);
    expect(r.view.dispose).toHaveBeenCalledTimes(1);
    expect(r.atlases.dispose).toHaveBeenCalledTimes(1);

    const late = rig();
    const gone = new FloorCrowd(late.stage, tuning, 1, late.parts);
    gone.dispose();
    late.release();
    await flush();
    expect(late.atlases.dispose).toHaveBeenCalledTimes(1);
    expect(late.scene.children).toHaveLength(0);
  });
});

describe('the atlases a Delver Run’s Crowd is drawn from', () => {
  const battle = floorBattle(tuning);
  const { troops, boss, elite } = floorTroops(tuning.battle, tuning.delver);
  const { looks, index } = soldierLooks(battle);

  it('are baked from the Floor Troops, so a Boss Troop past the Battle’s is drawn as its Body and Weapon', () => {
    expect(battle.troops).toBe(troops);
    for (const [tier, t] of boss.entries()) {
      expect(t).toBeGreaterThanOrEqual(tuning.battle.troops.length);
      const spec = tuning.delver.warbands[tier]!.boss!.troop;
      expect(index[1]![t]!.map((k) => looks[k])).toEqual([{ body: spec.body, weapon: spec.weapon }]);
    }
  });

  it('share an elite Troop’s atlases with its base Troop (the same Bodies and Weapon), baking only the Bosses’ extra looks', () => {
    const baseLooks = soldierLooks(tuning.battle).looks;
    for (const tier of elite)
      for (const template of tier)
        for (const t of template) {
          const baseName = troops[t]!.name.replace(' (elite)', '');
          const base = tuning.battle.troops.findIndex((x) => x.name === baseName);
          expect(base).toBeGreaterThanOrEqual(0);
          for (const team of [0, 1]) expect(index[team]![t]).toEqual(index[team]![base]);
        }
    for (const look of baseLooks) expect(looks).toContainEqual(look);
    expect(looks.length - baseLooks.length).toBeLessThanOrEqual(boss.filter((t) => t >= 0).length);
  });
});

