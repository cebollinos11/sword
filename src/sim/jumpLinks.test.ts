import { describe, expect, it } from 'vitest';
import { loadTuningData, parseArena } from '../tuning';
import { arenaOf, groundBelow, jumpArc } from './index';
import { findPath, navMesh, type NavPoint } from './nav';

const tuning = loadTuningData();

/** Ticks of Jump held: a tap, held 0.25 s, and a full Jump (0.5 s or more). */
const TAP = 0;
const HELD = 15;
const FULL = 30;

/**
 * Every spot docs/jump-reach.md lists as reached only by a held Jump (or a tap): the Arena, where the Jump
 * takes off (on the ground there), which way and how long Jump is held, and the height of the lid it lands on.
 */
const SPOTS: readonly { arena: string; spot: string; x: number; z: number; y: number; move: { x: number; z: number }; hold: number; lid: number }[] = [
  { arena: 'summit', spot: 'the hull', x: -1.8, z: -7.0, y: 2, move: { x: 0, z: -1 }, hold: HELD, lid: 3.45 },
  { arena: 'summit', spot: 'the containers', x: 3.0, z: -5.6, y: 2, move: { x: 0, z: 1 }, hold: TAP, lid: 2.5 },
  { arena: 'summit', spot: 'the nacelle', x: -3.5, z: 3.7, y: 0, move: { x: -1, z: 0 }, hold: HELD, lid: 1.3 },
  { arena: 'summit', spot: 'the dish', x: 3.8, z: 4.0, y: 0, move: { x: 0, z: 1 }, hold: HELD, lid: 1.1 },
  { arena: 'summit', spot: 'the crate by the back crag', x: -2.6, z: 5.2, y: 0, move: { x: 0, z: 1 }, hold: TAP, lid: 0.9 },
  { arena: 'summit', spot: 'the crate in the nook', x: -3.4, z: -3.2, y: 0, move: { x: 0, z: -1 }, hold: TAP, lid: 0.8 },
  { arena: 'train', spot: "the locomotive's roof", x: -0.6, z: 19.0, y: -1.2, move: { x: 0, z: 1 }, hold: FULL, lid: 0.5 },
  { arena: 'train', spot: 'the crate stack', x: 0.75, z: 13.6, y: -1.2, move: { x: 0, z: 1 }, hold: HELD, lid: 0.6 },
  { arena: 'train', spot: 'the power cell', x: 0.7, z: 16.8, y: -1.2, move: { x: 0, z: 1 }, hold: HELD, lid: 0.25 },
  { arena: 'train', spot: 'the waste drums', x: -0.8, z: 15.9, y: -1.2, move: { x: 0, z: 1 }, hold: TAP, lid: -0.3 },
  { arena: 'ship', spot: 'the big crate', x: -1.95, z: 4.9, y: 0, move: { x: 0, z: 1 }, hold: TAP, lid: 1.0 },
  { arena: 'library', spot: 'the reading tables', x: -5, z: 8.6, y: 0, move: { x: 0, z: 1 }, hold: TAP, lid: 0.8 },
  { arena: 'chamber', spot: 'the catwalk at +z', x: 0, z: 7.2, y: 0, move: { x: 0, z: 1 }, hold: FULL, lid: 0 },
  { arena: 'chamber', spot: 'the catwalk at -z', x: 0, z: -7.2, y: 0, move: { x: 0, z: -1 }, hold: FULL, lid: 0 },
];

describe('Every held-Jump spot in docs/jump-reach.md has a jump Link', () => {
  for (const s of SPOTS) {
    it(`${s.arena}: ${s.spot}`, () => {
      const arena = arenaOf(tuning, s.arena);
      const y = groundBelow(arena, s.x, s.z, s.y + tuning.fall.stepUp)!.y;
      // Where the documented Jump lands: a point on the lid.
      const arc = jumpArc(arena, tuning, { at: { x: s.x, z: s.z }, y, heading: s.move, holdTicks: s.hold });
      expect(arc.lands!.y).toBeCloseTo(s.lid, 6);
      const from: NavPoint = { x: s.x, z: s.z, y };
      const to: NavPoint = arc.lands!;
      const mesh = navMesh(arena, tuning);
      const up = findPath(arena, tuning, from, to)!;
      expect(up).not.toBeNull();
      expect(up.some((id) => mesh.links[id]!.kind === 'jump')).toBe(true);
      // And down (or back) again: a drop off the lid, or a Jump where dropping would be deadly.
      expect(findPath(arena, tuning, to, from)).not.toBeNull();
    });
  }
});

describe('Building the navmesh', () => {
  it('takes well under a second for every Arena, jump Links and all (logged)', () => {
    const times: string[] = [];
    for (const name of Object.keys(tuning.arenas)) {
      // A fresh copy, never built before: the navmesh is cached per Arena.
      const arena = parseArena(JSON.parse(JSON.stringify(tuning.arenas[name])), name);
      const t0 = performance.now();
      const mesh = navMesh(arena, { ...tuning, arenas: { ...tuning.arenas, [name]: arena } });
      const ms = performance.now() - t0;
      times.push(`${name} ${ms.toFixed(0)} ms (${mesh.links.filter((l) => l.kind === 'jump').length} jump Links)`);
      expect(ms).toBeLessThan(1000);
    }
    console.log(`navmesh build: ${times.join(', ')}`);
  });
});
