/**
 * The model of a map made in the Map Editor (docs/plans/map-editor.md, Stage 5), generated from its Brushes with no Blender step, and what
 * Save exports as `public/models/arenas/battle_<map>.glb` (three.js `GLTFExporter`), so the game loads it as it loads a shipped map's
 * (`stage.ts` `battle()`). Render-only: the compiled map is what the Simulation reads; this only draws it.
 *
 * Built from the compiled draft (`compileDraft`), so it stands exactly where the Walk Surfaces and Walls do, each part in its Brush's material
 * (`look.ts`): every Walk Surface (a Hazard's in its own look), a Deck and an Enclosure's roof as a slab, each Wall the compiler stood (a Platform's and a raised
 * floor's faces, the skirts under raised edges, Rails, Walls) as a box on its line, each bank with no Wall (over lava) down to the floor beyond, each Ramp's open sides as its wedge (in place of the
 * stepped skirt the Simulation stands there), each Block as its box, the ground run on beyond the field's edge into the haze, then the props
 * (`mapProps.ts`) and their torches' lights. One mesh per material. The root carries the map's sky (`userData.sky`), read back once loaded.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { DraftMap } from '../mapEditor/compile';
import { surfaceHeight, surfacesAt } from '../sim';
import { brushLook, groundOf, HAZARD_LOOKS, MAP_MODEL_ROOT, MATERIAL_LOOKS, materialOf, type MaterialLook } from '../mapEditor/look';
import type { Brush, MapSource, RampBrush } from '../mapEditor/source';
import { MeshBuckets } from './meshBuckets';
import { placeProps } from './mapProps';

/** How thick (m) each kind of Wall is drawn: a Wall Brush, a rail, and a face (a Platform's side, a skirt under a raised edge). */
const THICKNESS = { wall: 0.6, rail: 0.22, face: 0.3 };
/** How thick (m) a Deck's slab is drawn under its floor. */
const DECK_SLAB = 0.45;
/** A Ramp's wedge, and a Block, reach this far (m) under the floor they stand on, as the compiler's faces do. */
const BELOW = 1;
/** How far (m) beyond the field's edge the ground runs on (into the haze). */
const BEYOND = 700;
/** The ground beyond the field sits this far (m) under the field's own, so the two never fight for depth at the edge. */
const BEYOND_DROP = 0.02;

/** Heights this close (m) are one floor; a bank's side is drawn in pieces this long (m) along its edge, and probed this far (m) beyond it. */
const LEVEL_EPS = 0.05;
const BANK_PIECE = 0.5;
const BANK_PROBE = 0.25;

/** A Ramp's four corners at its heights: the foot's two (at `lo`) and the head's two (at `hi`), each pair in the same order along the slope's sides. */
function rampCorners(r: RampBrush): { foot: [THREE.Vector3, THREE.Vector3]; head: [THREE.Vector3, THREE.Vector3] } {
  const { x0, z0, x1, z1 } = r.rect;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (r.up) {
    case 'n':
      return { foot: [v(x0, r.lo, z0), v(x1, r.lo, z0)], head: [v(x0, r.hi, z1), v(x1, r.hi, z1)] };
    case 's':
      return { foot: [v(x0, r.lo, z1), v(x1, r.lo, z1)], head: [v(x0, r.hi, z0), v(x1, r.hi, z0)] };
    case 'e':
      return { foot: [v(x0, r.lo, z0), v(x0, r.lo, z1)], head: [v(x1, r.hi, z0), v(x1, r.hi, z1)] };
    case 'w':
      return { foot: [v(x1, r.lo, z0), v(x1, r.lo, z1)], head: [v(x0, r.hi, z0), v(x0, r.hi, z1)] };
  }
}

/** The look of a floor's side: grass shows its dirt there; every other material is its own. */
const sideLook = (look: MaterialLook): MaterialLook => (look === MATERIAL_LOOKS.grass ? MATERIAL_LOOKS.dirt : look);

/** Whether the Wall `id` (owned by the Ramp `ramp`) is one step of its stepped skirt (`WALL_<ramp>_<side><n>`; its rail has no number). */
const isSkirt = (id: string, ramp: string): boolean => new RegExp(`^WALL_${ramp}_[nesw]\\d+$`).test(id);

