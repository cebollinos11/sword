import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { battlefieldHeight, battlefieldOf, createMatch, standingFighter, arenaOf, stepMatch, IDLE_INTENT, type CrowdState, type MatchState } from '../sim';
import { loadTuningData } from '../tuning';
import { BubbleSwap, SWAP_SECONDS } from './bubbleSwap';
import { CrowdView } from './crowdView';
import { bayer4, modelDraws } from './dither';
import { atlasLayout } from './impostor';
import type { ImpostorAtlas } from './impostorAtlas';

const tuning = loadTuningData();
const army = tuning.battle.armySize;

/** A Battle with the Player standing 5 m from Team 1's first Soldier, far out on the flank. */
function promoting(): MatchState {
  const m = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1, teams: [0] });
  const player = m.duel.fighters[0]!;
  const moved = standingFighter(tuning, arenaOf(tuning, m.arena), { position: { x: 80, z: 0 }, y: battlefieldHeight(battlefieldOf(tuning.battle, m.arena)!.heights, 80, 0), facing: 0 }, player.weapon, 0);
  const c = m.duel.crowd!;
  const crowd: CrowdState = { ...c, x: c.x.map((v, i) => (i === army ? 80 : v)), z: c.z.map((v, i) => (i === army ? 5 : v)) };
  return { ...m, duel: { ...m.duel, fighters: [moved, ...m.duel.fighters.slice(1)], crowd } };
}

describe('the swap between impostor and full model', () => {
  it('dithers the two complementarily: every pixel shows exactly one of them, mid-swap or not', () => {
    for (const fade of [0, 0.2, 0.5, 0.81, 1])
      for (let x = 0; x < 4; x++)
        for (let y = 0; y < 4; y++) {
          const t = bayer4(x, y);
          // The impostor at 1 - fade drops a pixel when its threshold is below 1 - (1 - fade) = fade (crowdView's shader).
          const impostorDraws = !(1 - fade < 1 && t < fade);
          expect(modelDraws(fade, t) !== impostorDraws, `fade ${fade} at ${x},${y}`).toBe(true);
        }
    // Each of the 16 thresholds once.
    const all = Array.from({ length: 16 }, (_, k) => bayer4(k % 4, Math.floor(k / 4))).sort();
    expect(new Set(all).size).toBe(16);
    expect(all[0]).toBeGreaterThan(0);
    expect(all[15]).toBeLessThan(1);
  });

  it('crossfades at a Promotion, with one dust puff, then shows only the model; an unbound slot shows nothing', () => {
    const swap = new BubbleSwap();
    let m = promoting();
    expect(swap.update(m.duel, 0)).toEqual([]);
    const fades = new Float32Array(2 * army);
    expect(swap.impostorFades(m.duel.crowd!, fades)[army]).toBe(1);
    for (let k = 1; k < m.duel.fighters.length; k++) expect(swap.modelFade(k)).toBe(0);
    m = stepMatch(m, [IDLE_INTENT], tuning);
    const swaps = swap.update(m.duel, 0);
    expect(swaps).toEqual([{ kind: 'Promote', slot: 1, soldier: army, at: { x: 80, z: 5 } }]);
    expect(swap.modelFade(1)).toBe(0);
    expect(swap.impostorFades(m.duel.crowd!, fades)[army]).toBe(1);
    swap.update(m.duel, SWAP_SECONDS / 2);
    expect(swap.modelFade(1)).toBeCloseTo(0.5, 5);
    expect(swap.impostorFades(m.duel.crowd!, fades)[army]).toBeCloseTo(0.5, 5);
    swap.update(m.duel, SWAP_SECONDS);
    expect(swap.modelFade(1)).toBe(1);
    expect(swap.impostorFades(m.duel.crowd!, fades)[army]).toBe(0);
    // Every other Soldier is all impostor, every other slot (unbound) no model.
    expect(swap.impostorFades(m.duel.crowd!, fades).filter((f, i) => i !== army && f !== 1)).toHaveLength(0);
    for (let k = 2; k < m.duel.fighters.length; k++) expect(swap.modelFade(k)).toBe(0);
  });

  it('crossfades back at a Demotion, the model fading from its last pose as the impostor comes back where the Fighter stood', () => {
    const swap = new BubbleSwap();
    let m = stepMatch(promoting(), [IDLE_INTENT], tuning);
    swap.update(m.duel, 0);
    swap.update(m.duel, 1);
    // The Player walks off: the Fighter demotes once beyond 16 m.
    let swaps: ReturnType<BubbleSwap['update']> = [];
    for (let k = 0; k < 900 && swaps.length === 0; k++) {
      m = stepMatch(m, [{ ...IDLE_INTENT, move: { x: 0, z: -1 } }], tuning);
      swaps = swap.update(m.duel, 1 / 60);
    }
    expect(swaps).toEqual([{ kind: 'Demote', slot: 1, soldier: army, at: { x: m.duel.crowd!.x[army]!, z: m.duel.crowd!.z[army]! } }]);
    expect(m.duel.fighters[1]!.benched).toBe(true);
    const fades = new Float32Array(2 * army);
    expect(swap.modelFade(1)).toBe(1);
    expect(swap.impostorFades(m.duel.crowd!, fades)[army]).toBe(0);
    swap.update(m.duel, SWAP_SECONDS);
    expect(swap.modelFade(1)).toBe(0);
    expect(swap.impostorFades(m.duel.crowd!, fades)[army]).toBe(1);
  });

  it('hides a promoted Soldier’s impostor and its shadow in the Crowd view, by default and through the fades', () => {
    const layout = atlasLayout(128, 4096);
    const atlas: ImpostorAtlas = { colour: new THREE.Texture(), mask: new THREE.Texture(), layout, seconds: { idle: 2, walk: 1, swing: 1.1, stagger: 0.5, death: 1.4 }, dispose() {} };
    const view = new CrowdView(atlas, tuning.battle, new THREE.Texture());
    const m = stepMatch(promoting(), [IDLE_INTENT], tuning);
    const hf = battlefieldOf(tuning.battle, m.arena)!.heights;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(80, 3, -10);
    view.update(m.duel.crowd!, m.duel.tick, 0, hf, camera);
    const team1 = view.root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh))[1]!;
    const fade = team1.geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
    expect(fade.getX(0)).toBe(0);
    expect(fade.getX(1)).toBe(1);
    const shadows = view.root.children.find((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)!;
    const matrix = new THREE.Matrix4();
    shadows.getMatrixAt(army, matrix);
    expect(new THREE.Vector3().setFromMatrixColumn(matrix, 0).length()).toBe(0);
    shadows.getMatrixAt(army + 1, matrix);
    expect(new THREE.Vector3().setFromMatrixColumn(matrix, 0).length()).toBeGreaterThan(0);
    const fades = new Float32Array(2 * army).fill(1);
    fades[army] = 0.75;
    view.update(m.duel.crowd!, m.duel.tick, 0, hf, camera, fades);
    expect(fade.getX(0)).toBe(0.75);
  });
});
