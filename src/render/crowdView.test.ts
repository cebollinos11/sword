import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { battlefieldHeight, battlefieldOf, createMatch, stepMatch, type MatchState } from '../sim';
import { loadTuningData } from '../tuning';
import { CrowdView } from './crowdView';
import { atlasCell, atlasLayout, CLIP_FRAMES, directionCell, yawTo, type ImpostorClip } from './impostor';
import type { ImpostorAtlas } from './impostorAtlas';

const tuning = loadTuningData();
const army = tuning.battle.armySize;
const layout = atlasLayout(128, 4096);
const atlas: ImpostorAtlas = { colour: new THREE.Texture(), mask: new THREE.Texture(), layout, seconds: { idle: 2, walk: 1, swing: 1.1, stagger: 0.5, death: 1.4 }, dispose() {} };

/** The view's per-Soldier attributes: Team t's billboards, then its shadows. */
function drawn(view: CrowdView) {
  const meshes = view.root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh));
  return {
    feet: (i: number) => (meshes[Math.floor(i / army)]!.geometry.getAttribute('aFeet') as THREE.InstancedBufferAttribute),
    cell: (i: number) => {
      const a = meshes[Math.floor(i / army)]!.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
      return { column: Math.round((a.getX(i % army) * layout.width) / layout.cell), row: Math.round((a.getY(i % army) * layout.height) / layout.cell) };
    },
  };
}

const cellOf = (clip: ImpostorClip, direction: number) =>
  Array.from({ length: CLIP_FRAMES[clip] }, (_, f) => atlasCell(layout, clip, f, direction)).map((c) => `${c.column},${c.row}`);

describe('CrowdView', () => {
  it('draws one billboard draw per Team and one for the shadows', () => {
    const view = new CrowdView(atlas, tuning.battle, new THREE.Texture());
    expect(view.root.children).toHaveLength(3);
    expect(view.root.children.filter((o) => o instanceof THREE.InstancedMesh)).toHaveLength(1);
  });

  it('shows marching armies from the right side, standing on the ground, and plays a fall from where it was seen', () => {
    let match: MatchState = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 });
    const hf = battlefieldOf(tuning.battle, match.arena)!.heights;
    const camera = new THREE.PerspectiveCamera();
    // Behind Team 0, which marches toward +z at Team 1, which comes toward the camera.
    camera.position.set(0, 20, -150);
    const view = new CrowdView(atlas, tuning.battle, new THREE.Texture());
    const look = drawn(view);
    for (let t = 0; t < 300; t++) match = stepMatch(match, [], tuning);
    view.update(match.duel.crowd!, match.duel.tick, 0, hf, camera);
    // Each Soldier walking, seen from the direction its heading and the camera's bearing from its feet give; Team 0 (walking
    // away, at most 45 degrees off) from behind, Team 1 (walking toward the camera) from in front.
    const crowd = match.duel.crowd!;
    const seen = (i: number) => `${look.cell(i).column},${look.cell(i).row}`;
    for (let i = 0; i < 2 * army; i++) {
      const f = look.feet(i);
      expect(cellOf('walk', directionCell(crowd.heading[i]!, yawTo(f.getX(i % army), f.getZ(i % army), camera.position.x, camera.position.z)))).toContain(seen(i));
      // Every Soldier walks (the Squads head for their Objectives, so no one direction holds for an army).
      expect([0, 1, 2, 3, 4, 5, 6, 7].flatMap((d) => cellOf('walk', d))).toContain(seen(i));
    }
    for (const i of [0, 57, 199, 260]) {
      const f = look.feet(i);
      expect(f.getY(i % army)).toBeCloseTo(battlefieldHeight(hf, f.getX(i % army), f.getZ(i % army)), 5);
    }

    // On into the fighting: the first to fall shows its fall from its first frame, and lies still once it is over.
    let fell = -1;
    let fellAt = 0;
    while (fell < 0 && match.status.status === 'InProgress') {
      match = stepMatch(match, [], tuning);
      view.update(match.duel.crowd!, match.duel.tick, 0, hf, camera);
      fell = match.duel.crowd!.alive.indexOf(0);
      fellAt = match.duel.tick;
    }
    expect(fell).toBeGreaterThanOrEqual(0);
    const fallCells = (d: number) => cellOf('death', d);
    const shown = () => `${look.cell(fell).column},${look.cell(fell).row}`;
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => fallCells(d)[0])).toContain(shown());
    while (match.duel.tick < fellAt + 120) {
      match = stepMatch(match, [], tuning);
      view.update(match.duel.crowd!, match.duel.tick, 0, hf, camera);
    }
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => fallCells(d)[CLIP_FRAMES.death - 1])).toContain(shown());
  });

  it('updates 400 Soldiers well inside the Stage 0 render budget, through the march and the first fighting', () => {
    let match: MatchState = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 1 });
    const hf = battlefieldOf(tuning.battle, match.arena)!.heights;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-30, 25, -60);
    const view = new CrowdView(atlas, tuning.battle, new THREE.Texture());
    const ms: number[] = [];
    // The march and the first fighting (a Battle now lasts minutes, not seconds).
    while (match.status.status === 'InProgress' && match.tick < 4000) {
      match = stepMatch(match, [], tuning);
      // Two frames a Tick, as at 120 fps.
      for (const alpha of [0, 0.5]) {
        const t0 = performance.now();
        view.update(match.duel.crowd!, match.duel.tick, alpha, hf, camera);
        ms.push(performance.now() - t0);
      }
    }
    ms.sort((a, b) => a - b);
    const mean = ms.reduce((s, v) => s + v, 0) / ms.length;
    console.log(`CrowdView.update, 400 Soldiers, ${ms.length} frames: mean ${mean.toFixed(3)} ms, p99 ${ms[Math.floor(ms.length * 0.99)]!.toFixed(3)} ms`);
    // Stage 0: 400 billboards were under 4 ms of frame, draw included. Generous slack for a loaded test run.
    expect(mean).toBeLessThan(4);
  });
});
