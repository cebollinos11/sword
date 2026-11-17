import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { battlefieldHeight, battlefieldOf, createMatch, stepMatch, type MatchState } from '../sim';
import { loadTuningData } from '../tuning';
import { CrowdView } from './crowdView';
import { atlasCell, atlasLayout, CLIP_FRAMES, directionCell, impostorStretch, WALK_SPEED_MIN, yawTo, type ImpostorClip } from './impostor';
import { CELL_METRES, FEET_METRES, type ImpostorAtlas } from './impostorAtlas';

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
      const m = meshes[Math.floor(i / army)]!.geometry.getAttribute('aMirror') as THREE.InstancedBufferAttribute;
      return {
        column: Math.round((a.getX(i % army) * layout.width) / layout.cell),
        row: Math.round((a.getY(i % army) * layout.height) / layout.cell),
        mirrored: m.getX(i % army) > 0.5,
      };
    },
  };
}

const cellOf = (clip: ImpostorClip, direction: number) =>
  Array.from({ length: CLIP_FRAMES[clip] }, (_, f) => atlasCell(layout, clip, f, direction)).map((c) => `${c.column},${c.row},${c.mirrored}`);

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
    const seen = (i: number) => `${look.cell(i).column},${look.cell(i).row},${look.cell(i).mirrored}`;
    // A Soldier walking is drawn walking, from that direction; one already standing at its place (a Squad sent to its Home
    // Objective, whose circle reaches the deployment) stands. Nearly every Soldier walks (the Squads head for their Objectives, so no
    // one direction holds for an army).
    let walking = 0;
    for (let i = 0; i < 2 * army; i++) {
      const f = look.feet(i);
      const direction = directionCell(crowd.heading[i]!, yawTo(f.getX(i % army), f.getZ(i % army), camera.position.x, camera.position.z));
      if (Math.hypot(crowd.vx[i]!, crowd.vz[i]!) < WALK_SPEED_MIN) {
        expect(cellOf('idle', direction)).toContain(seen(i));
        continue;
      }
      walking++;
      expect(cellOf('walk', direction)).toContain(seen(i));
    }
    expect(walking).toBeGreaterThan(0.8 * 2 * army);
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
    const shown = () => `${look.cell(fell).column},${look.cell(fell).row},${look.cell(fell).mirrored}`;
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

describe("A Soldier's impostor in its Size", () => {
  it('stretches up by the height and across from the thickness (face on) to the height (side on)', () => {
    expect(impostorStretch(1.3, 0.8, 0, yawTo(0, 0, 0, 10))).toEqual([0.8, 1.3]);
    expect(impostorStretch(1.3, 0.8, 0, yawTo(0, 0, 0, -10))[0]).toBeCloseTo(0.8, 9);
    expect(impostorStretch(1.3, 0.8, 0, yawTo(0, 0, 10, 0))[0]).toBeCloseTo(1.3, 9);
    expect(impostorStretch(1, 1, 0.4, 2)).toEqual([1, 1]);
  });

  it("is stretched about its feet, so they stay on the ground whatever its height", () => {
    let match: MatchState = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 });
    for (let t = 0; t < 30; t++) match = stepMatch(match, [], tuning);
    const hf = battlefieldOf(tuning.battle, match.arena)!.heights;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(30, 20, -150);
    const view = new CrowdView(atlas, tuning.battle, new THREE.Texture());
    view.update(match.duel.crowd!, match.duel.tick, 0, hf, camera);
    const meshes = view.root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh));
    const crowd = match.duel.crowd!;
    // Some Soldiers are not the standard body.
    expect(crowd.sizeHeight.some((h) => h !== 1)).toBe(true);
    for (const i of [0, 57, 199, 260, army + 3]) {
      const geometry = meshes[Math.floor(i / army)]!.geometry;
      const feet = geometry.getAttribute('aFeet') as THREE.InstancedBufferAttribute;
      const size = geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
      const k = i % army;
      const [across, up] = impostorStretch(crowd.sizeHeight[i]!, crowd.sizeThick[i]!, crowd.heading[i]!, yawTo(feet.getX(k), feet.getZ(k), camera.position.x, camera.position.z));
      expect(size.getX(k)).toBeCloseTo(across, 5);
      expect(size.getY(k)).toBeCloseTo(up, 5);
      expect(feet.getY(k)).toBeCloseTo(battlefieldHeight(hf, feet.getX(k), feet.getZ(k)), 5);
    }
    // The quad's feet line is its origin (the shader scales about it): its bottom edge is FEET_METRES below, its top the rest of a cell above.
    const quad = meshes[0]!.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ys = Array.from({ length: quad.count }, (_, v) => quad.getY(v));
    expect(Math.min(...ys)).toBeCloseTo(-FEET_METRES, 5);
    expect(Math.max(...ys)).toBeCloseTo(CELL_METRES - FEET_METRES, 5);
  });
});

