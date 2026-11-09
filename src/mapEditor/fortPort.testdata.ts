/**
 * The Fort ported into a Map Source (docs/plans/map-editor.md, Stage 6): a one-off port of `art/build_battle_fort.py`'s numbers (its
 * keep, ramps, tunnel, parapets, walls, breaches, towers, sheds, Objectives, Bases, front, army size and Tickets) into Brushes, in mirror
 * mode, so every part has its twin and the compiled map is its own half turn. Not a shipped map: it is saved under the plan's folder
 * (`docs/plans/map-editor/fortport.source.json`, and the map it compiles to beside it) and offered by the Map Editor's Open example, to
 * play beside the shipped Fort. Its name is `fortport`, since `fort` is the generator's (Save refuses it).
 *
 * How the Fort's helpers become Brushes:
 *  - The ground: one Floor over the field (grass). The generator's ground is the field less the blocks and what the keep stands over;
 *    here the Blocks, the keep's two halves and its ramps cut it out themselves.
 *  - The keep: a Platform each side of the tunnel (x ±3 to ±14, 4 m up), and a Deck over the tunnel between them (the tunnel's floor is the
 *    ground under it). The compiler stands the keep's faces and the tunnel's sides (from -1 m to the deck) on its own, as the generator's
 *    `face_*` and `tunnel_*` Walls.
 *  - The ramps: a Ramp up each of the keep's west and east faces (11 m wide, 9 m long), railed on both sides (-1 m to the deck plus 1 m).
 *  - The parapet: six Rails a metre over the deck along its edge, open at the ramps.
 *  - The walls, towers, stumps and sheds: Blocks, each Team 0's beside its twin, so the compiled Blocks are the generator's order (its south
 *    half, then their half turns in reverse).
 *  - The look (Stage 5): stone and basalt, a stone roof over the tunnel, rubble in the breaches and round the fallen towers, torches at the
 *    gates and the ramps' feet, banners at the Bases and on the keep, crates in the courtyard, trees on the flanks, under the dusk sky.
 */
import { MAP_SOURCE_VERSION, type BlockBrush, type Brush, type MapSource, type SourceObjective, type SourceProp } from './source';
import { turnBrush, turnObjective, turnProp } from './mirror';

// The generator's numbers (art/build_battle_fort.py), in metres.
const FRONT = 52;
const BASE = 88;
const ARMY_SIZE = { standard: 144, max: 144 };
const TICKETS = 2.4;
const KEEP = 14;
const DECK = 4;
const TUNNEL = 3;
const RAMP = 5.5;
const RAMP_LEN = 9;
const CURTAIN = 5;
const TOWER = 9;
const STUMP = 3;
const RUIN = 2.5;

/** Team 0's half of the solid blocks, as the generator's `SOUTH`: (id, x0, x1, z0, z1, top). */
const SOUTH: readonly [string, number, number, number, number, number][] = [
  ['curtain_s_w', -30, -13, -34, -30, CURTAIN],
  ['gate_s_w', -13, -5, -37, -27, TOWER],
  ['gate_s_e', 5, 13, -37, -27, TOWER],
  ['curtain_s_m', 13, 17, -34, -30, CURTAIN],
  ['curtain_s_e', 25, 30, -34, -30, CURTAIN],
  ['corner_sw', -38, -30, -38, -30, TOWER],
  ['corner_se', 30, 38, -38, -30, STUMP],
  ['curtain_e_s', 30, 34, -30, -6, CURTAIN],
  ['curtain_e_n', 30, 34, 6, 30, CURTAIN],
  ['shed_a', -58, -54, -15, -7, RUIN],
  ['shed_a2', -66, -62, 7, 15, RUIN],
];

/** A generator id as a Brush id (no `_`), and its half turn's, as the generator's `turned` names it (compass letters turned, A's shed C's). */
const brushId = (id: string): string => id.replace(/_/g, '-');
const turnedId = (id: string): string =>
  id
    .split('_')
    .map((p) => (/^[nsew]+$/.test(p) ? [...p].map((c) => ({ n: 's', s: 'n', e: 'w', w: 'e' })[c]).join('') : p))
    .join('_')
    .replace('shed_a', 'shed_c');

/** `b` and its half turn, linked, the twin named `id`. */
function pair<B extends Brush>(b: B, id: string): [B, B] {
  return [{ ...b, twin: id }, { ...turnBrush(b), id, twin: b.id }];
}

function blocks(): Brush[] {
  return SOUTH.flatMap(([id, x0, x1, z0, z1, top]) => {
    const tall = top >= TOWER;
    const block: BlockBrush = { kind: 'block', id: brushId(id), rect: { x0, z0, x1, z1 }, top, material: tall || top === CURTAIN ? 'stone' : 'basalt' };
    return pair(block, brushId(turnedId(id)));
  });
}