/** Whether the floor at `y` that Brush `b` lays is drawn as a slab over open space: a Deck's, and an Enclosure's roof. */
const isSlab = (b: Brush, y: number): boolean => b.kind === 'deck' || (b.kind === 'enclosure' && y > b.y + LEVEL_EPS);

/** The model of `source` as compiled (`draft`, from `compileDraft(source, …)`): a group of one mesh per material, the torches' lights, and its sky. */
export function mapModel(source: MapSource, draft: DraftMap): THREE.Group {
  const buckets = new MeshBuckets();
  const brushes = new Map<string, Brush>(source.brushes.map((b) => [b.id, b]));
  const lookOf = (id: string) => {
    const b = brushes.get(id);
    return b ? brushLook(b, source) : MATERIAL_LOOKS.stone;
  };
  const { map } = draft;

  // The floors: each Walk Surface in its Brush's material, a Hazard's (and any deadly floor's) in its own look; a Deck's as a slab.
  map.walk.forEach((w, i) => {
    const owner = brushes.get(draft.surfaceBrush[i]!);
    const look = w.lava ? HAZARD_LOOKS.lava : w.water ? HAZARD_LOOKS.water : w.abyss ? HAZARD_LOOKS.abyss : lookOf(draft.surfaceBrush[i]!);
    buckets.polygon(look, w.points);
    if (!owner || !isSlab(owner, w.points[0]!.y)) return;
    const under = w.points.map((p) => ({ x: p.x, y: p.y - DECK_SLAB, z: p.z }));
    buckets.polygon(look, [...under].reverse());
    w.points.forEach((p, k) => {
      const q = w.points[(k + 1) % w.points.length]!;
      buckets.quad(look, p, q, under[(k + 1) % under.length]!, under[k]!);
    });
  });

  // The banks: where a floor's edge drops to lower floor with no Wall the compiler stood there (a bank over lava, a step lower than a step
  // up), its side down to the floor beyond, so no gap shows under it. Not a Ramp's (its wedge) nor a Deck's (its slab, over open space).
  map.walk.forEach((w, i) => {
    const owner = brushes.get(draft.surfaceBrush[i]!);
    if (!owner || owner.kind === 'ramp' || isSlab(owner, w.points[0]!.y) || w.lava || w.water || w.abyss) return;
    const look = sideLook(lookOf(owner.id));
    const cx = w.points.reduce((t, p) => t + p.x, 0) / w.points.length;
    const cz = w.points.reduce((t, p) => t + p.z, 0) / w.points.length;
    w.points.forEach((p, k) => {
      const q = w.points[(k + 1) % w.points.length]!;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      // Out of the surface, across this edge.
      let [nx, nz] = [(q.z - p.z) / len, -(q.x - p.x) / len];
      if (nx * ((p.x + q.x) / 2 - cx) + nz * ((p.z + q.z) / 2 - cz) < 0) [nx, nz] = [-nx, -nz];
      const pieces = Math.max(1, Math.round(len / BANK_PIECE));
      let run: { from: number; to: number; down: number } | null = null;
      const flush = () => {
        if (!run) return;
        const a = run.from / pieces;
        const b = run.to / pieces;
        const at = (t: number, y: number) => ({ x: p.x + (q.x - p.x) * t, y, z: p.z + (q.z - p.z) * t });
        buckets.quad(look, at(a, p.y + (q.y - p.y) * a), at(b, p.y + (q.y - p.y) * b), at(b, run.down), at(a, run.down));
        run = null;
      };
      for (let n = 0; n < pieces; n++) {
        const t = (n + 0.5) / pieces;
        const x = p.x + (q.x - p.x) * t + nx * BANK_PROBE;
        const z = p.z + (q.z - p.z) * t + nz * BANK_PROBE;
        const y = p.y + (q.y - p.y) * t;
        const beyond = surfacesAt(draft.arena, x, z).filter((j) => j !== i).map((j) => surfaceHeight(draft.arena, j, x, z));
        const below = beyond.filter((h) => h < y - LEVEL_EPS);
        // Nothing beyond (the field's edge), or floor beyond at this height or higher (whose own side, or a Wall, stands there): no bank.
        const down = beyond.length === 0 || beyond.some((h) => h >= y - LEVEL_EPS) ? null : Math.max(...below);
        if (down !== null && run && run.down === down && run.to === n) run.to = n + 1;
        else {
          flush();
          if (down !== null) run = { from: n, to: n + 1, down };
        }
      }
      flush();
    });
  });

  // The Walls the compiler stood, as boxes on their lines (the field's edge is open ground; a Ramp's skirt is drawn as its wedge below).
  map.walls.forEach((w, i) => {
    const id = draft.wallBrush[i]!;
    const owner = brushes.get(id);
    if (!owner) return;
    if (owner.kind === 'ramp' && isSkirt(w.id, owner.id)) return;
    const thick = owner.kind === 'wall' || owner.kind === 'enclosure' ? THICKNESS.wall : owner.kind === 'rail' || owner.kind === 'ramp' ? THICKNESS.rail : THICKNESS.face;
    buckets.slab(lookOf(id), w.a, w.b, w.bottom, w.top, thick);
  });

  for (const b of source.brushes) {
    const look = brushLook(b, source);
    // A Block from its floor (the map's lowest level: a Block stands only on a map of one) or the Simulation's -1 m, whichever is lower, to its top.
    if (b.kind === 'block') buckets.box(look, b.rect.x0, Math.min(-BELOW, source.levels[0]! - BELOW), b.rect.z0, b.rect.x1, b.top, b.rect.z1);
    if (b.kind !== 'ramp') continue;
    // A Ramp's wedge: each long side from under its foot up to the slope, and its head's end from under its foot up to its top.
    const { foot, head } = rampCorners(b);
    const down = (p: THREE.Vector3) => new THREE.Vector3(p.x, b.lo - BELOW, p.z);
    for (const k of [0, 1] as const) buckets.quad(look, down(foot[k]), down(head[k]), head[k], foot[k]);
    buckets.quad(look, down(head[0]), down(head[1]), head[1], head[0]);
  }

  // The ground beyond the field: four strips round it at the ground's height (the first Floor's; else the lowest walkable floor's), in its material.
  const groundBrush = groundOf(source);
  const safe = map.walk.filter((w) => !w.lava && !w.water && !w.abyss).flatMap((w) => w.points.map((p) => p.y));
  const groundY = (groundBrush?.kind === 'floor' ? groundBrush.y : safe.length > 0 ? Math.min(...safe) : 0) - BEYOND_DROP;
  const ground = MATERIAL_LOOKS[groundBrush ? materialOf(groundBrush, source) : 'grass'];
  const h = source.size / 2;
  const far = h + BEYOND;
  const v = (x: number, z: number) => ({ x, y: groundY, z });
  buckets.quad(ground, v(-far, -far), v(far, -far), v(far, -h), v(-far, -h));
  buckets.quad(ground, v(-far, h), v(far, h), v(far, far), v(-far, far));
  buckets.quad(ground, v(-far, -h), v(-h, -h), v(-h, h), v(-far, h));
  buckets.quad(ground, v(h, -h), v(far, -h), v(far, h), v(h, h));

  // Each prop stands on the floor nearest under the height it names (the level it was placed at), as an Objective does: a tree placed while
  // editing the keep's level but out on the field stands on the ground, one on a Ramp on its slope.
  const props = (source.look?.props ?? []).map((p) => {
    const under = surfacesAt(draft.arena, p.x, p.z)
      .map((j) => surfaceHeight(draft.arena, j, p.x, p.z))
      .filter((y) => y <= p.y + LEVEL_EPS);
    return under.length > 0 ? { ...p, y: Math.max(...under) } : p;
  });
  const lights = placeProps(props, buckets);
  const root = new THREE.Group();
  root.name = MAP_MODEL_ROOT;
  root.add(...buckets.meshes(), ...lights);
  root.userData = { sky: source.look?.sky ?? 'dusk' };
  return root;
}

/** The model as a `.glb` file (binary glTF), what Save writes to `public/models/arenas/battle_<map>.glb`. */
export async function exportMapModel(model: THREE.Object3D): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLTFExporter did not give a binary file');
  return out;
}