describe("A Delver Soldier's impostor (docs/plans/delver-troops.md)", () => {
  it("wears its Troop's tint on the team-coloured part, and is not drawn while its Prefab's look has no atlas", async () => {
    const { floorAtlases, floorBattle } = await import('../play/floorCrowd');
    const { floorTroops } = await import('../sim/delver');
    const battle = floorBattle(tuning);
    const { plain } = floorTroops(tuning.delver);
    // Prefab 0 baked, Prefab 1 not: Soldier 0 a Skilled Variant of Prefab 0, Soldier 1 of Prefab 1 (and so the Soldier sharing its billboard, all on Team 1).
    const view = new CrowdView(floorAtlases(battle, [0], [atlas]), battle, new THREE.Texture());
    const crowd = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 }).duel.crowd!;
    const two = { ...crowd, team: crowd.team.map(() => 1), troop: crowd.troop.map((_, i) => (i % army === 1 ? plain[1]![0]! : plain[0]![1]!)), look: crowd.look.map(() => 0) };
    const hf = battlefieldOf(tuning.battle, createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 }).arena)!.heights;
    view.update(two, 0, 0, hf, new THREE.PerspectiveCamera());
    const meshes = view.root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh));
    // Team 1's draw of the one atlas.
    const geometry = meshes[1]!.geometry;
    const tint = geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    const size = geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
    const red = new THREE.Color().setHex(tuning.delver.skillTints.Skilled!);
    expect(tint.getX(0)).toBeCloseTo(red.r, 6);
    expect(tint.getY(0)).toBeCloseTo(red.g, 6);
    expect(tint.getZ(0)).toBeCloseTo(red.b, 6);
    expect(size.getX(0)).toBeGreaterThan(0);
    expect([size.getX(1), size.getY(1)]).toEqual([0, 0]);
    expect(view.meshOf(two, 1)).toBeNull();
    expect(view.meshOf(two, 0)).toBe(meshes[1]);
  });
  it("goes back to its Team's colour when the Soldier in its billboard is of a Troop with no tint", async () => {
    const { floorAtlases, floorBattle } = await import('../play/floorCrowd');
    const { floorTroops } = await import('../sim/delver');
    const tinted = floorBattle(tuning);
    const { plain } = floorTroops(tuning.delver);
    const troop = plain[0]![1]!;
    // The same Troops, but this one's tint dropped (a skill `delver.skillTints` does not name).
    const battle = { ...tinted, troops: tinted.troops.map((t, k) => (k === troop ? { ...t, tint: undefined } : t)) };
    const view = new CrowdView(floorAtlases(battle, [0], [atlas]), battle, new THREE.Texture());
    const crowd = createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 }).duel.crowd!;
    const hf = battlefieldOf(tuning.battle, createMatch(tuning, { format: 'Battle', bestOf: 1, seed: 2 }).arena)!.heights;
    const of = (t: number) => ({ ...crowd, team: crowd.team.map(() => 1), troop: crowd.troop.map(() => t), look: crowd.look.map(() => 0) });
    // First a tinted Soldier in billboard 0, then (the next Floor, drawn by the same view) an untinted one.
    view.update(of(plain[0]![2]!), 0, 0, hf, new THREE.PerspectiveCamera());
    view.update(of(troop), 1, 0, hf, new THREE.PerspectiveCamera());
    const meshes = view.root.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh));
    const tint = meshes[1]!.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    const team = new THREE.Color().setHex(tuning.battle.soldier.colours[1]!);
    expect([tint.getX(0), tint.getY(0), tint.getZ(0)].map((v) => v.toFixed(6))).toEqual([team.r, team.g, team.b].map((v) => v.toFixed(6)));
  });
});