function keep(): Brush[] {
  const k = KEEP;
  const r = RAMP;
  const rail = (id: string, a: [number, number], b: [number, number]): Brush => ({ kind: 'rail', id, a: { x: a[0], z: a[1] }, b: { x: b[0], z: b[1] }, y: DECK, height: 1, material: 'stone' });
  return [
    ...pair({ kind: 'platform', id: 'keep-w', rect: { x0: -k, z0: -k, x1: -TUNNEL, z1: k }, top: DECK, material: 'stone' }, 'keep-e'),
    { kind: 'deck', id: 'roof', rect: { x0: -TUNNEL, z0: -k, x1: TUNNEL, z1: k }, y: DECK, material: 'stone', twin: 'roof' },
    ...pair({ kind: 'ramp', id: 'ramp-w', rect: { x0: -k - RAMP_LEN, z0: -r, x1: -k, z1: r }, lo: 0, hi: DECK, up: 'e', rails: ['n', 's'], material: 'cobble' }, 'ramp-e'),
    ...pair(rail('parapet-s', [-k, -k], [k, -k]), 'parapet-n'),
    ...pair(rail('parapet-w-s', [-k, -k], [-k, -r]), 'parapet-e-n'),
    ...pair(rail('parapet-w-n', [-k, r], [-k, k]), 'parapet-e-s'),
  ];
}

/** Objectives in the Battle's order, as the generator's: D (Team 0's gatehouse), A, B (on the keep), C, E (Team 1's). */
function objectives(): SourceObjective[] {
  const d: SourceObjective = { id: 'D', x: 0, z: -32, weight: 1, owner: -1, spawn: true, twin: 'E' };
  const a: SourceObjective = { id: 'A', x: -60, z: 0, weight: 1, owner: -1, spawn: false, twin: 'C' };
  return [d, a, { id: 'B', x: 0, z: 0, weight: 1.4, owner: -1, spawn: false, twin: 'B' }, { ...turnObjective(a), id: 'C', twin: 'A' }, { ...turnObjective(d), id: 'E', twin: 'D' }];
}

/** The props of Team 0's half (each with its twin), as the generator dresses the Fort: rubble, torches, banners, crates and trees. */
function props(): SourceProp[] {
  const half: [SourceProp['kind'], number, number, number, number, (0 | 1)?][] = [
    // Rubble in the south breach, the east breach and round the fallen corner tower.
    ['rubble', 21, -32, 0, 0],
    ['rubble', 32, -3, 0, 30],
    ['rubble', 32, 3, 0, 300],
    ['rubble', 37, -37, 0, 45],
    ['rubble', 31, -39, 0, 150],
    // Torches either side of the south gate and at the west ramp's foot.
    ['torch', -4, -38.5, 0, 0],
    ['torch', 4, -38.5, 0, 0],
    ['torch', -24, -7, 0, 270],
    ['torch', -24, 7, 0, 270],
    // Team 0's banner at its Base, a plain one on the keep's deck.
    ['banner', 2, -88, 0, 0, 0],
    ['banner', 2, 2, DECK, 0],
    // Crates in the courtyard, trees on the flanks.
    ['crate', -22, -20, 0, 15],
    ['crate', 20, -22, 0, 60],
    ['tree', -80, -45, 0, 0],
    ['tree', -86, -30, 0, 90],
    ['tree', -74, 40, 0, 200],
    ['tree', 72, -60, 0, 120],
    ['tree', 50, -76, 0, 30],
  ];
  const counts = new Map<string, number>();
  const next = (kind: string) => {
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    return `${kind}${n}`;
  };
  return half.flatMap(([kind, x, z, y, turn, team]) => {
    const id = next(kind);
    const twin = next(kind);
    const p: SourceProp = { id, kind, x, z, y, turn, ...(team === undefined ? {} : { team }), twin };
    return [p, { ...turnProp(p), id: twin, twin: id }];
  });
}

/** The Fort as a Map Source, in mirror mode. */
export function fortPortSource(): MapSource {
  return {
    version: MAP_SOURCE_VERSION,
    name: 'fortport',
    size: 200,
    // The coarse grid is the destination fields' 4 m cell, so the dots the checks warn of are the grid's centres.
    grid: { step: 0.5, cell: 4 },
    levels: [0, DECK],
    brushes: [{ kind: 'floor', id: 'ground', rect: { x0: -100, z0: -100, x1: 100, z1: 100 }, y: 0, material: 'grass', twin: 'ground' }, ...keep(), ...blocks()],
    objectives: objectives(),
    bases: [
      { x: 0, z: -BASE },
      { x: 0, z: BASE },
    ],
    front: FRONT,
    armySize: ARMY_SIZE,
    ticketsPerSoldier: TICKETS,
    lobby: { label: 'Fort (Map Source)', where: 'round a ruined fort, its walls broken by gates and breaches,', blurb: 'The Fort, ported into the Map Editor', art: 'linear-gradient(180deg, #9db3c8, #c9c3b0 50%, #6b6a5a 51%, #3d4a2c)' },
    look: { sky: 'dusk', props: props() },
    mirror: true,
  };
}
